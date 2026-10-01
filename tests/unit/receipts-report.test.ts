import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));

import { summarizeReceipts, type ReceiptRow } from "../../server/receipts-report";

const row = (o: Partial<ReceiptRow>): ReceiptRow => ({
  kind: "premium", id: Math.random().toString(36), receiptNumber: "1", datePaid: "2026-09-01", issuedAt: "", policyNumber: "",
  memberNumber: "", payer: "", description: "", currency: "USD", amount: "10.00", premiumDue: "", monthsPaid: 1,
  method: "cash", agent: "", capturedBy: "", groupName: "", branch: "", pending: false, notes: "", ...o,
});

describe("summarizeReceipts", () => {
  it("totals per currency and per type, never mixing currencies", () => {
    const s = summarizeReceipts([
      row({ amount: "12.00" }),
      row({ kind: "service", amount: "270.00" }),
      row({ kind: "society", amount: "1100.00", currency: "ZAR", method: "" }),
    ]);
    expect(s.byCurrency).toEqual({ USD: "282.00", ZAR: "1100.00" });
    expect(s.byKind.service).toEqual({ USD: "270.00" });
    expect(s.byMethod["not recorded"]).toEqual({ ZAR: "1100.00" });
    expect(s.count).toBe(3);
  });

  it("lists receipts waiting for approval separately and never counts them", () => {
    const s = summarizeReceipts([row({ amount: "12.00" }), row({ amount: "20.00", pending: true })]);
    expect(s.byCurrency).toEqual({ USD: "12.00" });
    expect(s.pending).toEqual({ count: 1, byCurrency: { USD: "20.00" } });
    expect(s.count).toBe(1);
  });
});
