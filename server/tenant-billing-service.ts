/**
 * Tenant subscription billing: invoice generation, PayNow collection (platform's
 * own merchant account — see getPaynowConfig()), and the single function every
 * payment-clearance path (poll, webhook, manual mark-paid) calls to apply a
 * payment and restore access. Mirrors server/payment-service.ts's idempotency
 * and hash-verification rigor, simplified for a single always-platform key.
 *
 * IMPORTANT: this always bills the PLATFORM's own PayNow merchant account
 * (getPaynowConfig()), never a tenant's own integration (getOrgPaynowConfig) —
 * tenant billing money flows tenant -> platform, the reverse of premium payments.
 */
import { eq, and } from "drizzle-orm";
import crypto from "crypto";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
  billingPlans,
  tenantSubscriptions,
  tenantInvoices,
  billingSettings,
  tenantBillingEvents,
  type TenantSubscription,
  type BillingPlan,
  type TenantInvoice,
} from "@shared/control-plane-schema";
import { getPaynowConfig } from "./paynow-config";
import { computeNextPeriod, computeInvoiceAmount, effectiveBillingIntervalMonths } from "./tenant-billing-math";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import { invalidateTenantActiveCache } from "./auth";
import { invalidateTenantModuleCache } from "./module-gate";
import { structuredLog } from "./logger";
import { sendRestoredEmail } from "./tenant-billing-email";

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

// ─── SETTINGS / DERIVED HELPERS ────────────────────────────────────────────────

export async function getBillingSettings() {
  const [row] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
  if (row) return row;
  // Singleton not yet seeded — return schema defaults without writing (Phase 7 UI seeds it on first save).
  return { id: "global", trialDays: 14, graceDays: 7, reminderLeadDays: 3, moduleEnforcementEnabled: false, updatedAt: new Date() };
}

export { getEffectiveGraceDays, addBillingCycle } from "./tenant-billing-math";

// ─── INVOICE GENERATION ─────────────────────────────────────────────────────────

function generateMerchantReference(orgId: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  return `BILL-${orgId.slice(0, 8)}-${date}-${rand}`;
}

/**
 * Idempotent per subscription+period: if an open invoice already exists for this
 * subscription's currentPeriodEnd, returns it (created:false) instead of creating
 * a duplicate. Callers (the sweep) use `created` to decide whether to send a
 * reminder email — only on first generation, not on every idempotent re-check.
 */
export async function generateInvoiceForSubscription(subscription: TenantSubscription, plan: BillingPlan): Promise<{ invoice: TenantInvoice; created: boolean }> {
  const [existing] = await cpDb
    .select()
    .from(tenantInvoices)
    .where(and(
      eq(tenantInvoices.subscriptionId, subscription.id),
      eq(tenantInvoices.periodEnd, subscription.currentPeriodEnd),
      eq(tenantInvoices.status, "open"),
    ))
    .limit(1);
  if (existing) return { invoice: existing, created: false };

  const [invoice] = await cpDb
    .insert(tenantInvoices)
    .values({
      tenantId: subscription.tenantId,
      subscriptionId: subscription.id,
      planId: plan.id,
      amount: computeInvoiceAmount(plan.priceMonthlyUsd, subscription.billingCycle),
      currency: "USD",
      status: "open",
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      dueDate: subscription.currentPeriodEnd,
      paymentToken: crypto.randomBytes(24).toString("hex"),
      merchantReference: generateMerchantReference(subscription.tenantId),
    })
    .returning();

  await cpDb.insert(tenantBillingEvents).values({
    tenantId: subscription.tenantId,
    invoiceId: invoice.id,
    type: "invoice_generated",
    detail: { amount: invoice.amount, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd },
  });

  return { invoice, created: true };
}

// ─── PAYMENT APPLICATION (the single function every clearance path calls) ─────

