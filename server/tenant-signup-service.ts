/**
 * Public self-serve signup: a prospect's submission stays a `pendingTenantSignups` row until
 * their $1 PayNow verification charge clears, at which point provisionTenantCore() turns it into
 * a real tenant. Mirrors server/tenant-billing-service.ts's PayNow initiate/poll/webhook trio
 * (including its own small buildInitParams/buildRemoteParams — this codebase already keeps a
 * separate copy of that per PayNow-consuming domain, see payment-service.ts vs
 * tenant-billing-service.ts, rather than a shared module).
 *
 * Always bills the PLATFORM's own PayNow merchant account (getPaynowConfig()) — the $1 is
 * platform revenue (a kept, non-refundable verification fee), and the prospect has no PayNow
 * integration of their own yet at this point.
 */
import { eq } from "drizzle-orm";
import crypto from "crypto";
import argon2 from "argon2";
import { cpDb } from "./control-plane-db";
import { pendingTenantSignups, type PendingTenantSignup } from "@shared/control-plane-schema";
import { getPaynowConfig } from "./paynow-config";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import { provisionTenantCore, rollbackFailedProvisioning } from "./tenant-provisioning";
import { storage } from "./storage";
import { structuredLog } from "./logger";

function generateSignupMerchantReference(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  return `SIGNUP-${date}-${rand}`;
}

export interface CreatePendingSignupInput {
  businessName: string;
  phone?: string;
  email?: string;
  website?: string;
  orgType?: string;
  productTypes: string[];
  distributionChannels: string[];
  bookStatus?: string;
  bookSizeCurrent?: number;
  bookSizeProjected12mo?: number;
  staffComplement?: number;
  adminEmail: string;
  adminDisplayName?: string;
  adminPassword: string;
  planId: string;
  billingCycle: "monthly" | "annual";
}

/** Creates the staging row for a new signup submission. Caller (the public route) is
 *  responsible for field/taxonomy validation and the "email already exists" check — this just
 *  persists it, hashing the password immediately. */
export async function createPendingSignup(input: CreatePendingSignupInput): Promise<{ token: string }> {
  const adminPasswordHash = await argon2.hash(input.adminPassword, { type: argon2.argon2id });
  const paymentToken = crypto.randomBytes(24).toString("hex");
  await cpDb.insert(pendingTenantSignups).values({
    businessName: input.businessName,
    phone: input.phone || null,
    email: input.email || null,
    website: input.website || null,
    orgType: input.orgType || null,
    productTypes: input.productTypes,
    distributionChannels: input.distributionChannels,
    bookStatus: input.bookStatus || null,
    bookSizeCurrent: input.bookSizeCurrent ?? null,
    bookSizeProjected12mo: input.bookSizeProjected12mo ?? null,
    staffComplement: input.staffComplement ?? null,
    adminEmail: input.adminEmail,
    adminDisplayName: input.adminDisplayName || null,
    adminPasswordHash,
    planId: input.planId,
    billingCycle: input.billingCycle,
    status: "awaiting_payment",
    paymentToken,
    merchantReference: generateSignupMerchantReference(),
  });
  return { token: paymentToken };
}

const PAYNOW_INIT_URL = "https://www.paynow.co.zw/interface/initiatetransaction";
const PAYNOW_REMOTE_URL = "https://www.paynow.co.zw/interface/remotetransaction";
const PAYNOW_INITIATE_TIMEOUT_MS = 15_000;
const PAYNOW_POLL_TIMEOUT_MS = 8_000;

function isPaynowPaidStatus(status: string): boolean {
  return status === "paid" || status === "awaiting delivery" || status === "delivered";
}
function isPaynowFailedStatus(status: string): boolean {
  return status === "cancelled" || status === "failed" || status === "disputed";
}

function buildInitParams(reference: string, amount: string, returnUrl: string, resultUrl: string, integrationId: string, authEmail?: string): Record<string, string> {
  const email = authEmail || "";
  const params: Record<string, string> = {
    id: integrationId,
    reference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    ...(email ? { authemail: email } : {}),
    status: "Message",
  };
  const hashKeyOrder = email
    ? ["id", "reference", "amount", "returnurl", "resulturl", "authemail", "status"]
    : ["id", "reference", "amount", "returnurl", "resulturl", "status"];
  params.hash = generatePaynowHash(params, hashKeyOrder);
  return params;
}

