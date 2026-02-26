/**
 * Payment service: Paynow initiation, result handling, polling, and policy application.
 * All Paynow secrets stay server-side. Hash verification is mandatory on result/poll.
 */

import { storage } from "./storage";
import { getPaynowConfig, getPaynowIntegrationId } from "./paynow-config";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import type { PaymentIntent, InsertPaymentIntent, InsertPaymentEvent, InsertPaymentReceipt } from "@shared/schema";
import type { Policy } from "@shared/schema";
import { structuredLog } from "./logger";

const PAYNOW_INIT_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const PAYNOW_REMOTE_URL = "https://www.paynow.co.zw/interface/remotetransaction";

const PAYABLE_STATUSES = ["active", "grace", "reinstatement_pending"] as const;
const REINSTATEMENT_PURPOSE = "reinstatement";

export interface CreateIntentInput {
  organizationId: string;
  clientId: string;
  policyId: string;
  amount: string;
  currency?: string;
  purpose?: string;
  idempotencyKey: string;
}

export interface InitiatePaynowInput {
  intentId: string;
  method: string; // ecocash | onemoney | innbucks | omari | visa_mastercard
  payerPhone?: string;
  payerEmail?: string;
  actorType: "client" | "admin" | "system";
  actorId?: string | null;
}

function generateMerchantReference(orgCode: string, policyNumber: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `${orgCode}-POL${policyNumber}-${date}-${time}-${rand}`.slice(0, 255);
}

/** Validate policy is payable for the given purpose. */
function validatePolicyPayable(policy: Policy, purpose: string): { ok: boolean; message?: string } {
  if (!policy) return { ok: false, message: "Policy not found" };
  if (!PAYABLE_STATUSES.includes(policy.status as any)) {
    if (purpose === REINSTATEMENT_PURPOSE && policy.status === "lapsed") {
      return { ok: true };
    }
    return { ok: false, message: `Policy status "${policy.status}" is not payable` };
  }
  return { ok: true };
}

/** Create or return existing payment intent (idempotent). */
export async function createPaymentIntent(input: CreateIntentInput): Promise<{
  intent: PaymentIntent;
  created: boolean;
  error?: string;
}> {
  const { organizationId, clientId, policyId, amount, idempotencyKey } = input;
  const currency = input.currency ?? "USD";
  const purpose = input.purpose ?? "premium";

  const existing = await storage.getPaymentIntentByOrgAndIdempotencyKey(organizationId, idempotencyKey);
  if (existing) {
    return { intent: existing, created: false };
  }

  const policy = await storage.getPolicy(policyId);
  const validation = validatePolicyPayable(policy!, purpose);
  if (!validation.ok) {
    return { intent: null as any, created: false, error: validation.message };
  }

  const org = await storage.getOrganization(organizationId);
  const orgCode = (org?.name ?? "ORG").replace(/\s+/g, "").slice(0, 8).toUpperCase();
  const merchantReference = generateMerchantReference(orgCode, policy!.policyNumber);

  const intentData: InsertPaymentIntent = {
    organizationId,
    clientId,
    policyId,
    currency,
    amount,
    purpose,
    status: "created",
    idempotencyKey,
    merchantReference,
    methodSelected: "unknown",
  };
  const intent = await storage.createPaymentIntent(intentData);
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId,
    type: "initiated",
    payloadJson: { amount, currency, purpose },
    actorType: "system",
    actorId: null,
  });
  return { intent, created: true };
}

/** Build form body for Paynow init (standard redirect). */
function buildInitParams(merchantReference: string, amount: string, returnUrl: string, resultUrl: string): Record<string, string> {
  const id = getPaynowIntegrationId();
  const params: Record<string, string> = {
    id,
    reference: merchantReference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    status: "Message",
  };
  params.hash = generatePaynowHash(params);
  return params;
}

/** Build form body for Paynow remote (mobile). */
function buildRemoteParams(
  merchantReference: string,
  amount: string,
  returnUrl: string,
  resultUrl: string,
  method: string,
  phone: string
): Record<string, string> {
  const id = getPaynowIntegrationId();
  const methodMap: Record<string, string> = {
    ecocash: "ecocash",
    onemoney: "onemoney",
  };
  const paynowMethod = methodMap[method.toLowerCase()] || "ecocash";
  const params: Record<string, string> = {
    id,
    reference: merchantReference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    status: "Message",
    method: paynowMethod,
    phone: phone.replace(/\D/g, "").trim(),
  };
  params.hash = generatePaynowHash(params);
  return params;
}

