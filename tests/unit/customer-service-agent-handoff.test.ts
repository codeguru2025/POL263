import { describe, it, expect, vi, beforeEach } from "vitest";

const CONV = vi.hoisted(() => ({ getConversationByChannel: vi.fn(), assignAgent: vi.fn() }));
vi.mock("../../server/customer-service-conversations", () => ({
  getConversationByChannel: CONV.getConversationByChannel,
  assignAgent: CONV.assignAgent,
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
const RH = vi.hoisted(() => ({ platformAuditLog: vi.fn() }));
vi.mock("../../server/route-helpers", () => ({ platformAuditLog: RH.platformAuditLog }));

import { requestAgentHandoff, setAgentQueue, LoggingAgentQueue } from "../../server/customer-service-agent-handoff";

const ORG_A = "org-A";
const ORG_B = "org-B";

beforeEach(() => {
  vi.clearAllMocks();
  setAgentQueue(LoggingAgentQueue);
  CONV.getConversationByChannel.mockResolvedValue(undefined);
});

describe("requestAgentHandoff", () => {
  it("queues using the VERIFIED organization_id — never a body-supplied one", async () => {
    const enqueue = vi.fn(async () => {});
    setAgentQueue({ name: "test", enqueue });
    const r = await requestAgentHandoff({ requestId: "r1" }, {
      organizationId: ORG_A,
      clientId: "cli-A",
      policyId: "pol-A",
      whatsappNumber: "771789932",
      channelId: "PN_1",
      reason: "help",
    });
    expect(r).toEqual({ queued: true, organizationId: ORG_A });
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_A }));
    expect(RH.platformAuditLog).toHaveBeenCalledWith(
      expect.anything(), "CUSTOMER_SERVICE_AGENT_HANDOFF", "CustomerServiceIntegration", ORG_A, null, expect.anything(),
    );
  });

  it("throws (no queue event) if the conversation's resolved org != the verified org", async () => {
    CONV.getConversationByChannel.mockResolvedValue({ id: "conv-1", organizationId: ORG_B });
    const enqueue = vi.fn(async () => {});
    setAgentQueue({ name: "test", enqueue });
    await expect(
      requestAgentHandoff({}, { organizationId: ORG_A, clientId: "c", policyId: null, whatsappNumber: "771789932", channelId: "PN_1" }),
    ).rejects.toThrow(/tenant mismatch/i);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("throws when there is no verified org/client context", async () => {
    await expect(
      requestAgentHandoff({}, { organizationId: "", clientId: "", policyId: null, whatsappNumber: "x", channelId: null }),
    ).rejects.toThrow();
  });

  it("marks the conversation TALK_TO_AGENT (unassigned) when a row exists and orgs match", async () => {
    CONV.getConversationByChannel.mockResolvedValue({ id: "conv-1", organizationId: ORG_A });
    await requestAgentHandoff({}, { organizationId: ORG_A, clientId: "c", policyId: null, whatsappNumber: "771789932", channelId: "PN_1" });
    expect(CONV.assignAgent).toHaveBeenCalledWith("conv-1", null);
  });
});