function buildRemoteParams(reference: string, amount: string, returnUrl: string, resultUrl: string, integrationId: string, authEmail: string, method: string, phone: string): Record<string, string> {
  const methodMap: Record<string, string> = { ecocash: "ecocash", onemoney: "onemoney", innbucks: "innbucks", omari: "omari" };
  const paynowMethod = methodMap[method.toLowerCase()] || "ecocash";
  let cleanPhone = phone.replace(/\D/g, "").trim();
  if (cleanPhone.startsWith("0") && cleanPhone.length === 10) cleanPhone = "263" + cleanPhone.slice(1);
  const params: Record<string, string> = {
    id: integrationId,
    reference,
    amount: String(parseFloat(amount).toFixed(2)),
    returnurl: returnUrl,
    resulturl: resultUrl,
    authemail: authEmail,
    status: "Message",
    method: paynowMethod,
    phone: cleanPhone,
  };
  const hashKeyOrder = ["id", "reference", "amount", "returnurl", "resulturl", "authemail", "status", "method", "phone"];
  params.hash = generatePaynowHash(params, hashKeyOrder);
  return params;
}

function toFormUrlEncoded(params: Record<string, string>): string {
  return Object.entries(params).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

function publicSignupResultUrl(): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/api/public/tenant-signup/paynow-result`;
}

export interface InitiatePendingSignupPaynowInput {
  pendingId: string;
  method: string; // ecocash | onemoney | innbucks | omari | visa_mastercard
  payerPhone?: string;
  payerEmail?: string;
  returnUrl: string;
}

export async function initiatePendingSignupPaynow(input: InitiatePendingSignupPaynowInput): Promise<{
  ok: boolean;
  redirectUrl?: string;
  error?: string;
}> {
  const config = getPaynowConfig();
  if (!config.enabled) return { ok: false, error: "Payments are not configured" };

  const [pending] = await cpDb.select().from(pendingTenantSignups).where(eq(pendingTenantSignups.id, input.pendingId)).limit(1);
  if (!pending) return { ok: false, error: "Signup not found" };
  if (pending.status !== "awaiting_payment") return { ok: false, error: "This signup has already been processed" };

  const resultUrl = publicSignupResultUrl();
  const method = (input.method || "visa_mastercard").toLowerCase();
  const remoteMethods = ["ecocash", "onemoney", "innbucks", "omari"];
  const isRemote = remoteMethods.includes(method) && !!input.payerPhone;

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(pending.merchantReference!, String(pending.verificationAmount), input.returnUrl, resultUrl, config.integrationId, input.payerEmail || pending.adminEmail, method, input.payerPhone!);
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(pending.merchantReference!, String(pending.verificationAmount), input.returnUrl, resultUrl, config.integrationId, input.payerEmail || pending.adminEmail);
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
    structuredLog("error", "Tenant signup PayNow initiate failed", { pendingId: pending.id, error: (err as Error).message });
    return { ok: false, error: "Payment gateway unavailable" };
  }

  const text = await res.text();
  const parsed = new URLSearchParams(text);
  const status = parsed.get("status") ?? "";
  const pollUrl = parsed.get("pollurl") ?? undefined;
  const redirectUrl = parsed.get("browserurl") ?? parsed.get("redirecturl") ?? undefined;

  if (status.toLowerCase() !== "ok") {
    const errMsg = parsed.get("error") ?? text.slice(0, 200);
    structuredLog("warn", "Tenant signup PayNow init non-OK", { pendingId: pending.id, status, error: errMsg });
    return { ok: false, error: errMsg || "Initiation failed" };
  }

  await cpDb.update(pendingTenantSignups).set({ paynowPollUrl: pollUrl ?? null, paynowStatus: "pending", updatedAt: new Date() }).where(eq(pendingTenantSignups.id, pending.id));

  return { ok: true, redirectUrl };
}

/**
 * Turns a paid pending signup into a real tenant. Guarded by provisionedTenantId so a second
 * call (a duplicate poll, or the webhook firing after the poll already succeeded) is a no-op
 * rather than double-provisioning.
 */
async function provisionFromPending(pending: PendingTenantSignup): Promise<void> {
  if (pending.provisionedTenantId) return; // already provisioned — idempotent no-op

  const org = await storage.createOrganization({
    name: pending.businessName,
    phone: pending.phone || undefined,
    email: pending.email || undefined,
    website: pending.website || undefined,
    orgType: (pending.orgType as any) || undefined,
    productTypes: (pending.productTypes as any) || [],
    distributionChannels: (pending.distributionChannels as any) || [],
    bookStatus: (pending.bookStatus as any) || undefined,
    bookSizeCurrent: pending.bookSizeCurrent ?? undefined,
    bookSizeProjected12mo: pending.bookSizeProjected12mo ?? undefined,
    staffComplement: pending.staffComplement ?? undefined,
    isWhitelabeled: false,
  } as any);

  try {
    await storage.updateOrganization(org.id, { onboardingProfileCompletedAt: new Date() } as any);

    await provisionTenantCore(org, {
      adminEmail: pending.adminEmail,
      adminPasswordHash: pending.adminPasswordHash,
      adminDisplayName: pending.adminDisplayName || undefined,
      planId: pending.planId,
      billingCycle: pending.billingCycle,
    });

    await cpDb.update(pendingTenantSignups).set({
      status: "provisioned", provisionedTenantId: org.id, updatedAt: new Date(),
    }).where(eq(pendingTenantSignups.id, pending.id));
  } catch (err) {
    await rollbackFailedProvisioning(org.id, pending.businessName);
    await cpDb.update(pendingTenantSignups).set({ status: "failed", updatedAt: new Date() }).where(eq(pendingTenantSignups.id, pending.id));
    structuredLog("error", "Self-signup provisioning failed after payment cleared", { pendingId: pending.id, error: (err as Error).message });
    throw err;
  }
}

export async function pollPendingSignupStatus(pendingId: string): Promise<{ status: string; provisioned?: boolean; error?: string }> {
  const [pending] = await cpDb.select().from(pendingTenantSignups).where(eq(pendingTenantSignups.id, pendingId)).limit(1);
  if (!pending) return { status: "unknown", error: "Signup not found" };
  if (pending.status === "provisioned") return { status: "provisioned", provisioned: true };
  if (!pending.paynowPollUrl) return { status: pending.status, error: "No poll URL — initiate a payment first" };

  try {
    const res = await fetch(pending.paynowPollUrl, { method: "POST", body: "", signal: AbortSignal.timeout(PAYNOW_POLL_TIMEOUT_MS) });
    const text = await res.text();
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    if (!verifyPaynowHash(Object.fromEntries(parsed))) {
      structuredLog("warn", "Tenant signup PayNow poll hash mismatch", { pendingId });
      return { status: pending.status, error: "Verifying payment with gateway..." };
    }
    await cpDb.update(pendingTenantSignups).set({ paynowStatus: status, updatedAt: new Date() }).where(eq(pendingTenantSignups.id, pendingId));

    if (isPaynowPaidStatus(status)) {
      await provisionFromPending(pending);
      return { status: "provisioned", provisioned: true };
    }
    if (isPaynowFailedStatus(status)) return { status: "failed" };
    return { status: pending.status };
  } catch (err) {
    return { status: pending.status, error: (err as Error).message };
  }
}

/** PayNow result webhook. Always returns ok:true unless the hash itself is invalid — mirrors
 *  handleTenantBillingPaynowResult's tolerance for unknown/late statuses. */
export async function handleSignupPaynowResult(postedFields: Record<string, string>): Promise<{ ok: boolean; reason?: string }> {
  const reference = postedFields.reference ?? postedFields.merchantreference;
  const status = (postedFields.status ?? "").toLowerCase();
  if (!reference) return { ok: false, reason: "Missing reference" };

  if (!verifyPaynowHash(postedFields)) {
    structuredLog("warn", "Tenant signup PayNow result hash mismatch", { reference, status });
    return { ok: false, reason: "Invalid hash" };
  }

  const [pending] = await cpDb.select().from(pendingTenantSignups).where(eq(pendingTenantSignups.merchantReference, reference)).limit(1);
  if (!pending) {
    structuredLog("warn", "Tenant signup PayNow result: unknown reference", { reference });
    return { ok: true };
  }
  if (pending.status === "provisioned") return { ok: true };

  await cpDb.update(pendingTenantSignups).set({ paynowStatus: status, updatedAt: new Date() }).where(eq(pendingTenantSignups.id, pending.id));

  if (isPaynowPaidStatus(status)) {
    try {
      await provisionFromPending(pending);
    } catch (err: any) {
      structuredLog("error", "Tenant signup webhook provisioning failed", { pendingId: pending.id, error: err?.message });
    }
  }
  return { ok: true };
}
