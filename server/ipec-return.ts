/**
 * IPEC statutory return (indicative) — assembles the data POL263 holds into the structure of a
 * Zimbabwe Insurance and Pensions Commission return for a life / funeral assurer: business
 * summary, revenue account, statement of financial position, prescribed-asset compliance and a
 * ZICARP-style capital-adequacy check.
 *
 * IPEC does not publish the return template as a fillable form; this follows the line items in
 * IPEC's own published industry reports and the Insurance Act. Several figures are NOT in the
 * system and must be supplied by the finance team / actuary — investment income, technical
 * provisions (policyholder liabilities), prescribed-asset holdings, and the ZICARP risk-based
 * capital requirement. Those come in as params and every one is flagged in the output as
 * `manual`. The final return still needs an actuary's sign-off — this is a working draft.
 *
 * Minimum capital (SI 67 of 2025): funeral-only USD 500,000; life USD 2,000,000. Prescribed
 * asset ratio: 15% of adjusted assets.
 */
import { buildIncomeStatement, buildBalanceSheet, fxMapFor, consolidateToUsd } from "./financial-statements";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { claims } from "@shared/schema";
import { and, eq, gte, lte, sql } from "drizzle-orm";

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
  /** Manual figures the system does not hold. All default to 0 and are flagged in the output. */
  manual?: {
    investmentIncome?: number;        // USD, period
    technicalProvisions?: number;     // USD, as of
    prescribedAssetsHeld?: number;    // USD, as of
    otherLiabilities?: number;        // USD, as of
    riskBasedCapitalRequirement?: number; // USD — ZICARP RBC; overrides the flat SI 67 minimum
  };
}

const round2 = (n: number) => Number(n.toFixed(2));

