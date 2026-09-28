import { describe, it, expect, vi, afterEach } from "vitest";
import { priceReinstatement, buildLapsedList, type ReinstatementInputs } from "../../server/lapsed-report";

const TODAY = "2026-09-28";
const inputs = (over: Partial<ReinstatementInputs> = {}): ReinstatementInputs => ({
  totalPaid: "0", walletBalance: "0", requiresArrears: false, newWaitingPeriod: false, waitingPeriodDays: 90,
  lapsedOn: "2026-09-20", timesLapsed: 1, ...over,
});
const pol = (over: Record<string, any> = {}) => ({ policyId: "p", premiumAmount: "10.00", currency: "USD", paymentSchedule: "monthly", inceptionDate: "2026-03-01", isLegacy: false, ...over });

afterEach(() => vi.useRealTimers());

describe("priceReinstatement", () => {
  it("one premium when the product doesn't require arrears", () => {
    expect(priceReinstatement(pol(), inputs(), TODAY)).toMatchObject({ reinstateCost: "10.00", reinstateBasis: "one_premium", newWaitingPeriod: false, daysSinceLapse: 8 });
  });

  it("the outstanding balance when the product requires arrears", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
    // Inception 1 Mar → 7 periods elapsed (ceil of 211 days / 30.44) = $70 due; $30 paid → $40 owed.
    const r = priceReinstatement(pol(), inputs({ requiresArrears: true, totalPaid: "30.00" }), TODAY);
    expect(r).toMatchObject({ reinstateBasis: "arrears", reinstateCost: "40.00" });
  });

  it("never less than one premium even when arrears are already covered", () => {
    expect(priceReinstatement(pol(), inputs({ requiresArrears: true, totalPaid: "1000.00" }), TODAY).reinstateCost).toBe("10.00");
  });

  it("migrated policies skip both rules, exactly like the payment path", () => {
    const r = priceReinstatement(pol({ isLegacy: true }), inputs({ requiresArrears: true, newWaitingPeriod: true }), TODAY);
    expect(r).toMatchObject({ reinstateBasis: "one_premium", reinstateCost: "10.00", newWaitingPeriod: false });
  });

  it("new waiting period follows the product setting (null counts as on)", () => {
    expect(priceReinstatement(pol(), inputs({ newWaitingPeriod: null }), TODAY)).toMatchObject({ newWaitingPeriod: true, newWaitingPeriodDays: 90 });
    expect(priceReinstatement(pol(), inputs({ newWaitingPeriod: true, waitingPeriodDays: 30 }), TODAY).newWaitingPeriodDays).toBe(30);
  });
});

describe("buildLapsedList", () => {
  const rows = [pol({ policyId: "aug" }), pol({ policyId: "sep", currency: "ZAR", premiumAmount: "90.00" }), pol({ policyId: "norecord" })];
  const map = new Map<string, ReinstatementInputs>([
    ["aug", inputs({ lapsedOn: "2026-08-25" })],
    ["sep", inputs({ lapsedOn: "2026-09-26", timesLapsed: 2 })],
    ["norecord", inputs({ lapsedOn: null, timesLapsed: 0 })],
  ]);

  it("most recent lapse first, summary per currency", () => {
    const { rows: out, summary } = buildLapsedList(rows, map, TODAY);
    expect(out.map((r) => r.policyId)).toEqual(["sep", "aug", "norecord"]);
    expect(summary).toEqual({ count: 3, lapsedThisMonth: 1, monthlyPremiumLost: { ZAR: "90.00", USD: "20.00" }, reinstateAll: { ZAR: "90.00", USD: "20.00" } });
  });

  it("from/to filter the lapse date (rows without a lapse record drop out)", () => {
    expect(buildLapsedList(rows, map, TODAY, { from: "2026-09-01", to: "2026-09-30" }).rows.map((r) => r.policyId)).toEqual(["sep"]);
  });
});
