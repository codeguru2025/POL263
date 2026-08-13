/**
 * Provisions a tenant's own email subdomain (mail.{slug}.pol263.com) as an independent Resend
 * domain with inbound receiving enabled, and adds the DNS records Resend requires to the
 * DO-managed pol263.com zone. Gated behind the "email_inbound" module — triggered when a
 * platform owner flips that tenantFeatureFlags entry on (server/platform-routes.ts).
 *
 * Deliberately uses a "mail." prefix distinct from the tenant's own web subdomain ({slug}.
 * pol263.com, which is a CNAME to the app — see do-app-domains.ts). Confirmed 2026-08-13 while
 * provisioning kings-and-queens-funeral-assurance.pol263.com: Resend's "receiving" capability
 * needs an MX record at the bare domain apex, and DNS forbids any other record type coexisting
 * with a CNAME at the same name — so the web subdomain and the email domain can never be the
 * same hostname once receiving is enabled. mail.{slug}.pol263.com has no other record on it,
 * so this is a hard requirement, not a style choice — same pattern other ESPs (Mailgun,
 * Postmark) push customers toward for the same reason.
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

export interface ResendDomainRecord {
  record: string;
  name: string;
  type: string;
  value: string;
  priority?: number;
}

/** Record types whose `value`/`data` is a hostname — DigitalOcean's DNS Records API rejects
 *  these unless they're a fully-qualified name ending in a trailing dot (a bare hostname like
 *  "inbound-smtp.us-east-1.amazonaws.com" 422s with "Data needs to end with a dot (.)"). TXT
 *  record data is arbitrary text, not a hostname, and must NOT get a dot appended. */
const HOSTNAME_VALUE_RECORD_TYPES = new Set(["MX", "CNAME", "NS"]);

/**
 * Resend's record.name for a subdomain email domain (e.g. "kings-and-queens-funeral-assurance.
 * pol263.com") comes back already relative to the *registrable root domain* — i.e. relative to
 * ROOT_DOMAIN, exactly the form the DO zone (which is rooted at ROOT_DOMAIN) needs — NOT
 * relative to the tenant subdomain being verified. Confirmed empirically 2026-08-13: Resend's
 * "Receiving" MX record for that domain came back with name "kings-and-queens-funeral-assurance"
 * (not "@", which is what it would be if names were relative to the domain being verified).
 * A previous version of this function assumed the opposite and did
 * `${rec.name}.${subdomainPrefix}`, which doubled the subdomain label and created dead records
 * like "send.kings-and-queens-funeral-assurance.kings-and-queens-funeral-assurance" that could
 * never verify — the same class of bug documented for do-app-domains.ts's relativeRecordName
 * (see docs/BUGFIX-LOG.md, 2026-08-04 incident). Throws rather than silently creating a
 * possibly-wrong record if Resend ever returns a name that doesn't look like it belongs to this
 * subdomain at all.
 */
export function zoneRelativeNameForResendRecord(rec: ResendDomainRecord, subdomainPrefix: string): string {
  if (rec.name === "@") return "@";
  if (rec.name !== subdomainPrefix && !rec.name.endsWith(`.${subdomainPrefix}`)) {
    throw new Error(
      `Resend record name "${rec.name}" doesn't look like it belongs to subdomain "${subdomainPrefix}" — refusing to create a possibly-wrong DNS record.`
    );
  }
  return rec.name;
}

interface DoDnsRecord { id: number; type: string; name: string; data: string; }

/**
 * Creates (or self-heals, if one already exists with the wrong data — e.g. a leftover from the
 * subdomain-doubling bug above) the DO DNS record for one Resend-required record. Checks the
 * zone's existing records first so re-running provisioning (after a partial failure, or the
 * platform owner re-toggling the feature flag) doesn't pile up duplicate records — same
 * idempotency pattern as do-app-domains.ts's ensureDnsRecord.
 */
