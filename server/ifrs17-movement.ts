/**
 * IFRS 17 (PAA) movement analysis — the roll-forward of the two insurance-contract liabilities
 * over a period, complementing the point-in-time snapshot in server/insurance-revenue.ts.
 *
 *  Liability for Remaining Coverage (LRC):
 *    opening LRC  +  premiums received  −  insurance revenue recognised  =  closing LRC
 *
 *  Liability for Incurred Claims (LIC):
 *    opening LIC  +  claims incurred (reported)  −  claims paid/settled  =  closing LIC
 *
 * LRC opening/closing reuse buildInsuranceContractSummary (day-prorated unearned premium from
 * payment_receipts.periodFrom/periodTo). LIC uses claim_status_history for the "settled in
 * period" figure. Same PAA-only scope and same "no IBNR — needs an actuarial assumption"
 * caveat as insurance-revenue.ts. A small residual on the LRC check comes from receipts whose
 * covered period straddles a period boundary; it is shown, not plugged.
 */
import { and, eq, sql, inArray, gte, lte } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { fxMapFor, consolidateToUsd } from "./financial-statements";
import { buildInsuranceContractSummary } from "./insurance-revenue";
import { paymentReceipts, policies, productVersions, claims, claimStatusHistory } from "@shared/schema";

type AmountMap = Record<string, number>;
const add = (m: AmountMap, c: string, v: number) => { const k = (c || "USD").toUpperCase(); m[k] = (m[k] || 0) + v; };
const round2 = (m: AmountMap): AmountMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed(2))]));
const dayBefore = (d: string) => new Date(new Date(d + "T00:00:00.000Z").getTime() - 86400000).toISOString().slice(0, 10);

export interface Ifrs17MovementParams { from: string; to: string; branchId?: string; }

