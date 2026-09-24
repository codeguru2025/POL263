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
import { ipv4Dispatcher, normalizeMsisdn } from "./phone";
import { getOrgSmsConfig, platformConfig } from "./sms-config";
import { notifyUsersWithPermission } from "./user-notifications";
import { countSmsSegments, reserveSmsCredits, refundSmsCredits } from "./sms-allocation";
import { storage } from "./storage";

export interface SendSmsOptions {
  to: string;
  message: string;
  /** "transactional" (default) — account/policy notices. "promotional" for marketing-style
   *  broadcasts. Some vendors (Africala included) require this to route correctly / avoid
   *  regulatory filtering — never send account notifications as "promotional". */
  kind?: "transactional" | "promotional" | "otp";
  /** Dial code (digits only, no "+") to prepend when `to` is in local "0..." format. Resolved by
   *  the caller from the recipient's country (org home vs. cross-border — see
   *  country_flag_settings). Falls back to SMS_DEFAULT_COUNTRY_CODE / "263" when omitted. */
  countryCode?: string;
  /** Recorded on the sms_messages log row (the tenant's SMS usage report). */
  meta?: {
    source?: "notification" | "test" | "mfa" | "broadcast" | "other";
    eventType?: string | null;
    clientId?: string | null;
    notificationLogId?: string | null;
    sentByUserId?: string | null;
  };
}

/** Credentials resolved for a specific org — never read from process.env inside a provider. */
export interface SmsProviderCredentials {
  apiToken: string;
  senderId: string;
}

/** Account-level failures — they affect every message, not one recipient, so staff need telling. */
export type SmsAccountIssue = "credit" | "token" | "ip";

export interface SmsSendResult {
  ok: boolean;
  message: string;
  providerMessageId?: string;
  accountIssue?: SmsAccountIssue;
  /** A temporary condition (provider down, sending paused, allowance used up) — worth retrying
   *  later. false/undefined for a per-recipient rejection that will fail the same way again. */
  retryable?: boolean;
  /** Refused before reaching the provider (allowance used up / couldn't be checked). */
  blocked?: boolean;
}

export interface SmsProvider {
  readonly name: string;
  isConfigured(creds: SmsProviderCredentials): boolean;
  send(creds: SmsProviderCredentials, opts: SendSmsOptions): Promise<SmsSendResult>;
}

// ── Circuit breaker ─────────────────────────────────────────────────────────
// The daily notification sweeps send one message at a time and await each. If the provider is
// down (each call can wait the full 20s timeout) or the account is broken (bad token / no credit /
// IP not allowed — every message will fail identically), a sweep over thousands of clients would
// run for hours and log thousands of identical failures. After CIRCUIT_THRESHOLD consecutive
// account-level/network failures for a token, further sends fail instantly for a cooldown, then
// one probe goes through. Per-recipient rejections (bad number etc.) don't count.
const CIRCUIT_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60_000;
const circuits = new Map<string, { fails: number; openUntil: number }>();

function circuitIsOpen(key: string): boolean {
  const c = circuits.get(key);
  return !!c && c.openUntil > Date.now();
}
function circuitFailure(key: string): void {
  const c = circuits.get(key) ?? { fails: 0, openUntil: 0 };
  c.fails++;
  if (c.fails >= CIRCUIT_THRESHOLD) {
    c.openUntil = Date.now() + CIRCUIT_COOLDOWN_MS;
    c.fails = 0;
  }
  circuits.set(key, c);
}
function circuitOk(key: string): void {
  circuits.delete(key);
}

// ── Staff alert for account-level failures ──────────────────────────────────
const ACCOUNT_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastAccountAlert = new Map<string, number>(); // per instance — worst case one alert per instance per interval
const ISSUE_ALERT: Record<SmsAccountIssue, { title: string; body: string }> = {
  credit: {
    title: "SMS is not sending — out of credit",
    body: "The SMS provider account has no credit left, so text messages are not being sent. Please top up the SMSala balance.",
  },
  token: {
    title: "SMS is not sending — invalid API token",
    body: "The SMS provider rejected the saved API token. Open Settings → SMS and enter the current token from SMSala.",
  },
  ip: {
    title: "SMS is not sending — server not allowed",
    body: "The SMS provider does not recognise this server's address. Add the platform's outgoing IP addresses to the API token's allowed IP list on the SMSala panel.",
  },
};
function alertAccountIssue(orgId: string, issue: SmsAccountIssue): void {
  const key = `${orgId}:${issue}`;
  const last = lastAccountAlert.get(key) ?? 0;
  if (Date.now() - last < ACCOUNT_ALERT_INTERVAL_MS) return;
  lastAccountAlert.set(key, Date.now());
  // notifyUsersWithPermission never throws; not awaited so a slow inbox write can't delay a send.
  void notifyUsersWithPermission(orgId, "manage:settings", { type: "GENERAL", ...ISSUE_ALERT[issue], metadata: { sms: issue } });
}

