/**
 * Provisions a tenant's own subdomain ({slug}.pol263.com) as an independent Resend domain
 * with inbound receiving enabled, and adds the DNS records Resend requires to the
 * DO-managed pol263.com zone. Gated behind the "email_inbound" module — triggered when a
 * platform owner flips that tenantFeatureFlags entry on (server/platform-routes.ts).
 *
 * Requires two global env vars (not tenant-specific — one shared Express process serves
 * every tenant, so what varies per tenant is the DB row this writes, not credentials):
 *   RESEND_MANAGEMENT_API_KEY — full_access Resend key (domain create/read needs full_access;
 *     Resend has no domain-management-only permission tier).
 *   DIGITALOCEAN_API_TOKEN — already used elsewhere (server/do-app-domains.ts) for the
 *     App Platform domain list; reused here for DNS record creation.
 *
 * Never throws — always returns {ok, message} so callers (the feature-flag toggle handler)
 * can surface success/failure without crashing, same convention as do-app-domains.ts.
 */
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants, tenantEmailDomains } from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

const RESEND_API_BASE = "https://api.resend.com";
const DO_API_BASE = "https://api.digitalocean.com/v2";
const ROOT_DOMAIN = "pol263.com";

function resendKey(): string | null {
  return process.env.RESEND_MANAGEMENT_API_KEY || null;
}
function doToken(): string | null {
  return process.env.DIGITALOCEAN_API_TOKEN || null;
}

async function resendRequest(path: string, init?: RequestInit): Promise<any> {
  const key = resendKey();
  if (!key) throw new Error("RESEND_MANAGEMENT_API_KEY not set");
  const res = await fetch(`${RESEND_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Resend API ${init?.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function doRequest(path: string, init?: RequestInit): Promise<any> {
  const token = doToken();
  if (!token) throw new Error("DIGITALOCEAN_API_TOKEN not set");
  const res = await fetch(`${DO_API_BASE}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DO API ${init?.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
}

/**
 * Resend's record.name is relative to the domain being verified (the tenant subdomain
 * itself), but the DO zone we manage is the ROOT domain — so a record like
 * name:"resend._domainkey" on falakhe.pol263.com must become the DO record
 * "resend._domainkey.falakhe" (relative to pol263.com) to end up at
 * resend._domainkey.falakhe.pol263.com.
 */
async function createDoRecordForResendRecord(rec: ResendDomainRecord, subdomain: string): Promise<void> {
  const subdomainPrefix = subdomain.slice(0, -(`.${ROOT_DOMAIN}`).length);
  const zoneRelativeName = rec.name === "@" ? subdomainPrefix : `${rec.name}.${subdomainPrefix}`;

  const body: Record<string, unknown> = { type: rec.type, name: zoneRelativeName, data: rec.value, ttl: 3600 };
  if (rec.type === "MX" && rec.priority !== undefined) body.priority = rec.priority;

  await doRequest(`/domains/${ROOT_DOMAIN}/records`, { method: "POST", body: JSON.stringify(body) });
}

export async function provisionTenantEmailDomain(orgId: string): Promise<{ ok: boolean; message: string }> {
  if (!resendKey()) return { ok: false, message: "RESEND_MANAGEMENT_API_KEY not configured." };
  if (!doToken()) return { ok: false, message: "DIGITALOCEAN_API_TOKEN not configured." };

  try {
    const [tenant] = await cpDb.select().from(tenants).where(eq(tenants.id, orgId)).limit(1);
    if (!tenant?.slug) return { ok: false, message: "Tenant has no slug on record — cannot derive a subdomain." };

    const subdomain = `${tenant.slug}.${ROOT_DOMAIN}`;
    const [existing] = await cpDb.select().from(tenantEmailDomains).where(eq(tenantEmailDomains.tenantId, orgId)).limit(1);
    if (existing?.receivingEnabled) {
      return { ok: true, message: `${subdomain} is already provisioned with receiving enabled.` };
    }

    const domain = existing
      ? await resendRequest(`/domains/${existing.resendDomainId}`)
      : await resendRequest("/domains", {
          method: "POST",
          body: JSON.stringify({ name: subdomain, capabilities: { sending: "enabled", receiving: "enabled" } }),
        });

    const records: ResendDomainRecord[] = domain.records || [];
    let recordFailures = 0;
    for (const rec of records) {
      try {
        await createDoRecordForResendRecord(rec, subdomain);
      } catch (err) {
        recordFailures++;
        structuredLog("warn", "Failed to create one DNS record for tenant email domain — continuing with the rest", {
          orgId, subdomain, record: rec, error: (err as Error).message,
        });
      }
    }

    const fromAddress = `noreply@${subdomain}`;
    if (existing) {
      await cpDb.update(tenantEmailDomains).set({
        resendDomainId: domain.id, receivingEnabled: true, fromAddress, updatedAt: new Date(),
      }).where(eq(tenantEmailDomains.tenantId, orgId));
    } else {
      await cpDb.insert(tenantEmailDomains).values({
        tenantId: orgId, subdomain, resendDomainId: domain.id, fromAddress, receivingEnabled: true,
      });
    }

    structuredLog("info", "Tenant email domain provisioned", { orgId, subdomain, resendDomainId: domain.id, recordFailures });
    if (recordFailures > 0) {
      return { ok: true, message: `${subdomain} provisioned, but ${recordFailures} DNS record(s) failed to create — check logs and add them manually.` };
    }
    return { ok: true, message: `${subdomain} provisioned. DNS records added — verification is async on Resend's side, typically minutes to a few hours.` };
  } catch (err) {
    structuredLog("error", "Tenant email domain provisioning failed", { orgId, error: (err as Error).message });
    return { ok: false, message: `Provisioning failed: ${(err as Error).message}` };
  }
}

/** Looks up a tenant by the subdomain an inbound email arrived at — used by the webhook receiver. */
export async function resolveTenantBySubdomain(subdomain: string): Promise<{ tenantId: string; receivingEnabled: boolean } | null> {
  const [row] = await cpDb.select({ tenantId: tenantEmailDomains.tenantId, receivingEnabled: tenantEmailDomains.receivingEnabled })
    .from(tenantEmailDomains).where(eq(tenantEmailDomains.subdomain, subdomain)).limit(1);
  return row ?? null;
}
