/**
 * Phase 4 — persistent WhatsApp conversation context + FSM state.
 *
 * Lives in the control plane (control_plane.customer_service_conversations). The row holds
 * ROUTING / FSM metadata only:
 *   - which WhatsApp number + channel this conversation is
 *   - the resolved tenant (organization_id) — set ONLY by resolveConversationTenant()
 *   - the verified customer (client_id / policy_id) — set ONLY by setVerifiedContext()
 *   - the FSM state + verification status + expiry
 *
 * It NEVER stores the raw verification token — that stays in the bot's own conversation state
 * (Phase 4 rule). organization_id / client_id / policy_id are only ever written from trusted
 * server code (the resolver and a successful /verify), never from the SMSALA request body.
 */
import { and, eq, isNull } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { customerServiceConversations, type CustomerServiceConversation } from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

// ─── FSM ─────────────────────────────────────────────────────────────────────

export const CS_STATES = [
  "WELCOME",
  "VERIFY",
  "MAIN_MENU",
  "MY_POLICY",
  "MAKE_PAYMENT",
  "MY_DOCUMENTS",
  "FUNERAL_ASSISTANCE",
  "TALK_TO_AGENT",
  "EXPIRED",
  "ERROR",
] as const;
export type CsState = (typeof CS_STATES)[number];

export const CS_VERIFICATION_STATUSES = [
  "unresolved",
  "tenant_resolved",
  "awaiting_policy",
  "verified",
  "expired",
] as const;
export type CsVerificationStatus = (typeof CS_VERIFICATION_STATUSES)[number];

const MENU_BRANCHES: CsState[] = ["MY_POLICY", "MAKE_PAYMENT", "MY_DOCUMENTS", "FUNERAL_ASSISTANCE", "TALK_TO_AGENT"];

/** Allowed forward transitions. "ERROR" and "EXPIRED" are reachable from anywhere. */
const TRANSITIONS: Record<CsState, CsState[]> = {
  WELCOME: ["VERIFY", "MAIN_MENU"],
  VERIFY: ["VERIFY", "MAIN_MENU"],
  MAIN_MENU: [...MENU_BRANCHES],
  MY_POLICY: ["MAIN_MENU", ...MENU_BRANCHES],
  MAKE_PAYMENT: ["MAIN_MENU", ...MENU_BRANCHES],
  MY_DOCUMENTS: ["MAIN_MENU", ...MENU_BRANCHES],
  FUNERAL_ASSISTANCE: ["MAIN_MENU", ...MENU_BRANCHES],
  TALK_TO_AGENT: ["MAIN_MENU", ...MENU_BRANCHES],
  EXPIRED: ["WELCOME", "VERIFY"],
  ERROR: ["WELCOME", "MAIN_MENU", "VERIFY"],
};

export function isValidTransition(from: CsState, to: CsState): boolean {
  if (to === "ERROR" || to === "EXPIRED") return true;
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateConversationInput {
  channelType: string; // 'whatsapp'
  channelId: string | null;
  whatsappNumber: string; // normalized (see customer-service-tenant-resolver.normalizeWhatsAppNumber)
}

/** Create OR return the existing live conversation for (channelId, whatsappNumber). */
export async function createConversation(input: CreateConversationInput): Promise<CustomerServiceConversation> {
  const existing = await getConversationByChannel(input.channelId, input.whatsappNumber);
  if (existing) return existing;
  const [row] = await cpDb
    .insert(customerServiceConversations)
    .values({
      channelType: input.channelType,
      channelId: input.channelId,
      whatsappNumber: input.whatsappNumber,
      verificationStatus: "unresolved",
      currentState: "WELCOME",
      lastMessageAt: new Date(),
    })
    .returning();
  return row;
}

export async function getConversation(id: string): Promise<CustomerServiceConversation | undefined> {
  if (!id) return undefined;
  const [row] = await cpDb.select().from(customerServiceConversations).where(eq(customerServiceConversations.id, id)).limit(1);
  return row;
}

export async function getConversationByChannel(
  channelId: string | null,
  whatsappNumber: string,
): Promise<CustomerServiceConversation | undefined> {
  if (!whatsappNumber) return undefined;
  const channelCond =
    channelId == null
      ? isNull(customerServiceConversations.channelId)
      : eq(customerServiceConversations.channelId, channelId);
  const [row] = await cpDb
    .select()
    .from(customerServiceConversations)
    .where(and(eq(customerServiceConversations.whatsappNumber, whatsappNumber), channelCond))
    .limit(1);
  return row;
}

/**
 * Patch ONLY safe FSM/metadata fields. organization_id / client_id / policy_id are deliberately
 * NOT patchable here — use resolveConversationTenant() / setVerifiedContext().
 */
export interface ConversationPatch {
  currentState?: CsState;
  currentMenu?: string | null;
  verificationStatus?: CsVerificationStatus;
  lastMessageAt?: Date;
}
export async function updateConversation(id: string, patch: ConversationPatch): Promise<CustomerServiceConversation | undefined> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.currentState !== undefined) set.currentState = patch.currentState;
  if (patch.currentMenu !== undefined) set.currentMenu = patch.currentMenu;
  if (patch.verificationStatus !== undefined) set.verificationStatus = patch.verificationStatus;
  if (patch.lastMessageAt !== undefined) set.lastMessageAt = patch.lastMessageAt;
  const [row] = await cpDb
    .update(customerServiceConversations)
    .set(set)
    .where(eq(customerServiceConversations.id, id))
    .returning();
  return row;
}

