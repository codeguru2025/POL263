/**
 * SMS (Africala/SMSala) configuration — server-side only.
 * NEVER expose apiToken to client, logs, or URLs.
 *
 * Each tenant is a distinct customer under our SMSala *reseller* account with their own API
 * token and Sender ID — a platform-wide shared credential can't represent that. Per-tenant
 * credentials live encrypted in control_plane.tenant_integrations (provider "sms_africala").
 *
 * The platform env vars (AFRICALA_API_TOKEN / SMS_SENDER_ID, sender "POLZW") are POL263's OWN
 * account and are never used for a tenant's messages: a tenant without its own row simply has
 * no SMS. Platform credit is only spent through sendPlatformSms (platform-owner login codes,
 * SMS-credit alerts to tenant admins).
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

/** POL263's own account (env vars). Used only by sms-service.ts's sendPlatformSms — never for
 *  a tenant's messages. */
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

function buildConfig(cfg: SmsIntegrationConfigShape): OrgSmsConfig {
  const apiToken = cfg.apiToken || "";
  const senderId = cfg.senderId || "";
  return {
    provider: process.env.SMS_PROVIDER || "africala",
    apiToken,
    senderId,
    enabled: !!apiToken && !!senderId,
  };
}

/** Resolve an org's own SMS account from the control plane. No row (or a half-filled one) means
 *  the org has no SMS — it never borrows the platform's account or credit. */
export async function getOrgSmsConfig(orgId: string): Promise<OrgSmsConfig> {
  try {
    const [row] = await cpDb
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, PROVIDER_KEY), eq(tenantIntegrations.isActive, true)))
      .limit(1);
    if (row) {
      const decrypted = decryptFields(row.config as SmsIntegrationConfigShape, ["apiToken"]);
      return buildConfig(decrypted);
    }
  } catch (err) {
    structuredLog("error", "getOrgSmsConfig: control-plane lookup failed — treating SMS as not configured", {
      orgId, error: (err as Error).message,
    });
  }
  return buildConfig({});
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
