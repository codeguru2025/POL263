import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/storage", () => ({
  storage: {
    getProductVersion: vi.fn(),
    getProduct: vi.fn(),
    getAddOns: vi.fn(),
    getAgeBandRateCards: vi.fn(),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: vi.fn((_orgId: string, userId: string) => Promise.resolve(userId)) }));

import { computePolicyPremium, computeIndividualAgeRatedPremium, resolveAddOnCashCharge, PricingConfigError } from "../../server/route-helpers";
import { storage } from "../../server/storage";

const RATED_VERSION: any = { id: "pv1", productId: "prod1", dependentMaxAge: 18 };

const RATED_PRODUCT: any = {
  id: "prod1",
  pricingModel: "individual_age_rated",
  coverAmount: "1000",
  coverCurrency: "USD",
};

const RATE_CARDS: any[] = [
  { productVersionId: "pv1", ageBand: "child", currency: "USD", ratePerThousand: "2.0000", isActive: true },
  { productVersionId: "pv1", ageBand: "21_65", currency: "USD", ratePerThousand: "5.0000", isActive: true },
  { productVersionId: "pv1", ageBand: "66_84", currency: "USD", ratePerThousand: "12.0000", isActive: true },
  { productVersionId: "pv1", ageBand: "85_plus", currency: "USD", ratePerThousand: "25.0000", isActive: true },
];

function dobForAge(age: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  return d.toISOString().slice(0, 10);
}

describe("computeIndividualAgeRatedPremium", () => {
  beforeEach(() => {
    vi.mocked(storage.getAgeBandRateCards).mockResolvedValue(RATE_CARDS as any);
  });

  it("prices the policyholder off their own age band and cover amount, not a flat base", async () => {
    const result = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40) }, [],
    );
    // 1000 / 1000 * 5.00 (21_65 band) = 5.00
    expect(result.total).toBeCloseTo(5.0, 5);
    expect(result.members[0].ageBand).toBe("21_65");
    expect(result.members[0].coverAmount).toBe(1000);
  });

  it("prices each dependent individually by their own age band", async () => {
    const result = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(70) }, // 66_84 band: 1000/1000*12 = 12
      [
        { dateOfBirth: dobForAge(10) }, // child: 1000/1000*2 = 2
        { dateOfBirth: dobForAge(90) }, // 85_plus: 1000/1000*25 = 25
      ],
    );
    expect(result.members).toHaveLength(3);
    expect(result.members[0].ageBand).toBe("66_84");
    expect(result.members[1].ageBand).toBe("child");
    expect(result.members[2].ageBand).toBe("85_plus");
    expect(result.total).toBeCloseTo(12 + 2 + 25, 5);
  });

  it("scales a dependent's premium with their own cover amount, not the tier default", async () => {
    const result = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40), coverAmount: 3000 }, // headroom so the dependent isn't clamped
      [{ dateOfBirth: dobForAge(40), coverAmount: 2000 }],
    );
    // dependent: 2000/1000 * 5.00 = 10.00
    expect(result.members[1].coverAmount).toBe(2000);
    expect(result.members[1].contribution).toBeCloseTo(10.0, 5);
  });

  it("clamps a dependent's cover amount to never exceed the policyholder's effective cover", async () => {
    const result = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40), coverAmount: 1000 },
      [{ dateOfBirth: dobForAge(40), coverAmount: 5000 }],
    );
    expect(result.members[1].coverAmount).toBe(1000);
  });

  it("adds a cover top-up on top of the default cover for whichever member it's attached to", async () => {
    const result = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40), coverTopup: 500 }, [],
    );
    // (1000 + 500) / 1000 * 5.00 = 7.50
    expect(result.members[0].coverAmount).toBe(1500);
    expect(result.total).toBeCloseTo(7.5, 5);
  });

  it("scales by payment schedule the same way flat-rate products do", async () => {
    const monthly = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40) }, [],
    );
    const yearly = await computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "yearly", 18,
      { dateOfBirth: dobForAge(40) }, [],
    );
    expect(yearly.total).toBeCloseTo(monthly.total * 12, 5);
  });

  it("refuses to price (422 PricingConfigError) when no rate card is configured for the currency", async () => {
    vi.mocked(storage.getAgeBandRateCards).mockResolvedValue([]);
    const attempt = computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40) }, [],
    );
    await expect(attempt).rejects.toBeInstanceOf(PricingConfigError);
    await expect(attempt).rejects.toMatchObject({ status: 422, expose: true });
  });

  it("refuses to price when just ONE member's band is missing — never a free life on a paid policy", async () => {
    vi.mocked(storage.getAgeBandRateCards).mockResolvedValue(RATE_CARDS.filter((rc) => rc.ageBand !== "85_plus") as any);
    await expect(computeIndividualAgeRatedPremium(
      "org1", "pv1", RATED_PRODUCT, "USD", "monthly", 18,
      { dateOfBirth: dobForAge(40) }, [{ dateOfBirth: dobForAge(90) }],
    )).rejects.toBeInstanceOf(PricingConfigError);
  });
});

describe("computePolicyPremium — individual_age_rated branch", () => {
  beforeEach(() => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(RATED_VERSION);
    vi.mocked(storage.getProduct).mockResolvedValue(RATED_PRODUCT);
    vi.mocked(storage.getAgeBandRateCards).mockResolvedValue(RATE_CARDS as any);
  });

  it("delegates to the age-rated engine instead of the flat bundled_family base", async () => {
    const result = await computePolicyPremium(
      "org1", "pv1", "USD", "monthly", [], undefined, undefined, [],
      undefined, undefined,
      { policyholderDateOfBirth: dobForAge(40) },
    );
    expect(result).toBe("5.00");
  });

  it("ignores dependentDateOfBirths ages < policyholder inputs are still summed correctly", async () => {
    const result = await computePolicyPremium(
      "org1", "pv1", "USD", "monthly", [], undefined, undefined, [dobForAge(10)],
      undefined, undefined,
      { policyholderDateOfBirth: dobForAge(40) },
    );
    // policyholder 5.00 + child dependent (default cover 1000) 2.00 = 7.00
    expect(result).toBe("7.00");
  });
});

describe("resolveAddOnCashCharge", () => {
  const ADD_ON = { coverIncrementAmount: "500" };

  it("charges the full cash value for a walk-in with no policy at all", () => {
    const result = resolveAddOnCashCharge(ADD_ON, { hasPolicy: false, alreadyCoveredByPolicy: false });
    expect(result.amount).toBe(500);
    expect(result.note).toMatch(/full cash price/i);
  });

  it("applies a 10% discount for a policyholder whose plan didn't already include it", () => {
    const result = resolveAddOnCashCharge(ADD_ON, { hasPolicy: true, alreadyCoveredByPolicy: false });
    expect(result.amount).toBe(450);
    expect(result.note).toMatch(/10% policyholder discount/i);
  });

  it("charges nothing when the policy already has this add-on attached", () => {
    const result = resolveAddOnCashCharge(ADD_ON, { hasPolicy: true, alreadyCoveredByPolicy: true });
    expect(result.amount).toBe(0);
    expect(result.note).toMatch(/already covered/i);
  });

  it("scales by quantity", () => {
    const result = resolveAddOnCashCharge(ADD_ON, { hasPolicy: false, alreadyCoveredByPolicy: false, quantity: 3 });
    expect(result.amount).toBe(1500);
  });

  it("treats a missing cover amount as $0 rather than throwing", () => {
    const result = resolveAddOnCashCharge({ coverIncrementAmount: null }, { hasPolicy: false, alreadyCoveredByPolicy: false });
    expect(result.amount).toBe(0);
  });
});
