import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as any[], lastInsert: null as any, lastUpdate: null as any }));

vi.mock("../../server/control-plane-db", () => {
  const sel = () => {
    const p: any = Promise.resolve(h.rows);
    p.from = () => sel();
    p.where = () => sel();
    p.limit = () => Promise.resolve(h.rows);
    return p;
  };
  return {
    cpDb: {
      select: () => sel(),
      insert: () => ({ values: (v: any) => ({ returning: async () => { h.lastInsert = v; return [{ id: "conv-1", ...v }]; } }) }),
      update: () => ({ set: (s: any) => ({ where: () => ({ returning: async () => { h.lastUpdate = s; return [{ id: "conv-1", ...s }]; } }) }) }),
    },
  };
});
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import {
  createConversation,
  updateConversation,
  transitionConversation,
  resolveConversationTenant,
  setVerifiedContext,
  assignAgent,
  isValidTransition,
  isVerificationLive,
} from "../../server/customer-service-conversations";

beforeEach(() => {
  vi.clearAllMocks();
  h.rows = [];
  h.lastInsert = null;
  h.lastUpdate = null;
});

describe("FSM transitions", () => {
  it("allows the documented forward paths", () => {
    expect(isValidTransition("WELCOME", "VERIFY")).toBe(true);
    expect(isValidTransition("VERIFY", "MAIN_MENU")).toBe(true);
    expect(isValidTransition("MAIN_MENU", "MAKE_PAYMENT")).toBe(true);
    expect(isValidTransition("MY_POLICY", "MAIN_MENU")).toBe(true);
    expect(isValidTransition("EXPIRED", "VERIFY")).toBe(true);
  });
  it("rejects illegal jumps", () => {
    expect(isValidTransition("WELCOME", "MAKE_PAYMENT")).toBe(false);
    expect(isValidTransition("VERIFY", "TALK_TO_AGENT")).toBe(false);
  });
  it("ERROR and EXPIRED are always reachable", () => {
    expect(isValidTransition("MAKE_PAYMENT", "ERROR")).toBe(true);
    expect(isValidTransition("MY_DOCUMENTS", "EXPIRED")).toBe(true);
  });
});

describe("createConversation", () => {
  it("creates a fresh row when none exists", async () => {
    const c = await createConversation({ channelType: "whatsapp", channelId: "PN_1", whatsappNumber: "771789932" });
    expect(c.id).toBe("conv-1");
    expect(h.lastInsert).toMatchObject({ channelType: "whatsapp", channelId: "PN_1", whatsappNumber: "771789932", verificationStatus: "unresolved", currentState: "WELCOME" });
  });
  it("returns the existing row instead of duplicating", async () => {
    h.rows = [{ id: "conv-existing", channelId: "PN_1", whatsappNumber: "771789932", currentState: "MAIN_MENU" }];
    const c = await createConversation({ channelType: "whatsapp", channelId: "PN_1", whatsappNumber: "771789932" });
    expect(c.id).toBe("conv-existing");
    expect(h.lastInsert).toBeNull();
  });
});

describe("trusted context setters only touch trusted fields", () => {
  it("updateConversation ignores organization_id / client_id / policy_id even if passed", async () => {
    await updateConversation("conv-1", { currentState: "MAIN_MENU", ...( { organizationId: "evil", clientId: "evil", policyId: "evil" } as any) });
    expect(h.lastUpdate).toHaveProperty("currentState", "MAIN_MENU");
    expect(h.lastUpdate).not.toHaveProperty("organizationId");
    expect(h.lastUpdate).not.toHaveProperty("clientId");
    expect(h.lastUpdate).not.toHaveProperty("policyId");
  });

  it("resolveConversationTenant sets org + status only", async () => {
    await resolveConversationTenant("conv-1", { organizationId: "org-A" });
    expect(h.lastUpdate).toMatchObject({ organizationId: "org-A", verificationStatus: "tenant_resolved" });
    expect(h.lastUpdate).not.toHaveProperty("clientId");
  });

  it("setVerifiedContext sets org/client/policy + verified + expiry + MAIN_MENU", async () => {
    const exp = new Date(Date.now() + 900_000);
    await setVerifiedContext("conv-1", { organizationId: "org-A", clientId: "cli-A", policyId: "pol-A", expiresAt: exp });
    expect(h.lastUpdate).toMatchObject({
      organizationId: "org-A",
      clientId: "cli-A",
      policyId: "pol-A",
      verificationStatus: "verified",
      currentState: "MAIN_MENU",
      verificationExpiresAt: exp,
    });
  });

  it("assignAgent moves to TALK_TO_AGENT", async () => {
    await assignAgent("conv-1", null);
    expect(h.lastUpdate).toMatchObject({ assignedAgentId: null, currentState: "TALK_TO_AGENT" });
  });
});

describe("transitionConversation validates against the current state", () => {
  it("no-ops an illegal transition", async () => {
    h.rows = [{ id: "conv-1", currentState: "WELCOME" }];
    await transitionConversation("conv-1", "MAKE_PAYMENT");
    expect(h.lastUpdate).toBeNull(); // rejected, nothing written
  });
  it("applies a legal transition", async () => {
    h.rows = [{ id: "conv-1", currentState: "MAIN_MENU" }];
    await transitionConversation("conv-1", "MY_POLICY");
    expect(h.lastUpdate).toMatchObject({ currentState: "MY_POLICY" });
  });
});

describe("isVerificationLive", () => {
  it("true only while verified + not expired", () => {
    expect(isVerificationLive({ verificationStatus: "verified", verificationExpiresAt: new Date(Date.now() + 1000) })).toBe(true);
    expect(isVerificationLive({ verificationStatus: "verified", verificationExpiresAt: new Date(Date.now() - 1000) })).toBe(false);
    expect(isVerificationLive({ verificationStatus: "tenant_resolved", verificationExpiresAt: new Date(Date.now() + 1000) })).toBe(false);
    expect(isVerificationLive({ verificationStatus: "verified", verificationExpiresAt: null })).toBe(false);
  });
});
