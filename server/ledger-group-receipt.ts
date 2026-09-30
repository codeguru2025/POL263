/**
 * Follow-up for a lump-sum receipt on a ledger group (legacy group / burial society), run from
 * the outbox so it retries if the server dies half-way:
 *
 *  1. Commission — the legacy-group rule: each member policy's agent earns 10% of that policy's
 *     share of what the group paid. The lump sum is split across the member policies by premium
 *     (allocateProRata, so shares add back up exactly); walk-in policies (no agent) earn nothing.
 *  2. SMS — every member of the group is told the group has paid (one text per client, even if
 *     they hold several policies in the group).
 *
 * Normal groups (not ledger groups) don't come through here: admins tick the members who paid,
 * and each ticked policy gets its own payment + commission through the normal payment path.
 */
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { notifyUser } from "./user-notifications";
import { dispatchNotification, buildPolicyContext } from "./notifications";
import { LEGACY_COMMISSION_RATES } from "./commission-calc";
import { allocateProRata, fromCents, toCents, type Cents } from "@shared/money";

export interface LedgerGroupReceiptPayload {
  receiptId: string;
  receiptNumber: string;
  groupId: string;
  amount: string;
  currency: string;
}

/** Policies that belong to the group for receipting: not deleted, not cancelled. */
export function receiptablePolicies<T extends { deletedAt?: unknown; status?: string | null }>(policies: T[]): T[] {
  return policies.filter((p) => !p.deletedAt && p.status !== "cancelled");
}

export interface CommissionShare { policyId: string; agentId: string; shareCents: Cents; commissionCents: Cents }

/**
 * Splits `totalCents` across `policies` by premium and returns each agent-held policy's
 * commission (`ratePercent` of its share, rounded to the cent). Walk-in policies still take their
 * share of the split — they just earn nobody commission — so an agent never earns on money that
 * other members paid.
 */
export function ledgerGroupCommissionShares(
  totalCents: Cents,
  policies: { id: string; agentId?: string | null; premiumAmount?: unknown }[],
  ratePercent: number,
): CommissionShare[] {
  if (totalCents <= 0 || policies.length === 0 || ratePercent <= 0) return [];
  const weights = policies.map((p) => Number(toCents(p.premiumAmount ?? 0)));
  const shares = allocateProRata(totalCents, weights);
  // 10% of the whole payment first, then split the same way — rounding each share's 10%
  // separately loses cents (USD 100 over 3 members → 3 × 3.33 = 9.99).
  const commissions = allocateProRata(Math.round((totalCents * ratePercent) / 100) as Cents, weights);
  const out: CommissionShare[] = [];
  policies.forEach((p, i) => {
    if (!p.agentId || commissions[i] <= 0) return;
    out.push({ policyId: p.id, agentId: p.agentId, shareCents: shares[i], commissionCents: commissions[i] });
  });
  return out;
}

const commissionMarker = (receiptNumber: string) => `lump-sum group receipt ${receiptNumber}`;

export async function runLedgerGroupReceiptFollowup(orgId: string, payload: LedgerGroupReceiptPayload): Promise<void> {
  const group = await storage.getGroup(payload.groupId, orgId);
  if (!group) return;
  const members = receiptablePolicies(await storage.getPoliciesByGroupId(orgId, payload.groupId));
  if (members.length === 0) return;

  // 1. Commission — idempotent: an outbox retry skips policies already credited for this receipt.
  const rate = LEGACY_COMMISSION_RATES.recurringRate;
  const shares = ledgerGroupCommissionShares(toCents(payload.amount), members, rate);
  if (shares.length > 0) {
    const marker = commissionMarker(payload.receiptNumber);
    const done = new Set(await storage.getCommissionPolicyIdsByDescriptionMarker(orgId, marker));
    const byAgent = new Map<string, Cents>();
    for (const s of shares) {
      if (done.has(s.policyId)) continue;
      await storage.createCommissionLedgerEntry({
        organizationId: orgId,
        agentId: s.agentId,
        policyId: s.policyId,
        transactionId: null,
        entryType: "recurring",
        amount: fromCents(s.commissionCents),
        currency: payload.currency,
        description: `${rate}% commission on ${payload.currency} ${fromCents(s.shareCents)} — this policy's share of ${marker} (${group.name})`,
        status: "earned",
      });
      byAgent.set(s.agentId, ((byAgent.get(s.agentId) ?? 0) + s.commissionCents) as Cents);
    }
    for (const [agentId, cents] of Array.from(byAgent)) {
      notifyUser(orgId, agentId, {
        type: "COMMISSION_EARNED",
        title: "Commission Earned",
        body: `${payload.currency} ${fromCents(cents)} commission from ${group.name}'s payment (${payload.receiptNumber}).`,
        metadata: { groupId: group.id, receiptId: payload.receiptId, amount: fromCents(cents), currency: payload.currency },
      }).catch(() => {});
    }
  }

  // 2. Text every member (once per client). dispatchNotification never throws and logs each send.
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
