import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { summarizeSpend, type SpendRow } from "../../server/expenditure-report";

const row = (o: Partial<SpendRow>): SpendRow => ({
  kind: "requisition", id: Math.random().toString(36), date: "2026-09-01", voucher: "", reference: "", category: "FUEL",
  description: "", payee: "", currency: "USD", amount: "10.00", method: "cash", paidBy: "", branch: "", department: "",
  commissionPayout: false, ...o,
});

describe("summarizeSpend", () => {
  it("totals per currency, type and category without mixing currencies", () => {
    const s = summarizeSpend([
      row({ amount: "120.00" }),
      row({ amount: "30.50" }),
      row({ kind: "petty_cash", category: "LUNCH", amount: "10.00" }),
      row({ category: "CASKET", amount: "640.00", currency: "ZAR" }),
    ]);
    expect(s.byCurrency).toEqual({ USD: "160.50", ZAR: "640.00" });
    expect(s.byKind.petty_cash).toEqual({ USD: "10.00" });
    expect(s.byCategory.FUEL).toEqual({ USD: "150.50" });
    expect(s.count).toBe(4);
  });

  it("files commission requisitions under 'Commission paid to agents'", () => {
    const s = summarizeSpend([row({ category: "COMMISSION", commissionPayout: true, amount: "156.00" })]);
    expect(s.byCategory["Commission paid to agents"]).toEqual({ USD: "156.00" });
    expect(s.byCategory.COMMISSION).toBeUndefined();
  });
});
