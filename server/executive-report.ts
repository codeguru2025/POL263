/**
 * Executive Tenant Report — one page pulling together every module (financials, policies,
 * funeral services, quotes/conversion, mortuary, fleet, claims) for a date range, with real
 * time-series/breakdown data for charts, not just single-period totals. Mirrors the module-gating
 * convention in daily-report.ts (skip the query entirely, not just hide the section, when a
 * module doesn't apply to this tenant — see server/org-capabilities.ts) and reuses
 * buildExecutiveSummary/buildIncomeStatement rather than re-deriving their SQL.
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { getTenantCapabilities, hasModuleCapability } from "./org-capabilities";
import { buildIncomeStatement, buildCashFlowStatement, buildIncomeTimeSeries, buildExecutiveSummary } from "./financial-statements";
import { computeClaimAgeDays, isClaimOverdue } from "./claims-sla";
import { effectiveLeadStage, PIPELINE_STAGES } from "@shared/lead-pipeline";
import { funeralCases, mortuaryIntakes, leads } from "@shared/schema";

export interface ExecutiveReportParams {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  branchId?: string;
}

function fromTs(date: string) { return new Date(date + "T00:00:00.000Z"); }
function toTs(date: string) { return new Date(date + "T23:59:59.999Z"); }
const rowsOf = (r: any): any[] => r.rows ?? r;

export async function buildExecutiveReport(orgId: string, params: ExecutiveReportParams) {
  const { from, to, branchId } = params;
  const tdb = await getDbForOrg(orgId);
  const caps = await getTenantCapabilities(orgId);
  const hasFuneralOps = hasModuleCapability(caps, "funeral_ops");
  const hasClaims = hasModuleCapability(caps, "claims");
  const hasFleet = hasModuleCapability(caps, "fleet");

  const [incomeStatement, cashFlow, incomeTimeSeries, execSummary] = await Promise.all([
    buildIncomeStatement(orgId, { from, to, branchId }),
    buildCashFlowStatement(orgId, { from, to, branchId }),
    buildIncomeTimeSeries(orgId, { from, to, branchId }),
    // Reused wholesale rather than re-deriving: branchBreakdown, claimStats, newPoliciesCount,
    // countryFlag (SA vs home split — gated on countryFlagSettings.isEnabled inside).
    buildExecutiveSummary(orgId, { from, to, branchId }),
  ]);

  // The 14 queries below are all independent of each other (same orgId/from/to/branchId, no
  // query depends on another's result) but were previously awaited one at a time — a report
  // covering financials/funerals/quotes/mortuary/fleet/claims doing 14+ sequential round-trips.
  // Batched into one Promise.all instead (not unbounded in the sense today's
  // batchRecalculatePolicyPremiums fix had to guard against — these are all reads, no lock
  // contention, unlike that fix's per-policy UPDATE fan-out).
  const [
    productRevenueRows,
    funeralByType,
    funeralByBranchRows,
    funeralByLocationRows,
    crossBorderSplitRows,
    funeralTrendRows,
    quoteStatsRows,
    leadRows,
    mortuaryByScope,
    revenueByStreamRows,
    storageFeeRows,
    chapelFeeRows,
    fuelCostRows,
    maintenanceCostRows,
    openClaimsRows,
  ] = await Promise.all([
    // ── Policies: revenue by product ──
    tdb.execute(sql`
      SELECT p.id AS product_id, p.name AS product_name, pr.currency,
             COALESCE(SUM(pr.amount::numeric), 0) AS revenue,
             COUNT(DISTINCT pr.policy_id) AS policy_count
      FROM payment_receipts pr
      JOIN policies pol ON pol.id = pr.policy_id
      JOIN product_versions pv ON pv.id = pol.product_version_id
      JOIN products p ON p.id = pv.product_id
      WHERE pr.organization_id = ${orgId} AND pr.status = 'issued'
        AND pr.issued_at >= ${fromTs(from)} AND pr.issued_at <= ${toTs(to)}
        ${branchId ? sql`AND pr.branch_id = ${branchId}` : sql``}
      GROUP BY p.id, p.name, pr.currency
      ORDER BY revenue DESC
    `),
    // ── Funeral services (module: funeral_ops) — count/trend by service type (cash/claim),
    // by branch, and cross-border split. Counted by funeralDate ("conducted" date), not
    // createdAt (case-opened date) — a case can be opened well before or after the burial. ──
    !hasFuneralOps ? [] : tdb
      .select({ serviceType: funeralCases.serviceType, count: sql<number>`count(*)` })
      .from(funeralCases)
      .where(and(
        eq(funeralCases.organizationId, orgId),
        gte(funeralCases.funeralDate, from),
        lte(funeralCases.funeralDate, to),
        ...(branchId ? [eq(funeralCases.branchId, branchId)] : []),
      ))
      .groupBy(funeralCases.serviceType),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT fc.branch_id, b.name AS branch_name, COUNT(*) AS count
      FROM funeral_cases fc
      LEFT JOIN branches b ON b.id = fc.branch_id
      WHERE fc.organization_id = ${orgId}
        AND fc.funeral_date >= ${from} AND fc.funeral_date <= ${to}
        ${branchId ? sql`AND fc.branch_id = ${branchId}` : sql``}
      GROUP BY fc.branch_id, b.name
      ORDER BY count DESC
    `),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT funeral_location AS location, COUNT(*) AS count
      FROM funeral_cases
      WHERE organization_id = ${orgId} AND funeral_location IS NOT NULL
        AND funeral_date >= ${from} AND funeral_date <= ${to}
        ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      GROUP BY funeral_location
      ORDER BY count DESC
      LIMIT 10
    `),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT is_cross_border_flag AS flagged, COUNT(*) AS count
      FROM funeral_cases
      WHERE organization_id = ${orgId}
        AND funeral_date >= ${from} AND funeral_date <= ${to}
        ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      GROUP BY is_cross_border_flag
    `),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT funeral_date AS date, service_type, COUNT(*) AS count
      FROM funeral_cases
      WHERE organization_id = ${orgId}
        AND funeral_date >= ${from} AND funeral_date <= ${to}
        ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
      GROUP BY funeral_date, service_type
      ORDER BY funeral_date ASC
    `),
    // ── Quotes / conversion (funeral quotations — the exact "how many quotes, how many
    // converted" metric) ──
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT conversion_status, currency, COUNT(*) AS count, COALESCE(SUM(grand_total::numeric), 0) AS value
      FROM funeral_quotations
      WHERE organization_id = ${orgId}
        AND created_at >= ${fromTs(from)} AND created_at <= ${toTs(to)}
      GROUP BY conversion_status, currency
    `),
    // ── Lead funnel (insurance quote/lead pipeline, distinct from funeral quotations above) —
    // only surfaced if the tenant has any leads rows at all, since not every tenant sells this way. ──
    tdb
      .select({ id: leads.id, stage: leads.stage })
      .from(leads)
      .where(and(
        eq(leads.organizationId, orgId),
        gte(leads.createdAt, fromTs(from)),
        lte(leads.createdAt, toTs(to)),
        ...(branchId ? [eq(leads.branchId, branchId)] : []),
      )),
    // ── Mortuary (module: funeral_ops) ──
    !hasFuneralOps ? [] : tdb
      .select({ serviceScope: mortuaryIntakes.serviceScope, count: sql<number>`count(*)` })
      .from(mortuaryIntakes)
      .where(and(
        eq(mortuaryIntakes.organizationId, orgId),
        gte(mortuaryIntakes.createdAt, fromTs(from)),
        lte(mortuaryIntakes.createdAt, toTs(to)),
        ...(branchId ? [eq(mortuaryIntakes.branchId, branchId)] : []),
      ))
      .groupBy(mortuaryIntakes.serviceScope),
    // Revenue by stream — the itemized breakdown (storage/chapel/wash-bay/body-wash/transport/
    // etc.) the report explicitly needs. Primary source; the storage/chapel fee columns below are
    // cross-check KPI tiles only, to avoid double-counting the same revenue two ways.
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT csc.service_key, csc.currency, COALESCE(SUM(csc.computed_amount::numeric), 0) AS revenue, COUNT(*) AS count
      FROM case_service_charges csc
      WHERE csc.organization_id = ${orgId} AND csc.status = 'paid'
        AND csc.paid_at >= ${fromTs(from)} AND csc.paid_at <= ${toTs(to)}
      GROUP BY csc.service_key, csc.currency
      ORDER BY revenue DESC
    `),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT storage_fee_currency AS currency, COALESCE(SUM(storage_fee_amount::numeric), 0) AS total
      FROM mortuary_intakes
      WHERE organization_id = ${orgId}
        AND storage_fee_status IN ('paid_at_admission', 'paid_at_collection')
        AND storage_fee_paid_at >= ${fromTs(from)} AND storage_fee_paid_at <= ${toTs(to)}
      GROUP BY storage_fee_currency
    `),
    !hasFuneralOps ? [] : tdb.execute(sql`
      SELECT chapel_wash_bay_fee_currency AS currency, COALESCE(SUM(chapel_wash_bay_fee_amount::numeric), 0) AS total
      FROM mortuary_dispatches
      WHERE organization_id = ${orgId} AND chapel_wash_bay_fee_status = 'paid'
        AND chapel_wash_bay_fee_paid_at >= ${fromTs(from)} AND chapel_wash_bay_fee_paid_at <= ${toTs(to)}
      GROUP BY chapel_wash_bay_fee_currency
    `),
    // ── Fleet (module: fleet — not gated in daily-report.ts today, but should be here) ──
    !hasFleet ? [] : tdb.execute(sql`
      SELECT currency, COALESCE(SUM(cost_amount::numeric), 0) AS total
      FROM fleet_fuel_logs
      WHERE organization_id = ${orgId} AND filled_at >= ${fromTs(from)} AND filled_at <= ${toTs(to)}
      GROUP BY currency
    `),
    !hasFleet ? [] : tdb.execute(sql`
      SELECT currency, COALESCE(SUM(cost_amount::numeric), 0) AS total
      FROM fleet_maintenance
      WHERE organization_id = ${orgId} AND completed_date >= ${from} AND completed_date <= ${to}
      GROUP BY currency
    `),
    // ── Claims SLA overdue % (module: claims) — "as of now", not date-range bound, since SLA
    // aging is about currently-open claims, not claims created in this period. ──
    !hasClaims ? [] : tdb.execute(sql`
      SELECT status, created_at FROM claims
      WHERE organization_id = ${orgId} AND status NOT IN ('rejected', 'closed')
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    `),
  ]);

  const revenueByProduct = rowsOf(productRevenueRows).map((r: any) => ({
    productId: r.product_id,
    productName: r.product_name,
    currency: r.currency,
    revenue: parseFloat(r.revenue),
    policyCount: parseInt(r.policy_count),
  }));
  const funeralByBranch = rowsOf(funeralByBranchRows).map((r: any) => ({
    branchId: r.branch_id, branchName: r.branch_name || "No branch", count: parseInt(r.count),
  }));
  const topFuneralLocations = rowsOf(funeralByLocationRows).map((r: any) => ({ location: r.location, count: parseInt(r.count) }));
  const funeralCrossBorderSplit = rowsOf(crossBorderSplitRows).map((r: any) => ({ flagged: r.flagged === true, count: parseInt(r.count) }));
  const funeralTrend = rowsOf(funeralTrendRows).map((r: any) => ({ date: r.date, serviceType: r.service_type, count: parseInt(r.count) }));

  const quoteStats = rowsOf(quoteStatsRows).map((r: any) => ({
    conversionStatus: r.conversion_status, currency: r.currency, count: parseInt(r.count), value: parseFloat(r.value),
  }));
  const totalQuotes = quoteStats.reduce((sum, q) => sum + q.count, 0);
  const convertedQuotes = quoteStats.filter((q) => q.conversionStatus === "converted").reduce((sum, q) => sum + q.count, 0);
  const quoteConversionRate = totalQuotes > 0 ? Number(((convertedQuotes / totalQuotes) * 100).toFixed(1)) : null;

  const leadFunnel = leadRows.length === 0 ? null : PIPELINE_STAGES.map((s) => ({
    stage: s.key,
    label: s.label,
    count: leadRows.filter((l) => effectiveLeadStage(l) === s.key).length,
  }));

  const revenueByStream = rowsOf(revenueByStreamRows).map((r: any) => ({
    serviceKey: r.service_key, currency: r.currency, revenue: parseFloat(r.revenue), count: parseInt(r.count),
  }));
  const storageFeeTotal = Object.fromEntries(rowsOf(storageFeeRows).map((r: any) => [r.currency, parseFloat(r.total)]));
  const chapelFeeTotal = Object.fromEntries(rowsOf(chapelFeeRows).map((r: any) => [r.currency, parseFloat(r.total)]));
  const fuelCost = Object.fromEntries(rowsOf(fuelCostRows).map((r: any) => [r.currency, parseFloat(r.total)]));
  const maintenanceCost = Object.fromEntries(rowsOf(maintenanceCostRows).map((r: any) => [r.currency, parseFloat(r.total)]));

  let claimsOverdue: { openCount: number; overdueCount: number; overduePercent: number | null } | null = null;
  if (hasClaims) {
    const openClaims = rowsOf(openClaimsRows);
    const overdueCount = openClaims.filter((c: any) => isClaimOverdue(c.status, computeClaimAgeDays(c.created_at))).length;
    claimsOverdue = {
      openCount: openClaims.length,
      overdueCount,
      overduePercent: openClaims.length > 0 ? Number(((overdueCount / openClaims.length) * 100).toFixed(1)) : null,
    };
  }

  return {
    period: { from, to, branchId: branchId ?? null },
    capabilities: { hasFuneralOps, hasClaims, hasFleet },
    financial: {
      incomeStatement, cashFlow, incomeTimeSeries,
      branchBreakdown: execSummary.branchBreakdown,
    },
    policies: {
      newPoliciesCount: execSummary.newPoliciesCount,
      revenueByProduct,
      countryFlag: execSummary.countryFlag,
    },
    funeralServices: hasFuneralOps ? {
      byType: funeralByType.map((r) => ({ serviceType: r.serviceType, count: Number(r.count) })),
      byBranch: funeralByBranch,
      topLocations: topFuneralLocations,
      crossBorderSplit: funeralCrossBorderSplit,
      trend: funeralTrend,
    } : null,
    quotes: hasFuneralOps ? { stats: quoteStats, totalQuotes, convertedQuotes, conversionRate: quoteConversionRate } : null,
    leadFunnel,
    mortuary: hasFuneralOps ? {
      byScope: mortuaryByScope.map((r) => ({ serviceScope: r.serviceScope, count: Number(r.count) })),
      revenueByStream,
      storageFeeTotal,
      chapelFeeTotal,
    } : null,
    fleet: hasFleet ? { fuelCost, maintenanceCost } : null,
    claims: hasClaims ? { stats: execSummary.claimStats, overdue: claimsOverdue } : null,
  };
}
