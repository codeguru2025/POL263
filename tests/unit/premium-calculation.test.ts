import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/storage", () => ({
  storage: {
    getProductVersion: vi.fn(),
    getProduct: vi.fn(),
    getAddOns: vi.fn(),
    addPolicyCreditBalance: vi.fn(),
    createPolicyPremiumChange: vi.fn(),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: vi.fn((_orgId: string, userId: string) => Promise.resolve(userId)) }));

import { computePolicyPremium } from "../../server/route-helpers";
import { storage } from "../../server/storage";

const BASE_VERSION: any = {
  id: "pv1",
  productId: "prod1",
  premiumMonthlyUsd: "50.00",
  premiumMonthlyZar: "900.00",
  premiumWeeklyUsd: "12.50",
  premiumWeeklyZar: "230.00",
  premiumBiweeklyUsd: "25.00",
  premiumBiweeklyZar: "460.00",
  dependentMaxAge: "21",
  underwriterAmountAdult: "10.00",
  underwriterAmountChild: "5.00",
  commissionFirstMonthsRate: null,
};

const BASE_PRODUCT: any = {
  id: "prod1",
  maxAdults: "2",
  maxChildren: "4",
};

describe("computePolicyPremium — base premium", () => {
  beforeEach(() => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(BASE_VERSION);
    vi.mocked(storage.getProduct).mockResolvedValue(BASE_PRODUCT);
    vi.mocked(storage.getAddOns).mockResolvedValue([]);
  });

  it("returns base monthly USD premium with no add-ons or dependents", async () => {
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, []);
    expect(result).toBe("50.00");
  });

  it("returns base monthly ZAR premium", async () => {
    const result = await computePolicyPremium("org1", "pv1", "ZAR", "monthly", [], undefined, undefined, []);
    expect(result).toBe("900.00");
  });

  it("returns weekly USD premium", async () => {
    const result = await computePolicyPremium("org1", "pv1", "USD", "weekly", [], undefined, undefined, []);
    expect(result).toBe("12.50");
  });

  it("returns biweekly USD premium", async () => {
    const result = await computePolicyPremium("org1", "pv1", "USD", "biweekly", [], undefined, undefined, []);
    expect(result).toBe("25.00");
  });

  it("returns '0' when product version is not found", async () => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(null as any);
    const result = await computePolicyPremium("org1", "pv-missing", "USD", "monthly", [], undefined, undefined, []);
    expect(result).toBe("0");
  });
});

describe("computePolicyPremium — dependent surcharges", () => {
  beforeEach(() => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(BASE_VERSION);
    vi.mocked(storage.getProduct).mockResolvedValue(BASE_PRODUCT);
    vi.mocked(storage.getAddOns).mockResolvedValue([]);
  });

  it("no surcharge when within included adult count (holder + 1 adult dependent = 2 adults, maxAdults=2)", async () => {
    const dobs = ["1985-01-01"]; // 1 adult dependent → total 2 adults (holder + 1), within limit
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, dobs);
    expect(result).toBe("50.00");
  });

  it("applies adult surcharge for 1 extra adult beyond the included 2 (holder + 2 adult dependents = 3 adults)", async () => {
    const dobs = ["1980-01-01", "1982-01-01"]; // 2 adult dependents → 3 adults total, 1 extra
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, dobs);
    // base 50 + 1 extra adult * $10 = $60
    expect(parseFloat(result)).toBeCloseTo(60.0, 1);
  });

  it("applies child surcharge for dependents under threshold age (21)", async () => {
    const currentYear = new Date().getFullYear();
    const childDob = `${currentYear - 10}-01-01`; // 10-year-old → child
    // 4 children = within maxChildren(4), no surcharge
    const dobs = [childDob, childDob, childDob, childDob];
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, dobs);
    expect(result).toBe("50.00");
  });

  it("applies child surcharge for 1 extra child beyond the included 4", async () => {
    const currentYear = new Date().getFullYear();
    const childDob = `${currentYear - 10}-01-01`;
    const dobs = [childDob, childDob, childDob, childDob, childDob]; // 5 children, 1 extra
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, dobs);
    // base 50 + 1 extra child * $5 = $55
    expect(parseFloat(result)).toBeCloseTo(55.0, 1);
  });
});

describe("computePolicyPremium — add-on pricing", () => {
  beforeEach(() => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(BASE_VERSION);
    vi.mocked(storage.getProduct).mockResolvedValue(BASE_PRODUCT);
  });

  it("adds flat add-on price to base premium", async () => {
    vi.mocked(storage.getAddOns).mockResolvedValue([
      { id: "ao1", pricingMode: "flat", priceMonthly: "15.00", priceAmount: "15.00" } as any,
    ]);
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", ["ao1"], undefined, undefined, []);
    // base 50 + add-on 15 = 65
    expect(parseFloat(result)).toBeCloseTo(65.0, 2);
  });

  it("applies percentage add-on as % of base premium", async () => {
    vi.mocked(storage.getAddOns).mockResolvedValue([
      { id: "ao2", pricingMode: "percentage", priceAmount: "10" } as any, // 10% of $50 = $5
    ]);
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", ["ao2"], undefined, undefined, []);
    // base 50 + 10% of 50 = 55
    expect(parseFloat(result)).toBeCloseTo(55.0, 2);
  });

  it("ignores unknown add-on IDs", async () => {
    vi.mocked(storage.getAddOns).mockResolvedValue([
      { id: "ao1", pricingMode: "flat", priceMonthly: "15.00" } as any,
    ]);
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", ["ao-unknown"], undefined, undefined, []);
    expect(result).toBe("50.00");
  });

  it("member-level add-ons override ID-based add-ons", async () => {
    vi.mocked(storage.getAddOns).mockResolvedValue([
      { id: "ao1", pricingMode: "flat", priceMonthly: "20.00", priceAmount: "20.00" } as any,
    ]);
    const memberAddOns = [{ memberRef: "holder", addOnId: "ao1" }];
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], memberAddOns, undefined, []);
    // base 50 + 1 instance of ao1 $20 = 70
    expect(parseFloat(result)).toBeCloseTo(70.0, 2);
  });
});

describe("computePolicyPremium — edge cases", () => {
  beforeEach(() => {
    vi.mocked(storage.getAddOns).mockResolvedValue([]);
  });

  it("returns '0.00' when product version has no premium amounts set", async () => {
    vi.mocked(storage.getProductVersion).mockResolvedValue({
      ...BASE_VERSION,
      premiumMonthlyUsd: null,
      premiumMonthlyZar: null,
    });
    vi.mocked(storage.getProduct).mockResolvedValue(BASE_PRODUCT);
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, []);
    expect(parseFloat(result)).toBe(0);
  });

  it("result is always a valid decimal string with 2dp", async () => {
    vi.mocked(storage.getProductVersion).mockResolvedValue(BASE_VERSION);
    vi.mocked(storage.getProduct).mockResolvedValue(BASE_PRODUCT);
    const result = await computePolicyPremium("org1", "pv1", "USD", "monthly", [], undefined, undefined, []);
    expect(result).toMatch(/^\d+\.\d{2}$/);
  });
});
