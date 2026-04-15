/**
 * Side-effect handlers invoked by `server/outbox.ts` after durable outbox enqueue.
 * Handlers must be idempotent: the same outbox row may be retried after partial failure.
 */

import { storage } from "./storage";
import { structuredLog } from "./logger";
import { recordAgentCommission } from "./route-helpers";
import { dispatchNotification, buildPolicyContext } from "./notifications";
import type { OutboxMessage } from "@shared/schema";
import {
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP,
} from "./outbox-constants";

type StaffPayload = { transactionId: string; receiptId: string | null };
type CashPayload = { transactionId: string; receiptId: string };
type PaynowPayload = {
  intentId: string;
  transactionId: string;
  receiptId: string;
  actorType: string;
  actorId: string | null;
};

export async function handleOutboxMessage(orgId: string, row: OutboxMessage): Promise<void> {
  switch (row.type) {
    case OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP:
      await runPaymentStaffFollowup(orgId, row.payloadJson as StaffPayload);
      return;
    case OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP:
      await runCashReceiptFollowup(orgId, row.payloadJson as CashPayload);
      return;
    case OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP:
      await runPaynowApplyFollowup(orgId, row.payloadJson as PaynowPayload);
      return;
    default:
      structuredLog("warn", "Unknown outbox message type", { orgId, type: row.type, id: row.id });
  }
}

async function runPaymentStaffFollowup(orgId: string, payload: StaffPayload): Promise<void> {
  const txSnapshot = await storage.getPaymentTransaction(payload.transactionId, orgId);
  if (!txSnapshot) return;

  let receiptSnapshot: Awaited<ReturnType<typeof storage.getPaymentReceiptById>> | null = null;
  if (payload.receiptId) {
    receiptSnapshot = await storage.getPaymentReceiptById(payload.receiptId, orgId);
  }

  if (receiptSnapshot && !receiptSnapshot.pdfStorageKey) {
    const { generateReceiptPdf } = await import("./receipt-pdf");
    const pdfPath = await generateReceiptPdf(receiptSnapshot.id);
    if (pdfPath) await storage.updatePaymentReceipt(receiptSnapshot.id, { pdfStorageKey: pdfPath }, orgId);
  }

  if (txSnapshot.status === "cleared") {
    const hasPr = await storage.hasPlatformReceivableForTransaction(orgId, txSnapshot.id);
    if (!hasPr) {
      const chibAmount = (parseFloat(String(txSnapshot.amount)) * 0.025).toFixed(2);
      await storage.createPlatformReceivable({
        organizationId: orgId,
        sourceTransactionId: txSnapshot.id,
        amount: chibAmount,
        currency: txSnapshot.currency,
        description: `2.5% on payment ${txSnapshot.id}`,
        isSettled: false,
      });
    }
    if (txSnapshot.policyId) {
      const hasComm = await storage.hasCommissionLedgerForTransaction(orgId, txSnapshot.id);
      if (!hasComm) {
        const commPolicy = await storage.getPolicy(txSnapshot.policyId, orgId);
        if (commPolicy) await recordAgentCommission(orgId, commPolicy, txSnapshot.id, String(txSnapshot.amount));
      }
    }
  }

  if (txSnapshot.status === "cleared" && txSnapshot.clientId && txSnapshot.policyId) {
    const policySnap = await storage.getPolicy(txSnapshot.policyId, orgId);
    if (policySnap) {
      const payCtx = await buildPolicyContext(policySnap, orgId, {
        paymentAmount: `${txSnapshot.currency} ${parseFloat(String(txSnapshot.amount)).toFixed(2)}`,
        paymentDate: new Date().toLocaleDateString("en-GB"),
        paymentMethod: txSnapshot.paymentMethod || "Cash",
      });
      await dispatchNotification(orgId, "payment_received", txSnapshot.clientId, payCtx);
    }
  }
}

async function runCashReceiptFollowup(orgId: string, payload: CashPayload): Promise<void> {
  const receipt = await storage.getPaymentReceiptById(payload.receiptId, orgId);
  const txRow = await storage.getPaymentTransaction(payload.transactionId, orgId);
  if (!receipt || !txRow) return;

  if (!receipt.pdfStorageKey) {
    const { generateReceiptPdf } = await import("./receipt-pdf");
    const pdfPath = await generateReceiptPdf(receipt.id);
    if (pdfPath) await storage.updatePaymentReceipt(receipt.id, { pdfStorageKey: pdfPath }, orgId);
  }

  const hasPr = await storage.hasPlatformReceivableForTransaction(orgId, txRow.id);
  if (!hasPr) {
    const chibAmount = (parseFloat(String(txRow.amount)) * 0.025).toFixed(2);
    await storage.createPlatformReceivable({
      organizationId: orgId,
      sourceTransactionId: txRow.id,
      amount: chibAmount,
      currency: txRow.currency,
      description: `2.5% on cash payment ${txRow.id}`,
      isSettled: false,
    });
  }

  const policy = txRow.policyId ? await storage.getPolicy(txRow.policyId, orgId) : undefined;
  if (policy) {
    const hasComm = await storage.hasCommissionLedgerForTransaction(orgId, txRow.id);
    if (!hasComm) await recordAgentCommission(orgId, policy, txRow.id, String(txRow.amount));

    if (policy.clientId) {
      const ctx = await buildPolicyContext(policy, orgId, {
        paymentAmount: `${txRow.currency} ${parseFloat(String(txRow.amount)).toFixed(2)}`,
        paymentDate: new Date().toLocaleDateString("en-GB"),
        paymentMethod: "Cash",
      });
      await dispatchNotification(orgId, "payment_receipt", policy.clientId, ctx);
    }
  }
}

