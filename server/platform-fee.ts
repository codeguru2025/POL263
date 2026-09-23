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
import { structuredLog } from "./logger";

const DEFAULT_PLATFORM_FEE_RATE_PERCENT = 2.5;

// ── Billing-model gate for platform-fee accrual ──────────────────────────────
// platform_receivables should only accrue for tenants actually billed on revenue-share —
// otherwise every flat/per-policy tenant piles up unsettled 2.5% rows that are never invoiced.
// Cached (5-min TTL, same pattern as the rest of this file); invalidate on a subscription change.
const revShareCache = new Map<string, { value: boolean; at: number }>();
const REV_SHARE_TTL_MS = 5 * 60 * 1000;
// Separate from revShareCache above: never expires, only updated on a SUCCESSFUL lookup — used
// only as the fallback when the control plane is unreachable, so a transient outage fails toward
// this tenant's actual last-known billing model instead of unconditionally assuming revenue-share.
const lastKnownGood = new Map<string, boolean>();

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
    lastKnownGood.set(orgId, value);
    return value;
  } catch (err) {
    // Control plane unreachable — fail toward this tenant's own last confirmed billing model
    // (NOT unconditionally "revenue-share"), so a transient outage can't make a flat/per-policy
    // tenant accrue phantom, never-invoiced platform_receivables. Only defaults to true when we've
    // truly never resolved this org before (first request ever hits an outage) — accruing then
    // reconciling later is the safer failure than silently dropping a real revenue-share tenant's
    // fees, and this case is rare (every active org is resolved successfully on its first request
    // in the overwhelming majority of cases).
    const fallback = lastKnownGood.get(orgId);
    structuredLog("error", "isRevenueShareBillingForOrg: control plane lookup failed, using fallback", {
      orgId, fallback: fallback ?? "none (defaulting to true)", error: (err as Error)?.message,
    });
    return fallback ?? true;
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
