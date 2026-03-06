/**
 * Shared validation and normalization for client capture.
 * - National ID: digits + one check letter + two digits (e.g. 08833089H38). No limit on digits before the letter.
 * - All text fields stored uppercase.
 */

export const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;

// ─── Multi-Currency Support ───────────────────────────────

export const SUPPORTED_CURRENCIES = ["USD", "ZAR", "ZIG"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_CONFIG: Record<SupportedCurrency, { symbol: string; name: string; locale: string }> = {
  USD: { symbol: "$", name: "US Dollar", locale: "en-US" },
  ZAR: { symbol: "R", name: "South African Rand", locale: "en-ZA" },
  ZIG: { symbol: "ZiG", name: "Zimbabwe Gold", locale: "en-ZW" },
};

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return typeof value === "string" && SUPPORTED_CURRENCIES.includes(value as SupportedCurrency);
}

export function normalizeCurrency(value: string | null | undefined): SupportedCurrency {
  if (!value) return "USD";
  const upper = value.trim().toUpperCase();
  if (isSupportedCurrency(upper)) return upper;
  if (upper === "ZWL" || upper === "RTGS") return "ZIG";
  return "USD";
}

export function currencySymbol(currency: string | null | undefined): string {
  const c = normalizeCurrency(currency);
  return CURRENCY_CONFIG[c].symbol;
}

export function formatAmount(amount: number | string, currency?: string | null): string {
  const num = typeof amount === "string" ? parseFloat(amount) || 0 : amount;
  const c = normalizeCurrency(currency);
  const { symbol } = CURRENCY_CONFIG[c];
  return `${symbol}${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatAmountWithCode(amount: number | string, currency?: string | null): string {
  const num = typeof amount === "string" ? parseFloat(amount) || 0 : amount;
  const c = normalizeCurrency(currency);
  return `${c} ${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function normalizeNationalId(value: string | null | undefined): string | null {
  if (value == null || typeof value !== "string") return null;
  const trimmed = value.trim().toUpperCase();
  return trimmed || null;
}

/** Returns true if value matches digits + one letter + two digits (after normalizing to uppercase). */
export function isValidNationalId(value: string | null | undefined): boolean {
  const n = normalizeNationalId(value);
  return n !== null && NATIONAL_ID_REGEX.test(n);
}

/** Normalize string for storage: uppercase, trimmed. Empty string becomes null if allowEmpty is false. */
export function toUpperTrim(value: string | null | undefined, allowEmpty = false): string | null {
  if (value == null) return null;
  const s = String(value).trim().toUpperCase();
  return allowEmpty || s.length > 0 ? s : null;
}
