/**
 * Phase 5/6 — customer-service tenant resolver.
 *
 *   "Which tenant / customer should this WhatsApp conversation belong to?"
 *
 * RESOLUTION IS NOT AUTHENTICATION (Phase 9). This module decides routing only. The customer
 * still has to pass /api/customer-service/verify (secret + policy_number + identity_number +
 * phone_number) and every guarded call still enforces secret→tenant + token→client +
 * tenant-match + client-ownership via requireVerifiedCustomer (unchanged).
 *
 * Returns ONLY internal routing metadata — never customer names, policy data, or tenant names.
 *
 * MODE A — shared WhatsApp number:
 *   whatsapp_number → verify-driven identity index (control_plane.customer_service_identities)
 *     • exactly one (org, client)      → resolutionType: "unique"
 *     • one org, several clients        → "policy_required"
 *     • several orgs                    → "policy_required"
 *     • none                            → "not_found"  (caller asks for a policy number)
 *   whatsapp_number + policy_number → resolve the policy within the candidate org(s)
 *     (getPolicyByNumber is an indexed exact match — NOT an O(all clients) scan).
 *
 * MODE B — dedicated tenant WhatsApp number:
 *   channel_id → control_plane.customer_service_channels → tenant directly ("dedicated_channel").
 */
import crypto from "crypto";
import { cpDb } from "./control-plane-db";
import { customerServiceChannels } from "@shared/control-plane-schema";
import { and, eq } from "drizzle-orm";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { findIdentitiesByWhatsAppNumber, normalizeWhatsAppNumber, upsertIdentityIndex } from "./customer-service-identity";

/**
 * Opaque per-tenant reference the bot uses to select the correct per-tenant customer_service
 * shared secret for /verify in the shared-WhatsApp-number model. It is an HMAC — it reveals
 * nothing (no orgId, no name) and is stable per tenant. Keyed off TENANT_CONFIG_ENCRYPTION_KEY
 * (already required in every environment) with SESSION_SECRET as a local-dev fallback.
 */
export function computeTenantRef(orgId: string): string {
  const key = process.env.SMSALA_TOKEN_SIGNING_SECRET || process.env.TENANT_CONFIG_ENCRYPTION_KEY || process.env.SESSION_SECRET || "";
  if (!key) return "";
  return crypto.createHmac("sha256", key).update(`pol263/customer-service/tenant-ref/v1:${orgId}`).digest("base64url").slice(0, 22);
}

export type ResolutionType = "unique" | "policy_required" | "not_found" | "dedicated_channel";

export interface ResolutionResult {
  organizationId: string | null;
  clientId: string | null;
  policyId: string | null;
  resolutionType: ResolutionType;
}

const NOT_FOUND: ResolutionResult = { organizationId: null, clientId: null, policyId: null, resolutionType: "not_found" };
const POLICY_REQUIRED: ResolutionResult = { organizationId: null, clientId: null, policyId: null, resolutionType: "policy_required" };

const normalizePolicyNumber = (v: unknown) => String(v ?? "").trim().toUpperCase();

// 60-second cache of org ids — same idea as client-auth.ts's getCachedOrgIds, avoids a full
// organizations scan on every first-time resolution.
let _orgCache: { ids: string[]; expiresAt: number } | null = null;
async function allOrgIds(): Promise<string[]> {
  const now = Date.now();
  if (_orgCache && _orgCache.expiresAt > now) return _orgCache.ids;
  const orgs = await storage.getOrganizations();
  _orgCache = { ids: orgs.map((o: any) => o.id), expiresAt: now + 60_000 };
  return _orgCache.ids;
}

// ─── MODE A ──────────────────────────────────────────────────────────────────

export async function resolveFromWhatsAppNumber(whatsappNumber: unknown): Promise<ResolutionResult> {
  const number = normalizeWhatsAppNumber(whatsappNumber);
  if (!number) return { ...NOT_FOUND };

  const rows = await findIdentitiesByWhatsAppNumber(number);
  if (rows.length === 0) return { ...NOT_FOUND };

  const orgs = Array.from(new Set(rows.map((r) => r.organizationId)));
  if (orgs.length > 1) return { ...POLICY_REQUIRED };

  const orgId = orgs[0];
  const clients = new Set(rows.map((r) => r.clientId));
  if (clients.size > 1) return { ...POLICY_REQUIRED };

  const row = rows[0];
  return { organizationId: orgId, clientId: row.clientId, policyId: row.policyId ?? null, resolutionType: "unique" };
}

