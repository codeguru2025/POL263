/**
 * IPEC statutory return (indicative) — assembles the data POL263 holds into the structure of a
 * Zimbabwe Insurance and Pensions Commission return for a life / funeral assurer: business
 * summary, revenue account, statement of financial position, prescribed-asset compliance and a
 * ZICARP-style capital-adequacy check.
 *
 * Insurance business only. A funeral parlour that also sells cash funerals shows that income and
 * its costs on a separate non-insurance line, never as premium. A funeral done under a policy is
 * the claim: it is valued at what it actually cost (paid requisitions linked to the funeral case),
 * and those costs move out of management expenses so nothing is counted twice (Augustus,
 * 2 Oct 2026). Policy funerals with no linked costs are counted but listed as not valued.
 *
 * IPEC does not publish the return template as a fillable form; this follows the line items in
 * IPEC's own published industry reports and the Insurance Act. Investment income, prescribed-asset
 * holdings and the ZICARP risk-based capital requirement are not in the system and come in as
 * params (flagged `manual`). Technical provisions default to the IFRS 17 (PAA) liabilities the
 * system computes, overridable by an actuary's figure. The return still needs an actuary's
 * sign-off — this is a working draft.
 *
 * Minimum capital (SI 67 of 2025): funeral-only USD 500,000; life USD 2,000,000. Prescribed
 * asset ratio: 15% of adjusted assets. Days are the tenant's local days.
 */
import { buildIncomeStatement, buildBalanceSheet, fxMapFor, consolidateToUsd, isCommissionPayoutCategory, isPol263Payment } from "./financial-statements";
import { buildIfrs17Movement } from "./ifrs17-movement";
import { buildInForceLives } from "./actuarial-export";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg } from "./date-utils";
import { storage } from "./storage";
import { sql } from "drizzle-orm";

export type InsurerClass = "funeral" | "life" | "composite";
export const MIN_CAPITAL_USD: Record<InsurerClass, number> = {
  funeral: 500_000,
  life: 2_000_000,
  composite: 2_000_000,
};
export const PRESCRIBED_ASSET_RATIO = 0.15;

export interface IpecReturnParams {
  from: string;
  to: string;
  asOf: string;
  branchId?: string;
  insurerClass?: InsurerClass;
  /** Manual figures the system does not hold. Flagged in the output. */
  manual?: {
    investmentIncome?: number;        // USD, period
    technicalProvisions?: number;     // USD, as of — overrides the IFRS 17 figure
    prescribedAssetsHeld?: number;    // USD, as of
    otherLiabilities?: number;        // USD, as of
    riskBasedCapitalRequirement?: number; // USD — ZICARP RBC; overrides the flat SI 67 minimum
  };
}

type AmountMap = Record<string, number>;
const round2 = (n: number) => Number(n.toFixed(2));
const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const addTo = (m: AmountMap, c: string, v: number) => { m[c] = (m[c] || 0) + v; };

/** Pure — split funeral-linked spending into policy funerals (the claim) and cash funerals
 *  (non-insurance), ignoring payments that are commission or POL263 (already handled elsewhere). */
export function splitFuneralCosts(rows: Array<{ serviceType: string | null; category: string | null; description: string | null; agentId?: string | null; currency: string; amount: number }>) {
  const policy: AmountMap = {}, cash: AmountMap = {};
  for (const r of rows) {
    if (isCommissionPayoutCategory(r.category, r.agentId) || isPol263Payment(r.category, r.description)) continue;
    addTo(r.serviceType === "claim" ? policy : cash, (r.currency || "USD").toUpperCase(), r.amount);
  }
  return { policy, cash };
}

