/**
 * Policy overview report (Reports → Policies → Policy overview): turns the grouped
 * status × currency × schedule rows from storage.getPolicyStatusSummary into the report's tiles.
 * Pure — no DB — so it's unit-testable on its own.
 */
import { POLICY_STATUSES } from "@shared/schema";
import { toCents, mulCents, fromCents, type Cents } from "@shared/money";

/** How many months one payment of this schedule covers (weekly → 12/52 of a month, yearly → 12). */
export function monthlyToScheduleFactor(paymentSchedule: string): number {
  if (paymentSchedule === "weekly") return 12 / 52;
  if (paymentSchedule === "biweekly") return 12 / 26;
  if (paymentSchedule === "quarterly") return 3;
  // "yearly" is the value actually used elsewhere (policies.paymentSchedule, cycleDays() in
  // policy-status-on-payment.ts) — "annually" was never a real value anywhere else, so it
  // silently fell through to the factor-of-1 default, undercharging a yearly surcharge by 12x.
  if (paymentSchedule === "yearly" || paymentSchedule === "annually") return 12;
  return 1;
}

/** Statuses whose premium counts as "in force" — grace policies are still covered. */
export const IN_FORCE_STATUSES = ["active", "grace"] as const;

export interface PolicyOverviewSummary {
  total: number;
  /** Every known status (0 when none), plus any unexpected status found in the data. */
  counts: Record<string, number>;
  /** Monthly-equivalent premium per status per currency, as money strings. */
  monthlyPremium: Record<string, Record<string, string>>;
  /** Active + grace monthly premium per currency. */
  inForceMonthlyPremium: Record<string, string>;
}

export function summarizePolicyOverview(
  rows: { status: string; currency: string | null; paymentSchedule: string | null; count: number; premiumTotal: string | number | null }[],
): PolicyOverviewSummary {
  const counts: Record<string, number> = Object.fromEntries(POLICY_STATUSES.map((s) => [s, 0]));
  const cents: Record<string, Record<string, Cents>> = {};
  const inForce: Record<string, Cents> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.count) || 0;
    total += n;
    counts[r.status] = (counts[r.status] ?? 0) + n;
    const currency = r.currency || "USD";
    const monthly = mulCents(toCents(r.premiumTotal ?? 0), 1 / monthlyToScheduleFactor(r.paymentSchedule || "monthly"));
    cents[r.status] ??= {};
    cents[r.status][currency] = ((cents[r.status][currency] ?? 0) + monthly) as Cents;
    if ((IN_FORCE_STATUSES as readonly string[]).includes(r.status)) {
      inForce[currency] = ((inForce[currency] ?? 0) + monthly) as Cents;
    }
  }
  const toStrings = (m: Record<string, Cents>) => Object.fromEntries(Object.entries(m).map(([c, v]) => [c, fromCents(v)]));
  return {
    total,
    counts,
    monthlyPremium: Object.fromEntries(Object.entries(cents).map(([s, m]) => [s, toStrings(m)])),
    inForceMonthlyPremium: toStrings(inForce),
  };
}
