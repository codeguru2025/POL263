/**
 * Lets a trusted server-to-server caller (a tenant's own marketing site, e.g. Diaspora Funeral
 * Services calling POL263's public quote/lead/registration endpoints) skip CSRF on specific
 * /api/public/* write routes by presenting `Authorization: Bearer <secret>`. These routes have no
 * session-based auth of their own — refCode is a routing key, not a secret (see resolveVcardOrgId
 * in server/routes.ts) — so CSRF stays required for everyone by default; a valid per-tenant
 * secret is a positive, narrowly-scoped alternative, not a removal of the check.
 *
 * Per-tenant, not a single global secret — exactly the same shape as the customer-service API's
 * own auth (server/customer-service-integration.ts): one control_plane.tenant_integrations row
 * per tenant (provider "public_api"), AES-256-GCM encrypted at rest, and — critically — the
 * SECRET identifies the tenant, so no orgId/refCode needs resolving before the CSRF decision (the
 * request body may not even be a shape that names an org yet at this point in the middleware
 * stack). A single shared token across every tenant would mean no per-tenant revocation, no
 * attribution of which integration made a call, and one leaked secret exposing every tenant's
 * public write routes instead of just one's — provision one per tenant via
 * script/provision-public-api-credential.ts.
 */
import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import { decryptFields, encryptFields } from "./tenant-config-crypto";
import { structuredLog } from "./logger";

export const PUBLIC_API_PROVIDER_KEY = "public_api";

const PUBLIC_API_BEARER_PATH_PREFIXES = ["/api/public/agent-vcard/"];
const PUBLIC_API_BEARER_EXACT_PATHS = ["/api/public/quote", "/api/public/register-policy"];

export function isPublicApiBearerPath(path: string): boolean {
  return PUBLIC_API_BEARER_EXACT_PATHS.includes(path) || PUBLIC_API_BEARER_PATH_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Constant-time comparison via fixed-length SHA-256 digests — timingSafeEqual needs equal-length
 *  buffers, and hashing first avoids leaking the secret's length as a side channel. */
function constantTimeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(String(a ?? ""), "utf8").digest();
  const hb = crypto.createHash("sha256").update(String(b ?? ""), "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

function extractBearerToken(authorizationHeader: string | undefined): string {
  const m = /^Bearer\s+(.+)$/i.exec(String(authorizationHeader ?? "").trim());
  return m ? m[1].trim() : "";
}

interface PublicApiConfigShape {
  secret?: string;
}

async function loadActivePublicApiIntegrations(): Promise<{ tenantId: string; secret: string }[]> {
  const rows = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.provider, PUBLIC_API_PROVIDER_KEY), eq(tenantIntegrations.isActive, true)));
  return rows.map((r: any) => {
    const cfg = decryptFields(r.config as PublicApiConfigShape, ["secret"]);
    return { tenantId: r.tenantId as string, secret: cfg.secret || "" };
  });
}

/** Generate a new secret (256 bits, url-safe). */
export function generatePublicApiSecret(): string {
  return crypto.randomBytes(32).toString("base64url");
}

/** Create or rotate a tenant's public-API secret. Encrypts before it touches the database. */
export async function upsertPublicApiCredential(orgId: string, secret: string): Promise<void> {
  const [existing] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PUBLIC_API_PROVIDER_KEY)))
    .limit(1);
  const config = encryptFields({ secret }, ["secret"]);
  if (existing) {
    await cpDb
      .update(tenantIntegrations)
      .set({ config, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
  } else {
    await cpDb.insert(tenantIntegrations).values({ tenantId: orgId, provider: PUBLIC_API_PROVIDER_KEY, isActive: true, config });
  }
}

/** Status only — never returns the secret itself. */
export async function getPublicApiCredentialStatus(orgId: string): Promise<{ configured: boolean; isActive: boolean }> {
  const [row] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PUBLIC_API_PROVIDER_KEY)))
    .limit(1);
  if (!row) return { configured: false, isActive: false };
  const cfg = decryptFields((row as any).config as PublicApiConfigShape, ["secret"]);
  return { configured: !!cfg.secret, isActive: (row as any).isActive };
}

/**
 * Authenticates a request purely from the bearer secret, resolving which tenant it belongs to —
 * mirrors authenticateCustomerServiceRequest exactly. Returns null on any failure (no header, no
 * match, control plane unreachable) rather than throwing, since this sits in front of CSRF in the
 * global middleware chain and must never itself become a way to break every request.
 */
export async function authenticatePublicApiBearerToken(authorizationHeader: string | undefined): Promise<{ orgId: string } | null> {
  const presented = extractBearerToken(authorizationHeader);
  if (!presented) return null;

  let rows: { tenantId: string; secret: string }[];
  try {
    rows = await loadActivePublicApiIntegrations();
  } catch (err) {
    structuredLog("error", "PUBLIC_API_INTEGRATION_LOAD_FAILED", { error: (err as Error).message });
    return null;
  }

  let matched: string | null = null;
  for (const row of rows) {
    // Compare against every row (no early break) so response time doesn't hint at how many
    // tenants are configured or which position matched.
    if (row.secret && constantTimeEqual(presented, row.secret)) {
      matched = row.tenantId;
    }
  }
  return matched ? { orgId: matched } : null;
}
