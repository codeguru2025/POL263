/**
 * Payment service: Paynow initiation, result handling, polling, and policy application.
 * All Paynow secrets stay server-side. Hash verification is mandatory on result/poll.
 */

import { storage, findPaymentIntentById } from "./storage";
import { withOrgTransaction, ensureRegistryUserMirroredToOrgDataDbInTx } from "./tenant-db";
import { rollbackClawbacks } from "./route-helpers";
import { applyPolicyStatusForClearedPayment, advancePolicyCycle } from "./policy-status-on-payment";
import { getOrgPaynowConfig, getPaynowConfig } from "./paynow-config";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import type { PaymentIntent, InsertPaymentIntent, InsertPaymentEvent, InsertPaymentReceipt } from "@shared/schema";
import type { Policy } from "@shared/schema";
import { paymentTransactions, paymentReceipts, paymentIntents, users, policies } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import { structuredLog } from "./logger";
import { insertOutboxMessageInTx, requestOutboxDrain, OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP } from "./outbox";

const PAYNOW_INIT_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const PAYNOW_REMOTE_URL = "https://www.paynow.co.zw/interface/remotetransaction";

// Every outbound call to Paynow must have a hard timeout — without one, a slow/unresponsive
// gateway hangs the awaiting request indefinitely (previously only pollPaynowStatus had this).
const PAYNOW_INITIATE_TIMEOUT_MS = 15_000;
const PAYNOW_POLL_TIMEOUT_MS = 8_000;

const REINSTATEMENT_PURPOSE = "reinstatement";
const GROUP_PAYMENT_STATUS_PAID = "paid";

function isPaynowPaidStatus(status: string): boolean {
  return status === "paid" || status === "awaiting delivery" || status === "delivered";
}
function isPaynowFailedStatus(status: string): boolean {
  return status === "cancelled" || status === "failed" || status === "disputed";
}

/**
 * Verify the amount the gateway reports as paid matches what we expected to charge.
 * Prevents a `paid` status for a lesser amount from activating a policy in full.
 * Returns true when the amount is within a 1-cent tolerance, or when the gateway
 * did not report an amount (cannot verify — logged here so the bypass has an audit trail).
 */
function paynowAmountMatches(postedAmount: string | null | undefined, expectedAmount: string | number): boolean {
  if (postedAmount == null || String(postedAmount).trim() === "") {
    structuredLog("warn", "Paynow response omitted amount — proceeding without amount verification", { expectedAmount: String(expectedAmount) });
    return true; // nothing to compare
  }
  const posted = parseFloat(String(postedAmount));
  const expected = parseFloat(String(expectedAmount));
  if (!Number.isFinite(posted) || !Number.isFinite(expected)) return false;
  return Math.abs(posted - expected) <= 0.01;
}

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

