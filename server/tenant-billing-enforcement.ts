/**
 * Revenue-share enforcement (Phase 4):
 *  - the per-tenant outstanding-fee cap ("unpaid platform fees may not exceed $X") — a "bill
 *    early" control: raises an invoice for the uninvoiced accrual when unpaid fees pass the cap,
 *    so fees don't run up unseen. It does NOT suspend — the normal past-due → grace → suspend
 *    path handles that on the invoice due date.
 *  - settlement reconciliation — once a revenue-share invoice is paid, mark the matching
 *    platform_receivables in the tenant's own DB as settled and drop an audit-trail entry
 *
 * Cross-DB by nature (control plane holds invoices, the tenant DB holds the receivables ledger),
 * so everything here is best-effort and idempotent, run outside the payment transaction — the
 * same shape as tenant-db-commissioning.
 */
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import {
  billingPlans,
  billingSettings,
  tenantSubscriptions,
  tenantInvoices,
  tenantBillingEvents,
  type TenantSubscription,
  type BillingPlan,
  type TenantInvoice,
} from "@shared/control-plane-schema";
import { platformReceivables, auditLogs } from "@shared/schema";
import { getDbForOrg } from "./tenant-db";
import { getFxToUsdMap, getUnsettledPlatformFeesByCurrency } from "./tenant-billing-usage";
import { resolveEffectivePricing, computeRevenueShareInvoiceFromFees } from "./billing-model-math";
import { structuredLog } from "./logger";
import crypto from "crypto";

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? "0"));
  return (Math.round((Number.isFinite(n) ? n : 0) * 100 + Number.EPSILON) / 100).toFixed(2);
};

function generateMerchantReference(orgId: string): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `BILL-${orgId.slice(0, 8)}-${date}-${crypto.randomBytes(4).toString("hex")}`;
}

/** Sum of a tenant's open revenue-share / subscription invoice amounts in USD. */
async function openFeeInvoiceTotalUsd(subscriptionId: string): Promise<number> {
  const [row] = await cpDb
    .select({ total: sql<string>`coalesce(sum(${tenantInvoices.amount}), '0')` })
    .from(tenantInvoices)
    .where(and(
      eq(tenantInvoices.subscriptionId, subscriptionId),
      eq(tenantInvoices.status, "open"),
      inArray(tenantInvoices.kind, ["revenue_share", "subscription"]),
    ));
  return parseFloat(row?.total ?? "0");
}

/**
 * Outstanding-fee-cap enforcement for one revenue-share subscription. The cap is a "bill early"
 * control, NOT a "suspend early" one: when a tenant's unpaid fees (open invoices + still-uninvoiced
 * accrual) pass the effective cap, this raises a revenue-share invoice for the uninvoiced portion
 * so fees don't run up invisibly. The invoice carries the normal grace-period due date; suspension
 * still only happens through the usual past-due → grace → suspend path. Returns the invoice it
 * raised (for the caller to email), or null if nothing was billed.
 */
export async function enforceOutstandingFeeCap(
  sub: TenantSubscription,
  plan: BillingPlan,
  settingsInput: Record<string, unknown>,
): Promise<TenantInvoice | null> {
  const settings = {
    defaultOutstandingFeeCapUsd: (settingsInput.defaultOutstandingFeeCapUsd as string | null | undefined) ?? null,
    platformFeeRatePercent: (settingsInput.platformFeeRatePercent as string | null | undefined) ?? null,
    defaultMonthlyMinimumUsd: (settingsInput.defaultMonthlyMinimumUsd as string | null | undefined) ?? null,
  };
  const capRaw = sub.outstandingFeeCapUsd ?? settings.defaultOutstandingFeeCapUsd ?? null;
  if (capRaw == null) return null;
  const cap = parseFloat(String(capRaw));
  if (!Number.isFinite(cap) || cap <= 0) return null;

  const pricing = resolveEffectivePricing(plan, [], sub, {
    platformFeeRatePercent: settings.platformFeeRatePercent ?? null,
    defaultMonthlyMinimumUsd: settings.defaultMonthlyMinimumUsd ?? null,
    defaultOutstandingFeeCapUsd: settings.defaultOutstandingFeeCapUsd ?? null,
  });
  if (pricing.billingModel !== "revenue_share") return null;

  const now = new Date();
  const graceDays = Number((settingsInput.graceDays as number | undefined) ?? sub.graceDaysOverride ?? 7) || 7;

  // Accrued = unsettled platform_receivables (the single ledger) in USD, no minimum floor.
  const [{ byCurrency }, fx] = await Promise.all([
    getUnsettledPlatformFeesByCurrency(sub.tenantId),
    getFxToUsdMap(sub.tenantId),
  ]);
  const rawAccrual = computeRevenueShareInvoiceFromFees({ ...pricing, monthlyMinimumUsd: "0" }, byCurrency, fx);
  const accruedUsd = parseFloat(rawAccrual.amountUsd);
  const openInvoicedUsd = await openFeeInvoiceTotalUsd(sub.id);
  // The unsettled ledger already includes whatever an open invoice covers (receivables settle
  // only on payment), so the not-yet-invoiced part is the excess over what's already billed.
  const uninvoicedAccrualUsd = Math.max(0, accruedUsd - openInvoicedUsd);
  const exposureUsd = openInvoicedUsd + uninvoicedAccrualUsd;

  if (exposureUsd <= cap || uninvoicedAccrualUsd < 0.01) return null;

  structuredLog("warn", "Outstanding-fee cap exceeded — raising an early invoice (no suspension)", {
    tenantId: sub.tenantId, cap, openInvoicedUsd, uninvoicedAccrualUsd,
  });

  const raised = await cpDb.transaction(async (tx) => {
    const [row] = await tx.insert(tenantInvoices).values({
      tenantId: sub.tenantId,
      subscriptionId: sub.id,
      planId: plan.id,
      kind: "revenue_share",
      amount: money(uninvoicedAccrualUsd),
      currency: "USD",
      status: "open",
      lineItems: [
        ...rawAccrual.lineItems,
        { label: `Billed now because unpaid platform fees passed the $${money(cap)} limit`, amount: "0.00" },
      ],
      periodStart: sub.lastSettlementAt ?? sub.currentPeriodStart,
      periodEnd: now,
      usageCutAt: now,
      dueDate: new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000),
      paymentToken: crypto.randomBytes(24).toString("hex"),
      merchantReference: generateMerchantReference(sub.tenantId),
    }).returning();
    await tx.update(tenantSubscriptions).set({ lastSettlementAt: now, updatedAt: now }).where(eq(tenantSubscriptions.id, sub.id));
    await tx.insert(tenantBillingEvents).values({
      tenantId: sub.tenantId,
      type: "outstanding_cap_exceeded",
      detail: { cap: money(cap), openInvoicedUsd: money(openInvoicedUsd), billedNowUsd: money(uninvoicedAccrualUsd), dueInDays: graceDays },
    });
    return row;
  });

  return raised;
}

