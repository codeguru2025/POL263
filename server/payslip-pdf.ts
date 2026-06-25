/**
 * Payslip PDF — company letterhead, full earnings/deductions breakdown.
 * Can stream to HTTP response (print/preview) or return a Buffer (email attachment).
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";

const A4_W = 595.28;
const A4_H = 841.89;
const M = 44;
const COL = A4_W - M * 2;

const C_PRIMARY  = "#0f766e";
const C_ACCENT   = "#134e4a";
const C_TEXT     = "#111827";
const C_MUTED    = "#6b7280";
const C_LIGHT    = "#f0fdf4";
const C_BORDER   = "#d1fae5";
const C_RED      = "#dc2626";
const C_GREEN    = "#16a34a";

function fmt(v: string | null | undefined) { return v?.trim() || "—"; }
function fmtDate(v: string | Date | null | undefined) {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }); } catch { return String(v); }
}
function fmtMoney(v: string | number | null | undefined, currency = "USD") {
  if (v === null || v === undefined || v === "") return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return `${currency} ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function maskAccount(acc: string | null | undefined) {
  if (!acc) return "—";
  if (acc.length <= 4) return acc;
  return "*".repeat(acc.length - 4) + acc.slice(-4);
}

export async function buildPayslipPdf(
  runId: string,
  employeeId: string,
  orgId: string
): Promise<{ buffer: Buffer; filename: string; employee: any; run: any } | null> {
  const [runs, employees] = await Promise.all([
    storage.getPayrollRuns(orgId),
    storage.getPayrollEmployees(orgId),
  ]);
  const run = runs.find(r => r.id === runId);
  const emp = employees.find(e => e.id === employeeId);
  if (!run || !emp) return null;

  const slips = await storage.getPayslipsForRun(runId, orgId);
  const slip = slips.find((s: any) => s.employeeId === employeeId || s.employee?.id === employeeId);
  if (!slip) return null;

  const org = await storage.getOrganization(orgId);
  if (!org) return null;

  const logoData = await resolveImage(org.logoUrl);

  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `Payslip — ${emp.firstName} ${emp.lastName}`, Author: org.name || "POL263" } });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  await new Promise<void>((resolve) => {
    doc.on("end", resolve);
    renderPayslip(doc, org, logoData, run, emp, slip);
    doc.end();
  });

  const buffer = Buffer.concat(chunks);
  const filename = `Payslip-${emp.employeeNumber}-${run.periodStart}.pdf`;
  return { buffer, filename, employee: emp, run };
}

export async function streamPayslipToResponse(
  runId: string,
  employeeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const result = await buildPayslipPdf(runId, employeeId, orgId);
  if (!result) { res.status(404).json({ message: "Payslip not found — save the payslip first." }); return; }

  const { buffer, filename } = result;
  res.setHeader("Content-Disposition", opts?.attachment ? `attachment; filename="${filename}"` : `inline; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Length", buffer.length);
  res.end(buffer);
}

function renderPayslip(doc: InstanceType<typeof PDFDocument>, org: any, logoData: Buffer | null, run: any, emp: any, slip: any) {
  let y = M;

  const ensureSpace = (h: number) => {
    if (y + h > A4_H - M - 24) { doc.addPage(); y = M; }
  };

  // ── Letterhead ───────────────────────────────────────────────
  if (logoData) {
    try { doc.image(logoData, M, y, { height: 48, fit: [90, 48] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(12).fillColor(C_PRIMARY)
    .text(org.name || "Company", M + 100, y, { width: COL - 100, align: "right" });
  y += 15;
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED);
  const orgParts = [org.phone, org.email, org.address].filter(Boolean) as string[];
  for (const p of orgParts) { doc.text(p, M + 100, y, { width: COL - 100, align: "right" }); y += 10; }
  y = Math.max(y, M + 54) + 8;

  doc.moveTo(M, y).lineTo(A4_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;

  // ── Title ────────────────────────────────────────────────────
  doc.rect(M, y, COL, 24).fill(C_ACCENT);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
    .text("PAYSLIP / SALARY ADVICE", M, y + 6, { width: COL, align: "center" });
  y += 28;

  // ── Pay period band ──────────────────────────────────────────
  doc.rect(M, y, COL, 16).fill(C_LIGHT);
  doc.font("Helvetica").fontSize(8).fillColor(C_ACCENT)
    .text(`Pay Period:  ${fmtDate(run.periodStart)}  —  ${fmtDate(run.periodEnd)}`, M + 8, y + 4, { width: COL - 16, align: "left" });
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
    .text(`Issued: ${fmtDate(new Date())}`, M + 8, y + 4, { width: COL - 16, align: "right" });
  y += 20;

  // ── Employee details (two columns) ───────────────────────────
  const half = COL / 2 - 4;
  const lw = 90;

  const kv2 = (l1: string, v1: string, l2: string, v2: string) => {
    ensureSpace(13);
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l1, M, sy, { width: lw });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v1, M + lw + 4, sy, { width: half - lw - 4 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l2, M + half + 8, sy, { width: lw });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v2, M + half + lw + 12, sy, { width: half - lw - 4 });
    y += 13;
  };

  const bandTitle = (title: string) => {
    ensureSpace(18);
    doc.rect(M, y, COL, 15).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
      .text(title.toUpperCase(), M + 6, y + 3.5, { width: COL - 12 });
    y += 18;
  };

  bandTitle("Employee Information");
  kv2("Employee No", fmt(emp.employeeNumber), "Full Name", `${emp.firstName} ${emp.lastName}`);
  kv2("Position", fmt(emp.position), "Department", fmt(emp.department));

  const typeLabel: Record<string, string> = { permanent: "Permanent", contract: "Contract", fixed_term: "Fixed Term", probation: "Probation", casual: "Casual" };
  kv2("Employment Type", typeLabel[emp.employmentType] || fmt(emp.employmentType), "Currency", emp.currency || "USD");
  if (emp.contractStartDate || emp.contractEndDate) {
    kv2("Contract Start", fmtDate(emp.contractStartDate), "Contract End", emp.contractEndDate ? fmtDate(emp.contractEndDate) : "Open");
  }
  y += 6;

  // ── Banking (masked) ─────────────────────────────────────────
  if (emp.bankName || emp.bankAccountNumber) {
    bandTitle("Payment Information");
    kv2("Bank", fmt(emp.bankName), "Branch", fmt(emp.bankBranch));
    kv2("Account No", maskAccount(emp.bankAccountNumber), "Account Type", fmt(emp.bankAccountType));
    if (emp.bankBranchCode) kv2("Branch Code", fmt(emp.bankBranchCode), "SWIFT", fmt(emp.bankSwiftCode));
    y += 6;
  }

  // ── Proration note ────────────────────────────────────────────
  const daysWorked: number | null = (slip as any).daysWorked ?? slip.daysWorked ?? null;
  const totalDays: number | null = (slip as any).totalDays ?? slip.totalDays ?? null;
  if (daysWorked !== null && totalDays !== null) {
    ensureSpace(18);
    doc.rect(M, y, COL, 16).fill("#fef9c3");
    const factor = totalDays > 0 ? (daysWorked / totalDays) : 1;
    doc.font("Helvetica").fontSize(8).fillColor("#92400e")
      .text(`Prorated salary: ${daysWorked} of ${totalDays} working days worked (${(factor * 100).toFixed(1)}%). Earnings are prorated; fixed deductions are full amounts.`, M + 6, y + 4, { width: COL - 12 });
    y += 20;
  }

  // ── Earnings table ────────────────────────────────────────────
  const currency = (slip as any).currency || emp.currency || "USD";
  const earnings: any = (slip as any).earnings || {};
  const deductionsDetail: any = (slip as any).deductionsDetail || {};

  const earningsRows: [string, string][] = [];
  if (earnings.base != null && parseFloat(earnings.base) > 0) earningsRows.push(["Basic Salary", fmtMoney(earnings.base, currency)]);
  if (earnings.housing != null && parseFloat(earnings.housing) > 0) earningsRows.push(["Housing Allowance", fmtMoney(earnings.housing, currency)]);
  if (earnings.transport != null && parseFloat(earnings.transport) > 0) earningsRows.push(["Transport Allowance", fmtMoney(earnings.transport, currency)]);
  for (const a of (earnings.otherAllowances || [])) {
    if (a.name && parseFloat(a.amount) > 0) earningsRows.push([a.name, fmtMoney(a.amount, currency)]);
  }
  // Fallback if no detail: just show gross
  if (earningsRows.length === 0) earningsRows.push(["Total Earnings", fmtMoney((slip as any).grossAmount, currency)]);

  const deductionRows: [string, string][] = [];
  if (deductionsDetail.funeralPolicy != null && parseFloat(deductionsDetail.funeralPolicy) > 0) deductionRows.push(["Funeral Policy", fmtMoney(deductionsDetail.funeralPolicy, currency)]);
  if (deductionsDetail.otherInsurance != null && parseFloat(deductionsDetail.otherInsurance) > 0) deductionRows.push(["Other Insurance", fmtMoney(deductionsDetail.otherInsurance, currency)]);
  if (deductionsDetail.nssa != null && parseFloat(deductionsDetail.nssa) > 0) deductionRows.push(["NSSA", fmtMoney(deductionsDetail.nssa, currency)]);
  if (deductionsDetail.paye != null && parseFloat(deductionsDetail.paye) > 0) deductionRows.push(["PAYE (Income Tax)", fmtMoney(deductionsDetail.paye, currency)]);
  if (deductionsDetail.aidsLevy != null && parseFloat(deductionsDetail.aidsLevy) > 0) deductionRows.push(["AIDS Levy", fmtMoney(deductionsDetail.aidsLevy, currency)]);

  // Side-by-side earnings + deductions
  const tableTop = y;
  const tColW = COL / 2 - 4;

  // Earnings header
  ensureSpace(16);
  doc.rect(M, y, tColW, 15).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text("EARNINGS", M + 6, y + 3.5, { width: tColW - 12 });
  // Deductions header
  doc.rect(M + tColW + 8, y, tColW, 15).fill(C_RED);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff").text("DEDUCTIONS", M + tColW + 14, y + 3.5, { width: tColW - 12 });
  y += 18;

  const maxRows = Math.max(earningsRows.length, deductionRows.length);
  for (let i = 0; i < maxRows; i++) {
    ensureSpace(13);
    if (i % 2 === 0) {
      doc.rect(M, y, tColW, 13).fill("#f9fafb");
      doc.rect(M + tColW + 8, y, tColW, 13).fill("#fff5f5");
    }
    if (earningsRows[i]) {
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(earningsRows[i][0], M + 4, y + 2.5, { width: tColW - 70 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_GREEN).text(earningsRows[i][1], M + tColW - 66, y + 2.5, { width: 62, align: "right" });
    }
    if (deductionRows[i]) {
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(deductionRows[i][0], M + tColW + 12, y + 2.5, { width: tColW - 70 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_RED).text(deductionRows[i][1], M + COL - 62, y + 2.5, { width: 62, align: "right" });
    }
    y += 13;
  }

  // Totals row
  ensureSpace(16);
  doc.rect(M, y, tColW, 15).fill(C_LIGHT);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_ACCENT).text("GROSS EARNINGS", M + 4, y + 3.5, { width: tColW - 70 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_GREEN).text(fmtMoney((slip as any).grossAmount, currency), M + tColW - 66, y + 3.5, { width: 62, align: "right" });

  const totalDed = deductionsDetail.totalDeductions ?? (parseFloat((slip as any).grossAmount || "0") - parseFloat((slip as any).netAmount || "0"));
  doc.rect(M + tColW + 8, y, tColW, 15).fill("#fee2e2");
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_RED).text("TOTAL DEDUCTIONS", M + tColW + 12, y + 3.5, { width: tColW - 70 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_RED).text(fmtMoney(totalDed, currency), M + COL - 62, y + 3.5, { width: 62, align: "right" });
  y += 20;

  // ── Net pay ───────────────────────────────────────────────────
  ensureSpace(32);
  doc.rect(M, y, COL, 28).fill(C_ACCENT);
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#ffffff").text("NET PAY", M + 12, y + 8);
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff")
    .text(fmtMoney((slip as any).netAmount, currency), M, y + 6, { width: COL - 12, align: "right" });
  y += 36;

  // ── Signatures ────────────────────────────────────────────────
  ensureSpace(60);
  y += 12;
  const sigW = COL / 2 - 20;
  doc.moveTo(M, y + 30).lineTo(M + sigW, y + 30).lineWidth(0.5).strokeColor("#9ca3af").stroke();
  doc.moveTo(M + COL - sigW, y + 30).lineTo(M + COL, y + 30).lineWidth(0.5).strokeColor("#9ca3af").stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text("Authorised Signatory", M, y + 33, { width: sigW, align: "center" })
    .text("Employee Signature", M + COL - sigW, y + 33, { width: sigW, align: "center" });
  y += 50;

  // ── Footer ────────────────────────────────────────────────────
  doc.moveTo(M, y).lineTo(A4_W - M, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 6;
  doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
    .text(`${org.name || ""}  ·  This payslip is confidential. If you have any queries please contact the HR department.`, M, y, { width: COL, align: "center" });
  if (org.footerText) { y += 9; doc.text(org.footerText, M, y, { width: COL, align: "center" }); }
}
