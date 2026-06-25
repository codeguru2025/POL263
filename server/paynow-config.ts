/**
 * Paynow configuration — server-side only.
 * NEVER expose PAYNOW_INTEGRATION_KEY to client, logs, or URLs.
 *
 * Per-tenant credentials stored in organizations table take priority over
 * the platform-level env vars. This allows each insurance company to use
 * their own PayNow merchant account.
 */

import { storage } from "./storage";

export interface OrgPaynowConfig {
  integrationId: string;
  integrationKey: string;
  authEmail: string;
  returnUrl: string;
  resultUrl: string;
  mode: "test" | "live";
  enabled: boolean;
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

/** Resolve PayNow config for a specific org, falling back to platform env vars. */
export async function getOrgPaynowConfig(orgId: string): Promise<OrgPaynowConfig> {
  const platform = platformConfig();
  try {
    const org = await storage.getOrganization(orgId);
    if (!org) return platform;

    const integrationId = (org as any).paynowIntegrationId || platform.integrationId;
    const integrationKey = (org as any).paynowIntegrationKey || platform.integrationKey;
    const authEmail = (org as any).paynowAuthEmail || platform.authEmail;
    const returnUrl = (org as any).paynowReturnUrl || platform.returnUrl;
    const resultUrl = (org as any).paynowResultUrl || platform.resultUrl;
    const mode = ((org as any).paynowMode || platform.mode) as "test" | "live";

    return {
      integrationId,
      integrationKey,
      authEmail,
      returnUrl,
      resultUrl,
      mode,
      enabled: process.env.PAYMENTS_PAYNOW_ENABLED !== "false" && !!integrationId && !!integrationKey,
    };
  } catch {
    return platform;
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
