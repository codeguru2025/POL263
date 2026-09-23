/**
 * Glue between a successful /api/customer-service/verify and the routing layer (Phases 3 + 4).
 *
 * Called fire-and-forget from handleVerifyRequest AFTER the response is sent. It:
 *   1. upserts the verify-driven identity index (WhatsApp number → org/client/policy)
 *   2. if a conversation row exists for this (channel, number), stamps the verified context
 *      onto it (org/client/policy + verified status + 15-min expiry) via trusted setters.
 *
 * It must NEVER change the /verify response, its auth, its timing, or throw into that path.
 * The raw verification token is not passed here and is never persisted.
 */
import { structuredLog } from "./logger";
import { upsertIdentityIndex, normalizeWhatsAppNumber } from "./customer-service-identity";
import { getConversationByChannel, setVerifiedContext } from "./customer-service-conversations";
import { VERIFICATION_TOKEN_TTL_SECONDS } from "./customer-service-integration";

export interface VerificationSuccessInput {
  organizationId: string;
  clientId: string;
  policyId: string | null;
  phoneNumber: unknown; // the customer's WhatsApp number (verify body's phone_number)
  channelId?: unknown; // optional BSP channel id, if the bot sent one
}

export async function onVerificationSuccess(input: VerificationSuccessInput): Promise<void> {
  try {
    const number = normalizeWhatsAppNumber(input.phoneNumber);
    if (!number) return;

    await upsertIdentityIndex({
      organizationId: input.organizationId,
      clientId: input.clientId,
      policyId: input.policyId,
      whatsappNumber: number,
    });

    const channelId = input.channelId != null && String(input.channelId).trim() !== "" ? String(input.channelId).trim() : null;
    const conv = await getConversationByChannel(channelId, number);
    if (conv) {
      await setVerifiedContext(conv.id, {
        organizationId: input.organizationId,
        clientId: input.clientId,
        policyId: input.policyId,
        expiresAt: new Date(Date.now() + VERIFICATION_TOKEN_TTL_SECONDS * 1000),
      });
    }
  } catch (err) {
    structuredLog("error", "CUSTOMER_SERVICE_VERIFY_SESSION_HOOK_FAILED", { error: (err as Error).message });
  }
}
