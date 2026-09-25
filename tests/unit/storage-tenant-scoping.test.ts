import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Regression guard for the 2026-09-24 tenant-isolation fix. On the SHARED database every tenant's
 * rows live in the same tables, so a storage method that takes orgId but filters only by `id`
 * lets a route that forgets its own ownership pre-check read/modify another tenant's row (this
 * happened: PATCH /api/add-ons/:id, /api/benefit-catalog/:id, /api/age-band-rates/:id, ...).
 * These methods must scope by organizationId themselves, and updates must strip id/organizationId
 * from the payload so a raw req.body can't re-home a row into another tenant.
 */
const SCOPED: Record<string, string> = {
  getProduct: "products", getProductVersion: "productVersions", getPaymentTransaction: "paymentTransactions",
  getPaymentIntentById: "paymentIntents", getPaymentReceiptById: "paymentReceipts", getFuneralCase: "funeralCases",
  getLead: "leads", getGroup: "groups", getGroupPaymentIntentById: "groupPaymentIntents", getMonthEndRunById: "monthEndRuns",
  getCostSheet: "costSheets",
  updateClient: "clients", updateProduct: "products", updateProductVersion: "productVersions", updateAddOn: "addOns",
  updateBenefitCatalogItem: "benefitCatalogItems", updateBenefitBundle: "benefitBundles", updateAgeBandConfig: "ageBandConfigs",
  updateAgeBandRateCard: "ageBandRateCards", deleteAgeBandRateCard: "ageBandRateCards", updatePolicy: "policies",
  updatePaymentIntent: "paymentIntents", updatePaymentReceipt: "paymentReceipts", updatePaymentTransaction: "paymentTransactions",
  deleteReceipt: "receipts", deletePaymentReceipt: "paymentReceipts", updateFuneralCase: "funeralCases",
  updateFleetVehicle: "fleetVehicles", updateLead: "leads", updateApprovalRequest: "approvalRequests",
  updateTerms: "termsAndConditions", deleteTerms: "termsAndConditions", updateCashup: "cashups", updateGroup: "groups",
  updateGroupPaymentIntent: "groupPaymentIntents", updateSettlement: "settlements",
};

const src = fs.readFileSync(path.resolve(__dirname, "../../server/storage.ts"), "utf8");

function methodBody(name: string): string {
  const start = src.indexOf(`  async ${name}(`);
  if (start < 0) throw new Error(`storage.${name} not found`);
  const open = src.indexOf("{", src.indexOf("\n", start) - 2);
  let depth = 1;
  let i = open + 1;
  while (depth) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    i++;
  }
  return src.slice(open, i);
}

describe("storage tenant scoping", () => {
  for (const [method, table] of Object.entries(SCOPED)) {
    it(`${method} filters ${table} by organizationId`, () => {
      expect(methodBody(method)).toContain(`eq(${table}.organizationId, orgId)`);
    });
    if (method.startsWith("update")) {
      it(`${method} strips id/organizationId from the update payload`, () => {
        expect(methodBody(method)).toMatch(/stripImmutableKeys\(data( as any)?\)/);
      });
    }
  }

  it("updateFuneralTask scopes through the parent case's organization", () => {
    const body = methodBody("updateFuneralTask");
    expect(body).toContain("eq(funeralCases.organizationId, orgId)");
    expect(body).toContain("stripImmutableKeys");
  });

  it("getAgeBandRateCards never returns another tenant's cards for the same product version", () => {
    expect(methodBody("getAgeBandRateCards")).toContain("eq(ageBandRateCards.organizationId, orgId)");
  });
});
