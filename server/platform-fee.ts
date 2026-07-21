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
import { tenantSubscriptions, billingSettings } from "@shared/control-plane-schema";

const DEFAULT_PLATFORM_FEE_RATE_PERCENT = 2.5;

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
