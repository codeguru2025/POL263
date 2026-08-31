import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";

process.env.TENANT_CONFIG_ENCRYPTION_KEY =
  process.env.TENANT_CONFIG_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

// ─── mocks ───────────────────────────────────────────────────────────────────

const hh = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("../../server/control-plane-db", () => {
  const chain = (): any => {
    const p: any = Promise.resolve(hh.rows);
    p.from = () => chain();
    p.where = () => chain();
    p.limit = () => Promise.resolve(hh.rows);
    return p;
  };
  return { cpDb: { select: () => chain() }, cpPool: { end: vi.fn() } };
});

const S = vi.hoisted(() => ({
  getClient: vi.fn(),
  getPolicy: vi.fn(),
  getPoliciesByClient: vi.fn(),
  getPolicyMembers: vi.fn(),
  getPaymentsByPolicy: vi.fn(),
  getPolicyCreditBalance: vi.fn(),
  getUser: vi.fn(),
  getFuneralCaseByPolicy: vi.fn(),
  getPaymentReceiptsByClient: vi.fn(),
  getCreditNotesByClient: vi.fn(),
  getClaimsByClient: vi.fn(),
  getClientDocuments: vi.fn(),
  getClientNotifications: vi.fn(),
  getOrganization: vi.fn(),
  getPaymentIntentById: vi.fn(),
  createFeedback: vi.fn(),
  createDependent: vi.fn(),
  deleteDependent: vi.fn(),
  getDependentsByClient: vi.fn(),
}));
vi.mock("../../server/storage", () => ({ storage: S }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/route-helpers", () => ({ platformAuditLog: vi.fn() }));

const PS = vi.hoisted(() => ({
  createPaymentIntent: vi.fn(),
  initiatePaynowPayment: vi.fn(),
  submitOmariOtp: vi.fn(),
  pollPaynowStatus: vi.fn(),
}));
vi.mock("../../server/payment-service", () => PS);

vi.mock("../../server/policy-document", () => ({
  streamPolicyDocumentToResponse: vi.fn(async (_id: string, _org: string, res: any) => {
    res.setHeader("Content-Type", "application/pdf");
    res.end(Buffer.from("%PDF-1.4 fake policy doc"));
  }),
}));
vi.mock("../../server/receipt-pdf", () => ({
  getReceiptPdfPath: vi.fn(async () => Buffer.from("%PDF-1.4 fake receipt")),
}));

const CSS = vi.hoisted(() => ({ submitClientClaim: vi.fn(), setPolicyBeneficiary: vi.fn() }));
vi.mock("../../server/customer-self-service", () => {
  class CustomerInputError extends Error {
    constructor(m: string) { super(m); this.name = "CustomerInputError"; }
  }
  class CustomerForbiddenError extends Error {
    constructor(m = "Access denied") { super(m); this.name = "CustomerForbiddenError"; }
  }
  return {
    submitClientClaim: CSS.submitClientClaim,
    setPolicyBeneficiary: CSS.setPolicyBeneficiary,
    CustomerInputError,
    CustomerForbiddenError,
  };
});

// ─── multi-tenant routing layer mocks (internals covered by their own unit tests) ──
const RES = vi.hoisted(() => ({ resolveConversationContext: vi.fn() }));
vi.mock("../../server/customer-service-tenant-resolver", () => ({
  resolveConversationContext: RES.resolveConversationContext,
  normalizeWhatsAppNumber: (raw: unknown) => {
    const d = String(raw ?? "").replace(/\D/g, "");
    return d.length >= 9 ? d.slice(-9) : "";
  },
  computeTenantRef: (orgId: string) => "ref_" + orgId.slice(0, 6),
}));
vi.mock("../../server/customer-service-conversations", () => ({
  createConversation: vi.fn(async () => ({ id: "conv-1" })),
  resolveConversationTenant: vi.fn(async () => ({})),
  transitionConversation: vi.fn(async () => ({})),
  getConversationByChannel: vi.fn(async () => undefined),
}));
vi.mock("../../server/customer-service-session", () => ({ onVerificationSuccess: vi.fn() }));
const AH = vi.hoisted(() => ({ requestAgentHandoff: vi.fn(async () => ({ queued: true, organizationId: "org" })) }));
vi.mock("../../server/customer-service-agent-handoff", () => ({ requestAgentHandoff: AH.requestAgentHandoff }));

import { registerCustomerServiceRoutes } from "../../server/customer-service-routes";
import { issueVerificationToken } from "../../server/customer-service-integration";

// ─── server ─────────────────────────────────────────────────────────────────

let server: any;
let base: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerCustomerServiceRoutes(app);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

// ─── fixtures + helpers ─────────────────────────────────────────────────────

const SECRET_A = "cs-shared-secret-A";
const SECRET_B = "cs-shared-secret-B";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const POLICY_A = {
  id: "pol-A", organizationId: ORG_A, clientId: CLIENT_A, policyNumber: "FLK00001", status: "active",
  currency: "USD", premiumAmount: "25.00", paymentSchedule: "monthly", inceptionDate: "2024-01-01",
  effectiveDate: "2024-01-01", currentCycleEnd: "2026-09-01", graceEndDate: null, agentId: "agent-A",
  beneficiaryFirstName: null, beneficiaryLastName: null, beneficiaryRelationship: null,
  beneficiaryNationalId: null, beneficiaryPhone: null,
};
const CLIENT_ROW = { id: CLIENT_A, organizationId: ORG_A, title: "Mr", firstName: "Tendai", lastName: "Moyo" };

function tok(claims: Partial<{ orgId: string; clientId: string; policyId: string }> = {}) {
  return issueVerificationToken({ orgId: ORG_A, clientId: CLIENT_A, policyId: "pol-A", ...claims }).token;
}

async function call(
  path: string,
  opts: { method?: string; secret?: string | null; token?: string | null; body?: any; headers?: Record<string, string> } = {},
) {
  const { method = "GET", secret = SECRET_A, token = tok(), body, headers = {} } = opts;
  const hd: Record<string, string> = { ...headers };
  if (secret) hd["Authorization"] = `Bearer ${secret}`;
  if (token) hd["X-Verification-Token"] = token;
  if (body !== undefined) hd["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers: hd, body: body !== undefined ? JSON.stringify(body) : undefined });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try { json = JSON.parse(buf.toString("utf8")); } catch { /* not json */ }
  return { status: res.status, json, buf, contentType: res.headers.get("content-type") || "" };
}

const LEAK_KEYS = [
  "passwordHash", "password_hash", "securityAnswerHash", "activationCode",
  "pdfStorageKey", "pdf_storage_key", "storageKey", "storage_key", "fileUrl", "file_url",
  "databaseUrl", "database_url", "organizationId", "organization_id",
  "clientId", "client_id", "sharedSecret", "shared_secret", "paynowIntegrationKey", "integrationKey",
  "removalVehicleId", "removalDriverId", "burialVehicleId", "slaDeadline", "assignedTo",
];
function assertNoLeak(value: any, path = "$") {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoLeak(v, `${path}[${i}]`)); return; }
  if (value && typeof value === "object") {
    for (const k of Object.keys(value)) {
      expect(LEAK_KEYS, `${path}.${k} is a forbidden field`).not.toContain(k);
      assertNoLeak(value[k], `${path}.${k}`);
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  hh.rows = [
    { id: "int-A", tenantId: ORG_A, provider: "customer_service", isActive: true, config: { sharedSecret: SECRET_A } },
    { id: "int-B", tenantId: ORG_B, provider: "customer_service", isActive: true, config: { sharedSecret: SECRET_B } },
  ];
  S.getClient.mockResolvedValue(CLIENT_ROW);
  S.getPolicy.mockImplementation(async (id: string) => (id === "pol-A" ? POLICY_A : undefined));
  S.getPoliciesByClient.mockResolvedValue([POLICY_A]);
  S.getPaymentsByPolicy.mockResolvedValue([]);
  S.getPolicyCreditBalance.mockResolvedValue({ balance: "0", currency: "USD" });
  S.getPolicyMembers.mockResolvedValue([]);
  S.getPaymentReceiptsByClient.mockResolvedValue([]);
  S.getCreditNotesByClient.mockResolvedValue([]);
  S.getClaimsByClient.mockResolvedValue([]);
  S.getClientDocuments.mockResolvedValue([]);
  S.getClientNotifications.mockResolvedValue([]);
  S.getOrganization.mockResolvedValue({ name: "Falakhe", phone: "+263242000000", email: "info@falakhe.example", address: "1 Main St", isWhitelabeled: false, databaseUrl: "postgres://secret" });
  S.getFuneralCaseByPolicy.mockResolvedValue(undefined);
  S.getUser.mockResolvedValue({ id: "agent-A", displayName: "Agent Smith", phone: "0771111111", whatsapp: "0772222222", passwordHash: "x" });
  S.getDependentsByClient.mockResolvedValue([]);
});

// ─── AUTHENTICATION ─────────────────────────────────────────────────────────

describe("authentication", () => {
  it("valid shared secret + valid token → 200", async () => {
    const r = await call("/api/customer-service/policies");
    expect(r.status).toBe(200);
  });
  it("invalid shared secret → 401 unauthorized", async () => {
    const r = await call("/api/customer-service/policies", { secret: "wrong" });
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: "unauthorized" });
  });
  it("missing shared secret → 401", async () => {
    const r = await call("/api/customer-service/policies", { secret: null });
    expect(r.status).toBe(401);
  });
  it("valid secret + missing token → 401", async () => {
    const r = await call("/api/customer-service/policies", { token: null });
    expect(r.status).toBe(401);
  });
  it("valid secret + expired token → 401", async () => {
    const t = tok();
    const real = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(real() + 901_000);
    const r = await call("/api/customer-service/policies", { token: t });
    vi.mocked(Date.now).mockRestore();
    expect(r.status).toBe(401);
  });
  it("valid secret + tampered token → 401", async () => {
    const t = tok();
    const bad = t.slice(0, -2) + (t.endsWith("A") ? "BC" : "AA");
    const r = await call("/api/customer-service/policies", { token: bad });
    expect(r.status).toBe(401);
  });
  it("token minted for another tenant + secret for this tenant → 401 (org mismatch)", async () => {
    const r = await call("/api/customer-service/policies", { token: tok({ orgId: ORG_B }) });
    expect(r.status).toBe(401);
  });
  it("secret for tenant B + token for tenant A → 401 (org mismatch)", async () => {
    const r = await call("/api/customer-service/policies", { secret: SECRET_B, token: tok({ orgId: ORG_A }) });
    expect(r.status).toBe(401);
  });
});

