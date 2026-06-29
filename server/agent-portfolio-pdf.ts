import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage, type ReportFilters } from "./storage";
import { resolveImage } from "./object-storage";

const A4_W = 595.28;
const A4_H = 841.89;
const M = 36;
const COL = A4_W - M * 2;

const C_PRIMARY = "#0f766e";
const C_ACCENT  = "#134e4a";
const C_TEXT    = "#111827";
const C_MUTED   = "#6b7280";
const C_LIGHT   = "#f0fdf4";
const C_ROW_ALT = "#f9fafb";
const C_BORDER  = "#e5e7eb";

function fmt(v: string | null | undefined): string { return v?.trim() || "—"; }
function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return String(v); }
}

export async function streamAgentPortfolioPDF(
  orgId: string,
  filters: ReportFilters,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const rows = await storage.getAllPoliciesReportByOrg(orgId, 5000, 0, filters);

  const agentLabel = filters.agentId
    ? (rows[0] as any)?.MarketingManager ?? (rows[0] as any)?.AgentName ?? "Agent"
    : "All Agents";

  const statusLabel = (filters as any).status ?? (filters as any).statuses
    ? String((filters as any).status ?? (filters as any).statuses ?? "").replace(/_/g, " ")
    : "All Statuses";

  const filename = `agent-portfolio-${agentLabel.replace(/\s+/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const logoData = await resolveImage((org as any).logoUrl);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true,
    info: { Title: "Agent Portfolio Report", Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = M;
  let pageNum = 0;

  const newPage = () => {
    if (pageNum > 0) doc.addPage({ size: "A4", margin: 0 });
    pageNum++;
    y = M;
    drawLetterhead();
  };

  const ensureSpace = (h: number) => { if (y + h > A4_H - M - 28) newPage(); };

  const drawLetterhead = () => {
    if (logoData) {
      try { doc.image(logoData, M, y, { height: 44, fit: [90, 44] }); } catch { /* skip */ }
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
      .text(org.name || "Company", M + 100, y, { width: COL - 100, align: "right" });
    y += 13;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED);
    const parts = [org.phone, org.email, org.address].filter(Boolean) as string[];
    for (const p of parts) { doc.text(p, M + 100, y, { width: COL - 100, align: "right" }); y += 9; }
    y = Math.max(y, M + 50) + 6;
    doc.moveTo(M, y).lineTo(A4_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 6;
    doc.rect(M, y, COL, 24).fill(C_ACCENT);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
      .text("AGENT PORTFOLIO REPORT", M, y + 7, { width: COL, align: "center" });
    y += 28;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
      .text(
        `Agent: ${agentLabel}  ·  Status filter: ${statusLabel || "All"}  ·  Generated: ${new Date().toLocaleString("en-ZA")}  ·  Total policies: ${rows.length}`,
        M, y, { width: COL, align: "center" },
      );
    y += 16;
  };

  // ── Column layout ──────────────────────────────────────────────
  // Total COL ≈ 523 (36 margin, A4_W=595.28)
  const cols = [
    { header: "Agent",          w: 68,  get: (r: any) => fmt(r.MarketingManager ?? r.AgentName) },
    { header: "Policy #",       w: 64,  get: (r: any) => fmt(r.Policy_Number) },
    { header: "Status",         w: 48,  get: (r: any) => fmt((r.currstatus ?? r.StatusDesc ?? "").replace(/_/g, " ")) },
    { header: "Client Name",    w: 84,  get: (r: any) => fmt(r.fullname ?? [r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")) },
    { header: "National ID",    w: 70,  get: (r: any) => fmt(r.clientNationalId ?? r.ID_Number) },
    { header: "Phone",          w: 62,  get: (r: any) => fmt(r.Cell_Number) },
    { header: "Product",        w: 60,  get: (r: any) => fmt(r.Product_Name) },
    { header: "Premium",        w: 50,  get: (r: any) => `${r.Currency ?? ""} ${r.UsualPremium ?? r.premiumAmount ?? ""}`.trim() || "—" },
    { header: "Eff. Date",      w: 50,  get: (r: any) => fmtDate(r.Inception_Date) },
    { header: "Call Outcome",   w: 72,  get: (_r: any) => "" },
    { header: "Next Engagement",w: 72,  get: (_r: any) => "" },
  ] as const;

  const ROW_H = 16;
  const HDR_H = 15;

  const drawTableHeader = () => {
    ensureSpace(HDR_H + ROW_H);
    doc.rect(M, y, COL, HDR_H).fill("#e2e8f0");
    let cx = M + 3;
    for (const col of cols) {
      doc.font("Helvetica-Bold").fontSize(6.5).fillColor(C_ACCENT)
        .text(col.header, cx, y + 3, { width: col.w - 4, lineBreak: false });
      cx += col.w;
    }
    y += HDR_H + 1;
  };

  // ── Render rows grouped by agent ──────────────────────────────
  newPage();

  // Group rows by agent
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const agent = fmt((r as any).MarketingManager ?? (r as any).AgentName);
    if (!grouped.has(agent)) grouped.set(agent, []);
    grouped.get(agent)!.push(r);
  }

  let firstGroup = true;
  for (const [agent, agentRows] of Array.from(grouped.entries())) {
    // Agent section header
    ensureSpace(20 + HDR_H + ROW_H * 2);
    if (!firstGroup) y += 6;
    firstGroup = false;

    doc.rect(M, y, COL, 16).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
      .text(`${agent.toUpperCase()}  —  ${agentRows.length} polic${agentRows.length === 1 ? "y" : "ies"}`, M + 5, y + 4, { width: COL - 10, lineBreak: false });
    y += 19;

    drawTableHeader();

    for (let i = 0; i < agentRows.length; i++) {
      ensureSpace(ROW_H);
      const r = agentRows[i];
      if (i % 2 === 1) doc.rect(M, y, COL, ROW_H).fill(C_ROW_ALT);

      // Draw column dividers for the two "fill in" columns
      const fillColsStart = cols.slice(0, -2).reduce((s, c) => s + c.w, M);
      doc.moveTo(fillColsStart, y).lineTo(fillColsStart, y + ROW_H).lineWidth(0.3).strokeColor(C_BORDER).stroke();
      doc.moveTo(fillColsStart + cols[cols.length - 2].w, y)
        .lineTo(fillColsStart + cols[cols.length - 2].w, y + ROW_H)
        .lineWidth(0.3).strokeColor(C_BORDER).stroke();

      let cx = M + 3;
      for (const col of cols) {
        const val = col.get(r);
        doc.font("Helvetica").fontSize(7).fillColor(val ? C_TEXT : C_MUTED)
          .text(val || (col.header === "Call Outcome" || col.header === "Next Engagement" ? "____________" : ""), cx, y + 4, { width: col.w - 4, lineBreak: false });
        cx += col.w;
      }
      y += ROW_H;
    }

    // Agent subtotal line
    const active = agentRows.filter((r: any) => (r.currstatus ?? r.StatusDesc ?? "").toLowerCase() === "active").length;
    const lapsed = agentRows.filter((r: any) => (r.currstatus ?? r.StatusDesc ?? "").toLowerCase() === "lapsed").length;
    ensureSpace(14);
    doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
      .text(`Active: ${active}  ·  Lapsed: ${lapsed}  ·  Other: ${agentRows.length - active - lapsed}`, M + 3, y + 2, { width: COL, lineBreak: false });
    y += 14;
  }

  if (rows.length === 0) {
    ensureSpace(30);
    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text("No policies match the selected filters.", M, y, { width: COL, align: "center" });
    y += 30;
  }

  // ── Footer on all pages ───────────────────────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = A4_H - M + 6;
    doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
      .text(
        `${org.name || ""}  ·  Agent Portfolio Report  ·  Confidential  ·  Page ${i + 1} of ${range.count}`,
        M, fy, { width: COL, align: "center", lineBreak: false },
      );
  }

  doc.end();
}
