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
import { eq, and, desc } from "drizzle-orm";
import crypto from "crypto";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
  billingPlans,
  billingFeatures,
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
import {
  resolveEffectivePricing,
  computePerPolicyInvoice,
  computeRevenueShareInvoiceFromFees,
  type GlobalBillingDefaults,
} from "./billing-model-math";
import { getPolicyStatusCounts, getUnsettledPlatformFeesByCurrency, getFxToUsdMap } from "./tenant-billing-usage";
import { verifyPaynowHash, generatePaynowHash } from "./paynow-hash";
import { invalidateTenantActiveCache } from "./auth";
import { invalidateTenantModuleCache, getTenantModuleSet } from "./module-gate";
import { structuredLog } from "./logger";
import { sendRestoredEmail, sendInvoiceReminderEmail, sendInvoicePaidReceiptEmail } from "./tenant-billing-email";
import { commissionDedicatedTenantDatabase } from "./tenant-db-commissioning";

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
  return {
    id: "global", trialDays: 14, graceDays: 7, reminderLeadDays: 3, moduleEnforcementEnabled: false,
    platformFeeRatePercent: "2.50", defaultMonthlyMinimumUsd: "250.00", defaultOutstandingFeeCapUsd: null,
    deletionGraceDays: 30, hardDeleteEnabled: false, updatedAt: new Date(),
  };
}

export { getEffectiveGraceDays, addBillingCycle } from "./tenant-billing-math";

// ─── INVOICE GENERATION ─────────────────────────────────────────────────────────

/** 2-dp money string from any numeric-ish input. */
function money(v: unknown): string {
  const n = parseFloat(String(v ?? "0"));
  return (Math.round((Number.isFinite(n) ? n : 0) * 100 + Number.EPSILON) / 100).toFixed(2);
}

function generateMerchantReference(orgId: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = crypto.randomBytes(4).toString("hex");
  return `BILL-${orgId.slice(0, 8)}-${date}-${rand}`;
}

/** Global billing defaults (billing_settings singleton) that plan/subscription values fall back to. */
async function getGlobalBillingDefaults(): Promise<GlobalBillingDefaults> {
  const [row] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
  return {
    platformFeeRatePercent: row?.platformFeeRatePercent ?? null,
    defaultMonthlyMinimumUsd: row?.defaultMonthlyMinimumUsd ?? null,
    defaultOutstandingFeeCapUsd: row?.defaultOutstandingFeeCapUsd ?? null,
  };
}

/**
 * The tenant's purchasable billing features = the active billing_features catalog rows whose key
 * the tenant actually has enabled (getTenantModuleSet). Their price deltas stack onto the plan's
 * base fee / per-policy rate / revenue-share percent — so "revenue share depends on the features
 * chosen", without a bespoke plan per combination. Explicit per-tenant feature overrides land in
 * Phase 1c; today the enabled-module set is the binding.
 */
async function resolveTenantBillingFeatures(orgId: string) {
  const moduleSet = await getTenantModuleSet(orgId);
  if (!moduleSet.size) return [];
  const rows = await cpDb.select().from(billingFeatures).where(eq(billingFeatures.isActive, true));
  return rows.filter((f) => moduleSet.has(f.key));
}

