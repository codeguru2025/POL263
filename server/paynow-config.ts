/**
 * Paynow configuration — server-side only.
 * NEVER expose PAYNOW_INTEGRATION_KEY to client, logs, or URLs.
 *
 * Per-tenant credentials stored in organizations table take priority over
 * the platform-level env vars. This allows each insurance company to use
 * their own PayNow merchant account.
 */

import { storage } from "./storage";
import { structuredLog } from "./logger";

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
