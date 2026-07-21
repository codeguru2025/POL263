/**
 * Policy status rules when a cleared payment is recorded.
 * Used by PayNow, manual receipts, cash, month-end, group receipt, credit-apply, etc.
 * Ensures policy moves: inactive → active (with inception/effective), grace → active, lapsed → active.
 */

import { eq, sql } from "drizzle-orm";
import { policies, policyStatusHistory, productVersions } from "@shared/schema";
import type { Policy } from "@shared/schema";

// ─── Cycle helpers ───────────────────────────────────────────

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

/** Signed days: positive = b is after a */
function daysBetween(aStr: string, bStr: string): number {
  return Math.round(
    (new Date(bStr + "T00:00:00").getTime() - new Date(aStr + "T00:00:00").getTime()) / 86400000
  );
}

function cycleDays(schedule: string): number {
  if (schedule === "weekly") return 7;
  if (schedule === "biweekly") return 14;
  if (schedule === "yearly") return 365;
  return 30; // monthly
}

/**
 * Compute and persist the new cover cycle for a policy after a cleared payment.
 *
 * Rules:
 *  - Period always anchors to the due date (currentCycleEnd + 1), not the actual payment date.
 *  - First payment has no prior cycle — period starts from the payment date.
 *  - Late payment: grace days used accumulate. Early/on-time: grace resets to 0 used.
 *  - graceEndDate = nextDueDate + remaining grace days.
 *
 * Call this inside the same DB transaction as the payment insert, BEFORE inserting
 * the transaction row so the returned period can be stamped on it.
 */
export async function advancePolicyCycle(
  db: { select(fields?: any): any; update(table: any): any },
  policyId: string,
  policy: Policy | null,
  postedDate: string,
): Promise<{ periodFrom: string; periodTo: string }> {
  if (!policy) return { periodFrom: postedDate, periodTo: postedDate };

  // Fetch grace period from the product version
  let gracePeriodDays = 30;
  if (policy.productVersionId) {
    const [pv] = await (db as any).select({ gracePeriodDays: productVersions.gracePeriodDays })
      .from(productVersions)
      .where(eq(productVersions.id, policy.productVersionId))
      .limit(1);
    if (pv?.gracePeriodDays != null) gracePeriodDays = Number(pv.gracePeriodDays);
  }

  const schedule = policy.paymentSchedule ?? "monthly";
  const currentCycleEnd = policy.currentCycleEnd ? String(policy.currentCycleEnd) : null;
  const currentGraceUsed = (policy as any).graceUsedDays ?? 0;

  let periodFrom: string;
  let daysLate: number;

  if (!currentCycleEnd) {
    // First payment — no prior cycle, period starts from today
    periodFrom = postedDate;
    daysLate = 0;
  } else {
    // Due date = day after the last covered day
    const dueDate = addDays(currentCycleEnd, 1);
    daysLate = Math.max(0, daysBetween(dueDate, postedDate));
    periodFrom = dueDate; // always anchored to due date, even if paid late or early
  }

  const len = cycleDays(schedule);
  const periodTo = addDays(periodFrom, len - 1);   // last covered day
  const nextDueDate = addDays(periodFrom, len);     // when next payment is due

  const newGraceUsed = daysLate > 0
    ? Math.min(gracePeriodDays, currentGraceUsed + daysLate)
    : 0; // on-time or early → fully reset

  const remainingGrace = Math.max(0, gracePeriodDays - newGraceUsed);
  const newGraceEndDate = addDays(nextDueDate, remainingGrace);

  await (db as any).update(policies).set({
    currentCycleStart: periodFrom,
    currentCycleEnd: periodTo,
    graceEndDate: newGraceEndDate,
    graceUsedDays: newGraceUsed,
  }).where(eq(policies.id, policyId));

  return { periodFrom, periodTo };
}