/** Validate policy is payable. */
function validatePolicyPayable(policy: Policy | undefined | null, purpose: string): { ok: boolean; message?: string } {
  if (!policy) return { ok: false, message: "Policy not found" };
  const hasPolicyNumber = policy.policyNumber != null && String(policy.policyNumber).trim() !== "";
  if (!hasPolicyNumber) return { ok: false, message: "Policy has no policy number yet" };
  if (policy.status === "cancelled") {
    return { ok: false, message: "Policy is cancelled. Contact your insurer to reinstate." };
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

  const amountNum = parseFloat(String(amount));
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    return { intent: null as any, created: false, error: "Amount must be greater than zero" };
  }
  // Paynow's initiate/remote transaction API has no currency field at all (see
  // buildInitParams/buildRemoteParams below) — it processes the bare amount in whatever single
  // currency the merchant account itself is configured for (USD, for every Zimbabwean Paynow
  // integration this app uses). Silently letting a ZAR (or any non-USD) intent reach Paynow
  // would charge the client that numeric amount in USD instead — e.g. a ZAR 140 premium would
  // become a USD 140 charge, roughly a 20x overcharge. Block it here, before a merchant
  // reference is even generated, rather than let it fail confusingly at the gateway.
  if (currency.toUpperCase() !== "USD") {
    return { intent: null as any, created: false, error: `Paynow only processes USD — this payment is ${currency}. Collect it via cash, EFT, or another method instead.` };
  }

  const existing = await storage.getPaymentIntentByOrgAndIdempotencyKey(organizationId, idempotencyKey);
  if (existing) {
    return { intent: existing, created: false };
  }

  const policy = await storage.getPolicy(policyId, organizationId);
  if (!policy || policy.organizationId !== organizationId) {
    return { intent: null as any, created: false, error: "Policy not found" };
  }
  const validation = validatePolicyPayable(policy, purpose);
  if (!validation.ok) {
    return { intent: null as any, created: false, error: validation.message };
  }

  const org = await storage.getOrganization(organizationId);
  const orgCode = (org?.name ?? "ORG").replace(/\s+/g, "").slice(0, 8).toUpperCase();
  const merchantReference = generateMerchantReference(orgCode, policy.policyNumber!);

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
function buildInitParams(
  merchantReference: string, amount: string,
  returnUrl: string, resultUrl: string,
  integrationId: string, integrationKey: string,
  authEmail?: string,
): Record<string, string> {
  const email = authEmail || "";
  const params: Record<string, string> = {
    id: integrationId,
    reference: merchantReference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    ...(email ? { authemail: email } : {}),
    status: "Message",
  };
  const hashKeyOrder = email
    ? ["id", "reference", "amount", "returnurl", "resulturl", "authemail", "status"]
    : ["id", "reference", "amount", "returnurl", "resulturl", "status"];
  params.hash = generatePaynowHash(params, hashKeyOrder, integrationKey);
  return params;
}

/** Build form body for Paynow remote (mobile money). */
function buildRemoteParams(
  merchantReference: string, amount: string,
  returnUrl: string, resultUrl: string,
  integrationId: string, integrationKey: string,
  authEmail: string,
  method: string, phone: string,
): Record<string, string> {
  const methodMap: Record<string, string> = {
    ecocash: "ecocash", onemoney: "onemoney", innbucks: "innbucks", omari: "omari",
  };
  const paynowMethod = methodMap[method.toLowerCase()] || "ecocash";
  let cleanPhone = phone.replace(/\D/g, "").trim();
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "263" + cleanPhone.slice(1);
  structuredLog("info", "Paynow remote initiate", { method: paynowMethod, phone: cleanPhone, merchantReference, amount });
  const params: Record<string, string> = {
    id: integrationId,
    reference: merchantReference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    authemail: authEmail,
    status: "Message",
    method: paynowMethod,
    phone: cleanPhone,
  };
  const hashKeyOrder = ["id", "reference", "amount", "returnurl", "resulturl", "authemail", "status", "method", "phone"];
  params.hash = generatePaynowHash(params, hashKeyOrder, integrationKey);
  return params;
}

function toFormUrlEncoded(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** Initiate Paynow payment; persist poll/redirect URLs and emit events.
 * Returns method-specific data: InnBucks auth code, O'Mari OTP reference, or redirect URL for cards. */
export async function initiatePaynowPayment(input: InitiatePaynowInput): Promise<{
  ok: boolean;
  redirectUrl?: string;
  pollUrl?: string;
  error?: string;
  innbucksCode?: string;
  innbucksExpiry?: string;
  omariOtpUrl?: string;
  omariOtpReference?: string;
}> {
  const config = await getOrgPaynowConfig(input.organizationId);
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
  const remoteMethods = ["ecocash", "onemoney", "innbucks", "omari"];
  const isRemote = remoteMethods.includes(method) && input.payerPhone;

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(
      intent.merchantReference, String(intent.amount),
      returnUrl, resultUrl,
      config.integrationId, config.integrationKey,
      config.authEmail,
      method, input.payerPhone!,
    );
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(
      intent.merchantReference, String(intent.amount),
      returnUrl, resultUrl,
      config.integrationId, config.integrationKey,
      input.payerEmail || config.authEmail,
    );
    url = PAYNOW_INIT_URL;
  }

  const body = toFormUrlEncoded(params);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(PAYNOW_INITIATE_TIMEOUT_MS),
    });
  } catch (err) {
    structuredLog("error", "Paynow initiate request failed", { error: (err as Error).message });
    return { ok: false, error: "Payment gateway unavailable" };
  }

  const text = await res.text();
  structuredLog("info", "Paynow response raw", { text: text.slice(0, 800), isRemote, method });
  const parsed = new URLSearchParams(text);
  const status = parsed.get("status") ?? "";
  const pollUrl = parsed.get("pollurl") ?? undefined;
  const redirectUrl = parsed.get("browserurl") ?? parsed.get("redirecturl") ?? undefined;
  const paynowRef = parsed.get("paynowreference") ?? undefined;

  if (status.toLowerCase() !== "ok") {
    const errMsg = parsed.get("error") ?? text.slice(0, 200);
    structuredLog("warn", "Paynow init non-OK", { status, error: errMsg, isRemote, method });
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

  // InnBucks: extract authorization code + expiry
  const innbucksCode = parsed.get("authorizationcode") ?? undefined;
  const innbucksExpiry = parsed.get("authorizationexpires") ?? undefined;

  // O'Mari: extract remote OTP URL + reference
  const omariOtpUrl = parsed.get("remoteotpurl") ?? undefined;
  const omariOtpReference = parsed.get("otpreference") ?? undefined;

  const pendingStatus = method === "omari" ? "pending_otp" : "pending_paynow";

  await storage.updatePaymentIntent(intent.id, {
    status: pendingStatus,
    paynowPollUrl: pollUrl ?? undefined,
    paynowRedirectUrl: omariOtpUrl || redirectUrl || undefined,
    paynowReference: paynowRef ?? undefined,
    methodSelected: method,
  }, intent.organizationId);
  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: intent.organizationId,
    type: "redirect_issued",
    payloadJson: {
      pollUrl: !!pollUrl,
      hasRedirect: !!redirectUrl,
      method,
      innbucksCode: innbucksCode ?? null,
      omariOtpReference: omariOtpReference ?? null,
    },
    actorType: input.actorType,
    actorId: eventActorId(input.actorType, input.actorId),
  });

  return {
    ok: true,
    redirectUrl: redirectUrl ?? undefined,
    pollUrl: pollUrl ?? undefined,
    innbucksCode,
    innbucksExpiry,
    omariOtpUrl,
    omariOtpReference,
  };
}

