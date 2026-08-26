/**
 * SMS (Africala/SMSala) configuration — server-side only.
 * NEVER expose apiToken to client, logs, or URLs.
 *
 * Each tenant is a distinct customer under our SMSala *reseller* account with their own API
 * token and Sender ID — a platform-wide shared credential can't represent that. Per-tenant
 * credentials live encrypted in control_plane.tenant_integrations (provider "sms_africala") and
 * take priority over the platform-level env vars. Unlike server/paynow-config.ts, there is no
 * legacy plaintext-column fallback to worry about — nothing existed before this pattern — so
 * the resolution order is just: control plane row -> platform env vars.
 *
 * The platform env var fallback is kept for a transition period / for a tenant that hasn't
 * been given their own SMSala sub-account yet, but it is expected that most tenants will have
 * their own control-plane row once the settings UI (GET/POST /api/sms-config) is used.
 */

import { and, eq } from "drizzle-orm";
import { structuredLog } from "./logger";
import { cpDb } from "./control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import { decryptFields, encryptFields } from "./tenant-config-crypto";

export interface OrgSmsConfig {
  provider: string;
  apiToken: string;
  senderId: string;
  enabled: boolean;
}

interface SmsIntegrationConfigShape {
  apiToken?: string;
  senderId?: string;
}

const PROVIDER_KEY = "sms_africala";

/** Platform-level fallback (env vars) — used when a tenant has no control-plane row yet, and
 *  directly (bypassing any per-org lookup) for platform-owner accounts, which have no
 *  organizationId to resolve a tenant's own config from — see sms-service.ts's sendPlatformSms. */
export function platformConfig(): OrgSmsConfig {
  const apiToken = process.env.AFRICALA_API_TOKEN || "";
  const senderId = process.env.SMS_SENDER_ID || "";
  return {
    provider: process.env.SMS_PROVIDER || "africala",
    apiToken,
    senderId,
    enabled: !!apiToken && !!senderId,
  };
}

function buildConfig(cfg: SmsIntegrationConfigShape, platform: OrgSmsConfig): OrgSmsConfig {
  const apiToken = cfg.apiToken || platform.apiToken;
  const senderId = cfg.senderId || platform.senderId;
  return {
    provider: platform.provider,
    apiToken,
    senderId,
    enabled: !!apiToken && !!senderId,
  };
}

/** Resolve SMS config for a specific org: control plane first, then platform env. */
export async function getOrgSmsConfig(orgId: string): Promise<OrgSmsConfig> {
  const platform = platformConfig();

  try {
    const [row] = await cpDb
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PROVIDER_KEY), eq(tenantIntegrations.isActive, true)))
      .limit(1);
    if (row) {
      const decrypted = decryptFields(row.config as SmsIntegrationConfigShape, ["apiToken"]);
      return buildConfig(decrypted, platform);
    }
  } catch (err) {
    structuredLog("error", "getOrgSmsConfig: control-plane lookup failed, falling back to platform env config", {
      orgId, error: (err as Error).message,
    });
  }

  // No row for this org (not yet configured with their own SMSala sub-account), or the
  // control plane was unreachable — fall back to the shared platform account, if any.
  return platform;
}

/**
 * Create or update an org's SMS integration config in the control plane, encrypting apiToken
 * before it's ever written to disk. Pass only the fields being changed — omitted fields keep
 * their existing stored value. senderId is not a secret (it's a public sender identity) so it
 * is stored in plaintext.
 */
export async function upsertOrgSmsConfig(orgId: string, patch: Partial<SmsIntegrationConfigShape>): Promise<void> {
  const [existing] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PROVIDER_KEY)))
    .limit(1);

  const currentDecrypted: SmsIntegrationConfigShape = existing
    ? decryptFields(existing.config as SmsIntegrationConfigShape, ["apiToken"])
    : {};
  const merged: SmsIntegrationConfigShape = { ...currentDecrypted, ...patch };
  const finalConfig = encryptFields(merged, ["apiToken"]);

  if (existing) {
    await cpDb.update(tenantIntegrations).set({ config: finalConfig, updatedAt: new Date() }).where(eq(tenantIntegrations.id, existing.id));
  } else {
    await cpDb.insert(tenantIntegrations).values({ tenantId: orgId, provider: PROVIDER_KEY, isActive: true, config: finalConfig });
  }
}
