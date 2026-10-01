/**
 * A policy's payment position — Reports → Finance → Finance report, and the arrears exports
 * built on it. Pure — no DB.
 *
 *  - Months paid: the premium periods its receipts actually cover (a USD 40 receipt on a USD 10
 *    monthly premium is 4 months, not "1 receipt").
 *  - Owed: premiums due since the paid-up-to date, up to today (FLK00329, paid up to 30 Jul,
 *    owes Aug + Sep = 2 × premium).
 *  - Paid ahead: whole premium periods beyond the one running today.
 */
import { toCents, fromCents } from "@shared/money";
import { periodsCovered } from "./commission-calc";

/** Premium periods one receipt pays for: its recorded covered period, otherwise amount ÷ premium
 *  (at least one). */
export function periodsPaidByReceipt(r: { periodFrom?: string | null; periodTo?: string | null; amount: string | number; premium: string | number | null; schedule?: string | null }): number {
  if (r.periodFrom && r.periodTo) return periodsCovered(r.periodFrom, r.periodTo, r.schedule);
  const premiumC = toCents(r.premium ?? 0);
  return premiumC > 0 ? Math.max(1, Math.round(toCents(r.amount) / premiumC)) : 1;
}

function addPeriods(date: string, n: number, schedule: string): string {
  const d = new Date(date + "T00:00:00Z");
  const s = schedule.toLowerCase();
  if (s === "weekly") d.setUTCDate(d.getUTCDate() + 7 * n);
  else if (s === "biweekly") d.setUTCDate(d.getUTCDate() + 14 * n);
  else if (s === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3 * n);
  else if (s === "yearly" || s === "annually") d.setUTCFullYear(d.getUTCFullYear() + n);
  else d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

export interface PaymentPosition {
  /** Premium periods due and unpaid as of today (0 when paid up). */
  periodsOwed: number;
  owed: string;
  /** Whole premium periods paid beyond the one running today. */
  periodsAhead: number;
  ahead: string;
}

/**
 * From the paid-up-to date (the end of the last period paid for): each new period starts the day
 * after the previous ends, and is owed once it has started. Unknown paid-up-to → nothing computed.
 */
export function paymentPosition(paidUpTo: string | null | undefined, today: string, premium: string | number | null, schedule: string | null | undefined): PaymentPosition {
  const none: PaymentPosition = { periodsOwed: 0, owed: "0.00", periodsAhead: 0, ahead: "0.00" };
  const premiumC = toCents(premium ?? 0);
  if (!paidUpTo || premiumC <= 0) return none;
  const sched = schedule || "monthly";
  const paid = paidUpTo.slice(0, 10);
  const nextStart = (n: number) => {
    // start of the n-th unpaid period (n = 0 is the first one after paidUpTo)
    const d = new Date(paid + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + 1);
    return addPeriods(d.toISOString().slice(0, 10), n, sched);
  };
  if (paid < today) {
    let owed = 0;
    while (owed < 120 && nextStart(owed) <= today) owed++;
    return { ...none, periodsOwed: owed, owed: fromCents(owed * premiumC) };
  }
  // Paid up beyond today: count whole periods after the one that contains today.
  let ahead = 0;
  // The period ending on paidUpTo began one period before nextStart(0); walk back while starts are after today.
  for (let back = 1; back <= 120; back++) {
    const start = addPeriods(nextStart(0), -back, sched);
    if (start > today) ahead++;
    else break;
  }
  return { ...none, periodsAhead: ahead, ahead: fromCents(ahead * premiumC) };
}
