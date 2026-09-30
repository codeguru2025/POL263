/**
 * Follow-up for a lump-sum receipt on a ledger group (legacy group / burial society), run from
 * the outbox so it retries if the server dies half-way:
 *
 * A society brings whatever it has saved (it keeps a running ledger with the tenant), not one
 * premium per member, so the admin ticks which members a payment covers.
 *
 *  1. Commission — on the group's payment, not per policy: the group's agent (groups.agent_id)
 *     earns 10% of whatever the group paid. A group with no agent earns nobody commission.
 *  2. SMS — every ticked member is told the group has paid (one text per client, even if they
 *     hold several policies in the group).
 *
 * Normal groups (not ledger groups) don't come through here: admins tick the members who paid,
 * and each ticked policy gets its own payment + commission through the normal payment path.
 */
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { notifyUser } from "./user-notifications";
import { dispatchNotification, buildPolicyContext } from "./notifications";
import { LEGACY_COMMISSION_RATES } from "./commission-calc";
import { fromCents, toCents, type Cents } from "@shared/money";

export interface LedgerGroupReceiptPayload {
  receiptId: string;
  receiptNumber: string;
  groupId: string;
  amount: string;
  currency: string;
  /** Members this payment covers. Missing on jobs queued before ticking existed = everyone. */
  includedPolicyIds?: string[];
}

/** Policies that belong to the group for receipting: not deleted, not cancelled. */
export function receiptablePolicies<T extends { deletedAt?: unknown; status?: string | null }>(policies: T[]): T[] {
  return policies.filter((p) => !p.deletedAt && p.status !== "cancelled");
}

/** The society agent's commission: `ratePercent` of what the group paid, to the cent. */
export function ledgerGroupCommissionCents(totalCents: Cents, ratePercent: number): Cents {
  if (totalCents <= 0 || ratePercent <= 0) return 0 as Cents;
  return Math.round((totalCents * ratePercent) / 100) as Cents;
}

// Trailing space matters: the lookup is a "contains" match, so "…-100 " must not match "…-1000 ".
const commissionMarker = (receiptNumber: string) => `lump-sum group receipt ${receiptNumber} `;

export async function runLedgerGroupReceiptFollowup(orgId: string, payload: LedgerGroupReceiptPayload): Promise<void> {
  const group = await storage.getGroup(payload.groupId, orgId);
  if (!group) return;

  // 1. Commission — on the group's payment, not per policy: the society's agent earns 10% of
  //    whatever the group paid. No agent on the group = nobody earns. Idempotent on retry.
  const rate = LEGACY_COMMISSION_RATES.recurringRate;
  const commissionCents = ledgerGroupCommissionCents(toCents(payload.amount), rate);
  if (group.agentId && commissionCents > 0) {
    const marker = commissionMarker(payload.receiptNumber);
    if (!(await storage.hasCommissionWithDescriptionMarker(orgId, marker))) {
      await storage.createCommissionLedgerEntry({
        organizationId: orgId,
        agentId: group.agentId,
        policyId: null,
        transactionId: null,
        entryType: "recurring",
        amount: fromCents(commissionCents),
        currency: payload.currency,
        description: `${rate}% commission on ${payload.currency} ${fromCents(toCents(payload.amount))} paid by ${group.name} — ${marker}`,
        status: "earned",
      });
      notifyUser(orgId, group.agentId, {
        type: "COMMISSION_EARNED",
        title: "Commission Earned",
        body: `${payload.currency} ${fromCents(commissionCents)} commission from ${group.name}'s payment (${payload.receiptNumber}).`,
        metadata: { groupId: group.id, receiptId: payload.receiptId, amount: fromCents(commissionCents), currency: payload.currency },
      }).catch(() => {});
    }
  }

  // 2. Text every ticked member (once per client). dispatchNotification never throws.
  let members = receiptablePolicies(await storage.getPoliciesByGroupId(orgId, payload.groupId));
  if (payload.includedPolicyIds) {
    const wanted = new Set(payload.includedPolicyIds);
    members = members.filter((p) => wanted.has(p.id));
  }
  const amountLabel = `${payload.currency} ${fromCents(toCents(payload.amount))}`;
  const texted = new Set<string>();
  for (const p of members) {
    if (!p.clientId || texted.has(p.clientId)) continue;
    texted.add(p.clientId);
    try {
      const ctx = await buildPolicyContext(p, orgId, { paymentAmount: amountLabel, groupName: group.name });
      await dispatchNotification(orgId, "group_receipt", p.clientId, ctx);
    } catch (err: any) {
      structuredLog("error", "Group receipt member notification failed", { orgId, groupId: group.id, policyId: p.id, error: err?.message });
    }
  }
}
