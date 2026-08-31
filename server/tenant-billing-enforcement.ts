/**
 * Revenue-share enforcement (Phase 4):
 *  - the per-tenant outstanding-fee cap ("unpaid platform fees may not exceed $X") — when a
 *    revenue-share tenant's unpaid + accrued fees pass the cap, bill immediately and block access
 *  - settlement reconciliation — once a revenue-share invoice is paid, mark the matching
 *    platform_receivables in the tenant's own DB as settled and drop an audit-trail entry
 *
 * Cross-DB by nature (control plane holds invoices, the tenant DB holds the receivables ledger),
 * so everything here is best-effort and idempotent, run outside the payment transaction — the
 * same shape as tenant-db-commissioning.
 */
import { and, eq, lte, sql } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
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
import { getFxToUsdMap, getReceiptedCollectionsByCurrency } from "./tenant-billing-usage";
import { resolveEffectivePricing, computeRevenueShareInvoice } from "./billing-model-math";
import { invalidateTenantActiveCache } from "./auth";
import { invalidateTenantModuleCache } from "./module-gate";
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

/** Sum of a tenant's unpaid billing exposure in USD (all open invoices for the subscription). */
export async function unpaidInvoiceExposureUsd(subscriptionId: string): Promise<number> {
  const [row] = await cpDb
    .select({ total: sql<string>`coalesce(sum(${tenantInvoices.amount}), '0')` })
    .from(tenantInvoices)
    .where(and(eq(tenantInvoices.subscriptionId, subscriptionId), eq(tenantInvoices.status, "open")));
  return parseFloat(row?.total ?? "0");
}

/**
 * Outstanding-fee-cap enforcement for one revenue-share subscription. When unpaid invoices +
 * fees accrued since the last settlement exceed the effective cap: raise an immediate
 * revenue-share invoice for the accrued portion, advance lastSettlementAt, and suspend the tenant
 * (paying the invoice restores access). Returns true if it fired.
 */
export async function enforceOutstandingFeeCap(
  sub: TenantSubscription,
  plan: BillingPlan,
  settingsInput: Record<string, unknown>,
): Promise<boolean> {
  const settings = {
    defaultOutstandingFeeCapUsd: (settingsInput.defaultOutstandingFeeCapUsd as string | null | undefined) ?? null,
    platformFeeRatePercent: (settingsInput.platformFeeRatePercent as string | null | undefined) ?? null,
    defaultMonthlyMinimumUsd: (settingsInput.defaultMonthlyMinimumUsd as string | null | undefined) ?? null,
  };
  const capRaw = sub.outstandingFeeCapUsd ?? settings.defaultOutstandingFeeCapUsd ?? null;
  if (capRaw == null) return false;
  const cap = parseFloat(String(capRaw));
  if (!Number.isFinite(cap) || cap <= 0) return false;

  const pricing = resolveEffectivePricing(plan, [], sub, {
    platformFeeRatePercent: settings.platformFeeRatePercent ?? null,
    defaultMonthlyMinimumUsd: settings.defaultMonthlyMinimumUsd ?? null,
    defaultOutstandingFeeCapUsd: settings.defaultOutstandingFeeCapUsd ?? null,
  });
  if (pricing.billingModel !== "revenue_share") return false;

  const now = new Date();
  const since = sub.lastSettlementAt ?? sub.currentPeriodStart ?? new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const [collections, fx] = await Promise.all([
    getReceiptedCollectionsByCurrency(sub.tenantId, since, now),
    getFxToUsdMap(sub.tenantId),
  ]);
  // Accrued fee WITHOUT the monthly-minimum floor — the cap is about real accrual, not the floor.
  const rawAccrual = computeRevenueShareInvoice({ ...pricing, monthlyMinimumUsd: "0" }, collections, fx);
  const accruedUsd = parseFloat(rawAccrual.amountUsd);
  const unpaidUsd = await unpaidInvoiceExposureUsd(sub.id);

  if (unpaidUsd + accruedUsd <= cap) return false;

  structuredLog("warn", "Outstanding-fee cap exceeded — billing immediately and blocking", {
    tenantId: sub.tenantId, cap, unpaidUsd, accruedUsd,
  });

  await cpDb.transaction(async (tx) => {
    if (accruedUsd > 0) {
      await tx.insert(tenantInvoices).values({
        tenantId: sub.tenantId,
        subscriptionId: sub.id,
        planId: plan.id,
        kind: "revenue_share",
        amount: money(accruedUsd),
        currency: "USD",
        status: "open",
        lineItems: [
          ...rawAccrual.lineItems,
          { label: `Billed early — unpaid platform fees reached the $${money(cap)} limit`, amount: "0.00" },
        ],
        periodStart: since,
        periodEnd: now,
        dueDate: now,
        paymentToken: crypto.randomBytes(24).toString("hex"),
        merchantReference: generateMerchantReference(sub.tenantId),
      });
      await tx.update(tenantSubscriptions).set({ lastSettlementAt: now, updatedAt: now }).where(eq(tenantSubscriptions.id, sub.id));
    }
    await tx.update(tenantSubscriptions).set({ status: "suspended", updatedAt: now }).where(eq(tenantSubscriptions.id, sub.id));
    const graceDays = Number((settingsInput.deletionGraceDays as number | undefined) ?? 30) || 30;
    await tx.update(cpTenants).set({
      isActive: false,
      licenseStatus: "suspended",
      suspendedAt: now,
      suspendReason: `Unpaid platform fees exceeded the $${money(cap)} limit`,
      viewOnlyGraceUntil: new Date(now.getTime() + graceDays * 24 * 60 * 60 * 1000),
    }).where(eq(cpTenants.id, sub.tenantId));
    await tx.insert(tenantBillingEvents).values({
      tenantId: sub.tenantId,
      type: "outstanding_cap_exceeded",
      detail: { cap: money(cap), unpaidUsd: money(unpaidUsd), accruedUsd: money(accruedUsd) },
    });
  });

  invalidateTenantActiveCache(sub.tenantId);
  invalidateTenantModuleCache(sub.tenantId);
  return true;
}

/**
 * After a revenue-share (or cap-triggered) invoice is paid: settle the matching unsettled
 * platform_receivables rows in the tenant's own DB (everything accrued up to the invoice's cut)
 * and leave an audit-trail entry so the settlement is visible in the tenant's books. Idempotent —
 * a second call finds nothing left unsettled.
 */
export async function reconcileRevenueShareSettlement(invoice: TenantInvoice): Promise<void> {
  if (invoice.kind !== "revenue_share" && invoice.kind !== "subscription") return;
  const cutoff = invoice.periodEnd ?? invoice.paidAt ?? invoice.issuedAt;
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
