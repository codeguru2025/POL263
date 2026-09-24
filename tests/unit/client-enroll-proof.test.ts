import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test for the 2026-09-24 account-takeover fix: /api/client-auth/enroll used to trust
// clientId alone (never re-checking the activation code /claim had verified), so anyone who
// learned an unenrolled client's id could set that client's portal password.

const h = vi.hoisted(() => ({
  client: null as any,
  policy: null as any,
  updateClient: vi.fn(),
}));

vi.mock("../../server/storage", () => ({
  storage: {
    getOrganizations: vi.fn(async () => [{ id: "org-1", slug: "org" }]),
    getClient: vi.fn(async (id: string) => (h.client && h.client.id === id ? h.client : undefined)),
    getPolicyByNumber: vi.fn(async (num: string) => (h.policy && h.policy.policyNumber === num ? h.policy : undefined)),
    getSecurityQuestions: vi.fn(async () => [{ id: "11111111-1111-4111-8111-111111111111" }]),
    updateClient: h.updateClient,
    getPoliciesByClient: vi.fn(async () => []),
    getUserByReferralCode: vi.fn(async () => undefined),
    getOrganization: vi.fn(async () => ({ id: "org-1", name: "Org" })),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("argon2", () => ({ default: { hash: vi.fn(async (v: string) => `hashed:${v}`), verify: vi.fn(), argon2id: 2 } }));
vi.mock("../../server/payment-service", () => ({ createPaymentIntent: vi.fn(), initiatePaynowPayment: vi.fn(), pollPaynowStatus: vi.fn() }));
vi.mock("../../server/paynow-config", () => ({ getPaynowConfig: vi.fn(), getOrgPaynowConfig: vi.fn() }));
vi.mock("../../server/policy-document", () => ({ streamPolicyDocumentToResponse: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/policy-activity-log", () => ({ logPolicyView: vi.fn() }));
vi.mock("../../server/policy-balance", () => ({ enrichPoliciesWithBalance: vi.fn() }));
vi.mock("../../server/customer-self-service", () => ({
  submitClientClaim: vi.fn(), setPolicyBeneficiary: vi.fn(),
  CustomerInputError: class extends Error {}, CustomerForbiddenError: class extends Error {},
}));
vi.mock("../../server/email-service", () => ({ sendEmail: vi.fn() }));
vi.mock("../../server/module-gate", () => ({ hasModule: vi.fn(async () => false) }));
vi.mock("../../server/route-helpers", () => ({ invalidateOtherSessions: vi.fn() }));
vi.mock("../../server/notifications", () => ({ notifyClient: vi.fn(async () => undefined) }));
vi.mock("../../server/turnstile", () => ({ verifyTurnstileToken: vi.fn(async () => ({ ok: true })) }));

import { setupClientAuth } from "../../server/client-auth";

const handlers: Record<string, (req: any, res: any) => Promise<any>> = {};
const fakeApp: any = new Proxy({}, {
  get: (_t, method: string) => (path: string, ...fns: any[]) => {
    handlers[`${method.toUpperCase()} ${path}`] = fns[fns.length - 1];
  },
});
setupClientAuth(fakeApp);

function fakeRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: any) => { res.body = b; return res; };
  return res;
}

const CLIENT_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const base = {
  clientId: CLIENT_ID,
  password: "Str0ng!Passw0rd#2026",
  securityQuestionId: QUESTION_ID,
  securityAnswer: "blue",
};

async function enroll(body: any) {
  const res = fakeRes();
  await handlers["POST /api/client-auth/enroll"]({ body, session: {}, ip: "127.0.0.1" }, res);
  return res;
}

describe("POST /api/client-auth/enroll requires proof of possession", () => {
  beforeEach(() => {
    h.updateClient.mockReset();
    h.updateClient.mockResolvedValue({ id: CLIENT_ID });
    h.client = { id: CLIENT_ID, organizationId: "org-1", isEnrolled: false, activationCode: "ACT-1A2B3C4D" };
    h.policy = { id: "pol-1", policyNumber: "FLK00001", clientId: CLIENT_ID };
  });

  it("rejects a bare clientId with no activation code (the takeover path)", async () => {
    const res = await enroll(base);
    expect(res.statusCode).toBe(400);
    expect(h.updateClient).not.toHaveBeenCalled();
  });

  it("rejects a wrong activation code", async () => {
    const res = await enroll({ ...base, activationCode: "ACT-DEADBEEF", policyNumber: "FLK00001" });
    expect(res.statusCode).toBe(400);
    expect(h.updateClient).not.toHaveBeenCalled();
  });

  it("rejects a policy number that belongs to someone else", async () => {
    h.policy = { id: "pol-2", policyNumber: "FLK00002", clientId: "someone-else" };
    const res = await enroll({ ...base, activationCode: "ACT-1A2B3C4D", policyNumber: "FLK00002" });
    expect(res.statusCode).toBe(400);
    expect(h.updateClient).not.toHaveBeenCalled();
  });

  it("enrolls when the activation code and the client's own policy number match", async () => {
    const res = await enroll({ ...base, activationCode: "act-1a2b3c4d", policyNumber: "flk00001" });
    expect(res.statusCode).toBe(200);
    expect(h.updateClient).toHaveBeenCalledWith(CLIENT_ID, expect.objectContaining({ isEnrolled: true, activationCode: null }), "org-1");
  });
});