export async function buildIfrs17Movement(orgId: string, params: Ifrs17MovementParams) {
  const { from, to, branchId } = params;
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);
  const usd = (m: AmountMap) => consolidateToUsd(m, fx).usd;
  const fromTs = new Date(from + "T00:00:00.000Z");
  const toTs = new Date(to + "T23:59:59.999Z");

  const [openingSummary, closingSummary] = await Promise.all([
    buildInsuranceContractSummary(orgId, { from: dayBefore(from), to: dayBefore(from), asOf: dayBefore(from), branchId }),
    buildInsuranceContractSummary(orgId, { from, to, asOf: to, branchId }),
  ]);

  // ── LRC movement ──
  const openingLrc: AmountMap = openingSummary.liabilityForRemainingCoverage.unearnedPremium;
  const closingLrc: AmountMap = closingSummary.liabilityForRemainingCoverage.unearnedPremium;
  const revenueRecognised: AmountMap = closingSummary.insuranceRevenue.earned;

  // Premiums received in the period on PAA-classified business.
  const premConds: any[] = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    eq(productVersions.measurementApproach, "paa"),
    gte(paymentReceipts.issuedAt, fromTs),
    lte(paymentReceipts.issuedAt, toTs),
  ];
  if (branchId) premConds.push(eq(paymentReceipts.branchId, branchId));
  const premRows = await tdb
    .select({ currency: paymentReceipts.currency, total: sql<string>`COALESCE(SUM(${paymentReceipts.amount}::numeric), 0)` })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .innerJoin(productVersions, eq(policies.productVersionId, productVersions.id))
    .where(and(...premConds))
    .groupBy(paymentReceipts.currency);
  const premiumsReceived: AmountMap = {};
  for (const r of premRows) { const v = parseFloat(r.total); if (Math.abs(v) > 0.004) add(premiumsReceived, r.currency, v); }

  const lrcExpectedClosing: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(openingLrc), ...Object.keys(premiumsReceived), ...Object.keys(revenueRecognised)]))) {
    lrcExpectedClosing[c] = (openingLrc[c] || 0) + (premiumsReceived[c] || 0) - (revenueRecognised[c] || 0);
  }
  const lrcResidual: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(lrcExpectedClosing), ...Object.keys(closingLrc)]))) {
    lrcResidual[c] = Number(((closingLrc[c] || 0) - (lrcExpectedClosing[c] || 0)).toFixed(2));
  }

  // ── LIC movement ──
  const openingLic: AmountMap = openingSummary.liabilityForIncurredClaims.total;
  const closingLic: AmountMap = closingSummary.liabilityForIncurredClaims.total;

  // Claims incurred (reported) in the period, PAA-classified.
  const incConds: any[] = [
    eq(claims.organizationId, orgId),
    gte(claims.createdAt, fromTs),
    lte(claims.createdAt, toTs),
    inArray(claims.status, ["submitted", "verified", "approved", "paid", "settled", "closed"]),
    sql`${claims.cashInLieuAmount} IS NOT NULL`,
  ];
  if (branchId) incConds.push(eq(claims.branchId, branchId));
  const incRows = await tdb
    .select({ currency: claims.currency, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}::numeric), 0)` })
    .from(claims)
    .where(and(...incConds))
    .groupBy(claims.currency);
  const claimsIncurred: AmountMap = {};
  for (const r of incRows) { const v = parseFloat(r.total); if (Math.abs(v) > 0.004) add(claimsIncurred, r.currency, v); }

  // Claims paid/settled in the period — from claim_status_history.
  const settledRows = await tdb
    .select({ currency: claims.currency, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}::numeric), 0)` })
    .from(claimStatusHistory)
    .innerJoin(claims, eq(claimStatusHistory.claimId, claims.id))
    .where(and(
      eq(claims.organizationId, orgId),
      inArray(claimStatusHistory.toStatus, ["paid", "settled", "closed"]),
      gte(claimStatusHistory.createdAt, fromTs),
      lte(claimStatusHistory.createdAt, toTs),
      sql`${claims.cashInLieuAmount} IS NOT NULL`,
      ...(branchId ? [eq(claims.branchId, branchId)] : []),
    ))
    .groupBy(claims.currency);
  const claimsPaid: AmountMap = {};
  for (const r of settledRows) { const v = parseFloat(r.total); if (Math.abs(v) > 0.004) add(claimsPaid, r.currency, v); }

  const licExpectedClosing: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(openingLic), ...Object.keys(claimsIncurred), ...Object.keys(claimsPaid)]))) {
    licExpectedClosing[c] = (openingLic[c] || 0) + (claimsIncurred[c] || 0) - (claimsPaid[c] || 0);
  }
  const licResidual: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(licExpectedClosing), ...Object.keys(closingLic)]))) {
    licResidual[c] = Number(((closingLic[c] || 0) - (licExpectedClosing[c] || 0)).toFixed(2));
  }

  const currencies = Array.from(new Set([
    ...Object.keys(openingLrc), ...Object.keys(closingLrc), ...Object.keys(openingLic), ...Object.keys(closingLic),
  ])).sort();

  return {
    from, to, branchId: branchId ?? null,
    lrc: {
      opening: round2(openingLrc),
      premiumsReceived: round2(premiumsReceived),
      revenueRecognised: round2(revenueRecognised),
      expectedClosing: round2(lrcExpectedClosing),
      closing: round2(closingLrc),
      residual: lrcResidual,
      consolidatedUsd: {
        opening: usd(openingLrc), premiumsReceived: usd(premiumsReceived),
        revenueRecognised: usd(revenueRecognised), closing: usd(closingLrc),
      },
    },
    lic: {
      opening: round2(openingLic),
      claimsIncurred: round2(claimsIncurred),
      claimsPaid: round2(claimsPaid),
      expectedClosing: round2(licExpectedClosing),
      closing: round2(closingLic),
      residual: licResidual,
      consolidatedUsd: {
        opening: usd(openingLic), claimsIncurred: usd(claimsIncurred),
        claimsPaid: usd(claimsPaid), closing: usd(closingLic),
      },
    },
    currencies,
    classification: closingSummary.classification,
    note: "PAA-classified business only. LRC opening/closing are day-prorated unearned premium; the residual on the LRC check is from receipts whose covered period straddles a period boundary. LIC excludes IBNR — no actuarial IBNR loading is configured for this tenant.",
  };
}
