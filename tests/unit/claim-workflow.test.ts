import { describe, it, expect, vi, beforeEach } from "vitest";

const { storageMock, withOrgTransaction, dispatchNotification, getDbForOrg } = vi.hoisted(() => ({
  storageMock: {
    getClaim: vi.fn(),
    getUserEffectivePermissions: vi.fn(),
    getPolicy: vi.fn(),
    getClient: vi.fn(),
  },
  withOrgTransaction: vi.fn(),
  dispatchNotification: vi.fn(async (..._args: any[]) => {}),
  getDbForOrg: vi.fn(),
}));

vi.mock("../../server/storage", () => ({ storage: storageMock }));
vi.mock("../../server/tenant-db", () => ({
  withOrgTransaction: (...args: any[]) => withOrgTransaction(...args),
  getDbForOrg: (...args: any[]) => getDbForOrg(...args),
  resolveOrSyncTenantUserId: vi.fn(async (_org: string, id: string) => id),
  ensureRegistryUserMirroredToOrgDataDb: vi.fn(async () => {}),
}));
vi.mock("../../server/route-helpers", () => ({
  auditLog: vi.fn(),
  resolvePolicyWaitingPeriodEndDate: vi.fn(async () => null),
}));
vi.mock("../../server/date-utils", () => ({ todayForOrg: vi.fn(async () => "2026-09-25") }));
vi.mock("../../server/user-notifications", () => ({ notifyUser: vi.fn(async () => {}), notifyUsersWithPermission: vi.fn(async () => {}) }));
vi.mock("../../server/notifications", () => ({
  notifyClientPush: vi.fn(async () => {}),
  dispatchNotification: (...args: any[]) => dispatchNotification(...args),
}));

import { transitionClaim, ledgerDebitFor, notifyClientOfClaim, ClaimWorkflowError } from "../../server/claim-workflow";
import { VALID_CLAIM_TRANSITIONS } from "../../shared/schema";

const baseClaim = {
  id: "c1", organizationId: "org1", policyId: "p1", clientId: "cl1", claimNumber: "CLM-000001",
  status: "submitted", submittedBy: "maker", verifiedBy: null, currency: "USD", cashInLieuAmount: "500",
  groupId: null, policyMemberId: null, fraudFlags: null, dateOfDeath: "2026-09-01",
};
const req = (id = "approver", isPlatformOwner = false) => ({ user: { id, organizationId: "org1", isPlatformOwner } });

async function expectRejection(p: Promise<unknown>, status: number, match?: RegExp) {
  try {
    await p;
    throw new Error("expected transitionClaim to throw");
  } catch (err: any) {
    expect(err).toBeInstanceOf(ClaimWorkflowError);
    expect(err.status).toBe(status);
    if (match) expect(err.message).toMatch(match);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getClaim.mockResolvedValue({ ...baseClaim });
  storageMock.getUserEffectivePermissions.mockResolvedValue(["write:claim", "approve:claim"]);
  storageMock.getClient.mockResolvedValue(null);
});

describe("claim transitions", () => {
  it("lets further investigation go back for approval, and approval be reached from submitted", () => {
    expect(VALID_CLAIM_TRANSITIONS.submitted).toEqual(expect.arrayContaining(["under_investigation", "approved", "rejected"]));
    expect(VALID_CLAIM_TRANSITIONS.verified).toContain("under_investigation");
    expect(VALID_CLAIM_TRANSITIONS.under_investigation).toEqual(["verified", "rejected"]);
    // An investigated claim can't jump straight to approved — it must be sent back first.
    expect(VALID_CLAIM_TRANSITIONS.under_investigation).not.toContain("approved");
  });
});

