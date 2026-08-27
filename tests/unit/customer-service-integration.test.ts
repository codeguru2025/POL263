import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from "vitest";

// A valid 32-byte key (64 hex chars) for the real AES-256-GCM helper used by the token +
// credential encryption. Set before the module under test lazily reads it.
process.env.TENANT_CONFIG_ENCRYPTION_KEY =
  process.env.TENANT_CONFIG_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

// ─── mocks ───────────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("../../server/control-plane-db", () => {
  const chain = (): any => {
    const p: any = Promise.resolve(h.rows);
    p.from = () => chain();
    p.where = () => chain();
    p.limit = () => Promise.resolve(h.rows);
    return p;
  };
  return {
    cpDb: {
      select: () => chain(),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    },
    cpPool: { end: vi.fn() },
  };
});

vi.mock("../../server/storage", () => ({
  storage: {
    getPolicyByNumber: vi.fn(),
    getClient: vi.fn(),
  },
}));

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/route-helpers", () => ({ platformAuditLog: vi.fn() }));

import { storage } from "../../server/storage";
import {
  authenticateCustomerServiceRequest,
  verifyCustomer,
  handleVerifyRequest,
  issueVerificationToken,
  verifyCustomerServiceToken,
  __test,
} from "../../server/customer-service-integration";

// ─── helpers ─────────────────────────────────────────────────────────────────

function mockReq(overrides: Record<string, any> = {}) {
  return { headers: {}, body: {}, ip: "1.2.3.4", requestId: "req-test", ...overrides };
}
function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const SECRET_A = "shared-secret-for-org-a";

const goodPolicy = {
  id: "policy-1",
  organizationId: ORG_A,
  clientId: "client-1",
  policyNumber: "POL-001",
  status: "active",
};
const goodClient = {
  id: "client-1",
  organizationId: ORG_A,
  title: "Mr",
  firstName: "Tendai",
  lastName: "Moyo",
  nationalId: "08833089H38",
  phone: "+263 71 217 1267",
};

beforeAll(() => {
  process.env.TENANT_CONFIG_ENCRYPTION_KEY =
    "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
});