/** Submit O'Mari OTP to complete transaction. */
export async function submitOmariOtp(intentId: string, orgId: string, otp: string, actorType: "client" | "admin" | "system", actorId: string | null): Promise<{
  ok: boolean;
  error?: string;
  paid?: boolean;
}> {
  const intent = await storage.getPaymentIntentById(intentId, orgId);
  if (!intent) return { ok: false, error: "Payment intent not found" };
  if (intent.status === "paid") return { ok: true, paid: true };

  if (intent.methodSelected !== "omari") return { ok: false, error: "This payment is not an O'Mari transaction" };
  const otpUrl = intent.paynowRedirectUrl;
  if (!otpUrl) return { ok: false, error: "No O'Mari OTP URL available for this payment" };

  const orgCfg = await getOrgPaynowConfig(orgId);
  const params: Record<string, string> = {
    id: orgCfg.integrationId,
    otp,
    status: "Message",
  };
  const hashKeyOrder = ["id", "otp", "status"];
  params.hash = generatePaynowHash(params, hashKeyOrder, orgCfg.integrationKey);

  const body = toFormUrlEncoded(params);
  let res: Response;
  try {
    res = await fetch(otpUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(PAYNOW_INITIATE_TIMEOUT_MS),
    });
  } catch (err) {
    structuredLog("error", "O'Mari OTP submit failed", { error: (err as Error).message });
    return { ok: false, error: "Payment gateway unavailable" };
  }

  const text = await res.text();
  structuredLog("info", "O'Mari OTP response", { text: text.slice(0, 500) });
  const parsed = new URLSearchParams(text);
  const status = (parsed.get("status") ?? "").toLowerCase();

  await storage.createPaymentEvent({
    paymentIntentId: intent.id,
    organizationId: orgId,
    type: "otp_submitted",
    payloadJson: { status },
    actorType,
    actorId: eventActorId(actorType, actorId),
  });

  if (status === "error" || status === "failed") {
    const errMsg = parsed.get("error") ?? "Invalid OTP";
    return { ok: false, error: errMsg };
  }

  // Successful OTP - payment may be paid or awaiting delivery
  const pollUrl = parsed.get("pollurl") ?? intent.paynowPollUrl ?? undefined;
  const paynowRef = parsed.get("paynowreference") ?? intent.paynowReference ?? undefined;

  await storage.updatePaymentIntent(intent.id, {
    status: "pending_paynow",
    paynowPollUrl: pollUrl,
    paynowReference: paynowRef,
  }, orgId);

  if (isPaynowPaidStatus(status)) {
    const applied = await applyPaymentToPolicy(intent.id, actorType, actorId);
    if (!applied.ok) {
      structuredLog("error", "applyPaymentToPolicy failed after Paynow status", { intentId: intent.id, error: applied.error });
      return { ok: true, paid: false, error: applied.error };
    }
    return { ok: true, paid: true };
  }

  return { ok: true, paid: false };
}

/**
 * Handle Paynow result URL POST (webhook).
 * Pass `orgId` when the result URL includes ?org=<orgId> so we verify with the
 * correct per-tenant integration key. If omitted we fall back to scanning all orgs
 * (platform-key verification only — supports legacy single-tenant setup).
 */
