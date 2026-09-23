/**
 * Phase 15 — "Talk to an agent" handoff.
 *
 * The critical guarantee: an agent request from Tenant A can NEVER enter Tenant B's queue. The
 * organization_id ALWAYS comes from the verified conversation context / verification token —
 * never from the customer's message. Tenant B onboarded later just gets its own queue keyed by
 * its own organization_id; no code change.
 *
 * The real-time agent queue is behind an interface. The default implementation records the
 * request to the platform audit trail + structured log; a production queue (Redis stream,
 * pub/sub, staff-dashboard notification, …) can be dropped in later without touching callers.
 */
import { structuredLog } from "./logger";
import { platformAuditLog } from "./route-helpers";
import { assignAgent, getConversationByChannel } from "./customer-service-conversations";

export interface AgentHandoffRequest {
  /** ALWAYS from verified context — never from the request body. */
  organizationId: string;
  clientId: string;
  policyId: string | null;
  whatsappNumber: string; // normalized
  channelId: string | null;
  reason?: string | null;
}

export interface AgentQueueEvent extends AgentHandoffRequest {
  conversationId: string | null;
  requestedAt: string; // ISO
}

/** Pluggable tenant-scoped queue. Every implementation MUST key on event.organizationId. */
export interface AgentQueue {
  readonly name: string;
  enqueue(event: AgentQueueEvent): Promise<void>;
}

/** Default: audit-trail + log only. No cross-tenant surface — one event, one org. */
export const LoggingAgentQueue: AgentQueue = {
  name: "logging",
  async enqueue(event: AgentQueueEvent): Promise<void> {
    structuredLog("info", "CUSTOMER_SERVICE_AGENT_QUEUE_EVENT", {
      organizationId: event.organizationId,
      conversationId: event.conversationId,
      reason: event.reason ?? null,
      requestedAt: event.requestedAt,
    });
  },
};

let activeQueue: AgentQueue = LoggingAgentQueue;
/** Swap the queue implementation (e.g. at server start). */
export function setAgentQueue(q: AgentQueue): void {
  activeQueue = q;
}

/**
 * Route a verified customer to their tenant's agent queue. `req` is passed through only for
 * platformAuditLog's request-id / ip capture.
 */
export async function requestAgentHandoff(
  req: any,
  args: AgentHandoffRequest,
): Promise<{ queued: boolean; organizationId: string }> {
  if (!args.organizationId || !args.clientId) {
    throw new Error("agent handoff requires a verified organization + client context");
  }

  const conv = await getConversationByChannel(args.channelId, args.whatsappNumber).catch(() => undefined);
  if (conv) {
    // Guardrail: the conversation's resolved org (if set) must match the verified org.
    if (conv.organizationId && conv.organizationId !== args.organizationId) {
      structuredLog("error", "CUSTOMER_SERVICE_AGENT_HANDOFF_ORG_MISMATCH", {
        convOrg: conv.organizationId,
        verifiedOrg: args.organizationId,
      });
      throw new Error("conversation/verification tenant mismatch");
    }
    await assignAgent(conv.id, null); // queued, not yet assigned to a specific agent
  }

  const event: AgentQueueEvent = {
    ...args,
    conversationId: conv?.id ?? null,
    requestedAt: new Date().toISOString(),
  };

  await activeQueue.enqueue(event);
  await platformAuditLog(req, "CUSTOMER_SERVICE_AGENT_HANDOFF", "CustomerServiceIntegration", args.organizationId, null, {
    conversationId: event.conversationId,
    queue: activeQueue.name,
  });

  return { queued: true, organizationId: args.organizationId };
}