/**
 * Update policy status and insert status history when a cleared payment is recorded.
 * Call this inside the same transaction that created the payment_transaction.
 * @param db - Drizzle db or transaction client (same connection as the payment insert)
 * @param policyId - policy id
 * @param policy - current policy row (status, effectiveDate, etc.)
 * @param today - date string YYYY-MM-DD for inception/effective
 * @param reasonSuffix - optional suffix for history reason (e.g. " (cash)", " (PayNow)")
 * @param changedBy - user id or undefined for system
 * @returns true if policy was updated, false if no change (e.g. already active)
 */
export async function applyPolicyStatusForClearedPayment(
  db: { update(table: any): any; insert(table: any): any },
  policyId: string,
  policy: Policy | null,
  today: string,
  reasonSuffix: string = "",
  changedBy?: string | null
): Promise<boolean> {
  if (!policy) return false;
  const fromStatus = policy.status ?? "inactive";
  if (fromStatus === "active") return false;

  if (fromStatus === "inactive") {
    await db.update(policies).set({
      status: "active",
      inceptionDate: today,
      ...(!policy.effectiveDate ? { effectiveDate: today } : {}),
      version: sql`version + 1`,
    }).where(eq(policies.id, policyId));
    await db.insert(policyStatusHistory).values({
      policyId,
      fromStatus: "inactive",
      toStatus: "active",
      reason: `First premium paid — conversion${reasonSuffix}`,
      changedBy: changedBy ?? undefined,
    });
    return true;
  }

  if (fromStatus === "grace") {
    await db.update(policies).set({
      status: "active",
      graceEndDate: null,
      version: sql`version + 1`,
    }).where(eq(policies.id, policyId));
    await db.insert(policyStatusHistory).values({
      policyId,
      fromStatus: "grace",
      toStatus: "active",
      reason: `Payment received${reasonSuffix}`,
      changedBy: changedBy ?? undefined,
    });
    return true;
  }

  if (fromStatus === "lapsed") {
    // "Restart waiting period on reinstatement" — configurable per product version, defaults to
    // true (the anti-selection-safe default: someone who let a policy lapse and only pays again
    // right before a claim shouldn't get instant cover back). This was a schema column with a
    // full admin UI in both product forms and ZERO server code reading it — reinstatement always
    // silently kept the policy's original, already-expired waiting period regardless of the
    // setting. Wiring it up here: a fresh waiting period, anchored to today's reinstatement date,
    // stored as an explicit override (the same mechanism waiver approval and manual staff edits
    // already use — see resolvePolicyWaitingPeriodEndDate in route-helpers.ts for why this has
    // to be an explicit stored value rather than left to be re-derived from the ORIGINAL
    // inception date, which would just reproduce the already-expired one).
    let newWaitingPeriodEndDate: string | null = null;
    if (!policy.isLegacy && policy.productVersionId) {
      const [pv] = await (db as any).select({
        waitingPeriodDays: productVersions.waitingPeriodDays,
        reinstatementNewWaitingPeriod: productVersions.reinstatementNewWaitingPeriod,
      }).from(productVersions).where(eq(productVersions.id, policy.productVersionId)).limit(1);
      if (pv && pv.reinstatementNewWaitingPeriod !== false) {
        const waitingPeriodDays = pv.waitingPeriodDays ?? 90;
        const d = new Date(today + "T00:00:00");
        d.setDate(d.getDate() + waitingPeriodDays);
        newWaitingPeriodEndDate = d.toISOString().split("T")[0];
      }
    }

    await db.update(policies).set({
      status: "active",
      graceEndDate: null,
      ...(newWaitingPeriodEndDate ? { waitingPeriodEndDate: newWaitingPeriodEndDate } : {}),
      version: sql`version + 1`,
    }).where(eq(policies.id, policyId));
    await db.insert(policyStatusHistory).values({
      policyId,
      fromStatus: "lapsed",
      toStatus: "active",
      reason: newWaitingPeriodEndDate
        ? `Reinstatement — payment received${reasonSuffix} (new waiting period until ${newWaitingPeriodEndDate})`
        : `Reinstatement — payment received${reasonSuffix}`,
      changedBy: changedBy ?? undefined,
    });
    return true;
  }

  return false;
}

