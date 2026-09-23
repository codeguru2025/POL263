import { describe, it, expect } from "vitest";
import {
  resolveEffectivePricing,
  computePerPolicyInvoice,
  computeRevenueShareInvoice,
  computeRevenueShareInvoiceFromFees,
  DEFAULT_PER_STATUS_RATES,
} from "../../server/billing-model-math";

// minimal plan/subscription stand-ins (only the fields the math reads)
const plan = (o: Partial<any> = {}): any => ({
  billingModel: "flat",
  baseFeeUsd: null,
  priceMonthlyUsd: "249.99",
  includedPolicyUnits: 1000,
  perStatusRates: null,
  revenueSharePercent: null,
  monthlyMinimumUsd: "250.00",
  setupFeeUsd: null,
  ...o,
});
const sub = (o: Partial<any> = {}): any => ({
  billingModelOverride: null,
  baseFeeOverrideUsd: null,
  includedPolicyUnitsOverride: null,
  perStatusRatesOverride: null,
  platformFeeRateOverride: null,
  monthlyMinimumOverrideUsd: null,
  setupFeeOverrideUsd: null,
  outstandingFeeCapUsd: null,
  ...o,
});

describe("resolveEffectivePricing", () => {
  it("flat plan with no overrides → base = priceMonthlyUsd, default rates, $250 min", () => {
    const p = resolveEffectivePricing(plan(), [], sub());
    expect(p.billingModel).toBe("flat");
    expect(p.baseFeeUsd).toBe("249.99");
    expect(p.perStatusRates).toEqual(DEFAULT_PER_STATUS_RATES);
    expect(p.revenueSharePercent).toBe("2.50");
    expect(p.monthlyMinimumUsd).toBe("250.00");
    expect(p.setupFeeUsd).toBe("249.99"); // falls back to plan monthly
    expect(p.outstandingFeeCapUsd).toBeNull();
  });

  it("feature deltas stack onto base fee, every per-status rate, and revenue-share %", () => {
    const features = [
      { baseFeeDeltaUsd: "50.00", perPolicyRateDeltaUsd: "0.02", revenueSharePercentDelta: "0.50" },
      { baseFeeDeltaUsd: "20.00", perPolicyRateDeltaUsd: "0.01", revenueSharePercentDelta: "0.25" },
    ];
    const p = resolveEffectivePricing(plan({ billingModel: "per_policy", baseFeeUsd: "250.00" }), features as any, sub());
    expect(p.baseFeeUsd).toBe("320.00"); // 250 + 50 + 20
    expect(p.perStatusRates.active).toBe("0.13"); // 0.10 + 0.02 + 0.01
    expect(p.perStatusRates.archived).toBe("0.04"); // 0.01 + 0.03
    expect(p.revenueSharePercent).toBe("3.25"); // 2.50 + 0.75
  });

  it("subscription overrides beat plan + features", () => {
    const p = resolveEffectivePricing(
      plan({ billingModel: "flat", monthlyMinimumUsd: "250.00" }),
      [{ baseFeeDeltaUsd: "999", perPolicyRateDeltaUsd: "9", revenueSharePercentDelta: "9" }] as any,
      sub({
        billingModelOverride: "revenue_share",
        baseFeeOverrideUsd: "100.00",
        platformFeeRateOverride: "2.50",
        monthlyMinimumOverrideUsd: "300.00",
        perStatusRatesOverride: { active: "0.20" },
        outstandingFeeCapUsd: "300.00",
      }),
    );
    expect(p.billingModel).toBe("revenue_share");
    // baseFeeOverride still gets the feature delta added
    expect(p.baseFeeUsd).toBe("1099.00");
    expect(p.revenueSharePercent).toBe("11.50"); // override 2.50 + delta 9
    expect(p.perStatusRates.active).toBe("9.20"); // override 0.20 + delta 9
    expect(p.monthlyMinimumUsd).toBe("300.00");
    expect(p.outstandingFeeCapUsd).toBe("300.00");
  });

  it("global defaults fill gaps when neither plan nor subscription sets a value", () => {
    const p = resolveEffectivePricing(
      plan({ billingModel: "revenue_share", monthlyMinimumUsd: null } as any),
      [],
      sub(),
      { platformFeeRatePercent: "3.00", defaultMonthlyMinimumUsd: "199.00", defaultOutstandingFeeCapUsd: "500.00" },
    );
    expect(p.revenueSharePercent).toBe("3.00");
    expect(p.monthlyMinimumUsd).toBe("199.00");
    expect(p.outstandingFeeCapUsd).toBe("500.00");
  });
});

