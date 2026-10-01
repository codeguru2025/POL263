import { describe, it, expect } from "vitest";
import { paymentPosition, periodsPaidByReceipt } from "../../server/payment-position";

describe("periodsPaidByReceipt — months a receipt actually pays for", () => {
  it("uses the recorded covered period", () => {
    expect(periodsPaidByReceipt({ periodFrom: "2026-09-01", periodTo: "2026-11-30", amount: 30, premium: 10, schedule: "monthly" })).toBe(3);
  });
  it("otherwise amount ÷ premium, at least one (FLK00960: USD 40 on USD 10 = 4)", () => {
    expect(periodsPaidByReceipt({ amount: "40", premium: "10" })).toBe(4);
    expect(periodsPaidByReceipt({ amount: "5", premium: "10" })).toBe(1);
    expect(periodsPaidByReceipt({ amount: "10", premium: null })).toBe(1);
  });
});

describe("paymentPosition — owed and paid ahead from the paid-up-to date", () => {
  it("FLK00329, paid up to 30 Jul: the periods starting 31 Jul, 31 Aug and 30 Sep are owed by 1 Oct", () => {
    // FLK00329: paid up to 30 Jul; periods start 31 Jul, 31 Aug, 30 Sep (… 31 Oct is still to come)
    expect(paymentPosition("2026-07-30", "2026-10-01", "12.00", "monthly")).toMatchObject({ periodsOwed: 3, owed: "36.00", periodsAhead: 0 });
    expect(paymentPosition("2026-07-30", "2026-09-29", "12.00", "monthly")).toMatchObject({ periodsOwed: 2, owed: "24.00" });
  });
  it("paid up to yesterday: the period starting today is owed", () => {
    expect(paymentPosition("2026-09-30", "2026-10-01", "10", "monthly")).toMatchObject({ periodsOwed: 1, owed: "10.00" });
  });
  it("covered today: nothing owed, nothing ahead", () => {
    expect(paymentPosition("2026-10-27", "2026-10-01", "10", "monthly")).toMatchObject({ periodsOwed: 0, periodsAhead: 0, ahead: "0.00" });
  });
  it("paid months ahead (FLK00960: paid up to 25 Jan, today 1 Oct → Nov, Dec, Jan ahead)", () => {
    expect(paymentPosition("2027-01-25", "2026-10-01", "10", "monthly")).toMatchObject({ periodsOwed: 0, periodsAhead: 3, ahead: "30.00" });
  });
  it("unknown paid-up-to or no premium → nothing", () => {
    expect(paymentPosition(null, "2026-10-01", "10", "monthly")).toMatchObject({ periodsOwed: 0, periodsAhead: 0 });
    expect(paymentPosition("2026-07-30", "2026-10-01", "0", "monthly")).toMatchObject({ periodsOwed: 0 });
  });
  it("weekly premiums count weeks", () => {
    expect(paymentPosition("2026-09-16", "2026-10-01", "3", "weekly")).toMatchObject({ periodsOwed: 3, owed: "9.00" });
  });
});
