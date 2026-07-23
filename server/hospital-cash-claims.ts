/**
 * Hospital cash benefit calculation — payout = days hospitalized x daily benefit rate, capped
 * per claim and per policy-year. A genuinely different claim shape from the funeral cash-in-
 * lieu model (server/route-helpers.ts's checkWaitingPeriodViolation etc.) — deliberately kept
 * as its own module rather than a branch of shared claim logic, so death-claim behavior is
 * never at risk of regressing when this engine changes. See shared/product-types.ts.
 */
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { claims, productVersions } from "@shared/schema";

/** Inclusive of both the admission and discharge day (a same-day admission+discharge counts
 *  as 1 day, matching how hospital cash plans conventionally count). */
export function daysBetweenInclusive(admissionDate: string, dischargeDate: string): number {
  const a = new Date(admissionDate + "T00:00:00Z");
  const b = new Date(dischargeDate + "T00:00:00Z");
  const diffDays = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return Math.max(0, diffDays) + 1;
}

export interface HospitalCashPayoutInput {
  rawDays: number;
  dailyRate: number;
  maxDaysPerClaim: number | null;
  /** Days already paid out on this policy elsewhere within the same policy-year, excluding the
   *  claim being computed (if editing an existing one). */
  usedDaysThisYear: number;
  maxDaysPerYear: number | null;
}

export interface HospitalCashPayoutResult {
  amount: string;
  days: number;
  cappedByPerClaim: boolean;
  cappedByPerYear: boolean;
}

/** Pure — no DB access, fully unit-testable. */
export function computeHospitalCashPayoutAmount(input: HospitalCashPayoutInput): HospitalCashPayoutResult {
  let days = Math.max(0, input.rawDays);
  let cappedByPerClaim = false;
  if (input.maxDaysPerClaim != null && days > input.maxDaysPerClaim) {
    days = input.maxDaysPerClaim;
    cappedByPerClaim = true;
  }

  let cappedByPerYear = false;
  if (input.maxDaysPerYear != null) {
    const remaining = Math.max(0, input.maxDaysPerYear - Math.max(0, input.usedDaysThisYear));
    if (days > remaining) {
      days = remaining;
      cappedByPerYear = true;
    }
  }

  const amount = (days * Math.max(0, input.dailyRate)).toFixed(2);
  return { amount, days, cappedByPerClaim, cappedByPerYear };
}

/** DB-touching wrapper: fetches the product version's daily rate/caps and prior same-year
 *  claims on this policy, then delegates the actual math to computeHospitalCashPayoutAmount. */
export async function computeHospitalCashPayout(
  orgId: string,
  productVersionId: string,
  currency: string,
  admissionDate: string,
  dischargeDate: string,
  policyId: string,
  excludeClaimId?: string,
): Promise<HospitalCashPayoutResult> {
  const tdb = await getDbForOrg(orgId);
  const [pv] = await tdb.select().from(productVersions).where(eq(productVersions.id, productVersionId)).limit(1);
  if (!pv) return { amount: "0.00", days: 0, cappedByPerClaim: false, cappedByPerYear: false };

  const dailyRate = currency === "ZAR"
    ? parseFloat(String((pv as any).dailyBenefitRateZar ?? 0))
    : parseFloat(String((pv as any).dailyBenefitRateUsd ?? 0));
  const maxDaysPerClaim = (pv as any).maxDaysPerClaim ?? null;
  const maxDaysPerYear = (pv as any).maxDaysPerYear ?? null;
  const rawDays = daysBetweenInclusive(admissionDate, dischargeDate);

  let usedDaysThisYear = 0;
  if (maxDaysPerYear != null) {
    const yearStart = admissionDate.slice(0, 4) + "-01-01";
    const yearEnd = admissionDate.slice(0, 4) + "-12-31";
    const conditions = [eq(claims.policyId, policyId), gte(claims.admissionDate, yearStart), lte(claims.admissionDate, yearEnd)];
    if (excludeClaimId) conditions.push(ne(claims.id, excludeClaimId));
    const priorClaims = await tdb
      .select({ admissionDate: claims.admissionDate, dischargeDate: claims.dischargeDate })
      .from(claims)
      .where(and(...conditions));
    for (const c of priorClaims) {
      if (c.admissionDate && c.dischargeDate) usedDaysThisYear += daysBetweenInclusive(c.admissionDate, c.dischargeDate);
    }
  }

  return computeHospitalCashPayoutAmount({ rawDays, dailyRate, maxDaysPerClaim, usedDaysThisYear, maxDaysPerYear });
}
