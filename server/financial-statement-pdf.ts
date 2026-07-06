/**
 * PDF export for financial statements (income statement, cash flow) and the
 * combined Daily Report — company letterhead, same visual language as
 * department-report-pdf.ts.
 */
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildIncomeStatement, buildCashFlowStatement } from "./financial-statements";
import { buildDailyReport } from "./daily-report";

const A4_W = 595.28;
const A4_H = 841.89;
const M = 44;
const COL = A4_W - M * 2;

const C_PRIMARY = "#0f766e";
const C_ACCENT = "#134e4a";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_LIGHT = "#f0fdf4";
const C_ROW_ALT = "#f9fafb";
const C_INCOME = "#15803d";
const C_EXPENSE = "#b91c1c";

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }); } catch { return String(v); }
}
function money(n: any): string {
  return Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
/**
 * Measures the string against the CURRENT font/size on `doc` and truncates with an ellipsis
 * if it's wider than `maxWidth` — a table cell must never wrap or overflow into its neighbour.
 */
function fitText(doc: InstanceType<typeof PDFDocument>, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(text.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}
function currencyLines(m: Record<string, number> | undefined): string {
  if (!m || Object.keys(m).length === 0) return "—";
  const parts = Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => `${c} ${money(v)}`);
  return parts.length ? parts.join("  ·  ") : "—";
}

interface DocContext {
  doc: InstanceType<typeof PDFDocument>;
  org: { name: string | null; phone: string | null; email: string | null; address: string | null; footerText?: string | null };
  logoData: Buffer | null;
  title: string;
  subtitle: string;
  y: number;
  pageNum: number;
}

function makeDoc(org: any, logoData: Buffer | null, title: string, subtitle: string): DocContext {
  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: title, Author: org.name || "POL263" } });
  return { doc, org, logoData, title, subtitle, y: M, pageNum: 0 };
}

