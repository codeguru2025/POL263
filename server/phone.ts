/**
 * Phone-number normalization for outbound messaging APIs (SMS, WhatsApp), which want bare
 * international digits — no "+", spaces, or punctuation.
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
