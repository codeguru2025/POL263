/**
 * Helpers for outbound messaging APIs (SMS, WhatsApp): recipient-number normalization
 * (normalizeMsisdn) and message-encoding detection (isGsm7). No database or app dependencies —
 * safe to import from one-off scripts.
 *
 * normalizeMsisdn normalizes a phone number to bare international digits — no "+", spaces, or
 * punctuation.
 *
 * Rules, applied in order:
 *   - "+27821234567"      → already international            → "27821234567"
 *   - "0027821234567"     → 00 international access code     → "27821234567"
 *   - "0821234567"        → local format (single leading 0)  → "<countryCode>821234567"
 *   - "27821234567"       → no leading 0, no "+"; assumed to already carry a country code → unchanged
 *
 * The country code for the local-format case is resolved by the CALLER and passed in, because a
 * single global default misdelivers a cross-border tenant's clients (Falakhe has both Zimbabwean
 * and South African clients — see country_flag_settings.home_country_code / flag_country_code and
 * server/notifications.ts). Fallback order when no code is passed: SMS_DEFAULT_COUNTRY_CODE env,
 * then "263" (Zimbabwe — the value hardcoded before this was configurable).
 */
export function normalizeMsisdn(raw: string, defaultCountryCode?: string): string {
  const trimmed = String(raw || "").trim();
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");

  if (hasPlus) return digits;
  if (digits.startsWith("00")) return digits.slice(2);

  const code = (defaultCountryCode || process.env.SMS_DEFAULT_COUNTRY_CODE || "263").replace(/\D/g, "");
  // Length guard: a genuine local mobile number is a leading 0 plus 9 digits. Anything longer
  // that still starts with a single 0 is more likely a mistyped/already-prefixed number, so
  // leave it alone rather than corrupt it.
  if (digits.startsWith("0") && digits.length <= 11) return code + digits.slice(1);

  return digits;
}

// GSM 03.38 default alphabet + extension table. A message using only these characters sends as
// plain GSM-7 (Africala messageEncoding "0", ~160 chars/segment); anything outside it — emoji,
// smart quotes, en/em dashes, non-Latin scripts — needs Unicode ("1", ~70 chars/segment and a
// higher per-segment cost). Africala's own sample payload uses "0" for plain English; hardcoding
// "1" doubled the cost of every notification.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅå" +
  "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
  " !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
  "¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€\f";

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENSION.includes(ch)) return false;
  }
  return true;
}
