import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStorage, mockDispatch } = vi.hoisted(() => ({
  mockStorage: {
    getGroup: vi.fn(),
    getPoliciesByGroupId: vi.fn(),
    hasCommissionWithDescriptionMarker: vi.fn(),
    createCommissionLedgerEntry: vi.fn(),
  },
  mockDispatch: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: mockStorage }));
vi.mock("../../server/user-notifications", () => ({ notifyUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../server/notifications", () => ({
  dispatchNotification: (...a: any[]) => mockDispatch(...a),
  buildPolicyContext: async (p: any, _org: string, extra: any) => ({ policyId: p.id, ...extra }),
}));

import { ledgerGroupCommissionCents, runLedgerGroupReceiptFollowup, receiptablePolicies } from "../../server/ledger-group-receipt";

describe("ledgerGroupCommissionCents — the society's agent earns a % of what the group paid", () => {
  it("10% of the payment, to the cent", () => {
    expect(ledgerGroupCommissionCents(10000, 10)).toBe(1000); // USD 100.00 → 10.00
    expect(ledgerGroupCommissionCents(4545, 10)).toBe(455);   // USD 45.45 → 4.55 (rounded)
  });
  it("nothing on a zero payment or a zero rate", () => {
    expect(ledgerGroupCommissionCents(0, 10)).toBe(0);
    expect(ledgerGroupCommissionCents(1000, 0)).toBe(0);
  });
  it("leaves out deleted and cancelled policies when texting", () => {
    expect(receiptablePolicies([
      { id: "a", status: "active" }, { id: "b", status: "cancelled" }, { id: "c", status: "lapsed", deletedAt: new Date() }, { id: "d", status: "grace" },
    ] as any).map((p: any) => p.id)).toEqual(["a", "d"]);
  });
});

describe("runLedgerGroupReceiptFollowup", () => {
  const payload = { receiptId: "r1", receiptNumber: "LGR-20260930-100", groupId: "g1", amount: "30.00", currency: "USD" };
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getGroup.mockResolvedValue({ id: "g1", name: "VUSANANI B/S", agentId: "a1" });
    mockStorage.getPoliciesByGroupId.mockResolvedValue([
      { id: "p1", clientId: "c1", agentId: "a1", status: "active" },
      { id: "p2", clientId: "c1", agentId: "a1", status: "active" }, // same client, 2 policies
      { id: "p3", clientId: "c2", agentId: null, status: "grace" },
      { id: "p4", clientId: "c3", agentId: "a2", status: "cancelled" },
    ]);
    mockStorage.hasCommissionWithDescriptionMarker.mockResolvedValue(false);
    mockStorage.createCommissionLedgerEntry.mockResolvedValue({});
  });

  it("pays the group's agent one entry of 10% of the payment, and texts each member once", async () => {
    await runLedgerGroupReceiptFollowup("org1", payload);
    const entries = mockStorage.createCommissionLedgerEntry.mock.calls.map((c) => c[0]);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ agentId: "a1", policyId: null, amount: "3.00", currency: "USD" });
    expect(mockDispatch.mock.calls.map((c) => [c[1], c[2]])).toEqual([["group_receipt", "c1"], ["group_receipt", "c2"]]);
    expect(mockDispatch.mock.calls[0][3]).toMatchObject({ paymentAmount: "USD 30.00", groupName: "VUSANANI B/S" });
  });

  it("commission doesn't depend on who was ticked — only ticked members are texted", async () => {
    await runLedgerGroupReceiptFollowup("org1", { ...payload, includedPolicyIds: ["p3"] });
    expect(mockStorage.createCommissionLedgerEntry.mock.calls[0][0].amount).toBe("3.00");
    expect(mockDispatch.mock.calls.map((c) => c[2])).toEqual(["c2"]);
  });

  it("a group with no agent pays nobody, but members are still texted", async () => {
    mockStorage.getGroup.mockResolvedValue({ id: "g1", name: "VUSANANI B/S", agentId: null });
    await runLedgerGroupReceiptFollowup("org1", payload);
    expect(mockStorage.createCommissionLedgerEntry).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledTimes(2);
  });

  it("the retry marker for receipt …-100 doesn't match …-1000", async () => {
    await runLedgerGroupReceiptFollowup("org1", payload);
    const marker = mockStorage.hasCommissionWithDescriptionMarker.mock.calls[0][1] as string;
    const other = mockStorage.createCommissionLedgerEntry.mock.calls[0][0].description.replace("-100 ", "-1000 ");
    expect(mockStorage.createCommissionLedgerEntry.mock.calls[0][0].description.includes(marker)).toBe(true);
    expect(other.includes(marker)).toBe(false);
  });

  it("an outbox retry doesn't pay the agent twice", async () => {
    mockStorage.hasCommissionWithDescriptionMarker.mockResolvedValue(true);
    await runLedgerGroupReceiptFollowup("org1", payload);
    expect(mockStorage.createCommissionLedgerEntry).not.toHaveBeenCalled();
  });
});

describe("commission goes to the agent recorded on the receipt", () => {
  const base = { receiptId: "r1", receiptNumber: "LGR-20260930-200", groupId: "g1", amount: "50.00", currency: "USD" };
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getGroup.mockResolvedValue({ id: "g1", name: "VUSANANI B/S", agentId: "a-new" });
    mockStorage.getPoliciesByGroupId.mockResolvedValue([]);
    mockStorage.hasCommissionWithDescriptionMarker.mockResolvedValue(false);
    mockStorage.createCommissionLedgerEntry.mockResolvedValue({});
  });
  it("agent changed after the receipt → the receipt-time agent still earns", async () => {
    await runLedgerGroupReceiptFollowup("org1", { ...base, agentId: "a-old" });
    expect(mockStorage.createCommissionLedgerEntry.mock.calls[0][0]).toMatchObject({ agentId: "a-old", amount: "5.00" });
  });
  it("no agent at receipt time → nobody earns, even if one is set later", async () => {
    await runLedgerGroupReceiptFollowup("org1", { ...base, agentId: null });
    expect(mockStorage.createCommissionLedgerEntry).not.toHaveBeenCalled();
  });
  it("older jobs without the field fall back to the group's agent", async () => {
    await runLedgerGroupReceiptFollowup("org1", base);
    expect(mockStorage.createCommissionLedgerEntry.mock.calls[0][0].agentId).toBe("a-new");
  });
});
