import { describe, it, expect } from "vitest";
import { addBillingCycle, getEffectiveGraceDays, computeNextPeriod, effectiveBillingIntervalMonths, computeInvoiceAmount } from "../../server/tenant-billing-math";

describe("addBillingCycle", () => {
  it("adds whole months in the ordinary case", () => {
    const result = addBillingCycle(new Date("2026-03-15T10:00:00.000Z"), 1);
    expect(result.getUTCFullYear()).toBe(2026);
    expect(result.getUTCMonth()).toBe(3); // April (0-indexed)
    expect(result.getUTCDate()).toBe(15);
  });

  it("clamps to the last day of the target month when it overflows (Jan 31 -> Feb 28)", () => {
    const result = addBillingCycle(new Date("2026-01-31T10:00:00.000Z"), 1);
    expect(result.getUTCMonth()).toBe(1); // February
    expect(result.getUTCDate()).toBe(28); // 2026 is not a leap year
  });

  it("clamps correctly across a leap year (Jan 31 2028 -> Feb 29)", () => {
    const result = addBillingCycle(new Date("2028-01-31T10:00:00.000Z"), 1);
    expect(result.getUTCMonth()).toBe(1);
    expect(result.getUTCDate()).toBe(29);
  });

  it("supports multi-month intervals", () => {
    const result = addBillingCycle(new Date("2026-01-01T00:00:00.000Z"), 3);
    expect(result.getUTCMonth()).toBe(3); // April
  });
});

describe("getEffectiveGraceDays", () => {
  it("uses the global default when no override is set", () => {
    expect(getEffectiveGraceDays({ graceDaysOverride: null }, { graceDays: 7 })).toBe(7);
  });

  it("uses the per-tenant override when set", () => {
    expect(getEffectiveGraceDays({ graceDaysOverride: 14 }, { graceDays: 7 })).toBe(14);
  });

  it("treats a zero override as a real override (not falsy-default)", () => {
    expect(getEffectiveGraceDays({ graceDaysOverride: 0 }, { graceDays: 7 })).toBe(0);
  });
});

describe("computeNextPeriod (the paid-invoice period-extension rule)", () => {
  it("paying early: next period starts at the scheduled renewal, not now — no bonus days", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-07-30T00:00:00.000Z"); // 14 days in the future
    const { periodStart, periodEnd } = computeNextPeriod(now, currentPeriodEnd, 1);
    expect(periodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
    expect(periodEnd.toISOString()).toBe(new Date("2026-08-30T00:00:00.000Z").toISOString());
  });

  it("paying late (grace period or post-suspension): next period starts at now, not the stale old end", () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-06-16T00:00:00.000Z"); // 30 days in the past
    const { periodStart, periodEnd } = computeNextPeriod(now, currentPeriodEnd, 1);
    expect(periodStart.toISOString()).toBe(now.toISOString());
    expect(periodEnd.toISOString()).toBe(new Date("2026-08-16T00:00:00.000Z").toISOString());
    // Critically: the new period must extend past "now" so the very next sweep run
    // doesn't immediately re-flag this subscription as past_due despite just being paid.
    expect(periodEnd.getTime()).toBeGreaterThan(now.getTime());
  });

  it("paying exactly at the period boundary counts as early (uses currentPeriodEnd)", () => {
    const now = new Date("2026-07-30T00:00:00.000Z");
    const currentPeriodEnd = new Date("2026-07-30T00:00:00.000Z");
    const { periodStart } = computeNextPeriod(now, currentPeriodEnd, 1);
    expect(periodStart.toISOString()).toBe(currentPeriodEnd.toISOString());
  });
});

describe("effectiveBillingIntervalMonths", () => {
  it("uses the plan's own interval for monthly billing", () => {
    expect(effectiveBillingIntervalMonths("monthly", 1)).toBe(1);
  });

  it("overrides to 12 months for annual billing regardless of the plan's own interval", () => {
    expect(effectiveBillingIntervalMonths("annual", 1)).toBe(12);
  });
});

describe("computeInvoiceAmount", () => {
  it("charges the plain monthly price for monthly billing", () => {
    expect(computeInvoiceAmount("50.00", "monthly")).toBe("50.00");
  });

  it("charges 12 months at a 20% discount for annual billing", () => {
    // 50 * 12 = 600; 20% off = 480
    expect(computeInvoiceAmount("50.00", "annual")).toBe("480.00");
  });

  it("rounds to 2 decimal places", () => {
    expect(computeInvoiceAmount("19.99", "annual")).toBe("191.90");
  });

  it("accepts a numeric priceMonthlyUsd as well as a string", () => {
    expect(computeInvoiceAmount(50, "annual")).toBe("480.00");
  });
});
