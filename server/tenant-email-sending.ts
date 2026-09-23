/**
 * Per-tenant Resend API key for sending from a tenant's own domain (organizations.
 * emailFromAddress). The platform's own SMTP_PASS is deliberately a "sending access" key scoped
 * to only pol263.com (see .env.example) — the same account can technically hold multiple verified
 * domains, but a domain-restricted key can only ever send from the one domain it was scoped to.
 * So sending from a tenant's own domain needs a second, separately-scoped API key, not just a
 * different `from` address — confirmed empirically: the platform key returns "550 This API key is
 * not authorized to send emails from <tenant domain>" when tried.
 *
 * Same shape as every other per-tenant credential in this codebase (public-api-bearer.ts,
 * customer-service-integration.ts): one control_plane.tenant_integrations row per tenant,
 * AES-256-GCM encrypted at rest.
 */
import { and, eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import { decryptFields, encryptFields } from "./tenant-config-crypto";

export const RESEND_SENDING_PROVIDER_KEY = "resend_sending";

interface ResendSendingConfigShape {
  apiKey?: string;
}

/** Create or rotate a tenant's Resend sending-access API key (obtained from Resend, scoped to
 *  that tenant's verified domain — see script/create-resend-sending-key.ts). Encrypts before it
 *  touches the database. */
export async function upsertResendSendingCredential(orgId: string, apiKey: string): Promise<void> {
  const [existing] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, RESEND_SENDING_PROVIDER_KEY)))
    .limit(1);
  const config = encryptFields({ apiKey }, ["apiKey"]);
  if (existing) {
    await cpDb
      .update(tenantIntegrations)
      .set({ config, isActive: true, updatedAt: new Date() })
      .where(eq(tenantIntegrations.id, existing.id));
  } else {
    await cpDb.insert(tenantIntegrations).values({ tenantId: orgId, provider: RESEND_SENDING_PROVIDER_KEY, isActive: true, config });
  }
}

/** The decrypted API key for this tenant, or null if none is configured/active. Called once per
 *  send (server/email-service.ts) — a tenant's outbound email volume doesn't warrant caching this
 *  across requests given it's already a single indexed control-plane lookup. */
export async function getResendSendingApiKey(orgId: string): Promise<string | null> {
  const [row] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, RESEND_SENDING_PROVIDER_KEY), eq(tenantIntegrations.isActive, true)))
    .limit(1);
  if (!row) return null;
  const cfg = decryptFields((row as any).config as ResendSendingConfigShape, ["apiKey"]);
  return cfg.apiKey || null;
}

/**
 * Resolves both the "from" address and the matching send credential for an org's transactional
 * email in one call, so every sendEmail() caller does this the same way. Returns {} (platform
 * default in every respect) when the org has no custom sending domain configured, or when it does
 * but the matching API key hasn't been provisioned yet (fails safe to the platform default rather
 * than to a guaranteed-to-be-rejected send from the tenant's domain with the platform's key).
 */
export async function resolveTenantEmailOverrides(
  orgId: string,
  org: { emailFromAddress?: string | null } | null | undefined,
): Promise<{ from?: string; apiKeyOverride?: string }> {
  const from = org?.emailFromAddress || undefined;
  if (!from) return {};
  const apiKeyOverride = (await getResendSendingApiKey(orgId)) || undefined;
  if (!apiKeyOverride) return {}; // misconfigured — safer to fall back entirely than to guarantee a 550
  return { from, apiKeyOverride };
}
