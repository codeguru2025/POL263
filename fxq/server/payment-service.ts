/**
 * Payment service: Paynow initiation, result handling, polling, and policy application.
 * All Paynow secrets stay server-side. Hash verification is mandatory on result/poll.
 */

import { storage, findPaymentIntentById } from "./storage";
import { getPaynowConfig, getPaynowIntegrationId } from "./paynow-config";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import type { PaymentIntent, InsertPaymentIntent, InsertPaymentEvent, InsertPaymentReceipt } from "@shared/schema";
import type { Policy } from "@shared/schema";
import { structuredLog } from "./logger";

const PAYNOW_INIT_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const PAYNOW_REMOTE_URL = "https://www.paynow.co.zw/interface/remotetransaction";

const REINSTATEMENT_PURPOSE = "reinstatement";
const GROUP_PAYMENT_STATUS_PAID = "paid";

/** actor_id in payment_events references users.id; clients are not in users. Use null when actor is client. */
function eventActorId(actorType: string, actorId: string | null | undefined): string | null {
  return actorType === "client" ? null : (actorId ?? null);
}

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
  organizationId: string;
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

/** Merchant reference for group PayNow (prefix GRP- so result handler can distinguish). */
export function generateGroupMerchantReference(orgCode: string, groupId: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
  const rand = Math.random().toString(36).slice(2, 8);
  return `GRP-${orgCode}-${groupId.slice(0, 8)}-${date}-${time}-${rand}`.slice(0, 255);
}

/** Validate policy is payable: allow all statuses; only reject when there is no policy number
 * (e.g. captured clients who don't have an issued policy yet; only self-capture via agent links get a policy number immediately). */
function validatePolicyPayable(policy: Policy, purpose: string): { ok: boolean; message?: string } {
  if (!policy) return { ok: false, message: "Policy not found" };
  const hasPolicyNumber = policy.policyNumber != null && String(policy.policyNumber).trim() !== "";
  if (!hasPolicyNumber) return { ok: false, message: "Policy has no policy number yet" };
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

  const policy = await storage.getPolicy(policyId, organizationId);
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

/** Build form body for Paynow init (standard redirect). Hash uses field order per PayNow docs: id, reference, amount, returnurl, resulturl, status. */
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
  const hashKeyOrder = ["id", "reference", "amount", "returnurl", "resulturl", "status"];
  params.hash = generatePaynowHash(params, hashKeyOrder);
  return params;
}

/** Build form body for Paynow remote (mobile). Hash uses field order: id, reference, amount, returnurl, resulturl, status, method, phone. */
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
  const hashKeyOrder = ["id", "reference", "amount", "returnurl", "resulturl", "status", "method", "phone"];
  params.hash = generatePaynowHash(params, hashKeyOrder);
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

  const intent = await storage.getPaymentIntentById(input.intentId, input.organizationId);
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
    await storage.updatePaymentIntent(intent.id, { status: "failed" }, intent.organizationId);
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "marked_failed",
      payloadJson: { status, error: errMsg },
      actorType: input.actorType,
      actorId: eventActorId(input.actorType, input.actorId),
    });
    return { ok: false, error: errMsg || "Initiation failed" };
  }

  await storage.updatePaymentIntent(intent.id, {
    status: "pending_paynow",
    paynowPollUrl: pollUrl ?? undefined,
    paynowRedirectUrl: redirectUrl ?? undefined,
    paynowReference: paynowRef ?? undefined,
    methodSelected: method,
  }, intent.organizationId);
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "redirect_issued",
    payloadJson: { pollUrl: !!pollUrl, hasRedirect: !!redirectUrl },
    actorType: input.actorType,
    actorId: eventActorId(input.actorType, input.actorId),
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
  if (intent) {
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
      await storage.updatePaymentIntent(intent.id, { status: "failed" }, intent.organizationId);
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

  // Try group payment intent
  const groupIntent = await storage.getGroupPaymentIntentByMerchantReference(orgId, reference);
  if (!groupIntent) {
    structuredLog("warn", "Paynow result unknown reference", { reference });
    return { ok: true }; // 200 so Paynow does not retry
  }
  if (groupIntent.status === GROUP_PAYMENT_STATUS_PAID) return { ok: true };
  if (status === "paid" || status === "sent") {
    await applyGroupPaymentToPolicies(groupIntent.id, orgId, "system", null);
    return { ok: true };
  }
  if (status === "cancelled" || status === "failed" || status === "disputed") {
    await storage.updateGroupPaymentIntent(groupIntent.id, { status: "failed" }, orgId);
  }
  return { ok: true };
}

