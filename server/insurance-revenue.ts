/**
 * IFRS 17 (Premium Allocation Approach) insurance contract summary — additive alongside, not a
 * replacement for, the cash-basis statements in financial-statements.ts. Only product versions a
 * tenant's own auditor has explicitly classified measurementApproach = 'paa' are included; GMM/VFA
 * and unclassified business is deliberately excluded and reported separately (see
 * classification.excludedActivePolicyCount) rather than silently mismeasured.
 *
 * Earned revenue and the liability for remaining coverage (unearned premium) are both derived
 * by day-prorating each receipt's covered period against the requested window. The covered
 * period is payment_receipts.periodFrom/periodTo where stamped (advancePolicyCycle); receipts
 * without one (society group receipting, approved overrides/backdated receipts) cover
 * round(amount ÷ premium) premium periods from the tenant-local payment date — see
 * coveredPeriod().
 *
 * Deliberately NOT computed here: onerous-contract/loss-component testing and an IBNR estimate.
 * Both need an actuary-supplied assumption that doesn't exist in this system yet — the claims
 * liability below is labeled as excluding IBNR rather than guessing at one.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { fxMapFor, consolidateToUsd } from "./financial-statements";
import { getOrgTimezone, dateInTimezone } from "./date-utils";
import { policies, productVersions } from "@shared/schema";
import { roundMoney, toCents } from "@shared/money";

type AmountMap = Record<string, number>;

function add(map: AmountMap, currency: string, amount: number) {
  const c = (currency || "USD").toUpperCase();
  map[c] = (map[c] || 0) + amount;
}

const round2 = (m: AmountMap): AmountMap =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, roundMoney(v)]));

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

/** Normalizes a DATE-column value (a Date or an already-'YYYY-MM-DD' string depending on driver
 *  config) down to a plain 'YYYY-MM-DD' string. */
function toDateStr(v: unknown): string {
  return v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
}

/** Inclusive day count between two 'YYYY-MM-DD' strings (UTC midnights — offset-free). */
function daysBetweenInclusive(aStr: string, bStr: string): number {
  return Math.round(
    (Date.parse(bStr + "T00:00:00Z") - Date.parse(aStr + "T00:00:00Z")) / 86400000
  ) + 1;
}

