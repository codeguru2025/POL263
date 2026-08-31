/**
 * Pure billing-model math — no DB, no network, no imports beyond types. The daily sweep
 * (server/tenant-billing-service.ts) pulls the raw numbers (policy counts / collected revenue)
 * and calls these to turn them into a monthly invoice amount + a human-readable breakdown.
 * See tests/unit/billing-model-math.test.ts.
 *
 * Models:
 *   flat          — plan.priceMonthlyUsd (unchanged; handled by tenant-billing-math.computeInvoiceAmount)
 *   per_policy     — base fee (covers the first N policies) + Σ per-status rate on the overage,
 *                    then floored at the monthly minimum
 *   revenue_share  — X% of collected revenue per currency, converted to USD, floored at the minimum
 *
 * Feature deltas (billing_features) stack onto the base fee, every per-status rate, and the
 * revenue-share percent — so choosing WhatsApp + SMS + Payments raises the bill without a bespoke
 * plan per combination.
 */
import type { BillingPlan, BillingFeature, TenantSubscription } from "@shared/control-plane-schema";

export type BillingModel = "flat" | "per_policy" | "revenue_share";

/** Default per-status $/policy/month when a plan doesn't define its own map. Confirmed rates:
 *  active = 10c; lapsed is treated as active (10c) because it can still be reinstated;
 *  every other live status = 5c; archived (lapsed/cancelled, parked) = 1c. Cancelled auto-archives,
 *  so its rate is only ever charged for the brief window before the archive sweep catches it. */
export const DEFAULT_PER_STATUS_RATES: Record<string, string> = {
  active: "0.10",
  lapsed: "0.10",
  inactive: "0.05",
  grace: "0.05",
  cancelled: "0.05",
  archived: "0.01",
};

export const DEFAULT_MONTHLY_MINIMUM_USD = "250.00";
export const DEFAULT_REVENUE_SHARE_PERCENT = "2.50";
export const DEFAULT_INCLUDED_POLICY_UNITS = 1000;

export interface InvoiceLine {
  label: string;
  amount: string; // USD, 2dp
  currency?: string; // original currency for revenue-share lines
  nativeAmount?: string; // revenue-share only: the fee in `currency` before FX to USD, 2dp
}

export interface ComputedInvoice {
  amountUsd: string; // 2dp; always == sum of the line amounts
  lineItems: InvoiceLine[];
  /** true when the monthly minimum floor was applied (computed amount was below it). */
  minimumApplied: boolean;
  /**
   * Revenue-share only: fee owed per currency in that currency's own units (before FX), e.g.
   * { USD: "250.00", ZAR: "2250.00" }. A settlement can be paid across several of these currencies
   * at once, so P4/P5 record the native breakdown alongside the single USD headline amount.
   */
  currencyBreakdown?: Record<string, string>;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n: number): string => (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2);
const sumLines = (lines: InvoiceLine[]): number => lines.reduce((s, l) => s + num(l.amount), 0);

// ─── effective pricing (plan + feature deltas + tenant overrides) ────────────

export interface EffectivePricing {
  billingModel: BillingModel;
  baseFeeUsd: string;
  includedPolicyUnits: number;
  perStatusRates: Record<string, string>; // $/policy/month, feature deltas already folded in
  revenueSharePercent: string; // e.g. "2.50"
  monthlyMinimumUsd: string;
  setupFeeUsd: string;
  outstandingFeeCapUsd: string | null;
}

export interface GlobalBillingDefaults {
  platformFeeRatePercent?: string | null;
  defaultMonthlyMinimumUsd?: string | null;
  defaultOutstandingFeeCapUsd?: string | null;
}

/**
 * Merge a plan, its selected features, the tenant's per-subscription overrides, and the global
 * defaults into one resolved pricing object. Override precedence: subscription > plan+features >
 * global default > hard-coded default.
 */