function drawLetterhead(ctx: DocContext) {
  const { doc, org, logoData } = ctx;
  let y = M;
  if (logoData) {
    try { doc.image(logoData, M, y, { height: 50, fit: [100, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_PRIMARY)
    .text(org.name || "Company", M + 110, y, { width: COL - 110, align: "right" });
  y += 15;
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED);
  for (const p of [org.phone, org.email, org.address].filter(Boolean) as string[]) { doc.text(p, M + 110, y, { width: COL - 110, align: "right" }); y += 10; }
  y = Math.max(y, M + 56) + 8;
  doc.moveTo(M, y).lineTo(A4_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;
  doc.rect(M, y, COL, 26).fill(C_ACCENT);
  doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff").text(ctx.title.toUpperCase(), M, y + 7, { width: COL, align: "center" });
  y += 30;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(ctx.subtitle, M, y, { width: COL, align: "center" });
  y += 18;
  ctx.y = y;
}

function newPage(ctx: DocContext) {
  if (ctx.pageNum > 0) ctx.doc.addPage();
  ctx.pageNum++;
  drawLetterhead(ctx);
}

function ensureSpace(ctx: DocContext, h: number) {
  if (ctx.y + h > A4_H - M - 24) newPage(ctx);
}

function sectionBand(ctx: DocContext, title: string) {
  ensureSpace(ctx, 22);
  const { doc } = ctx;
  doc.rect(M, ctx.y, COL, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff").text(title.toUpperCase(), M + 6, ctx.y + 4, { width: COL - 12 });
  ctx.y += 19;
  doc.fillColor(C_TEXT);
}

function kv(ctx: DocContext, label: string, value: string, color = C_TEXT, lw = 220) {
  ensureSpace(ctx, 14);
  const { doc } = ctx;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(label, M, ctx.y, { width: lw });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(color).text(value, M + lw, ctx.y, { width: COL - lw, align: "right" });
  ctx.y += 14;
}

function statRow(ctx: DocContext, stats: { label: string; value: string; color?: string }[]) {
  ensureSpace(ctx, 36);
  const { doc } = ctx;
  const w = Math.floor(COL / stats.length);
  let sx = M;
  for (const s of stats) {
    doc.rect(sx, ctx.y, w - 6, 30).fill(C_LIGHT);
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED).text(s.label, sx + 4, ctx.y + 4, { width: w - 14 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(s.color || C_PRIMARY).text(s.value, sx + 4, ctx.y + 14, { width: w - 14 });
    sx += w;
  }
  ctx.y += 36;
}

type ColDef = { header: string; width: number; align?: "left" | "right" | "center"; getter: (row: any) => string; color?: (row: any) => string };
function drawTable(ctx: DocContext, cols: ColDef[], rows: any[], emptyMsg = "No records.") {
  const { doc } = ctx;
  if (rows.length === 0) {
    ensureSpace(ctx, 20);
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(emptyMsg, M, ctx.y, { width: COL });
    ctx.y += 18;
    return;
  }
  ensureSpace(ctx, 18);
  doc.rect(M, ctx.y, COL, 15).fill("#e2e8f0");
  let cx = M + 4;
  for (const col of cols) {
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_ACCENT);
    const headerVal = fitText(doc, col.header, col.width - 6);
    doc.text(headerVal, cx, ctx.y + 3, { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
    cx += col.width;
  }
  ctx.y += 17;
  for (let i = 0; i < rows.length; i++) {
    ensureSpace(ctx, 14);
    if (i % 2 === 1) doc.rect(M, ctx.y, COL, 13).fill(C_ROW_ALT);
    cx = M + 4;
    for (const col of cols) {
      const raw = col.getter(rows[i]);
      doc.font("Helvetica").fontSize(7.5).fillColor(col.color ? col.color(rows[i]) : C_TEXT);
      const val = fitText(doc, raw, col.width - 6);
      doc.text(val, cx, ctx.y + 2, { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
      cx += col.width;
    }
    ctx.y += 14;
  }
  ctx.y += 6;
}

function finish(ctx: DocContext, res: Response, filename: string, download: boolean) {
  const { doc } = ctx;
  res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");
  doc.pipe(res);

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = A4_H - M + 6;
    // Footer sits inside the bottom margin band (below A4_H - M). Drawing text past that
    // boundary makes PDFKit think it overflowed the page and silently insert a brand-new
    // blank page to "continue" onto — which is where all the trailing blank pages came from.
    // Zeroing the bottom margin for these two calls draws in the margin without triggering that.
    const savedBottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`${ctx.org.name || ""}  ·  ${ctx.title}  ·  Confidential  ·  Page ${i + 1} of ${range.count}`, M, fy, { width: COL, align: "center", lineBreak: false });
    if (ctx.org.footerText) {
      doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED).text(ctx.org.footerText, M, fy + 9, { width: COL, align: "center", lineBreak: false });
    }
    doc.page.margins.bottom = savedBottomMargin;
  }
  doc.end();
}

function renderIncomeStatementBody(ctx: DocContext, is: any) {
  sectionBand(ctx, "Income");
  kv(ctx, "Individual premiums", currencyLines(is.income.premiumIndividual));
  kv(ctx, "Group premiums", currencyLines(is.income.premiumGroup));
  kv(ctx, "Cash services", currencyLines(is.income.cashServices));
  kv(ctx, "Legacy group receipts", currencyLines(is.income.legacyGroupIncome));
  kv(ctx, "Total income", currencyLines(is.income.total), C_INCOME);

  sectionBand(ctx, "Expenses");
  for (const line of is.expenses.lines || []) kv(ctx, line.label, currencyLines(line.amounts));
  kv(ctx, "Total expenses", currencyLines(is.expenses.total), C_EXPENSE);

  sectionBand(ctx, "Net Income");
  kv(ctx, "Net (per currency)", currencyLines(is.net), Number(is.consolidatedUsd?.net ?? 0) >= 0 ? C_INCOME : C_EXPENSE);
  kv(ctx, "Consolidated (USD equivalent)", `USD ${money(is.consolidatedUsd?.net)}`, Number(is.consolidatedUsd?.net ?? 0) >= 0 ? C_INCOME : C_EXPENSE);
  if (is.consolidatedUsd?.unconvertible?.length) {
    ensureSpace(ctx, 12);
    ctx.doc.font("Helvetica-Oblique").fontSize(7).fillColor(C_MUTED)
      .text(`No FX rate set for ${is.consolidatedUsd.unconvertible.join(", ")} — excluded from the consolidated total.`, M, ctx.y, { width: COL });
    ctx.y += 14;
  }
}

function renderCashFlowBody(ctx: DocContext, cf: any) {
  sectionBand(ctx, "Cash In (by method)");
  for (const [channel, amounts] of Object.entries(cf.inflowsByChannel || {})) {
    kv(ctx, channel.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), currencyLines(amounts as any));
  }
  kv(ctx, "Total cash in", currencyLines(cf.cashIn), C_INCOME);

  sectionBand(ctx, "Cash Out");
  kv(ctx, "Requisitions paid", currencyLines(cf.outflows.requisitions));
  kv(ctx, "Expenditures paid", currencyLines(cf.outflows.expenditures));
  kv(ctx, "Agent commissions paid", currencyLines(cf.outflows.commissions));
  kv(ctx, "Total cash out", currencyLines(cf.outflows.total), C_EXPENSE);

  sectionBand(ctx, "Net Cash Movement");
  kv(ctx, "Net (per currency)", currencyLines(cf.netCash), Number(cf.consolidatedUsd?.netCash ?? 0) >= 0 ? C_INCOME : C_EXPENSE);
  kv(ctx, "Consolidated (USD equivalent)", `USD ${money(cf.consolidatedUsd?.netCash)}`, Number(cf.consolidatedUsd?.netCash ?? 0) >= 0 ? C_INCOME : C_EXPENSE);

  if (cf.cashups?.length) {
    sectionBand(ctx, "Daily Cash-Up Reconciliation");
    drawTable(ctx, [
      { header: "Date", width: 90, getter: (r) => String(r.cashupDate) },
      { header: "Currency", width: 60, getter: (r) => r.currency },
      { header: "Status", width: 70, getter: (r) => r.status },
      { header: "Expected", width: 95, align: "right", getter: (r) => money(r.totalAmount) },
      { header: "Counted", width: 95, align: "right", getter: (r) => r.countedTotal != null ? money(r.countedTotal) : "—" },
      { header: "Discrepancy", width: COL - 410, align: "right", getter: (r) => r.discrepancyAmount != null ? money(r.discrepancyAmount) : "—" },
    ], cf.cashups);
  }
}

export async function streamIncomeStatementPdf(orgId: string, from: string, to: string, branchId: string | undefined, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logoData = await resolveImage(org.logoUrl);
  const is = await buildIncomeStatement(orgId, { from, to, branchId });
  const ctx = makeDoc(org, logoData, "Income Statement", `Period: ${fmtDate(from)} to ${fmtDate(to)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);
  renderIncomeStatementBody(ctx, is);
  finish(ctx, res, `income-statement-${from}-to-${to}.pdf`, !!opts?.attachment);
}

export async function streamCashFlowPdf(orgId: string, from: string, to: string, branchId: string | undefined, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logoData = await resolveImage(org.logoUrl);
  const cf = await buildCashFlowStatement(orgId, { from, to, branchId });
  const ctx = makeDoc(org, logoData, "Cash Flow Statement", `Period: ${fmtDate(from)} to ${fmtDate(to)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);
  renderCashFlowBody(ctx, cf);
  finish(ctx, res, `cash-flow-${from}-to-${to}.pdf`, !!opts?.attachment);
}

export async function streamDailyReportPdf(orgId: string, date: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logoData = await resolveImage(org.logoUrl);
  const report = await buildDailyReport(orgId, date);
  const ctx = makeDoc(org, logoData, "Daily Report", `${fmtDate(date)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);

  renderIncomeStatementBody(ctx, report.financials.incomeStatement);
  renderCashFlowBody(ctx, report.financials.cashFlow);

  sectionBand(ctx, `Transaction Ledger (${report.financials.ledger.total})`);
  drawTable(ctx, [
    { header: "Type", width: 35, getter: (r) => r.type === "income" ? "IN" : "OUT", color: (r) => r.type === "income" ? C_INCOME : C_EXPENSE },
    { header: "Description", width: 150, getter: (r) => r.description },
    { header: "Ref", width: 65, getter: (r) => r.reference || "—" },
    { header: "Person", width: 78, getter: (r) => r.person || "—" },
    { header: "Dept / cost centre", width: 80, getter: (r) => r.department || "—" },
    { header: "Amount", width: COL - 408, align: "right", getter: (r) => `${r.type === "expense" ? "-" : ""}${r.currency} ${money(r.amount)}`, color: (r) => r.type === "income" ? C_INCOME : C_EXPENSE },
  ], report.financials.ledger.entries);

  sectionBand(ctx, "Operations Summary");
  statRow(ctx, [
    { label: "Funeral cases opened", value: String(report.operations.funeralCasesOpened.length) },
    { label: "Mortuary intakes", value: String(report.operations.mortuaryIntakes.length) },
    { label: "Mortuary dispatches", value: String(report.operations.mortuaryDispatches.length) },
  ]);
  statRow(ctx, [
    { label: "Quotations created", value: String(report.operations.quotationsCreated.length) },
    { label: "Policies activated", value: String(report.operations.policiesActivated.length) },
    { label: "Claims submitted", value: String(report.operations.claimsSubmitted.length) },
  ]);
  if (report.operations.funeralCasesOpened.length) {
    drawTable(ctx, [
      { header: "Case #", width: 90, getter: (r: any) => r.caseNumber },
      { header: "Deceased", width: 170, getter: (r: any) => r.deceasedName || "—" },
      { header: "Service type", width: 110, getter: (r: any) => r.serviceType || "—" },
      { header: "Status", width: COL - 370, getter: (r: any) => r.status },
    ], report.operations.funeralCasesOpened);
  }
  if (report.operations.policiesActivated.length) {
    drawTable(ctx, [
      { header: "Policy #", width: 90, getter: (r: any) => r.policyNumber },
      { header: "Client", width: 170, getter: (r: any) => [r.clientFirstName, r.clientLastName].filter(Boolean).join(" ") || "—" },
      { header: "Premium", width: 110, align: "right", getter: (r: any) => `${r.currency} ${money(r.premiumAmount)}` },
      { header: "Legacy", width: COL - 370, getter: (r: any) => r.isLegacy ? "Yes" : "No" },
    ], report.operations.policiesActivated);
  }

  if (report.notes.length) {
    sectionBand(ctx, "Notes");
    for (const n of report.notes) {
      ctx.doc.font("Helvetica").fontSize(8);
      const noteHeight = ctx.doc.heightOfString(n.note, { width: COL });
      ensureSpace(ctx, noteHeight + 22);
      ctx.doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED)
        .text(`${n.authorName || "Unknown"}  ·  ${new Date(n.createdAt).toLocaleString("en-ZA")}`, M, ctx.y, { width: COL });
      ctx.y += 11;
      ctx.doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(n.note, M, ctx.y, { width: COL });
      ctx.y += noteHeight + 10;
    }
  }

  finish(ctx, res, `daily-report-${date}.pdf`, !!opts?.attachment);
}