/**
 * Idempotent per subscription+period: if an open invoice already exists for this
 * subscription's currentPeriodEnd, returns it (created:false) instead of creating
 * a duplicate. Callers (the sweep) use `created` to decide whether to send a
 * reminder email — only on first generation, not on every idempotent re-check.
 *
 * The invoice amount depends on the tenant's billing model (billing-model-math.ts):
 *   flat          — plan.priceMonthlyUsd (unchanged)
 *   per_policy    — base fee + per-status $/policy on the overage, floored at the monthly minimum;
 *                   policy counts read live from the tenant DB
 *   revenue_share — X% of receipted collections per currency since the last settlement, converted
 *                   to USD, floored at the minimum
 * For the two usage models `lastSettlementAt` is advanced to the cut time in the same transaction,
 * so the next period bills only fresh activity.
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

  const [features, globals] = await Promise.all([
    resolveTenantBillingFeatures(subscription.tenantId),
    getGlobalBillingDefaults(),
  ]);
  const pricing = resolveEffectivePricing(plan, features, subscription, globals);

  const now = new Date();
  let amount: string;
  let lineItems: Array<{ label: string; amount: string; currency?: string; nativeAmount?: string }> | undefined;
  const eventDetail: Record<string, unknown> = { billingModel: pricing.billingModel };

  if (pricing.billingModel === "per_policy") {
    const counts = await getPolicyStatusCounts(subscription.tenantId);
    const computed = computePerPolicyInvoice(pricing, counts);
    amount = computed.amountUsd;
    lineItems = computed.lineItems;
    eventDetail.policyCounts = counts;
    eventDetail.minimumApplied = computed.minimumApplied;
  } else if (pricing.billingModel === "revenue_share") {
    // Bill the tenant's already-accrued, still-unsettled platform_receivables (the per-receipt
    // 2.5% ledger) — one source of truth, so the invoice and the tenant's own platform-fee
    // balance stay in lockstep. reconcileRevenueShareSettlement settles exactly these on payment.
    const [{ byCurrency, count }, fx] = await Promise.all([
      getUnsettledPlatformFeesByCurrency(subscription.tenantId),
      getFxToUsdMap(subscription.tenantId),
    ]);
    const computed = computeRevenueShareInvoiceFromFees(pricing, byCurrency, fx);
    amount = computed.amountUsd;
    lineItems = computed.lineItems;
    eventDetail.unsettledFeeCount = count;
    eventDetail.feesByCurrency = byCurrency;
    eventDetail.currencyBreakdown = computed.currencyBreakdown;
    eventDetail.minimumApplied = computed.minimumApplied;
    if (computed.skippedCurrencies && computed.skippedCurrencies.length > 0) {
      eventDetail.skippedCurrenciesNoFxRate = computed.skippedCurrencies;
      structuredLog("warn", "Revenue-share invoice excluded currencies with no configured FX rate — fees left unsettled for next cycle", {
        tenantId: subscription.tenantId, skippedCurrencies: computed.skippedCurrencies,
      });
    }
  } else {
    amount = computeInvoiceAmount(plan.priceMonthlyUsd, subscription.billingCycle);
  }

  const invoice = await cpDb.transaction(async (tx) => {
    const [row] = await tx
      .insert(tenantInvoices)
      .values({
        tenantId: subscription.tenantId,
        subscriptionId: subscription.id,
        planId: plan.id,
        kind: "subscription",
        amount,
        lineItems,
        currency: "USD",
        status: "open",
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
        usageCutAt: pricing.billingModel === "flat" ? null : now,
        dueDate: subscription.currentPeriodEnd,
        paymentToken: crypto.randomBytes(24).toString("hex"),
        merchantReference: generateMerchantReference(subscription.tenantId),
      })
      .returning();

    await tx.insert(tenantBillingEvents).values({
      tenantId: subscription.tenantId,
      invoiceId: row.id,
      type: "invoice_generated",
      detail: { amount: row.amount, periodStart: row.periodStart, periodEnd: row.periodEnd, ...eventDetail },
    });

    // Usage models: mark this cut as the new settlement watermark so the next invoice only counts
    // activity after it. Flat plans have no usage window, so leave lastSettlementAt untouched.
    if (pricing.billingModel !== "flat") {
      await tx.update(tenantSubscriptions)
        .set({ lastSettlementAt: now, updatedAt: now })
        .where(eq(tenantSubscriptions.id, subscription.id));
    }

    return row;
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

      const now = new Date();

      // Setup-fee invoice (0005): a one-time onboarding charge — mark it paid and flip the
      // subscription's setup-fee status, but DON'T touch the billing period or reactivate the
      // tenant (a suspended tenant paying their setup fee stays suspended until the renewal too).
      if (invoice.kind === "setup") {
        await tx.update(tenantInvoices).set({
          status: "paid", paidAt: now,
          markedPaidBy: opts.source === "manual" ? (opts.actorId ?? null) : null,
          notes: opts.note ?? invoice.notes, updatedAt: now,
        }).where(eq(tenantInvoices.id, invoiceId));
        if (invoice.subscriptionId) {
          await tx.update(tenantSubscriptions)
            .set({ setupFeeStatus: "paid", updatedAt: now })
            .where(eq(tenantSubscriptions.id, invoice.subscriptionId));
        }
        await tx.insert(tenantBillingEvents).values({
          tenantId: invoice.tenantId, invoiceId: invoice.id, type: "setup_fee_paid",
          detail: { source: opts.source, amount: invoice.amount },
        });
        return { ok: true as const, tenantId: invoice.tenantId, priorStatus: "active", noPeriodChange: true };
      }

      if (!invoice.subscriptionId || !invoice.planId) {
        return { ok: false as const, error: "Invoice is not linked to a subscription" };
      }

      // Outstanding-fee-cap invoice (enforceOutstandingFeeCap, tenant-billing-enforcement.ts): an
      // early, mid-cycle bill for platform fees that exceeded the cap. Its own periodStart/
      // periodEnd mark the accrual window being billed early — NOT the subscription's renewal
      // cycle — so paying it must not advance currentPeriodEnd (that's what the real periodic
      // "subscription" invoice below does; conflating the two silently pushed the tenant's actual
      // renewal a full cycle later every time a cap invoice was paid). Cap enforcement also never
      // suspends on its own (see that function's docstring), so this doesn't touch tenant active
      // status either — any real suspension is unrelated and stays gated on its own overdue
      // "subscription" invoice. reconcileRevenueShareSettlement (called below, unconditionally)
      // still settles the matching receivables via this invoice's usageCutAt/periodEnd.
      if (invoice.kind === "revenue_share") {
        await tx.update(tenantInvoices).set({
          status: "paid", paidAt: now,
          markedPaidBy: opts.source === "manual" ? (opts.actorId ?? null) : null,
          notes: opts.note ?? invoice.notes, updatedAt: now,
        }).where(eq(tenantInvoices.id, invoiceId));
        await tx.insert(tenantBillingEvents).values({
          tenantId: invoice.tenantId, invoiceId: invoice.id, type: "cap_invoice_paid",
          detail: { source: opts.source, amount: invoice.amount },
        });
        return { ok: true as const, tenantId: invoice.tenantId, priorStatus: "active", noPeriodChange: true };
      }

      // Locked too, not just the invoice row — otherwise two different open invoices for the
      // same subscription paid concurrently would both read the same stale currentPeriodEnd
      // and the second UPDATE would silently overwrite the first's period extension.
      const [subscription] = await tx.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.id, invoice.subscriptionId)).for("update").limit(1);
      if (!subscription) return { ok: false as const, error: "Subscription not found" };
      const [plan] = await tx.select().from(billingPlans).where(eq(billingPlans.id, invoice.planId)).limit(1);
      if (!plan) return { ok: false as const, error: "Plan not found" };

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
        viewOnlyGraceUntil: null,
      }).where(eq(cpTenants.id, subscription.tenantId));

      await tx.insert(tenantBillingEvents).values({
        tenantId: subscription.tenantId,
        invoiceId: invoice.id,
        type: opts.source === "manual" ? "manual_mark_paid" : "auto_restored",
        detail: { source: opts.source, actorId: opts.actorId ?? null, newPeriodEnd: cycleEnd },
      });

      // First time this subscription becomes active (trial → paid, or a late first payment) and a
      // setup fee is still owed → raise the one-time setup invoice now. Not retroactive: only
      // subscriptions provisioned with setupFeeStatus='pending' ever reach here.
      let setupInvoiceRaised = false;
      if (subscription.status !== "active" && subscription.setupFeeStatus === "pending") {
        const setupFeeUsd = money(
          subscription.setupFeeOverrideUsd ?? plan.setupFeeUsd ?? plan.priceMonthlyUsd,
        );
        if (parseFloat(setupFeeUsd) > 0) {
          await tx.insert(tenantInvoices).values({
            tenantId: subscription.tenantId,
            subscriptionId: subscription.id,
            planId: plan.id,
            kind: "setup",
            amount: setupFeeUsd,
            currency: "USD",
            status: "open",
            lineItems: [{ label: "One-time account setup fee", amount: setupFeeUsd }],
            dueDate: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
            paymentToken: crypto.randomBytes(24).toString("hex"),
            merchantReference: generateMerchantReference(subscription.tenantId),
          });
          await tx.update(tenantSubscriptions)
            .set({ setupFeeStatus: "invoiced", updatedAt: now })
            .where(eq(tenantSubscriptions.id, subscription.id));
          setupInvoiceRaised = true;
        } else {
          await tx.update(tenantSubscriptions)
            .set({ setupFeeStatus: "waived", updatedAt: now })
            .where(eq(tenantSubscriptions.id, subscription.id));
        }
      }

      return {
        ok: true as const,
        tenantId: subscription.tenantId,
        wasSuspended: subscription.status === "suspended",
        priorStatus: subscription.status,
        setupInvoiceRaised,
      };
    });

    if (!result.ok || (result as any).alreadyPaid) return { ok: result.ok, error: (result as any).error };

    const tenantId = (result as any).tenantId as string;
    const priorStatus = (result as any).priorStatus as string;
    invalidateTenantActiveCache(tenantId);
    invalidateTenantModuleCache(tenantId);

    if (!(result as any).noPeriodChange) {
      sendRestoredEmail(tenantId).catch((err) => structuredLog("error", "sendRestoredEmail failed", { tenantId, error: (err as Error).message }));
    }

    // Branded PDF receipt for the paid invoice + revenue-share settlement reconciliation.
    cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.id, invoiceId)).limit(1)
      .then(async ([paidInv]) => {
        if (!paidInv) return;
        await sendInvoicePaidReceiptEmail(paidInv).catch((err) => structuredLog("error", "sendInvoicePaidReceiptEmail failed", { invoiceId, error: (err as Error).message }));
        const { reconcileRevenueShareSettlement } = await import("./tenant-billing-enforcement");
        await reconcileRevenueShareSettlement(paidInv);
      })
      .catch((err) => structuredLog("error", "post-payment reconciliation failed", { invoiceId, error: (err as Error).message }));

    // A setup-fee invoice was just raised — email it to the tenant admins.
    if ((result as any).setupInvoiceRaised) {
      cpDb.select().from(tenantInvoices)
        .where(and(eq(tenantInvoices.tenantId, tenantId), eq(tenantInvoices.kind, "setup"), eq(tenantInvoices.status, "open")))
        .orderBy(desc(tenantInvoices.issuedAt)).limit(1)
        .then(([setupInv]) => setupInv && sendInvoiceReminderEmail(setupInv))
        .catch((err) => structuredLog("error", "setup-fee invoice email failed", { tenantId, error: (err as Error).message }));
    }

    // First-ever conversion to a paid, working subscription — commission dedicated
    // infrastructure. NOT gated on priorStatus === "trialing" alone: the billing sweep moves a
    // subscription trialing → past_due → suspended before a late-but-still-within-grace-period
    // payment lands, so a tenant who pays a few days late would otherwise never trip this at
    // all. Gating on "not already active" instead covers trial-into-paid, late-within-grace, and
    // recovered-after-suspension alike, while still skipping ordinary renewals (priorStatus
    // already "active") — and commissionDedicatedTenantDatabase's own databaseUrl check makes it
    // a cheap, safe no-op if a dedicated database was already provisioned. Fire-and-forget, never
    // allowed to affect the payment response — see server/tenant-db-commissioning.ts.
    if (priorStatus !== "active") {
      commissionDedicatedTenantDatabase(tenantId).catch((err) =>
        structuredLog("error", "commissionDedicatedTenantDatabase failed", { tenantId, error: (err as Error).message }));
    }

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
