/**
 * Phase 3 — verify-driven customer-service identity index
 * (control_plane.customer_service_identities).
 *
 * A cross-tenant "which tenant/customer does this WhatsApp number belong to" index, built
 * exclusively from SUCCESSFUL /api/customer-service/verify calls. It is NOT a copy of the
 * `clients` table and NOT populated by scanning every tenant's clients — after a verify we
 * already know (org, client, policy, number), so we upsert one row.
 *
 * whatsapp_number is stored in the normalized last-9-digits form (matching
 * storage.getClientByPhone's existing convention) so a "+263 77…" typed at verify time and a
 * "26377…" WhatsApp wa_id resolve to the same key.
 */
import { and, eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { customerServiceIdentities, type CustomerServiceIdentity } from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

/** digits-only, last 9 — same rule storage.getClientByPhone uses. Empty string if < 9 digits. */
export function normalizeWhatsAppNumber(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : "";
}

export interface UpsertIdentityInput {
  organizationId: string;
  clientId: string;
  policyId: string | null;
  whatsappNumber: string; // raw or normalized — normalized here
}

/** Upsert one identity-index row. Never throws (routing metadata must not break verification). */
export async function upsertIdentityIndex(input: UpsertIdentityInput): Promise<void> {
  const number = normalizeWhatsAppNumber(input.whatsappNumber);
  if (!number || !input.organizationId || !input.clientId) return;
  try {
    const [existing] = await cpDb
      .select()
      .from(customerServiceIdentities)
      .where(
        and(
          eq(customerServiceIdentities.organizationId, input.organizationId),
          eq(customerServiceIdentities.clientId, input.clientId),
          eq(customerServiceIdentities.whatsappNumber, number),
        ),
      )
      .limit(1);
    if (existing) {
      await cpDb
        .update(customerServiceIdentities)
        .set({
          policyId: input.policyId ?? existing.policyId,
          status: "active",
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(customerServiceIdentities.id, existing.id));
    } else {
      await cpDb.insert(customerServiceIdentities).values({
        organizationId: input.organizationId,
        clientId: input.clientId,
        policyId: input.policyId,
        whatsappNumber: number,
        status: "active",
        lastVerifiedAt: new Date(),
      });
    }
  } catch (err) {
    structuredLog("error", "CUSTOMER_SERVICE_IDENTITY_UPSERT_FAILED", { error: (err as Error).message });
  }
}

/** All active identity rows for a WhatsApp number (any tenant). Used by the resolver. */
export async function findIdentitiesByWhatsAppNumber(rawNumber: unknown): Promise<CustomerServiceIdentity[]> {
  const number = normalizeWhatsAppNumber(rawNumber);
  if (!number) return [];
  return cpDb
    .select()
    .from(customerServiceIdentities)
    .where(and(eq(customerServiceIdentities.whatsappNumber, number), eq(customerServiceIdentities.status, "active")));
}
