import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: {} }));

import { billState, feeSource, summarizePol263Fees, type Pol263Bill } from "../../server/pol263-fees-report";

describe("billState", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  it("paid stays paid", () => expect(billState("paid", new Date("2026-09-01"), now)).toBe("paid"));
  it("open past its due date is overdue", () => expect(billState("open", new Date("2026-09-30T15:15:00Z"), now)).toBe("overdue"));
  it("open before its due date is not paid yet", () => expect(billState("open", new Date("2026-10-30"), now)).toBe("open"));
});

describe("feeSource", () => {
  const base = { description: null, receipt_number: null, service_receipt_number: null, group_name: null };
  it("uses the receipt number, never an internal id", () => {
    expect(feeSource({ ...base, receipt_number: "809", description: "Platform fee on payment f810d17b-52c8-4808-9d7c-90e946157ed6" })).toBe("Receipt #809");
    expect(feeSource({ ...base, description: "Platform fee on payment f810d17b-52c8-4808-9d7c-90e946157ed6" })).toBe("Payment (no receipt)");
  });
  it("names service and society receipts", () => {
    expect(feeSource({ ...base, service_receipt_number: "643" })).toBe("Service receipt #643");
    expect(feeSource({ ...base, description: "Platform fee on legacy group receipt LGR-20260906-205 (group ASAZANENI B/S)" })).toBe("Society receipt LGR-20260906-205 — ASAZANENI B/S");
    expect(feeSource({ ...base, description: "Platform fee on approved backdated receipt 721 (policy FLK00521)" })).toBe("Receipt #721");
  });
});

describe("summarizePol263Fees", () => {
  const bill = (o: Partial<Pol263Bill>): Pol263Bill => ({
    id: "b", reference: "BILL-1", kind: "2.5% fees", periodFrom: null, periodTo: null, issued: "2026-08-31", due: "2026-09-30",
    paid: null, amount: "367.60", currency: "USD", state: "overdue", lines: [], ...o,
  });
  it("cost = billed + fees not yet billed, currencies kept apart", () => {
    const s = summarizePol263Fees(
      [bill({})],
      [{ id: "f1", date: "2026-08-15", source: "Receipt #1", policyNumber: null, currency: "USD", fee: "0.30", paidWithoutBill: false }, { id: "f2", date: "2026-08-16", source: "Receipt #2", policyNumber: null, currency: "ZAR", fee: "3.50", paidWithoutBill: true }],
      [{ id: "p", date: "2026-08-31", reference: "PV-1 · REQ-1", description: "2.5% platform fee", via: "requisition", currency: "USD", amount: "250.00" }],
      [bill({})],
      [{ currency: "USD", fee: "526.52" }],
    );
    expect(s.billed).toEqual({ USD: "367.60" });
    expect(s.feesNotBilled).toEqual({ USD: "0.30", ZAR: "3.50" });
    expect(s.cost).toEqual({ USD: "367.90", ZAR: "3.50" });
    expect(s.paid).toEqual({ USD: "250.00" });
    expect(s.owedNow).toEqual({ USD: "367.60" });
    expect(s.overdueNow).toEqual({ USD: "367.60" });
    expect(s.buildingUp).toEqual({ USD: "526.52" });
  });
});
