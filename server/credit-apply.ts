/**
 * Auto-apply policy credit balance when next premium is due.
 * Finds policies with due date <= today and sufficient credit balance, then creates
 * payment transaction + receipt and deducts balance.
 */

import { storage } from "./storage";
import { structuredLog } from "./logger";
import type { InsertPaymentTransaction, InsertPaymentReceipt } from "@shared/schema";

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

  const creditRow = await storage.getPolicyCreditBalance(orgId, policyId);
  if (!creditRow) return { ok: false, error: "No credit balance" };

  const premium = parseFloat(String(policy.premiumAmount || 0));
  const balance = parseFloat(String(creditRow.balance));
  if (premium <= 0 || balance < premium) {
    return { ok: false, error: "Insufficient credit balance" };
  }

  const currency = creditRow.currency || policy.currency || "USD";
  const amount = premium.toFixed(2);
  const today = new Date().toISOString().split("T")[0];

  await storage.deductPolicyCreditBalance(orgId, policyId, amount);

  const txData: InsertPaymentTransaction = {
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
  };
  const tx = await storage.createPaymentTransaction(txData);

  const receiptNumber = await storage.getNextPaymentReceiptNumber(orgId);
  const receiptData: InsertPaymentReceipt = {
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
  };
  await storage.createPaymentReceipt(receiptData);

  if (policy.status === "inactive") {
    await storage.updatePolicy(policyId, { status: "active", inceptionDate: today, effectiveDate: policy.effectiveDate || today }, orgId);
    await storage.createPolicyStatusHistory(policyId, "inactive", "active", "First premium paid — conversion (credit balance)", undefined);
  } else if (policy.status === "grace") {
    await storage.updatePolicy(policyId, { status: "active", graceEndDate: null }, orgId);
    await storage.createPolicyStatusHistory(policyId, "grace", "active", "Premium paid from credit balance", undefined);
  } else if (policy.status === "lapsed") {
    await storage.updatePolicy(policyId, { status: "active", graceEndDate: null }, orgId);
    await storage.createPolicyStatusHistory(policyId, "lapsed", "active", "Reinstatement — premium paid from credit balance", undefined);
    if (policy.agentId) {
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
  }

  await storage.createNotificationLog(orgId, {
    recipientType: "client",
    recipientId: policy.clientId!,
    channel: "in_app",
    subject: "Premium paid from credit balance",
    body: `Premium of ${currency} ${amount} for policy ${policy.policyNumber} was applied from your credit balance. Receipt #${receiptNumber}.`,
    status: "sent",
  });

  return { ok: true };
}
