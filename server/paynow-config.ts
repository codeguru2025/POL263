/**
 * Paynow configuration — server-side only.
 * NEVER expose PAYNOW_INTEGRATION_KEY to client, logs, or URLs.
 *
 * Per-tenant credentials live encrypted in control_plane.tenant_integrations (provider
 * "paynow") and take priority over the platform-level env vars, so each insurance company
 * can use their own Paynow merchant account. Falls back to the legacy plaintext columns on
 * the shared organizations table for any org not yet migrated (see
 * scripts/migrate-paynow-config-to-control-plane.mjs).
 */

import { and, eq } from "drizzle-orm";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { cpDb } from "./control-plane-db";
import { tenantIntegrations } from "@shared/control-plane-schema";
import { decryptFields, encryptSecret } from "./tenant-config-crypto";

export interface OrgPaynowConfig {
  integrationId: string;
  integrationKey: string;
  authEmail: string;
  returnUrl: string;
  resultUrl: string;
  mode: "test" | "live";
  enabled: boolean;
}

interface PaynowIntegrationConfigShape {
  integrationId?: string;
  integrationKey?: string;
  authEmail?: string;
  returnUrl?: string;
  resultUrl?: string;
  mode?: "test" | "live";
}

/** Platform-level fallback (env vars). */
function platformConfig(): OrgPaynowConfig {
  const integrationId = process.env.PAYNOW_INTEGRATION_ID || "";
  const integrationKey = process.env.PAYNOW_INTEGRATION_KEY || "";
  return {
    integrationId,
    integrationKey,
    authEmail: process.env.PAYNOW_AUTH_EMAIL || "",
    returnUrl: process.env.PAYNOW_RETURN_URL || "",
    resultUrl: process.env.PAYNOW_RESULT_URL || "",
    mode: (process.env.PAYNOW_MODE || "test") as "test" | "live",
    enabled: process.env.PAYMENTS_PAYNOW_ENABLED !== "false" && !!integrationId && !!integrationKey,
  };
}

function buildConfig(cfg: PaynowIntegrationConfigShape, platform: OrgPaynowConfig): OrgPaynowConfig {
  const integrationId = cfg.integrationId || platform.integrationId;
  const integrationKey = cfg.integrationKey || platform.integrationKey;
  return {
    integrationId,
    integrationKey,
    authEmail: cfg.authEmail || platform.authEmail,
    returnUrl: cfg.returnUrl || platform.returnUrl,
    resultUrl: cfg.resultUrl || platform.resultUrl,
    mode: (cfg.mode || platform.mode) as "test" | "live",
    enabled: process.env.PAYMENTS_PAYNOW_ENABLED !== "false" && !!integrationId && !!integrationKey,
  };
}

/** Resolve Paynow config for a specific org: control plane first, then legacy columns, then platform env. */
export async function getOrgPaynowConfig(orgId: string): Promise<OrgPaynowConfig> {
  const platform = platformConfig();

  try {
    const [row] = await cpDb
      .select()
      .from(tenantIntegrations)
      .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, "paynow"), eq(tenantIntegrations.isActive, true)))
      .limit(1);
    if (row) {
      const decrypted = decryptFields(row.config as PaynowIntegrationConfigShape, ["integrationKey"]);
      return buildConfig(decrypted, platform);
    }
  } catch (err) {
    structuredLog("error", "getOrgPaynowConfig: control-plane lookup failed, falling back to legacy organizations columns", {
      orgId, error: (err as Error).message,
    });
  }

  // Legacy fallback — org not yet migrated to tenant_integrations, or control plane unreachable.
  let org: Awaited<ReturnType<typeof storage.getOrganization>>;
  try {
    org = await storage.getOrganization(orgId);
  } catch (err) {
    // Org lookup failed (DB blip, network issue, etc). Do NOT silently fall back to the
    // platform merchant account here — a tenant with its own dedicated PayNow credentials
    // (e.g. a different merchant, live vs test mode) must never have its payments silently
    // routed to the platform's account just because we couldn't confirm otherwise.
    structuredLog("error", "getOrgPaynowConfig: org lookup failed, refusing to fall back to platform config", {
      orgId,
      error: (err as Error).message,
    });
    return { ...platform, enabled: false };
  }

  if (!org) {
    structuredLog("warn", "getOrgPaynowConfig: organization not found, using platform config", { orgId });
    return platform;
  }

  return buildConfig({
    integrationId: (org as any).paynowIntegrationId,
    integrationKey: (org as any).paynowIntegrationKey,
    authEmail: (org as any).paynowAuthEmail,
    returnUrl: (org as any).paynowReturnUrl,
    resultUrl: (org as any).paynowResultUrl,
    mode: (org as any).paynowMode,
  }, platform);
}

/**
 * Create or update an org's Paynow integration config in the control plane, encrypting
 * integrationKey before it's ever written to disk. Pass only the fields being changed —
 * omitted fields keep their existing stored value.
 */
export async function upsertOrgPaynowConfig(orgId: string, patch: Partial<PaynowIntegrationConfigShape>): Promise<void> {
  const [existing] = await cpDb
    .select()
    .from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, orgId), eq(tenantIntegrations.provider, "paynow")))
    .limit(1);

  const currentDecrypted: PaynowIntegrationConfigShape = existing
    ? decryptFields(existing.config as PaynowIntegrationConfigShape, ["integrationKey"])
    : {};
  const merged: PaynowIntegrationConfigShape = { ...currentDecrypted, ...patch };
  const finalConfig: PaynowIntegrationConfigShape = { ...merged };
  if (finalConfig.integrationKey) {
    finalConfig.integrationKey = encryptSecret(finalConfig.integrationKey);
  }

  if (existing) {
    await cpDb.update(tenantIntegrations).set({ config: finalConfig, updatedAt: new Date() }).where(eq(tenantIntegrations.id, existing.id));
  } else {
    await cpDb.insert(tenantIntegrations).values({ tenantId: orgId, provider: "paynow", isActive: true, config: finalConfig });
  }
}

/** Legacy synchronous helper used by existing code — returns platform config only. */
export function getPaynowConfig() {
  const p = platformConfig();
  return {
    integrationId: p.integrationId,
    returnUrl: p.returnUrl,
    resultUrl: p.resultUrl,
    mode: p.mode,
    enabled: p.enabled,
  };
}

/** Use only in server-side code; never log or send to client. */
export function getPaynowIntegrationKey(): string {
  return process.env.PAYNOW_INTEGRATION_KEY || "";
}

export function getPaynowIntegrationId(): string {
  return process.env.PAYNOW_INTEGRATION_ID || "";
}

export function isPaynowConfigured(): boolean {
  return !!(process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY);
}
