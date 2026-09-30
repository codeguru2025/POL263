import { describe, it, expect, vi, beforeEach } from "vitest";

const created: any[] = [];
vi.mock("../../server/storage", () => ({
  storage: {
    hasCommissionLedgerForTransaction: vi.fn(async () => false),
    getPaymentsByPolicy: vi.fn(async () => [
      { id: "tx1", status: "cleared", paymentMethod: "cash", periodFrom: "2026-09-01", periodTo: "2026-09-30", createdAt: "2026-09-01T10:00:00Z", currency: "USD" },
    ]),
    getGroup: vi.fn(async () => ({ id: "g1", isLegacy: false })),
    getProductVersion: vi.fn(async () => undefined),
    getProduct: vi.fn(async () => undefined),
    getCommissionPlans: vi.fn(async () => []),
    createCommissionLedgerEntry: vi.fn(async (e: any) => { created.push(e); return e; }),
  },
}));
vi.mock("../../server/db", () => ({ pool: {}, db: {} }));
vi.mock("../../server/control-plane-db", () => ({ cpDb: {}, cpPool: {} }));
vi.mock("../../server/user-notifications", () => ({ notifyUser: vi.fn(async () => {}), notifyUsersWithPermission: vi.fn(async () => {}) }));

import { recordAgentCommission } from "../../server/route-helpers";

const base = { id: "p1", policyNumber: "FLK1", paymentSchedule: "monthly", currency: "USD", isLegacy: false, productVersionId: null };

describe("recordAgentCommission — walk-in (Augustus, 2026-09-30)", () => {
  beforeEach(() => { created.length = 0; });

  it("pays the policy's agent", async () => {
    await recordAgentCommission("org", { ...base, agentId: "a1", groupId: null }, "tx1", "12.00");
    expect(created).toHaveLength(1);
    expect(created[0].agentId).toBe("a1");
    expect(created[0].amount).toBe("6.00");
  });

  it("records a walk-in policy's commission against the company account (agentId null)", async () => {
    await recordAgentCommission("org", { ...base, agentId: null, groupId: null }, "tx1", "12.00");
    expect(created).toHaveLength(1);
    expect(created[0].agentId).toBeNull();
    expect(created[0].amount).toBe("6.00");
    expect(created[0].description).toMatch(/^Walk-in \(company\)/);
  });

  it("gives nothing to a society member with no agent (societies earn only via a group agent)", async () => {
    await recordAgentCommission("org", { ...base, agentId: null, groupId: "g1" }, "tx1", "12.00");
    expect(created).toHaveLength(0);
  });
});
