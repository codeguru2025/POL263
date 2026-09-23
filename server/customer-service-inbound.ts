/**
 * Phase 10 — inbound message adapter for the WhatsApp customer-service bot.
 *
 * ⚠️  BLOCKED ON A REAL PAYLOAD.
 * There is currently NO SMSALA inbound webhook payload anywhere in the POL263 codebase — the bot
 * calls the POL263 HTTP API directly today; POL263 does not receive SMSALA webhooks. So this
 * module defines the CLEAN INTERNAL SHAPE the conversation resolver expects and a pluggable
 * adapter interface. The SMSALA-specific field mapping (`SmsalaInboundAdapter`) is a stub that
 * MUST be completed once you provide an actual SMSALA / BSP inbound webhook JSON sample.
 *
 * This does not touch server/inbound-email-public-routes.ts or any other integration.
 */
import { structuredLog } from "./logger";

/** The normalized inbound message every downstream consumer uses. */
export interface NormalizedInboundMessage {
  /** BSP channel identifier (WhatsApp phone_number_id) — drives MODE B tenant resolution. */
  channelId: string | null;
  channelType: "whatsapp";
  /** Customer's WhatsApp number (their wa_id), as sent by the provider. */
  from: string;
  /** The business number that received the message. */
  to: string | null;
  /** Provider message id (idempotency / dedupe). */
  messageId: string | null;
  /** The text body (empty string for non-text messages until we support them). */
  text: string;
  /** Unix ms. Falls back to now() if the provider didn't send one. */
  timestamp: number;
}

/** Adapter contract — one per BSP. `canHandle` lets a router pick the right adapter. */
export interface InboundAdapter {
  readonly name: string;
  canHandle(raw: unknown): boolean;
  normalize(raw: unknown): NormalizedInboundMessage | null;
}

const asObj = (v: unknown): Record<string, any> => (v && typeof v === "object" ? (v as Record<string, any>) : {});
const str = (v: unknown): string => (v == null ? "" : String(v));

/**
 * SMSALA adapter — STUB. The field paths below are a best-effort guess at a WhatsApp-BSP webhook
 * shape and are almost certainly wrong for SMSALA specifically. Replace `normalize()` with the
 * real mapping once a sample payload is available. Marked so it's obvious in code review.
 *
 * TODO(SMSALA): confirm the actual inbound webhook JSON and finish this mapping.
 */
export const SmsalaInboundAdapter: InboundAdapter = {
  name: "smsala",
  canHandle(raw: unknown): boolean {
    const o = asObj(raw);
    // Heuristic only — refine once the real shape is known.
    return "messages" in o || "message" in o || "from" in o || "sender" in o;
  },
  normalize(raw: unknown): NormalizedInboundMessage | null {
    const o = asObj(raw);
    // ── Guessed field paths — REPLACE with the real SMSALA mapping ──────────────
    const msg = asObj(Array.isArray(o.messages) ? o.messages[0] : o.message ?? o);
    const from = str(o.from ?? o.sender ?? msg.from ?? msg.sender);
    if (!from) return null;
    const channelId = str(o.channelId ?? o.phone_number_id ?? o.channel_id ?? asObj(o.metadata).phone_number_id) || null;
    const to = str(o.to ?? o.recipient ?? asObj(o.metadata).display_phone_number) || null;
    const messageId = str(o.messageId ?? o.message_id ?? msg.id ?? msg.messageId) || null;
    const text = str(msg.text?.body ?? msg.text ?? o.text?.body ?? o.text ?? o.body ?? "");
    const tsRaw = o.timestamp ?? msg.timestamp;
    const tsNum = Number(tsRaw);
    const timestamp = Number.isFinite(tsNum) && tsNum > 0 ? (tsNum < 1e12 ? tsNum * 1000 : tsNum) : Date.now();
    return { channelId, channelType: "whatsapp", from, to, messageId, text, timestamp };
  },
};

const ADAPTERS: InboundAdapter[] = [SmsalaInboundAdapter];

/**
 * Normalize a raw inbound webhook body into NormalizedInboundMessage. Returns null if no adapter
 * recognizes it or the payload lacks a sender — callers should 200-and-ignore in that case
 * (webhook convention, see inbound-email-public-routes.ts).
 */
export function normalizeInboundMessage(raw: unknown): NormalizedInboundMessage | null {
  for (const a of ADAPTERS) {
    try {
      if (a.canHandle(raw)) {
        const n = a.normalize(raw);
        if (n && n.from) return n;
      }
    } catch (err) {
      structuredLog("warn", "CUSTOMER_SERVICE_INBOUND_NORMALIZE_FAILED", { adapter: a.name, error: (err as Error).message });
    }
  }
  return null;
}

/** Exposed for tests. */
export const __test = { asObj, str };
