/**
 * Claim workflow — the single place a claim changes status. Both the Claims page
 * (POST /api/claims/:id/transition) and the Approvals queue (POST /api/approvals/:id/resolve on a
 * CLAIM_REVIEW request) call transitionClaim, so a verdict given in either place:
 *
 *  1. moves the claim itself (previously, approving a CLAIM_REVIEW request in the Approvals
 *     queue left the claim sitting at "submitted" forever — the two were never connected);
 *  2. writes the verdict back onto the claimed covered life (policy_members.claim_status);
 *  3. for a ledger group (legacy group / burial society), debits the group's ledger and reports
 *     the balance before and after — a burial society claim must carry a cash-service quote,
 *     since that quote is what gets deducted;
 *  4. keeps the CLAIM_REVIEW approval request in step (approved / rejected / on hold while
 *     investigated / back to pending once the investigation is concluded).
 *
 * All of that commits in one transaction. A ledger debit is an internal movement of the group's
 * own funds — it never creates a receipt, a payment transaction, or any cash-flow line, so it
 * cannot appear as income in the daily financials.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { sql } from "drizzle-orm";
import {
  approvalRequests, claimStatusHistory, claims, funeralQuotations, groupLedgerEntries, groups,
  policies, policyMembers, VALID_CLAIM_TRANSITIONS, type Claim,
} from "@shared/schema";
import { storage } from "./storage";
import { withOrgTransaction, resolveOrSyncTenantUserId, ensureRegistryUserMirroredToOrgDataDb, type OrgDataDb } from "./tenant-db";
import { auditLog, resolvePolicyWaitingPeriodEndDate } from "./route-helpers";
import { todayForOrg } from "./date-utils";
import { computeGroupLedgerBalance } from "./group-ledger";
import { structuredLog } from "./logger";
import { notifyUser, notifyUsersWithPermission } from "./user-notifications";
import { notifyClientPush, dispatchNotification } from "./notifications";

export class ClaimWorkflowError extends Error {
  constructor(public status: number, message: string, public code?: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

/** Statuses in which the claim is still being decided — the only ones where its amount, quote
 *  or member can still be changed. */
export const UNDECIDED_CLAIM_STATUSES = ["submitted", "verified", "under_investigation"];

/** Member claim_status values (policy_members.claim_status). */
export const MEMBER_CLAIM_STATUS = {
  pending: "claim_pending",
  investigating: "under_investigation",
  approved: "claimed",
  declined: "claim_declined",
} as const;

