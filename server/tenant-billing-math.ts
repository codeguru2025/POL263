/**
 * Pure billing date-math — deliberately zero side-effecting imports (no DB, no
 * network) so it's trivially unit-testable without mocking the rest of the
 * billing module graph. See tests/unit/tenant-billing-math.test.ts.
 */
import type { TenantSubscription } from "@shared/control-plane-schema";

export function getEffectiveGraceDays(subscription: Pick<TenantSubscription, "graceDaysOverride">, settings: { graceDays: number }): number {
  return subscription.graceDaysOverride ?? settings.graceDays;
}

/**
 * Adds N calendar months to a date, clamping to the last day of the target month
 * (e.g. Jan 31 + 1mo = Feb 28/29). Uses UTC methods throughout — no server TZ is
 * pinned anywhere in this deployment, and get/setMonth (local-time) would silently
 * shift results by a full month near month-boundary instants if the process ever
 * runs in a non-UTC timezone.
 */
export function addBillingCycle(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getUTCMonth() + months;
  d.setUTCMonth(targetMonth);
  // If setUTCMonth overflowed (e.g. Jan 31 -> Mar 3 because Feb has no 31st), clamp back
  // to the last day of the intended month.
  if (d.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setUTCDate(0);
  }
  return d;
}

/**
 * The core period-extension rule: paying early adds exactly one cycle from the
 * scheduled renewal (no bonus days); paying late (grace period or even
 * post-suspension) starts the new cycle from `now`, not the stale old end, so
 * paying always visibly buys one full forward cycle.
 */
export function computeNextPeriod(now: Date, currentPeriodEnd: Date, billingIntervalMonths: number): { periodStart: Date; periodEnd: Date } {
  const periodStart = now.getTime() > currentPeriodEnd.getTime() ? now : currentPeriodEnd;
  const periodEnd = addBillingCycle(periodStart, billingIntervalMonths);
  return { periodStart, periodEnd };
}

/** A subscription's billingCycle overrides the plan's own (fixed, monthly-base) interval — the
 *  plan's billingIntervalMonths is only ever "1" today; annual is a per-subscription choice. */
export function effectiveBillingIntervalMonths(billingCycle: string, planIntervalMonths: number): number {
  return billingCycle === "annual" ? 12 : planIntervalMonths;
}

/** Annual billing is 12 months of the monthly price at a 20% discount. */
export function computeInvoiceAmount(priceMonthlyUsd: string | number, billingCycle: string): string {
  const monthly = parseFloat(String(priceMonthlyUsd));
  const amount = billingCycle === "annual" ? monthly * 12 * 0.8 : monthly;
  return amount.toFixed(2);
}