function addDaysIso(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function addMonthsIso(d: string, n: number): string {
  const t = new Date(d + "T00:00:00Z");
  t.setUTCMonth(t.getUTCMonth() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * The days a receipt pays cover for. Its stamped period when there is one; otherwise
 * round(amount ÷ premium) premium periods (at least 1, at most a year's worth) starting on the
 * payment date — a USD 10 receipt on a USD 10/month policy covers one month from that day.
 * Pure — exported for tests.
 */
export function coveredPeriod(r: {
  periodFrom: string | null; periodTo: string | null; paidOn: string;
  amount: string | number; premium: string | number | null; schedule: string | null;
}): { from: string; to: string } {
  if (r.periodFrom && r.periodTo) return { from: r.periodFrom, to: r.periodTo };
  const premiumC = toCents(r.premium ?? 0);
  const schedule = (r.schedule || "monthly").toLowerCase();
  const perYear = schedule === "weekly" ? 52 : schedule === "biweekly" ? 26 : schedule === "yearly" || schedule === "annually" ? 1 : schedule === "quarterly" ? 4 : 12;
  const periods = premiumC > 0 ? Math.min(perYear, Math.max(1, Math.round(toCents(r.amount) / premiumC))) : 1;
  const start = r.paidOn;
  const end =
    schedule === "weekly" ? addDaysIso(start, 7 * periods - 1)
    : schedule === "biweekly" ? addDaysIso(start, 14 * periods - 1)
    : schedule === "yearly" || schedule === "annually" ? addDaysIso(addMonthsIso(start, 12 * periods), -1)
    : schedule === "quarterly" ? addDaysIso(addMonthsIso(start, 3 * periods), -1)
    : addDaysIso(addMonthsIso(start, periods), -1);
  return { from: start, to: end };
}

/**
 * Unearned part of a receipt at the end of day `d`: nothing before it was received; after that,
 * the share of its covered days still to come. Pure — exported for tests.
 */
export function unearnedAt(period: { from: string; to: string }, paidOn: string, amount: number, d: string): number {
  if (paidOn > d) return 0;
  if (period.to <= d) return 0;
  const total = daysBetweenInclusive(period.from, period.to);
  if (total <= 0) return 0;
  if (period.from > d) return amount;
  const remaining = daysBetweenInclusive(addDaysIso(d, 1), period.to);
  return amount * (remaining / total);
}

// ── Claims: one population and one valuation for the liability AND its movement ──

/** A claim is a liability from the day it's reported until it's paid, completed, closed or
 *  declined. Approved-but-unpaid (approved / payable) and service-not-yet-delivered (scheduled)
 *  claims are still owed. */
export const OPEN_CLAIM_STATUSES = ["submitted", "verified", "under_investigation", "approved", "payable", "scheduled"];
const openList = sql.raw(OPEN_CLAIM_STATUSES.map((s) => `'${s}'`).join(", "));

export interface PaaClaimRow { id: string; currency: string; value: number; inKind: boolean }

/** PAA claims (ledger-group claims excluded — funded from the group's own ledger), each valued at
 *  its cash-in-lieu amount, or for an in-kind funeral service the product's cash-in-lieu rate
 *  (child rate when the deceased was a child). Claims with no value at all contribute nothing.
 *  `where` narrows the population (see callers). */
export async function fetchPaaClaims(orgId: string, branchId: string | undefined, where: any): Promise<PaaClaimRow[]> {
  const tdb = await getDbForOrg(orgId);
  const rows = rowsOf<{ id: string; currency: string; cash: string | null; rel: string | null; adult: string | null; child: string | null }>(await tdb.execute(sql`
    SELECT c.id, c.currency, c.cash_in_lieu_amount AS cash, c.deceased_relationship AS rel,
           pv.cash_in_lieu_adult AS adult, pv.cash_in_lieu_child AS child
    FROM claims c
    JOIN policies p ON p.id = c.policy_id
    JOIN product_versions pv ON pv.id = p.product_version_id
    WHERE c.organization_id = ${orgId} AND pv.measurement_approach = 'paa' AND c.group_id IS NULL
      ${branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${branchId}` : sql``}
      AND ${where}`));
  const isChild = (rel: string | null) => /\b(child|son|daughter|minor)\b/i.test(rel || "");
  const out: PaaClaimRow[] = [];
  for (const r of rows) {
    const cash = r.cash != null ? parseFloat(String(r.cash)) : NaN;
    if (Number.isFinite(cash)) { if (cash > 0.005) out.push({ id: r.id, currency: r.currency || "USD", value: cash, inKind: false }); continue; }
    const rate = parseFloat(String((isChild(r.rel) ? r.child : r.adult) ?? ""));
    if (Number.isFinite(rate) && rate > 0.005) out.push({ id: r.id, currency: r.currency || "USD", value: rate, inKind: true });
  }
  return out;
}

/** SQL: the claim's status as at the end of `asOf` — its last transition on/before then; if every
 *  transition is later, the status the first one moved FROM; with no history, its current status. */
export function claimStatusAsOf(asOf: string) {
  const asOfExclusive = sql`(${asOf}::date + 1)`;
  return sql`COALESCE(
    (SELECT h.to_status FROM claim_status_history h WHERE h.claim_id = c.id AND h.created_at < ${asOfExclusive} ORDER BY h.created_at DESC LIMIT 1),
    (SELECT h.from_status FROM claim_status_history h WHERE h.claim_id = c.id AND h.created_at >= ${asOfExclusive} ORDER BY h.created_at ASC LIMIT 1),
    c.status
  )`;
}

/** SQL condition: reported by the end of `asOf` and still open then. */
export function claimOpenAt(asOf: string) {
  return sql`c.created_at < (${asOf}::date + 1) AND ${claimStatusAsOf(asOf)} IN (${openList})`;
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
  const tz = await getOrgTimezone(orgId);

  // A receipt only matters if its covered period ends on/after whichever is earlier of `from`
  // (earned-in-period) and `asOf` (unearned-as-of). Unstamped receipts are fetched by issue date
  // (up to a year before) and their period derived in JS.
  const earliestNeeded = from < asOf ? from : asOf;
  const receiptRows = rowsOf<{ amount: string; currency: string; period_from: unknown; period_to: unknown; issued_at: Date; premium: string | null; schedule: string | null }>(await tdb.execute(sql`
    SELECT r.amount, r.currency, r.period_from, r.period_to, r.issued_at, p.premium_amount AS premium, p.payment_schedule AS schedule
    FROM payment_receipts r
    JOIN policies p ON p.id = r.policy_id
    JOIN product_versions pv ON pv.id = p.product_version_id
    WHERE r.organization_id = ${orgId} AND r.status = 'issued'
      AND (r.approval_status IS NULL OR r.approval_status = 'approved')
      AND pv.measurement_approach = 'paa'
      AND (
        (r.period_from IS NOT NULL AND r.period_to IS NOT NULL AND r.period_to >= ${earliestNeeded})
        OR ((r.period_from IS NULL OR r.period_to IS NULL) AND r.issued_at >= (${earliestNeeded}::date - INTERVAL '13 months'))
      )
      ${branchId ? sql`AND r.branch_id = ${branchId}` : sql``}`));

  const earnedRevenue: AmountMap = {};
  const unearnedPremium: AmountMap = {};
  let derivedPeriods = 0;
  const dayBeforeFrom = addDaysIso(from, -1);

  for (const r of receiptRows) {
    const stamped = r.period_from != null && r.period_to != null;
    const paidOn = dateInTimezone(r.issued_at, tz);
    const period = coveredPeriod({
      periodFrom: stamped ? toDateStr(r.period_from) : null,
      periodTo: stamped ? toDateStr(r.period_to) : null,
      paidOn, amount: r.amount, premium: r.premium, schedule: r.schedule,
    });
    const amount = parseFloat(r.amount);
    const u = (d: string) => unearnedAt(period, paidOn, amount, d);
    if (!stamped && period.to >= earliestNeeded) derivedPeriods++;

    // Earned in [from, to] = what was unearned at the start (or the whole receipt, if it arrived
    // during the period) less what is still unearned at the end. Premium paid late for cover
    // already given is earned the day it's received.
    if (paidOn <= to) {
      const atStart = paidOn <= dayBeforeFrom ? u(dayBeforeFrom) : amount;
      const earned = atStart - u(to);
      if (Math.abs(earned) > 0.000001) add(earnedRevenue, r.currency, earned);
    }

    // ── Liability for remaining coverage: unexpired fraction as of `asOf` ──
    const unearned = u(asOf);
    if (unearned > 0) add(unearnedPremium, r.currency, unearned);
  }

  // ── Liability for incurred claims: reported and still open as of `asOf` (PAA only) ──
  const openClaims = await fetchPaaClaims(orgId, branchId, claimOpenAt(asOf));
  const incurredClaimsLiability: AmountMap = {};
  let inKindClaimsEstimated = 0;
  for (const c of openClaims) {
    add(incurredClaimsLiability, c.currency, c.value);
    if (c.inKind) inKindClaimsEstimated++;
  }

  // ── Classification coverage — how much of the active book this report actually speaks for ──
  const classConds: any[] = [eq(policies.organizationId, orgId), sql`${policies.status} != 'inactive'`, sql`${policies.deletedAt} IS NULL`];
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
      /** Receipts with no recorded covered period, spread over amount ÷ premium periods instead. */
      derivedPeriods,
    },
    liabilityForIncurredClaims: {
      total: round2(incurredClaimsLiability),
      consolidatedUsd: cClaims.usd,
      unconvertible: cClaims.unconvertible,
      excludesIbnr: true,
      inKindClaimsEstimated,
      note: "Reported claims still open (not yet paid, completed, closed or declined) as of the as-of date, PAA contracts only. Excludes IBNR — no actuarial IBNR loading has been configured for this tenant yet. " +
        (inKindClaimsEstimated > 0
          ? `Includes ${inKindClaimsEstimated} in-kind claim(s) valued at their product's cash-in-lieu rate (retail-equivalent estimate, not an actual cash payout).`
          : "No in-kind claims with a configured cash-in-lieu rate this period."),
    },
    classification: {
      paaPolicyCount,
      excludedActivePolicyCount,
      excludedByApproach, // e.g. { unclassified: 12, gmm: 3 }
      note: "Only 'paa'-classified product versions are included above. Policies on unclassified, GMM, or VFA product versions are excluded from these figures, not defaulted into them.",
    },
  };
}
