/**
 * Pure commission maths — no DB. recordAgentCommission (route-helpers.ts) feeds it the policy's
 * payment history and turns the result into commission_ledger_entries rows.
 *
 * Commission is worked out per month paid, not per payment transaction. A payment that covers
 * four months (e.g. R960 on a R240/month policy) is four months of commission: months 1-2 at the
 * first-months rate, months 3+ at the recurring rate. Counting it as "payment #1" paid 50% on all
 * four months.
 *
 * Months come from the cover period each payment bought (period_from..period_to), not from
 * amount ÷ premium — policies.premium_amount often isn't what the client actually pays (old
 * premiums, overrides), so dividing by it lands payments in the wrong month.
 */
import { fromCents, mulCents, splitCents, type Cents } from "@shared/money";

export interface CommissionRates {
  /** Months paid at firstRate (month 1..firstMonths). */
  firstMonths: number;
  firstRate: number;
  /** First month (1-based) that earns recurringRate. Months between firstMonths and this earn nothing. */
  recurringStart: number;
  recurringRate: number;
}

/** Used when a product version has no commission rates and the org has no active plan. */
export const DEFAULT_COMMISSION_RATES: CommissionRates = { firstMonths: 2, firstRate: 50, recurringStart: 3, recurringRate: 10 };

/** Migrated (is_legacy) policies: the old system already paid the joining commission, so
 *  every month pays the recurring rate only. */
export const LEGACY_COMMISSION_RATES: CommissionRates = { firstMonths: 0, firstRate: 0, recurringStart: 1, recurringRate: 10 };

const PERIOD_DAYS: Record<string, number> = { weekly: 7, biweekly: 14, monthly: 30.44, quarterly: 91.31, yearly: 365.25, annually: 365.25 };

/** Premium periods a payment's cover period spans (period_to is inclusive). No period on record
 *  (older payments, group batch receipts) counts as one. */
export function periodsCovered(periodFrom: string | Date | null | undefined, periodTo: string | Date | null | undefined, schedule?: string | null): number {
  if (!periodFrom || !periodTo) return 1;
  const days = (new Date(periodTo).getTime() - new Date(periodFrom).getTime()) / 86_400_000 + 1;
  if (!Number.isFinite(days) || days <= 0) return 1;
  return Math.max(1, Math.round(days / (PERIOD_DAYS[String(schedule || "monthly")] ?? 30.44)));
}

export interface CommissionSplit {
  entryType: "first_months" | "recurring";
  rate: number;
  /** Portion of the payment this rate applies to, in cents. */
  baseCents: Cents;
  commission: string;
  /** 1-based months covered by this portion. */
  fromMonth: number;
  toMonth: number;
}

function tierFor(month: number, rates: CommissionRates): { entryType: CommissionSplit["entryType"]; rate: number } | null {
  if (month <= rates.firstMonths) return { entryType: "first_months", rate: rates.firstRate };
  if (month >= Math.max(1, rates.recurringStart)) return { entryType: "recurring", rate: rates.recurringRate };
  return null; // gap between the first-months tier and the recurring start
}

/**
 * Splits one payment into commission portions. priorMonths is how many months the policy had
 * already paid before this payment; the payment covers the next `months` months, its amount
 * shared evenly across them (to the cent).
 */
export function commissionSplits(priorMonths: number, paymentCents: Cents, months: number, rates: CommissionRates): CommissionSplit[] {
  if (paymentCents <= 0) return [];
  const n = Math.max(1, Math.floor(months));
  const shares = splitCents(paymentCents, n);
  const out: CommissionSplit[] = [];
  for (let i = 0; i < n; i++) {
    const month = Math.max(0, priorMonths) + i + 1;
    const tier = tierFor(month, rates);
    if (!tier || tier.rate <= 0) continue;
    const last = out[out.length - 1];
    if (last && last.entryType === tier.entryType && last.rate === tier.rate && last.toMonth === month - 1) {
      last.baseCents += shares[i];
      last.toMonth = month;
    } else {
      out.push({ entryType: tier.entryType, rate: tier.rate, baseCents: shares[i], commission: "0.00", fromMonth: month, toMonth: month });
    }
  }
  for (const s of out) s.commission = fromCents(mulCents(s.baseCents, s.rate / 100));
  return out.filter((s) => s.commission !== "0.00");
}

/** Report label for commission on a policy with no agent (ledger agent_id NULL). */
export const WALK_IN_COMMISSION_NAME = "Walk-in (company)";
