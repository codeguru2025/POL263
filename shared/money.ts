/**
 * Exact money arithmetic.
 *
 * JavaScript numbers are binary floats, so decimal amounts drift:
 * 0.1 + 0.2 === 0.30000000000000004, and summing hundreds of receipts can
 * leave a balance off by a cent (or show "owes 0.00" when it owes 0.004).
 *
 * Rule: never add, subtract or compare money as floats. Convert to integer
 * minor units (cents) with `toCents`, do integer maths, convert back with
 * `fromCents` (a "123.45" string, ready for a Postgres `numeric` column) or
 * `centsToNumber` (for JSON/API responses that already expect numbers).
 *
 * Integers are exact in JS up to 2^53 (~90 trillion dollars in cents), far
 * above MAX_TRANSACTION_AMOUNT, so no big-number library is needed.
 *
 * Rounding is half-up away from zero ("commercial" rounding), which is what
 * receipts, premiums and statements are expected to show.
 */

export type Cents = number;

const PLAIN_DECIMAL = /^\s*([+-])?(\d*)(?:\.(\d*))?\s*$/;

/** Parse a decimal string exactly into cents (half-up at the 3rd decimal). */
function parseDecimalString(s: string): Cents | null {
  const m = PLAIN_DECIMAL.exec(s);
  if (!m) return null;
  const [, sign, intPart = "", fracPart = ""] = m;
  if (intPart === "" && fracPart === "") return null;
  const whole = intPart === "" ? 0 : Number(intPart);
  const frac2 = Number((fracPart + "00").slice(0, 2));
  const roundUp = fracPart.length > 2 && fracPart.charCodeAt(2) >= 53; /* '5' */
  const abs = whole * 100 + frac2 + (roundUp ? 1 : 0);
  if (!Number.isSafeInteger(abs)) return null;
  return sign === "-" && abs !== 0 ? -abs : abs;
}

/**
 * Convert any money-ish value (numeric column string, number, null) to cents.
 * Invalid / empty values become 0 — use `tryToCents` when you must reject them.
 */
export function toCents(value: unknown): Cents {
  return tryToCents(value) ?? 0;
}

/** Like `toCents` but returns null for missing or non-numeric input. */
export function tryToCents(value: unknown): Cents | null {
  if (value == null) return null;
  if (typeof value === "bigint") return Number(value) * 100;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    // Collapse float noise (0.30000000000000004 → "0.3") before exact parsing.
    return parseDecimalString(numberToPlainString(value));
  }
  const s = String(value);
  const exact = parseDecimalString(s);
  if (exact != null) return exact;
  // Scientific notation or other forms Number() accepts ("1e3").
  const n = Number(s);
  return Number.isFinite(n) && s.trim() !== "" ? parseDecimalString(numberToPlainString(n)) : null;
}

function numberToPlainString(n: number): string {
  const p = Number(n.toPrecision(15));
  // toFixed(10) avoids exponent notation for tiny/huge magnitudes we care about.
  return Math.abs(p) < 1e-6 ? "0" : p.toFixed(10);
}

/** Cents → "123.45" (always two decimals; for numeric columns and display). */
export function fromCents(cents: Cents): string {
  const c = Math.round(cents);
  const neg = c < 0;
  const abs = Math.abs(c);
  const s = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${s}` : s;
}

/** Cents → number with exactly two decimals of meaning (for JSON responses). */
export function centsToNumber(cents: Cents): number {
  return Math.round(cents) / 100;
}

/** Round any money value to 2dp exactly, returned as a number. */
export function roundMoney(value: unknown): number {
  return centsToNumber(toCents(value));
}

/** Normalise any money value to a "123.45" string. */
export function moneyString(value: unknown): string {
  return fromCents(toCents(value));
}

/** Exact sum of money values, returned in cents. */
export function sumCents(values: Iterable<unknown>): Cents {
  let total = 0;
  for (const v of Array.from(values)) total += toCents(v);
  return total;
}

/** Exact sum of money values, returned as a 2dp number. */
export function sumMoney(values: Iterable<unknown>): number {
  return centsToNumber(sumCents(values));
}

/** a + b + ... exactly, as a 2dp number. */
export function addMoney(...values: unknown[]): number {
  return sumMoney(values);
}

/** a - b exactly, as a 2dp number. */
export function subMoney(a: unknown, b: unknown): number {
  return centsToNumber(toCents(a) - toCents(b));
}

/** Multiply cents by a (possibly fractional) factor, rounding half-up once. */
export function mulCents(cents: Cents, factor: number): Cents {
  const raw = cents * factor;
  // Nudge by a tiny epsilon relative to magnitude so 2.5 → 3 despite float noise.
  const nudged = Number(raw.toPrecision(15));
  return nudged < 0 ? -Math.round(-nudged) : Math.round(nudged);
}

/** amount × factor, as a 2dp number (e.g. premium × months). */
export function mulMoney(amount: unknown, factor: number): number {
  return centsToNumber(mulCents(toCents(amount), factor));
}

/** `percent`% of amount (e.g. platform fee rate), as a 2dp number. */
export function percentOf(amount: unknown, percent: number): number {
  return centsToNumber(mulCents(toCents(amount), percent / 100));
}

/** Compare two money values exactly: negative, 0 or positive. */
export function compareMoney(a: unknown, b: unknown): number {
  return toCents(a) - toCents(b);
}

/** True when two money values are equal to the cent. */
export function moneyEquals(a: unknown, b: unknown): boolean {
  return toCents(a) === toCents(b);
}

/**
 * Allocate `total` cents across `weights` pro rata, so the shares always sum
 * exactly to `total` (largest-remainder method: each share is floored, then the
 * leftover cents go to the shares with the biggest fractional parts). When all
 * weights are zero the total is split equally. Use this instead of rounding
 * each `total * w / Σw` separately, which can gain or lose a cent overall.
 */
export function allocateProRata(total: Cents, weights: readonly number[]): Cents[] {
  const n = weights.length;
  if (n === 0) return [];
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0));
  const sumW = clean.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return splitCents(total, n);
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const exact = clean.map((w) => (abs * w) / sumW);
  const shares = exact.map((x) => Math.floor(x));
  let leftover = abs - shares.reduce((a, b) => a + b, 0);
  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; leftover > 0; k = (k + 1) % n, leftover--) shares[order[k].i] += 1;
  return shares.map((s) => s * sign);
}

/**
 * Split `total` into `parts` shares that sum exactly to `total`
 * (remainder cents go to the first shares). Use for pro-rata allocation.
 */
export function splitCents(total: Cents, parts: number): Cents[] {
  if (parts <= 0) return [];
  const base = Math.trunc(total / parts);
  let rem = total - base * parts;
  const step = rem < 0 ? -1 : 1;
  return Array.from({ length: parts }, () => {
    if (rem === 0) return base;
    rem -= step;
    return base + step;
  });
}