function toFormUrlEncoded(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Initiate Paynow payment; persist poll/redirect URLs and emit events. */
export async function initiatePaynowPayment(input: InitiatePaynowInput): Promise<{
  ok: boolean;
  redirectUrl?: string;
  pollUrl?: string;
  error?: string;
}> {
  const config = getPaynowConfig();
  if (!config.enabled) {
    return { ok: false, error: "Paynow is not configured" };
  }

  const intent = await storage.getPaymentIntentById(input.intentId);
  if (!intent) return { ok: false, error: "Payment intent not found" };
  if (intent.status === "paid") return { ok: false, error: "Payment already completed" };
  if (intent.status === "failed" || intent.status === "cancelled" || intent.status === "expired") {
    return { ok: false, error: `Intent is ${intent.status}` };
  }

  const returnUrl = config.returnUrl || "";
  const resultUrl = config.resultUrl || "";
  if (!returnUrl || !resultUrl) return { ok: false, error: "Paynow return/result URL not configured" };

  const method = (input.method || "visa_mastercard").toLowerCase();
  const isRemote = ["ecocash", "onemoney"].includes(method) && input.payerPhone;

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(
      intent.merchantReference,
      String(intent.amount),
      returnUrl,
      resultUrl,
      method,
      input.payerPhone!
    );
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(intent.merchantReference, String(intent.amount), returnUrl, resultUrl);
    url = PAYNOW_INIT_URL;
  }

  const body = toFormUrlEncoded(params);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    structuredLog("error", "Paynow initiate request failed", { error: (err as Error).message });
    return { ok: false, error: "Payment gateway unavailable" };
  }

  const text = await res.text();
  const parsed = new URLSearchParams(text);
  const status = parsed.get("status") ?? "";
  const pollUrl = parsed.get("pollurl") ?? undefined;
  const redirectUrl = parsed.get("browserurl") ?? parsed.get("redirecturl") ?? undefined;
  const paynowRef = parsed.get("paynowreference") ?? undefined;

  if (status.toLowerCase() !== "ok") {
    const errMsg = parsed.get("error") ?? text.slice(0, 200);
    structuredLog("warn", "Paynow init non-OK", { status, error: errMsg });
    await storage.updatePaymentIntent(intent.id, { status: "failed" });
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "marked_failed",
      payloadJson: { status, error: errMsg },
      actorType: input.actorType,
      actorId: input.actorId ?? null,
    });
    return { ok: false, error: errMsg || "Initiation failed" };
  }

  await storage.updatePaymentIntent(intent.id, {
    status: "pending_paynow",
    paynowPollUrl: pollUrl ?? undefined,
    paynowRedirectUrl: redirectUrl ?? undefined,
    paynowReference: paynowRef ?? undefined,
    methodSelected: method,
  });
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "redirect_issued",
    payloadJson: { pollUrl: !!pollUrl, hasRedirect: !!redirectUrl },
    actorType: input.actorType,
    actorId: input.actorId ?? null,
  });

  return {
    ok: true,
    redirectUrl: redirectUrl ?? undefined,
    pollUrl: pollUrl ?? undefined,
  };
}

/** Handle Paynow result URL POST (webhook). Verify hash, update intent, apply payment if paid. */
export async function handlePaynowResult(postedFields: Record<string, string>): Promise<{ ok: boolean; reason?: string }> {
  if (!verifyPaynowHash(postedFields)) {
    structuredLog("warn", "Paynow result hash mismatch");
    return { ok: false, reason: "Invalid hash" };
  }

  const reference = postedFields.reference ?? postedFields.merchantreference;
  const status = (postedFields.status ?? "").toLowerCase();
  const paynowRef = postedFields.paynowreference ?? postedFields.paynowreference;

  if (!reference) return { ok: false, reason: "Missing reference" };

  const orgs = await storage.getOrganizations();
  if (orgs.length === 0) return { ok: false, reason: "No tenant" };
  const orgId = orgs[0].id;

  const intent = await storage.getPaymentIntentByMerchantReference(orgId, reference);
  if (!intent) {
    structuredLog("warn", "Paynow result unknown reference", { reference });
    return { ok: true }; // 200 so Paynow does not retry
  }

  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "status_update_received",
    payloadJson: { status, paynowReference: paynowRef },
    actorType: "system",
    actorId: null,
  });

  if (intent.status === "paid" || intent.status === "failed") {
    return { ok: true }; // already processed
  }

  if (status === "paid" || status === "sent") {
    await applyPaymentToPolicy(intent.id, "system", null);
    return { ok: true };
  }
  if (status === "cancelled" || status === "failed" || status === "disputed") {
    await storage.updatePaymentIntent(intent.id, { status: "failed" });
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "marked_failed",
      payloadJson: postedFields,
      actorType: "system",
      actorId: null,
    });
  }
  return { ok: true };
}

