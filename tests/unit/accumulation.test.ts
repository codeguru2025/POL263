import { describe, it, expect } from "vitest";
import {
  computeContributionFutureValue,
  computeAccumulationBalance,
  resolveMaturityDate,
  isMatured,
} from "../../server/accumulation";

describe("computeContributionFutureValue", () => {
  it("returns the contribution unchanged when no rate is configured", () => {
    expect(computeContributionFutureValue(100, null, "2020-01-01", "2026-01-01")).toBe(100);
    expect(computeContributionFutureValue(100, undefined, "2020-01-01", "2026-01-01")).toBe(100);
  });

  it("returns the contribution unchanged for a zero or negative rate", () => {
    expect(computeContributionFutureValue(100, 0, "2020-01-01", "2026-01-01")).toBe(100);
    expect(computeContributionFutureValue(100, -5, "2020-01-01", "2026-01-01")).toBe(100);
  });

  it("compounds annually over exactly one year", () => {
    const fv = computeContributionFutureValue(100, 10, "2025-01-01", "2026-01-01");
    expect(fv).toBeCloseTo(110, 1);
  });

  it("compounds over multiple years", () => {
    const fv = computeContributionFutureValue(100, 10, "2020-01-01", "2026-01-01");
    // 100 * 1.1^6 ≈ 177.16
    expect(fv).toBeCloseTo(177.16, 1);
  });

  it("returns the contribution as-is when contributed on the as-of date (zero elapsed time)", () => {
    expect(computeContributionFutureValue(100, 10, "2026-07-23", "2026-07-23")).toBeCloseTo(100, 5);
  });

  it("clamps to zero elapsed time for a contribution date after the as-of date rather than going negative", () => {
    const fv = computeContributionFutureValue(100, 10, "2026-12-01", "2026-01-01");
    expect(fv).toBeCloseTo(100, 5);
  });
});

describe("computeAccumulationBalance", () => {
  it("sums compounded contributions with no withdrawals", () => {
    const balance = computeAccumulationBalance(
      [{ amount: "100.00", currency: "USD", contributionDate: "2025-01-01" }],
      [],
      10,
      "2026-01-01",
    );
    expect(balance.USD).toBeCloseTo(110, 1);
  });

  it("keeps currencies separate", () => {
    const balance = computeAccumulationBalance(
      [
        { amount: "100.00", currency: "USD", contributionDate: "2026-01-01" },
        { amount: "500.00", currency: "ZAR", contributionDate: "2026-01-01" },
      ],
      [],
      null,
      "2026-01-01",
    );
    expect(balance).toEqual({ USD: 100, ZAR: 500 });
  });

  it("subtracts only paid withdrawals", () => {
    const balance = computeAccumulationBalance(
      [{ amount: "200.00", currency: "USD", contributionDate: "2026-01-01" }],
      [
        { amount: "50.00", currency: "USD", status: "paid" },
        { amount: "30.00", currency: "USD", status: "pending" },
      ],
      null,
      "2026-01-01",
    );
    expect(balance.USD).toBe(150);
  });

  it("returns an empty object for no contributions", () => {
    expect(computeAccumulationBalance([], [], 10, "2026-01-01")).toEqual({});
  });

  it("skips non-numeric contribution amounts rather than poisoning the total with NaN", () => {
    const balance = computeAccumulationBalance(
      [
        { amount: "not-a-number", currency: "USD", contributionDate: "2026-01-01" },
        { amount: "50.00", currency: "USD", contributionDate: "2026-01-01" },
      ],
      [],
      null,
      "2026-01-01",
    );
    expect(balance.USD).toBe(50);
  });

  it("compounds each contribution independently from its own contribution date", () => {
    const balance = computeAccumulationBalance(
      [
        { amount: "100.00", currency: "USD", contributionDate: "2020-01-01" }, // 6 years
        { amount: "100.00", currency: "USD", contributionDate: "2025-01-01" }, // 1 year
      ],
      [],
      10,
      "2026-01-01",
    );
    // 100*1.1^6 + 100*1.1^1 ≈ 177.16 + 110 = 287.16
    expect(balance.USD).toBeCloseTo(287.16, 1);
  });
});

describe("resolveMaturityDate", () => {
  it("adds the term in months to the start date", () => {
    expect(resolveMaturityDate("2026-01-01", 60)).toBe("2031-01-01");
  });

  it("returns null when no term is configured", () => {
    expect(resolveMaturityDate("2026-01-01", null)).toBeNull();
    expect(resolveMaturityDate("2026-01-01", undefined)).toBeNull();
    expect(resolveMaturityDate("2026-01-01", 0)).toBeNull();
  });

  it("handles a term that crosses multiple years", () => {
    expect(resolveMaturityDate("2026-06-15", 18)).toBe("2027-12-15");
  });
});

describe("isMatured", () => {
  it("is false when there's no maturity date configured (open-ended product)", () => {
    expect(isMatured(null, "2030-01-01")).toBe(false);
  });

  it("is true once the as-of date reaches the maturity date", () => {
    expect(isMatured("2026-01-01", "2026-01-01")).toBe(true);
    expect(isMatured("2026-01-01", "2026-06-01")).toBe(true);
  });

  it("is false before the maturity date", () => {
    expect(isMatured("2030-01-01", "2026-01-01")).toBe(false);
  });
});