async function createDoRecordForResendRecord(
  rec: ResendDomainRecord,
  subdomain: string,
  existingRecords: DoDnsRecord[]
): Promise<void> {
  const subdomainPrefix = subdomain.slice(0, -(`.${ROOT_DOMAIN}`).length);
  const zoneRelativeName = zoneRelativeNameForResendRecord(rec, subdomainPrefix);
  const data = HOSTNAME_VALUE_RECORD_TYPES.has(rec.type) && !rec.value.endsWith(".") ? `${rec.value}.` : rec.value;
  const normalize = (v: string) => v.toLowerCase().replace(/\.$/, "");

  const existing = existingRecords.find(
    (r) => r.type === rec.type && r.name.toLowerCase() === zoneRelativeName.toLowerCase()
  );

  const body: Record<string, unknown> = { type: rec.type, name: zoneRelativeName, data, ttl: 3600 };
  if (rec.type === "MX" && rec.priority !== undefined) body.priority = rec.priority;

  if (existing) {
    if (normalize(existing.data) === normalize(data)) return; // already correct, no-op
    await doRequest(`/domains/${ROOT_DOMAIN}/records/${existing.id}`, { method: "PUT", body: JSON.stringify(body) });
    return;
  }
  await doRequest(`/domains/${ROOT_DOMAIN}/records`, { method: "POST", body: JSON.stringify(body) });
}

export async function provisionTenantEmailDomain(orgId: string): Promise<{ ok: boolean; message: string }> {
  if (!resendKey()) return { ok: false, message: "RESEND_MANAGEMENT_API_KEY not configured." };
  if (!doToken()) return { ok: false, message: "DIGITALOCEAN_API_TOKEN not configured." };

  try {
    const [tenant] = await cpDb.select().from(tenants).where(eq(tenants.id, orgId)).limit(1);
    if (!tenant?.slug) return { ok: false, message: "Tenant has no slug on record — cannot derive a subdomain." };

    const subdomain = `mail.${tenant.slug}.${ROOT_DOMAIN}`;
    const [existing] = await cpDb.select().from(tenantEmailDomains).where(eq(tenantEmailDomains.tenantId, orgId)).limit(1);
    if (existing?.receivingEnabled && existing.subdomain === subdomain) {
      return { ok: true, message: `${subdomain} is already provisioned with receiving enabled.` };
    }

    // A row from a superseded subdomain scheme (e.g. provisioned before the mail. prefix
    // above was required) isn't this domain — don't resume it as if it were. Best-effort
    // retire the old Resend resource and provision fresh under the current scheme.
    const isStale = !!existing && existing.subdomain !== subdomain;
    if (isStale) {
      try {
        await resendRequest(`/domains/${existing!.resendDomainId}`, { method: "DELETE" });
      } catch (err) {
        structuredLog("warn", "Failed to delete stale Resend domain for a superseded subdomain scheme — continuing", {
          orgId, oldSubdomain: existing!.subdomain, newSubdomain: subdomain, error: (err as Error).message,
        });
      }
    }

    const domain = existing && !isStale
      ? await resendRequest(`/domains/${existing.resendDomainId}`)
      : await resendRequest("/domains", {
          method: "POST",
          body: JSON.stringify({ name: subdomain, capabilities: { sending: "enabled", receiving: "enabled" } }),
        });

    const zoneRecords = await doRequest(`/domains/${ROOT_DOMAIN}/records?per_page=200`);
    const existingDoRecords: DoDnsRecord[] = zoneRecords.domain_records || [];

    const records: ResendDomainRecord[] = domain.records || [];
    let recordFailures = 0;
    for (const rec of records) {
      try {
        await createDoRecordForResendRecord(rec, subdomain, existingDoRecords);
      } catch (err) {
        recordFailures++;
        structuredLog("warn", "Failed to create one DNS record for tenant email domain — continuing with the rest", {
          orgId, subdomain, record: rec, error: (err as Error).message,
        });
      }
    }

    // Only claim "receiving enabled" once every required DNS record actually landed — leaving
    // this true after a partial failure would both misrepresent tenant state to the platform
    // owner and (via the early-return above) block a retry from ever reaching this code again.
    const receivingEnabled = recordFailures === 0;
    const fromAddress = `noreply@${subdomain}`;
    if (existing) {
      await cpDb.update(tenantEmailDomains).set({
        resendDomainId: domain.id, receivingEnabled, fromAddress, updatedAt: new Date(),
      }).where(eq(tenantEmailDomains.tenantId, orgId));
    } else {
      await cpDb.insert(tenantEmailDomains).values({
        tenantId: orgId, subdomain, resendDomainId: domain.id, fromAddress, receivingEnabled,
      });
    }

    structuredLog("info", "Tenant email domain provisioned", { orgId, subdomain, resendDomainId: domain.id, recordFailures });
    if (recordFailures > 0) {
      return { ok: true, message: `${subdomain} provisioned, but ${recordFailures} DNS record(s) failed to create — check logs and retry (re-toggling the module is safe to re-run).` };
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
