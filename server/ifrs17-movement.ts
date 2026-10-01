/**
 * IFRS 17 (PAA) movement analysis — the roll-forward of the two insurance-contract liabilities
 * over a period, complementing the point-in-time snapshot in server/insurance-revenue.ts.
 *
 *  Liability for Remaining Coverage (LRC):
 *    opening LRC  +  premiums received  −  insurance revenue recognised  =  closing LRC
 *
 *  Liability for Incurred Claims (LIC):
 *    opening LIC  +  claims reported  −  claims settled (paid / completed / closed) − declined
 *      =  closing LIC
 *
 * Both sides use exactly the rules of insurance-revenue.ts (same receipt covered periods, same
 * claim population and valuation, same "open" statuses), so each roll-forward adds up exactly —
 * the residual is reported and should be zero. Excludes IBNR (needs an actuarial assumption).
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { fxMapFor, consolidateToUsd } from "./financial-statements";
import { buildInsuranceContractSummary, fetchPaaClaims, claimOpenAt, claimStatusAsOf } from "./insurance-revenue";
import { dayRangeForOrg } from "./date-utils";
import { roundMoney } from "@shared/money";

type AmountMap = Record<string, number>;
const add = (m: AmountMap, c: string, v: number) => { const k = (c || "USD").toUpperCase(); m[k] = (m[k] || 0) + v; };
const round2 = (m: AmountMap): AmountMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, roundMoney(v)]));
const dayBefore = (d: string) => new Date(new Date(d + "T00:00:00.000Z").getTime() - 86400000).toISOString().slice(0, 10);
const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

export interface Ifrs17MovementParams { from: string; to: string; branchId?: string; }

/** closing − (opening + in − out), per currency. */
function residualOf(opening: AmountMap, inflow: AmountMap, outflow: AmountMap, closing: AmountMap): AmountMap {
  const out: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(opening), ...Object.keys(inflow), ...Object.keys(outflow), ...Object.keys(closing)]))) {
    out[c] = roundMoney((closing[c] || 0) - ((opening[c] || 0) + (inflow[c] || 0) - (outflow[c] || 0)));
  }
  return out;
}
const expected = (opening: AmountMap, inflow: AmountMap, outflow: AmountMap): AmountMap => {
  const out: AmountMap = {};
  for (const c of Array.from(new Set([...Object.keys(opening), ...Object.keys(inflow), ...Object.keys(outflow)]))) {
    out[c] = (opening[c] || 0) + (inflow[c] || 0) - (outflow[c] || 0);
  }
  return round2(out);
};

