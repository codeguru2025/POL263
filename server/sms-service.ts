/**
 * Vendor-agnostic SMS sending. Mirrors email-service.ts's shape: sendSms() never throws —
 * callers must check the returned {ok, message}, never assume delivery.
 *
 * Vendor selection is a config change (SMS_PROVIDER env var), not a code change — add a new
 * SmsProvider implementation and a case in getProvider() to support another vendor (e.g. Twilio,
 * Africa's Talking) without touching any call site.
 *
 * Credentials are per-tenant: each org is a distinct customer under our SMSala reseller account
 * with its own API token and Sender ID, resolved via server/sms-config.ts's getOrgSmsConfig()
 * (control-plane tenant_integrations row, falling back to platform env vars). sendSms() and
 * isSmsConfigured() therefore both take an orgId — there is no longer a single global
 * "is SMS configured" answer, since it depends on which tenant is asking.
 */

import { structuredLog } from "./logger";
import { getOrgSmsConfig, platformConfig } from "./sms-config";

export interface SendSmsOptions {
  to: string;
  message: string;
  /** "transactional" (default) — account/policy notices. "promotional" for marketing-style
   *  broadcasts. Some vendors (Africala included) require this to route correctly / avoid
   *  regulatory filtering — never send account notifications as "promotional". */
  kind?: "transactional" | "promotional" | "otp";
}

/** Credentials resolved for a specific org — never read from process.env inside a provider. */
export interface SmsProviderCredentials {
  apiToken: string;
  senderId: string;
}

export interface SmsProvider {
  readonly name: string;
  isConfigured(creds: SmsProviderCredentials): boolean;
  send(creds: SmsProviderCredentials, opts: SendSmsOptions): Promise<{ ok: boolean; message: string; providerMessageId?: string }>;
}

/**
 * Strips everything but digits and prepends SMS_DEFAULT_COUNTRY_CODE when given a local-format
 * number (leading 0, no country code) — mirrors the equivalent normalization already done for
 * Paynow EcoCash numbers (server/payment-service.ts's buildRemoteParams), except configurable
 * rather than hardcoded to "263", since SMS recipients aren't restricted to one country's mobile
 * money rails the way EcoCash/OneMoney inherently are.
 */
export function normalizePhoneForSms(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "");
  const defaultCountryCode = (process.env.SMS_DEFAULT_COUNTRY_CODE || "263").replace(/\D/g, "");
  if (digits.startsWith("0") && digits.length <= 11) {
    digits = defaultCountryCode + digits.slice(1);
  }
  return digits;
}

class AfricalaProvider implements SmsProvider {
  readonly name = "africala";

  isConfigured(creds: SmsProviderCredentials): boolean {
    return !!(creds.apiToken && creds.senderId);
  }

  async send(creds: SmsProviderCredentials, opts: SendSmsOptions): Promise<{ ok: boolean; message: string; providerMessageId?: string }> {
    const apiToken = creds.apiToken;
    const sourceAddress = creds.senderId;
    if (!apiToken || !sourceAddress) {
      return { ok: false, message: "Africala is not configured for this organization. Set an API token and Sender ID in Settings." };
    }

    const messageType = opts.kind === "promotional" ? "1" : opts.kind === "otp" ? "3" : "2"; // default: Transactional
    const destinationAddress = normalizePhoneForSms(opts.to);

    try {
      const res = await fetch("https://api2.smsala.com/SendSmsV2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify([{
          apiToken,
          messageType,
          messageEncoding: "1",
          destinationAddress,
          sourceAddress,
          messageText: opts.message,
        }]),
      });

      const body = await res.json().catch(() => null);
      const first = Array.isArray(body) ? body[0] : null;

      if (!res.ok || !first) {
        structuredLog("error", "Africala SMS send failed — bad response", { status: res.status, body });
        return { ok: false, message: `Africala SMS failed: HTTP ${res.status}` };
      }
      // OperationCode 0 = success per Africala's docs; anything else (or a non-"Success" Status)
      // is a per-recipient failure that still comes back as HTTP 200, so status must be checked
      // in the body, not just the HTTP status code.
      if (first.OperationCode !== 0 || first.Status !== "Success") {
        structuredLog("error", "Africala SMS send failed — provider rejected", { destinationAddress, response: first });
        return { ok: false, message: `Africala SMS failed: ${first.Remarks || first.Status || "unknown error"}` };
      }

      structuredLog("info", "SMS sent via Africala", { to: destinationAddress, messageId: first.MessageId });
      return { ok: true, message: `SMS sent to ${destinationAddress}`, providerMessageId: String(first.MessageId) };
    } catch (err: any) {
      structuredLog("error", "Africala SMS send threw", { error: err?.message, to: destinationAddress });
      return { ok: false, message: `Africala SMS failed: ${err?.message || "network error"}` };
    }
  }
}

const providers: Record<string, () => SmsProvider> = {
  africala: () => new AfricalaProvider(),
};

let cachedProvider: SmsProvider | null | undefined;

function getProvider(): SmsProvider | null {
  if (cachedProvider !== undefined) return cachedProvider;
  const key = (process.env.SMS_PROVIDER || "africala").toLowerCase();
  const factory = providers[key];
  cachedProvider = factory ? factory() : null;
  if (!cachedProvider) {
    structuredLog("error", "Unknown SMS_PROVIDER configured", { SMS_PROVIDER: key, known: Object.keys(providers) });
  }
  return cachedProvider;
}

/** Whether SMS is usable for this org — resolves the org's control-plane/platform config. */
export async function isSmsConfigured(orgId: string): Promise<boolean> {
  const provider = getProvider();
  if (!provider) return false;
  const creds = await getOrgSmsConfig(orgId);
  return provider.isConfigured(creds);
}

/** Send an SMS on behalf of an org. Never throws — returns {ok:false, message} if unconfigured
 *  or the send fails. Credentials are resolved per-org (see server/sms-config.ts). */
export async function sendSms(orgId: string, opts: SendSmsOptions): Promise<{ ok: boolean; message: string; providerMessageId?: string }> {
  const provider = getProvider();
  if (!provider) {
    return { ok: false, message: `SMS provider "${process.env.SMS_PROVIDER || "africala"}" is not recognized.` };
  }
  const creds = await getOrgSmsConfig(orgId);
  if (!provider.isConfigured(creds)) {
    return { ok: false, message: `SMS is not configured for provider "${provider.name}" for this organization. Set an API token and Sender ID in Settings.` };
  }
  return provider.send(creds, opts);
}

/**
 * Sends using only the platform-level fallback credentials, bypassing per-org resolution
 * entirely. For platform-owner accounts, which have no organizationId to resolve a tenant's own
 * SMS config from — currently only used by the staff MFA SMS-fallback flow (server/auth.ts).
 */
export async function sendPlatformSms(opts: SendSmsOptions): Promise<{ ok: boolean; message: string; providerMessageId?: string }> {
  const provider = getProvider();
  if (!provider) {
    return { ok: false, message: `SMS provider "${process.env.SMS_PROVIDER || "africala"}" is not recognized.` };
  }
  const creds = platformConfig();
  if (!provider.isConfigured(creds)) {
    return { ok: false, message: "SMS is not configured at the platform level." };
  }
  return provider.send(creds, opts);
}