export interface LedgerImpact {
  groupId: string;
  groupName: string;
  currency: string;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface TransitionClaimInput {
  req: any;
  claimId: string;
  toStatus: string;
  reason?: string;
  waitingPeriodOverrideReason?: string;
  isExGratia?: boolean;
  exGratiaReason?: string;
  /** Required when moving to under_investigation. */
  investigationReason?: string;
  investigationNextSteps?: string;
  /** Required when concluding an investigation (under_investigation -> verified). */
  investigationFindings?: string;
  /** "approvals" = decided from the Approvals queue: every decision there needs approve:claim. */
  source: "claims" | "approvals";
}

export async function checkWaitingPeriodViolation(policy: any, orgId: string, dateOfDeath: string | null | undefined): Promise<{ violated: boolean; waitingPeriodEndDate: string | null }> {
  const waitingPeriodEndDate = await resolvePolicyWaitingPeriodEndDate(policy, orgId);
  if (!waitingPeriodEndDate) return { violated: false, waitingPeriodEndDate: null };
  const asOf = dateOfDeath || await todayForOrg(orgId);
  return { violated: asOf < waitingPeriodEndDate, waitingPeriodEndDate };
}

/** The cash-service quote linked to a claim (funeralQuotations.claimId points at the claim). */
export async function getLinkedQuotation(tx: OrgDataDb, orgId: string, claimId: string) {
  const [q] = await tx.select().from(funeralQuotations)
    .where(and(eq(funeralQuotations.organizationId, orgId), eq(funeralQuotations.claimId, claimId)))
    .orderBy(desc(funeralQuotations.createdAt)).limit(1);
  return q;
}

function quotationAmount(q: { grandTotal?: string | null; total?: string | null }): number {
  const grand = parseFloat(String(q.grandTotal ?? "0"));
  return grand > 0 ? grand : parseFloat(String(q.total ?? "0"));
}

/**
 * What approving this claim would take out of its group's ledger, or null when the claim isn't
 * paid from a ledger. Throws when a ledger claim can't be approved yet (burial society with no
 * cash-service quote, or nothing to deduct).
 */
/** The ledger group a claim is paid from: the claim's own groupId, or — for claims logged before
 *  claims were linked automatically — the member's policy's group when that is a ledger group. */
export async function resolveClaimGroupId(tx: OrgDataDb, claim: Claim): Promise<string | null> {
  if (claim.groupId) return claim.groupId;
  const [row] = await tx.select({ groupId: groups.id }).from(policies)
    .innerJoin(groups, eq(groups.id, policies.groupId))
    .where(and(eq(policies.id, claim.policyId), eq(groups.organizationId, claim.organizationId), eq(groups.hasLedger, true)))
    .limit(1);
  return row?.groupId ?? null;
}

export async function resolveLedgerDebit(tx: OrgDataDb, claim: Claim): Promise<{ group: typeof groups.$inferSelect; amount: number; currency: string; quotationNumber: string | null } | null> {
  const groupId = await resolveClaimGroupId(tx, claim);
  if (!groupId) return null;
  const [group] = await tx.select().from(groups)
    .where(and(eq(groups.id, groupId), eq(groups.organizationId, claim.organizationId))).limit(1);
  if (!group) return null;
  const quotation = await getLinkedQuotation(tx, claim.organizationId, claim.id);
  return { group, ...ledgerDebitFor(group, quotation ?? null, claim) };
}

/** Pure rule for what a ledger-group claim deducts: the attached cash-service quote's total if
 *  there is one, otherwise the claim amount. A burial society must have a quote. */
export function ledgerDebitFor(
  group: { name: string; type: string },
  quotation: { quotationNumber: string; currency: string; grandTotal?: string | null; total?: string | null } | null,
  claim: { cashInLieuAmount?: string | null; currency?: string | null },
): { amount: number; currency: string; quotationNumber: string | null } {
  if (group.type === "burial_society" && !quotation) {
    throw new ClaimWorkflowError(400,
      `${group.name} is a burial society — every claim must have a cash-service quote attached, because the quoted amount is what gets deducted from the society's ledger. Attach a quote to this claim, then approve it.`,
      "quotation_required");
  }
  const amount = quotation ? quotationAmount(quotation) : parseFloat(String(claim.cashInLieuAmount ?? "0"));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ClaimWorkflowError(400,
      `This claim is paid from ${group.name}'s ledger, but there's no amount to deduct. Enter the claim amount or attach a cash-service quote, then approve it.`,
      "ledger_amount_required");
  }
  return { amount, currency: quotation?.currency || claim.currency || "USD", quotationNumber: quotation?.quotationNumber ?? null };
}

export async function getGroupLedgerBalanceInTx(tx: OrgDataDb, orgId: string, groupId: string): Promise<Record<string, number>> {
  const entries = await tx.select({ entryType: groupLedgerEntries.entryType, amount: groupLedgerEntries.amount, currency: groupLedgerEntries.currency })
    .from(groupLedgerEntries)
    .where(and(eq(groupLedgerEntries.organizationId, orgId), eq(groupLedgerEntries.groupId, groupId)));
  return computeGroupLedgerBalance(entries);
}

