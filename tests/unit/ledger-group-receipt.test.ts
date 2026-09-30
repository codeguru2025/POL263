import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStorage, mockDispatch } = vi.hoisted(() => ({
  mockStorage: {
    getGroup: vi.fn(),
    getPoliciesByGroupId: vi.fn(),
    getCommissionPolicyIdsByDescriptionMarker: vi.fn(),
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

import { ledgerGroupCommissionShares, runLedgerGroupReceiptFollowup, receiptablePolicies } from "../../server/ledger-group-receipt";

describe("ledgerGroupCommissionShares — each agent earns 10% of their policies' share", () => {
  it("one agent on every policy earns exactly 10% of what the group paid", () => {
    const pols = [1, 2, 3].map((i) => ({ id: `p${i}`, agentId: "a1", premiumAmount: "5.00" }));
    const s = ledgerGroupCommissionShares(10000, pols, 10); // USD 100.00
    expect(s.reduce((n, x) => n + x.commissionCents, 0)).toBe(1000);
    expect(s.reduce((n, x) => n + x.shareCents, 0)).toBe(10000);
  });

  it("splits evenly (a society pays what it has, not per premium); walk-ins take a part but earn nobody commission", () => {
    const pols = [
      { id: "p1", agentId: "a1" },
      { id: "p2", agentId: null },
      { id: "p3", agentId: "a2" },
    ];
    const s = ledgerGroupCommissionShares(3000, pols, 10); // USD 30.00
    expect(s).toEqual([
      { policyId: "p1", agentId: "a1", shareCents: 1000, commissionCents: 100 },
      { policyId: "p3", agentId: "a2", shareCents: 1000, commissionCents: 100 },
    ]);
  });

  it("a tiny payment never creates zero-cent commission rows", () => {
    const pols = [1, 2, 3, 4].map((i) => ({ id: `p${i}`, agentId: "a1" }));
    const s = ledgerGroupCommissionShares(20, pols, 10); // USD 0.20 → 2 cents of commission
    expect(s.map((x) => x.commissionCents)).toEqual([1, 1]);
  });

  it("nothing for a zero payment or an empty group", () => {
    expect(ledgerGroupCommissionShares(0, [{ id: "p1", agentId: "a1" }], 10)).toEqual([]);
    expect(ledgerGroupCommissionShares(1000, [], 10)).toEqual([]);
  });

  it("leaves out deleted and cancelled policies", () => {
    expect(receiptablePolicies([
      { id: "a", status: "active" }, { id: "b", status: "cancelled" }, { id: "c", status: "lapsed", deletedAt: new Date() }, { id: "d", status: "grace" },
    ] as any).map((p: any) => p.id)).toEqual(["a", "d"]);
  });
});

describe("runLedgerGroupReceiptFollowup", () => {
  const payload = { receiptId: "r1", receiptNumber: "LGR-20260930-261", groupId: "g1", amount: "30.00", currency: "USD" };
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getGroup.mockResolvedValue({ id: "g1", name: "VUSANANI B/S" });
    mockStorage.getPoliciesByGroupId.mockResolvedValue([
      { id: "p1", clientId: "c1", agentId: "a1", premiumAmount: "5.00", status: "active" },
      { id: "p2", clientId: "c1", agentId: "a1", premiumAmount: "5.00", status: "active" }, // same client, 2 policies
      { id: "p3", clientId: "c2", agentId: null, premiumAmount: "5.00", status: "grace" },
      { id: "p4", clientId: "c3", agentId: "a2", premiumAmount: "5.00", status: "cancelled" },
    ]);
    mockStorage.getCommissionPolicyIdsByDescriptionMarker.mockResolvedValue([]);
    mockStorage.createCommissionLedgerEntry.mockResolvedValue({});
  });

  it("pays the agents and texts each member once", async () => {
    await runLedgerGroupReceiptFollowup("org1", payload);
    const entries = mockStorage.createCommissionLedgerEntry.mock.calls.map((c) => c[0]);
    expect(entries.map((e) => [e.policyId, e.agentId, e.amount])).toEqual([["p1", "a1", "1.00"], ["p2", "a1", "1.00"]]);
    expect(entries[0].description).toContain("lump-sum group receipt LGR-20260930-261");
    expect(mockDispatch.mock.calls.map((c) => [c[1], c[2]])).toEqual([["group_receipt", "c1"], ["group_receipt", "c2"]]);
    expect(mockDispatch.mock.calls[0][3]).toMatchObject({ paymentAmount: "USD 30.00", groupName: "VUSANANI B/S" });
  });

  it("only ticked members are texted and share the commission", async () => {
    await runLedgerGroupReceiptFollowup("org1", { ...payload, includedPolicyIds: ["p1", "p3"] });
    const entries = mockStorage.createCommissionLedgerEntry.mock.calls.map((c) => c[0]);
    expect(entries.map((e) => [e.policyId, e.amount])).toEqual([["p1", "1.50"]]); // 10% of 30 = 3.00 over 2; p3 is a walk-in
    expect(mockDispatch.mock.calls.map((c) => c[2])).toEqual(["c1", "c2"]);
  });

  it("the retry marker for receipt …-100 doesn't match …-1000", async () => {
    await runLedgerGroupReceiptFollowup("org1", { ...payload, receiptNumber: "LGR-20260930-100" });
    const marker = mockStorage.getCommissionPolicyIdsByDescriptionMarker.mock.calls[0][1] as string;
    const otherDescription = mockStorage.createCommissionLedgerEntry.mock.calls[0][0].description.replace("-100 ", "-1000 ");
    expect(otherDescription.includes(marker)).toBe(false);
  });

  it("an outbox retry doesn't pay commission twice", async () => {
    mockStorage.getCommissionPolicyIdsByDescriptionMarker.mockResolvedValue(["p1", "p2"]);
    await runLedgerGroupReceiptFollowup("org1", payload);
    expect(mockStorage.createCommissionLedgerEntry).not.toHaveBeenCalled();
  });
});