export async function applyTenantInvoicePayment(
  invoiceId: string,
  opts: { source: "paynow" | "manual"; actorId?: string | null; note?: string },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const result = await cpDb.transaction(async (tx) => {
      const [invoice] = await tx.select().from(tenantInvoices).where(eq(tenantInvoices.id, invoiceId)).for("update").limit(1);
      if (!invoice) return { ok: false as const, error: "Invoice not found" };
      if (invoice.status === "paid") return { ok: true as const, alreadyPaid: true };

      // Locked too, not just the invoice row — otherwise two different open invoices for the
      // same subscription paid concurrently would both read the same stale currentPeriodEnd
      // and the second UPDATE would silently overwrite the first's period extension.
      const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.id, invoice.subscriptionId)).for("update").limit(1);
      if (!subscription) return { ok: false as const, error: "Subscription not found" };
      const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, invoice.planId)).limit(1);
      if (!plan) return { ok: false as const, error: "Plan not found" };

      const now = new Date();
      const intervalMonths = effectiveBillingIntervalMonths(subscription.billingCycle, plan.billingIntervalMonths);
      const { periodStart: cycleStart, periodEnd: cycleEnd } = computeNextPeriod(now, subscription.currentPeriodEnd, intervalMonths);

      await tx.update(tenantInvoices).set({
        status: "paid",
        paidAt: now,
        markedPaidBy: opts.source === "manual" ? (opts.actorId ?? null) : null,
        notes: opts.note ?? invoice.notes,
        updatedAt: now,
      }).where(eq(tenantInvoices.id, invoiceId));

      await tx.update(tenantSubscriptions).set({
        status: "active",
        currentPeriodStart: cycleStart,
        currentPeriodEnd: cycleEnd,
        updatedAt: now,
      }).where(eq(tenantSubscriptions.id, subscription.id));

      await tx.update(cpTenants).set({
        isActive: true,
        licenseStatus: "active",
        suspendedAt: null,
        suspendReason: null,
      }).where(eq(cpTenants.id, subscription.tenantId));

      await tx.insert(tenantBillingEvents).values({
        tenantId: subscription.tenantId,
        invoiceId: invoice.id,
        type: opts.source === "manual" ? "manual_mark_paid" : "auto_restored",
        detail: { source: opts.source, actorId: opts.actorId ?? null, newPeriodEnd: cycleEnd },
      });

      return { ok: true as const, tenantId: subscription.tenantId, wasSuspended: subscription.status === "suspended" };
    });

    if (!result.ok || (result as any).alreadyPaid) return { ok: result.ok, error: (result as any).error };

    const tenantId = (result as any).tenantId as string;
    invalidateTenantActiveCache(tenantId);
    invalidateTenantModuleCache(tenantId);

    sendRestoredEmail(tenantId).catch((err) => structuredLog("error", "sendRestoredEmail failed", { tenantId, error: (err as Error).message }));

    return { ok: true };
  } catch (err) {
    structuredLog("error", "applyTenantInvoicePayment failed", { invoiceId, error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
}

// ─── PAYNOW INITIATE / POLL / WEBHOOK ──────────────────────────────────────────

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

function publicResultUrl(): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/api/public/billing/paynow-result`;
}

export interface InitiateTenantInvoicePaynowInput {
  invoiceId: string;
  method: string; // ecocash | onemoney | innbucks | omari | visa_mastercard
  payerPhone?: string;
  payerEmail?: string;
  returnUrl: string;
}

export async function initiatePaynowForInvoice(input: InitiateTenantInvoicePaynowInput): Promise<{
  ok: boolean;
  redirectUrl?: string;
  pollUrl?: string;
  error?: string;
}> {
  const config = getPaynowConfig();
  if (!config.enabled) return { ok: false, error: "Payments are not configured" };

  const [invoice] = await cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.id, input.invoiceId)).limit(1);
  if (!invoice) return { ok: false, error: "Invoice not found" };
  if (invoice.status === "paid") return { ok: false, error: "Invoice already paid" };
  if (invoice.status === "void") return { ok: false, error: "Invoice is void" };

  const resultUrl = publicResultUrl();
  const method = (input.method || "visa_mastercard").toLowerCase();
  const remoteMethods = ["ecocash", "onemoney", "innbucks", "omari"];
  const isRemote = remoteMethods.includes(method) && !!input.payerPhone;

  let params: Record<string, string>;
  let url: string;
  if (isRemote) {
    params = buildRemoteParams(invoice.merchantReference!, String(invoice.amount), input.returnUrl, resultUrl, config.integrationId, input.payerEmail || "", method, input.payerPhone!);
    url = PAYNOW_REMOTE_URL;
  } else {
    params = buildInitParams(invoice.merchantReference!, String(invoice.amount), input.returnUrl, resultUrl, config.integrationId, input.payerEmail);
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
    structuredLog("error", "Tenant billing PayNow initiate failed", { invoiceId: invoice.id, error: (err as Error).message });
    return { ok: false, error: "Payment gateway unavailable" };
  }

  const text = await res.text();
  const parsed = new URLSearchParams(text);
  const status = parsed.get("status") ?? "";
  const pollUrl = parsed.get("pollurl") ?? undefined;
  const redirectUrl = parsed.get("browserurl") ?? parsed.get("redirecturl") ?? undefined;

  if (status.toLowerCase() !== "ok") {
    const errMsg = parsed.get("error") ?? text.slice(0, 200);
    structuredLog("warn", "Tenant billing PayNow init non-OK", { invoiceId: invoice.id, status, error: errMsg });
    return { ok: false, error: errMsg || "Initiation failed" };
  }

  await cpDb.update(tenantInvoices).set({ paynowPollUrl: pollUrl ?? null, paynowStatus: "pending", updatedAt: new Date() }).where(eq(tenantInvoices.id, invoice.id));

  return { ok: true, redirectUrl, pollUrl };
}

export async function pollInvoiceStatus(invoiceId: string): Promise<{ status: string; paid?: boolean; error?: string }> {
  const [invoice] = await cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.id, invoiceId)).limit(1);
  if (!invoice) return { status: "unknown", error: "Invoice not found" };
  if (invoice.status === "paid") return { status: "paid", paid: true };
  if (!invoice.paynowPollUrl) return { status: invoice.status, error: "No poll URL — initiate a payment first" };

  try {
    const res = await fetch(invoice.paynowPollUrl, { method: "POST", body: "", signal: AbortSignal.timeout(PAYNOW_POLL_TIMEOUT_MS) });
    const text = await res.text();
    const parsed = new URLSearchParams(text);
    const status = (parsed.get("status") ?? "").toLowerCase();
    if (!verifyPaynowHash(Object.fromEntries(parsed))) {
      structuredLog("warn", "Tenant billing PayNow poll hash mismatch", { invoiceId });
      return { status: invoice.status, error: "Verifying payment with gateway..." };
    }
    await cpDb.update(tenantInvoices).set({ paynowStatus: status, updatedAt: new Date() }).where(eq(tenantInvoices.id, invoiceId));

    if (isPaynowPaidStatus(status)) {
      const applied = await applyTenantInvoicePayment(invoiceId, { source: "paynow" });
      if (!applied.ok) return { status: "paid_pending_apply", paid: false, error: applied.error };
      return { status: "paid", paid: true };
    }
    if (isPaynowFailedStatus(status)) return { status: "failed" };
    return { status: invoice.status };
  } catch (err) {
    return { status: invoice.status, error: (err as Error).message };
  }
}

/** PayNow result webhook. Always returns ok:true unless the hash itself is invalid — mirrors handlePaynowResult's tolerance for unknown/late statuses. */
export async function handleTenantBillingPaynowResult(postedFields: Record<string, string>): Promise<{ ok: boolean; reason?: string }> {
  const reference = postedFields.reference ?? postedFields.merchantreference;
  const status = (postedFields.status ?? "").toLowerCase();
  if (!reference) return { ok: false, reason: "Missing reference" };

  if (!verifyPaynowHash(postedFields)) {
    structuredLog("warn", "Tenant billing PayNow result hash mismatch", { reference, status });
    return { ok: false, reason: "Invalid hash" };
  }

  const [invoice] = await cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.merchantReference, reference)).limit(1);
  if (!invoice) {
    structuredLog("warn", "Tenant billing PayNow result: unknown reference", { reference });
    return { ok: true };
  }
  if (invoice.status === "paid") return { ok: true };

  await cpDb.update(tenantInvoices).set({ paynowStatus: status, updatedAt: new Date() }).where(eq(tenantInvoices.id, invoice.id));

  if (isPaynowPaidStatus(status)) {
    const applied = await applyTenantInvoicePayment(invoice.id, { source: "paynow" });
    if (!applied.ok) structuredLog("error", "Tenant billing webhook apply failed", { invoiceId: invoice.id, error: applied.error });
  }
  return { ok: true };
}