/** Poll Paynow status; update intent and apply payment if paid. */
export async function pollPaynowStatus(intentId: string, orgId: string): Promise<{ status: string; paid?: boolean; error?: string }> {
  const intent = await storage.getPaymentIntentById(intentId, orgId);
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
      await storage.updatePaymentIntent(intent.id, { status: "failed" }, orgId);
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
  const intent = await findPaymentIntentById(intentId);
  if (!intent) return { ok: false, error: "Intent not found" };
  const orgId = intent.organizationId;
  if (intent.status === "paid") {
    const receipts = await storage.getPaymentReceiptsByPolicy(intent.policyId, orgId);
    const existing = receipts.find((r) => r.paymentIntentId === intentId);
    return { ok: true, receiptId: existing?.id };
  }

  const policy = await storage.getPolicy(intent.policyId, orgId);
  if (!policy) return { ok: false, error: "Policy not found" };

  const today = new Date().toISOString().split("T")[0];
  const effectiveUserId = eventActorId(actorType, actorId);
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
    recordedBy: effectiveUserId ?? undefined,
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
    branchId: policy.branchId ?? undefined,
    receiptNumber,
    paymentIntentId: intent.id,
    policyId: intent.policyId,
    clientId: intent.clientId,
    amount: String(intent.amount),
    currency: intent.currency,
    paymentChannel,
    issuedByUserId: effectiveUserId ?? undefined,
    status: "issued",
    printFormat: "thermal_80mm",
    metadataJson: { transactionId: transaction.id, paynowReference: intent.paynowReference },
  };
  const receipt = await storage.createPaymentReceipt(receiptData);

  await storage.updatePaymentIntent(intent.id, { status: "paid" }, orgId);
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: orgId,
    type: "marked_paid",
    payloadJson: { transactionId: transaction.id, receiptId: receipt.id },
    actorType,
    actorId: eventActorId(actorType, actorId),
  });

  if (policy.status === "grace") {
    await storage.updatePolicy(intent.policyId, { status: "active", graceEndDate: null }, orgId);
    await storage.createPolicyStatusHistory(intent.policyId, "grace", "active", "Payment received", effectiveUserId ?? undefined);
  } else if (policy.status === "reinstatement_pending" && intent.purpose === REINSTATEMENT_PURPOSE) {
    await storage.updatePolicy(intent.policyId, { status: "active" }, orgId);
    await storage.createPolicyStatusHistory(intent.policyId, "reinstatement_pending", "active", "Reinstatement payment received", effectiveUserId ?? undefined);
  } else if (policy.status === "pending") {
    const today = new Date().toISOString().split("T")[0];
    const update: { status: string; inceptionDate?: string; effectiveDate?: string } = { status: "active" };
    update.inceptionDate = today;
    if (!policy.effectiveDate) update.effectiveDate = today;
    await storage.updatePolicy(intent.policyId, update, orgId);
    await storage.createPolicyStatusHistory(intent.policyId, "pending", "active", "First premium paid", effectiveUserId ?? undefined);
  }

  const { generateReceiptPdf } = await import("./receipt-pdf");
  const pdfPath = await generateReceiptPdf(receipt.id);
  if (pdfPath) {
    await storage.updatePaymentReceipt(receipt.id, { pdfStorageKey: pdfPath }, orgId);
  }

  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "receipt_issued",
    payloadJson: { receiptId: receipt.id },
    actorType,
    actorId: eventActorId(actorType, actorId),
  });

  await storage.createNotificationLog(intent.organizationId, {
    recipientType: "client",
    recipientId: intent.clientId,
    channel: "in_app",
    subject: "Payment received",
    body: `Payment of ${intent.currency} ${intent.amount} received for policy ${policy.policyNumber}. Receipt #${receiptNumber}.`,
    status: "sent",
  });

  return { ok: true, transactionId: transaction.id, receiptId: receipt.id };
}