/** Test hook — clears breaker + alert-throttle state between cases. */
export function resetSmsHealthState(): void {
  circuits.clear();
  lastAccountAlert.clear();
}

/** SMSala OperationCodes that mean the ACCOUNT is unusable (not one bad recipient):
 *  -1 "Invalid Api Token", -2 "Insufficient Credit Balance", -3 "Ip Address Not Allowed". */
const AFRICALA_ACCOUNT_CODES: Record<number, SmsAccountIssue> = { [-1]: "token", [-2]: "credit", [-3]: "ip" };

/**
 * Normalize a recipient number to bare international digits. Thin wrapper over
 * server/phone.ts's normalizeMsisdn — kept as a named export for the existing call sites/tests.
 * `defaultCountryCode` is the per-recipient dial code the caller resolved (org home vs.
 * cross-border); when omitted it falls back to SMS_DEFAULT_COUNTRY_CODE / "263".
 */
export function normalizePhoneForSms(raw: string, defaultCountryCode?: string): string {
  return normalizeMsisdn(raw, defaultCountryCode);
}

/** Sender IDs SMSala has routed OTP-only — every message must carry messageType=3. Extend via
 *  SMS_OTP_ONLY_SENDERS (comma-separated) when another tenant's sender is set up the same way. */
export function isOtpOnlySender(senderId: string): boolean {
  const list = ["FALAKHE", ...(process.env.SMS_OTP_ONLY_SENDERS || "").split(",")]
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  return list.includes(senderId.trim().toUpperCase());
}

class AfricalaProvider implements SmsProvider {
  readonly name = "africala";

  isConfigured(creds: SmsProviderCredentials): boolean {
    return !!(creds.apiToken && creds.senderId);
  }

