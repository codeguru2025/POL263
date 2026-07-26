/** Reads a currency-suffixed field off a product version, e.g. currencyField(pv, "ZIG",
 *  "premiumMonthly") reads pv.premiumMonthlyZig. Defaults to the USD field for any currency
 *  other than ZAR/ZIG, matching this codebase's existing "USD is the fallback" convention.
 *
 *  Deliberately dependency-free (no imports) — server/route-helpers.ts and
 *  server/hospital-cash-claims.ts both need this, and route-helpers.ts pulls in ./storage ->
 *  ./db (which throws if DATABASE_URL isn't set) as a side effect of being in the same module as
 *  the rest of its exports. Importing currencyField from there would drag that requirement into
 *  hospital-cash-claims.ts's unit tests, which otherwise need no live database at all. */
export function currencyField(record: any, currency: string, baseField: string): number {
  const suffix = currency === "ZAR" ? "Zar" : currency === "ZIG" ? "Zig" : "Usd";
  const raw = record?.[`${baseField}${suffix}`];
  return raw == null ? 0 : parseFloat(String(raw));
}
