/**
 * PDF export for the Executive Report — reuses the house PDFKit style from
 * financial-statement-pdf.ts (letterhead, section bands, stat tiles, tables) rather than
 * duplicating it. Charts are screen-only: PDFKit has no chart primitives and Recharts is
 * browser-only, so this is KPI tiles + tables, same as every other PDF in this codebase.
 */
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildExecutiveReport, type ExecutiveReportParams } from "./executive-report";
import {
  makeDoc, newPage, sectionBand, kv, statRow, drawTable, finish,
  money, fmtDate, currencyLines, renderIncomeStatementBody,
  C_INCOME, C_EXPENSE, COL, type DocContext,
} from "./financial-statement-pdf";

function pct(n: number | null): string {
  return n == null ? "—" : `${n}%`;
}

export async function streamExecutiveReportPdf(
  orgId: string,
  params: ExecutiveReportParams,
  res: Response,
  opts?: { attachment?: boolean },
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logoData = await resolveImage(org.logoUrl);
  const report = await buildExecutiveReport(orgId, params);
  const ctx: DocContext = makeDoc(
    org, logoData, "Executive Report",
    `Period: ${fmtDate(params.from)} to ${fmtDate(params.to)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`,
  );
  newPage(ctx);

  // Headline KPI tiles
  statRow(ctx, [
    { label: "Total income (consolidated)", value: `USD ${money(report.financial.incomeStatement.consolidatedUsd?.income)}`, color: C_INCOME },
    { label: "Net (consolidated)", value: `USD ${money(report.financial.incomeStatement.consolidatedUsd?.net)}`, color: Number(report.financial.incomeStatement.consolidatedUsd?.net ?? 0) >= 0 ? C_INCOME : C_EXPENSE },
    { label: "New policies", value: String(report.policies.newPoliciesCount) },
  ]);
  statRow(ctx, [
    { label: "Funeral services", value: report.funeralServices ? String(report.funeralServices.byType.reduce((s, r) => s + r.count, 0)) : "—" },
    { label: "Quote conversion rate", value: report.quotes ? pct(report.quotes.conversionRate) : "—" },
    { label: "Claims overdue", value: report.claims?.overdue ? pct(report.claims.overdue.overduePercent) : "—" },
  ]);

  renderIncomeStatementBody(ctx, report.financial.incomeStatement);

  if (report.financial.branchBreakdown.length) {
    sectionBand(ctx, "Income by Branch");
    drawTable(ctx, [
      { header: "Branch", width: 220, getter: (r: any) => r.branchName },
      { header: "Currency", width: 80, getter: (r: any) => r.currency },
      { header: "Policies", width: 80, align: "right", getter: (r: any) => String(r.policyCount) },
      { header: "Income", width: COL - 380, align: "right", getter: (r: any) => money(r.income) },
    ], report.financial.branchBreakdown);
  }

  if (report.policies.revenueByProduct.length) {
    sectionBand(ctx, "Premium Revenue by Product");
    drawTable(ctx, [
      { header: "Product", width: 220, getter: (r: any) => r.productName },
      { header: "Currency", width: 80, getter: (r: any) => r.currency },
      { header: "Policies", width: 80, align: "right", getter: (r: any) => String(r.policyCount) },
      { header: "Revenue", width: COL - 380, align: "right", getter: (r: any) => money(r.revenue) },
    ], report.policies.revenueByProduct);
  }

  if (report.policies.countryFlag) {
    const cf = report.policies.countryFlag;
    sectionBand(ctx, `${cf.flagLabel} vs ${cf.homeLabel}`);
    drawTable(ctx, [
      { header: "Location", width: 150, getter: (r: any) => r.flagged ? cf.flagLabel : cf.homeLabel },
      { header: "Currency", width: 80, getter: (r: any) => r.currency },
      { header: "Policies", width: 80, align: "right", getter: (r: any) => String(r.policyCount) },
      { header: "Income", width: COL - 310, align: "right", getter: (r: any) => money(r.income) },
    ], cf.revenueByCountry);
    kv(ctx, `${cf.flagLabel} funeral services`, String(cf.serviceCount));
    kv(ctx, `${cf.flagLabel} cost`, currencyLines(Object.fromEntries(cf.costByCurrency.map((c: any) => [c.currency, c.cost]))));
  }

  if (report.funeralServices) {
    sectionBand(ctx, "Funeral Services");
    drawTable(ctx, [
      { header: "Service type", width: 200, getter: (r: any) => r.serviceType || "Unspecified" },
      { header: "Count", width: COL - 200, align: "right", getter: (r: any) => String(r.count) },
    ], report.funeralServices.byType);
    if (report.funeralServices.byBranch.length) {
      drawTable(ctx, [
        { header: "Branch", width: 300, getter: (r: any) => r.branchName },
        { header: "Count", width: COL - 300, align: "right", getter: (r: any) => String(r.count) },
      ], report.funeralServices.byBranch);
    }
    if (report.funeralServices.crossBorderSplit.length) {
      drawTable(ctx, [
        { header: "Cross-border", width: 300, getter: (r: any) => r.flagged ? "Yes" : "No" },
        { header: "Count", width: COL - 300, align: "right", getter: (r: any) => String(r.count) },
      ], report.funeralServices.crossBorderSplit);
    }
  }

  if (report.quotes) {
    sectionBand(ctx, "Quotes & Conversion");
    kv(ctx, "Total quotes", String(report.quotes.totalQuotes));
    kv(ctx, "Converted", String(report.quotes.convertedQuotes), C_INCOME);
    kv(ctx, "Conversion rate", pct(report.quotes.conversionRate));
    drawTable(ctx, [
      { header: "Status", width: 150, getter: (r: any) => r.conversionStatus },
      { header: "Currency", width: 100, getter: (r: any) => r.currency },
      { header: "Count", width: 100, align: "right", getter: (r: any) => String(r.count) },
      { header: "Value", width: COL - 350, align: "right", getter: (r: any) => money(r.value) },
    ], report.quotes.stats);
  }

  if (report.leadFunnel) {
    sectionBand(ctx, "Lead Funnel");
    drawTable(ctx, [
      { header: "Stage", width: 300, getter: (r: any) => r.label },
      { header: "Count", width: COL - 300, align: "right", getter: (r: any) => String(r.count) },
    ], report.leadFunnel);
  }

  if (report.mortuary) {
    sectionBand(ctx, "Mortuary");
    drawTable(ctx, [
      { header: "Service scope", width: 300, getter: (r: any) => r.serviceScope },
      { header: "Count", width: COL - 300, align: "right", getter: (r: any) => String(r.count) },
    ], report.mortuary.byScope);
    sectionBand(ctx, "Revenue by Service Stream");
    drawTable(ctx, [
      { header: "Service", width: 200, getter: (r: any) => r.serviceKey },
      { header: "Currency", width: 80, getter: (r: any) => r.currency },
      { header: "Count", width: 80, align: "right", getter: (r: any) => String(r.count) },
      { header: "Revenue", width: COL - 360, align: "right", getter: (r: any) => money(r.revenue) },
    ], report.mortuary.revenueByStream);
    kv(ctx, "Storage fees (cross-check)", currencyLines(report.mortuary.storageFeeTotal));
    kv(ctx, "Chapel/wash-bay fees (cross-check)", currencyLines(report.mortuary.chapelFeeTotal));
  }

  if (report.fleet) {
    sectionBand(ctx, "Fleet Costs");
    kv(ctx, "Fuel", currencyLines(report.fleet.fuelCost));
    kv(ctx, "Maintenance", currencyLines(report.fleet.maintenanceCost));
  }

  if (report.claims) {
    sectionBand(ctx, "Claims");
    drawTable(ctx, [
      { header: "Status", width: 150, getter: (r: any) => r.status },
      { header: "Currency", width: 100, getter: (r: any) => r.currency },
      { header: "Count", width: 100, align: "right", getter: (r: any) => String(r.count) },
      { header: "Value", width: COL - 350, align: "right", getter: (r: any) => money(r.totalValue) },
    ], report.claims.stats);
    if (report.claims.overdue) {
      kv(ctx, "Open claims", String(report.claims.overdue.openCount));
      kv(ctx, "Overdue (SLA)", `${report.claims.overdue.overdueCount} (${pct(report.claims.overdue.overduePercent)})`, C_EXPENSE);
    }
  }

  finish(ctx, res, `executive-report-${params.from}-to-${params.to}.pdf`, !!opts?.attachment);
}