// ─── OWNERSHIP ──────────────────────────────────────────────────────────────

describe("policy ownership", () => {
  it("customer accessing their own policy (by number) → 200", async () => {
    const r = await call("/api/customer-service/policies/FLK00001");
    expect(r.status).toBe(200);
    expect(r.json.policy.policy_number).toBe("FLK00001");
  });
  it("customer accessing their own policy (by id) → 200", async () => {
    const r = await call("/api/customer-service/policies/pol-A");
    expect(r.status).toBe(200);
  });
  it("another client's policy in the same tenant → 403", async () => {
    S.getPoliciesByClient.mockResolvedValue([]); // this client owns nothing matching
    const r = await call("/api/customer-service/policies/FLK99999");
    expect(r.status).toBe(403);
    expect(r.json).toEqual({ error: "forbidden" });
  });
  it("nonexistent policy → 403", async () => {
    const r = await call("/api/customer-service/policies/does-not-exist");
    expect(r.status).toBe(403);
  });
  it("ownership is re-checked on every sub-resource", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    for (const p of ["members", "beneficiary", "payments", "agent", "funeral"]) {
      const r = await call(`/api/customer-service/policies/FLK00001/${p}`);
      expect(r.status, p).toBe(403);
    }
  });
});

// ─── READ ENDPOINTS ─────────────────────────────────────────────────────────