export async function handlePaynowResult(
  postedFields: Record<string, string>,
  orgId?: string,
): Promise<{ ok: boolean; reason?: string }> {
  const reference = postedFields.reference ?? postedFields.merchantreference;
  const status = (postedFields.status ?? "").toLowerCase();
  const paynowRef = postedFields.paynowreference ?? postedFields.PaynowReference ?? postedFields.Paynowreference;

  if (!reference) return { ok: false, reason: "Missing reference" };

  // Resolve the integration key: prefer per-org, fall back to platform.
  let verifiedOrgId: string | undefined = orgId;
  if (orgId) {
    const cfg = await getOrgPaynowConfig(orgId);
    if (!verifyPaynowHash(postedFields, cfg.integrationKey)) {
      structuredLog("warn", "Paynow result hash mismatch (org-keyed)", {
        orgId, status, reference,
        keys: Object.keys(postedFields).filter((k) => k.toLowerCase() !== "hash").join(","),
      });
      return { ok: false, reason: "Invalid hash" };
    }
  } else {
    // Legacy path: try platform key; if that fails, try each org's key until one matches.
    if (!verifyPaynowHash(postedFields)) {
      const orgs = await storage.getOrganizations();
      let matched = false;
      for (const org of orgs) {
        const cfg = await getOrgPaynowConfig(org.id);
        if (cfg.integrationKey && verifyPaynowHash(postedFields, cfg.integrationKey)) {
          verifiedOrgId = org.id;
          matched = true;
          break;
        }
      }
      if (!matched) {
        structuredLog("warn", "Paynow result hash mismatch (all keys tried)", { status, reference });
        return { ok: false, reason: "Invalid hash" };
      }
    }
  }

  const orgs = await storage.getOrganizations();
  if (orgs.length === 0) return { ok: false, reason: "No tenant" };

  // Search tenants for the matching payment intent (scoped to verified org if known)
  let intent: Awaited<ReturnType<typeof storage.getPaymentIntentByMerchantReference>> = undefined;
  const searchOrgs = verifiedOrgId ? orgs.filter((o) => o.id === verifiedOrgId) : orgs;
  const intentResults = await Promise.all(searchOrgs.map((org) => storage.getPaymentIntentByMerchantReference(org.id, reference)));
  intent = intentResults.find(Boolean);

  if (intent) {
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "status_update_received",
      payloadJson: { status, paynowReference: paynowRef },
      actorType: "system",
      actorId: null,
    });

    if (intent.status === "paid") {
      return { ok: true };
    }

    if (isPaynowPaidStatus(status)) {
      if (!paynowAmountMatches(postedFields.amount, intent.amount)) {
        structuredLog("error", "Paynow result amount mismatch — not applying payment", {
          intentId: intent.id,
          expected: String(intent.amount),
          posted: postedFields.amount,
          status,
        });
        await storage.createPaymentEvent({
          paymentIntentId: intent.id,
          organizationId: intent.organizationId,
          type: "amount_mismatch_hold",
          payloadJson: { expected: String(intent.amount), posted: postedFields.amount, status },
          actorType: "system",
          actorId: null,
        });
        return { ok: false, reason: "Amount mismatch" };
      }
      if (intent.status === "failed") {
        structuredLog("warn", "Paynow webhook recovering failed intent", { intentId: intent.id, paynowStatus: status });
      }
      const applied = await applyPaymentToPolicy(intent.id, "system", null);
      if (!applied.ok) structuredLog("error", "handlePaynowResult applyPaymentToPolicy failed", { intentId: intent.id, error: applied.error });
      return { ok: true };
    }
    if (isPaynowFailedStatus(status)) {
      if (intent.status !== "failed") {
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
    } else {
      structuredLog("warn", "Paynow webhook unhandled status", { intentId: intent.id, status, reference });
    }
    return { ok: true };
  }

  // Try group payment intent across all tenants in parallel
  let groupIntent: Awaited<ReturnType<typeof storage.getGroupPaymentIntentByMerchantReference>> = undefined;
  let groupOrgId = "";
  const groupResults = await Promise.all(orgs.map((org) => storage.getGroupPaymentIntentByMerchantReference(org.id, reference).then((gi) => ({ gi, orgId: org.id }))));
  const groupMatch = groupResults.find((r) => r.gi);
  if (groupMatch) { groupIntent = groupMatch.gi; groupOrgId = groupMatch.orgId; }

  if (!groupIntent) {
    structuredLog("warn", "Paynow result unknown reference", { reference });
    return { ok: true };
  }
  if (groupIntent.status === GROUP_PAYMENT_STATUS_PAID) return { ok: true };
  if (isPaynowPaidStatus(status)) {
    if (!paynowAmountMatches(postedFields.amount, groupIntent.totalAmount)) {
      structuredLog("error", "Paynow result amount mismatch — not applying group payment", {
        groupIntentId: groupIntent.id,
        expected: String(groupIntent.totalAmount),
        posted: postedFields.amount,
        status,
      });
      return { ok: false, reason: "Amount mismatch" };
    }
    if (groupIntent.status === "failed") {
      structuredLog("warn", "Paynow webhook recovering failed group intent", { groupIntentId: groupIntent.id, paynowStatus: status });
    }
    const applied = await applyGroupPaymentToPolicies(groupIntent.id, groupOrgId, "system", null);
    if (!applied.ok) structuredLog("error", "handlePaynowResult applyGroupPaymentToPolicies failed", { groupIntentId: groupIntent.id, error: applied.error });
    return { ok: true };
  }
  if (isPaynowFailedStatus(status)) {
    if (groupIntent.status !== "failed") {
      await storage.updateGroupPaymentIntent(groupIntent.id, { status: "failed" }, groupOrgId);
    }
  } else {
    structuredLog("warn", "Paynow webhook unhandled group status", { groupIntentId: groupIntent.id, status, reference });
  }
  return { ok: true };
}