/**
 * After a revenue-share (or cap-triggered) invoice is paid: settle the matching unsettled
 * platform_receivables rows in the tenant's own DB (everything accrued up to the invoice's cut)
 * and leave an audit-trail entry so the settlement is visible in the tenant's books. Idempotent —
 * a second call finds nothing left unsettled.
 */
export async function reconcileRevenueShareSettlement(invoice: TenantInvoice): Promise<void> {
  if (invoice.kind !== "revenue_share" && invoice.kind !== "subscription") return;
  // The exact instant this invoice tallied the ledger — settle nothing accrued after it, so a
  // later invoice generated before this one was paid keeps its own receivables.
  const cutoff = invoice.usageCutAt ?? invoice.periodEnd ?? invoice.paidAt ?? invoice.issuedAt;
  if (!cutoff) return;

  try {
    // Only act when the tenant is actually on revenue-share billing.
    const [sub] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.id, invoice.subscriptionId ?? "")).limit(1);
    if (!sub) return;
    const [plan] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, sub.planId)).limit(1);
    const [settings] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    if (!plan) return;
    const pricing = resolveEffectivePricing(plan, [], sub, {
      platformFeeRatePercent: settings?.platformFeeRatePercent ?? null,
      defaultMonthlyMinimumUsd: settings?.defaultMonthlyMinimumUsd ?? null,
      defaultOutstandingFeeCapUsd: settings?.defaultOutstandingFeeCapUsd ?? null,
    });
    if (pricing.billingModel !== "revenue_share") return;

    const tdb = await getDbForOrg(invoice.tenantId);
    const unsettled = await tdb
      .select({ id: platformReceivables.id, amount: platformReceivables.amount, currency: platformReceivables.currency })
      .from(platformReceivables)
      .where(and(
        eq(platformReceivables.organizationId, invoice.tenantId),
        eq(platformReceivables.isSettled, false),
        lte(platformReceivables.createdAt, cutoff),
      ));
    if (unsettled.length === 0) return;

    const byCurrency: Record<string, number> = {};
    for (const r of unsettled) byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + parseFloat(r.amount);

    await tdb.update(platformReceivables)
      .set({ isSettled: true })
      .where(and(
        eq(platformReceivables.organizationId, invoice.tenantId),
        eq(platformReceivables.isSettled, false),
        lte(platformReceivables.createdAt, cutoff),
      ));

    await tdb.insert(auditLogs).values({
      organizationId: invoice.tenantId,
      actorEmail: "billing@pol263.com",
      action: "PLATFORM_FEE_SETTLED",
      entityType: "TenantInvoice",
      entityId: invoice.id,
      before: null,
      after: {
        invoiceAmountUsd: invoice.amount,
        receivablesSettled: unsettled.length,
        byCurrency: Object.fromEntries(Object.entries(byCurrency).map(([k, v]) => [k, money(v)])),
        paidAt: invoice.paidAt,
        merchantReference: invoice.merchantReference,
      },
    });

    structuredLog("info", "Revenue-share settlement reconciled", {
      tenantId: invoice.tenantId, invoiceId: invoice.id, receivablesSettled: unsettled.length,
    });
  } catch (err) {
    structuredLog("error", "reconcileRevenueShareSettlement failed", { invoiceId: invoice.id, error: (err as Error).message });
  }
}