async function setMemberClaimStatus(tx: OrgDataDb, claim: Claim, status: string | null, note: string | null, verdict: boolean) {
  if (!claim.policyMemberId) return null;
  const [before] = await tx.select().from(policyMembers).where(eq(policyMembers.id, claim.policyMemberId)).limit(1);
  if (!before) return null;
  const patch: Record<string, unknown> = { claimStatus: status, claimVerdictNote: note };
  patch.claimVerdictAt = verdict ? new Date() : null;
  // An approved death claim records the date of death on the member; a decline clears it.
  if (status === MEMBER_CLAIM_STATUS.approved) patch.dateOfDeath = claim.dateOfDeath ?? null;
  else if (status === MEMBER_CLAIM_STATUS.declined) patch.dateOfDeath = null;
  const [after] = await tx.update(policyMembers).set(patch as any).where(eq(policyMembers.id, claim.policyMemberId)).returning();
  return { before, after };
}

/** Re-open (or create) the claim's CLAIM_REVIEW request so it goes back to the approvers. */
async function requeueForApproval(tx: OrgDataDb, claim: Claim, initiatedBy: string, extra: Record<string, unknown>) {
  const [existing] = await tx.select().from(approvalRequests)
    .where(and(
      eq(approvalRequests.organizationId, claim.organizationId),
      eq(approvalRequests.requestType, "CLAIM_REVIEW"),
      eq(approvalRequests.entityId, claim.id),
      inArray(approvalRequests.status, ["pending", "on_hold"]),
    ))
    .orderBy(desc(approvalRequests.createdAt)).limit(1);
  const requestData = {
    claimNumber: claim.claimNumber, claimType: claim.claimType, amount: claim.cashInLieuAmount,
    deceasedName: claim.deceasedName, ...extra,
  };
  if (existing) {
    const [row] = await tx.update(approvalRequests)
      .set({ status: "pending", requestData: { ...(existing.requestData as any || {}), ...requestData }, approvedBy: null, rejectionReason: null, resolvedAt: null } as any)
      .where(eq(approvalRequests.id, existing.id)).returning();
    return row;
  }
  const [row] = await tx.insert(approvalRequests).values({
    organizationId: claim.organizationId,
    requestType: "CLAIM_REVIEW",
    entityType: "Claim",
    entityId: claim.id,
    requestData,
    status: "pending",
    initiatedBy,
  }).returning();
  return row;
}

async function syncApprovalRequest(tx: OrgDataDb, claim: Claim, status: "approved" | "rejected" | "on_hold", decidedBy: string, reason: string | null) {
  const [existing] = await tx.select().from(approvalRequests)
    .where(and(
      eq(approvalRequests.organizationId, claim.organizationId),
      eq(approvalRequests.requestType, "CLAIM_REVIEW"),
      eq(approvalRequests.entityId, claim.id),
      inArray(approvalRequests.status, ["pending", "on_hold"]),
    ))
    .orderBy(desc(approvalRequests.createdAt)).limit(1);
  if (!existing) return null;
  const patch: Record<string, unknown> = { status };
  if (status === "on_hold") {
    patch.requestData = { ...(existing.requestData as any || {}), investigationReason: reason };
  } else {
    patch.approvedBy = decidedBy;
    patch.rejectionReason = status === "rejected" ? reason : null;
    patch.resolvedAt = new Date();
  }
  const [row] = await tx.update(approvalRequests).set(patch as any).where(eq(approvalRequests.id, existing.id)).returning();
  return row;
}