describe("computePerPolicyInvoice", () => {
  const pricing = resolveEffectivePricing(
    plan({ billingModel: "per_policy", baseFeeUsd: "250.00", includedPolicyUnits: 1000 }),
    [],
    sub(),
  );

  it("under the included allowance → just the base fee, floored at the minimum", () => {
    const r = computePerPolicyInvoice(pricing, { active: 400, inactive: 200 });
    // base 250 < min 250? equal — no adjustment
    expect(r.amountUsd).toBe("250.00");
    expect(r.minimumApplied).toBe(false);
  });

  it("allowance is consumed against the highest-rate statuses first", () => {
    // 800 active (0.10) + 300 inactive (0.05) + 100 archived (0.01) = 1200; 1000 included
    // → allowance covers all 800 active + 200 of 300 inactive; billable: 100 inactive, 100 archived
    const r = computePerPolicyInvoice(pricing, { active: 800, inactive: 300, archived: 100 });
    expect(r.lineItems.find((l) => l.label.includes("inactive"))?.amount).toBe("5.00"); // 100 × 0.05
    expect(r.lineItems.find((l) => l.label.includes("archived"))?.amount).toBe("1.00"); // 100 × 0.01
    expect(r.amountUsd).toBe("256.00"); // 250 + 5 + 1
    expect(r.minimumApplied).toBe(false);
    // invoice total always equals the sum of its lines
    expect(r.amountUsd).toBe(
      (r.lineItems.reduce((s, l) => s + parseFloat(l.amount), 0)).toFixed(2),
    );
  });

  it("applies the $250 monthly minimum when base + overage is below it", () => {
    const cheapPricing = resolveEffectivePricing(
      plan({ billingModel: "per_policy", baseFeeUsd: "0.00", includedPolicyUnits: 1000, monthlyMinimumUsd: "250.00" }),
      [],
      sub(),
    );
    const r = computePerPolicyInvoice(cheapPricing, { active: 1100 }); // 100 billable × 0.10 = $10
    expect(r.minimumApplied).toBe(true);
    expect(r.amountUsd).toBe("250.00");
    expect(r.lineItems.at(-1)?.label).toMatch(/^Minimum monthly charge — usage this month came to \$10\.00/);
  });

  it("lapsed policies bill at the active rate ($0.10), not the half rate", () => {
    expect(DEFAULT_PER_STATUS_RATES.lapsed).toBe("0.10");
    const r = computePerPolicyInvoice(
      resolveEffectivePricing(plan({ billingModel: "per_policy", baseFeeUsd: "300.00", includedPolicyUnits: 0 }), [], sub()),
      { lapsed: 200 },
    );
    expect(r.lineItems.find((l) => l.label.includes("lapsed"))?.amount).toBe("20.00"); // 200 × 0.10
  });

  it("archived-only tenant at $0.01/policy", () => {
    const r = computePerPolicyInvoice(
      resolveEffectivePricing(plan({ billingModel: "per_policy", baseFeeUsd: "300.00", includedPolicyUnits: 0 }), [], sub()),
      { archived: 5000 },
    );
    expect(r.lineItems.find((l) => l.label.includes("archived"))?.amount).toBe("50.00"); // 5000 × 0.01
    expect(r.amountUsd).toBe("350.00");
  });
});