/** Apply group PayNow payment: create transaction + receipt per allocation, update policies, mark group intent paid. Idempotent. */
export async function applyGroupPaymentToPolicies(
  groupIntentId: string,
  orgId: string,
  actorType: "client" | "admin" | "system",
  actorId: string | null
): Promise<{ ok: boolean; receiptCount?: number; error?: string }> {
  const groupIntent = await storage.getGroupPaymentIntentById(groupIntentId, orgId);
  if (!groupIntent) return { ok: false, error: "Group payment intent not found" };
  if (groupIntent.status === GROUP_PAYMENT_STATUS_PAID) {
    const allocations = await storage.getGroupPaymentAllocations(groupIntentId, orgId);
    return { ok: true, receiptCount: allocations.length };
  }

  const allocations = await storage.getGroupPaymentAllocations(groupIntentId, orgId);
  if (allocations.length === 0) return { ok: false, error: "No allocations" };

  const today = new Date().toISOString().split("T")[0];
  const refPrefix = groupIntent.merchantReference;
  const notifiedClients = new Set<string>();

  for (const alloc of allocations) {
    const policy = await storage.getPolicy(alloc.policyId, orgId);
    if (!policy) continue;
    const amount = String(alloc.amount);
    const currency = alloc.currency || groupIntent.currency || "USD";
    await storage.createPaymentTransaction({
      organizationId: orgId,
      policyId: alloc.policyId,
      clientId: policy.clientId!,
      amount,
      currency,
      paymentMethod: "paynow",
      status: "cleared",
      reference: refPrefix,
      paynowReference: groupIntent.paynowReference ?? undefined,
      idempotencyKey: `grp-${groupIntentId}-${alloc.policyId}`,
      receivedAt: new Date(),
      postedDate: today,
      valueDate: today,
      notes: "Group PayNow",
      recordedBy: actorId ?? undefined,
    });
    const receiptNumber = await storage.getNextPaymentReceiptNumber(orgId);
    await storage.createPaymentReceipt({
      organizationId: orgId,
      branchId: policy.branchId ?? undefined,
      receiptNumber,
      paymentIntentId: undefined as any,
      policyId: alloc.policyId,
      clientId: policy.clientId!,
      amount,
      currency,
      paymentChannel: "paynow_ecocash",
      issuedByUserId: actorId ?? undefined,
      status: "issued",
      metadataJson: { groupPaymentIntentId: groupIntentId, paynowReference: groupIntent.paynowReference },
    });
    if (policy.status === "grace") {
      await storage.updatePolicy(alloc.policyId, { status: "active", graceEndDate: null }, orgId);
      await storage.createPolicyStatusHistory(alloc.policyId, "grace", "active", "Payment received (group PayNow)", actorId ?? undefined);
    } else if (policy.status === "pending") {
      await storage.updatePolicy(alloc.policyId, { status: "active", inceptionDate: today, effectiveDate: policy.effectiveDate || today }, orgId);
      await storage.createPolicyStatusHistory(alloc.policyId, "pending", "active", "First premium paid (group PayNow)", actorId ?? undefined);
    }
    if (!notifiedClients.has(policy.clientId!)) {
      notifiedClients.add(policy.clientId!);
      await storage.createNotificationLog(orgId, {
        recipientType: "client",
        recipientId: policy.clientId!,
        channel: "in_app",
        subject: "Group payment received",
        body: `Payment of ${currency} ${amount} received for policy ${policy.policyNumber}. Receipt #${receiptNumber}.`,
        status: "sent",
      });
    }
  }

  await storage.updateGroupPaymentIntent(groupIntentId, { status: GROUP_PAYMENT_STATUS_PAID }, orgId);
  return { ok: true, receiptCount: allocations.length };
}

