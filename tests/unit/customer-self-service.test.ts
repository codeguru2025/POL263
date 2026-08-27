import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const mkValues = (rows: any[]) => {
    const p: any = Promise.resolve(undefined);
    p.returning = async () => rows;
    return p;
  };
  const tx = {
    execute: vi.fn(async () => ({ rows: [{ claim_next: 7 }] })),
    insert: vi.fn(() => ({ values: vi.fn((v: any) => mkValues([{ ...v, id: "claim-123" }])) })),
  };
  return {
    tx,
    getPolicy: vi.fn(),
    getDependentsByClient: vi.fn(),
    updatePolicy: vi.fn(async () => ({})),
  };
});

vi.mock("../../server/tenant-db", () => ({
  withOrgTransaction: vi.fn(async (_org: string, fn: (tx: any) => any) => fn(h.tx)),
  getDbForOrg: vi.fn(),
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/storage", () => ({
  storage: {
    getPolicy: h.getPolicy,
    getDependentsByClient: h.getDependentsByClient,
    updatePolicy: h.updatePolicy,
  },
}));

import {
  submitClientClaim,
  setPolicyBeneficiary,
  CustomerInputError,
  CustomerForbiddenError,
} from "../../server/customer-self-service";
import { storage } from "../../server/storage";

const ORG = "11111111-1111-1111-1111-111111111111";
const CLIENT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const POLICY_ID = "99999999-9999-9999-9999-999999999999";
const ownPolicy = { id: POLICY_ID, organizationId: ORG, clientId: CLIENT, policyNumber: "FLK00001", status: "active" };

beforeEach(() => {
  vi.clearAllMocks();
  h.tx.execute.mockResolvedValue({ rows: [{ claim_next: 7 }] });
});

describe("submitClientClaim", () => {
  it("creates a claim with an allocated CLM-NNNNNN number and a status-history row", async () => {
    vi.mocked(storage.getPolicy).mockResolvedValue(ownPolicy as any);
    const claim = await submitClientClaim(ORG, CLIENT, {
      policyId: POLICY_ID,
      claimType: "death",
      deceasedName: "John Doe",
      dateOfDeath: "2026-08-01",
    });
    expect(claim.claimNumber).toBe("CLM-000007");
    expect(h.tx.insert).toHaveBeenCalledTimes(2); // claims + claim_status_history
  });

  it("defaults the status-history reason to the client-portal wording (unchanged)", async () => {
    vi.mocked(storage.getPolicy).mockResolvedValue(ownPolicy as any);
    await submitClientClaim(ORG, CLIENT, { policyId: POLICY_ID, claimType: "death" });
    const statusHistoryCall = h.tx.insert.mock.results[1].value.values.mock.calls[0][0];
    expect(statusHistoryCall.reason).toBe("Submitted via client portal");
  });

  it("uses the supplied source in the status-history reason when given", async () => {
    vi.mocked(storage.getPolicy).mockResolvedValue(ownPolicy as any);
    await submitClientClaim(ORG, CLIENT, { policyId: POLICY_ID, claimType: "death" }, "customer service");
    const statusHistoryCall = h.tx.insert.mock.results[1].value.values.mock.calls[0][0];
    expect(statusHistoryCall.reason).toBe("Submitted via customer service");
  });

  it("throws CustomerInputError when policyId or claimType is missing", async () => {
    await expect(submitClientClaim(ORG, CLIENT, { claimType: "death" })).rejects.toBeInstanceOf(CustomerInputError);
    await expect(submitClientClaim(ORG, CLIENT, { policyId: POLICY_ID })).rejects.toBeInstanceOf(CustomerInputError);
  });

  it("throws CustomerForbiddenError when the policy is not the client's", async () => {
    vi.mocked(storage.getPolicy).mockResolvedValue({ ...ownPolicy, clientId: "someone-else" } as any);
    await expect(submitClientClaim(ORG, CLIENT, { policyId: POLICY_ID, claimType: "death" }))
      .rejects.toBeInstanceOf(CustomerForbiddenError);
  });

  it("throws CustomerForbiddenError when the policy does not exist", async () => {
    vi.mocked(storage.getPolicy).mockResolvedValue(undefined as any);
    await expect(submitClientClaim(ORG, CLIENT, { policyId: "nope", claimType: "death" }))
      .rejects.toBeInstanceOf(CustomerForbiddenError);
  });
});

describe("setPolicyBeneficiary", () => {
  it("sets a named beneficiary and returns 'Beneficiary set'", async () => {
    const res = await setPolicyBeneficiary(ORG, CLIENT, ownPolicy as any, {
      firstName: " Jane ", lastName: " Doe ", relationship: "spouse", nationalId: "12-345678A90", phone: "0771234567",
    });
    expect(res).toEqual({ message: "Beneficiary set" });
    expect(storage.updatePolicy).toHaveBeenCalledWith(
      POLICY_ID,
      expect.objectContaining({ beneficiaryFirstName: "Jane", beneficiaryLastName: "Doe", beneficiaryDependentId: null }),
      ORG,
    );
  });

  it("appoints a dependent as beneficiary", async () => {
    vi.mocked(storage.getDependentsByClient).mockResolvedValue([
      { id: "dep-1", firstName: "Kid", lastName: "Doe", relationship: "child", nationalId: null },
    ] as any);
    const res = await setPolicyBeneficiary(ORG, CLIENT, ownPolicy as any, { dependentId: "dep-1" });
    expect(res).toEqual({ message: "Dependent appointed as beneficiary" });
    expect(storage.updatePolicy).toHaveBeenCalledWith(
      POLICY_ID,
      expect.objectContaining({ beneficiaryFirstName: "Kid", beneficiaryDependentId: "dep-1", beneficiaryPhone: null }),
      ORG,
    );
  });

  it("throws CustomerInputError when the dependent is not found", async () => {
    vi.mocked(storage.getDependentsByClient).mockResolvedValue([] as any);
    await expect(setPolicyBeneficiary(ORG, CLIENT, ownPolicy as any, { dependentId: "ghost" }))
      .rejects.toBeInstanceOf(CustomerInputError);
  });

  it("throws CustomerInputError when first/last name are missing on the named path", async () => {
    await expect(setPolicyBeneficiary(ORG, CLIENT, ownPolicy as any, { firstName: "Jane" }))
      .rejects.toBeInstanceOf(CustomerInputError);
    expect(storage.updatePolicy).not.toHaveBeenCalled();
  });
});
