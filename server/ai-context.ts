/**
 * Per-surface data resolution for AI insights (server/ai-service.ts).
 *
 * Deliberately does NOT accept a client-supplied data payload — every surface here
 * resolves its own data server-side from storage, the same way the page's own routes
 * do, so a caller can only ever see (and pay to analyze) data their own permissions
 * already allow, and can't inflate cost with an arbitrary large payload.
 *
 * Also deliberately trims high-sensitivity identifiers (client national IDs, phone
 * numbers, addresses, deceased names) before anything is sent to the AI — a safety
 * default while the org's actual data-handling requirements get confirmed, not a
 * substitute for that review.
 */
import { storage } from "./storage";
import { buildDailyReport } from "./daily-report";
import { buildExecutiveSummary, defaultExecutiveSummaryRange } from "./financial-statements";

export type AiSurface = "daily_report" | "dashboard" | "finance" | "policies" | "claims";

/** Extra permission (beyond use:ai) required to request insights for a surface. */
export const AI_SURFACE_PERMISSION: Record<AiSurface, string> = {
  daily_report: "read:finance",
  dashboard: "read:finance",
  finance: "read:finance",
  policies: "read:policy",
  claims: "read:claim",
};

const AI_CONTEXT_MAX_ROWS = 2000;

export async function buildDailyReportContext(orgId: string, date: string) {
  const report = await buildDailyReport(orgId, date);
  return {
    datasetLabel: `Daily report for ${date}`,
    dataJson: {
      date,
      incomeStatement: report.financials.incomeStatement,
      cashFlow: report.financials.cashFlow,
      operationCounts: {
        funeralCasesOpened: report.operations.funeralCasesOpened.length,
        mortuaryIntakes: report.operations.mortuaryIntakes.length,
        mortuaryDispatches: report.operations.mortuaryDispatches.length,
        quotationsCreated: report.operations.quotationsCreated.length,
        policiesActivated: report.operations.policiesActivated.length,
        claimsSubmitted: report.operations.claimsSubmitted.length,
      },
      existingNotes: report.notes.map((n: any) => n.note),
    },
  };
}

/** Compact context for the note-enhancement task — smaller than the full insights payload. */
export async function buildNoteEnhanceContext(orgId: string, date: string): Promise<string> {
  const { dataJson } = await buildDailyReportContext(orgId, date);
  return JSON.stringify(dataJson);
}

export async function buildDashboardContext(orgId: string) {
  const range = defaultExecutiveSummaryRange();
  const summary = await buildExecutiveSummary(orgId, range);
  return { datasetLabel: `Executive summary (${range.from} to ${range.to})`, dataJson: summary };
}

export async function buildFinanceContext(orgId: string) {
  const range = defaultExecutiveSummaryRange();
  const summary = await buildExecutiveSummary(orgId, range);
  return { datasetLabel: `Finance summary (${range.from} to ${range.to})`, dataJson: summary };
}

export async function buildPoliciesContext(orgId: string) {
  const [allPolicies, allProducts, allVersions] = await Promise.all([
    storage.getPoliciesByOrg(orgId, AI_CONTEXT_MAX_ROWS, 0),
    storage.getProductsByOrg(orgId),
    storage.getAllProductVersions(orgId),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const p of allPolicies as any[]) statusCounts[p.status] = (statusCounts[p.status] || 0) + 1;

  const pvToProductId: Record<string, string> = {};
  for (const v of allVersions) pvToProductId[v.id] = v.productId;
  const byProduct: Record<string, { total: number; active: number; lapsed: number }> = {};
  for (const p of allPolicies as any[]) {
    const pid = pvToProductId[p.productVersionId] || "unknown";
    if (!byProduct[pid]) byProduct[pid] = { total: 0, active: 0, lapsed: 0 };
    byProduct[pid].total++;
    if (p.status === "active") byProduct[pid].active++;
    if (p.status === "lapsed") byProduct[pid].lapsed++;
  }
  const productPerformance = allProducts.map((prod: any) => ({
    name: prod.name,
    totalPolicies: byProduct[prod.id]?.total || 0,
    activePolicies: byProduct[prod.id]?.active || 0,
    lapsedPolicies: byProduct[prod.id]?.lapsed || 0,
  }));

  const total = allPolicies.length;
  const active = statusCounts.active || 0;
  const lapsed = statusCounts.lapsed || 0;

  return {
    datasetLabel: "Policy portfolio",
    dataJson: {
      totalPolicies: total,
      statusCounts,
      retentionRate: total > 0 ? Number(((active / total) * 100).toFixed(1)) : 0,
      lapseRate: total > 0 ? Number(((lapsed / total) * 100).toFixed(1)) : 0,
      productPerformance,
    },
  };
}

export async function buildClaimsContext(orgId: string) {
  const recentClaims = await storage.getClaimsByOrg(orgId, AI_CONTEXT_MAX_ROWS, 0);

  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const valueByCurrency: Record<string, number> = {};
  for (const c of recentClaims as any[]) {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1;
    typeCounts[c.claimType] = (typeCounts[c.claimType] || 0) + 1;
    const currency = c.currency || "USD";
    valueByCurrency[currency] = (valueByCurrency[currency] || 0) + (parseFloat(c.cashInLieuAmount || "0") || 0);
  }

  return {
    datasetLabel: "Claims (most recent, aggregated — no client identifiers)",
    dataJson: {
      totalClaims: recentClaims.length,
      statusCounts,
      typeCounts,
      totalValueByCurrency: valueByCurrency,
    },
  };
}

export async function buildAiInsightContext(
  surface: AiSurface,
  orgId: string,
  date: string | undefined,
): Promise<{ datasetLabel: string; dataJson: unknown }> {
  switch (surface) {
    case "daily_report":
      return buildDailyReportContext(orgId, date || new Date().toISOString().slice(0, 10));
    case "dashboard":
      return buildDashboardContext(orgId);
    case "finance":
      return buildFinanceContext(orgId);
    case "policies":
      return buildPoliciesContext(orgId);
    case "claims":
      return buildClaimsContext(orgId);
  }
}
