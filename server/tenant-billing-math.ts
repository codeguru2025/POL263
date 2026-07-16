/**
 * Pure billing date-math — deliberately zero side-effecting imports (no DB, no
 * network) so it's trivially unit-testable without mocking the rest of the
 * billing module graph. See tests/unit/tenant-billing-math.test.ts.
 */
import type { TenantSubscription } from "@shared/control-plane-schema";

export function getEffectiveGraceDays(subscription: Pick<TenantSubscription, "graceDaysOverride">, settings: { graceDays: number }): number {
  return subscription.graceDaysOverride ?? settings.graceDays;
}

/** Adds N calendar months to a date, clamping to the last day of the target month (e.g. Jan 31 + 1mo = Feb 28/29). */
export function addBillingCycle(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  // If setMonth overflowed (e.g. Jan 31 -> Mar 3 because Feb has no 31st), clamp back to
  // the last day of the intended month.
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0);
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
