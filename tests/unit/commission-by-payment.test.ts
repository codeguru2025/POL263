import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { commissionPct, subtotalByAgent, type CommissionLine } from "../../server/commission-by-payment";

const line = (o: Partial<CommissionLine>): CommissionLine => ({
  id: "x", kind: "receipt", date: "2026-09-10", agentId: "a", agent: "A", policyNumber: "P", client: "", receiptNumber: "1", description: "",
  paymentCurrency: "USD", payment: "12.00", monthsPaid: 1, commissionCurrency: "USD", commission: "6.00", commissionPct: 50, entryType: "first_months", ...o,
});

describe("commissionPct", () => {
  it("share of the payment, same currency only", () => {
    expect(commissionPct("6.00", "USD", "12.00", "USD")).toBe(50);
    expect(commissionPct("1.20", "USD", "12.00", "USD")).toBe(10);
    expect(commissionPct("6.00", "USD", "120.00", "ZAR")).toBeNull();
    expect(commissionPct(null, "USD", "12.00", "USD")).toBeNull();
  });
});

describe("subtotalByAgent", () => {
  it("clawbacks and their reversals net in the clawed-back column (as the Commissions statement); receipts without commission are ignored", () => {
    const [s] = subtotalByAgent([
      line({}),
      line({ commission: "1.20", entryType: "recurring" }),
      line({ commission: null, entryType: "" }),
      line({ kind: "other", commission: "-6.00", entryType: "clawback", payment: null }),
      line({ kind: "other", commission: "3.00", entryType: "clawback_reversal", payment: null }),
    ]);
    expect(s).toMatchObject({ agent: "A", receipts: 2, earned: "7.20", clawedBack: "-3.00", net: "4.20" });
  });
});
