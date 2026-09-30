/**
 * Side-effect handlers invoked by `server/outbox.ts` after durable outbox enqueue.
 * Handlers must be idempotent: the same outbox row may be retried after partial failure.
 */

import { storage } from "./storage";
import { structuredLog } from "./logger";
import { computePlatformFee } from "./platform-fee";
import { recordAgentCommission } from "./route-helpers";
import { notifyUser } from "./user-notifications";
import { pushToClient } from "./push";
import { dispatchNotification, buildPolicyContext, receiptEventFor } from "./notifications";
import { hasModule } from "./module-gate";
import type { OutboxMessage } from "@shared/schema";
import {
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP,
  OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_LEDGER_GROUP_RECEIPT_FOLLOWUP,
} from "./outbox-constants";
import { runLedgerGroupReceiptFollowup, type LedgerGroupReceiptPayload } from "./ledger-group-receipt";

type StaffPayload = { transactionId: string; receiptId: string | null };
type CashPayload = { transactionId: string; receiptId: string };
type ServiceReceiptPayload = { serviceReceiptId: string; amount: string; currency: string; receiptNumber: string };
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
    case OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP:
      await runServiceReceiptFollowup(orgId, row.payloadJson as ServiceReceiptPayload);
      return;
    case OUTBOX_TYPE_LEDGER_GROUP_RECEIPT_FOLLOWUP:
      await runLedgerGroupReceiptFollowup(orgId, row.payloadJson as LedgerGroupReceiptPayload);
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
      const feeAmount = await computePlatformFee(orgId, txSnapshot.amount);
      await storage.createPlatformReceivable({
        organizationId: orgId,
        sourceTransactionId: txSnapshot.id,
        amount: feeAmount,
        currency: txSnapshot.currency,
        description: `Platform fee on payment ${txSnapshot.id}`,
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
      const amtLabel = `${txSnapshot.currency} ${parseFloat(String(txSnapshot.amount)).toFixed(2)}`;
      const payCtx = await buildPolicyContext(policySnap, orgId, {
        paymentAmount: amtLabel,
        paymentDate: new Date().toLocaleDateString("en-GB"),
        paymentMethod: txSnapshot.paymentMethod || "Cash",
        receiptId: payload.receiptId ?? undefined,
      });
      // A payment that was receipted is a "payment_receipt" event — the one tenants keep switched
      // on for SMS. Sending "payment_received" here meant the main receipt screen never texted
      // anyone once a tenant turned that one off to save credits (Falakhe: 0 receipt SMS).
      await dispatchNotification(orgId, payload.receiptId ? await receiptEventFor(orgId) : "payment_received", txSnapshot.clientId, payCtx);
      // Push to client device
      pushToClient(orgId, txSnapshot.clientId, {
        title: "Payment Received",
        body: `Your payment of ${amtLabel} for policy ${policySnap.policyNumber} has been confirmed.`,
        data: { type: "PAYMENT_RECEIVED", policyId: policySnap.id },
      }).catch(() => {});
      // Notify agent that their client paid
      if (policySnap.agentId) {
        const client = await storage.getClient(txSnapshot.clientId, orgId);
        const clientName = client ? `${client.firstName} ${client.lastName}` : "A client";
        notifyUser(orgId, policySnap.agentId, {
          type: "PAYMENT_RECEIVED",
          title: "Client Payment Received",
          body: `${clientName} paid ${amtLabel} for policy ${policySnap.policyNumber}.`,
          metadata: { policyId: policySnap.id, policyNumber: policySnap.policyNumber, clientId: txSnapshot.clientId, amount: amtLabel },
        }).catch(() => {});
      }
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
    const feeAmount = await computePlatformFee(orgId, txRow.amount);
    await storage.createPlatformReceivable({
      organizationId: orgId,
      sourceTransactionId: txRow.id,
      amount: feeAmount,
      currency: txRow.currency,
      description: `Platform fee on cash payment ${txRow.id}`,
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
        receiptId: receipt.id,
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

  const hasPr = await storage.hasPlatformReceivableForTransaction(orgId, transaction.id);
  if (!hasPr) {
    const feeAmount = await computePlatformFee(orgId, transaction.amount);
    await storage.createPlatformReceivable({
      organizationId: orgId,
      sourceTransactionId: transaction.id,
      amount: feeAmount,
      currency: transaction.currency,
      description: `Platform fee on Paynow payment ${transaction.id}`,
      isSettled: false,
    });
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
    const ctx = await buildPolicyContext(policy, orgId, {
      paymentAmount: `${intent.currency} ${parseFloat(String(intent.amount)).toFixed(2)}`,
      paymentDate: new Date().toLocaleDateString("en-GB"),
      paymentMethod: "PayNow",
      receiptId: receiptForNotify.id,
    });
    await dispatchNotification(orgId, "payment_receipt", intent.clientId, ctx);

    // Separate from the templated notification above (which may or may not include email
    // depending on the org's configured channels) — this always emails the receipt + policy
    // document PDFs together when the client has an email on file, since a self-registered
    // client (see server/routes.ts handlePublicPolicyRegistration) may have no other way to
    // receive their policy document at all before claiming their portal account. Best-effort:
    // never fails the outbox message (which also drives commission/platform-fee bookkeeping
    // below) if the email itself fails.
    try {
      const clientForEmail = await storage.getClient(intent.clientId, orgId);
      if (clientForEmail?.email && await hasModule(orgId, "email_notifications")) {
        const org = await storage.getOrganization(orgId);
        const orgName = org?.name || "POL263";
        const { buildReceiptPdfBuffer } = await import("./receipt-pdf");
        const { buildPolicyApplicationPdfBuffer } = await import("./policy-client-forms");
        const [receiptPdf, policyPdf] = await Promise.all([
          buildReceiptPdfBuffer(receiptForNotify.id),
          buildPolicyApplicationPdfBuffer(policy.id, orgId),
        ]);
        const attachments = [receiptPdf, policyPdf]
          .filter((a): a is NonNullable<typeof a> => !!a)
          .map((a) => ({ filename: a.filename, content: a.buffer, contentType: "application/pdf" }));
        if (attachments.length > 0) {
          const { sendEmail, escapeHtml } = await import("./email-service");
          const { resolveTenantEmailOverrides } = await import("./tenant-email-sending");
          await sendEmail({
            to: clientForEmail.email,
            ...(await resolveTenantEmailOverrides(orgId, org)),
            fromName: orgName,
            subject: `Payment Received — ${policy.policyNumber}`,
            text: `Dear ${clientForEmail.firstName},\n\nThank you for your payment. Your receipt and policy document are attached.\n\n— ${orgName}`,
            html: `<p>Dear ${escapeHtml(clientForEmail.firstName)},</p><p>Thank you for your payment. Your receipt and policy document are attached.</p><p>— ${escapeHtml(orgName)}</p>`,
            attachments,
          });
        }
      }
    } catch (err: any) {
      structuredLog("error", "Payment receipt/policy-document email failed", { error: err?.message, policyId: policy.id, orgId });
    }
  }

  // Same calculation as every other payment path. This used to compute its own commission from
  // the org plan only, so on orgs with no plan (rates set per product) PayNow payments earned nothing.
  if (policy?.agentId) await recordAgentCommission(orgId, policy, transaction.id, String(transaction.amount));
}

async function runServiceReceiptFollowup(orgId: string, payload: ServiceReceiptPayload): Promise<void> {
  const hasPr = await storage.hasPlatformReceivableForServiceReceipt(orgId, payload.serviceReceiptId);
  if (!hasPr) {
    const feeAmount = await computePlatformFee(orgId, payload.amount);
    await storage.createPlatformReceivable({
      organizationId: orgId,
      sourceServiceReceiptId: payload.serviceReceiptId,
      amount: feeAmount,
      currency: payload.currency,
      description: `Platform fee on service receipt ${payload.receiptNumber} (${payload.serviceReceiptId})`,
      isSettled: false,
    });
  }
}
