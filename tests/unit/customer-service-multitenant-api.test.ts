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
  getPolicyByNumber: vi.fn(),
  getPaymentsByPolicy: vi.fn(),
  getPolicyCreditBalance: vi.fn(),
  getOrganization: vi.fn(),
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
vi.mock("../../server/policy-document", () => ({ streamPolicyDocumentToResponse: vi.fn() }));
vi.mock("../../server/receipt-pdf", () => ({ getReceiptPdfPath: vi.fn() }));
vi.mock("../../server/customer-self-service", () => {
  class CustomerInputError extends Error {}
  class CustomerForbiddenError extends Error {}
  return { submitClientClaim: vi.fn(), setPolicyBeneficiary: vi.fn(), CustomerInputError, CustomerForbiddenError };
});

const RES = vi.hoisted(() => ({ resolveConversationContext: vi.fn() }));
vi.mock("../../server/customer-service-tenant-resolver", () => ({
  resolveConversationContext: RES.resolveConversationContext,
  normalizeWhatsAppNumber: (raw: unknown) => {
    const d = String(raw ?? "").replace(/\D/g, "");
    return d.length >= 9 ? d.slice(-9) : "";
  },
  computeTenantRef: (orgId: string) => "ref_" + orgId.replace(/[^a-z0-9]/gi, "").slice(0, 8),
}));
vi.mock("../../server/customer-service-conversations", () => ({
  createConversation: vi.fn(async () => ({ id: "conv-1" })),
  resolveConversationTenant: vi.fn(async () => ({})),
  transitionConversation: vi.fn(async () => ({})),
  getConversationByChannel: vi.fn(async () => undefined),
}));
vi.mock("../../server/customer-service-session", () => ({ onVerificationSuccess: vi.fn() }));
const AH = vi.hoisted(() => ({ requestAgentHandoff: vi.fn() }));
vi.mock("../../server/customer-service-agent-handoff", () => ({ requestAgentHandoff: AH.requestAgentHandoff }));

import { registerCustomerServiceRoutes } from "../../server/customer-service-routes";
import { issueVerificationToken } from "../../server/customer-service-integration";

// ─── server + helpers ───────────────────────────────────────────────────────