describe("read endpoints", () => {
  it("GET /session", async () => {
    const r = await call("/api/customer-service/session");
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ customer: { name: "Mr Tendai Moyo" }, verified_policy_number: "FLK00001", expires_in: 900 });
  });

  it("GET /policies — customer-safe fields only", async () => {
    const r = await call("/api/customer-service/policies");
    expect(r.status).toBe(200);
    const p = r.json.policies[0];
    expect(p).toMatchObject({
      policy_number: "FLK00001", status: "active", currency: "USD", premium_amount: "25.00",
      payment_schedule: "monthly", balance: expect.any(String), outstanding: expect.any(String),
      wallet_balance: expect.any(String), periods_elapsed: expect.any(Number), next_due_date: "2026-09-01",
    });
    assertNoLeak(r.json);
  });

  it("GET /policies/:id/members", async () => {
    S.getPolicyMembers.mockResolvedValue([{ id: "m1", role: "spouse", memberNumber: "M-1", isActive: true, clientId: "x", organizationId: ORG_A }]);
    const r = await call("/api/customer-service/policies/FLK00001/members");
    expect(r.status).toBe(200);
    expect(r.json.members[0]).toEqual({ role: "spouse", member_number: "M-1", is_active: true });
    assertNoLeak(r.json);
  });

  it("GET /policies/:id/beneficiary — null when unset", async () => {
    const r = await call("/api/customer-service/policies/FLK00001/beneficiary");
    expect(r.json).toEqual({ beneficiary: null });
  });
  it("GET /policies/:id/beneficiary — mapped when set", async () => {
    S.getPolicy.mockResolvedValue({ ...POLICY_A, beneficiaryFirstName: "Jane", beneficiaryLastName: "Doe", beneficiaryRelationship: "spouse" });
    S.getPoliciesByClient.mockResolvedValue([{ ...POLICY_A, beneficiaryFirstName: "Jane", beneficiaryLastName: "Doe", beneficiaryRelationship: "spouse" }]);
    const r = await call("/api/customer-service/policies/FLK00001/beneficiary");
    expect(r.json.beneficiary).toMatchObject({ first_name: "Jane", last_name: "Doe", relationship: "spouse" });
    assertNoLeak(r.json);
  });

  it("GET /policies/:id/payments", async () => {
    S.getPaymentsByPolicy.mockResolvedValue([{ id: "t1", amount: "25", currency: "USD", paymentMethod: "ecocash", status: "cleared", reference: "R1", clientId: "x", organizationId: ORG_A }]);
    const r = await call("/api/customer-service/policies/FLK00001/payments");
    expect(r.json.payments[0]).toEqual({ amount: "25", currency: "USD", method: "ecocash", status: "cleared", reference: "R1", period_from: null, period_to: null, received_at: null });
    assertNoLeak(r.json);
  });

  it("GET /policies/:id/agent — name + phone only", async () => {
    const r = await call("/api/customer-service/policies/FLK00001/agent");
    expect(r.json).toEqual({ agent: { name: "Agent Smith", phone: "0772222222" } });
    assertNoLeak(r.json);
  });
  it("GET /policies/:id/agent — null when no agent", async () => {
    S.getPolicy.mockResolvedValue({ ...POLICY_A, agentId: null });
    S.getPoliciesByClient.mockResolvedValue([{ ...POLICY_A, agentId: null }]);
    const r = await call("/api/customer-service/policies/FLK00001/agent");
    expect(r.json).toEqual({ agent: null });
  });

  it("GET /receipts + /receipts/:id", async () => {
    S.getPaymentReceiptsByClient.mockResolvedValue([{ id: "r1", receiptNumber: "RCT-1", amount: "25", currency: "USD", paymentChannel: "paynow_ecocash", status: "issued", pdfStorageKey: "secret/key", clientId: "x" }]);
    const list = await call("/api/customer-service/receipts");
    expect(list.json.receipts[0].receipt_number).toBe("RCT-1");
    assertNoLeak(list.json);
    const one = await call("/api/customer-service/receipts/RCT-1");
    expect(one.status).toBe(200);
    const miss = await call("/api/customer-service/receipts/RCT-NOPE");
    expect(miss.status).toBe(404);
  });

  it("GET /credit-balance + /credit-notes", async () => {
    S.getCreditNotesByClient.mockResolvedValue([{ id: "c1", creditNoteNumber: "CN-1", amount: "5", currency: "USD", reason: "adj", clientId: "x", organizationId: ORG_A }]);
    const cb = await call("/api/customer-service/credit-balance");
    expect(cb.json.credit_balances[0]).toEqual({ policy_number: "FLK00001", balance: "0", currency: "USD" });
    const cn = await call("/api/customer-service/credit-notes");
    expect(cn.json.credit_notes[0].credit_note_number).toBe("CN-1");
    assertNoLeak(cn.json);
  });

  it("GET /claims + /claims/:id", async () => {
    S.getClaimsByClient.mockResolvedValue([{ id: "cl1", claimNumber: "CLM-000001", claimType: "death", status: "submitted", deceasedName: "X", clientId: "x", organizationId: ORG_A, submittedBy: "u1" }]);
    const list = await call("/api/customer-service/claims");
    expect(list.json.claims[0].claim_number).toBe("CLM-000001");
    assertNoLeak(list.json);
    const one = await call("/api/customer-service/claims/CLM-000001");
    expect(one.status).toBe(200);
    const miss = await call("/api/customer-service/claims/CLM-999999");
    expect(miss.status).toBe(404);
  });

  it("GET /documents — metadata only, no storage keys", async () => {
    S.getClientDocuments.mockResolvedValue([{ id: "d1", documentType: "national_id", fileName: "id.pdf", mimeType: "application/pdf", fileUrl: "https://spaces/secret", storageKey: "k", clientId: "x" }]);
    const r = await call("/api/customer-service/documents");
    expect(r.json.documents[0]).toEqual({ document_type: "national_id", label: null, file_name: "id.pdf", mime_type: "application/pdf", uploaded_at: null });
    assertNoLeak(r.json);
  });

  it("GET /notifications — defaults to 20, caps at 50", async () => {
    await call("/api/customer-service/notifications");
    expect(S.getClientNotifications).toHaveBeenLastCalledWith(CLIENT_A, ORG_A, 20);
    await call("/api/customer-service/notifications?limit=5");
    expect(S.getClientNotifications).toHaveBeenLastCalledWith(CLIENT_A, ORG_A, 5);
    await call("/api/customer-service/notifications?limit=9999");
    expect(S.getClientNotifications).toHaveBeenLastCalledWith(CLIENT_A, ORG_A, 50);
  });

  it("GET /tenant — contact info only", async () => {
    const r = await call("/api/customer-service/tenant");
    expect(r.json).toEqual({ organization: { name: "Falakhe", phone: "+263242000000", email: "info@falakhe.example", address: "1 Main St" } });
    assertNoLeak(r.json);
  });
});

