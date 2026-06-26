/**
 * Department Reports PDF — company letterhead.
 * Supported depts: funeral | finance | hr | mortuary | sales | claims
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { eq, and, gte, lte } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import {
  funeralCases, policies, claims, mortuaryIntakes, paymentReceipts, serviceReceipts,
} from "../shared/schema";

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

export type DeptId = "funeral" | "finance" | "hr" | "mortuary" | "sales" | "claims";

const DEPT_LABELS: Record<DeptId, string> = {
  funeral: "Operations — Funeral Services",
  finance: "Finance Department",
  hr: "Human Resources & Payroll",
  mortuary: "Mortuary Department",
  sales: "Sales & Policy Administration",
  claims: "Claims Department",
};

function fmt(v: string | null | undefined): string { return v?.trim() || "—"; }
function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }); } catch { return String(v); }
}
function fmtMoney(v: string | number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = parseFloat(String(v));
  if (isNaN(n)) return "—";
  return `${currency} ${n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function streamDepartmentReportToResponse(
  orgId: string,
  dept: DeptId,
  fromDate: string,
  toDate: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const logoData = await resolveImage(org.logoUrl);
  const deptLabel = DEPT_LABELS[dept] ?? dept;
  const filename = `${dept}-report-${fromDate}-to-${toDate}.pdf`;

  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: M, bufferPages: true, info: { Title: `${deptLabel} Report`, Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = M;
  let pageNum = 0;

  // ── Shared layout helpers ─────────────────────────────────────
  const newPage = () => {
    if (pageNum > 0) doc.addPage();
    pageNum++;
    y = M;
    drawLetterhead();
  };

  const ensureSpace = (h: number) => { if (y + h > A4_H - M - 24) newPage(); };

  const drawLetterhead = () => {
    if (logoData) {
      try { doc.image(logoData, M, y, { height: 50, fit: [100, 50] }); } catch { /* skip */ }
    }
    doc.font("Helvetica-Bold").fontSize(12).fillColor(C_PRIMARY)
      .text(org.name || "Company", M + 110, y, { width: COL - 110, align: "right" });
    y += 15;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED);
    const parts = [org.phone, org.email, org.address].filter(Boolean) as string[];
    for (const p of parts) { doc.text(p, M + 110, y, { width: COL - 110, align: "right" }); y += 10; }
    y = Math.max(y, M + 56) + 8;
    doc.moveTo(M, y).lineTo(A4_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 8;
    // Dept title band
    doc.rect(M, y, COL, 26).fill(C_ACCENT);
    doc.font("Helvetica-Bold").fontSize(12).fillColor("#ffffff")
      .text(deptLabel.toUpperCase(), M, y + 7, { width: COL, align: "center" });
    y += 30;
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
      .text(`Period: ${fmtDate(fromDate)} to ${fmtDate(toDate)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`, M, y, { width: COL, align: "center" });
    y += 18;
  };

  const sectionBand = (title: string) => {
    ensureSpace(22);
    doc.rect(M, y, COL, 16).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
      .text(title.toUpperCase(), M + 6, y + 4, { width: COL - 12 });
    y += 19;
    doc.fillColor(C_TEXT);
  };

  const kv = (label: string, value: string, lw = 160) => {
    ensureSpace(14);
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(label, M, sy, { width: lw });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(value, M + lw + 6, sy, { width: COL - lw - 6 });
    y += 13;
  };

  const kv2 = (l1: string, v1: string, l2: string, v2: string) => {
    ensureSpace(14);
    const half = COL / 2 - 4;
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l1, M, sy, { width: 100 });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v1, M + 104, sy, { width: half - 104 });
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(l2, M + half + 8, sy, { width: 100 });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(v2, M + half + 112, sy, { width: half - 104 });
    y += 13;
  };

  // Generic table renderer
  type ColDef = { header: string; width: number; align?: "left" | "right" | "center"; getter: (row: any) => string };
  const drawTable = (cols: ColDef[], rows: any[], emptyMsg = "No records found.") => {
    if (rows.length === 0) {
      ensureSpace(24);
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(emptyMsg, M, y, { width: COL });
      y += 18;
      return;
    }
    // Header row
    ensureSpace(18);
    doc.rect(M, y, COL, 15).fill("#e2e8f0");
    let cx = M + 4;
    for (const col of cols) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_ACCENT)
        .text(col.header, cx, y + 3, { width: col.width - 6, align: col.align ?? "left" });
      cx += col.width;
    }
    y += 17;
    // Data rows
    for (let i = 0; i < rows.length; i++) {
      ensureSpace(14);
      if (i % 2 === 1) doc.rect(M, y, COL, 13).fill(C_ROW_ALT);
      cx = M + 4;
      for (const col of cols) {
        const val = col.getter(rows[i]);
        doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT)
          .text(val, cx, y + 2, { width: col.width - 6, align: col.align ?? "left", lineBreak: false });
        cx += col.width;
      }
      y += 14;
    }
    y += 6;
  };

  const statBox = (label: string, value: string, color = C_PRIMARY) => {
    ensureSpace(36);
    doc.rect(M, y, COL / 3 - 6, 30).fill(C_LIGHT).stroke(color);
    // just inline stats via kv instead for now
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text(label, M + 4, y + 5, { width: COL / 3 - 14 });
    doc.font("Helvetica-Bold").fontSize(11).fillColor(color).text(value, M + 4, y + 14, { width: COL / 3 - 14 });
    y += 34;
  };

  const statRow = (stats: { label: string; value: string }[]) => {
    ensureSpace(36);
    const w = Math.floor(COL / stats.length);
    let sx = M;
    for (const s of stats) {
      doc.rect(sx, y, w - 6, 30).fill(C_LIGHT);
      doc.font("Helvetica").fontSize(7).fillColor(C_MUTED).text(s.label, sx + 4, y + 4, { width: w - 14 });
      doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY).text(s.value, sx + 4, y + 14, { width: w - 14 });
      sx += w;
    }
    y += 36;
  };

  newPage();

  const tdb = await getDbForOrg(orgId);
  const from0 = fromDate + "T00:00:00";
  const to23 = toDate + "T23:59:59";

  try {

  // ════════════════════════════════════════════════════════════
  // FUNERAL DEPARTMENT
  // ════════════════════════════════════════════════════════════
  if (dept === "funeral") {
    const allCases = await tdb.select().from(funeralCases)
      .where(and(eq(funeralCases.organizationId, orgId), gte(funeralCases.createdAt, new Date(from0)), lte(funeralCases.createdAt, new Date(to23))));
    const byStatus: Record<string, number> = {};
    for (const fc of allCases) byStatus[fc.status] = (byStatus[fc.status] ?? 0) + 1;
    const upcoming = allCases.filter(fc => fc.funeralDate && fc.funeralDate >= fromDate && fc.funeralDate <= toDate);

    sectionBand("Summary Statistics");
    statRow([
      { label: "Total Cases", value: String(allCases.length) },
      { label: "Open", value: String(byStatus["open"] ?? 0) },
      { label: "In Progress", value: String(byStatus["in_progress"] ?? 0) },
      { label: "Completed", value: String(byStatus["completed"] ?? 0) },
    ]);

    sectionBand("Cases by Status");
    kv("Open", String(byStatus["open"] ?? 0));
    kv("In Progress", String(byStatus["in_progress"] ?? 0));
    kv("Completed", String(byStatus["completed"] ?? 0));
    for (const [s, n] of Object.entries(byStatus)) {
      if (!["open", "in_progress", "completed"].includes(s)) kv(s.replace(/_/g, " "), String(n));
    }
    y += 8;

    sectionBand("All Cases in Period");
    drawTable([
      { header: "Case No", width: 80, getter: r => r.caseNumber },
      { header: "Deceased", width: 120, getter: r => r.deceasedName },
      { header: "Status", width: 80, getter: r => fmt(r.status).replace(/_/g, " ") },
      { header: "Funeral Date", width: 80, getter: r => fmtDate(r.funeralDate) },
      { header: "Location", width: COL - 360, getter: r => fmt(r.funeralLocation) },
    ], allCases);

    if (upcoming.length > 0) {
      sectionBand("Upcoming Funerals (Scheduled in Period)");
      drawTable([
        { header: "Case No", width: 80, getter: r => r.caseNumber },
        { header: "Deceased", width: 120, getter: r => r.deceasedName },
        { header: "Funeral Date", width: 90, getter: r => fmtDate(r.funeralDate) },
        { header: "Location", width: 100, getter: r => fmt(r.funeralLocation) },
        { header: "Departure Time", width: COL - 390, getter: r => r.burialDepartureTime ? new Date(r.burialDepartureTime).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" }) : "—" },
      ], upcoming);
    }
  }

  // ════════════════════════════════════════════════════════════
  // FINANCE DEPARTMENT
  // ════════════════════════════════════════════════════════════
  if (dept === "finance") {
    const [policyRecs, svcRecs] = await Promise.all([
      tdb.select().from(paymentReceipts)
        .where(and(eq(paymentReceipts.organizationId, orgId), gte(paymentReceipts.issuedAt, new Date(from0)), lte(paymentReceipts.issuedAt, new Date(to23)))),
      tdb.select().from(serviceReceipts)
        .where(and(eq(serviceReceipts.organizationId, orgId), gte(serviceReceipts.issuedAt, new Date(from0)), lte(serviceReceipts.issuedAt, new Date(to23)))),
    ]);

    const allReceipts = [...policyRecs, ...svcRecs];
    const totalAmount = allReceipts.reduce((s, r) => s + parseFloat(String(r.amount) || "0"), 0);
    const byCurrency: Record<string, number> = {};
    for (const r of allReceipts) byCurrency[r.currency] = (byCurrency[r.currency] ?? 0) + parseFloat(String(r.amount) || "0");

    sectionBand("Summary Statistics");
    statRow([
      { label: "Policy Payment Receipts", value: String(policyRecs.length) },
      { label: "Service / Funeral Receipts", value: String(svcRecs.length) },
      { label: "Total Receipts", value: String(allReceipts.length) },
      { label: "Total Collected", value: fmtMoney(totalAmount) },
    ]);

    sectionBand("Collections by Currency");
    for (const [curr, amt] of Object.entries(byCurrency)) kv(curr, fmtMoney(amt, curr));
    y += 8;

    if (policyRecs.length > 0) {
      sectionBand("Policy Payment Receipts");
      drawTable([
        { header: "Receipt No", width: 90, getter: r => fmt(r.receiptNumber) },
        { header: "Date Issued", width: 90, getter: r => fmtDate(r.issuedAt) },
        { header: "Amount", width: 80, align: "right", getter: r => `${r.currency} ${parseFloat(String(r.amount)).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}` },
        { header: "Channel", width: 90, getter: r => fmt(r.paymentChannel).replace(/_/g, " ") },
        { header: "Policy ID", width: COL - 350, getter: r => r.policyId ? r.policyId.slice(0, 8) + "…" : "—" },
      ], policyRecs.slice(0, 200));
      if (policyRecs.length > 200) { doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text(`(Showing first 200 of ${policyRecs.length} records)`, M, y); y += 14; }
    }

    if (svcRecs.length > 0) {
      sectionBand("Service / Funeral Receipts");
      drawTable([
        { header: "Receipt No", width: 90, getter: r => fmt(r.receiptNumber) },
        { header: "Date Issued", width: 90, getter: r => fmtDate(r.issuedAt) },
        { header: "Amount", width: 80, align: "right", getter: r => `${r.currency} ${parseFloat(String(r.amount)).toLocaleString("en-ZA", { minimumFractionDigits: 2 })}` },
        { header: "Channel", width: 90, getter: r => fmt(r.paymentChannel).replace(/_/g, " ") },
        { header: "Notes", width: COL - 350, getter: r => fmt((r as any).notes) },
      ], svcRecs.slice(0, 200));
    }

    if (allReceipts.length === 0) {
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text("No receipts found for the selected period.", M, y, { width: COL });
      y += 16;
    }
  }

  // ════════════════════════════════════════════════════════════
  // HR / PAYROLL DEPARTMENT
  // ════════════════════════════════════════════════════════════
  if (dept === "hr") {
    const [employees, attendanceLogs_] = await Promise.all([
      storage.getPayrollEmployees(orgId),
      storage.getAttendanceLogs(orgId, { date: undefined, status: undefined }),
    ]);

    const periodLogs = attendanceLogs_.filter((l: any) => l.date >= fromDate && l.date <= toDate);
    const byStatus: Record<string, number> = {};
    for (const l of periodLogs) byStatus[(l as any).status] = (byStatus[(l as any).status] ?? 0) + 1;

    const activeEmps = employees.filter(e => e.isActive !== false);

    sectionBand("Workforce Summary");
    statRow([
      { label: "Total Employees", value: String(employees.length) },
      { label: "Active", value: String(activeEmps.length) },
      { label: "Attendance Logs (Period)", value: String(periodLogs.length) },
      { label: "Pending Approvals", value: String(byStatus["pending"] ?? 0) },
    ]);

    sectionBand("Attendance Summary (Period)");
    kv("Approved Logs", String(byStatus["approved"] ?? 0));
    kv("Pending Logs", String(byStatus["pending"] ?? 0));
    kv("Rejected Logs", String(byStatus["rejected"] ?? 0));
    kv("Total Logs", String(periodLogs.length));
    y += 8;

    sectionBand("Employee Register");
    drawTable([
      { header: "Employee No", width: 90, getter: r => fmt(r.employeeNumber) },
      { header: "Name", width: 140, getter: r => `${fmt(r.firstName)} ${fmt(r.lastName)}` },
      { header: "Department", width: 90, getter: r => fmt(r.department) },
      { header: "Position", width: 90, getter: r => fmt(r.position) },
      { header: "Active", width: 60, getter: r => r.isActive === false ? "Inactive" : "Active" },
      { header: "Base Salary", width: COL - 470, align: "right", getter: r => fmtMoney(r.baseSalary, r.currency) },
    ], employees);
  }

  // ════════════════════════════════════════════════════════════
  // MORTUARY DEPARTMENT
  // ════════════════════════════════════════════════════════════
  if (dept === "mortuary") {
    const allIntakes = await storage.getMortuaryIntakesByOrg(orgId, { limit: 2000 });
    const intakes = allIntakes.filter(mi => {
      const d = (mi as any).receivedAt ?? (mi as any).createdAt;
      if (!d) return true;
      const ds = new Date(d).toISOString().slice(0, 10);
      return ds >= fromDate && ds <= toDate;
    });

    const byStatus: Record<string, number> = {};
    for (const mi of intakes) byStatus[mi.status] = (byStatus[mi.status] ?? 0) + 1;
    const inStorage = intakes.filter(mi => mi.status === "in_storage");
    const dispatched = intakes.filter(mi => mi.status === "dispatched");

    sectionBand("Mortuary Register Summary");
    statRow([
      { label: "Total Intakes", value: String(intakes.length) },
      { label: "Currently in Storage", value: String(inStorage.length) },
      { label: "Dispatched", value: String(dispatched.length) },
    ]);

    sectionBand("Current Occupants (In Storage)");
    drawTable([
      { header: "Intake No", width: 80, getter: r => fmt(r.intakeNumber) },
      { header: "Deceased Name", width: 130, getter: r => fmt(r.deceasedName) },
      { header: "Date Received", width: 90, getter: r => fmtDate(r.receivedAt ?? r.createdAt) },
      { header: "Scope", width: 90, getter: r => fmt(r.serviceScope).replace(/_/g, " ") },
      { header: "Days in Storage", width: COL - 390, align: "right", getter: r => {
        const d = r.receivedAt ?? r.createdAt;
        if (!d) return "—";
        return String(Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000))) + " days";
      }},
    ], inStorage);

    sectionBand("All Intakes Register");
    drawTable([
      { header: "Intake No", width: 80, getter: r => fmt(r.intakeNumber) },
      { header: "Deceased Name", width: 130, getter: r => fmt(r.deceasedName) },
      { header: "Status", width: 80, getter: r => fmt(r.status).replace(/_/g, " ") },
      { header: "Date Received", width: 90, getter: r => fmtDate(r.receivedAt ?? r.createdAt) },
      { header: "Scope", width: COL - 380, getter: r => fmt(r.serviceScope).replace(/_/g, " ") },
    ], intakes.slice(0, 200));
  }

  // ════════════════════════════════════════════════════════════
  // SALES / POLICY ADMINISTRATION
  // ════════════════════════════════════════════════════════════
  if (dept === "sales") {
    const allPolicies = await tdb.select().from(policies)
      .where(and(eq(policies.organizationId, orgId), gte(policies.createdAt, new Date(from0)), lte(policies.createdAt, new Date(to23))));

    const byStatus: Record<string, number> = {};
    for (const p of allPolicies) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

    const totalPremium = allPolicies.reduce((s, p) => s + parseFloat(String(p.premiumAmount) || "0"), 0);

    sectionBand("Sales Summary");
    statRow([
      { label: "Policies Issued", value: String(allPolicies.length) },
      { label: "Active", value: String(byStatus["active"] ?? 0) },
      { label: "Lapsed / Cancelled", value: String((byStatus["lapsed"] ?? 0) + (byStatus["cancelled"] ?? 0)) },
      { label: "Total Monthly Premium", value: fmtMoney(totalPremium) },
    ]);

    sectionBand("Policies by Status");
    for (const [s, n] of Object.entries(byStatus)) kv(s.replace(/_/g, " "), String(n));
    y += 8;

    sectionBand("Policy Register (Period)");
    drawTable([
      { header: "Policy No", width: 90, getter: r => fmt(r.policyNumber) },
      { header: "Status", width: 70, getter: r => fmt(r.status) },
      { header: "Start Date", width: 80, getter: r => fmtDate(r.startDate) },
      { header: "Premium", width: 80, align: "right", getter: r => fmtMoney(r.premiumAmount, r.currency) },
      { header: "Schedule", width: 80, getter: r => fmt(r.paymentSchedule) },
      { header: "Currency", width: COL - 400, getter: r => fmt(r.currency) },
    ], allPolicies.slice(0, 200));
  }

  // ════════════════════════════════════════════════════════════
  // CLAIMS DEPARTMENT
  // ════════════════════════════════════════════════════════════
  if (dept === "claims") {
    const allClaims = await tdb.select().from(claims)
      .where(and(eq(claims.organizationId, orgId), gte(claims.createdAt, new Date(from0)), lte(claims.createdAt, new Date(to23))));

    const byStatus: Record<string, number> = {};
    for (const c of allClaims) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;

    const totalCashInLieu = allClaims
      .reduce((s, c) => s + parseFloat(String(c.cashInLieuAmount) || "0"), 0);

    sectionBand("Claims Summary");
    statRow([
      { label: "Total Claims", value: String(allClaims.length) },
      { label: "Submitted / Pending", value: String((byStatus["submitted"] ?? 0) + (byStatus["pending"] ?? 0)) },
      { label: "Approved / Paid", value: String((byStatus["approved"] ?? 0) + (byStatus["paid"] ?? 0)) },
      { label: "Rejected", value: String(byStatus["rejected"] ?? 0) },
    ]);

    sectionBand("Claims by Status");
    for (const [s, n] of Object.entries(byStatus)) kv(s.replace(/_/g, " "), String(n));
    if (totalCashInLieu > 0) kv("Total Cash in Lieu Amount", fmtMoney(totalCashInLieu));
    y += 8;

    sectionBand("Claims Register (Period)");
    drawTable([
      { header: "Claim No", width: 90, getter: r => fmt(r.claimNumber) },
      { header: "Type", width: 80, getter: r => fmt(r.claimType) },
      { header: "Status", width: 80, getter: r => fmt(r.status) },
      { header: "Date Filed", width: 90, getter: r => fmtDate(r.createdAt) },
      { header: "Deceased", width: 110, getter: r => fmt(r.deceasedName) },
      { header: "Cash in Lieu", width: COL - 450, align: "right", getter: r => fmtMoney(r.cashInLieuAmount, r.currency) },
    ], allClaims.slice(0, 200));
  }

  } catch (err) {
    ensureSpace(60);
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#dc2626")
      .text("Error generating report data", M, y, { width: COL });
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT)
      .text(String((err as Error).message ?? err), M, y, { width: COL });
    y += 14;
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
      .text("This may indicate pending database migrations. Please run npm run db:migrate and try again.", M, y, { width: COL });
    y += 14;
  }

  // ── Footer on all pages ──────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = A4_H - M + 6;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`${org.name || ""}  ·  ${deptLabel}  ·  Confidential  ·  Page ${i + 1} of ${range.count}`, M, fy, { width: COL, align: "center", lineBreak: false });
    if (org.footerText) {
      doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
        .text(org.footerText, M, fy + 9, { width: COL, align: "center", lineBreak: false });
    }
  }

  doc.end();
}
