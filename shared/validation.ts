/**
 * Shared validation and normalization for client capture.
 * - National ID: digits + one check letter + two digits (e.g. 08833089H38). No limit on digits before the letter.
 * - All text fields stored uppercase.
 */

export const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;

// ─── Org-configurable National ID format ──────────────────────────────────
// A curated catalog of known national-ID shapes an org picks from in Settings, rather than a
// free-text regex an admin could author themselves (avoids ReDoS/correctness risk from untrusted
// patterns). "zimbabwe" is the original hardcoded shape and is the default for every org that
// existed before this was configurable (see organizations.nationalIdFormat in shared/schema.ts) —
// picking it keeps validation byte-identical to before this catalog existed. "none" lets a tenant
// in a country not yet in this list capture a free-text identifier with no shape enforcement.
export const NATIONAL_ID_FORMATS = {
  zimbabwe: { label: "Zimbabwe (digits + letter + 2 digits)", regex: NATIONAL_ID_REGEX, example: "08833089H38" },
  south_africa: { label: "South Africa (13 digits)", regex: /^\d{13}$/, example: "8001015009087" },
  none: { label: "No format enforcement", regex: null, example: null },
} as const satisfies Record<string, { label: string; regex: RegExp | null; example: string | null }>;

export type NationalIdFormatKey = keyof typeof NATIONAL_ID_FORMATS;

export const NATIONAL_ID_FORMAT_KEYS = Object.keys(NATIONAL_ID_FORMATS) as NationalIdFormatKey[];

export const DEFAULT_NATIONAL_ID_FORMAT: NationalIdFormatKey = "zimbabwe";

export function isNationalIdFormatKey(value: string | null | undefined): value is NationalIdFormatKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NATIONAL_ID_FORMATS, value);
}

/** User-facing fragment describing what's expected for a format, e.g. "must match this
 *  organization's configured format (e.g. 08833089H38)" or "is invalid" for "none"/unknown
 *  (which should never actually fail validation, since "none" has no regex to fail). */
export function nationalIdFormatHint(formatKey: NationalIdFormatKey | string | null | undefined): string {
  const format = isNationalIdFormatKey(formatKey) ? NATIONAL_ID_FORMATS[formatKey] : NATIONAL_ID_FORMATS[DEFAULT_NATIONAL_ID_FORMAT];
  return format.example ? `must match this organization's configured format (e.g. ${format.example})` : "is invalid";
}

// ─── Multi-Currency Support ───────────────────────────────
// Platform-wide curated currency catalog — not the full ~180-entry ISO 4217 list, a moderate set
// (~15-20) covering Southern/East Africa plus a few major internationals: the plausible target
// markets for this platform's tenants. This is the UNIVERSE of currency codes the platform knows
// about at all — distinct from an org's `enabledCurrencies` (organizations.enabledCurrencies in
// shared/schema.ts), which is the SUBSET of this catalog one specific tenant has actually turned
// on for its own pickers (see client/src/components/currency-select.tsx). `SUPPORTED_CURRENCIES`
// is kept as the pre-existing exported name (now derived from this catalog's keys) so every import
// that already existed before this catalog keeps working unchanged; it still means "any code the
// platform accepts," never "this org's chosen subset" — callers that need the org-scoped subset
// should use `normalizeEnabledCurrencies` / `organizations.enabledCurrencies` instead.
// Deliberately excludes "ZWL" (the pre-2024 Zimbabwean Dollar) as a selectable catalog entry:
// it's handled purely as a legacy alias that normalizes straight to ZIG (see normalizeCurrency
// below), not as a distinct currency an org could enable — Zimbabwe's currency was redenominated,
// so old ZWL-tagged historical records should read as today's ZIG, never as a live, pickable
// currency in its own right.
export const CURRENCY_CATALOG = {
  USD: { symbol: "$", name: "US Dollar", locale: "en-US" },
  ZAR: { symbol: "R", name: "South African Rand", locale: "en-ZA" },
  ZIG: { symbol: "ZiG", name: "Zimbabwe Gold", locale: "en-ZW" },
  BWP: { symbol: "P", name: "Botswana Pula", locale: "en-BW" },
  ZMW: { symbol: "K", name: "Zambian Kwacha", locale: "en-ZM" },
  MZN: { symbol: "MT", name: "Mozambican Metical", locale: "pt-MZ" },
  MWK: { symbol: "MK", name: "Malawian Kwacha", locale: "en-MW" },
  NAD: { symbol: "N$", name: "Namibian Dollar", locale: "en-NA" },
  LSL: { symbol: "L", name: "Lesotho Loti", locale: "en-LS" },
  SZL: { symbol: "E", name: "Eswatini Lilangeni", locale: "en-SZ" },
  KES: { symbol: "KSh", name: "Kenyan Shilling", locale: "en-KE" },
  TZS: { symbol: "TSh", name: "Tanzanian Shilling", locale: "en-TZ" },
  UGX: { symbol: "USh", name: "Ugandan Shilling", locale: "en-UG" },
  GBP: { symbol: "£", name: "British Pound", locale: "en-GB" },
  EUR: { symbol: "€", name: "Euro", locale: "en-IE" },
} as const satisfies Record<string, { symbol: string; name: string; locale: string }>;

