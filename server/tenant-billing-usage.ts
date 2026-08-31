/**
 * Reads the raw usage numbers a model-aware tenant invoice needs, straight from the tenant's OWN
 * database (getDbForOrg) — policy counts for the per_policy model, receipted collections by
 * currency for revenue_share. Kept separate from tenant-billing-service.ts so the control-plane
 * billing path has exactly one seam into tenant data.
 *
 * Flat-plan tenants never reach any of this — generateInvoiceForSubscription only calls in when
 * the resolved billing model is per_policy or revenue_share.
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { policies, paymentReceipts, serviceReceipts } from "@shared/schema";

/**
 * Live policy count per status, excluding soft-deleted rows. Keys are the RAW database status
 * values ("active", "lapsed", "archived", …) so they line up with billing_model-math's rate map.
 */
export async function getPolicyStatusCounts(orgId: string): Promise<Record<string, number>> {
  const tdb = await getDbForOrg(orgId);
  const rows = await tdb
    .select({ status: policies.status, count: sql<number>`count(*)::int` })
    .from(policies)
    .where(and(eq(policies.organizationId, orgId), isNull(policies.deletedAt)))
    .groupBy(policies.status);

  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = Number(r.count);
  return out;
}

/**
 * Sum of issued premium receipts + issued service receipts per currency, over [since, until).
 * This is the revenue-share base — "all payments received and receipted through the system",
 * every currency, matching what the tenant's own revenue reports show for the same window.
 */
export async function getReceiptedCollectionsByCurrency(
  orgId: string,
  since: Date,
  until: Date,
): Promise<Record<string, number>> {
  const tdb = await getDbForOrg(orgId);
  const out: Record<string, number> = {};

  const premiumRows = await tdb
    .select({
      currency: paymentReceipts.currency,
      total: sql<string>`coalesce(sum(${paymentReceipts.amount}), '0')`,
    })
    .from(paymentReceipts)
    .where(and(
      eq(paymentReceipts.organizationId, orgId),
      eq(paymentReceipts.status, "issued"),
      isNull(paymentReceipts.deletedAt),
      gte(paymentReceipts.issuedAt, since),
      lt(paymentReceipts.issuedAt, until),
    ))
    .groupBy(paymentReceipts.currency);
  for (const r of premiumRows) {
    out[r.currency.toUpperCase()] = (out[r.currency.toUpperCase()] ?? 0) + parseFloat(r.total);
  }

  const serviceRows = await tdb
    .select({
      currency: serviceReceipts.currency,
      total: sql<string>`coalesce(sum(${serviceReceipts.amount}), '0')`,
    })
    .from(serviceReceipts)
    .where(and(
      eq(serviceReceipts.organizationId, orgId),
      eq(serviceReceipts.status, "issued"),
      gte(serviceReceipts.issuedAt, since),
      lt(serviceReceipts.issuedAt, until),
    ))
    .groupBy(serviceReceipts.currency);
  for (const r of serviceRows) {
    out[r.currency.toUpperCase()] = (out[r.currency.toUpperCase()] ?? 0) + parseFloat(r.total);
  }

  return out;
}

/** currency code → multiplier to USD (USD itself is 1). Mirrors financial-statements.fxMapFor. */
export async function getFxToUsdMap(orgId: string): Promise<Record<string, number>> {
  const rates = await storage.getFxRates(orgId);
  const map: Record<string, number> = { USD: 1 };
  for (const r of rates) {
    const rate = parseFloat(String(r.rateToUsd));
    if (Number.isFinite(rate) && rate > 0) map[r.currency.toUpperCase()] = rate;
  }
  return map;
}
