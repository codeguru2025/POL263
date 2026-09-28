import { describe, it, expect } from "vitest";
import { summarizePolicyOverview, monthlyToScheduleFactor } from "../../server/policy-overview";
import { dayRangeInTimezone } from "../../server/date-utils";

describe("summarizePolicyOverview", () => {
  it("counts every status, including ones with no policies", () => {
    const s = summarizePolicyOverview([
      { status: "active", currency: "USD", paymentSchedule: "monthly", count: 512, premiumTotal: "5120.00" },
      { status: "lapsed", currency: "USD", paymentSchedule: "monthly", count: 27, premiumTotal: "270.00" },
    ]);
    expect(s.total).toBe(539);
    expect(s.counts).toMatchObject({ active: 512, lapsed: 27, grace: 0, inactive: 0, cancelled: 0, archived: 0 });
  });

  it("converts schedules to a monthly figure and keeps currencies apart", () => {
    const s = summarizePolicyOverview([
      { status: "active", currency: "USD", paymentSchedule: "monthly", count: 1, premiumTotal: "10.00" },
      { status: "active", currency: "USD", paymentSchedule: "weekly", count: 1, premiumTotal: "3.00" }, // 3 × 52 / 12 = 13.00
      { status: "active", currency: "USD", paymentSchedule: "yearly", count: 1, premiumTotal: "120.00" }, // 10.00
      { status: "active", currency: "ZAR", paymentSchedule: "monthly", count: 2, premiumTotal: "300.00" },
      { status: "grace", currency: "USD", paymentSchedule: "monthly", count: 1, premiumTotal: "5.00" },
      { status: "lapsed", currency: "USD", paymentSchedule: "monthly", count: 1, premiumTotal: "99.00" },
    ]);
    expect(s.monthlyPremium.active).toEqual({ USD: "33.00", ZAR: "300.00" });
    // In force = active + grace only — the lapsed $99 is left out.
    expect(s.inForceMonthlyPremium).toEqual({ USD: "38.00", ZAR: "300.00" });
  });

  it("keeps an unexpected status instead of dropping it", () => {
    const s = summarizePolicyOverview([{ status: "suspended", currency: null, paymentSchedule: null, count: 2, premiumTotal: "4" }]);
    expect(s.counts.suspended).toBe(2);
    expect(s.monthlyPremium.suspended).toEqual({ USD: "4.00" });
  });

  it("uses the same schedule factors as premium calculation", () => {
    expect(monthlyToScheduleFactor("weekly")).toBeCloseTo(12 / 52);
    expect(monthlyToScheduleFactor("yearly")).toBe(12);
    expect(monthlyToScheduleFactor("annually")).toBe(12);
    expect(monthlyToScheduleFactor("monthly")).toBe(1);
  });
});

describe("dayRangeInTimezone", () => {
  it("cuts days at local midnight in Harare (UTC+2), not UTC midnight", () => {
    const { start, endExclusive } = dayRangeInTimezone("2026-09-01", "2026-09-30", "Africa/Harare");
    expect(start!.toISOString()).toBe("2026-08-31T22:00:00.000Z");
    expect(endExclusive!.toISOString()).toBe("2026-09-30T22:00:00.000Z");
  });

  it("rolls the end over month and year boundaries", () => {
    expect(dayRangeInTimezone(undefined, "2026-12-31", "Africa/Harare").endExclusive!.toISOString()).toBe("2026-12-31T22:00:00.000Z");
  });

  it("ignores missing or malformed dates", () => {
    expect(dayRangeInTimezone(undefined, undefined, "Africa/Harare")).toEqual({ start: undefined, endExclusive: undefined });
    expect(dayRangeInTimezone("01/09/2026", "", "Africa/Harare")).toEqual({ start: undefined, endExclusive: undefined });
  });
});