beforeEach(() => {
  h.rows = [{ id: "int-1", tenantId: ORG_A, provider: "customer_service", isActive: true, config: { sharedSecret: SECRET_A } }];
  vi.mocked(storage.getPolicyByNumber).mockReset();
  vi.mocked(storage.getClient).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── verification token (AES-256-GCM, opaque) ────────────────────────────────

describe("verification token", () => {
  it("round-trips valid claims and is opaque (no readable ids)", () => {
    const { token, expiresIn } = issueVerificationToken({ orgId: ORG_A, clientId: "client-1", policyId: "policy-1" });
    expect(expiresIn).toBe(900);
    expect(token).not.toContain("client-1");
    expect(token).not.toContain("policy-1");
    expect(token).not.toContain(ORG_A);
    expect(verifyCustomerServiceToken(token)).toEqual({ orgId: ORG_A, clientId: "client-1", policyId: "policy-1" });
  });

  it("rejects a tampered token", () => {
    const { token } = issueVerificationToken({ orgId: ORG_A, clientId: "c1", policyId: "p1" });
    const tampered = token.slice(0, -2) + (token.endsWith("A") ? "B" : "A") + token.slice(-1);
    expect(verifyCustomerServiceToken(tampered)).toBeNull();
  });

  it("rejects a garbage / malformed token", () => {
    expect(verifyCustomerServiceToken("not-a-token")).toBeNull();
    expect(verifyCustomerServiceToken("")).toBeNull();
    expect(verifyCustomerServiceToken(undefined as any)).toBeNull();
  });

  it("rejects an expired token", () => {
    const { token } = issueVerificationToken({ orgId: ORG_A, clientId: "c1", policyId: "p1" });
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 901_000);
    expect(verifyCustomerServiceToken(token)).toBeNull();
  });
});

// ─── matching helpers ────────────────────────────────────────────────────────

describe("matching helpers", () => {
  it("phoneMatches compares the last 9 digits, ignoring formatting/country code", () => {
    expect(__test.phoneMatches("+263712171267", "0712171267")).toBe(true);
    expect(__test.phoneMatches("071 217 1267", "263-71-217-1267")).toBe(true);
    expect(__test.phoneMatches("0712171267", "0719999999")).toBe(false);
    expect(__test.phoneMatches(null, "0712171267")).toBe(false);
    expect(__test.phoneMatches("12345", "12345")).toBe(false); // too short
  });

  it("nationalIdMatches is case/whitespace-insensitive and rejects empties", () => {
    expect(__test.nationalIdMatches("08833089h38", "  08833089H38 ")).toBe(true);
    expect(__test.nationalIdMatches("08833089H38", "63-7654321Z00")).toBe(false);
    expect(__test.nationalIdMatches(null, "08833089H38")).toBe(false);
    expect(__test.nationalIdMatches("08833089H38", "")).toBe(false);
  });

  it("constantTimeEqual returns true only for identical strings", () => {
    expect(__test.constantTimeEqual("abc", "abc")).toBe(true);
    expect(__test.constantTimeEqual("abc", "abd")).toBe(false);
    expect(__test.constantTimeEqual("abc", "abcd")).toBe(false);
  });
});

// ─── authenticateCustomerServiceRequest ─────────────────────────────────────

describe("authenticateCustomerServiceRequest", () => {
  it("resolves the tenant from a correct bearer secret", async () => {
    const req = mockReq({ headers: { authorization: `Bearer ${SECRET_A}` } });
    expect(await authenticateCustomerServiceRequest(req as any)).toEqual({ orgId: ORG_A });
  });

  it("returns null for a wrong secret", async () => {
    const req = mockReq({ headers: { authorization: "Bearer wrong-secret" } });
    expect(await authenticateCustomerServiceRequest(req as any)).toBeNull();
  });

  it("returns null when no Authorization header is present", async () => {
    expect(await authenticateCustomerServiceRequest(mockReq() as any)).toBeNull();
  });

  it("returns null when the header is not a Bearer token", async () => {
    const req = mockReq({ headers: { authorization: SECRET_A } });
    expect(await authenticateCustomerServiceRequest(req as any)).toBeNull();
  });

  it("ignores rows with no plaintext secret", async () => {
    h.rows = [{ id: "int-1", tenantId: ORG_A, isActive: true, config: {} }];
    const req = mockReq({ headers: { authorization: "Bearer " } });
    expect(await authenticateCustomerServiceRequest(req as any)).toBeNull();
  });
});

// ─── verifyCustomer (core) ───────────────────────────────────────────────────

describe("verifyCustomer", () => {
  it("verifies a correct three-way match and returns the raw policy status", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const result = await verifyCustomer(ORG_A, { policyNumber: "pol-001", identityNumber: "08833089H38", phoneNumber: "+263712171267" });
    expect(result).toMatchObject({ verified: true, customerName: "Mr Tendai Moyo", policyNumber: "POL-001", policyStatus: "active" });
  });

  it("fails when the policy number is unknown", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(undefined as any);
    const result = await verifyCustomer(ORG_A, { policyNumber: "NOPE", identityNumber: "08833089H38", phoneNumber: "+263712171267" });
    expect(result).toEqual({ verified: false });
    expect(storage.getClient).not.toHaveBeenCalled();
  });

  it("fails when the identity number does not match", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const result = await verifyCustomer(ORG_A, { policyNumber: "POL-001", identityNumber: "63-0000000Z00", phoneNumber: "+263712171267" });
    expect(result).toEqual({ verified: false });
  });

  it("fails when the phone number does not match", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const result = await verifyCustomer(ORG_A, { policyNumber: "POL-001", identityNumber: "08833089H38", phoneNumber: "0779999999" });
    expect(result).toEqual({ verified: false });
  });

  it("fails (legacy) when the client has no national ID on file", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue({ ...goodClient, nationalId: null } as any);
    expect(await verifyCustomer(ORG_A, { policyNumber: "POL-001", identityNumber: "08833089H38", phoneNumber: "+263712171267" })).toEqual({ verified: false });
  });

  it("fails (legacy) when the client has no phone on file", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue({ ...goodClient, phone: null } as any);
    expect(await verifyCustomer(ORG_A, { policyNumber: "POL-001", identityNumber: "08833089H38", phoneNumber: "+263712171267" })).toEqual({ verified: false });
  });

  it("never crosses tenants even if a policy row from another org is returned", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue({ ...goodPolicy, organizationId: ORG_B } as any);
    const result = await verifyCustomer(ORG_A, { policyNumber: "POL-001", identityNumber: "08833089H38", phoneNumber: "+263712171267" });
    expect(result).toEqual({ verified: false });
  });
});

