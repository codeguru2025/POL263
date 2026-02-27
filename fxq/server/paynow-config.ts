/**
 * Paynow configuration — server-side only.
 * NEVER expose PAYNOW_INTEGRATION_KEY to client, logs, or URLs.
 */

const PAYNOW_INTEGRATION_ID = process.env.PAYNOW_INTEGRATION_ID;
const PAYNOW_INTEGRATION_KEY = process.env.PAYNOW_INTEGRATION_KEY;
const PAYNOW_RETURN_URL = process.env.PAYNOW_RETURN_URL;
const PAYNOW_RESULT_URL = process.env.PAYNOW_RESULT_URL;
const PAYNOW_MODE = (process.env.PAYNOW_MODE || "test") as "test" | "live";
const PAYMENTS_PAYNOW_ENABLED = process.env.PAYMENTS_PAYNOW_ENABLED !== "false";

export function getPaynowConfig() {
  return {
    integrationId: PAYNOW_INTEGRATION_ID || "",
    returnUrl: PAYNOW_RETURN_URL || "",
    resultUrl: PAYNOW_RESULT_URL || "",
    mode: PAYNOW_MODE,
    enabled: PAYMENTS_PAYNOW_ENABLED && !!PAYNOW_INTEGRATION_ID && !!PAYNOW_INTEGRATION_KEY,
  };
}

/** Use only in server-side code; never log or send to client. */
export function getPaynowIntegrationKey(): string {
  const key = process.env.PAYNOW_INTEGRATION_KEY;
  if (!key) return "";
  return key;
}

export function getPaynowIntegrationId(): string {
  return process.env.PAYNOW_INTEGRATION_ID || "";
}

export function isPaynowConfigured(): boolean {
  return !!(process.env.PAYNOW_INTEGRATION_ID && process.env.PAYNOW_INTEGRATION_KEY);
}