describe("computeRevenueShareInvoice", () => {
  const pricing = resolveEffectivePricing(
    plan({ billingModel: "revenue_share", revenueSharePercent: "2.50", monthlyMinimumUsd: "250.00" }),
    [],
    sub(),
  );

  it("USD only, above the minimum", () => {
    const r = computeRevenueShareInvoice(pricing, { USD: "20000.00" }, { USD: 1 });
    expect(r.amountUsd).toBe("500.00"); // 2.5% of 20000
    expect(r.minimumApplied).toBe(false);
  });

  it("multi-currency: each charged in its own currency, converted and summed", () => {
    const r = computeRevenueShareInvoice(
      pricing,
      { USD: "10000.00", ZAR: "90000.00", ZIG: "500000.00" },
      { USD: 1, ZAR: 0.055, ZIG: 0.00007 },
    );
    // USD: 250 ; ZAR: 2250 zar × 0.055 = 123.75 ; ZIG: 12500 zig × 0.00007 = 0.875 → 0.88
    // total ≈ 374.63
    expect(r.lineItems).toHaveLength(3);
    expect(r.amountUsd).toBe("374.63");
    expect(r.minimumApplied).toBe(false);
    // native per-currency fee breakdown (before FX) — used to record multi-currency settlements
    expect(r.currencyBreakdown).toEqual({ USD: "250.00", ZAR: "2250.00", ZIG: "12500.00" });
    expect(r.lineItems.find((l) => l.currency === "ZAR")?.nativeAmount).toBe("2250.00");
  });

  it("applies the monthly minimum when 2.5% is below it (Falakhe-style)", () => {
    const r = computeRevenueShareInvoice(pricing, { USD: "4000.00" }, { USD: 1 }); // 2.5% = $100
    expect(r.minimumApplied).toBe(true);
    expect(r.amountUsd).toBe("250.00");
  });

  it("2.5% exactly at the boundary — $251 wins over the $250 minimum", () => {
    const r = computeRevenueShareInvoice(pricing, { USD: "10040.00" }, { USD: 1 }); // 2.5% = $251.00
    expect(r.minimumApplied).toBe(false);
    expect(r.amountUsd).toBe("251.00");
  });

  it("no collections → minimum still due", () => {
    const r = computeRevenueShareInvoice(pricing, {}, { USD: 1 });
    expect(r.amountUsd).toBe("250.00");
    expect(r.minimumApplied).toBe(true);
  });
});

describe("computeRevenueShareInvoiceFromFees (single-ledger path)", () => {
  const pricing = resolveEffectivePricing(
    plan({ billingModel: "revenue_share", revenueSharePercent: "2.50", monthlyMinimumUsd: "250.00" }),
    [], sub(),
  );

  it("sums already-accrued fees per currency, converts to USD, above the minimum", () => {
    const r = computeRevenueShareInvoiceFromFees(pricing, { USD: "500.00", ZAR: "4000.00" }, { USD: 1, ZAR: 0.055 });
    // 500 + 4000*0.055=220 → 720
    expect(r.amountUsd).toBe("720.00");
    expect(r.currencyBreakdown).toEqual({ USD: "500.00", ZAR: "4000.00" });
    expect(r.lineItems.find((l) => l.currency === "ZAR")?.nativeAmount).toBe("4000.00");
    expect(r.minimumApplied).toBe(false);
  });

  it("floors at the monthly minimum when accrued fees are below it", () => {
    const r = computeRevenueShareInvoiceFromFees(pricing, { USD: "90.00" }, { USD: 1 });
    expect(r.amountUsd).toBe("250.00");
    expect(r.minimumApplied).toBe(true);
  });

  it("nothing unsettled → still owes the minimum", () => {
    const r = computeRevenueShareInvoiceFromFees(pricing, {}, { USD: 1 });
    expect(r.amountUsd).toBe("250.00");
    expect(r.minimumApplied).toBe(true);
  });
});