let server: any;
let base: string;
beforeAll(async () => {
  const app = express();
  app.use(express.json());
  registerCustomerServiceRoutes(app);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const SECRET_A = "cs-secret-A";
const SECRET_B = "cs-secret-B";
const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const POLICY_A = { id: "pol-A", organizationId: ORG_A, clientId: CLIENT_A, policyNumber: "POL-001", status: "active", currency: "USD", premiumAmount: "25.00", paymentSchedule: "monthly", inceptionDate: "2024-01-01" };

function tok(claims: any = {}) {
  return issueVerificationToken({ orgId: ORG_A, clientId: CLIENT_A, policyId: "pol-A", ...claims }).token;
}
async function call(path: string, opts: any = {}) {
  const { method = "GET", secret = SECRET_A, token = tok(), body } = opts;
  const hd: Record<string, string> = {};
  if (secret) hd["Authorization"] = `Bearer ${secret}`;
  if (token) hd["X-Verification-Token"] = token;
  if (body !== undefined) hd["Content-Type"] = "application/json";
  const res = await fetch(base + path, { method, headers: hd, body: body !== undefined ? JSON.stringify(body) : undefined });
  const txt = await res.text();
  let json: any = null;
  try { json = JSON.parse(txt); } catch { /* */ }
  return { status: res.status, json, text: txt };
}

beforeEach(() => {
  vi.clearAllMocks();
  hh.rows = [
    { id: "int-A", tenantId: ORG_A, provider: "customer_service", isActive: true, config: { sharedSecret: SECRET_A } },
    { id: "int-B", tenantId: ORG_B, provider: "customer_service", isActive: true, config: { sharedSecret: SECRET_B } },
  ];
  S.getOrganization.mockResolvedValue({ name: "Falakhe", phone: "+263242000000", email: "care@f.x", website: "https://f.x", logoUrl: "/l.png", primaryColor: "#111" });
  S.getPoliciesByClient.mockResolvedValue([POLICY_A]);
  S.getClient.mockResolvedValue({ id: CLIENT_A, organizationId: ORG_A, firstName: "Tendai", lastName: "Moyo", title: "Mr", nationalId: "63-1234567A12", phone: "+263712171267" });
  S.getPolicyByNumber.mockResolvedValue(POLICY_A);
});

// ─── Phase 5/6 — /resolve ───────────────────────────────────────────────────

describe("POST /api/customer-service/resolve", () => {
  it("no shared secret → 401", async () => {
    const r = await call("/api/customer-service/resolve", { method: "POST", secret: null, token: null, body: { whatsapp_number: "+263771789932" } });
    expect(r.status).toBe(401);
  });
  it("short whatsapp_number → 400", async () => {
    const r = await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "123" } });
    expect(r.status).toBe(400);
  });
  it("unique → verify + opaque tenant_ref, NO branding, NO real ids", async () => {
    RES.resolveConversationContext.mockResolvedValue({ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-A", resolutionType: "unique" });
    const r = await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "+263771789932" } });
    expect(r.status).toBe(200);
    expect(r.json.resolution_type).toBe("unique");
    expect(r.json.next_action).toBe("verify");
    expect(typeof r.json.tenant_ref).toBe("string");
    expect(r.json.branding).toBeUndefined();
    const s = JSON.stringify(r.json);
    expect(s).not.toContain(ORG_A);
    expect(s).not.toContain(CLIENT_A);
    expect(s).not.toContain("pol-A");
    expect(s.toLowerCase()).not.toContain("falakhe");
  });
  it("policy_required → ask_policy_number, nothing else", async () => {
    RES.resolveConversationContext.mockResolvedValue({ organizationId: null, clientId: null, policyId: null, resolutionType: "policy_required" });
    const r = await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "+263771789932" } });
    expect(r.json).toEqual({ resolution_type: "policy_required", next_action: "ask_policy_number" });
  });
  it("not_found → ask_policy_number", async () => {
    RES.resolveConversationContext.mockResolvedValue({ organizationId: null, clientId: null, policyId: null, resolutionType: "not_found" });
    const r = await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "+263771789932" } });
    expect(r.json.resolution_type).toBe("not_found");
  });
  it("dedicated_channel → branding IS returned (channel is the tenant's own number)", async () => {
    RES.resolveConversationContext.mockResolvedValue({ organizationId: ORG_A, clientId: null, policyId: null, resolutionType: "dedicated_channel" });
    const r = await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "+263771789932", channel_id: "PN_A" } });
    expect(r.json.resolution_type).toBe("dedicated_channel");
    expect(r.json.branding).toMatchObject({ name: "Falakhe", display_name: "FALAKHE" });
  });
  it("forwards channel_id + policy_number to the resolver", async () => {
    RES.resolveConversationContext.mockResolvedValue({ organizationId: null, clientId: null, policyId: null, resolutionType: "not_found" });
    await call("/api/customer-service/resolve", { method: "POST", token: null, body: { whatsapp_number: "+263771789932", channel_id: "PN_X", policy_number: "FLK1" } });
    expect(RES.resolveConversationContext).toHaveBeenCalledWith(expect.objectContaining({ channelId: "PN_X", policyNumber: "FLK1" }));
  });
});

// ─── Phase 7 — /branding ────────────────────────────────────────────────────

describe("GET /api/customer-service/branding", () => {
  it("verified tenant branding only — no databaseUrl / internal fields", async () => {
    S.getOrganization.mockResolvedValue({ name: "Falakhe", logoUrl: "/l.png", primaryColor: "#111", phone: "p", email: "e", website: "w", databaseUrl: "postgres://secret", isWhitelabeled: true });
    const r = await call("/api/customer-service/branding");
    expect(r.status).toBe(200);
    expect(r.json.branding).toMatchObject({ name: "Falakhe", display_name: "FALAKHE", logo_url: "/l.png", primary_color: "#111" });
    expect(JSON.stringify(r.json)).not.toContain("postgres://");
    expect(Object.keys(r.json.branding)).not.toContain("is_whitelabeled");
  });
  it("401 without a verification token", async () => {
    const r = await call("/api/customer-service/branding", { token: null });
    expect(r.status).toBe(401);
  });
});