async function runPaynowApplyFollowup(orgId: string, payload: PaynowPayload): Promise<void> {
  const intent = await storage.getPaymentIntentById(payload.intentId, orgId);
  const receipt = await storage.getPaymentReceiptById(payload.receiptId, orgId);
  const transaction = await storage.getPaymentTransaction(payload.transactionId, orgId);
  if (!intent || !receipt || !transaction) return;

  let events = await storage.getPaymentEventsByIntentId(intent.id, orgId);
  if (!events.some((e) => e.type === "marked_paid")) {
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: orgId,
      type: "marked_paid",
      payloadJson: { transactionId: transaction.id, receiptId: receipt.id },
      actorType: payload.actorType as "client" | "admin" | "system",
      actorId: payload.actorId ?? undefined,
    });
    events = await storage.getPaymentEventsByIntentId(intent.id, orgId);
  }

  const receiptFresh = await storage.getPaymentReceiptById(payload.receiptId, orgId);
  if (receiptFresh && !receiptFresh.pdfStorageKey) {
    const { generateReceiptPdf } = await import("./receipt-pdf");
    const pdfPath = await generateReceiptPdf(receiptFresh.id);
    if (pdfPath) await storage.updatePaymentReceipt(receiptFresh.id, { pdfStorageKey: pdfPath }, orgId);
  }

  events = await storage.getPaymentEventsByIntentId(intent.id, orgId);
  if (!events.some((e) => e.type === "receipt_issued")) {
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "receipt_issued",
      payloadJson: { receiptId: payload.receiptId },
      actorType: payload.actorType as "client" | "admin" | "system",
      actorId: payload.actorId ?? undefined,
    });
  }

  const receiptForNotify = (await storage.getPaymentReceiptById(payload.receiptId, orgId)) ?? receiptFresh ?? receipt;
  const policy = transaction.policyId ? await storage.getPolicy(transaction.policyId, orgId) : undefined;
  if (policy && intent.clientId) {
    await storage.createNotificationLog(orgId, {
      recipientType: "client",
      recipientId: intent.clientId,
      channel: "in_app",
      subject: "Payment received",
      body: `Payment of ${intent.currency} ${intent.amount} received for policy ${policy.policyNumber}. Receipt #${receiptForNotify.receiptNumber}.`,
      status: "sent",
    });
  }

  if (policy?.agentId) {
    const hasComm = await storage.hasCommissionLedgerForTransaction(orgId, transaction.id);
    if (!hasComm) {
      try {
        const plans = await storage.getCommissionPlans(orgId);
        const activePlan = plans.find((p) => p.isActive);
        if (activePlan) {
          const existingPayments = await storage.getPaymentsByPolicy(policy.id!, orgId);
          const clearedCount = existingPayments.filter((p: { status?: string }) => p.status === "cleared").length;
          const firstMonths = Number(activePlan.firstMonthsCount) || 2;
          const firstRate = Number(activePlan.firstMonthsRate) || 50;
          const recurringRate = Number(activePlan.recurringRate) || 10;
          let rate = 0;
          let entryType = "recurring";
          if (clearedCount <= firstMonths) {
            rate = firstRate;
            entryType = "first_months";
          } else {
            rate = recurringRate;
            entryType = "recurring";
          }
          if (rate > 0) {
            const commAmount = (parseFloat(String(intent.amount)) * rate / 100).toFixed(2);
            await storage.createCommissionLedgerEntry({
              organizationId: orgId,
              agentId: policy.agentId,
              policyId: policy.id!,
              transactionId: transaction.id,
              entryType,
              amount: commAmount,
              currency: intent.currency || "USD",
              description: `${rate}% commission on Paynow payment (${entryType === "first_months" ? "initial" : "recurring"})`,
              status: "earned",
            });
          }
        }
      } catch (err) {
        structuredLog("error", "Commission calculation failed (Paynow outbox)", { error: (err as Error).message });
      }
    }
  }
}