export async function buildIfrs17Movement(orgId: string, params: Ifrs17MovementParams) {
  const { from, to, branchId } = params;
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);
  const usd = (m: AmountMap) => consolidateToUsd(m, fx).usd;
  const opened = dayBefore(from);
  const { start, endExclusive } = await dayRangeForOrg(orgId, from, to);

  const [openingSummary, closingSummary] = await Promise.all([
    buildInsuranceContractSummary(orgId, { from: opened, to: opened, asOf: opened, branchId }),
    buildInsuranceContractSummary(orgId, { from, to, asOf: to, branchId }),
  ]);

  // ── LRC movement ──
  const openingLrc: AmountMap = openingSummary.liabilityForRemainingCoverage.unearnedPremium;
  const closingLrc: AmountMap = closingSummary.liabilityForRemainingCoverage.unearnedPremium;
  const revenueRecognised: AmountMap = closingSummary.insuranceRevenue.earned;
  const premRows = rowsOf<{ currency: string; total: string }>(await tdb.execute(sql`
    SELECT r.currency, COALESCE(SUM(r.amount), 0)::text AS total
    FROM payment_receipts r
    JOIN policies p ON p.id = r.policy_id
    JOIN product_versions pv ON pv.id = p.product_version_id
    WHERE r.organization_id = ${orgId} AND r.status = 'issued'
      AND (r.approval_status IS NULL OR r.approval_status = 'approved')
      AND pv.measurement_approach = 'paa'
      AND r.issued_at >= ${start!} AND r.issued_at < ${endExclusive!}
      ${branchId ? sql`AND r.branch_id = ${branchId}` : sql``}
    GROUP BY r.currency`));
  const premiumsReceived: AmountMap = {};
  for (const r of premRows) { const v = parseFloat(r.total); if (Math.abs(v) > 0.004) add(premiumsReceived, r.currency, v); }

  // ── LIC movement — the same claims, valued the same way, as the opening/closing balances ──
  const [openingClaims, reportedClaims, closingClaims] = await Promise.all([
    fetchPaaClaims(orgId, branchId, claimOpenAt(opened)),
    fetchPaaClaims(orgId, branchId, sql`c.created_at >= ${from}::date AND c.created_at < (${to}::date + 1)`),
    fetchPaaClaims(orgId, branchId, claimOpenAt(to)),
  ]);
  const sum = (rows: { currency: string; value: number }[]) => { const m: AmountMap = {}; for (const r of rows) add(m, r.currency, r.value); return round2(m); };
  const openingLic = sum(openingClaims);
  const claimsReported = sum(reportedClaims);
  const closingLic = sum(closingClaims);

  // Claims that were owed at the start or reported during the period and are no longer open:
  // split into settled (paid / completed / closed) and declined, by their status at the end.
  const stillOpen = new Set(closingClaims.map((c) => c.id));
  const left = new Map<string, { currency: string; value: number }>();
  for (const c of [...openingClaims, ...reportedClaims]) if (!stillOpen.has(c.id)) left.set(c.id, c);
  const leftIds = Array.from(left.keys());
  const declinedIds = new Set<string>();
  if (leftIds.length) {
    const rows = rowsOf<{ id: string }>(await tdb.execute(sql`
      SELECT c.id FROM claims c WHERE c.id = ANY(${leftIds}::uuid[]) AND ${claimStatusAsOf(to)} = 'rejected'`));
    for (const r of rows) declinedIds.add(r.id);
  }
  const claimsSettled: AmountMap = {};
  const claimsDeclined: AmountMap = {};
  for (const [id, c] of Array.from(left.entries())) add(declinedIds.has(id) ? claimsDeclined : claimsSettled, c.currency, c.value);
  const claimsOut: AmountMap = {};
  for (const m of [claimsSettled, claimsDeclined]) for (const [c, v] of Object.entries(m)) add(claimsOut, c, v);

  const currencies = Array.from(new Set([
    ...Object.keys(openingLrc), ...Object.keys(closingLrc), ...Object.keys(premiumsReceived),
    ...Object.keys(openingLic), ...Object.keys(closingLic), ...Object.keys(claimsReported),
  ])).sort();

  const classification = closingSummary.classification;
  return {
    from, to, branchId: branchId ?? null,
    lrc: {
      opening: round2(openingLrc),
      premiumsReceived: round2(premiumsReceived),
      revenueRecognised: round2(revenueRecognised),
      expectedClosing: expected(openingLrc, premiumsReceived, revenueRecognised),
      closing: round2(closingLrc),
      residual: residualOf(openingLrc, premiumsReceived, revenueRecognised, closingLrc),
      derivedPeriods: closingSummary.liabilityForRemainingCoverage.derivedPeriods,
      consolidatedUsd: {
        opening: usd(openingLrc), premiumsReceived: usd(premiumsReceived),
        revenueRecognised: usd(revenueRecognised), closing: usd(closingLrc),
      },
    },
    lic: {
      opening: openingLic,
      claimsIncurred: claimsReported,
      claimsPaid: round2(claimsSettled),
      claimsDeclined: round2(claimsDeclined),
      expectedClosing: expected(openingLic, claimsReported, claimsOut),
      closing: closingLic,
      residual: residualOf(openingLic, claimsReported, claimsOut, closingLic),
      consolidatedUsd: {
        opening: usd(openingLic), claimsIncurred: usd(claimsReported),
        claimsPaid: usd(claimsSettled), claimsDeclined: usd(claimsDeclined), closing: usd(closingLic),
      },
    },
    currencies,
    classification,
    /** No product is classified for IFRS 17 yet — every figure above is necessarily zero. */
    nothingClassified: classification.paaPolicyCount === 0,
    note: "Products classified under the Premium Allocation Approach (PAA) only. Unearned premium is each receipt's covered period still to come; receipts with no recorded period are spread over amount ÷ premium periods from the payment date. Claims are owed from the day they're reported until paid, completed, closed or declined; in-kind funeral claims are valued at the product's cash-in-lieu rate. Excludes IBNR — no actuarial IBNR loading is configured.",
  };
}