export function resolveEffectivePricing(
  plan: Pick<
    BillingPlan,
    | "billingModel"
    | "baseFeeUsd"
    | "priceMonthlyUsd"
    | "includedPolicyUnits"
    | "perStatusRates"
    | "revenueSharePercent"
    | "monthlyMinimumUsd"
    | "setupFeeUsd"
  >,
  features: Pick<BillingFeature, "baseFeeDeltaUsd" | "perPolicyRateDeltaUsd" | "revenueSharePercentDelta">[],
  subscription: Pick<
    TenantSubscription,
    | "billingModelOverride"
    | "baseFeeOverrideUsd"
    | "includedPolicyUnitsOverride"
    | "perStatusRatesOverride"
    | "platformFeeRateOverride"
    | "monthlyMinimumOverrideUsd"
    | "setupFeeOverrideUsd"
    | "outstandingFeeCapUsd"
  >,
  globals: GlobalBillingDefaults = {},
): EffectivePricing {
  const featureBaseDelta = features.reduce((s, f) => s + num(f.baseFeeDeltaUsd), 0);
  const featurePolicyDelta = features.reduce((s, f) => s + num(f.perPolicyRateDeltaUsd), 0);
  const featureRevShareDelta = features.reduce((s, f) => s + num(f.revenueSharePercentDelta), 0);

  const billingModel = ((subscription.billingModelOverride || plan.billingModel || "flat") as BillingModel);

  const baseFeeRaw =
    subscription.baseFeeOverrideUsd != null
      ? num(subscription.baseFeeOverrideUsd)
      : plan.baseFeeUsd != null
        ? num(plan.baseFeeUsd)
        : num(plan.priceMonthlyUsd);
  const baseFeeUsd = money(baseFeeRaw + featureBaseDelta);

  const includedPolicyUnits =
    subscription.includedPolicyUnitsOverride ?? plan.includedPolicyUnits ?? DEFAULT_INCLUDED_POLICY_UNITS;

  const rateMap: Record<string, string> = {
    ...DEFAULT_PER_STATUS_RATES,
    ...(plan.perStatusRates ?? {}),
    ...(subscription.perStatusRatesOverride ?? {}),
  };
  const perStatusRates: Record<string, string> = {};
  for (const [status, rate] of Object.entries(rateMap)) {
    perStatusRates[status] = money(Math.max(0, num(rate) + featurePolicyDelta));
  }

  const revPctRaw =
    subscription.platformFeeRateOverride != null
      ? num(subscription.platformFeeRateOverride)
      : plan.revenueSharePercent != null
        ? num(plan.revenueSharePercent)
        : globals.platformFeeRatePercent != null
          ? num(globals.platformFeeRatePercent)
          : num(DEFAULT_REVENUE_SHARE_PERCENT);
  const revenueSharePercent = money(Math.max(0, revPctRaw + featureRevShareDelta));

  const monthlyMinimumUsd = money(
    subscription.monthlyMinimumOverrideUsd != null
      ? num(subscription.monthlyMinimumOverrideUsd)
      : plan.monthlyMinimumUsd != null
        ? num(plan.monthlyMinimumUsd)
        : globals.defaultMonthlyMinimumUsd != null
          ? num(globals.defaultMonthlyMinimumUsd)
          : num(DEFAULT_MONTHLY_MINIMUM_USD),
  );

  const setupFeeUsd = money(
    subscription.setupFeeOverrideUsd != null
      ? num(subscription.setupFeeOverrideUsd)
      : plan.setupFeeUsd != null
        ? num(plan.setupFeeUsd)
        : num(plan.priceMonthlyUsd),
  );

  const capRaw =
    subscription.outstandingFeeCapUsd != null
      ? subscription.outstandingFeeCapUsd
      : globals.defaultOutstandingFeeCapUsd ?? null;
  const outstandingFeeCapUsd = capRaw == null ? null : money(num(capRaw));

  return {
    billingModel,
    baseFeeUsd,
    includedPolicyUnits,
    perStatusRates,
    revenueSharePercent,
    monthlyMinimumUsd,
    setupFeeUsd,
    outstandingFeeCapUsd,
  };
}

// ─── per_policy ──────────────────────────────────────────────────────────────

/**
 * base fee (covers the first `includedPolicyUnits` policies) + Σ per-status rate on the overage,
 * then floored at the monthly minimum.
 *
 * The included allowance is consumed against the HIGHEST-rate statuses first, so a tenant's free
 * allowance is always worth the most it can be. Deterministic and explainable on the invoice.
 */
export function computePerPolicyInvoice(
  pricing: EffectivePricing,
  statusCounts: Record<string, number>,
): ComputedInvoice {
  const base = num(pricing.baseFeeUsd);
  const lines: InvoiceLine[] = [{ label: "Monthly plan fee", amount: money(base) }];

  const entries = Object.entries(statusCounts)
    .filter(([, n]) => n > 0)
    .map(([status, count]) => ({ status, count, rate: num(pricing.perStatusRates[status] ?? "0") }))
    .sort((a, b) => b.rate - a.rate); // highest rate first

  const total = entries.reduce((s, e) => s + e.count, 0);
  let allowance = Math.max(0, Math.min(pricing.includedPolicyUnits, total));
  if (allowance > 0) {
    lines.push({ label: `First ${allowance.toLocaleString("en-US")} policies — included in the plan fee, no extra charge`, amount: "0.00" });
  }

  for (const e of entries) {
    const covered = Math.min(allowance, e.count);
    allowance -= covered;
    const billable = e.count - covered;
    if (billable > 0 && e.rate > 0) {
      lines.push({
        label: `${billable.toLocaleString("en-US")} ${e.status} ${billable === 1 ? "policy" : "policies"} at $${e.rate.toFixed(2)} each`,
        amount: money(billable * e.rate),
      });
    }
  }

  const computed = sumLines(lines);
  const minimum = num(pricing.monthlyMinimumUsd);
  if (computed < minimum) {
    lines.push({
      label: `Minimum monthly charge — usage this month came to $${money(computed)}, which is below the $${money(minimum)} plan minimum`,
      amount: money(minimum - computed),
    });
    return { amountUsd: money(minimum), lineItems: lines, minimumApplied: true };
  }
  return { amountUsd: money(computed), lineItems: lines, minimumApplied: false };
}