export async function buildIpecReturn(orgId: string, params: IpecReturnParams) {
  const { from, to, asOf, branchId } = params;
  const insurerClass: InsurerClass = params.insurerClass ?? "funeral";
  const m = params.manual ?? {};
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);
  const usd = (map: AmountMap) => consolidateToUsd(map, fx).usd;
  const { start, endExclusive } = await dayRangeForOrg(orgId, from, to);

  const [is, bs, org, ifrs, lives, joinings] = await Promise.all([
    buildIncomeStatement(orgId, { from, to, branchId }),
    buildBalanceSheet(orgId, { asOf, branchId }),
    storage.getOrganization(orgId),
    buildIfrs17Movement(orgId, { from, to: asOf, branchId }),
    buildInForceLives(orgId, { asOf, branchId }),
    storage.getNewJoiningsReportByOrg(orgId, 100000, 0, { fromDate: from, toDate: to, ...(branchId ? { branchId } : {}) } as any),
  ]);

  // ── Business summary ──
  const [pifRow] = rowsOf<any>(await tdb.execute(sql`
    SELECT COUNT(*) AS in_force FROM policies
    WHERE organization_id = ${orgId} AND deleted_at IS NULL AND status IN ('active','grace')
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}`));
  const [lapseRow] = rowsOf<any>(await tdb.execute(sql`
    SELECT COUNT(DISTINCT psh.policy_id) AS lapses FROM policy_status_history psh JOIN policies p ON p.id = psh.policy_id
    WHERE p.organization_id = ${orgId} AND psh.to_status = 'lapsed'
      AND psh.created_at >= ${start} AND psh.created_at < ${endExclusive}
      ${branchId ? sql`AND p.branch_id = ${branchId}` : sql``}`));
  const newBusiness = joinings.filter((j) => !j.isLegacy).length;
  const legacyCaptured = joinings.filter((j) => j.isLegacy).length;

  // ── Revenue account (cash basis) ──
  const premiumMap: AmountMap = {};
  for (const mp of [is.income.premiumIndividual, is.income.premiumGroup, is.income.legacyGroupIncome]) for (const [c, v] of Object.entries(mp)) addTo(premiumMap, c, v as number);
  const grossPremiumWritten = usd(premiumMap);
  // Reinsurance premium ceded — the underwriter-payable schedule (monthly, per currency). Not a
  // true cession bordereau; shown as an estimate.
  const uwPayable = await storage.getUnderwriterPayableReport(orgId, 5000, 0, {}).catch(() => null);
  const cededMap: AmountMap = {};
  if (uwPayable) for (const [c, v] of Object.entries(uwPayable.summary.byCurrency)) addTo(cededMap, c, v.monthlyPayable);
  const reinsuranceCeded = usd(cededMap);
  const netPremiumWritten = grossPremiumWritten - reinsuranceCeded;
  const investmentIncome = m.investmentIncome ?? 0;

  // Spending linked to a funeral case, paid in the period (same payouts the income statement counts).
  const funeralSpend = rowsOf<any>(await tdb.execute(sql`
    SELECT f.service_type, rq.category, rq.description, rq.agent_id, d.currency, SUM(d.amount)::text AS total
    FROM payment_disbursements d
    JOIN requisitions rq ON d.entity_type = 'requisition' AND rq.id = d.entity_id
    JOIN funeral_cases f ON f.id = rq.funeral_case_id
    WHERE d.organization_id = ${orgId} AND d.paid_date >= ${from}::date AND d.paid_date <= ${to}::date
      ${branchId ? sql`AND d.branch_id = ${branchId}` : sql``}
    GROUP BY f.service_type, rq.category, rq.description, rq.agent_id, d.currency`));
  const funeralCosts = splitFuneralCosts(funeralSpend.map((r) => ({ serviceType: r.service_type, category: r.category, description: r.description, agentId: r.agent_id, currency: r.currency, amount: parseFloat(r.total) })));

  // Cash-in-lieu claims decided in the period (approved or later), and policy funerals.
  const [cil] = rowsOf<any>(await tdb.execute(sql`
    SELECT COALESCE(json_object_agg(currency, total) FILTER (WHERE currency IS NOT NULL), '{}') AS by_cur FROM (
      SELECT c.currency, SUM(c.cash_in_lieu_amount)::numeric AS total FROM claims c
      WHERE c.organization_id = ${orgId} AND c.cash_in_lieu_amount IS NOT NULL AND c.status NOT IN ('rejected','submitted','verified','under_investigation')
        AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${endExclusive}
        ${branchId ? sql`AND c.branch_id = ${branchId}` : sql``}
      GROUP BY c.currency) x`));
  const cashInLieuMap: AmountMap = Object.fromEntries(Object.entries((cil?.by_cur ?? {}) as Record<string, any>).map(([c, v]) => [c, Number(v)]));
  const claimsIncurredMap: AmountMap = { ...cashInLieuMap };
  for (const [c, v] of Object.entries(funeralCosts.policy)) addTo(claimsIncurredMap, c, v);
  const claimsIncurred = usd(claimsIncurredMap);

  const [funeralStats] = rowsOf<any>(await tdb.execute(sql`
    SELECT COUNT(*) AS policy_funerals,
           COUNT(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM requisitions rq WHERE rq.funeral_case_id = f.id AND rq.status = 'paid')) AS not_valued,
           COUNT(*) FILTER (WHERE f.claim_id IS NULL) AS without_claim,
           COUNT(*) FILTER (WHERE f.status = 'completed') AS completed,
           COUNT(*) FILTER (WHERE f.status <> 'completed') AS open,
           COALESCE(SUM(EXTRACT(EPOCH FROM (f.completed_at - f.created_at)) / 86400) FILTER (WHERE f.status = 'completed' AND f.completed_at IS NOT NULL AND f.claim_id IS NULL), 0) AS settle_days,
           COUNT(*) FILTER (WHERE f.status = 'completed' AND f.completed_at IS NOT NULL AND f.claim_id IS NULL) AS settle_n
    FROM funeral_cases f
    WHERE f.organization_id = ${orgId} AND f.service_type = 'claim' AND f.status <> 'cancelled'
      AND f.created_at >= ${start} AND f.created_at < ${endExclusive}
      ${branchId ? sql`AND f.branch_id = ${branchId}` : sql``}`));

  const commission = is.expenses.lines.filter((l) => l.source === "commission").reduce((s, l) => s + usd(l.amounts), 0);
  // Management expenses: everything else on the income statement except claims (counted above)
  // and the funeral costs that are claims (policy funerals) or non-insurance (cash funerals).
  const otherExpenses = is.expenses.lines.filter((l) => l.source !== "commission" && l.source !== "claims").reduce((s, l) => s + usd(l.amounts), 0);
  const policyFuneralCostUsd = usd(funeralCosts.policy);
  const cashFuneralCostUsd = usd(funeralCosts.cash);
  const managementExpenses = otherExpenses - policyFuneralCostUsd - cashFuneralCostUsd;
  const underwritingResult = netPremiumWritten + investmentIncome - claimsIncurred - commission - managementExpenses;

  const funeralServiceIncome = usd(is.income.cashServices);

  // ── Statement of financial position ──
  const totalAssets = bs.consolidatedUsd.totalAssets;
  const prescribedAssetsHeld = m.prescribedAssetsHeld ?? 0;
  const systemProvisions = usd(ifrs.lrc.closing) + usd(ifrs.lic.closing);
  const technicalProvisions = m.technicalProvisions ?? systemProvisions;
  const otherLiabilities = m.otherLiabilities ?? bs.consolidatedUsd.totalLiabilities;
  const totalLiabilities = technicalProvisions + otherLiabilities;
  const shareholdersFunds = totalAssets - totalLiabilities;

  // ── Prescribed asset compliance ──
  const adjustedAssets = totalAssets; // no prescribed exclusions modelled
  const prescribedAssetRatio = adjustedAssets > 0 ? prescribedAssetsHeld / adjustedAssets : 0;
  const prescribedAssetShortfall = Math.max(0, PRESCRIBED_ASSET_RATIO * adjustedAssets - prescribedAssetsHeld);

  // ── Capital adequacy (ZICARP — indicative) ──
  const minimumCapital = m.riskBasedCapitalRequirement ?? MIN_CAPITAL_USD[insurerClass];
  const availableCapital = shareholdersFunds;
  const capitalAdequacyRatio = minimumCapital > 0 ? availableCapital / minimumCapital : 0;

  // ── Claims analysis: claims raised, plus funerals done under a policy with no claim raised ──
  const [claimStats] = rowsOf<any>(await tdb.execute(sql`
    SELECT COUNT(*) AS reported,
           COUNT(*) FILTER (WHERE decided_at IS NOT NULL AND status NOT IN ('rejected')) AS settled,
           COUNT(*) FILTER (WHERE status = 'rejected') AS repudiated,
           COUNT(*) FILTER (WHERE decided_at IS NULL AND status <> 'rejected') AS outstanding,
           COALESCE(SUM(EXTRACT(EPOCH FROM (decided_at - created_at)) / 86400) FILTER (WHERE decided_at IS NOT NULL AND status <> 'rejected'), 0) AS settle_days
    FROM claims WHERE organization_id = ${orgId}
      AND created_at >= ${start} AND created_at < ${endExclusive}
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}`));
  const fWithout = parseInt(funeralStats.without_claim);
  const fWithoutCompleted = parseInt(funeralStats.settle_n);
  const settledCount = parseInt(claimStats.settled) + fWithoutCompleted;
  const settleDays = parseFloat(claimStats.settle_days) + parseFloat(funeralStats.settle_days);

  // ── Complaints ──
  const fb = await storage.getFeedbackByOrg(orgId, 5000, 0, { type: "complaint" }).catch(() => ({ rows: [] as any[] }));
  const complaintsInPeriod = fb.rows.filter((f: any) => f.createdAt && new Date(f.createdAt) >= start! && new Date(f.createdAt) < endExclusive!);
  const complaintsResolved = complaintsInPeriod.filter((f: any) => ["resolved", "closed"].includes(f.status)).length;

  return {
    meta: {
      insurer: org?.name ?? "—",
      insurerClass,
      period: { from, to },
      asOf,
      generatedAt: new Date().toISOString(),
      disclaimer: "Indicative working draft. Investment income, prescribed-asset holdings and the ZICARP risk-based capital requirement are manual inputs; technical provisions are the system's IFRS 17 (PAA) liabilities unless an actuary's figure is entered. Policy funerals are valued at what they cost. The return requires an actuary's sign-off before submission to IPEC.",
    },
    businessSummary: {
      policiesInForce: parseInt(pifRow.in_force),
      newPoliciesInPeriod: newBusiness,
      legacyPoliciesCapturedInPeriod: legacyCaptured,
      lapsesInPeriod: parseInt(lapseRow.lapses),
      livesCovered: lives.lives.length,
    },
    revenueAccount: {
      grossPremiumWritten: round2(grossPremiumWritten),
      reinsurancePremiumCeded: round2(reinsuranceCeded),
      reinsurancePremiumCededSource: "estimate",
      netPremiumWritten: round2(netPremiumWritten),
      investmentIncome: round2(investmentIncome),
      investmentIncomeSource: "manual",
      claimsIncurred: round2(claimsIncurred),
      claimsIncurredBreakdown: {
        cashInLieu: round2(usd(cashInLieuMap)),
        policyFuneralCosts: round2(policyFuneralCostUsd),
        policyFunerals: parseInt(funeralStats.policy_funerals),
        policyFuneralsNotValued: parseInt(funeralStats.not_valued),
      },
      commission: round2(commission),
      managementExpenses: round2(managementExpenses),
      underwritingResult: round2(underwritingResult),
      currency: "USD",
    },
    /** Cash funerals the parlour sells — not insurance, kept out of the revenue account. */
    nonInsuranceBusiness: {
      funeralServiceIncome: round2(funeralServiceIncome),
      funeralServiceCosts: round2(cashFuneralCostUsd),
      result: round2(funeralServiceIncome - cashFuneralCostUsd),
      currency: "USD",
    },
    financialPosition: {
      totalAssets: round2(totalAssets),
      prescribedAssetsHeld: round2(prescribedAssetsHeld),
      prescribedAssetsHeldSource: "manual",
      technicalProvisions: round2(technicalProvisions),
      technicalProvisionsSource: m.technicalProvisions != null ? "manual (actuary)" : "system (IFRS 17, PAA — unearned premium + incurred claims)",
      otherLiabilities: round2(otherLiabilities),
      totalLiabilities: round2(totalLiabilities),
      shareholdersFunds: round2(shareholdersFunds),
      currency: "USD",
    },
    prescribedAssets: {
      held: round2(prescribedAssetsHeld),
      adjustedAssets: round2(adjustedAssets),
      ratio: Number((prescribedAssetRatio * 100).toFixed(2)),
      minimumRatio: PRESCRIBED_ASSET_RATIO * 100,
      shortfall: round2(prescribedAssetShortfall),
      compliant: prescribedAssetRatio >= PRESCRIBED_ASSET_RATIO,
    },
    capitalAdequacy: {
      availableCapital: round2(availableCapital),
      minimumCapitalRequirement: round2(minimumCapital),
      minimumCapitalSource: m.riskBasedCapitalRequirement != null ? "ZICARP RBC (manual)" : `SI 67 of 2025 flat minimum (${insurerClass})`,
      capitalAdequacyRatio: Number((capitalAdequacyRatio * 100).toFixed(1)),
      compliant: availableCapital >= minimumCapital,
    },
    claimsAnalysis: {
      reported: parseInt(claimStats.reported) + fWithout,
      settled: settledCount,
      repudiated: parseInt(claimStats.repudiated),
      outstanding: parseInt(claimStats.outstanding) + (fWithout - fWithoutCompleted),
      averageSettlementDays: settledCount > 0 ? Number((settleDays / settledCount).toFixed(1)) : 0,
      policyFuneralsWithoutClaim: fWithout,
    },
    complaints: {
      received: complaintsInPeriod.length,
      resolved: complaintsResolved,
      outstanding: complaintsInPeriod.length - complaintsResolved,
    },
    unconvertibleCurrencies: bs.consolidatedUsd.unconvertible,
  };
}

export type IpecReturn = Awaited<ReturnType<typeof buildIpecReturn>>;