// ─── FUNERAL ────────────────────────────────────────────────────────────────

describe("funeral case", () => {
  it("returns customer-safe fields when a case exists", async () => {
    S.getFuneralCaseByPolicy.mockResolvedValue({
      id: "fc1", organizationId: ORG_A, policyId: "pol-A", funeralDate: "2026-09-10",
      funeralLocation: "Warren Hills", memorialServiceStart: "2026-09-10T09:00:00Z",
      removalVehicleId: "veh1", removalDriverId: "drv1", slaDeadline: "2026-09-08", assignedTo: "staff1", notes: "internal",
    });
    const r = await call("/api/customer-service/policies/FLK00001/funeral");
    expect(r.json).toEqual({ funeral: { funeral_date: "2026-09-10", funeral_location: "Warren Hills", memorial_service_start: "2026-09-10T09:00:00Z" } });
    assertNoLeak(r.json);
  });
  it("returns { funeral: null } when no case exists", async () => {
    const r = await call("/api/customer-service/policies/FLK00001/funeral");
    expect(r.json).toEqual({ funeral: null });
  });
  it("wrong client → 403", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/policies/FLK00001/funeral");
    expect(r.status).toBe(403);
  });
});

// ─── DOCUMENTS (streamed) ───────────────────────────────────────────────────

