/**
 * Pure policy outstanding/arrears calculation — no DB, no other server module dependencies.
 * Split out from route-helpers.ts (which depends on storage.ts) so that
 * policy-status-on-payment.ts can reuse the same "single source of truth" arrears formula
 * without creating a circular import (policy-status-on-payment -> route-helpers -> storage ->
 * policy-status-on-payment). route-helpers.ts re-exports everything below unchanged so existing
 * callers importing from "./route-helpers" keep working as-is.
 */
import { toCents, centsToNumber } from "@shared/money";

// "yearly" is the value actually used for policies.paymentSchedule everywhere else (see
// monthlyToScheduleFactor in route-helpers.ts) — this map used "annually" instead, so
// periodDaysForSchedule never matched a yearly policy's real schedule value and silently fell
// through to the 30.44-day monthly default via the `??` below, inflating a yearly policy's
// computed arrears by ~12x (computePolicyOutstanding and periodsBetween both depend on this).
// Keeping "annually" too in case anything else ever passes it.
const PERIOD_DAYS: Record<string, number> = {
  weekly: 7, biweekly: 14, quarterly: 91.31, yearly: 365.25, annually: 365.25, monthly: 30.44,
};
export function periodDaysForSchedule(schedule: string | null | undefined): number {
  return PERIOD_DAYS[String(schedule || "monthly")] ?? 30.44;
}

/** Whole billing periods elapsed between two dates for a schedule (floor; non-positive spans ⇒ 0). */
export function periodsBetween(
  from: string | Date | null | undefined,
  to: string | Date,
  schedule: string | null | undefined,
): number {
  if (!from) return 0;
  const f = new Date(from);
  const t = new Date(to);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return 0;
  const days = (t.getTime() - f.getTime()) / (24 * 60 * 60 * 1000);
  if (days <= 0) return 0;
  return Math.floor(days / periodDaysForSchedule(schedule));
}

export interface OutstandingResult {
  periodsElapsed: number;
  totalDue: number;
  totalPaid: number;
  walletBalance: number;
  /** Amount owed right now (>= 0). */
  outstanding: number;
  /** Signed account balance: positive = paid ahead / credit, negative = owed. */
  balance: number;
}

/**
 * Single source of truth for a policy's outstanding/arrears figure. Reproduces the
 * legacy formula (periodsElapsed × current premium − totalPaid) and folds in the
 * signed credit-balance wallet, which carries premium-change reconciliations
 * (negative = arrears charged, positive = advance credit) and overpayments.
 */
export function computePolicyOutstanding(params: {
  policy: any;
  totalPaid: number;
  walletBalance?: number;
}): OutstandingResult {
  const { policy } = params;
  // All arithmetic in integer cents so the figures are exact to the cent.
  const paidCents = toCents(params.totalPaid);
  const walletCents = toCents(params.walletBalance);
  const premiumCents = toCents(policy?.premiumAmount);
  const startDate = policy?.inceptionDate || policy?.effectiveDate;

  let periodsElapsed = 0;
  let dueCents = 0;
  if (startDate && premiumCents > 0) {
    const start = new Date(startDate);
    const now = new Date();
    if (!Number.isNaN(start.getTime()) && start <= now) {
      const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
      periodsElapsed = Math.ceil(daysElapsed / periodDaysForSchedule(policy?.paymentSchedule));
      dueCents = periodsElapsed * premiumCents;
    }
  }

  const balanceCents = paidCents + walletCents - dueCents;
  return {
    periodsElapsed,
    totalDue: centsToNumber(dueCents),
    totalPaid: centsToNumber(paidCents),
    walletBalance: centsToNumber(walletCents),
    outstanding: centsToNumber(Math.max(0, -balanceCents)),
    balance: centsToNumber(balanceCents),
  };
}