export async function transitionClaim(input: TransitionClaimInput): Promise<{ claim: Claim; ledger: LedgerImpact | null }> {
  const { req, claimId, toStatus } = input;
  const user = req.user as any;
  const orgId = user.organizationId;
  const reason = (input.reason ?? "").trim();

  const claim = await storage.getClaim(claimId, orgId);
  if (!claim || claim.organizationId !== orgId) throw new ClaimWorkflowError(404, "Claim not found");
  await ensureRegistryUserMirroredToOrgDataDb(orgId, user.id);

  const allowed = VALID_CLAIM_TRANSITIONS[claim.status];
  if (!allowed || !allowed.includes(toStatus)) {
    throw new ClaimWorkflowError(400, `A claim that is "${claim.status.replace(/_/g, " ")}" can't be moved to "${String(toStatus).replace(/_/g, " ")}".`);
  }

  const effectiveUserId = await resolveOrSyncTenantUserId(orgId, user.id);
  const isDecision = ["approved", "rejected", "under_investigation"].includes(toStatus);
  if (["approved", "paid"].includes(toStatus) || (input.source === "approvals" && isDecision)) {
    const perms = await storage.getUserEffectivePermissions(user.id, orgId);
    if (!user.isPlatformOwner && !perms.includes("approve:claim")) {
      throw new ClaimWorkflowError(403, "You need the claim approval permission to decide on claims.");
    }
  }
  if (["approved", "paid"].includes(toStatus)) {
    // Segregation of duties: whoever submitted or verified this claim cannot approve/mark it
    // paid — platform owner is the sole exception.
    const isSelfClaim = (claim.submittedBy === effectiveUserId || claim.verifiedBy === effectiveUserId) && !user.isPlatformOwner;
    if (isSelfClaim) throw new ClaimWorkflowError(403, "You cannot approve or mark paid a claim you submitted or verified yourself.");
  }
  if (toStatus === "rejected" && !reason) {
    throw new ClaimWorkflowError(400, "Give a reason for declining the claim — it's recorded against the member on the policy.");
  }

  // Investigation: what's being investigated and the next steps are both required going in;
  // the findings are required coming out (back to verified = back for approval).
  const investigationReason = (input.investigationReason ?? "").trim();
  const investigationNextSteps = (input.investigationNextSteps ?? "").trim();
  const investigationFindings = (input.investigationFindings ?? "").trim();
  if (toStatus === "under_investigation" && (!investigationReason || !investigationNextSteps)) {
    throw new ClaimWorkflowError(400, "Say what is being investigated and what the next steps are before sending the claim for investigation.");
  }
  const concludingInvestigation = claim.status === "under_investigation" && toStatus === "verified";
  if (concludingInvestigation && !investigationFindings) {
    throw new ClaimWorkflowError(400, "Record the investigation findings before sending the claim back for approval.");
  }

  // Hard stop on a waiting-period violation at approval — needs an explicit, logged override.
  let waitingPeriodOverride: { waitingPeriodEndDate: string; reason: string } | undefined;
  if (toStatus === "approved" && claim.policyId) {
    const claimPolicy = await storage.getPolicy(claim.policyId, orgId);
    const wp = await checkWaitingPeriodViolation(claimPolicy, orgId, claim.dateOfDeath);
    if (wp.violated) {
      const overrideReason = (input.waitingPeriodOverrideReason ?? "").trim();
      if (!overrideReason) {
        throw new ClaimWorkflowError(400,
          `The date of death is before this policy's waiting period ends (${wp.waitingPeriodEndDate}). To approve it anyway, open the claim on the Claims page and give a waiting-period override reason.`,
          "waiting_period_violation", { waitingPeriodEndDate: wp.waitingPeriodEndDate });
      }
      waitingPeriodOverride = { waitingPeriodEndDate: wp.waitingPeriodEndDate!, reason: overrideReason };
    }
  }

  let exGratia: { reason: string } | undefined;
  if (toStatus === "approved" && input.isExGratia) {
    const exGratiaReason = (input.exGratiaReason ?? "").trim();
    if (!exGratiaReason) throw new ClaimWorkflowError(400, "A reason is required to approve a claim as ex gratia.");
    exGratia = { reason: exGratiaReason };
  }

  const before = { ...claim };
  const now = new Date();
  const updateData: Record<string, unknown> = { status: toStatus };
  if (toStatus === "verified") updateData.verifiedBy = claim.verifiedBy ?? effectiveUserId;
  if (toStatus === "approved") updateData.approvedBy = effectiveUserId;
  if (toStatus === "approved" || toStatus === "rejected") {
    updateData.decisionReason = reason || (exGratia ? `Ex gratia: ${exGratia.reason}` : null);
    updateData.decidedBy = effectiveUserId;
    updateData.decidedAt = now;
  }
  if (toStatus === "under_investigation") {
    Object.assign(updateData, {
      investigationReason, investigationNextSteps,
      investigationOpenedAt: now, investigationOpenedBy: effectiveUserId,
      investigationFindings: null, investigationClosedAt: null,
    });
  }
  if (concludingInvestigation) {
    Object.assign(updateData, { investigationFindings, investigationClosedAt: now });
  }
  if (claim.status === "under_investigation" && toStatus === "rejected") {
    updateData.investigationClosedAt = now;
  }
  if (waitingPeriodOverride) {
    updateData.fraudFlags = {
      ...(claim.fraudFlags as any || {}),
      waitingPeriod: { violated: true, waitingPeriodEndDate: waitingPeriodOverride.waitingPeriodEndDate, overriddenBy: effectiveUserId, overrideReason: waitingPeriodOverride.reason, overriddenAt: now.toISOString() },
    };
  }
  if (exGratia) {
    updateData.isExGratia = true;
    updateData.exGratiaReason = exGratia.reason;
  }

  let requeued = false;
  const result = await withOrgTransaction(orgId, async (tx) => {
    // Serialize concurrent decisions on the same claim.
    await tx.execute(sql`SELECT id FROM claims WHERE id = ${claim.id} FOR UPDATE`);
    const [current] = await tx.select({ status: claims.status }).from(claims).where(eq(claims.id, claim.id)).limit(1);
    if (current?.status !== claim.status) {
      throw new ClaimWorkflowError(409, "This claim was just updated by someone else — refresh and try again.");
    }

    let ledger: LedgerImpact | null = null;
    if (toStatus === "approved") {
      const debit = await resolveLedgerDebit(tx, claim);
      if (debit) {
        // Lock the group row so two approvals against the same ledger can't both read the
        // same "before" balance.
        await tx.execute(sql`SELECT id FROM groups WHERE id = ${debit.group.id} FOR UPDATE`);
        const balance = await getGroupLedgerBalanceInTx(tx, orgId, debit.group.id);
        const balanceBefore = balance[debit.currency] ?? 0;
        await storage.createGroupLedgerEntryInTx(tx, {
          organizationId: orgId,
          groupId: debit.group.id,
          entryType: "claim_debit",
          amount: debit.amount.toFixed(2),
          currency: debit.currency,
          description: `Claim ${claim.claimNumber} approved${claim.deceasedName ? ` — ${claim.deceasedName}` : ""}${debit.quotationNumber ? ` (quote ${debit.quotationNumber})` : ""}`,
          referenceType: "claim",
          referenceId: claim.id,
          createdBy: effectiveUserId,
        });
        updateData.ledgerAmount = debit.amount.toFixed(2);
        updateData.groupId = debit.group.id;
        ledger = {
          groupId: debit.group.id, groupName: debit.group.name, currency: debit.currency,
          amount: debit.amount, balanceBefore, balanceAfter: balanceBefore - debit.amount,
        };
      }
    }

    const [row] = await tx.update(claims).set(updateData as any)
      .where(and(eq(claims.id, claim.id), eq(claims.organizationId, orgId)))
      .returning();

    const historyParts: string[] = [];
    if (reason) historyParts.push(reason);
    if (toStatus === "under_investigation") historyParts.push(`Investigating: ${investigationReason}`, `Next steps: ${investigationNextSteps}`);
    if (concludingInvestigation) historyParts.push(`Investigation findings: ${investigationFindings}`, "Sent back for approval");
    if (waitingPeriodOverride) historyParts.push(`Waiting period override: ${waitingPeriodOverride.reason}`);
    if (exGratia) historyParts.push(`Ex gratia: ${exGratia.reason}`);
    if (ledger) historyParts.push(`${ledger.currency} ${ledger.amount.toFixed(2)} deducted from ${ledger.groupName}'s ledger (balance ${ledger.balanceBefore.toFixed(2)} → ${ledger.balanceAfter.toFixed(2)})`);
    if (input.source === "approvals") historyParts.push("Decided from the Approvals queue");
    await tx.insert(claimStatusHistory).values({
      claimId: claim.id, fromStatus: claim.status, toStatus, reason: historyParts.join(" — ") || null, changedBy: effectiveUserId,
    });

    // Write the verdict back onto the claimed member.
    let member: { before: any; after: any } | null = null;
    if (toStatus === "approved") {
      const note = `Claim ${claim.claimNumber} approved${exGratia ? " (ex gratia)" : ""}${reason ? `: ${reason}` : ""}`;
      member = await setMemberClaimStatus(tx, row, MEMBER_CLAIM_STATUS.approved, note, true);
    } else if (toStatus === "rejected") {
      member = await setMemberClaimStatus(tx, row, MEMBER_CLAIM_STATUS.declined, `Claim ${claim.claimNumber} declined: ${reason}`, true);
    } else if (toStatus === "under_investigation") {
      member = await setMemberClaimStatus(tx, row, MEMBER_CLAIM_STATUS.investigating, `Claim ${claim.claimNumber} under investigation: ${investigationReason}`, false);
    } else if (toStatus === "verified") {
      member = await setMemberClaimStatus(tx, row, MEMBER_CLAIM_STATUS.pending, `Claim ${claim.claimNumber} awaiting approval`, false);
    }

    // Keep the Approvals queue in step with the claim.
    let approval: any = null;
    if (toStatus === "approved" || toStatus === "rejected") {
      approval = await syncApprovalRequest(tx, claim, toStatus, effectiveUserId, reason || null);
    } else if (toStatus === "under_investigation") {
      approval = await syncApprovalRequest(tx, claim, "on_hold", effectiveUserId, investigationReason);
    } else if (concludingInvestigation) {
      approval = await requeueForApproval(tx, row, claim.submittedBy ?? effectiveUserId, { investigationFindings });
      requeued = true;
    }

    await auditLog(req, "TRANSITION_CLAIM", "Claim", claim.id, before, row, undefined, tx);
    if (member) await auditLog(req, "UPDATE_MEMBER_CLAIM_STATUS", "PolicyMember", member.after.id, member.before, member.after, undefined, tx);
    if (approval) await auditLog(req, "SYNC_CLAIM_APPROVAL_REQUEST", "ApprovalRequest", approval.id, null, approval, undefined, tx);
    return { claim: row as Claim, ledger };
  });

  // Notifications — best effort, after commit.
  const label = toStatus === "under_investigation" ? "under investigation" : toStatus === "verified" && concludingInvestigation ? "back for approval" : toStatus;
  if (claim.submittedBy && claim.submittedBy !== effectiveUserId) {
    notifyUser(orgId, claim.submittedBy, {
      type: "CLAIM_STATUS",
      title: `Claim ${claim.claimNumber}: ${label}`,
      body: `Claim ${claim.claimNumber} is now ${label}${reason ? `: ${reason}` : ""}.`,
      metadata: { claimId: claim.id, claimNumber: claim.claimNumber, toStatus },
    }).catch(() => {});
  }
  if (requeued) {
    notifyUsersWithPermission(orgId, "approve:requests", {
      type: "APPROVAL_NEEDED",
      title: "Claim back for approval",
      body: `Claim ${claim.claimNumber}'s investigation is complete and it needs your decision.`,
      metadata: { claimId: claim.id, claimNumber: claim.claimNumber },
    }).catch(() => {});
  }
  if (claim.clientId && toStatus !== "verified") {
    const statusLabel = label.charAt(0).toUpperCase() + label.slice(1);
    notifyClientPush(orgId, claim.clientId, `Claim ${statusLabel}`, `Your claim ${claim.claimNumber} is ${label}.`, claim.policyId ?? undefined).catch(() => {});
    storage.getClient(claim.clientId, orgId).then((claimClient) =>
      dispatchNotification(orgId, "claim_status_change", claim.clientId!, {
        clientName: claimClient ? `${claimClient.firstName} ${claimClient.lastName}` : undefined,
        firstName: claimClient?.firstName,
        lastName: claimClient?.lastName,
        claimNumber: claim.claimNumber,
        status: statusLabel,
        policyId: claim.policyId ?? undefined,
      })
    ).catch((err) => structuredLog("warn", "Claim status client notification failed", { claimId: claim.id, error: err?.message }));
  }
  return result;
}