describe("document streaming", () => {
  it("GET /policies/:id/document → application/pdf", async () => {
    const r = await call("/api/customer-service/policies/FLK00001/document");
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("application/pdf");
  });
  it("GET /policies/:id/document → 403 for a policy that isn't the customer's", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/policies/FLK00001/document");
    expect(r.status).toBe(403);
  });
  it("GET /receipts/:id/document → application/pdf", async () => {
    S.getPaymentReceiptsByClient.mockResolvedValue([{ id: "r1", receiptNumber: "RCT-1", amount: "25", currency: "USD", status: "issued", pdfStorageKey: "k" }]);
    const r = await call("/api/customer-service/receipts/RCT-1/document");
    expect(r.status).toBe(200);
    expect(r.contentType).toContain("application/pdf");
  });
  it("GET /receipts/:id/document → 404 for a receipt that isn't the customer's", async () => {
    S.getPaymentReceiptsByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/receipts/RCT-1/document");
    expect(r.status).toBe(404);
  });
});

// ─── WRITES ─────────────────────────────────────────────────────────────────

describe("writes", () => {
  it("POST /feedback — valid", async () => {
    S.createFeedback.mockResolvedValue({ id: "f1", type: "complaint", subject: "Bad", status: "open", createdAt: "2026-08-27" });
    const r = await call("/api/customer-service/feedback", { method: "POST", body: { type: "complaint", subject: "Bad", message: "very bad" } });
    expect(r.status).toBe(201);
    expect(S.createFeedback).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A, type: "complaint" }));
    assertNoLeak(r.json);
  });
  it("POST /feedback — missing message → 400", async () => {
    const r = await call("/api/customer-service/feedback", { method: "POST", body: { type: "complaint", subject: "Bad" } });
    expect(r.status).toBe(400);
    expect(r.json).toEqual({ error: "invalid_request" });
  });
  it("POST /feedback — never accepts orgId/clientId from the body", async () => {
    S.createFeedback.mockResolvedValue({ id: "f1", type: "feedback", subject: "s", status: "open" });
    await call("/api/customer-service/feedback", { method: "POST", body: { type: "feedback", subject: "s", message: "m", organizationId: ORG_B, clientId: "evil" } });
    expect(S.createFeedback).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A }));
  });

  it("POST /claims — valid, associates orgId/clientId server-side", async () => {
    CSS.submitClientClaim.mockResolvedValue({ id: "cl1", claimNumber: "CLM-000009", claimType: "death", status: "submitted" });
    const r = await call("/api/customer-service/claims", { method: "POST", body: { policy_number: "FLK00001", claim_type: "death", deceased_name: "X" } });
    expect(r.status).toBe(201);
    expect(CSS.submitClientClaim).toHaveBeenCalledWith(ORG_A, CLIENT_A, expect.objectContaining({ policyId: "pol-A", claimType: "death" }), "customer service");
    assertNoLeak(r.json);
  });
  it("POST /claims — policy not owned → 403", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/claims", { method: "POST", body: { policy_number: "FLK99999", claim_type: "death" } });
    expect(r.status).toBe(403);
    expect(CSS.submitClientClaim).not.toHaveBeenCalled();
  });
  it("POST /claims — CustomerInputError from the service → 400", async () => {
    const { CustomerInputError } = await import("../../server/customer-self-service");
    CSS.submitClientClaim.mockRejectedValue(new CustomerInputError("bad"));
    const r = await call("/api/customer-service/claims", { method: "POST", body: { policy_number: "FLK00001", claim_type: "death" } });
    expect(r.status).toBe(400);
  });

  it("PUT /policies/:id/beneficiary — delegates to the shared service", async () => {
    CSS.setPolicyBeneficiary.mockResolvedValue({ message: "Beneficiary set" });
    const r = await call("/api/customer-service/policies/FLK00001/beneficiary", { method: "PUT", body: { firstName: "Jane", lastName: "Doe" } });
    expect(r.status).toBe(200);
    expect(CSS.setPolicyBeneficiary).toHaveBeenCalledWith(ORG_A, CLIENT_A, expect.objectContaining({ id: "pol-A" }), expect.anything());
  });
  it("PUT /policies/:id/beneficiary — 403 when not the customer's policy", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/policies/FLK00001/beneficiary", { method: "PUT", body: { firstName: "Jane", lastName: "Doe" } });
    expect(r.status).toBe(403);
    expect(CSS.setPolicyBeneficiary).not.toHaveBeenCalled();
  });

  it("POST /dependents — valid, orgId/clientId not from body", async () => {
    S.createDependent.mockResolvedValue({ id: "dep1", firstName: "Kid", lastName: "Moyo", relationship: "child" });
    const r = await call("/api/customer-service/dependents", { method: "POST", body: { first_name: "Kid", last_name: "Moyo", relationship: "child", organizationId: ORG_B, clientId: "evil" } });
    expect(r.status).toBe(201);
    expect(S.createDependent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A, firstName: "Kid" }));
    expect(r.json.dependent.id).toBe("dep1");
  });
  it("POST /dependents — missing relationship → 400", async () => {
    const r = await call("/api/customer-service/dependents", { method: "POST", body: { first_name: "Kid", last_name: "Moyo" } });
    expect(r.status).toBe(400);
  });
  it("DELETE /dependents/:id — only the customer's own", async () => {
    S.getDependentsByClient.mockResolvedValue([{ id: "dep1", firstName: "Kid" }]);
    const ok = await call("/api/customer-service/dependents/dep1", { method: "DELETE" });
    expect(ok.status).toBe(200);
    expect(S.deleteDependent).toHaveBeenCalledWith("dep1", ORG_A);
    const miss = await call("/api/customer-service/dependents/other", { method: "DELETE" });
    expect(miss.status).toBe(404);
  });
});

