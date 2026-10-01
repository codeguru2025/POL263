import { describe, it, expect } from "vitest";
import { reconcileBankAccounts, goesThroughBank, type AccountInput } from "../../server/bank-reconciliation";

const acct = (over: Partial<AccountInput> = {}): AccountInput => ({
  accountName: "FBC Main", bankName: "FBC", currency: "USD",
  statements: [{ date: "2026-08-31", balance: "1000.00" }, { date: "2026-09-30", balance: "1350.00" }],
  deposits: "200.00", depositCount: 2, ...over,
});

describe("goesThroughBank", () => {
  it("treats everything but cash (and internal credit moves) as bank money", () => {
    for (const m of ["paynow_ecocash", "ecocash", "onemoney", "innbucks", "visa_mastercard", "bank_transfer", "cheque"]) expect(goesThroughBank(m)).toBe(true);
    for (const m of ["cash", "CASH", "credit_balance", null]) expect(goesThroughBank(m)).toBe(false);
  });
});

describe("reconcileBankAccounts", () => {
  it("opening + deposits + received via bank − paid via bank = what the bank should show", () => {
    const { accounts } = reconcileBankAccounts([acct()], { USD: { received: "180.00", paid: "30.00", receivedCount: 3, paidCount: 1 } }, "2026-09-01", "2026-09-30");
    expect(accounts[0]).toMatchObject({ openingBalance: "1000.00", expectedClosing: "1350.00", closingBalance: "1350.00", difference: "0.00", status: "agrees" });
  });

  it("shows the difference to explain (bank charges here)", () => {
    const { accounts } = reconcileBankAccounts([acct({ statements: [{ date: "2026-08-31", balance: "1000" }, { date: "2026-09-30", balance: "1345.50" }] })],
      { USD: { received: "180", paid: "30", receivedCount: 3, paidCount: 1 } }, "2026-09-01", "2026-09-30");
    expect(accounts[0]).toMatchObject({ difference: "-4.50", status: "difference" });
  });

  it("never invents an opening balance from a statement inside the period", () => {
    const { accounts } = reconcileBankAccounts([acct({ statements: [{ date: "2026-09-15", balance: "900" }, { date: "2026-09-30", balance: "1350" }] })], {}, "2026-09-01", "2026-09-30");
    expect(accounts[0]).toMatchObject({ openingBalance: null, expectedClosing: null, difference: null, status: "no_opening" });
  });

  it("needs a closing statement inside the period", () => {
    const { accounts } = reconcileBankAccounts([acct({ statements: [{ date: "2026-08-31", balance: "1000" }] })], {}, "2026-09-01", "2026-09-30");
    expect(accounts[0].status).toBe("no_closing");
  });

  it("with two accounts in a currency, leaves bank receipts/payouts unlinked instead of guessing", () => {
    const { accounts, unlinked } = reconcileBankAccounts([acct(), acct({ accountName: "CBZ" })],
      { USD: { received: "180", paid: "30", receivedCount: 3, paidCount: 1 } }, "2026-09-01", "2026-09-30");
    expect(accounts.every((a) => a.receivedThroughBank === "0.00")).toBe(true);
    expect(unlinked.USD).toMatchObject({ received: "180", paid: "30" });
  });
});
