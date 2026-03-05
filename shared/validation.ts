/**
 * Shared validation and normalization for client capture.
 * - National ID: digits + one check letter + two digits (e.g. 08833089H38). No limit on digits before the letter.
 * - All text fields stored uppercase.
 */

export const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;

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