// ─── PAYMENTS ───────────────────────────────────────────────────────────────

describe("payments", () => {
  it("POST /policies/:id/payment-intents — ownership + reuse createPaymentIntent", async () => {
    PS.createPaymentIntent.mockResolvedValue({ intent: { id: "int-9", status: "created", amount: "25.00", currency: "USD", purpose: "premium" }, created: true });
    const r = await call("/api/customer-service/policies/FLK00001/payment-intents", { method: "POST", body: { amount: "25.00", idempotency_key: "k1" } });
    expect(r.status).toBe(200);
    expect(PS.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-A", idempotencyKey: "k1" }));
    expect(r.json.payment_intent.id).toBe("int-9");
  });
  it("POST payment-intents — unowned policy → 403", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/policies/FLK00001/payment-intents", { method: "POST", body: { amount: "25", idempotency_key: "k" } });
    expect(r.status).toBe(403);
    expect(PS.createPaymentIntent).not.toHaveBeenCalled();
  });
  it("POST payment-intents — missing amount → 400", async () => {
    const r = await call("/api/customer-service/policies/FLK00001/payment-intents", { method: "POST", body: { idempotency_key: "k" } });
    expect(r.status).toBe(400);
  });

  it("initiate / otp / status all check intent ownership", async () => {
    S.getPaymentIntentById.mockResolvedValue({ id: "int-9", organizationId: ORG_A, clientId: CLIENT_A, status: "created" });
    PS.initiatePaynowPayment.mockResolvedValue({ ok: true, redirectUrl: "https://pay", pollUrl: "https://poll" });
    PS.submitOmariOtp.mockResolvedValue({ ok: true, paid: true });
    PS.pollPaynowStatus.mockResolvedValue({ status: "paid", paid: true });

    const ini = await call("/api/customer-service/payment-intents/int-9/initiate", { method: "POST", body: { method: "ecocash", payer_phone: "0771234567" } });
    expect(ini.status).toBe(200);
    expect(PS.initiatePaynowPayment).toHaveBeenCalledWith(expect.objectContaining({ intentId: "int-9", method: "ecocash", actorType: "client", actorId: null }));

    const otp = await call("/api/customer-service/payment-intents/int-9/otp", { method: "POST", body: { otp: "123456" } });
    expect(otp.status).toBe(200);
    expect(otp.json).toEqual({ paid: true });

    const st = await call("/api/customer-service/payment-intents/int-9/status");
    expect(st.json).toEqual({ status: "paid", paid: true });
  });

  it("payment-intent owned by another client → 403 (no PayNow call)", async () => {
    S.getPaymentIntentById.mockResolvedValue({ id: "int-9", organizationId: ORG_A, clientId: "someone-else", status: "created" });
    const r = await call("/api/customer-service/payment-intents/int-9/initiate", { method: "POST", body: { method: "ecocash" } });
    expect(r.status).toBe(403);
    expect(PS.initiatePaynowPayment).not.toHaveBeenCalled();
  });
});

