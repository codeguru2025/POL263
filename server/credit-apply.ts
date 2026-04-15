/**
 * Auto-apply policy credit balance when next premium is due.
 * Finds policies with due date <= today and sufficient credit balance, then creates
 * payment transaction + receipt and deducts balance — all in a single atomic transaction.
 */

import { storage } from "./storage";
import { structuredLog } from "./logger";
import { withOrgTransaction } from "./tenant-db";
import { applyPolicyStatusForClearedPayment } from "./policy-status-on-payment";
import { paymentTransactions, paymentReceipts, policyCreditBalances } from "@shared/schema";
import { sql, eq, and } from "drizzle-orm";

export async function runApplyCreditBalances(orgId: string): Promise<{ applied: number; errors: string[] }> {
  const rows = await storage.getPolicyCreditBalancesWithPositiveBalance(orgId);
  const today = new Date().toISOString().split("T")[0];
  const errors: string[] = [];
  let applied = 0;

  for (const row of rows) {
    const policy = await storage.getPolicy(row.policyId, orgId);
    if (!policy) continue;
    const premium = parseFloat(String(policy.premiumAmount || 0));
    const balance = parseFloat(String(row.balance));
    if (premium <= 0 || balance < premium) continue;

    const dueDate = policy.currentCycleEnd ? String(policy.currentCycleEnd) : null;
    const isDue = dueDate && dueDate <= today;
    const isPendingOrGrace = policy.status === "inactive" || policy.status === "grace" || policy.status === "lapsed";
    if (!isDue && !isPendingOrGrace) continue;

    try {
      const result = await applyCreditBalanceToPolicy(orgId, row.policyId);
      if (result.ok) applied++;
      else if (result.error) errors.push(result.error);
    } catch (e) {
      errors.push(`${row.policyId}: ${(e as Error).message}`);
    }
  }

  return { applied, errors };
}

export async function applyCreditBalanceToPolicy(
  orgId: string,
  policyId: string
): Promise<{ ok: boolean; error?: string }> {
  const policy = await storage.getPolicy(policyId, orgId);
  if (!policy) return { ok: false, error: "Policy not found" };

  const premium = parseFloat(String(policy.premiumAmount || 0));
  if (premium <= 0) return { ok: false, error: "Policy has no premium" };

  const currency = policy.currency || "USD";
  const amount = premium.toFixed(2);
  const today = new Date().toISOString().split("T")[0];

  let receiptNumberForNotify: string | undefined;

  try {
    receiptNumberForNotify = await withOrgTransaction(orgId, async (txDb) => {
      // Atomically deduct credit balance; fails if balance is insufficient
      const deductResult = await txDb.execute(sql`
        UPDATE policy_credit_balances
        SET balance = balance - ${amount}::numeric, updated_at = now()
        WHERE organization_id = ${orgId}
          AND policy_id = ${policyId}
          AND balance >= ${amount}::numeric
        RETURNING id
      `);
      const deductedRows = (deductResult as unknown as { rows?: { id: string }[] }).rows;
      if (!deductedRows || deductedRows.length === 0) {
        throw new Error("Insufficient credit balance");
      }

      const receiptNumber = await storage.allocatePaymentReceiptNumberInTx(txDb, orgId);

      // Create payment transaction
      const [tx] = await txDb.insert(paymentTransactions).values({
        organizationId: orgId,
        policyId,
        clientId: policy.clientId!,
        amount,
        currency,
        paymentMethod: "credit_balance",
        status: "cleared",
        reference: `CREDIT-${policyId.slice(0, 8)}-${Date.now()}`,
        idempotencyKey: `credit-apply-${policyId}-${today}`,
        receivedAt: new Date(),
        postedDate: today,
        valueDate: today,
        notes: "Auto-applied from policy credit balance",
      }).returning();

      // Create receipt
      await txDb.insert(paymentReceipts).values({
        organizationId: orgId,
        branchId: policy.branchId ?? undefined,
        receiptNumber,
        policyId,
        clientId: policy.clientId!,
        amount,
        currency,
        paymentChannel: "credit_balance",
        status: "issued",
        metadataJson: { transactionId: tx.id, source: "credit_balance_auto_apply" },
      });

      // Update policy status within the same transaction
      await applyPolicyStatusForClearedPayment(txDb, policyId, policy, today, " (credit balance)", undefined);
      return receiptNumber;
    });
  } catch (err: any) {
    if (err?.message === "Insufficient credit balance") {
      return { ok: false, error: "Insufficient credit balance" };
    }
    structuredLog("error", "applyCreditBalanceToPolicy failed", { policyId, error: err?.message });
    return { ok: false, error: err?.message || "Failed to apply credit balance" };
  }

  // Post-transaction best-effort side effects
  if (policy.status === "lapsed" && policy.agentId) {
    try {
      const entries = await storage.getCommissionEntriesByPolicy(policyId, orgId);
      const clawbacks = entries.filter((e: any) => e.entryType === "clawback" && e.status === "earned");
      const existingRollbacks = entries.filter((e: any) => e.entryType === "rollback");
      const clawbackTotal = clawbacks.reduce((sum: number, e: any) => sum + parseFloat(e.amount || "0"), 0);
      const rollbackTotal = existingRollbacks.reduce((sum: number, e: any) => sum + parseFloat(e.amount || "0"), 0);
      const unreversed = clawbackTotal + rollbackTotal;
      if (unreversed < 0) {
        await storage.createCommissionLedgerEntry({
          organizationId: orgId,
          agentId: policy.agentId,
          policyId,
          entryType: "rollback",
          amount: Math.abs(unreversed).toFixed(2),
          currency: policy.currency || "USD",
          description: `Rollback — policy reinstated, clawback reversed`,
          status: "earned",
        });
      }
    } catch (err) {
      structuredLog("error", "Rollback recording failed", { error: (err as Error).message, policyId });
    }
  }

  await storage.createNotificationLog(orgId, {
    recipientType: "client",
    recipientId: policy.clientId!,
    channel: "in_app",
    subject: "Premium paid from credit balance",
    body: `Premium of ${currency} ${amount} for policy ${policy.policyNumber} was applied from your credit balance. Receipt #${receiptNumberForNotify ?? "—"}.`,
    status: "sent",
  });

  return { ok: true };
}
