import crypto from "crypto";
import { storage } from "./storage";
import { computePolicyPremium, resolveChargeableMembers } from "./route-helpers";
import type { Product, ProductVersion } from "@shared/schema";

const QUOTE_TOKEN_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours — long enough to cover a wizard session

function quoteSecret(): string {
  // Same secret already required for session signing (see .env.example) — no new env var needed.
  return process.env.SESSION_SECRET || "dev-only-insecure-secret";
}

/**
 * Signs an opaque, short-lived token proving a real quote was generated for this
 * org+productVersion combination before policy creation. This is an instructional gate (nudges
 * every non-legacy policy through the quote step), not a strict security boundary — there is no
 * persisted quotes table, so a determined caller could still forge premiumAmount server-side
 * elsewhere; what this actually prevents is the UI/API silently skipping the quote step.
 */
export function signQuoteToken(orgId: string, productVersionId: string): string {
  const payload = JSON.stringify({ orgId, productVersionId, iat: Date.now() });
  const encoded = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", quoteSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyQuoteToken(token: unknown, orgId: string, productVersionId: string): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [encoded, sig] = token.split(".");
  const expectedSig = crypto.createHmac("sha256", quoteSecret()).update(encoded).digest("base64url");
  const sigBuf = Buffer.from(sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.orgId !== orgId || payload.productVersionId !== productVersionId) return false;
    if (typeof payload.iat !== "number" || Date.now() - payload.iat > QUOTE_TOKEN_TTL_MS) return false;
    return true;
  } catch {
    return false;
  }
}

export interface HouseholdInput {
  policyholderDateOfBirth?: string | null;
  dependentDateOfBirths?: (string | null | undefined)[];
  currency?: string;
  paymentSchedule?: string;
}

export interface RankedCandidate {
  productId: string;
  productVersionId: string;
  productName: string;
  premium: string;
  currency: string;
  paymentSchedule: string;
  /** Members priced beyond the product's included adult/child/extended caps — lower is a better fit. */
  surchargedMemberCount: number;
  /** True if the policyholder's age falls outside this version's configured eligibility range. */
  outsideEligibleAge: boolean;
}

function ageAt(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const asOf = new Date();
  let age = asOf.getFullYear() - birth.getFullYear();
  const monthDelta = asOf.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && asOf.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** Highest `version` per productId among rows already filtered to isActive !== false. There is no
 *  "current version" concept in the schema — several versions of the same product can be active
 *  simultaneously — so this is a new, explicit convention just for recommendation purposes. */
function latestActiveVersionPerProduct(versions: ProductVersion[]): Map<string, ProductVersion> {
  const byProduct = new Map<string, ProductVersion>();
  for (const v of versions) {
    if (v.isActive === false) continue;
    const existing = byProduct.get(v.productId);
    if (!existing || Number(v.version) > Number(existing.version)) byProduct.set(v.productId, v);
  }
  return byProduct;
}

/** Members priced beyond a product's included adult/child caps — mirrors computePolicyPremium's
 *  own resolveChargeableMembers (route-helpers.ts) so "fit" and "price" never disagree with each other. */
function surchargedMemberCount(product: Product, pv: ProductVersion, dependentDobs: (string | null | undefined)[]): number {
  const includedAdults = Number(product.maxAdults ?? 2);
  const includedChildren = Number(product.maxChildren ?? 4);
  const includedExtended = Number(product.maxExtendedMembers ?? 0);
  const childThresholdAge = Number(pv.dependentMaxAge ?? 20);
  return resolveChargeableMembers(includedAdults, includedChildren, includedExtended, childThresholdAge, dependentDobs).length;
}

/**
 * Ranks an org's active products/versions for a given household (policyholder + dependents),
 * pricing each via the same computePolicyPremium every real payment/registration uses so a
 * recommendation can never quote a number that diverges from what issuing the policy would
 * actually charge. Ranks by composition fit first (fewest surcharged members), then lowest
 * premium among equally-good fits. Eligibility age is a soft signal (flagged, not filtered) —
 * nothing enforces eligibilityMinAge/eligibilityMaxAge anywhere else in the app today, so this
 * function doesn't start hard-blocking based on it either.
 */
export async function recommendProducts(orgId: string, input: HouseholdInput): Promise<RankedCandidate[]> {
  const currency = input.currency || "USD";
  const paymentSchedule = input.paymentSchedule || "monthly";
  const dependentDobs = input.dependentDateOfBirths || [];
  const policyholderAge = ageAt(input.policyholderDateOfBirth);

  const [products, allVersions, orgAddOns] = await Promise.all([
    storage.getProductsByOrg(orgId),
    storage.getAllProductVersions(orgId),
    storage.getAddOns(orgId),
  ]);
  const activeProducts = products.filter((p) => p.isActive);
  const latestVersionByProduct = latestActiveVersionPerProduct(allVersions);

  const candidates: RankedCandidate[] = [];
  for (const product of activeProducts) {
    const pv = latestVersionByProduct.get(product.id);
    if (!pv) continue;
    const premium = await computePolicyPremium(
      orgId,
      pv.id,
      currency,
      paymentSchedule,
      [],
      undefined,
      dependentDobs.length + 1,
      dependentDobs,
      { productVersion: pv, product, orgAddOns },
    );
    const outsideEligibleAge = policyholderAge !== null
      && (policyholderAge < Number(pv.eligibilityMinAge ?? 18) || policyholderAge > Number(pv.eligibilityMaxAge ?? 70));
    candidates.push({
      productId: product.id,
      productVersionId: pv.id,
      productName: product.name,
      premium,
      currency,
      paymentSchedule,
      surchargedMemberCount: surchargedMemberCount(product, pv, dependentDobs),
      outsideEligibleAge,
    });
  }

  candidates.sort((a, b) => {
    if (a.outsideEligibleAge !== b.outsideEligibleAge) return a.outsideEligibleAge ? 1 : -1;
    if (a.surchargedMemberCount !== b.surchargedMemberCount) return a.surchargedMemberCount - b.surchargedMemberCount;
    return parseFloat(a.premium) - parseFloat(b.premium);
  });
  return candidates;
}