// ─── Phase 12 — /pay ────────────────────────────────────────────────────────

describe("POST /api/customer-service/pay", () => {
  it("wraps createPaymentIntent + initiatePaynowPayment with ctx tenant — body ids ignored", async () => {
    PS.createPaymentIntent.mockResolvedValue({ intent: { id: "int-1", status: "created" }, created: true });
    PS.initiatePaynowPayment.mockResolvedValue({ ok: true, redirectUrl: "https://pay", pollUrl: "https://poll" });
    const r = await call("/api/customer-service/pay", { method: "POST", body: { policy_number: "POL-001", amount: "25", method: "ecocash", idempotency_key: "k1", organizationId: ORG_B, clientId: "evil" } });
    expect(r.status).toBe(200);
    expect(PS.createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-A", idempotencyKey: "k1" }));
    expect(PS.initiatePaynowPayment).toHaveBeenCalledWith(expect.objectContaining({ intentId: "int-1", actorType: "client", actorId: null }));
    expect(r.json).toMatchObject({ payment_intent_id: "int-1", pay_url: "https://pay" });
  });
  it("403 for a policy the verified client does not own", async () => {
    S.getPoliciesByClient.mockResolvedValue([]);
    const r = await call("/api/customer-service/pay", { method: "POST", body: { policy_number: "POL-999", amount: "10", idempotency_key: "k" } });
    expect(r.status).toBe(403);
    expect(PS.createPaymentIntent).not.toHaveBeenCalled();
  });
  it("400 when amount or idempotency key missing", async () => {
    const r = await call("/api/customer-service/pay", { method: "POST", body: { policy_number: "POL-001" } });
    expect(r.status).toBe(400);
  });
});

// ─── Phase 15 — /agent-handoff ──────────────────────────────────────────────

describe("POST /api/customer-service/agent-handoff", () => {
  it("uses organization_id from verified context, ignoring the body", async () => {
    AH.requestAgentHandoff.mockResolvedValue({ queued: true, organizationId: ORG_A });
    const r = await call("/api/customer-service/agent-handoff", { method: "POST", body: { reason: "help", organization_id: ORG_B, organizationId: ORG_B, whatsapp_number: "+263771789932" } });
    expect(r.status).toBe(200);
    const passed = AH.requestAgentHandoff.mock.calls[0][1];
    expect(passed.organizationId).toBe(ORG_A);
    expect(passed.clientId).toBe(CLIENT_A);
    expect(r.json).toMatchObject({ queued: true, support_phone: "+263242000000" });
  });
  it("401 without a verification token", async () => {
    const r = await call("/api/customer-service/agent-handoff", { method: "POST", token: null, body: {} });
    expect(r.status).toBe(401);
  });
});

// ─── /verify hook ───────────────────────────────────────────────────────────

describe("/verify still works and fires the routing hook", () => {
  it("unchanged verify envelope + onVerificationSuccess called with ctx (not response-affecting)", async () => {
    const { onVerificationSuccess } = await import("../../server/customer-service-session");
    const r = await call("/api/customer-service/verify", {
      method: "POST",
      token: null,
      body: { policy_number: "POL-001", identity_number: "63-1234567A12", phone_number: "+263712171267", channel_id: "PN_A" },
    });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ verified: true, expires_in: 900, customer: { name: "Mr Tendai Moyo" }, policy: { policy_number: "POL-001", status: "active" } });
    await new Promise((res) => setTimeout(res, 15));
    expect(vi.mocked(onVerificationSuccess)).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A, clientId: CLIENT_A, channelId: "PN_A" }));
  });
});
