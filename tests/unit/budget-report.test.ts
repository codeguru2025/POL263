import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { monthShareInRange, budgetForRange, compareToBudget } from "../../server/budget-report";

describe("monthShareInRange", () => {
  it("whole, part and no overlap", () => {
    expect(monthShareInRange("2026-09-01", "2026-07-01", "2026-12-31")).toBe(1);
    expect(monthShareInRange("2026-10-01", "2026-10-01", "2026-10-02")).toBeCloseTo(2 / 31, 6);
    expect(monthShareInRange("2026-11-01", "2026-10-01", "2026-10-02")).toBe(0);
  });
});

describe("budgetForRange", () => {
  const rows = [
    { periodMonth: "2026-09-01", category: "total_income", amount: "3000", currency: "USD" },
    { periodMonth: "2026-10-01", category: "total_income", amount: "62000", currency: "ZAR" },
    { periodMonth: "2026-10-01", category: "new_policies", amount: "31", currency: "USD" },
  ];
  const fx = { USD: 1, ZAR: 0.05 };
  it("pro-rates a part month and converts currency", () => {
    // Sep in full (3000) + 2 of 31 days of October (62000 ZAR = 3100 USD → 200)
    expect(budgetForRange(rows, "total_income", "2026-09-01", "2026-10-02", fx)).toBeCloseTo(3200, 6);
  });
  it("counts are not converted", () => {
    expect(budgetForRange(rows, "new_policies", "2026-10-01", "2026-10-02", fx)).toBeCloseTo(2, 6);
  });
});

describe("compareToBudget", () => {
  it("variance and percentage; nothing when either side is missing", () => {
    expect(compareToBudget(1100, 1000)).toEqual({ target: 1000, actual: 1100, variance: 100, variancePct: 10 });
    expect(compareToBudget(500, null)).toEqual({ target: null, actual: 500, variance: null, variancePct: null });
    expect(compareToBudget(null, 900)).toEqual({ target: 900, actual: null, variance: null, variancePct: null });
  });
});
