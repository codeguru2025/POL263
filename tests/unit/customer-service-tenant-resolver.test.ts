import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.TENANT_CONFIG_ENCRYPTION_KEY =
  process.env.TENANT_CONFIG_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const h = vi.hoisted(() => ({ identities: [] as any[], channels: [] as any[] }));

vi.mock("../../server/control-plane-db", () => {
  const table = (rows: () => any[]) => {
    const p: any = Promise.resolve(rows());
    p.from = () => table(rows);
    p.where = () => table(rows);
    p.limit = () => Promise.resolve(rows());
    return p;
  };
  return {
    cpDb: {
      // resolver only reads customer_service_channels via cpDb; identities go through the
      // mocked identity module below.
      select: () => table(() => h.channels),
    },
    cpPool: { end: vi.fn() },
  };
});

vi.mock("../../server/customer-service-identity", () => ({
  normalizeWhatsAppNumber: (raw: unknown) => {
    const d = String(raw ?? "").replace(/\D/g, "");
    return d.length >= 9 ? d.slice(-9) : "";
  },
  findIdentitiesByWhatsAppNumber: vi.fn(async () => h.identities),
  upsertIdentityIndex: vi.fn(),
}));

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

const S = vi.hoisted(() => ({ getPolicyByNumber: vi.fn(), getOrganizations: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: S }));

import {
  resolveFromWhatsAppNumber,
  resolveFromWhatsAppAndPolicy,
  resolveFromDedicatedChannel,
  resolveConversationContext,
  computeTenantRef,
  normalizeWhatsAppNumber,
} from "../../server/customer-service-tenant-resolver";

const ORG_A = "aaaaaaaa-0000-0000-0000-000000000001";
const ORG_B = "bbbbbbbb-0000-0000-0000-000000000002";
const CLIENT_A = "cccccccc-0000-0000-0000-000000000001";
const NUM = "+263 77 178 9932"; // → 771789932

beforeEach(() => {
  vi.clearAllMocks();
  h.identities = [];
  h.channels = [];
  S.getOrganizations.mockResolvedValue([{ id: ORG_A }, { id: ORG_B }]);
});

describe("normalizeWhatsAppNumber", () => {
  it("reduces to last 9 digits", () => {
    expect(normalizeWhatsAppNumber("+263771789932")).toBe("771789932");
    expect(normalizeWhatsAppNumber("0771789932")).toBe("771789932");
    expect(normalizeWhatsAppNumber("077 178 9932")).toBe("771789932");
    expect(normalizeWhatsAppNumber("12345")).toBe("");
  });
});