describe("transitionClaim guard rails (checked before anything is written)", () => {
  it("rejects a move the workflow doesn't allow", async () => {
    await expectRejection(transitionClaim({ req: req(), claimId: "c1", toStatus: "paid", source: "claims" }), 400);
    expect(withOrgTransaction).not.toHaveBeenCalled();
  });

  it("requires a reason to decline", async () => {
    await expectRejection(transitionClaim({ req: req(), claimId: "c1", toStatus: "rejected", source: "claims" }), 400, /reason/i);
  });

  it("requires what's being investigated and the next steps", async () => {
    await expectRejection(
      transitionClaim({ req: req(), claimId: "c1", toStatus: "under_investigation", investigationReason: "Dates don't match", source: "claims" }),
      400, /next steps/i,
    );
  });

  it("requires findings before an investigated claim goes back for approval", async () => {
    storageMock.getClaim.mockResolvedValue({ ...baseClaim, status: "under_investigation" });
    await expectRejection(transitionClaim({ req: req(), claimId: "c1", toStatus: "verified", source: "claims" }), 400, /findings/i);
  });

  it("won't let the person who logged the claim approve it", async () => {
    await expectRejection(transitionClaim({ req: req("maker"), claimId: "c1", toStatus: "approved", source: "claims" }), 403);
  });

  it("needs the claim approval permission for any decision taken from the Approvals queue", async () => {
    storageMock.getUserEffectivePermissions.mockResolvedValue(["approve:requests"]);
    await expectRejection(
      transitionClaim({ req: req(), claimId: "c1", toStatus: "rejected", reason: "Not covered", source: "approvals" }),
      403,
    );
  });

  it("proceeds to the transaction once the inputs are valid", async () => {
    withOrgTransaction.mockResolvedValue({ claim: { ...baseClaim, status: "rejected" }, ledger: null });
    const result = await transitionClaim({ req: req(), claimId: "c1", toStatus: "rejected", reason: "Not covered", source: "approvals" });
    expect(withOrgTransaction).toHaveBeenCalledTimes(1);
    expect(result.claim.status).toBe("rejected");
  });
});

describe("ledgerDebitFor — what a ledger-group claim deducts", () => {
  const society = { name: "Mhondoro Burial Society", type: "burial_society" };
  const legacy = { name: "Chitungwiza Legacy", type: "community" };

  it("a burial society claim can't be approved without a cash-service quote", () => {
    expect(() => ledgerDebitFor(society, null, { cashInLieuAmount: "300", currency: "USD" }))
      .toThrow(/cash-service quote/);
  });

  it("deducts the quote's grand total (not the typed claim amount) when a quote is attached", () => {
    const d = ledgerDebitFor(society, { quotationNumber: "QT-9", currency: "USD", grandTotal: "845.50", total: "800" }, { cashInLieuAmount: "300", currency: "USD" });
    expect(d).toEqual({ amount: 845.5, currency: "USD", quotationNumber: "QT-9" });
  });

  it("falls back to the legacy total when a quote has no grand total", () => {
    const d = ledgerDebitFor(society, { quotationNumber: "QT-1", currency: "ZAR", grandTotal: "0", total: "1200" }, { currency: "USD" });
    expect(d.amount).toBe(1200);
    expect(d.currency).toBe("ZAR");
  });

  it("a legacy group without a quote deducts the claim amount", () => {
    expect(ledgerDebitFor(legacy, null, { cashInLieuAmount: "250.00", currency: "USD" }).amount).toBe(250);
  });

  it("refuses to approve when there's nothing to deduct", () => {
    expect(() => ledgerDebitFor(legacy, null, { cashInLieuAmount: null, currency: "USD" })).toThrow(/no amount to deduct/);
  });
});

describe("notifyClientOfClaim — the client SMS", () => {
  const fakeDb = (informantPhone: string | null) => ({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => (informantPhone === null ? [] : [{ informantPhone }]) }) }) }),
  });

  it("uses plain wording and falls back to the funeral-case informant's phone", async () => {
    getDbForOrg.mockResolvedValue(fakeDb("0771112222"));
    storageMock.getClient.mockResolvedValue({ firstName: "Judith", lastName: "Ncube", phone: null });
    await notifyClientOfClaim("org1", { id: "c1", clientId: "cl1", claimNumber: "CLM-000003", policyId: "p1" }, "rejected");
    expect(dispatchNotification).toHaveBeenCalledWith("org1", "claim_status_change", "cl1", expect.objectContaining({
      claimNumber: "CLM-000003", status: "Declined", clientName: "Judith Ncube", fallbackPhone: "0771112222",
    }));
  });

  it("says Received when a claim is first logged, with no fallback when there's no funeral case", async () => {
    getDbForOrg.mockResolvedValue(fakeDb(null));
    storageMock.getClient.mockResolvedValue({ firstName: "A", lastName: "B", phone: "0770000000" });
    await notifyClientOfClaim("org1", { id: "c1", clientId: "cl1", claimNumber: "CLM-9", policyId: "p1" }, "submitted");
    expect(dispatchNotification).toHaveBeenCalledWith("org1", "claim_status_change", "cl1", expect.objectContaining({ status: "Received", fallbackPhone: undefined }));
  });

  it("does nothing for a claim with no client", async () => {
    await notifyClientOfClaim("org1", { id: "c1", clientId: null as any, claimNumber: "CLM-9", policyId: "p1" }, "approved");
    expect(dispatchNotification).not.toHaveBeenCalled();
  });
});
