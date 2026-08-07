import { describe, it, expect, vi, beforeEach } from "vitest";

// Mirrors tests/unit/premium-calculation.test.ts's mock setup — computePolicyPremium pulls in
// storage/logger/tenant-db which require env, so those are stubbed for import.
vi.mock("../../server/storage", () => ({
  storage: {
    getProductVersion: vi.fn(),
    getProduct: vi.fn(),
    getAddOns: vi.fn(),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: vi.fn((_orgId: string, userId: string) => Promise.resolve(userId)) }));

import { computePolicyPremium } from "../../server/route-helpers";
import { storage } from "../../server/storage";
import { calculatePremiumPreview } from "../../client/src/lib/policy-premium-preview";

/**
 * These fixtures cross-check the client-side wizard preview (calculatePremiumPreview) against
 * the server-side authoritative calculation (computePolicyPremium). The two functions take
 * different-shaped inputs, so each fixture below builds both an "inputs" object for the client
 * function and an equivalent call for the server function. See the report for the exact
 * translation used (memberAddOns flattening, dependentDateOfBirths derivation).
 *
 * IMPORTANT scope note: the client preview (calculatePremiumPreview) only ever pools members
 * into a single combined bucket ((adults+children) vs maxAdults+maxChildren+maxExtended) when
 * using a dedicated additional-member rate, whereas the server splits adults/children into
 * separate pools whenever a product defines maxChildren > 0 (see resolveChargeableMembers in
 * server/route-helpers.ts, the FLK00526 fix). These only provably agree when maxChildren is 0
 * (single combined pool on both sides) — so the "dedicated additional-member rate" fixtures
 * below use maxChildren: "0" deliberately. The "underwriter-rate fallback" fixtures don't have
 * this restriction because that path prices strictly by extra-adult-count × rate + extra-child-
 * count × rate on both sides, which is order-independent and always agrees regardless of pool
 * splitting. Age-band rates (additionalMemberRate21To65Usd etc.) are a server-only feature the
 * client preview does not implement at all, so no fixture here enables them.
 */

const BASE_VERSION: any = {
  id: "pv1",
  productId: "prod1",
  premiumMonthlyUsd: "50.00",
  premiumMonthlyZar: "900.00",
  premiumMonthlyZig: "2100.00",
  premiumWeeklyUsd: "12.50",
  premiumWeeklyZar: "230.00",
  premiumWeeklyZig: "525.00",
  premiumBiweeklyUsd: "25.00",
  premiumBiweeklyZar: "460.00",
  premiumBiweeklyZig: "1050.00",
  dependentMaxAge: 21,
  underwriterAmountAdult: "10.00",
  underwriterAmountChild: "5.00",
};

const BASE_PRODUCT: any = { id: "prod1", maxAdults: 2, maxChildren: 4, maxExtendedMembers: 0 };

// A dependent record shaped like /api/clients/:id/dependents — only id/dateOfBirth matter here.
const dep = (id: string, dateOfBirth: string) => ({ id, dateOfBirth });

function setupMocks(version: any, product: any, addOns: any[] = []) {
  vi.mocked(storage.getProductVersion).mockResolvedValue(version);
  vi.mocked(storage.getProduct).mockResolvedValue(product);
  vi.mocked(storage.getAddOns).mockResolvedValue(addOns as any);
}

// Flattens the client's per-member add-on map into the server's {memberRef, addOnId}[] shape —
// this is the "translation" the two functions need (see report).
function flattenMemberAddOns(memberAddOns: Record<string, string[]>) {
  const out: { memberRef: string; addOnId: string }[] = [];
  for (const [memberRef, ids] of Object.entries(memberAddOns)) {
    for (const addOnId of ids) out.push({ memberRef, addOnId });
  }
  return out;
}

async function crossCheck(opts: {
  version: any;
  product: any;
  addOns?: any[];
  currency: string;
  paymentSchedule: string;
  memberAddOns?: Record<string, string[]>;
  dependents?: { id: string; dateOfBirth: string }[];
  beneficiaryDependentIds?: string[];
}) {
  const { version, product, addOns = [], currency, paymentSchedule, memberAddOns = {}, dependents = [], beneficiaryDependentIds = [] } = opts;
  setupMocks(version, product, addOns);

  const dependentDateOfBirths = dependents
    .filter((d) => beneficiaryDependentIds.includes(d.id))
    .map((d) => d.dateOfBirth);

  const serverTotal = await computePolicyPremium(
    "org1", "pv1", currency, paymentSchedule,
    [], // addOnIds — unused; the wizard always assigns add-ons per-member (see memberAddOns below)
    flattenMemberAddOns(memberAddOns),
    undefined,
    dependentDateOfBirths,
  );

  const clientResult = calculatePremiumPreview({
    selectedVersion: version,
    selectedProduct: product,
    currency,
    paymentSchedule,
    memberAddOns,
    beneficiaryDependentIds,
    dependents,
    addOns,
  });

  return { serverTotal: parseFloat(serverTotal), clientTotal: clientResult ? parseFloat(clientResult.total) : NaN };
}

describe("calculatePremiumPreview vs computePolicyPremium — base premium, no dependents", () => {
  it("monthly USD", async () => {
    const { serverTotal, clientTotal } = await crossCheck({ version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "monthly" });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(50.0, 2);
  });

  it("monthly ZAR", async () => {
    const { serverTotal, clientTotal } = await crossCheck({ version: BASE_VERSION, product: BASE_PRODUCT, currency: "ZAR", paymentSchedule: "monthly" });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(900.0, 2);
  });

  it("monthly ZIG", async () => {
    const { serverTotal, clientTotal } = await crossCheck({ version: BASE_VERSION, product: BASE_PRODUCT, currency: "ZIG", paymentSchedule: "monthly" });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(2100.0, 2);
  });

  it("weekly USD", async () => {
    const { serverTotal, clientTotal } = await crossCheck({ version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "weekly" });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(12.5, 2);
  });

  it("biweekly USD", async () => {
    const { serverTotal, clientTotal } = await crossCheck({ version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "biweekly" });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(25.0, 2);
  });
});

describe("calculatePremiumPreview vs computePolicyPremium — add-ons", () => {
  it("flat add-on adds to base (monthly USD)", async () => {
    const addOns = [{ id: "ao1", pricingMode: "flat", priceMonthly: "15.00", priceAmount: "15.00" }];
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, addOns, currency: "USD", paymentSchedule: "monthly",
      memberAddOns: { holder: ["ao1"] },
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(65.0, 2);
  });

  it("percentage add-on applies against base (monthly USD)", async () => {
    const addOns = [{ id: "ao2", pricingMode: "percentage", priceAmount: "10" }];
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, addOns, currency: "USD", paymentSchedule: "monthly",
      memberAddOns: { holder: ["ao2"] },
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(55.0, 2);
  });

  it("no add-ons selected leaves base unchanged", async () => {
    const addOns = [{ id: "ao1", pricingMode: "flat", priceMonthly: "15.00", priceAmount: "15.00" }];
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, addOns, currency: "USD", paymentSchedule: "monthly",
      memberAddOns: {},
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(50.0, 2);
  });
});

describe("calculatePremiumPreview vs computePolicyPremium — underwriter-rate fallback (no dedicated additional-member rate)", () => {
  it("1 extra adult dependent beyond maxAdults=2 (holder + 2 adult deps = 3 adults)", async () => {
    const dependents = [dep("d1", "1980-01-01"), dep("d2", "1982-01-01")];
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "monthly",
      dependents, beneficiaryDependentIds: ["d1", "d2"],
    });
    // base 50 + 1 extra adult * underwriterAmountAdult(10) = 60
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(60.0, 2);
  });

  it("mixed extra adults and extra children beyond maxAdults=2/maxChildren=4", async () => {
    const currentYear = new Date().getFullYear();
    const childDob = `${currentYear - 10}-01-01`;
    const dependents = [
      dep("a1", "1980-01-01"), dep("a2", "1982-01-01"), // 2 adult deps -> 1 extra adult (holder+2=3, cap 2)
      dep("c1", childDob), dep("c2", childDob), dep("c3", childDob), dep("c4", childDob), dep("c5", childDob), // 5 children -> 1 extra child
    ];
    const beneficiaryDependentIds = dependents.map((d) => d.id);
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "monthly",
      dependents, beneficiaryDependentIds,
    });
    // base 50 + 1 extra adult * 10 + 1 extra child * 5 = 65
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(65.0, 2);
  });

  it("weekly schedule scales the underwriter surcharge by the same schedule factor on both sides", async () => {
    const dependents = [dep("d1", "1980-01-01"), dep("d2", "1982-01-01")];
    const { serverTotal, clientTotal } = await crossCheck({
      version: BASE_VERSION, product: BASE_PRODUCT, currency: "USD", paymentSchedule: "weekly",
      dependents, beneficiaryDependentIds: ["d1", "d2"],
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
  });
});

