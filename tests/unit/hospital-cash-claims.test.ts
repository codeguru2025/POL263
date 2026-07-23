import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { daysBetweenInclusive, computeHospitalCashPayoutAmount } from "../../server/hospital-cash-claims";

describe("daysBetweenInclusive", () => {
  it("counts a same-day admission and discharge as 1 day", () => {
    expect(daysBetweenInclusive("2026-07-01", "2026-07-01")).toBe(1);
  });

  it("counts inclusive of both admission and discharge day", () => {
    expect(daysBetweenInclusive("2026-07-01", "2026-07-05")).toBe(5);
  });

  it("never returns a negative day count for a reversed date range", () => {
    expect(daysBetweenInclusive("2026-07-05", "2026-07-01")).toBe(1);
  });
});

describe("computeHospitalCashPayoutAmount — base cases", () => {
  it("computes days x daily rate with no caps", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 5, dailyRate: 20, maxDaysPerClaim: null, usedDaysThisYear: 0, maxDaysPerYear: null,
    });
    expect(result).toEqual({ amount: "100.00", days: 5, cappedByPerClaim: false, cappedByPerYear: false });
  });

  it("returns 0 for a zero-day stay", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 0, dailyRate: 20, maxDaysPerClaim: null, usedDaysThisYear: 0, maxDaysPerYear: null,
    });
    expect(result.amount).toBe("0.00");
  });
});

describe("computeHospitalCashPayoutAmount — per-claim cap", () => {
  it("caps days at maxDaysPerClaim and flags it", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 30, dailyRate: 20, maxDaysPerClaim: 10, usedDaysThisYear: 0, maxDaysPerYear: null,
    });
    expect(result).toEqual({ amount: "200.00", days: 10, cappedByPerClaim: true, cappedByPerYear: false });
  });

  it("does not flag the cap when days are already under it", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 5, dailyRate: 20, maxDaysPerClaim: 10, usedDaysThisYear: 0, maxDaysPerYear: null,
    });
    expect(result.cappedByPerClaim).toBe(false);
  });
});

describe("computeHospitalCashPayoutAmount — per-year cap", () => {
  it("reduces days to whatever remains of the annual allowance", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 15, dailyRate: 20, maxDaysPerClaim: null, usedDaysThisYear: 25, maxDaysPerYear: 30,
    });
    // 30 - 25 = 5 days remaining, even though this claim alone would otherwise be 15 days.
    expect(result).toEqual({ amount: "100.00", days: 5, cappedByPerClaim: false, cappedByPerYear: true });
  });

  it("pays zero once the annual allowance is already exhausted", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 10, dailyRate: 20, maxDaysPerClaim: null, usedDaysThisYear: 30, maxDaysPerYear: 30,
    });
    expect(result).toEqual({ amount: "0.00", days: 0, cappedByPerClaim: false, cappedByPerYear: true });
  });

  it("never lets usedDaysThisYear exceeding the max produce a negative remaining allowance", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 10, dailyRate: 20, maxDaysPerClaim: null, usedDaysThisYear: 45, maxDaysPerYear: 30,
    });
    expect(result.days).toBe(0);
    expect(result.amount).toBe("0.00");
  });
});

describe("computeHospitalCashPayoutAmount — both caps together", () => {
  it("applies the per-claim cap first, then the per-year cap on top of that", () => {
    const result = computeHospitalCashPayoutAmount({
      rawDays: 20, dailyRate: 10, maxDaysPerClaim: 12, usedDaysThisYear: 25, maxDaysPerYear: 30,
    });
    // Per-claim cap brings 20 -> 12. Per-year remaining is 30-25=5, which is stricter, so 12 -> 5.
    expect(result).toEqual({ amount: "50.00", days: 5, cappedByPerClaim: true, cappedByPerYear: true });
  });
});
