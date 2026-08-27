/**
 * Policy balance / arrears enrichment — the single source of truth for "what does this policy
 * owe / is it paid ahead".
 *
 * Extracted verbatim from the inline `enrichWithBalance` that used to live in
 * server/client-auth.ts's `GET /api/client-auth/policies` handler, so the client portal and the
 * customer-service API (server/customer-service-routes.ts) compute balances with ONE
 * implementation and can never drift apart. tests/unit/policy-balance.test.ts pins the output to
 * the pre-extraction behaviour byte-for-byte.
 *
 * Logic (unchanged):
 *   totalPaid  = Σ cleared payment_transactions.amount
 *   totalDue   = periodsElapsed × premium   (calendar-month aware; see server/security-fixes test 17)
 *   wallet     = signed policy_credit_balances.balance  (+ = credit, − = arrears)
 *   balance    = totalPaid + wallet − totalDue
 *   outstanding = max(0, −balance)
 */
import { differenceInCalendarMonths } from "date-fns";
import { storage } from "./storage";

export interface EnrichedPolicyBalance {
  totalPaid: string;
  totalDue: string;
  balance: string;
  outstanding: string;
  walletBalance: string;
  periodsElapsed: number;
}

/**
 * Enrich a list of policies with balance fields. Each returned object is the original policy
 * spread with the six balance fields added — identical shape to the old client-auth inline
 * function. `policies` is `any[]` for the same reason it was before: callers pass raw Drizzle
 * rows and the function only reads a handful of fields off them.
 */
export async function enrichPoliciesWithBalance<T extends Record<string, any>>(
  policies: T[],
  orgId: string,
): Promise<(T & EnrichedPolicyBalance)[]> {
  const enriched: (T & EnrichedPolicyBalance)[] = [];
  for (const p of policies) {
    const payments = await storage.getPaymentsByPolicy(p.id, orgId);
    const totalPaid = payments
      .filter((tx: any) => tx.status === "cleared")
      .reduce((sum: number, tx: any) => sum + parseFloat(tx.amount || "0"), 0);
    const premium = parseFloat(p.premiumAmount || "0");
    const startDate = p.inceptionDate || p.effectiveDate;
    let totalDue = 0;
    let periodsElapsed = 0;
    if (startDate && premium > 0) {
      const start = new Date(startDate);
      const now = new Date();
      if (!isNaN(start.getTime()) && start <= now) {
        const schedule = p.paymentSchedule || "monthly";
        if (schedule === "monthly") {
          periodsElapsed = Math.max(0, differenceInCalendarMonths(now, start));
        } else if (schedule === "quarterly") {
          periodsElapsed = Math.max(0, Math.floor(differenceInCalendarMonths(now, start) / 3));
        } else if (schedule === "annually") {
          periodsElapsed = Math.max(0, Math.floor(differenceInCalendarMonths(now, start) / 12));
        } else {
          const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
          const periodDays = schedule === "weekly" ? 7 : 14;
          periodsElapsed = Math.max(0, Math.ceil(daysElapsed / periodDays));
        }
        totalDue = periodsElapsed * premium;
      }
    }
    // Fold in the signed credit-balance wallet (premium-change reconciliations + overpayments):
    // positive = credit/paid ahead, negative = arrears owed.
    const wallet = await storage.getPolicyCreditBalance(orgId, p.id);
    const walletBalance = parseFloat(String(wallet?.balance ?? "0")) || 0;
    const balance = totalPaid + walletBalance - totalDue;
    enriched.push({
      ...p,
      totalPaid: totalPaid.toFixed(2),
      totalDue: totalDue.toFixed(2),
      balance: balance.toFixed(2),
      outstanding: Math.max(0, -balance).toFixed(2),
      walletBalance: walletBalance.toFixed(2),
      periodsElapsed,
    });
  }
  return enriched;
}