  async send(creds: SmsProviderCredentials, opts: SendSmsOptions): Promise<SmsSendResult> {
    const apiToken = creds.apiToken;
    const sourceAddress = creds.senderId;
    if (!apiToken || !sourceAddress) {
      return { ok: false, message: "Africala is not configured for this organization. Set an API token and Sender ID in Settings." };
    }

    // messageType 1=Promotional, 2=Transactional, 3=OTP. Some Sender IDs are provisioned on an
    // OTP-only route (SMSala: "FALAKHE" must always send messageType=3), so those override `kind`.
    // messageEncoding: SMSala's live panel dropdown maps 0=Default, 1=ASCII, 2=Octets, 3=Latin1,
    // 8=UCS2 (the numbering in their PDF's encoding table is off by one). "0" (Default) lets the
    // gateway auto-pick the on-wire encoding — this matches the sample Africala support sent.
    const messageType = isOtpOnlySender(sourceAddress)
      ? "3"
      : opts.kind === "promotional" ? "1" : opts.kind === "otp" ? "3" : "2";
    const messageEncoding = "0";
    const destinationAddress = normalizePhoneForSms(opts.to, opts.countryCode);

    if (circuitIsOpen(apiToken)) {
      return { ok: false, message: "SMS is paused for about a minute after repeated provider errors — it will retry automatically.", retryable: true };
    }

    try {
      const res = await fetch("https://api2.smsala.com/SendSmsV2", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify([{
          apiToken,
          messageType,
          messageEncoding,
          destinationAddress,
          sourceAddress,
          messageText: opts.message,
        }]),
        // Force IPv4 — DO App Platform egress is IPv4-only and an IPv6 attempt hangs to timeout.
        dispatcher: ipv4Dispatcher,
        // Belt-and-braces: never let a stuck connection hang the request past the gateway timeout.
        signal: AbortSignal.timeout(20_000),
      } as any);

      const body = await res.json().catch(() => null);
      const first = Array.isArray(body) ? body[0] : null;

      if (!res.ok || !first) {
        structuredLog("error", "Africala SMS send failed — bad response", { status: res.status, body });
        circuitFailure(apiToken);
        return { ok: false, message: `Africala SMS failed: HTTP ${res.status}`, retryable: true };
      }
      // OperationCode 0 = success per Africala's docs; anything else (or a non-"Success" Status)
      // is a per-recipient failure that still comes back as HTTP 200, so status must be checked
      // in the body, not just the HTTP status code.
      if (first.OperationCode !== 0 || first.Status !== "Success") {
        structuredLog("error", "Africala SMS send failed — provider rejected", { destinationAddress, response: first });
        const accountIssue = AFRICALA_ACCOUNT_CODES[first.OperationCode as number];
        if (accountIssue) circuitFailure(apiToken);
        else circuitOk(apiToken); // reachable and authenticated — this was just a bad recipient/message
        return { ok: false, message: `Africala SMS failed: ${first.Remarks || first.Status || "unknown error"}`, accountIssue, retryable: !!accountIssue };
      }

      circuitOk(apiToken);
      structuredLog("info", "SMS sent via Africala", { to: destinationAddress, messageId: first.MessageId });
      return { ok: true, message: `SMS sent to ${destinationAddress}`, providerMessageId: String(first.MessageId) };
    } catch (err: any) {
      structuredLog("error", "Africala SMS send threw", { error: err?.message, to: destinationAddress });
      circuitFailure(apiToken);
      return { ok: false, message: `Africala SMS failed: ${err?.message || "network error"}`, retryable: true };
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
export async function sendSms(orgId: string, opts: SendSmsOptions): Promise<SmsSendResult> {
  const provider = getProvider();
  if (!provider) {
    return { ok: false, message: `SMS provider "${process.env.SMS_PROVIDER || "africala"}" is not recognized.` };
  }
  const creds = await getOrgSmsConfig(orgId);
  if (!provider.isConfigured(creds)) {
    return { ok: false, message: `SMS is not configured for provider "${provider.name}" for this organization. Set an API token and Sender ID in Settings.` };
  }

  // Deduct from the platform-granted allowance BEFORE sending (atomic — see sms-allocation.ts),
  // refund if the provider then rejects it. One-time login codes may overdraw rather than lock a
  // user out. If the allowance can't be checked at all, fail closed for everything except OTPs.
  const segments = countSmsSegments(opts.message);
  let reservation: Awaited<ReturnType<typeof reserveSmsCredits>>;
  try {
    reservation = await reserveSmsCredits(orgId, segments, { allowOverdraft: opts.kind === "otp" });
  } catch (err: any) {
    structuredLog("error", "SMS allowance check failed", { orgId, error: err?.message });
    reservation = opts.kind === "otp"
      ? { ok: true, metered: false, charged: 0 }
      : { ok: false, metered: true, charged: 0, reason: "Not sent — the SMS allowance couldn't be checked just now. It will be retried automatically." };
  }
  const recipient = normalizePhoneForSms(opts.to, opts.countryCode);

  if (!reservation.ok) {
    const blocked: SmsSendResult = { ok: false, message: reservation.reason || "Not sent — SMS allowance used up.", retryable: true, blocked: true };
    await recordSmsMessage(orgId, opts, recipient, segments, 0, "blocked", blocked.message);
    return blocked;
  }

  const result = await provider.send(creds, opts);
  if (result.accountIssue) alertAccountIssue(orgId, result.accountIssue);
  if (!result.ok && reservation.charged > 0) {
    await refundSmsCredits(orgId, reservation.charged).catch((err) =>
      structuredLog("error", "SMS credit refund failed", { orgId, credits: reservation.charged, error: err?.message }));
  }
  await recordSmsMessage(orgId, opts, recipient, segments, result.ok ? reservation.charged : 0,
    result.ok ? "sent" : "failed", result.ok ? null : result.message, result.providerMessageId);
  return result;
}

/** Masks every run of 4+ digits (the code) in a one-time-code message. */
export function redactOtp(message: string): string {
  return String(message ?? "").replace(/\d{4,}/g, (m) => "•".repeat(m.length));
}

/** Best-effort write to the tenant's sms_messages log — a logging failure never fails a send. */
async function recordSmsMessage(
  orgId: string, opts: SendSmsOptions, recipient: string, segments: number, creditsCharged: number,
  status: "sent" | "failed" | "blocked", failureReason: string | null, providerMessageId?: string,
): Promise<void> {
  try {
    await storage.createSmsMessage(orgId, {
      recipient,
      clientId: opts.meta?.clientId ?? null,
      // One-time codes are credentials: never persist them in a log admins can read/download.
      message: opts.kind === "otp" ? redactOtp(opts.message) : opts.message,
      segments,
      creditsCharged,
      kind: opts.kind ?? "transactional",
      source: opts.meta?.source ?? "other",
      eventType: opts.meta?.eventType ?? null,
      status,
      failureReason,
      providerMessageId: providerMessageId ?? null,
      notificationLogId: opts.meta?.notificationLogId ?? null,
      sentByUserId: opts.meta?.sentByUserId ?? null,
    });
  } catch (err: any) {
    structuredLog("error", "Failed to record SMS message log row", { orgId, error: err?.message });
  }
}

/**
 * Sends using only the platform-level fallback credentials, bypassing per-org resolution
 * entirely. For platform-owner accounts, which have no organizationId to resolve a tenant's own
 * SMS config from — currently only used by the staff MFA SMS-fallback flow (server/auth.ts).
 */
export async function sendPlatformSms(opts: SendSmsOptions): Promise<SmsSendResult> {
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
