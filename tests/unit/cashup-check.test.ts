import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { cashupStatus, countedCash, summarizeCashupCheck, type CashupCheckRow } from "../../server/cashup-check";

describe("cashupStatus", () => {
  it("no cash-up → not cashed up", () => expect(cashupStatus("120.00", null)).toEqual({ status: "not_cashed_up", difference: null }));
  it("counted equals taken → agrees", () => expect(cashupStatus("120.00", "120.00")).toEqual({ status: "agrees", difference: "0.00" }));
  it("counted less → short by the gap", () => expect(cashupStatus("120.00", "100.00")).toEqual({ status: "short", difference: "-20.00" }));
  it("counted more → over", () => expect(cashupStatus("120.00", "125.50").status).toBe("over"));
});

describe("countedCash", () => {
  it("prefers finance's counted cash, then the cash the preparer declared", () => {
    expect(countedCash({ countedAmountsByMethod: { cash: "98" }, amountsByMethod: { cash: "100" } })).toBe("98.00");
    expect(countedCash({ amountsByMethod: { cash: "100" } })).toBe("100.00");
    expect(countedCash({})).toBeNull();
  });
});

describe("summarizeCashupCheck", () => {
  const r = (o: Partial<CashupCheckRow>): CashupCheckRow => ({
    date: "2026-09-01", userId: "u", staff: "S", currency: "USD", cashTaken: "100.00", receipts: 1,
    cashupId: null, cashupState: null, counted: null, difference: null, status: "not_cashed_up", ...o,
  });
  it("splits taken into cashed up and not, keeps currencies and unassigned money apart", () => {
    const s = summarizeCashupCheck([
      r({}),
      r({ cashTaken: "50.00", counted: "50.00", status: "agrees" }),
      r({ currency: "ZAR", cashTaken: "200.00" }),
      r({ userId: null, cashTaken: "1100.00", currency: "ZAR", status: "unassigned" }),
    ]);
    expect(s.cashTaken).toEqual({ USD: "150.00", ZAR: "200.00" });
    expect(s.cashedUp).toEqual({ USD: "50.00" });
    expect(s.notCashedUp).toEqual({ USD: "100.00", ZAR: "200.00" });
    expect(s.unassigned).toEqual({ ZAR: "1100.00" });
    expect(s.counts).toMatchObject({ agrees: 1, not_cashed_up: 2, unassigned: 1 });
  });
});