// ─── revenue_share ───────────────────────────────────────────────────────────

/**
 * X% of collected/receipted revenue in each currency, converted to USD and summed, then floored
 * at the monthly minimum. `fxToUsd` maps a currency code → multiplier to USD (USD itself = 1).
 */
export function computeRevenueShareInvoice(
  pricing: EffectivePricing,
  collectionsByCurrency: Record<string, number | string>,
  fxToUsd: Record<string, number>,
): ComputedInvoice {
  const pct = num(pricing.revenueSharePercent);
  const lines: InvoiceLine[] = [];
  const currencyBreakdown: Record<string, string> = {};

  for (const [ccy, collected] of Object.entries(collectionsByCurrency)) {
    const amt = num(collected);
    if (amt <= 0) continue;
    const feeInCcy = (amt * pct) / 100;
    const rate = ccy === "USD" ? 1 : num(fxToUsd[ccy] ?? 0);
    const feeUsd = feeInCcy * rate;
    currencyBreakdown[ccy] = money(feeInCcy);
    lines.push({
      label:
        ccy === "USD"
          ? `${pct.toFixed(2)}% of $${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} collected this month`
          : `${pct.toFixed(2)}% of ${ccy} ${amt.toLocaleString("en-US", { minimumFractionDigits: 2 })} collected this month (converted to USD at ${rate})`,
      amount: money(feeUsd),
      currency: ccy,
      nativeAmount: money(feeInCcy),
    });
  }

  if (lines.length === 0) lines.push({ label: `${pct.toFixed(2)}% of $0.00 collected`, amount: "0.00", currency: "USD" });

  const computed = sumLines(lines);
  const minimum = num(pricing.monthlyMinimumUsd);
  if (computed < minimum) {
    lines.push({
      label: `Minimum monthly charge — usage this month came to $${money(computed)}, which is below the $${money(minimum)} plan minimum`,
      amount: money(minimum - computed),
    });
    return { amountUsd: money(minimum), lineItems: lines, minimumApplied: true, currencyBreakdown };
  }
  return { amountUsd: money(computed), lineItems: lines, minimumApplied: false, currencyBreakdown };
}

/**
 * Revenue-share invoice from the tenant's ALREADY-ACCRUED platform fees (unsettled
 * platform_receivables), grouped by the currency each was collected in. The per-receipt accrual
 * already applied the rate that was in effect at the time, so this just converts each currency's
 * total to USD, sums, and floors at the monthly minimum. Preferred over computeRevenueShareInvoice
 * (which re-derives the fee from collections) — one ledger, no double representation.
 */
export function computeRevenueShareInvoiceFromFees(
  pricing: EffectivePricing,
  feesByCurrency: Record<string, number | string>,
  fxToUsd: Record<string, number>,
): ComputedInvoice {
  const lines: InvoiceLine[] = [];
  const currencyBreakdown: Record<string, string> = {};

  for (const [ccy, fee] of Object.entries(feesByCurrency)) {
    const feeInCcy = num(fee);
    if (feeInCcy <= 0) continue;
    const rate = ccy === "USD" ? 1 : num(fxToUsd[ccy] ?? 0);
    currencyBreakdown[ccy] = money(feeInCcy);
    lines.push({
      label:
        ccy === "USD"
          ? `Platform fees on payments received this period`
          : `Platform fees on ${ccy} payments received this period (converted to USD at ${rate})`,
      amount: money(feeInCcy * rate),
      currency: ccy,
      nativeAmount: money(feeInCcy),
    });
  }

  if (lines.length === 0) lines.push({ label: `Platform fees on payments received this period`, amount: "0.00", currency: "USD" });

  const computed = sumLines(lines);
  const minimum = num(pricing.monthlyMinimumUsd);
  if (computed < minimum) {
    lines.push({
      label: `Minimum monthly charge — fees this period came to $${money(computed)}, which is below the $${money(minimum)} plan minimum`,
      amount: money(minimum - computed),
    });
    return { amountUsd: money(minimum), lineItems: lines, minimumApplied: true, currencyBreakdown };
  }
  return { amountUsd: money(computed), lineItems: lines, minimumApplied: false, currencyBreakdown };
}
