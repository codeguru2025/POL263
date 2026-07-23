/**
 * Accumulation engine (Phase 3e of the multi-vertical platform work) — pensions, investments,
 * education protect. Structurally almost nothing like the risk engine (3a-3c): there's no
 * premium/claim, just a contribution ledger that compounds toward a maturity payout. Fund
 * balance is computed analytically rather than posted periodically (see
 * shared/schema.ts's accumulationAccounts comment) — each contribution compounds independently
 * from its own contribution date to the as-of date, then all contributions (minus paid
 * withdrawals) are summed per currency.
 */

const MS_PER_YEAR = 365.25 * 24 * 60 * 60 * 1000;

function yearsBetween(from: string, to: string): number {
  const a = new Date(from + "T00:00:00Z").getTime();
  const b = new Date(to + "T00:00:00Z").getTime();
  return Math.max(0, (b - a) / MS_PER_YEAR);
}

/** Pure — compound growth on a single contribution from its own date to the as-of date.
 *  annualRatePercent <= 0 or null returns the contribution unchanged (no growth applied). */
export function computeContributionFutureValue(
  contributionAmount: number,
  annualRatePercent: number | null | undefined,
  contributionDate: string,
  asOfDate: string,
): number {
  const rate = Number(annualRatePercent ?? 0);
  if (!Number.isFinite(rate) || rate <= 0) return contributionAmount;
  const years = yearsBetween(contributionDate, asOfDate);
  return contributionAmount * Math.pow(1 + rate / 100, years);
}

export interface LedgerContribution {
  amount: string | number;
  currency: string;
  contributionDate: string;
}

export interface LedgerWithdrawal {
  amount: string | number;
  currency: string;
  status: string;
}

/** Pure — fund balance per currency as of asOfDate: each contribution's compounded future value,
 *  summed, minus withdrawals that have actually been paid (pending/approved don't reduce it yet). */
export function computeAccumulationBalance(
  contributions: LedgerContribution[],
  withdrawals: LedgerWithdrawal[],
  annualRatePercent: number | null | undefined,
  asOfDate: string,
): Record<string, number> {
  const balance: Record<string, number> = {};
  for (const c of contributions) {
    const amt = parseFloat(String(c.amount));
    if (!Number.isFinite(amt)) continue;
    const fv = computeContributionFutureValue(amt, annualRatePercent, c.contributionDate, asOfDate);
    balance[c.currency] = (balance[c.currency] ?? 0) + fv;
  }
  for (const w of withdrawals) {
    if (w.status !== "paid") continue;
    const amt = parseFloat(String(w.amount));
    if (!Number.isFinite(amt)) continue;
    balance[w.currency] = (balance[w.currency] ?? 0) - amt;
  }
  return balance;
}

/** Pure — maturityTermMonths <= 0 or null means no fixed term (no maturity date). */
export function resolveMaturityDate(startDate: string, maturityTermMonths: number | null | undefined): string | null {
  if (!maturityTermMonths || maturityTermMonths <= 0) return null;
  const d = new Date(startDate + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCMonth(d.getUTCMonth() + maturityTermMonths);
  return d.toISOString().split("T")[0];
}

/** Pure — an account with no maturity date configured is never "matured" (an open-ended
 *  investment product, for instance). */
export function isMatured(maturityDate: string | null | undefined, asOfDate: string): boolean {
  if (!maturityDate) return false;
  return maturityDate <= asOfDate;
}