/** Poll Paynow status; update intent and apply payment if paid. */
export async function pollPaynowStatus(intentId: string, orgId: string): Promise<{ status: string; paid?: boolean; error?: string; paynowStatus?: string }> {
  const intent = await storage.getPaymentIntentById(intentId, orgId);
  if (!intent) return { status: "unknown", error: "Intent not found" };
  if (intent.status === "paid") return { status: "paid", paid: true };
  if (intent.status === "failed" || intent.status === "cancelled" || intent.status === "expired") {
    return { status: intent.status };
  }
  const pollUrl = intent.paynowPollUrl;
  if (!pollUrl) return { status: intent.status, error: "No poll URL" };

  // Must verify with THIS org's integration key — orgs on their own dedicated Paynow merchant
  // account (not the platform's) would otherwise always fail hash verification here (the
  // no-arg fallback only checks the platform env var key), leaving polling permanently unable
  // to confirm a payment even though the webhook path (which does pass the org key) works fine.
  const orgCfgForPoll = await getOrgPaynowConfig(orgId);

  try {
    const res = await fetch(pollUrl, { method: "POST", body: "", signal: AbortSignal.timeout(PAYNOW_POLL_TIMEOUT_MS) });
    const text = await res.text();
    structuredLog("info", "Paynow poll raw response", { intentId: intent.id, responseText: text.slice(0, 600) });
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    const hashValid = verifyPaynowHash(Object.fromEntries(parsed), orgCfgForPoll.integrationKey);
    if (!hashValid) {
      structuredLog("warn", "Paynow poll hash mismatch", {
        intentId: intent.id,
        paynowStatus: status,
        keys: Array.from(parsed.keys()).filter((k) => k.toLowerCase() !== "hash").join(","),
      });
      return { status: intent.status, error: "Verifying payment with gateway...", paynowStatus: status };
    }
    await storage.createPaymentEvent({
      paymentIntentId: intent.id,
      organizationId: intent.organizationId,
      type: "polled",
      payloadJson: { status },
      actorType: "system",
      actorId: null,
    });
    if (isPaynowPaidStatus(status)) {
      if (!paynowAmountMatches(parsed.get("amount"), intent.amount)) {
        structuredLog("error", "Paynow poll amount mismatch — not applying payment", {
          intentId: intent.id,
          expected: String(intent.amount),
          posted: parsed.get("amount"),
          status,
        });
        await storage.createPaymentEvent({
          paymentIntentId: intent.id,
          organizationId: intent.organizationId,
          type: "amount_mismatch_hold",
          payloadJson: { expected: String(intent.amount), posted: parsed.get("amount"), status },
          actorType: "system",
          actorId: null,
        });
        return { status: intent.status, error: "Payment amount mismatch — contact support", paynowStatus: status };
      }
      const applied = await applyPaymentToPolicy(intent.id, "system", null);
      if (!applied.ok) {
        structuredLog("error", "applyPaymentToPolicy failed", { intentId: intent.id, error: applied.error });
        return { status: "paid_pending_apply", paid: false, error: applied.error || "Payment received but recording failed — will retry", paynowStatus: status };
      }
      return { status: "paid", paid: true, paynowStatus: status };
    }
    if (isPaynowFailedStatus(status)) {
      await storage.updatePaymentIntent(intent.id, { status: "failed" }, orgId);
      return { status: "failed", paynowStatus: status };
    }
    if (status && status !== "created") {
      structuredLog("info", "Paynow poll intermediate status", { intentId: intent.id, status });
    }
    return { status: intent.status, paynowStatus: status };
  } catch (err) {
    structuredLog("error", "Paynow poll fetch error", { intentId: intent.id, error: (err as Error).message });
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

  const policy = await storage.getPolicy(intent.policyId, orgId);
  if (!policy) {
    // Policy was deleted after intent was created — mark intent failed so it doesn't stay stuck
    await db.update(paymentIntents).set({ status: "failed" }).where(eq(paymentIntents.id, intentId));
    structuredLog("error", "PayNow confirmation: policy not found — intent marked failed", { intentId, policyId: intent.policyId, orgId });
    return { ok: false, error: "Policy not found — payment intent marked failed. Contact support." };
  }

  const today = new Date().toISOString().split("T")[0];
  const effectiveUserId = eventActorId(actorType, actorId);
  const channelMap: Record<string, string> = {
    ecocash: "paynow_ecocash",
    onemoney: "paynow_ecocash",
    visa_mastercard: "paynow_card",
    innbucks: "paynow_ecocash",
    omari: "paynow_ecocash",
  };
  const paymentChannel = channelMap[intent.methodSelected ?? ""] ?? "paynow_ecocash";

  let transaction: { id: string };
  let receipt: { id: string; receiptNumber: string };

  try {
    const result = await withOrgTransaction(orgId, async (txDb) => {
      // Lock the intent row and re-check idempotency inside the transaction to prevent races
      const [lockedIntent] = await txDb
        .select({ id: paymentIntents.id, status: paymentIntents.status })
        .from(paymentIntents)
        .where(eq(paymentIntents.id, intentId))
        .limit(1)
        .for("update");
      if (lockedIntent?.status === "paid") {
        const receipts = await storage.getPaymentReceiptsByPolicy(intent.policyId, orgId);
        const existingReceipt = receipts.find((r) => r.paymentIntentId === intentId);
        return { alreadyPaid: true, receiptId: existingReceipt?.id };
      }
      const existingIdempotentTx = await storage.getPaymentTransactionByIdempotencyKey(`paynow-${intent.id}`, orgId);
      if (existingIdempotentTx) {
        const receipts = await storage.getPaymentReceiptsByPolicy(intent.policyId, orgId);
        const existingReceipt = receipts.find((r) => r.paymentIntentId === intentId);
        return { alreadyPaid: true, transactionId: existingIdempotentTx.id, receiptId: existingReceipt?.id };
      }

      let recordedByForLedger: string | null = null;
      if (effectiveUserId) {
        await ensureRegistryUserMirroredToOrgDataDbInTx(txDb, orgId, effectiveUserId);
        const [urow] = await txDb.select({ id: users.id }).from(users).where(eq(users.id, effectiveUserId)).limit(1);
        recordedByForLedger = urow?.id ?? null;
      }
      const receiptNumber = await storage.allocatePaymentReceiptNumberInTx(txDb, orgId);

      // Advance the policy cycle N times — infer months from amount/premium ratio
      const premiumAmt = policy.premiumAmount ? parseFloat(String(policy.premiumAmount)) : 0;
      const paidAmt = parseFloat(String(intent.amount));
      const monthCount = (premiumAmt > 0 && Number.isFinite(paidAmt / premiumAmt))
        ? Math.min(12, Math.max(1, Math.round(paidAmt / premiumAmt)))
        : 1;
      let currentPolicySnap: typeof policy = policy;
      let paymentPeriod: { periodFrom: string; periodTo: string } = { periodFrom: today, periodTo: today };
      for (let m = 0; m < monthCount; m++) {
        const period = await advancePolicyCycle(txDb, intent.policyId, currentPolicySnap, today);
        if (m === 0) paymentPeriod = { periodFrom: period.periodFrom, periodTo: period.periodTo };
        else paymentPeriod.periodTo = period.periodTo;
        if (m < monthCount - 1) {
          const [snap] = await txDb.select().from(policies).where(eq(policies.id, intent.policyId)).limit(1);
          if (snap) currentPolicySnap = snap as any;
        }
      }

      const [tx] = await txDb.insert(paymentTransactions).values({
        organizationId: intent.organizationId,
        policyId: intent.policyId,
        clientId: intent.clientId,
        amount: String(intent.amount),
        currency: intent.currency,
        paymentMethod: "paynow",
        status: "cleared",
        reference: intent.merchantReference,
        paynowReference: intent.paynowReference ?? undefined,
        idempotencyKey: `paynow-${intent.id}`,
        receivedAt: new Date(),
        postedDate: today,
        valueDate: today,
        recordedBy: recordedByForLedger ?? undefined,
        periodFrom: paymentPeriod.periodFrom,
        periodTo: paymentPeriod.periodTo,
      }).returning();
      transaction = tx;

      const [rec] = await txDb.insert(paymentReceipts).values({
        organizationId: intent.organizationId,
        branchId: policy.branchId ?? undefined,
        receiptNumber,
        paymentIntentId: intent.id,
        policyId: intent.policyId,
        clientId: intent.clientId,
        amount: String(intent.amount),
        currency: intent.currency,
        paymentChannel,
        periodFrom: paymentPeriod.periodFrom,
        periodTo: paymentPeriod.periodTo,
        issuedByUserId: recordedByForLedger ?? undefined,
        status: "issued",
        printFormat: "thermal_80mm",
        metadataJson: { transactionId: tx.id, paynowReference: intent.paynowReference },
      }).returning();
      receipt = rec;

      await txDb.update(paymentIntents).set({ status: "paid" }).where(eq(paymentIntents.id, intent.id));
      await applyPolicyStatusForClearedPayment(txDb, intent.policyId, policy, today, "", recordedByForLedger ?? undefined);

      await insertOutboxMessageInTx(txDb, {
        organizationId: orgId,
        type: OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP,
        dedupeKey: `paynow_apply:${intent.id}`,
        payload: {
          intentId: intent.id,
          transactionId: tx.id,
          receiptId: rec.id,
          actorType,
          actorId: eventActorId(actorType, actorId),
        },
      });

      return { transaction: tx, receipt: rec, alreadyPaid: false };
    });

    if (result.alreadyPaid) {
      return { ok: true, transactionId: result.transactionId, receiptId: result.receiptId };
    }
    transaction = result.transaction!;
    receipt = result.receipt!;
  } catch (err: any) {
    structuredLog("error", "applyPaymentToPolicy failed", { intentId, error: err?.message || String(err), stack: err?.stack });
    return { ok: false, error: err?.message || "Failed to apply payment" };
  }

  if (policy.status === "lapsed") {
    // Clawback rollback runs after the TX; log clearly if it fails so it can be corrected manually
    rollbackClawbacks(orgId, policy).catch((err: any) => {
      structuredLog("error", "Clawback rollback failed after payment applied — manual correction required", {
        orgId, policyId: policy.id, intentId, error: err?.message || String(err),
      });
    });
  }

  requestOutboxDrain(orgId);

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

  for (const alloc of allocations) {
    const policy = await storage.getPolicy(alloc.policyId, orgId);
    if (!policy) return { ok: false, error: `Policy ${alloc.policyId} not found for group payment` };
    const payable = validatePolicyPayable(policy, "premium");
    if (!payable.ok) return { ok: false, error: payable.message || "Policy not payable" };
  }

  try {
    const today = new Date().toISOString().split("T")[0];
    const refPrefix = groupIntent.merchantReference;
    const notifiedClients = new Set<string>();
    let successCount = 0;

    for (const alloc of allocations) {
      // Idempotency: skip allocations already applied
      const existingTx = await storage.getPaymentTransactionByIdempotencyKey(`grp-${groupIntentId}-${alloc.policyId}`, orgId);
      if (existingTx) { successCount++; continue; }

      const policy = await storage.getPolicy(alloc.policyId, orgId);
      if (!policy) {
        structuredLog("error", "Group payment allocation policy missing after pre-check", { groupIntentId, policyId: alloc.policyId });
        return { ok: false, error: `Policy ${alloc.policyId} not found` };
      }

      const amount = String(alloc.amount);
      const currency = alloc.currency || groupIntent.currency || "USD";

      // Wrap each allocation in its own transaction for atomicity
      const { newTx, receiptNumber } = await withOrgTransaction(orgId, async (txDb) => {
        let recordedByForLedger: string | null = null;
        if (actorId) {
          await ensureRegistryUserMirroredToOrgDataDbInTx(txDb, orgId, actorId);
          const [urow] = await txDb.select({ id: users.id }).from(users).where(eq(users.id, actorId)).limit(1);
          recordedByForLedger = urow?.id ?? null;
        }
        const receiptNumber = await storage.allocatePaymentReceiptNumberInTx(txDb, orgId);
        // Lock policy row to prevent concurrent status changes
        await txDb.execute(sql`SELECT id FROM policies WHERE id = ${alloc.policyId} FOR UPDATE`);

        const paymentPeriod = await advancePolicyCycle(txDb, alloc.policyId, policy, today);

        const [newTx] = await txDb.insert(paymentTransactions).values({
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
          recordedBy: recordedByForLedger ?? undefined,
          periodFrom: paymentPeriod.periodFrom,
          periodTo: paymentPeriod.periodTo,
        }).returning();

        await txDb.insert(paymentReceipts).values({
          organizationId: orgId,
          branchId: policy.branchId ?? undefined,
          receiptNumber,
          policyId: alloc.policyId,
          clientId: policy.clientId!,
          amount,
          currency,
          paymentChannel: "paynow_ecocash",
          periodFrom: paymentPeriod.periodFrom,
          periodTo: paymentPeriod.periodTo,
          issuedByUserId: recordedByForLedger ?? undefined,
          status: "issued",
          metadataJson: { groupPaymentIntentId: groupIntentId, paynowReference: groupIntent.paynowReference, transactionId: newTx.id },
        });

        await applyPolicyStatusForClearedPayment(txDb, alloc.policyId, policy, today, " (group PayNow)", recordedByForLedger ?? undefined);
        return { newTx, receiptNumber };
      });

      successCount++;

      // 2.5% platform fee on cleared group PayNow receipt
      storage.createPlatformReceivable({
        organizationId: orgId,
        amount: (parseFloat(amount) * 0.025).toFixed(2),
        currency,
        description: `2.5% on group PayNow receipt ${receiptNumber} (policy ${policy.policyNumber})`,
        isSettled: false,
      }).catch((err: Error) => structuredLog("error", "Platform fee failed (group PayNow)", { policyId: policy.id, error: err.message }));

      // Post-transaction best-effort side effects
      if (policy.status === "lapsed") {
        rollbackClawbacks(orgId, policy).catch((err: any) => {
          structuredLog("error", "Clawback rollback failed after group payment applied — manual correction required", {
            orgId, policyId: policy.id, groupIntentId, error: err?.message || String(err),
          });
        });
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

    if (successCount !== allocations.length) {
      structuredLog("error", "Group payment incomplete allocations", { groupIntentId, successCount, expected: allocations.length });
      return { ok: false, error: `Only ${successCount} of ${allocations.length} allocations were applied` };
    }

    await storage.updateGroupPaymentIntent(groupIntentId, { status: GROUP_PAYMENT_STATUS_PAID }, orgId);
    return { ok: true, receiptCount: successCount };
  } catch (err: any) {
    structuredLog("error", "applyGroupPaymentToPolicies failed", { groupIntentId, error: err?.message || String(err), stack: err?.stack });
    return { ok: false, error: err?.message || "Failed to apply group payment" };
  }
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
  const config = await getOrgPaynowConfig(input.organizationId);
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
  const remoteMethods = ["ecocash", "onemoney", "innbucks", "omari"];
  const isRemote = remoteMethods.includes(method) && input.payerPhone;
  const amount = String(groupIntent.totalAmount);

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(
      groupIntent.merchantReference, amount, returnUrl, resultUrl,
      config.integrationId, config.integrationKey, config.authEmail,
      method, input.payerPhone!,
    );
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(
      groupIntent.merchantReference, amount, returnUrl, resultUrl,
      config.integrationId, config.integrationKey, config.authEmail,
    );
    url = PAYNOW_INIT_URL;
  }

  const body = toFormUrlEncoded(params);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(PAYNOW_INITIATE_TIMEOUT_MS),
    });
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

  // Same org-key requirement as pollPaynowStatus — see comment there.
  const orgCfgForGroupPoll = await getOrgPaynowConfig(orgId);

  try {
    const res = await fetch(pollUrl, { method: "POST", body: "", signal: AbortSignal.timeout(PAYNOW_POLL_TIMEOUT_MS) });
    const text = await res.text();
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    if (!verifyPaynowHash(Object.fromEntries(parsed), orgCfgForGroupPoll.integrationKey)) {
      return { status: groupIntent.status, error: "Invalid poll response hash" };
    }
    if (isPaynowPaidStatus(status)) {
      await applyGroupPaymentToPolicies(groupIntentId, orgId, "system", null);
      return { status: "paid", paid: true };
    }
    if (isPaynowFailedStatus(status)) {
      await storage.updateGroupPaymentIntent(groupIntentId, { status: "failed" }, orgId);
      return { status: "failed" };
    }
    if (status && status !== "created") {
      structuredLog("info", "Paynow group poll unhandled status", { groupIntentId, status });
    }
    return { status: groupIntent.status };
  } catch (err) {
    return { status: groupIntent.status, error: (err as Error).message };
  }
}