describe("calculatePremiumPreview vs computePolicyPremium — dedicated additional-member rate (maxChildren=0, pooled)", () => {
  const POOLED_PRODUCT: any = { id: "prod1", maxAdults: 8, maxChildren: 0, maxExtendedMembers: 0 };
  const RATE_VERSION: any = { ...BASE_VERSION, additionalMemberPremiumMonthlyUsd: "8.00" };

  it("charges the dedicated rate per member beyond the pooled total", async () => {
    // Holder + 8 adult dependents = 9 total, pooled cap 8 -> 1 chargeable member.
    const dependents = Array.from({ length: 8 }, (_, i) => dep(`d${i}`, `${1970 + i}-01-01`));
    const beneficiaryDependentIds = dependents.map((d) => d.id);
    const { serverTotal, clientTotal } = await crossCheck({
      version: RATE_VERSION, product: POOLED_PRODUCT, currency: "USD", paymentSchedule: "monthly",
      dependents, beneficiaryDependentIds,
    });
    // base 50 + 1 chargeable * 8 = 58
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(58.0, 2);
  });

  it("no surcharge while within the pooled total", async () => {
    const dependents = Array.from({ length: 3 }, (_, i) => dep(`d${i}`, `${1970 + i}-01-01`));
    const beneficiaryDependentIds = dependents.map((d) => d.id);
    const { serverTotal, clientTotal } = await crossCheck({
      version: RATE_VERSION, product: POOLED_PRODUCT, currency: "USD", paymentSchedule: "monthly",
      dependents, beneficiaryDependentIds,
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(50.0, 2);
  });

  it("biweekly schedule applies the same (12/26) factor on both sides", async () => {
    const dependents = Array.from({ length: 8 }, (_, i) => dep(`d${i}`, `${1970 + i}-01-01`));
    const beneficiaryDependentIds = dependents.map((d) => d.id);
    const { serverTotal, clientTotal } = await crossCheck({
      version: RATE_VERSION, product: POOLED_PRODUCT, currency: "USD", paymentSchedule: "biweekly",
      dependents, beneficiaryDependentIds,
    });
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
  });

  it("ZAR dedicated rate, independent of USD", async () => {
    const zarRateVersion = { ...BASE_VERSION, additionalMemberPremiumMonthlyZar: "150.00" };
    const dependents = Array.from({ length: 8 }, (_, i) => dep(`d${i}`, `${1970 + i}-01-01`));
    const beneficiaryDependentIds = dependents.map((d) => d.id);
    const { serverTotal, clientTotal } = await crossCheck({
      version: zarRateVersion, product: POOLED_PRODUCT, currency: "ZAR", paymentSchedule: "monthly",
      dependents, beneficiaryDependentIds,
    });
    // base 900 + 1 chargeable * 150 = 1050
    expect(clientTotal).toBeCloseTo(serverTotal, 2);
    expect(clientTotal).toBeCloseTo(1050.0, 2);
  });
});