/** Move the FSM forward, rejecting illegal jumps. */
export async function transitionConversation(id: string, to: CsState): Promise<CustomerServiceConversation | undefined> {
  const conv = await getConversation(id);
  if (!conv) return undefined;
  if (!isValidTransition(conv.currentState as CsState, to)) {
    structuredLog("warn", "CUSTOMER_SERVICE_CONV_BAD_TRANSITION", { from: conv.currentState, to });
    return conv;
  }
  return updateConversation(id, { currentState: to, lastMessageAt: new Date() });
}

export async function expireConversation(id: string): Promise<CustomerServiceConversation | undefined> {
  const [row] = await cpDb
    .update(customerServiceConversations)
    .set({ verificationStatus: "expired", currentState: "EXPIRED", updatedAt: new Date() })
    .where(eq(customerServiceConversations.id, id))
    .returning();
  return row;
}

// ─── trusted context setters (server-only) ───────────────────────────────────

/** Set the resolved tenant. Trusted — call only with a resolver result, never request input. */
export async function resolveConversationTenant(
  id: string,
  args: { organizationId: string },
): Promise<CustomerServiceConversation | undefined> {
  const [row] = await cpDb
    .update(customerServiceConversations)
    .set({
      organizationId: args.organizationId,
      verificationStatus: "tenant_resolved",
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .where(eq(customerServiceConversations.id, id))
    .returning();
  return row;
}

/** Mark the conversation verified. Trusted — call only from a successful /verify. */
export async function setVerifiedContext(
  id: string,
  args: { organizationId: string; clientId: string; policyId: string | null; expiresAt: Date },
): Promise<CustomerServiceConversation | undefined> {
  const [row] = await cpDb
    .update(customerServiceConversations)
    .set({
      organizationId: args.organizationId,
      clientId: args.clientId,
      policyId: args.policyId,
      verificationStatus: "verified",
      verificationExpiresAt: args.expiresAt,
      currentState: "MAIN_MENU",
      updatedAt: new Date(),
      lastMessageAt: new Date(),
    })
    .where(eq(customerServiceConversations.id, id))
    .returning();
  return row;
}

export async function assignAgent(id: string, agentId: string | null): Promise<CustomerServiceConversation | undefined> {
  const [row] = await cpDb
    .update(customerServiceConversations)
    .set({ assignedAgentId: agentId, currentState: "TALK_TO_AGENT", updatedAt: new Date(), lastMessageAt: new Date() })
    .where(eq(customerServiceConversations.id, id))
    .returning();
  return row;
}

/** True if the conversation's verified window is still open. */
export function isVerificationLive(conv: Pick<CustomerServiceConversation, "verificationStatus" | "verificationExpiresAt">): boolean {
  return (
    conv.verificationStatus === "verified" &&
    !!conv.verificationExpiresAt &&
    conv.verificationExpiresAt.getTime() > Date.now()
  );
}
