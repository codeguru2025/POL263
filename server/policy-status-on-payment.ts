/**
 * Policy status rules when a cleared payment is recorded.
 * Used by PayNow, manual receipts, cash, month-end, group receipt, credit-apply, etc.
 * Ensures policy moves: inactive → active (with inception/effective), grace → active, lapsed → active.
 */

import { eq, sql } from "drizzle-orm";
import { policies, policyStatusHistory } from "@shared/schema";
import type { Policy } from "@shared/schema";

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
    await db.update(policies).set({
      status: "active",
      graceEndDate: null,
      version: sql`version + 1`,
    }).where(eq(policies.id, policyId));
    await db.insert(policyStatusHistory).values({
      policyId,
      fromStatus: "lapsed",
      toStatus: "active",
      reason: `Reinstatement — payment received${reasonSuffix}`,
      changedBy: changedBy ?? undefined,
    });
    return true;
  }

  return false;
}