// ─── handleVerifyRequest (HTTP) ─────────────────────────────────────────────

describe("handleVerifyRequest", () => {
  it("returns 401 for a missing/invalid credential and does not touch tenant data", async () => {
    const res = mockRes();
    await handleVerifyRequest(mockReq({ body: { policy_number: "POL-001", identity_number: "x", phone_number: "y" } }) as any, res as any);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "unauthorized" });
    expect(storage.getPolicyByNumber).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body once authenticated", async () => {
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({ headers: { authorization: `Bearer ${SECRET_A}` }, body: { policy_number: "POL-001" } }) as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "invalid_request" });
  });

  it("returns the nested success envelope with an opaque token, scoped to the secret's tenant", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({
        headers: { authorization: `Bearer ${SECRET_A}` },
        body: { policy_number: "POL-001", identity_number: "08833089H38", phone_number: "+263712171267" },
      }) as any,
      res as any,
    );
    expect(storage.getPolicyByNumber).toHaveBeenCalledWith("POL-001", ORG_A);
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload).toMatchObject({
      verified: true,
      expires_in: 900,
      customer: { name: "Mr Tendai Moyo" },
      policy: { policy_number: "POL-001", status: "active" },
    });
    expect(typeof payload.verification_token).toBe("string");
    expect(verifyCustomerServiceToken(payload.verification_token)).toEqual({ orgId: ORG_A, clientId: "client-1", policyId: "policy-1" });
  });

  it("returns a generic failure (no detail) when the ID is wrong", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({
        headers: { authorization: `Bearer ${SECRET_A}` },
        body: { policy_number: "POL-001", identity_number: "63-9999999Z99", phone_number: "+263712171267" },
      }) as any,
      res as any,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ verified: false, message: "We could not verify the details provided." });
  });

  it("returns the same generic failure when the phone is wrong", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue(goodClient as any);
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({
        headers: { authorization: `Bearer ${SECRET_A}` },
        body: { policy_number: "POL-001", identity_number: "08833089H38", phone_number: "+263770000000" },
      }) as any,
      res as any,
    );
    expect(res.json).toHaveBeenCalledWith({ verified: false, message: "We could not verify the details provided." });
  });

  it("returns the same generic failure when the policy does not exist", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(undefined as any);
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({
        headers: { authorization: `Bearer ${SECRET_A}` },
        body: { policy_number: "GHOST", identity_number: "08833089H38", phone_number: "+263712171267" },
      }) as any,
      res as any,
    );
    expect(res.json).toHaveBeenCalledWith({ verified: false, message: "We could not verify the details provided." });
  });

  it("returns the same generic failure when the client is missing an ID (legacy)", async () => {
    vi.mocked(storage.getPolicyByNumber).mockResolvedValue(goodPolicy as any);
    vi.mocked(storage.getClient).mockResolvedValue({ ...goodClient, nationalId: null } as any);
    const res = mockRes();
    await handleVerifyRequest(
      mockReq({
        headers: { authorization: `Bearer ${SECRET_A}` },
        body: { policy_number: "POL-001", identity_number: "08833089H38", phone_number: "+263712171267" },
      }) as any,
      res as any,
    );
    expect(res.json).toHaveBeenCalledWith({ verified: false, message: "We could not verify the details provided." });
  });
});