export interface InitiatePaynowForGroupInput {
  groupIntentId: string;
  organizationId: string;
  method: string;
  payerPhone?: string;
  actorType: "client" | "admin" | "system";
  actorId?: string | null;
}

/** Initiate PayNow for a group payment intent. */
export async function initiatePaynowForGroup(input: InitiatePaynowForGroupInput): Promise<{
  ok: boolean;
  redirectUrl?: string;
  pollUrl?: string;
  error?: string;
}> {
  const config = getPaynowConfig();
  if (!config.enabled) return { ok: false, error: "Paynow is not configured" };

  const groupIntent = await storage.getGroupPaymentIntentById(input.groupIntentId, input.organizationId);
  if (!groupIntent) return { ok: false, error: "Group payment intent not found" };
  if (groupIntent.status === GROUP_PAYMENT_STATUS_PAID) return { ok: false, error: "Payment already completed" };
  if (groupIntent.status === "failed" || groupIntent.status === "cancelled" || groupIntent.status === "expired") {
    return { ok: false, error: `Group intent is ${groupIntent.status}` };
  }

  const returnUrl = config.returnUrl || "";
  const resultUrl = config.resultUrl || "";
  if (!returnUrl || !resultUrl) return { ok: false, error: "Paynow return/result URL not configured" };

  const method = (input.method || "visa_mastercard").toLowerCase();
  const isRemote = ["ecocash", "onemoney"].includes(method) && input.payerPhone;
  const amount = String(groupIntent.totalAmount);

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(groupIntent.merchantReference, amount, returnUrl, resultUrl, method, input.payerPhone!);
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(groupIntent.merchantReference, amount, returnUrl, resultUrl);
    url = PAYNOW_INIT_URL;
  }

  const body = toFormUrlEncoded(params);
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body });
  } catch (err) {
    structuredLog("error", "Paynow group initiate failed", { error: (err as Error).message });
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
    await storage.updateGroupPaymentIntent(input.groupIntentId, { status: "failed" }, input.organizationId);
    return { ok: false, error: errMsg || "Initiation failed" };
  }

  await storage.updateGroupPaymentIntent(input.groupIntentId, {
    status: "pending_paynow",
    paynowPollUrl: pollUrl ?? undefined,
    paynowRedirectUrl: redirectUrl ?? undefined,
    paynowReference: paynowRef ?? undefined,
    methodSelected: method,
  }, input.organizationId);

  return { ok: true, redirectUrl: redirectUrl ?? undefined, pollUrl: pollUrl ?? undefined };
}

/** Poll group PayNow status; apply payments if paid. */
export async function pollGroupPaynowStatus(groupIntentId: string, orgId: string): Promise<{ status: string; paid?: boolean; error?: string }> {
  const groupIntent = await storage.getGroupPaymentIntentById(groupIntentId, orgId);
  if (!groupIntent) return { status: "unknown", error: "Group intent not found" };
  if (groupIntent.status === GROUP_PAYMENT_STATUS_PAID) return { status: "paid", paid: true };
  if (groupIntent.status === "failed" || groupIntent.status === "cancelled" || groupIntent.status === "expired") {
    return { status: groupIntent.status };
  }
  const pollUrl = groupIntent.paynowPollUrl;
  if (!pollUrl) return { status: groupIntent.status, error: "No poll URL" };

  try {
    const res = await fetch(pollUrl, { method: "POST", body: "" });
    const text = await res.text();
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    if (!verifyPaynowHash(Object.fromEntries(parsed))) {
      return { status: groupIntent.status, error: "Invalid poll response hash" };
    }
    if (status === "paid" || status === "sent") {
      await applyGroupPaymentToPolicies(groupIntentId, orgId, "system", null);
      return { status: "paid", paid: true };
    }
    if (status === "cancelled" || status === "failed") {
      await storage.updateGroupPaymentIntent(groupIntentId, { status: "failed" }, orgId);
      return { status: "failed" };
    }
    return { status: groupIntent.status };
  } catch (err) {
    return { status: groupIntent.status, error: (err as Error).message };
  }
}
