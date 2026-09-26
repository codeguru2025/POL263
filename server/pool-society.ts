/**
 * Pooled-contribution/society engine (Phase 3d of the multi-vertical platform work). Burial
 * societies and cash clubs don't underwrite individual risk — members pay into a shared pool
 * (shared/schema.ts's groupContributions) and the society decides payouts from that pool
 * (groupPoolPayouts) against its own configured rules (groups.payoutRules). Deliberately
 * self-contained: no dependency on the risk/policy engine (3a-3c) or on the existing lump-sum
 * legacy_group_receipts ledger (server/routes.ts's /api/groups/legacy-receipts), which keeps
 * recording exactly as it does today.
 */
import { tryToCents, centsToNumber, subMoney } from "@shared/money";

export interface GroupPayoutRule {
  eventType: string;
  label: string;
  amount: number;
  currency: string;
}

export interface LedgerContribution {
  amount: string | number;
  currency: string;
}

export interface LedgerPayout {
  amount: string | number;
  currency: string;
  status: string;
}

/** Pure — balance per currency = contributions in, minus payouts that have actually been paid
 *  out (pending/approved payouts don't reduce the balance yet). */
export function computePoolBalance(
  contributions: LedgerContribution[],
  payouts: LedgerPayout[],
): Record<string, number> {
  // Integer cents so the pool balance is exact however many contributions it sums.
  const cents: Record<string, number> = {};
  for (const c of contributions) {
    const amt = tryToCents(c.amount);
    if (amt == null) continue;
    cents[c.currency] = (cents[c.currency] ?? 0) + amt;
  }
  for (const p of payouts) {
    if (p.status !== "paid") continue;
    const amt = tryToCents(p.amount);
    if (amt == null) continue;
    cents[p.currency] = (cents[p.currency] ?? 0) - amt;
  }
  const balance: Record<string, number> = {};
  for (const [currency, c] of Object.entries(cents)) balance[currency] = centsToNumber(c);
  return balance;
}

/** Pure — looks up the configured amount for an event type/currency pair. Returns null when no
 *  rule is configured (the group hasn't set payoutRules, or this specific event/currency combo
 *  isn't in it) — callers decide whether that blocks the payout or just skips the suggestion. */
export function resolvePoolPayoutAmount(
  rules: GroupPayoutRule[] | null | undefined,
  eventType: string,
  currency: string,
): number | null {
  const rule = (rules || []).find((r) => r.eventType === eventType && r.currency === currency);
  return rule ? rule.amount : null;
}

export interface PoolPayoutAffordability {
  currentBalance: number;
  requestedAmount: number;
  sufficientFunds: boolean;
  shortfall: number;
}

/** Pure — sufficientFunds is false (not clamped/blocked here) when the pool can't cover the
 *  requested amount; the route layer decides whether that's a hard block or an override-able
 *  soft warning. */
export function checkPoolPayoutAffordability(
  currentBalance: number,
  requestedAmount: number,
): PoolPayoutAffordability {
  const shortfall = Math.max(0, subMoney(requestedAmount, currentBalance));
  return {
    currentBalance,
    requestedAmount,
    sufficientFunds: shortfall === 0,
    shortfall,
  };
}
