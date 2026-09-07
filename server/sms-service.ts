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
import { normalizeMsisdn } from "./phone";
import { getOrgSmsConfig, platformConfig } from "./sms-config";

export interface SendSmsOptions {
  to: string;
  message: string;
  /** "transactional" (default) — account/policy notices. "promotional" for marketing-style
   *  broadcasts. Some vendors (Africala included) require this to route correctly / avoid
   *  regulatory filtering — never send account notifications as "promotional". */
  kind?: "transactional" | "promotional" | "otp";
  /** Dial code (digits only, no "+") to prepend when `to` is in local "0…" format. Resolved by
   *  the caller from the recipient's country (org home vs. cross-border — see
   *  country_flag_settings). Falls back to SMS_DEFAULT_COUNTRY_CODE / "263" when omitted. */
  countryCode?: string;
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
 * Normalize a recipient number to bare international digits. Thin wrapper over
 * server/phone.ts's normalizeMsisdn — kept as a named export for the existing call sites/tests.
 * `defaultCountryCode` is the per-recipient dial code the caller resolved (org home vs.
 * cross-border); when omitted it falls back to SMS_DEFAULT_COUNTRY_CODE / "263".
 */
export function normalizePhoneForSms(raw: string, defaultCountryCode?: string): string {
  return normalizeMsisdn(raw, defaultCountryCode);
}

// GSM 03.38 default alphabet + extension table. A message using only these characters sends as
// plain GSM-7 (Africala messageEncoding "0", ~160 chars/segment); anything outside it (emoji,
// curly quotes, accented letters beyond the set) needs Unicode ("1", ~70 chars/segment and a
// higher per-segment cost). Africala's own sample payload uses "0" for a plain-English message —
// hardcoding "1" doubled the cost of every notification.
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€";
export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENSION.includes(ch)) return false;
  }
  return true;
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
    const destinationAddress = normalizePhoneForSms(opts.to, opts.countryCode);

    try {
      const res = await fetch("https://api2.smsala.com/SendSmsV2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify([{
          apiToken,
          messageType,
          messageEncoding: isGsm7(opts.message) ? "0" : "1",
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
