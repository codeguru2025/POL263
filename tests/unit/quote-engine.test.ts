import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/storage", () => ({
  storage: {
    getProductsByOrg: vi.fn(),
    getAllProductVersions: vi.fn(),
    getAddOns: vi.fn(),
  },
}));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: vi.fn((_orgId: string, userId: string) => Promise.resolve(userId)) }));

import { recommendProducts } from "../../server/quote-engine";
import { storage } from "../../server/storage";

const FAMILY_PLAN: any = { id: "prod-family", name: "Family Plan", isActive: true, maxAdults: 2, maxChildren: 4, maxExtendedMembers: 0 };
const SINGLE_PLAN: any = { id: "prod-single", name: "Single Plan", isActive: true, maxAdults: 1, maxChildren: 0, maxExtendedMembers: 0 };
const SENIOR_PLAN: any = { id: "prod-senior", name: "Senior Plan", isActive: true, maxAdults: 2, maxChildren: 0, maxExtendedMembers: 0 };

const FAMILY_PV: any = {
  id: "pv-family", productId: "prod-family", version: 1, isActive: true,
  premiumMonthlyUsd: "30.00", dependentMaxAge: 20, eligibilityMinAge: 18, eligibilityMaxAge: 70,
};
const SINGLE_PV_OLD: any = {
  id: "pv-single-1", productId: "prod-single", version: 1, isActive: true,
  premiumMonthlyUsd: "10.00", dependentMaxAge: 20, eligibilityMinAge: 18, eligibilityMaxAge: 70,
};
const SINGLE_PV_NEW: any = {
  id: "pv-single-2", productId: "prod-single", version: 2, isActive: true,
  premiumMonthlyUsd: "8.00", dependentMaxAge: 20, eligibilityMinAge: 18, eligibilityMaxAge: 70,
};
const SENIOR_PV: any = {
  id: "pv-senior", productId: "prod-senior", version: 1, isActive: true,
  premiumMonthlyUsd: "15.00", dependentMaxAge: 20, eligibilityMinAge: 60, eligibilityMaxAge: 100,
};

beforeEach(() => {
  vi.mocked(storage.getAddOns).mockResolvedValue([]);
});

describe("recommendProducts — composition fit", () => {
  it("ranks the plan whose included caps fit the household ahead of a cheaper plan that would surcharge", async () => {
    vi.mocked(storage.getProductsByOrg).mockResolvedValue([FAMILY_PLAN, SINGLE_PLAN]);
    vi.mocked(storage.getAllProductVersions).mockResolvedValue([FAMILY_PV, SINGLE_PV_OLD]);

    // Policyholder + 2 dependents: Single Plan (maxAdults 1) would surcharge 2 extra members;
    // Family Plan (maxAdults 2, maxChildren 4) covers everyone included, despite costing more.
    const ranked = await recommendProducts("org1", {
      policyholderDateOfBirth: "1990-01-01",
      dependentDateOfBirths: ["1988-01-01", "2015-01-01"],
    });

    expect(ranked[0].productId).toBe("prod-family");
    expect(ranked[0].surchargedMemberCount).toBe(0);
    expect(ranked[1].productId).toBe("prod-single");
    expect(ranked[1].surchargedMemberCount).toBeGreaterThan(0);
  });

  it("picks the cheapest plan among equally-good fits", async () => {
    vi.mocked(storage.getProductsByOrg).mockResolvedValue([FAMILY_PLAN]);
    vi.mocked(storage.getAllProductVersions).mockResolvedValue([FAMILY_PV]);
    const ranked = await recommendProducts("org1", { policyholderDateOfBirth: "1990-01-01" });
    expect(ranked[0].premium).toBe("30.00");
  });

  it("uses the highest-version active product_version when several exist for the same product", async () => {
    vi.mocked(storage.getProductsByOrg).mockResolvedValue([SINGLE_PLAN]);
    vi.mocked(storage.getAllProductVersions).mockResolvedValue([SINGLE_PV_OLD, SINGLE_PV_NEW]);
    const ranked = await recommendProducts("org1", { policyholderDateOfBirth: "1990-01-01" });
    expect(ranked[0].productVersionId).toBe("pv-single-2");
    expect(ranked[0].premium).toBe("8.00");
  });

  it("flags (but does not exclude) a candidate outside the eligibility age range, ranking it last", async () => {
    vi.mocked(storage.getProductsByOrg).mockResolvedValue([SENIOR_PLAN, SINGLE_PLAN]);
    vi.mocked(storage.getAllProductVersions).mockResolvedValue([SENIOR_PV, SINGLE_PV_OLD]);
    // A 30-year-old is outside Senior Plan's 60-100 eligibility window.
    const ranked = await recommendProducts("org1", { policyholderDateOfBirth: "1994-01-01" });
    expect(ranked.map((r) => r.productId)).toEqual(["prod-single", "prod-senior"]);
    expect(ranked.find((r) => r.productId === "prod-senior")?.outsideEligibleAge).toBe(true);
    expect(ranked.find((r) => r.productId === "prod-single")?.outsideEligibleAge).toBe(false);
  });
});