export async function buildIpecReturn(orgId: string, params: IpecReturnParams) {
  const { from, to, asOf, branchId } = params;
  const insurerClass: InsurerClass = params.insurerClass ?? "funeral";
  const m = params.manual ?? {};
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);
  const usd = (map: Record<string, number>) => consolidateToUsd(map, fx).usd;

  const [is, bs, org] = await Promise.all([
    buildIncomeStatement(orgId, { from, to, branchId }),
    buildBalanceSheet(orgId, { asOf, branchId }),
    storage.getOrganization(orgId),
  ]);

  // ── Business summary ──
  const [pifRow] = await tdb.execute(sql`
    SELECT COUNT(*) FILTER (WHERE status IN ('active','grace')) AS in_force,
           COUNT(*) FILTER (WHERE inception_date >= ${from} AND inception_date <= ${to}) AS new_in_period
    FROM policies WHERE organization_id = ${orgId} AND deleted_at IS NULL`).then((r: any) => r.rows ?? r);
  const [lapseRow] = await tdb.execute(sql`
    SELECT COUNT(*) AS lapses FROM policy_status_history psh JOIN policies p ON p.id = psh.policy_id
    WHERE p.organization_id = ${orgId} AND psh.to_status = 'lapsed'
      AND psh.created_at >= ${new Date(from + "T00:00:00Z")} AND psh.created_at <= ${new Date(to + "T23:59:59Z")}`).then((r: any) => r.rows ?? r);
  const [livesRow] = await tdb.execute(sql`
    SELECT COUNT(*) AS lives FROM policy_members pm JOIN policies p ON p.id = pm.policy_id
    WHERE p.organization_id = ${orgId} AND pm.is_active = true AND p.status IN ('active','grace')`).then((r: any) => r.rows ?? r);

  // ── Revenue account (cash basis; underwriting result) ──
  const grossPremiumWritten = usd(is.income.total);
  // Reinsurance premium ceded — the underwriter-payable schedule (monthly amounts). Not a true
  // cession bordereau; shown as an estimate.
  const uwPayable = await storage.getUnderwriterPayableReport(orgId, 5000, 0, {}).catch(() => null);
  const reinsuranceCeded = uwPayable
    ? Object.values(uwPayable.summary.byCurrency).reduce((s, v) => s + v.monthlyPayable, 0)
    : 0;
  const netPremiumWritten = grossPremiumWritten - reinsuranceCeded;
  const investmentIncome = m.investmentIncome ?? 0;

  const claimRows = await tdb
    .select({ currency: claims.currency, status: claims.status, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}::numeric),0)`, n: sql<number>`COUNT(*)` })
    .from(claims)
    .where(and(eq(claims.organizationId, orgId), gte(claims.createdAt, new Date(from + "T00:00:00Z")), lte(claims.createdAt, new Date(to + "T23:59:59Z"))))
    .groupBy(claims.currency, claims.status);
  const claimsIncurredMap: Record<string, number> = {};
  for (const r of claimRows) {
    if (["approved", "paid", "settled", "closed"].includes(r.status)) claimsIncurredMap[r.currency] = (claimsIncurredMap[r.currency] || 0) + parseFloat(r.total);
  }
  const claimsIncurred = usd(claimsIncurredMap);

  const commission = is.expenses.lines.filter((l) => l.source === "commission").reduce((s, l) => s + usd(l.amounts), 0);
  const managementExpenses = is.expenses.lines.filter((l) => l.source !== "commission").reduce((s, l) => s + usd(l.amounts), 0);
  const underwritingResult = netPremiumWritten + investmentIncome - claimsIncurred - commission - managementExpenses;

  // ── Statement of financial position ──
  const totalAssets = bs.consolidatedUsd.totalAssets;
  const prescribedAssetsHeld = m.prescribedAssetsHeld ?? 0;
  const technicalProvisions = m.technicalProvisions ?? 0;
  const otherLiabilities = (m.otherLiabilities ?? bs.consolidatedUsd.totalLiabilities);
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

  // ── Claims analysis ──
  const [claimStats] = await tdb.execute(sql`
    SELECT COUNT(*) AS reported,
           COUNT(*) FILTER (WHERE status IN ('paid','settled','closed')) AS settled,
           COUNT(*) FILTER (WHERE status = 'rejected') AS repudiated,
           COUNT(*) FILTER (WHERE status = 'approved') AS outstanding,
           COALESCE(AVG(EXTRACT(DAY FROM (now() - created_at))) FILTER (WHERE status IN ('paid','settled','closed')), 0) AS avg_settle_days
    FROM claims WHERE organization_id = ${orgId}
      AND created_at >= ${new Date(from + "T00:00:00Z")} AND created_at <= ${new Date(to + "T23:59:59Z")}`).then((r: any) => r.rows ?? r);

  // ── Complaints ──
  const fb = await storage.getFeedbackByOrg(orgId, 5000, 0, { type: "complaint" }).catch(() => ({ rows: [] as any[] }));
  const complaintsInPeriod = fb.rows.filter((f: any) => {
    const d = f.createdAt ? new Date(f.createdAt).toISOString().slice(0, 10) : "";
    return d >= from && d <= to;
  });
  const complaintsResolved = complaintsInPeriod.filter((f: any) => ["resolved", "closed"].includes(f.status)).length;

  return {
    meta: {
      insurer: org?.name ?? "—",
      insurerClass,
      period: { from, to },
      asOf,
      generatedAt: new Date().toISOString(),
      disclaimer: "Indicative working draft. Investment income, technical provisions, prescribed-asset holdings and the ZICARP risk-based capital requirement are manual inputs; the return requires an actuary's sign-off before submission to IPEC.",
    },
    businessSummary: {
      policiesInForce: parseInt((pifRow as any).in_force),
      newPoliciesInPeriod: parseInt((pifRow as any).new_in_period),
      lapsesInPeriod: parseInt((lapseRow as any).lapses),
      livesCovered: parseInt((livesRow as any).lives),
    },
    revenueAccount: {
      grossPremiumWritten: round2(grossPremiumWritten),
      reinsurancePremiumCeded: round2(reinsuranceCeded),
      reinsurancePremiumCededSource: "estimate",
      netPremiumWritten: round2(netPremiumWritten),
      investmentIncome: round2(investmentIncome),
      investmentIncomeSource: "manual",
      claimsIncurred: round2(claimsIncurred),
      commission: round2(commission),
      managementExpenses: round2(managementExpenses),
      underwritingResult: round2(underwritingResult),
      currency: "USD",
    },
    financialPosition: {
      totalAssets: round2(totalAssets),
      prescribedAssetsHeld: round2(prescribedAssetsHeld),
      prescribedAssetsHeldSource: "manual",
      technicalProvisions: round2(technicalProvisions),
      technicalProvisionsSource: "manual",
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
      reported: parseInt((claimStats as any).reported),
      settled: parseInt((claimStats as any).settled),
      repudiated: parseInt((claimStats as any).repudiated),
      outstanding: parseInt((claimStats as any).outstanding),
      averageSettlementDays: Number(parseFloat((claimStats as any).avg_settle_days).toFixed(1)),
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
