/**
 * IFRS 17 (Premium Allocation Approach) insurance contract summary — additive alongside, not a
 * replacement for, the cash-basis statements in financial-statements.ts. Only product versions a
 * tenant's own auditor has explicitly classified measurementApproach = 'paa' are included; GMM/VFA
 * and unclassified business is deliberately excluded and reported separately (see
 * classification.excludedActivePolicyCount) rather than silently mismeasured.
 *
 * Earned revenue and the liability for remaining coverage (unearned premium) are both derived
 * from payment_receipts.periodFrom/periodTo — already stamped per receipt by
 * advancePolicyCycle() (server/policy-status-on-payment.ts) — by day-prorating each receipt's
 * covered period against the requested window. No new ledger, no backfill.
 *
 * Deliberately NOT computed here (see docs/... IFRS 17 review, §16 Tier 1 scope): onerous-
 * contract/loss-component testing and an IBNR estimate. Both need an actuary-supplied assumption
 * that doesn't exist in this system yet — the claims liability below is labeled as excluding IBNR
 * rather than guessing at one.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { fxMapFor, consolidateToUsd } from "./financial-statements";
import { paymentReceipts, policies, productVersions, claims } from "@shared/schema";

type AmountMap = Record<string, number>;

function add(map: AmountMap, currency: string, amount: number) {
  const c = (currency || "USD").toUpperCase();
  map[c] = (map[c] || 0) + amount;
}

const round2 = (m: AmountMap): AmountMap =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed(2))]));

/** Normalizes a DATE-column value (which may come back as a Date or an already-'YYYY-MM-DD'
 *  string depending on driver config — other modules in this codebase have the same ambiguity,
 *  see buildTransactionLedger's String(d.paidDate)) down to a plain 'YYYY-MM-DD' string. */
function toDateStr(v: unknown): string {
  return String(v).slice(0, 10);
}

/** Inclusive day count between two 'YYYY-MM-DD' strings. Safe to build local-midnight Date
 *  objects here (unlike single-date arithmetic elsewhere in this codebase) because this only
 *  ever takes the *difference* of two such timestamps — a host timezone offset shifts both terms
 *  identically and cancels out exactly (same reasoning as daysBetween in policy-status-on-payment.ts). */
function daysBetweenInclusive(aStr: string, bStr: string): number {
  return Math.round(
    (new Date(bStr + "T00:00:00").getTime() - new Date(aStr + "T00:00:00").getTime()) / 86400000
  ) + 1;
}

export interface InsuranceContractSummaryParams {
  from: string;   // YYYY-MM-DD — start of the period earned revenue is measured over
  to: string;     // YYYY-MM-DD — end of that period
  asOf: string;   // YYYY-MM-DD — point-in-time date the liability for remaining coverage is measured as of
  branchId?: string;
}