export const SUPPORTED_CURRENCIES = Object.keys(CURRENCY_CATALOG) as (keyof typeof CURRENCY_CATALOG)[];
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

/** Pre-existing exported name, kept as an alias to CURRENCY_CATALOG so every existing import
 *  (symbol/name/locale lookups) keeps working unchanged. */
export const CURRENCY_CONFIG: Record<SupportedCurrency, { symbol: string; name: string; locale: string }> = CURRENCY_CATALOG;

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return typeof value === "string" && (SUPPORTED_CURRENCIES as string[]).includes(value);
}

export function normalizeCurrency(value: string | null | undefined): SupportedCurrency {
  if (!value) return "USD";
  const upper = value.trim().toUpperCase();
  if (isSupportedCurrency(upper)) return upper;
  if (upper === "ZWL" || upper === "RTGS") return "ZIG";
  return "USD";
}

// ─── Org-configurable enabled currencies ──────────────────────────────────
// Which CURRENCY_CATALOG keys a given org has actually turned on (organizations.enabledCurrencies
// in shared/schema.ts) — a subset an org picks in Settings, analogous in shape to
// NATIONAL_ID_FORMATS above except an org can enable MULTIPLE entries here, not just one.
export const DEFAULT_ENABLED_CURRENCIES: SupportedCurrency[] = ["USD", "ZAR", "ZIG"];

/** Normalizes a stored/incoming `enabledCurrencies` value to a de-duplicated list of known catalog
 *  keys, falling back to DEFAULT_ENABLED_CURRENCIES when the value is missing, not an array, or
 *  ends up empty after filtering out unrecognized entries — an org must never end up with zero
 *  selectable currencies (would make every currency-picker in the app unusable). */
export function normalizeEnabledCurrencies(value: unknown): SupportedCurrency[] {
  if (!Array.isArray(value)) return DEFAULT_ENABLED_CURRENCIES;
  const valid = Array.from(new Set(value.filter((v): v is SupportedCurrency => isSupportedCurrency(v))));
  return valid.length > 0 ? valid : DEFAULT_ENABLED_CURRENCIES;
}

export function currencySymbol(currency: string | null | undefined): string {
  const c = normalizeCurrency(currency);
  return CURRENCY_CONFIG[c].symbol;
}

export function formatAmount(amount: number | string, currency?: string | null): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "—";
  const c = normalizeCurrency(currency);
  const { symbol } = CURRENCY_CONFIG[c];
  return `${symbol}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAmountWithCode(amount: number | string, currency?: string | null): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return "—";
  const c = normalizeCurrency(currency);
  return `${c} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Parse and validate a monetary amount from untrusted input (request body).
 * Returns a number rounded to 2 decimals when the value is a positive, finite
 * amount within a sane ceiling; otherwise returns null so callers can reject.
 * Guards against negatives, zero, NaN, Infinity, non-numeric strings and
 * absurdly large values (overflow / fat-finger).
 */
export const MAX_TRANSACTION_AMOUNT = 100_000_000; // 100M — well above any real premium/claim

export function parsePositiveAmount(value: unknown): number | null {
  const num = typeof value === "string" ? parseFloat(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(num)) return null;
  if (num <= 0) return null;
  if (num > MAX_TRANSACTION_AMOUNT) return null;
  return Math.round(num * 100) / 100;
}

export function normalizeNationalId(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

/** Returns true if value matches the given org's configured national ID format (after normalizing
 *  to uppercase). Defaults to the "zimbabwe" shape (digits + one letter + two digits) when no
 *  format is given, so every existing call site that doesn't pass one keeps identical behavior.
 *  A format of "none" (no shape enforcement) accepts any non-empty normalized value. */
export function isValidNationalId(
  value: string | null | undefined,
  formatKey: NationalIdFormatKey | string | null | undefined = DEFAULT_NATIONAL_ID_FORMAT,
): boolean {
  const n = normalizeNationalId(value);
  if (n === null) return false;
  const format = isNationalIdFormatKey(formatKey) ? NATIONAL_ID_FORMATS[formatKey] : NATIONAL_ID_FORMATS[DEFAULT_NATIONAL_ID_FORMAT];
  return format.regex === null ? true : format.regex.test(n);
}

/** Normalize string for storage: uppercase, trimmed. Empty string becomes null if allowEmpty is false. */
export function toUpperTrim(value: string | null | undefined, allowEmpty = false): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  return allowEmpty || s.length > 0 ? s : null;
}

/** Converts Drizzle numeric string columns to a finite number, defaulting to 0 on NaN/null. */
export function toDecimalNumber(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

export const MIN_PASSWORD_LENGTH = 12;

/**
 * Password policy applied to every set/change/reset path (staff, agent, client): a length floor
 * plus a minimal complexity requirement (at least one letter and one digit) to rule out the
 * weakest common choices, without a breach-list check (would need an outbound third-party call).
 * Returns null when valid, or a user-facing message when not — callers just check truthiness.
 */
export function validatePasswordPolicy(password: string | null | undefined): string | null {
  const pw = password ?? "";
  if (pw.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) {
    return "Password must include at least one letter and one number";
  }
  return null;
}
