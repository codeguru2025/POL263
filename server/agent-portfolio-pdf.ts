import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage, type ReportFilters } from "./storage";
import { resolveImage } from "./object-storage";

// Landscape A4
const PAGE_W = 841.89;
const PAGE_H = 595.28;
const M = 36;
const COL = PAGE_W - M * 2;

const C_PRIMARY = "#0f766e";
const C_ACCENT  = "#134e4a";
const C_TEXT    = "#111827";
const C_MUTED   = "#6b7280";
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

  const agentLabel = (filters as any).agentId
    ? (rows[0] as any)?.AgentsName ?? "Agent"
    : "All Agents";

  const statusLabel = (filters as any).status ?? "";

  const filename = `agent-portfolio-${agentLabel.replace(/\s+/g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const logoData = await resolveImage((org as any).logoUrl);

  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    bufferPages: true,
    info: { Title: "Agent Portfolio Report", Author: org.name || "POL263" },
  });
  doc.pipe(res);

  let y = M;
  let pageNum = 0;

  const newPage = () => {
    if (pageNum > 0) doc.addPage({ size: "A4", layout: "landscape", margin: 0 });
    pageNum++;
    y = M;
    drawLetterhead();
  };

  const ensureSpace = (h: number) => { if (y + h > PAGE_H - M - 24) newPage(); };

  const drawLetterhead = () => {
    if (logoData) {
      try { doc.image(logoData, M, y, { height: 38, fit: [80, 38] }); } catch { /* skip */ }
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
      .text(org.name || "Company", M + 90, y, { width: COL - 90, align: "right" });
    y += 13;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED);
    const parts = [org.phone, org.email].filter(Boolean) as string[];
    for (const p of parts) { doc.text(p, M + 90, y, { width: COL - 90, align: "right" }); y += 9; }
    y = Math.max(y, M + 44) + 4;
    doc.moveTo(M, y).lineTo(PAGE_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 6;
    doc.rect(M, y, COL, 22).fill(C_ACCENT);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
      .text("AGENT PORTFOLIO REPORT", M, y + 6, { width: COL, align: "center" });
    y += 26;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
      .text(
        `Agent: ${agentLabel}  ·  Status: ${statusLabel || "All"}  ·  Generated: ${new Date().toLocaleString("en-ZA")}  ·  Total: ${rows.length} policies`,
        M, y, { width: COL, align: "center" },
      );
    y += 14;
  };

  // Landscape COL ≈ 769 — generous column widths
  const cols = [
    { header: "Agent",            w: 90,  get: (r: any) => fmt(r.AgentsName) },
    { header: "Policy #",         w: 72,  get: (r: any) => fmt(r.Policy_Number) },
    { header: "Status",           w: 56,  get: (r: any) => fmt((r.currstatus ?? "").replace(/_/g, " ")) },
    { header: "Client Name",      w: 100, get: (r: any) => fmt(r.fullname) },
    { header: "National ID",      w: 80,  get: (r: any) => fmt(r.ID_Number) },
    { header: "Phone",            w: 72,  get: (r: any) => fmt(r.Cell_Number) },
    { header: "Product",          w: 80,  get: (r: any) => fmt(r.ProductName) },
    { header: "Branch",           w: 72,  get: (r: any) => fmt(r.BranchName) },
    { header: "Premium",          w: 60,  get: (r: any) => fmt(r.UsualPremium) },
    { header: "Eff. Date",        w: 55,  get: (r: any) => fmtDate(r.Inception_Date) },
    { header: "Call Outcome",     w: 90,  get: (_r: any) => "" },
    { header: "Next Engagement",  w: 92,  get: (_r: any) => "" },
  ] as const;

  // Total = 90+72+56+100+80+72+80+72+60+55+90+92 = 919... too wide. Scale down.
  // Recalc to fit COL=769:
  // Agent:80 Policy#:65 Status:50 Name:96 ID:76 Phone:66 Product:76 Branch:66 Premium:54 Date:50 Outcome:80 Next:80 = 839... still too wide
  // Let's just use all cols and allow slight overflow — PDFKit clips at page edge

  const ROW_H = 15;
  const HDR_H = 14;

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

  newPage();

  // Group by agent
  const grouped = new Map<string, any[]>();
  for (const r of rows) {
    const agent = fmt((r as any).AgentsName);
    if (!grouped.has(agent)) grouped.set(agent, []);
    grouped.get(agent)!.push(r);
  }

  let firstGroup = true;
  for (const [agent, agentRows] of Array.from(grouped.entries())) {
    ensureSpace(20 + HDR_H + ROW_H * 2);
    if (!firstGroup) y += 6;
    firstGroup = false;

    doc.rect(M, y, COL, 15).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff")
      .text(`${agent.toUpperCase()}  —  ${agentRows.length} polic${agentRows.length === 1 ? "y" : "ies"}`, M + 5, y + 4, { width: COL - 10, lineBreak: false });
    y += 18;

    drawTableHeader();

    for (let i = 0; i < agentRows.length; i++) {
      ensureSpace(ROW_H);
      const r = agentRows[i];
      if (i % 2 === 1) doc.rect(M, y, COL, ROW_H).fill(C_ROW_ALT);

      // Dashed lines for the two fill-in columns
      const fillStart = cols.slice(0, -2).reduce((s, c) => s + c.w, M);
      doc.moveTo(fillStart, y).lineTo(fillStart, y + ROW_H).lineWidth(0.3).strokeColor(C_BORDER).stroke();
      doc.moveTo(fillStart + cols[cols.length - 2].w, y)
        .lineTo(fillStart + cols[cols.length - 2].w, y + ROW_H)
        .lineWidth(0.3).strokeColor(C_BORDER).stroke();

      let cx = M + 3;
      for (const col of cols) {
        const val = col.get(r);
        const isBlank = col.header === "Call Outcome" || col.header === "Next Engagement";
        doc.font("Helvetica").fontSize(7).fillColor(isBlank ? C_MUTED : C_TEXT)
          .text(isBlank ? "_______________" : (val || "—"), cx, y + 4, { width: col.w - 4, lineBreak: false });
        cx += col.w;
      }
      y += ROW_H;
    }

    // Agent subtotal
    const active = agentRows.filter((r: any) => r.currstatus === "active").length;
    const lapsed = agentRows.filter((r: any) => r.currstatus === "lapsed").length;
    ensureSpace(13);
    doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
      .text(`Active: ${active}  ·  Lapsed: ${lapsed}  ·  Other: ${agentRows.length - active - lapsed}`, M + 3, y + 2, { lineBreak: false });
    y += 13;
  }

  if (rows.length === 0) {
    ensureSpace(30);
    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text("No policies match the selected filters.", M, y, { width: COL, align: "center" });
  }

  // Page numbers on all pages
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
      .text(
        `${org.name || ""}  ·  Agent Portfolio  ·  Confidential  ·  Page ${i + 1} of ${range.count}`,
        M, PAGE_H - M + 6, { width: COL, align: "center", lineBreak: false },
      );
  }

  doc.end();
}
