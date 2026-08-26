/**
 * "Policy Logs" — everything that ever happened on one policy, in one place: edits (audit_logs),
 * payments/members/claims/documents mutated against it (also audit_logs, but filed under their
 * OWN entityId, not the policy's — see getRelatedEntityIds below), and pure reads that write
 * nothing at all (viewing the policy, downloading a document, a client opening their own cover —
 * policy_view_log). Neither source alone answers "show me everything about this policy"; this
 * merges both, read-time, into one chronological timeline.
 */
import { and, eq, desc, inArray } from "drizzle-orm";
import type { OrgDataDb } from "./tenant-db";
import {
  auditLogs, policyViewLog, paymentTransactions, paymentReceipts, policyMembers, claims, policyDocuments,
} from "@shared/schema";
import { resolveAuditRefs } from "./audit-ref-resolver";

export type PolicyActivityActorType = "staff" | "client" | "system";

/** Writes a read-level event — never throws; a logging failure must not break the read it's
 *  describing. Fire-and-forget from the caller's perspective (awaited here, but errors swallowed). */
export async function logPolicyView(
  tdb: OrgDataDb,
  params: {
    organizationId: string;
    policyId: string;
    actorType: PolicyActivityActorType;
    actorId?: string | null;
    actorLabel?: string | null;
    action: string;
    detail?: Record<string, unknown> | null;
  }
): Promise<void> {
  try {
    await tdb.insert(policyViewLog).values({
      organizationId: params.organizationId,
      policyId: params.policyId,
      actorType: params.actorType,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
      action: params.action,
      detail: params.detail ?? null,
    });
  } catch {
    // Never let view-logging fail the request it's describing — worst case, one entry is missing
    // from the timeline, not a broken page load / download / payment.
  }
}

/** Every audit_logs entityId that belongs to this policy but isn't filed under the policy's own
 *  id — a payment, a member, a claim, a document all log against their OWN row's id. */
async function getRelatedEntityIds(tdb: OrgDataDb, policyId: string): Promise<string[]> {
  const [payments, receipts, members, policyClaims, documents] = await Promise.all([
    tdb.select({ id: paymentTransactions.id }).from(paymentTransactions).where(eq(paymentTransactions.policyId, policyId)),
    tdb.select({ id: paymentReceipts.id }).from(paymentReceipts).where(eq(paymentReceipts.policyId, policyId)),
    tdb.select({ id: policyMembers.id }).from(policyMembers).where(eq(policyMembers.policyId, policyId)),
    tdb.select({ id: claims.id }).from(claims).where(eq(claims.policyId, policyId)),
    tdb.select({ id: policyDocuments.id }).from(policyDocuments).where(eq(policyDocuments.policyId, policyId)),
  ]);
  return [
    ...payments.map((r) => r.id),
    ...receipts.map((r) => r.id),
    ...members.map((r) => r.id),
    ...policyClaims.map((r) => r.id),
    ...documents.map((r) => r.id),
  ];
}

export interface PolicyActivityEntry {
  id: string;
  source: "audit" | "view";
  timestamp: string;
  actorLabel: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  detail?: unknown;
}

/** The full merged timeline for one policy, newest first. `limit` bounds the audit_logs side
 *  (view-log rows are already scoped to just this policy, so they're never the large side). */
export async function getPolicyActivityLog(
  tdb: OrgDataDb,
  organizationId: string,
  policyId: string,
  limit = 300
): Promise<{ entries: PolicyActivityEntry[]; refs: Record<string, string> }> {
  const relatedIds = await getRelatedEntityIds(tdb, policyId);
  const entityIds = [policyId, ...relatedIds];

  const [auditRows, viewRows] = await Promise.all([
    tdb.select().from(auditLogs)
      .where(and(eq(auditLogs.organizationId, organizationId), inArray(auditLogs.entityId, entityIds)))
      .orderBy(desc(auditLogs.timestamp))
      .limit(limit),
    tdb.select().from(policyViewLog)
      .where(and(eq(policyViewLog.organizationId, organizationId), eq(policyViewLog.policyId, policyId)))
      .orderBy(desc(policyViewLog.createdAt))
      .limit(limit),
  ]);

  const refs = await resolveAuditRefs(tdb, auditRows);

  const entries: PolicyActivityEntry[] = [
    ...auditRows.map((r): PolicyActivityEntry => ({
      id: r.id,
      source: "audit",
      timestamp: r.timestamp.toISOString(),
      actorLabel: r.actorEmail || "The system",
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      before: r.before,
      after: r.after,
    })),
    ...viewRows.map((r): PolicyActivityEntry => ({
      id: r.id,
      source: "view",
      timestamp: r.createdAt.toISOString(),
      actorLabel: r.actorLabel || (r.actorType === "client" ? "The client" : "Staff"),
      action: r.action,
      detail: r.detail,
    })),
  ].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return { entries, refs };
}
