/**
 * Group ledger — a running premium-in/claim-out balance per group. Distinct from
 * server/pool-society.ts (voluntary member contributions/payouts, deliberately disconnected from
 * premiums and claims). This is the ledger group receipts (legacy lump-sum and regular
 * per-member) credit, and approved group-service claims debit — see shared/schema.ts's
 * groupLedgerEntries comment.
 */

export const CREDIT_ENTRY_TYPES = new Set(["premium_credit", "adjustment_credit", "historical_import"]);
export const DEBIT_ENTRY_TYPES = new Set(["claim_debit", "adjustment_debit"]);

export interface LedgerEntryLike {
  entryType: string;
  amount: string | number;
  currency: string;
}

/** Pure — balance per currency = credits in, minus debits out. Always-positive amounts, sign
 *  implied by entryType (same convention as pool-society's computePoolBalance). */
export function computeGroupLedgerBalance(entries: LedgerEntryLike[]): Record<string, number> {
  const balance: Record<string, number> = {};
  for (const e of entries) {
    const amt = parseFloat(String(e.amount));
    if (!Number.isFinite(amt)) continue;
    const sign = CREDIT_ENTRY_TYPES.has(e.entryType) ? 1 : DEBIT_ENTRY_TYPES.has(e.entryType) ? -1 : 0;
    if (sign === 0) continue;
    balance[e.currency] = (balance[e.currency] ?? 0) + sign * amt;
  }
  return balance;
}