// ─── TOKEN REFRESH ──────────────────────────────────────────────────────────

describe("token refresh", () => {
  it("valid token → new 15-min token, same claims", async () => {
    const r = await call("/api/customer-service/token/refresh", { method: "POST" });
    expect(r.status).toBe(200);
    expect(r.json.expires_in).toBe(900);
    expect(typeof r.json.verification_token).toBe("string");
    // the new token must still resolve to org A / client A
    const r2 = await call("/api/customer-service/session", { token: r.json.verification_token });
    expect(r2.status).toBe(200);
  });
  it("expired token cannot be refreshed → 401", async () => {
    const t = tok();
    const real = Date.now;
    vi.spyOn(Date, "now").mockReturnValue(real() + 901_000);
    const r = await call("/api/customer-service/token/refresh", { method: "POST", token: t });
    vi.mocked(Date.now).mockRestore();
    expect(r.status).toBe(401);
  });
  it("tampered token cannot be refreshed → 401", async () => {
    const t = tok();
    const r = await call("/api/customer-service/token/refresh", { method: "POST", token: t.slice(0, -2) + "ZZ" });
    expect(r.status).toBe(401);
  });
  it("refresh without a valid shared secret → 401", async () => {
    const r = await call("/api/customer-service/token/refresh", { method: "POST", secret: "nope" });
    expect(r.status).toBe(401);
  });
  it("refresh with secret for tenant B + token for tenant A → 401 (org mismatch)", async () => {
    const r = await call("/api/customer-service/token/refresh", { method: "POST", secret: SECRET_B, token: tok({ orgId: ORG_A }) });
    expect(r.status).toBe(401);
  });
});
