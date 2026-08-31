/**
 * Platform revenue-share rate resolution. Was previously a bare 0.025 literal
 * duplicated at every call site — now settings-backed: per-tenant override
 * (tenantSubscriptions.platformFeeRateOverride) wins, else the global default
 * (billingSettings.platformFeeRatePercent), else 2.5% if no settings row exists
 * yet (matches the old hardcoded behavior, so this is a safe no-op until someone
 * actually changes the rate from the platform billing console).
 */
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantSubscriptions, billingPlans, billingSettings } from "@shared/control-plane-schema";

const DEFAULT_PLATFORM_FEE_RATE_PERCENT = 2.5;

// ── Billing-model gate for platform-fee accrual ──────────────────────────────
// platform_receivables should only accrue for tenants actually billed on revenue-share —
// otherwise every flat/per-policy tenant piles up unsettled 2.5% rows that are never invoiced.
// Cached (5-min TTL, same pattern as the rest of this file); invalidate on a subscription change.
const revShareCache = new Map<string, { value: boolean; at: number }>();
const REV_SHARE_TTL_MS = 5 * 60 * 1000;

export function invalidateBillingModelCache(orgId: string): void {
  revShareCache.delete(orgId);
}

export async function isRevenueShareBillingForOrg(orgId: string): Promise<boolean> {
  const cached = revShareCache.get(orgId);
  if (cached && Date.now() - cached.at < REV_SHARE_TTL_MS) return cached.value;
  try {
    const [row] = await cpDb
      .select({ override: tenantSubscriptions.billingModelOverride, planModel: billingPlans.billingModel })
      .from(tenantSubscriptions)
      .leftJoin(billingPlans, eq(billingPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, orgId))
      .limit(1);
    const model = row?.override || row?.planModel || "flat";
    const value = model === "revenue_share";
    revShareCache.set(orgId, { value, at: Date.now() });
    return value;
  } catch {
    // Control plane unreachable — fail toward accruing (same fail-open stance as the rate lookup
    // below), so a revenue-share tenant never silently loses accrual during a transient outage.
    return true;
  }
}

export async function getPlatformFeeRatePercent(orgId: string): Promise<number> {
  const [sub] = await cpDb
    .select({ rate: tenantSubscriptions.platformFeeRateOverride })
    .from(tenantSubscriptions)
    .where(eq(tenantSubscriptions.tenantId, orgId))
    .limit(1);
  if (sub?.rate != null) return parseFloat(sub.rate);

  const [settings] = await cpDb.select({ rate: billingSettings.platformFeeRatePercent }).from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
  if (settings?.rate != null) return parseFloat(settings.rate);

  return DEFAULT_PLATFORM_FEE_RATE_PERCENT;
}

export async function computePlatformFee(orgId: string, amount: number | string): Promise<string> {
  const rate = await getPlatformFeeRatePercent(orgId);
  const base = typeof amount === "string" ? parseFloat(amount) : amount;
  return ((base * rate) / 100).toFixed(2);
}