export async function resolveFromPolicyNumber(policyNumber: unknown, candidateOrgIds?: string[]): Promise<ResolutionResult> {
  const num = normalizePolicyNumber(policyNumber);
  if (!num) return { ...NOT_FOUND };

  const orgIds = candidateOrgIds && candidateOrgIds.length > 0 ? candidateOrgIds : await allOrgIds();
  const settled = await Promise.allSettled(orgIds.map((org) => storage.getPolicyByNumber(num, org).then((p) => ({ org, p }))));

  const hits: { org: string; clientId: string; policyId: string }[] = [];
  for (const s of settled) {
    if (s.status === "fulfilled" && s.value.p && s.value.p.clientId && s.value.p.organizationId === s.value.org) {
      hits.push({ org: s.value.org, clientId: s.value.p.clientId, policyId: s.value.p.id });
    } else if (s.status === "rejected") {
      structuredLog("warn", "CUSTOMER_SERVICE_RESOLVE_ORG_LOOKUP_FAILED", { error: (s.reason as Error)?.message });
    }
  }

  if (hits.length === 1) {
    return { organizationId: hits[0].org, clientId: hits[0].clientId, policyId: hits[0].policyId, resolutionType: "unique" };
  }
  // 0 hits, or an ambiguous policy number matching >1 tenant with no WhatsApp-based candidate list.
  return { ...NOT_FOUND };
}

export async function resolveFromWhatsAppAndPolicy(whatsappNumber: unknown, policyNumber: unknown): Promise<ResolutionResult> {
  const rows = await findIdentitiesByWhatsAppNumber(whatsappNumber);
  const candidateOrgIds = Array.from(new Set(rows.map((r) => r.organizationId)));
  return resolveFromPolicyNumber(policyNumber, candidateOrgIds.length > 0 ? candidateOrgIds : undefined);
}

// ─── MODE B ──────────────────────────────────────────────────────────────────

export async function resolveFromDedicatedChannel(channelId: unknown, channelType = "whatsapp"): Promise<ResolutionResult> {
  const id = String(channelId ?? "").trim();
  if (!id) return { ...NOT_FOUND };
  const [row] = await cpDb
    .select()
    .from(customerServiceChannels)
    .where(
      and(
        eq(customerServiceChannels.channelType, channelType),
        eq(customerServiceChannels.channelId, id),
        eq(customerServiceChannels.isActive, true),
      ),
    )
    .limit(1);
  if (!row) return { ...NOT_FOUND };
  return { organizationId: row.tenantId, clientId: null, policyId: null, resolutionType: "dedicated_channel" };
}

// ─── orchestrator ────────────────────────────────────────────────────────────

export interface ResolveContextInput {
  whatsappNumber: unknown;
  channelId?: unknown;
  channelType?: string;
  policyNumber?: unknown;
}

/**
 * The single entry point the /resolve endpoint uses.
 *   1. dedicated channel  → tenant known, stop.
 *   2. policy number given → resolve via policy (within WhatsApp-candidate orgs if any).
 *   3. otherwise          → resolve via the WhatsApp identity index.
 */
export async function resolveConversationContext(input: ResolveContextInput): Promise<ResolutionResult> {
  const channelType = input.channelType || "whatsapp";

  if (input.channelId) {
    const dedicated = await resolveFromDedicatedChannel(input.channelId, channelType);
    if (dedicated.resolutionType === "dedicated_channel") return dedicated;
    // channel not registered as dedicated → fall through to the shared-number logic
  }

  if (input.policyNumber != null && String(input.policyNumber).trim() !== "") {
    return resolveFromWhatsAppAndPolicy(input.whatsappNumber, input.policyNumber);
  }

  return resolveFromWhatsAppNumber(input.whatsappNumber);
}

/** Re-export so callers have one import surface. */
export { upsertIdentityIndex, normalizeWhatsAppNumber, findIdentitiesByWhatsAppNumber };
