/**
 * Reports → Policies → Lapsed: a win-back list. Pure — no DB.
 *
 * Prices reinstatement exactly the way applyPolicyStatusForClearedPayment
 * (server/policy-status-on-payment.ts) decides it when a payment comes in, so the figure staff
 * quote is the figure that actually reinstates the policy:
 *  - migrated (isLegacy) policies: any cleared payment reinstates — one premium, no new waiting period.
 *  - product version "requires arrears" (the default when unset): only once the outstanding balance
 *    (computePolicyOutstanding — cleared payments + credit wallet vs premiums since inception) is
 *    cleared, so the cost is that balance, never less than one premium (the smallest receipt).
 *  - otherwise: one premium.
 *  - new waiting period: non-migrated policies whose product version doesn't switch it off.
 */
import { toCents, fromCents, mulCents } from "@shared/money";
import { computePolicyOutstanding } from "./policy-outstanding";
import { monthlyToScheduleFactor } from "./policy-overview";

export interface LapsedInput {
  policyId: string;
  isLegacy?: boolean;
  premiumAmount: string | number | null;
  currency?: string | null;
  paymentSchedule?: string | null;
  inceptionDate?: string | null;
}

export interface ReinstatementInputs {
  totalPaid: string;
  walletBalance: string;
  requiresArrears: boolean | null;
  newWaitingPeriod: boolean | null;
  waitingPeriodDays: number | null;
  /** Lapse date as a "YYYY-MM-DD" calendar day in the tenant's timezone. */
  lapsedOn: string | null;
  timesLapsed: number;
}

export interface LapsedInfo {
  lapsedOn: string | null;
  daysSinceLapse: number | null;
  timesLapsed: number;
  reinstateCost: string;
  reinstateBasis: "one_premium" | "arrears";
  newWaitingPeriod: boolean;
  newWaitingPeriodDays: number | null;
}

function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(to.slice(0, 10) + "T00:00:00Z") - Date.parse(from.slice(0, 10) + "T00:00:00Z")) / 86_400_000);
}

export function priceReinstatement(p: LapsedInput, inputs: ReinstatementInputs | undefined, today: string): LapsedInfo {
  const premiumCents = toCents(p.premiumAmount);
  const hasProductRules = !!inputs && inputs.requiresArrears !== null;
  let reinstateBasis: LapsedInfo["reinstateBasis"] = "one_premium";
  let costCents = premiumCents;
  if (!p.isLegacy && hasProductRules && inputs!.requiresArrears !== false) {
    const { outstanding } = computePolicyOutstanding({
      policy: { premiumAmount: p.premiumAmount, inceptionDate: p.inceptionDate, paymentSchedule: p.paymentSchedule },
      totalPaid: Number(inputs!.totalPaid),
      walletBalance: Number(inputs!.walletBalance),
    });
    reinstateBasis = "arrears";
    costCents = Math.max(premiumCents, toCents(outstanding));
  }
  const newWaitingPeriod = !p.isLegacy && hasProductRules && inputs!.newWaitingPeriod !== false;
  const lapsedOn = inputs?.lapsedOn ?? null;
  return {
    lapsedOn,
    daysSinceLapse: lapsedOn ? Math.max(0, daysBetweenIso(lapsedOn, today)) : null,
    timesLapsed: inputs?.timesLapsed ?? 0,
    reinstateCost: fromCents(costCents),
    reinstateBasis,
    newWaitingPeriod,
    newWaitingPeriodDays: newWaitingPeriod ? (inputs!.waitingPeriodDays ?? 90) : null,
  };
}

export interface LapsedSummary {
  count: number;
  lapsedThisMonth: number;
  /** Monthly-equivalent premium no longer coming in, per currency. */
  monthlyPremiumLost: Record<string, string>;
  /** What it would cost to bring every listed policy back, per currency. */
  reinstateAll: Record<string, string>;
}

/**
 * Adds lapse timing + reinstatement price to each lapsed row, filters by LAPSE date (inclusive
 * "YYYY-MM-DD" bounds — rows with no lapse record only appear when no dates are set), and sorts
 * most recent lapse first.
 */
export function buildLapsedList<T extends LapsedInput>(
  rows: T[],
  inputsByPolicy: Map<string, ReinstatementInputs>,
  today: string,
  range: { from?: string; to?: string } = {},
): { rows: (T & LapsedInfo)[]; summary: LapsedSummary } {
  const out: (T & LapsedInfo)[] = [];
  for (const r of rows) {
    const info = priceReinstatement(r, inputsByPolicy.get(r.policyId), today);
    if (range.from || range.to) {
      if (!info.lapsedOn) continue;
      if (range.from && info.lapsedOn < range.from) continue;
      if (range.to && info.lapsedOn > range.to) continue;
    }
    out.push({ ...r, ...info });
  }
  out.sort((a, b) => (b.lapsedOn ?? "").localeCompare(a.lapsedOn ?? ""));

  const lost: Record<string, number> = {};
  const all: Record<string, number> = {};
  const month = today.slice(0, 7);
  for (const r of out) {
    const c = r.currency || "USD";
    lost[c] = (lost[c] ?? 0) + mulCents(toCents(r.premiumAmount), 1 / monthlyToScheduleFactor(r.paymentSchedule || "monthly"));
    all[c] = (all[c] ?? 0) + toCents(r.reinstateCost);
  }
  const str = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([c, v]) => [c, fromCents(v)]));
  return {
    rows: out,
    summary: {
      count: out.length,
      lapsedThisMonth: out.filter((r) => r.lapsedOn?.startsWith(month)).length,
      monthlyPremiumLost: str(lost),
      reinstateAll: str(all),
    },
  };
}