describe("resolveFromWhatsAppNumber (Mode A identity index)", () => {
  it("unique: one org, one client → { unique, org, client, policy }", async () => {
    h.identities = [{ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-1", status: "active" }];
    const r = await resolveFromWhatsAppNumber(NUM);
    expect(r).toEqual({ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-1", resolutionType: "unique" });
  });

  it("unknown number → not_found (no org/client leaked)", async () => {
    h.identities = [];
    const r = await resolveFromWhatsAppNumber(NUM);
    expect(r).toEqual({ organizationId: null, clientId: null, policyId: null, resolutionType: "not_found" });
  });

  it("multiple tenants → policy_required, org NOT leaked", async () => {
    h.identities = [
      { organizationId: ORG_A, clientId: CLIENT_A, policyId: null, status: "active" },
      { organizationId: ORG_B, clientId: "other", policyId: null, status: "active" },
    ];
    const r = await resolveFromWhatsAppNumber(NUM);
    expect(r).toEqual({ organizationId: null, clientId: null, policyId: null, resolutionType: "policy_required" });
  });

  it("one org but several clients on the number → policy_required", async () => {
    h.identities = [
      { organizationId: ORG_A, clientId: "c1", policyId: null, status: "active" },
      { organizationId: ORG_A, clientId: "c2", policyId: null, status: "active" },
    ];
    const r = await resolveFromWhatsAppNumber(NUM);
    expect(r.resolutionType).toBe("policy_required");
    expect(r.organizationId).toBeNull();
  });
});

describe("resolveFromWhatsAppAndPolicy", () => {
  it("resolves the policy within the WhatsApp-candidate org", async () => {
    h.identities = [{ organizationId: ORG_A, clientId: "x", policyId: null, status: "active" }];
    S.getPolicyByNumber.mockImplementation(async (num: string, org: string) =>
      org === ORG_A && num === "FLK00795" ? { id: "pol-9", clientId: CLIENT_A, organizationId: ORG_A } : undefined,
    );
    const r = await resolveFromWhatsAppAndPolicy(NUM, "flk00795");
    expect(r).toEqual({ organizationId: ORG_A, clientId: CLIENT_A, policyId: "pol-9", resolutionType: "unique" });
    // only the candidate org was queried, not every org
    expect(S.getPolicyByNumber).toHaveBeenCalledWith("FLK00795", ORG_A);
    expect(S.getPolicyByNumber).not.toHaveBeenCalledWith("FLK00795", ORG_B);
  });

  it("wrong policy number for the number → not_found", async () => {
    h.identities = [{ organizationId: ORG_A, clientId: "x", policyId: null, status: "active" }];
    S.getPolicyByNumber.mockResolvedValue(undefined);
    const r = await resolveFromWhatsAppAndPolicy(NUM, "NOPE123");
    expect(r.resolutionType).toBe("not_found");
  });

  it("no WhatsApp candidates → searches all orgs; single match → unique", async () => {
    h.identities = [];
    S.getPolicyByNumber.mockImplementation(async (num: string, org: string) =>
      org === ORG_B ? { id: "pol-b", clientId: "cb", organizationId: ORG_B } : undefined,
    );
    const r = await resolveFromWhatsAppAndPolicy(NUM, "ANY");
    expect(r).toEqual({ organizationId: ORG_B, clientId: "cb", policyId: "pol-b", resolutionType: "unique" });
  });

  it("ambiguous policy number matching >1 org with no candidates → not_found", async () => {
    h.identities = [];
    S.getPolicyByNumber.mockImplementation(async (_num: string, org: string) => ({ id: "p-" + org, clientId: "c", organizationId: org }));
    const r = await resolveFromWhatsAppAndPolicy(NUM, "SHARED");
    expect(r.resolutionType).toBe("not_found");
  });
});

describe("resolveFromDedicatedChannel (Mode B)", () => {
  it("registered active channel → { dedicated_channel, org } (no client yet)", async () => {
    h.channels = [{ tenantId: ORG_A, channelType: "whatsapp", channelId: "PN_123", isActive: true }];
    const r = await resolveFromDedicatedChannel("PN_123");
    expect(r).toEqual({ organizationId: ORG_A, clientId: null, policyId: null, resolutionType: "dedicated_channel" });
  });
  it("unregistered channel → not_found", async () => {
    h.channels = [];
    const r = await resolveFromDedicatedChannel("PN_UNKNOWN");
    expect(r.resolutionType).toBe("not_found");
  });
});

describe("resolveConversationContext (orchestrator)", () => {
  it("dedicated channel wins over shared-number logic", async () => {
    h.channels = [{ tenantId: ORG_B, channelType: "whatsapp", channelId: "PN_B", isActive: true }];
    h.identities = [{ organizationId: ORG_A, clientId: CLIENT_A, policyId: null, status: "active" }];
    const r = await resolveConversationContext({ whatsappNumber: NUM, channelId: "PN_B" });
    expect(r).toEqual({ organizationId: ORG_B, clientId: null, policyId: null, resolutionType: "dedicated_channel" });
  });
  it("unregistered channel falls through to identity index", async () => {
    h.channels = [];
    h.identities = [{ organizationId: ORG_A, clientId: CLIENT_A, policyId: "p", status: "active" }];
    const r = await resolveConversationContext({ whatsappNumber: NUM, channelId: "PN_NOPE" });
    expect(r.resolutionType).toBe("unique");
    expect(r.organizationId).toBe(ORG_A);
  });
  it("policy number provided → policy path", async () => {
    h.identities = [{ organizationId: ORG_A, clientId: "x", policyId: null, status: "active" }];
    S.getPolicyByNumber.mockResolvedValue({ id: "pol-9", clientId: CLIENT_A, organizationId: ORG_A });
    const r = await resolveConversationContext({ whatsappNumber: NUM, policyNumber: "FLK1" });
    expect(r.resolutionType).toBe("unique");
  });
});

describe("computeTenantRef", () => {
  it("is stable per org and does not contain the org id", () => {
    const a = computeTenantRef(ORG_A);
    expect(a).toBe(computeTenantRef(ORG_A));
    expect(a).not.toContain(ORG_A);
    expect(a).not.toBe(computeTenantRef(ORG_B));
    expect(a.length).toBeGreaterThan(10);
  });
});