export async function buildInsuranceContractSummary(orgId: string, params: InsuranceContractSummaryParams) {
  const { from, to, asOf, branchId } = params;
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);

  // Fetch window: a receipt only matters to this report if its covered period ends on/after
  // whichever is earlier of `from` (earned-in-period) and `asOf` (unearned-as-of) — anything
  // that ended before both is fully earned and irrelevant to either figure. Fetching this
  // superset and doing the exact per-row day-math in JS avoids re-deriving date arithmetic in SQL.
  const earliestNeeded = from < asOf ? from : asOf;

  const receiptConds: any[] = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    eq(productVersions.measurementApproach, "paa"),
    sql`${paymentReceipts.periodFrom} IS NOT NULL`,
    sql`${paymentReceipts.periodTo} IS NOT NULL`,
    sql`${paymentReceipts.periodTo} >= ${earliestNeeded}`,
  ];
  if (branchId) receiptConds.push(eq(paymentReceipts.branchId, branchId));

  const receiptRows = await tdb
    .select({
      amount: paymentReceipts.amount,
      currency: paymentReceipts.currency,
      periodFrom: paymentReceipts.periodFrom,
      periodTo: paymentReceipts.periodTo,
    })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
    .where(and(...receiptConds));

  const earnedRevenue: AmountMap = {};
  const unearnedPremium: AmountMap = {};

  for (const r of receiptRows) {
    const periodFrom = toDateStr(r.periodFrom);
    const periodTo = toDateStr(r.periodTo);
    const cycleDaysTotal = daysBetweenInclusive(periodFrom, periodTo);
    if (cycleDaysTotal <= 0) continue; // malformed period — skip rather than divide by zero
    const amount = parseFloat(r.amount);

    // ── Earned revenue: overlap of [periodFrom, periodTo] with [from, to] ──
    const overlapStart = periodFrom > from ? periodFrom : from;
    const overlapEnd = periodTo < to ? periodTo : to;
    const overlapDays = daysBetweenInclusive(overlapStart, overlapEnd);
    if (overlapDays > 0) {
      add(earnedRevenue, r.currency, amount * (overlapDays / cycleDaysTotal));
    }

    // ── Liability for remaining coverage: unexpired fraction as of `asOf` ──
    if (periodTo >= asOf) {
      const earnedDaysAsOf = Math.min(cycleDaysTotal, Math.max(0, daysBetweenInclusive(periodFrom, asOf)));
      const unearnedDays = cycleDaysTotal - earnedDaysAsOf;
      if (unearnedDays > 0) {
        add(unearnedPremium, r.currency, amount * (unearnedDays / cycleDaysTotal));
      }
    }
  }

  // ── Liability for incurred claims (widened from the operational balance sheet's
  // status='approved'-only line — includes reported-not-yet-approved claims too — but still not
  // an IBNR estimate; that needs an actuarial assumption this system doesn't have yet). ──
  const claimConds: any[] = [
    eq(claims.organizationId, orgId),
    sql`${claims.status} IN ('submitted', 'verified', 'approved')`,
    sql`${claims.cashInLieuAmount} IS NOT NULL`,
  ];
  if (branchId) claimConds.push(eq(claims.branchId, branchId));
  const claimRows = await tdb
    .select({ currency: claims.currency, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}), '0')` })
    .from(claims)
    .where(and(...claimConds))
    .groupBy(claims.currency);
  const incurredClaimsLiability: AmountMap = {};
  for (const r of claimRows) {
    const amt = parseFloat(r.total);
    if (amt > 0.005) add(incurredClaimsLiability, r.currency, amt);
  }

  // ── Classification coverage — how much of the active book this report actually speaks for ──
  const classConds: any[] = [eq(policies.organizationId, orgId), sql`${policies.status} != 'inactive'`];
  if (branchId) classConds.push(eq(policies.branchId, branchId));
  const classRows = await tdb
    .select({
      measurementApproach: productVersions.measurementApproach,
      count: sql<string>`COUNT(*)`,
    })
    .from(policies)
    .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
    .where(and(...classConds))
    .groupBy(productVersions.measurementApproach);

  let paaPolicyCount = 0;
  let excludedActivePolicyCount = 0;
  const excludedByApproach: Record<string, number> = {};
  for (const r of classRows) {
    const n = parseInt(r.count, 10);
    if (r.measurementApproach === "paa") {
      paaPolicyCount += n;
    } else {
      excludedActivePolicyCount += n;
      const key = r.measurementApproach ?? "unclassified";
      excludedByApproach[key] = (excludedByApproach[key] || 0) + n;
    }
  }

  const cEarned = consolidateToUsd(earnedRevenue, fx);
  const cUnearned = consolidateToUsd(unearnedPremium, fx);
  const cClaims = consolidateToUsd(incurredClaimsLiability, fx);

  return {
    from, to, asOf, branchId: branchId ?? null,
    insuranceRevenue: {
      earned: round2(earnedRevenue),
      consolidatedUsd: cEarned.usd,
      unconvertible: cEarned.unconvertible,
    },
    liabilityForRemainingCoverage: {
      unearnedPremium: round2(unearnedPremium),
      consolidatedUsd: cUnearned.usd,
      unconvertible: cUnearned.unconvertible,
      basis: "paa_unexpired_fraction" as const,
    },
    liabilityForIncurredClaims: {
      total: round2(incurredClaimsLiability),
      consolidatedUsd: cClaims.usd,
      unconvertible: cClaims.unconvertible,
      excludesIbnr: true,
      note: "Reported claims only (submitted/verified/approved). Excludes IBNR — no actuarial IBNR loading has been configured for this tenant yet.",
    },
    classification: {
      paaPolicyCount,
      excludedActivePolicyCount,
      excludedByApproach, // e.g. { unclassified: 12, gmm: 3 }
      note: "Only 'paa'-classified product versions are included above. Policies on unclassified, GMM, or VFA product versions are excluded from these figures, not defaulted into them.",
    },
  };
}