/** Poll Paynow status; update intent and apply payment if paid. */
export async function pollPaynowStatus(intentId: string): Promise<{ status: string; paid?: boolean; error?: string }> {
  const intent = await storage.getPaymentIntentById(intentId);
  if (!intent) return { status: "unknown", error: "Intent not found" };
  if (intent.status === "paid") return { status: "paid", paid: true };
  if (intent.status === "failed" || intent.status === "cancelled" || intent.status === "expired") {
    return { status: intent.status };
  }
  const pollUrl = intent.paynowPollUrl;
  if (!pollUrl) return { status: intent.status, error: "No poll URL" };

  try {
    const res = await fetch(pollUrl, { method: "POST", body: "" });
    const text = await res.text();
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    if (!verifyPaynowHash(Object.fromEntries(parsed))) {
      return { status: intent.status, error: "Invalid poll response hash" };
    }
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "polled",
      payloadJson: { status },
      actorType: "system",
      actorId: null,
    });
    if (status === "paid" || status === "sent") {
      await applyPaymentToPolicy(intent.id, "system", null);
      return { status: "paid", paid: true };
    }
    if (status === "cancelled" || status === "failed") {
      await storage.updatePaymentIntent(intent.id, { status: "failed" });
      return { status: "failed" };
    }
    return { status: intent.status };
  } catch (err) {
    return { status: intent.status, error: (err as Error).message };
  }
}

/** Create payment_transaction, update policy (status/cycle), create payment_receipt, generate PDF. Idempotent per intent. */
export async function applyPaymentToPolicy(
  intentId: string,
  actorType: "client" | "admin" | "system",
  actorId: string | null
): Promise<{ ok: boolean; transactionId?: string; receiptId?: string; error?: string }> {
  const intent = await storage.getPaymentIntentById(intentId);
  if (!intent) return { ok: false, error: "Intent not found" };
  if (intent.status === "paid") {
    const receipts = await storage.getPaymentReceiptsByPolicy(intent.policyId);
    const existing = receipts.find((r) => r.paymentIntentId === intentId);
    return { ok: true, receiptId: existing?.id };
  }

  const policy = await storage.getPolicy(intent.policyId);
  if (!policy) return { ok: false, error: "Policy not found" };

  const today = new Date().toISOString().split("T")[0];
  const txData = {
    organizationId: intent.organizationId,
    policyId: intent.policyId,
    clientId: intent.clientId,
    amount: String(intent.amount),
    currency: intent.currency,
    paymentMethod: "paynow",
    status: "cleared" as const,
    reference: intent.merchantReference,
    paynowReference: intent.paynowReference ?? undefined,
    idempotencyKey: `paynow-${intent.id}`,
    receivedAt: new Date(),
    postedDate: today,
    valueDate: today,
    recordedBy: actorId ?? undefined,
  };
  const transaction = await storage.createPaymentTransaction(txData);

  const receiptNumber = await storage.getNextPaymentReceiptNumber(intent.organizationId);
  const channelMap: Record<string, string> = {
    ecocash: "paynow_ecocash",
    onemoney: "paynow_ecocash",
    visa_mastercard: "paynow_card",
    innbucks: "paynow_ecocash",
    omari: "paynow_ecocash",
  };
  const paymentChannel = channelMap[intent.methodSelected ?? ""] ?? "paynow_ecocash";
  const receiptData: InsertPaymentReceipt = {
    organizationId: intent.organizationId,
    receiptNumber,
    paymentIntentId: intent.id,
    policyId: intent.policyId,
    clientId: intent.clientId,
    amount: String(intent.amount),
    currency: intent.currency,
    paymentChannel,
    issuedByUserId: actorId ?? undefined,
    status: "issued",
    printFormat: "thermal_80mm",
    metadataJson: { transactionId: transaction.id, paynowReference: intent.paynowReference },
  };
  const receipt = await storage.createPaymentReceipt(receiptData);

  await storage.updatePaymentIntent(intent.id, { status: "paid" });
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "marked_paid",
    payloadJson: { transactionId: transaction.id, receiptId: receipt.id },
    actorType,
    actorId,
  });

  if (policy.status === "grace") {
    await storage.updatePolicy(intent.policyId, { status: "active", graceEndDate: null });
    await storage.createPolicyStatusHistory(intent.policyId, "grace", "active", "Payment received", actorId ?? undefined);
  } else if (policy.status === "reinstatement_pending" && intent.purpose === REINSTATEMENT_PURPOSE) {
    await storage.updatePolicy(intent.policyId, { status: "active" });
    await storage.createPolicyStatusHistory(intent.policyId, "reinstatement_pending", "active", "Reinstatement payment received", actorId ?? undefined);
  }

  const { generateReceiptPdf } = await import("./receipt-pdf");
  const pdfPath = await generateReceiptPdf(receipt.id);
  if (pdfPath) {
    await storage.updatePaymentReceipt(receipt.id, { pdfStorageKey: pdfPath });
  }

  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "receipt_issued",
    payloadJson: { receiptId: receipt.id },
    actorType,
    actorId,
  });

  return { ok: true, transactionId: transaction.id, receiptId: receipt.id };
}
