import { describe, it, expect } from "vitest";
import { commissionSplits, periodsCovered, DEFAULT_COMMISSION_RATES, LEGACY_COMMISSION_RATES } from "../../server/commission-calc";

const total = (s: ReturnType<typeof commissionSplits>) => s.reduce((a, x) => a + Math.round(Number(x.commission) * 100), 0) / 100;

describe("commissionSplits", () => {
  it("default rates: months 1-2 at 50%, month 3 onward at 10%", () => {
    expect(total(commissionSplits(0, 1200, 1, DEFAULT_COMMISSION_RATES))).toBe(6);
    expect(total(commissionSplits(1, 1200, 1, DEFAULT_COMMISSION_RATES))).toBe(6);
    expect(total(commissionSplits(2, 1200, 1, DEFAULT_COMMISSION_RATES))).toBe(1.2);
    expect(total(commissionSplits(40, 1200, 1, DEFAULT_COMMISSION_RATES))).toBe(1.2);
  });

  it("a 4-month prepayment is months 1-4, not 50% on the lot (FLK00806: R960)", () => {
    const s = commissionSplits(0, 96000, 4, DEFAULT_COMMISSION_RATES);
    expect(s.map((x) => [x.entryType, x.commission, x.fromMonth, x.toMonth])).toEqual([
      ["first_months", "240.00", 1, 2],
      ["recurring", "48.00", 3, 4],
    ]);
  });

  it("product rates with a gap pay nothing for months 3-4 (recurring from month 5)", () => {
    const gap = { firstMonths: 2, firstRate: 50, recurringStart: 5, recurringRate: 10 };
    expect(commissionSplits(2, 1200, 1, gap)).toEqual([]);
    expect(commissionSplits(3, 1200, 1, gap)).toEqual([]);
    expect(total(commissionSplits(4, 1200, 1, gap))).toBe(1.2);
    // $24 covering months 4-5: only month 5 earns.
    expect(total(commissionSplits(3, 2400, 2, gap))).toBe(1.2);
  });

  it("legacy policies pay 10% from month 1", () => {
    expect(commissionSplits(0, 1200, 1, LEGACY_COMMISSION_RATES).map((x) => [x.entryType, x.commission])).toEqual([["recurring", "1.20"]]);
  });

  it("uneven amounts split to the cent", () => {
    // $10 over 3 months at 50%: 3.34 + 3.33 + 3.33 → months 1-2 = 6.67 at 50% = 3.34 (rounded), month 3 = 3.33 at 10% = 0.33
    const s = commissionSplits(0, 1000, 3, DEFAULT_COMMISSION_RATES);
    expect(s.map((x) => x.baseCents)).toEqual([667, 333]);
  });

  it("nothing for a zero payment", () => {
    expect(commissionSplits(0, 0, 1, DEFAULT_COMMISSION_RATES)).toEqual([]);
  });
});

describe("periodsCovered", () => {
  it("counts months from the cover period, inclusive of period_to", () => {
    expect(periodsCovered("2026-08-28", "2026-09-26", "monthly")).toBe(1);
    expect(periodsCovered("2026-08-28", "2026-12-25", "monthly")).toBe(4);
    expect(periodsCovered("2026-09-22", "2026-11-20", "monthly")).toBe(2);
  });
  it("no period on record counts as one", () => {
    expect(periodsCovered(null, null, "monthly")).toBe(1);
    expect(periodsCovered("2026-09-22", null)).toBe(1);
  });
});
