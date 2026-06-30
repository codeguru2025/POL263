/**
 * Requisition form PDF — filled and blank variants.
 * Pattern mirrors receipt-pdf.ts: explicit y-coordinate tracking on A4.
 */

import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";

const A4_W  = 595.28;
const A4_H  = 841.89;
const MARGIN = 48;
const COL   = A4_W - MARGIN * 2;

const C_PRIMARY = "#0f766e";
const C_TEXT    = "#111827";
const C_MUTED   = "#6b7280";
const C_BORDER  = "#e5e7eb";
const C_FILL    = "#f9fafb";

const TZ = "Africa/Harare";

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d + (d.length === 10 ? "T00:00:00" : "")) : d;
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

function statusColor(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "approved": return "#059669";
    case "paid":     return "#0284c7";
    case "rejected": return "#dc2626";
    case "partial":  return "#d97706";
    default:         return "#6b7280";
  }
}

/** Render the company letterhead and return the y after the divider rule. */
function drawLetterhead(doc: InstanceType<typeof PDFDocument>, org: any, logoData: Buffer | null, title: string): number {
  let y = MARGIN;

  // Logo (left)
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }

  // Org name + contacts (right)
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "POL263", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone)   parts.push(org.phone);
  if (org.email)   parts.push(org.email);
  if (org.address) parts.push(org.address);
  parts.forEach(p => {
    doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" });
    y += 11;
  });
  y = Math.max(y, MARGIN + 56) + 12;

  // Primary divider
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 10;

  // Document title (centred, right side)
  doc.font("Helvetica-Bold").fontSize(15).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 22;

  // Light sub-divider
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 10;

  return y;
}

/** Two-column info row. */
function twoCol(doc: InstanceType<typeof PDFDocument>, y: number,
  leftLabel: string, leftVal: string,
  rightLabel: string, rightVal: string): number {
  const colW  = (COL - 10) / 2;
  const labelW = 80;
  const valW   = colW - labelW - 4;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
    .text(leftLabel, MARGIN, y, { width: labelW, lineBreak: false });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(leftVal || "—", MARGIN + labelW + 4, y, { width: valW, lineBreak: false });

  const rx = MARGIN + colW + 10;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
    .text(rightLabel, rx, y, { width: labelW, lineBreak: false });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(rightVal || "—", rx + labelW + 4, y, { width: valW, lineBreak: false });

  return y + 16;
}

/** Draw line-items table header. Returns new y. */
function tableHeader(doc: InstanceType<typeof PDFDocument>, y: number): number {
  const cols = { desc: 200, cat: 110, qty: 50, unit: 70, total: 69 };
  doc.rect(MARGIN, y, COL, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8).fillColor("#ffffff");
  let x = MARGIN + 4;
  doc.text("Description",  x,          y + 4, { width: cols.desc - 4,  lineBreak: false });
  doc.text("Category",     x += cols.desc,  y + 4, { width: cols.cat - 4,   lineBreak: false });
  doc.text("Qty",          x += cols.cat,   y + 4, { width: cols.qty - 4,   lineBreak: false, align: "right" });
  doc.text("Unit Price",   x += cols.qty,   y + 4, { width: cols.unit - 4,  lineBreak: false, align: "right" });
  doc.text("Total",        x + cols.unit,   y + 4, { width: cols.total - 4, lineBreak: false, align: "right" });
  doc.fillColor(C_TEXT);
  return y + 18;
}

/** Draw one item row. Returns new y. */
function tableRow(doc: InstanceType<typeof PDFDocument>, y: number,
  desc: string, cat: string, qty: number, unit: number, rowIdx: number): number {
  const cols = { desc: 200, cat: 110, qty: 50, unit: 70, total: 69 };
  const total = qty * unit;
  if (rowIdx % 2 === 1) doc.rect(MARGIN, y, COL, 14).fill(C_FILL);
  doc.fillColor(C_TEXT).font("Helvetica").fontSize(8);
  let x = MARGIN + 4;
  doc.text(desc || "—",      x,         y + 3, { width: cols.desc - 8, lineBreak: false });
  doc.text(cat  || "—",      x += cols.desc,  y + 3, { width: cols.cat  - 4, lineBreak: false });
  doc.text(String(qty),      x += cols.cat,   y + 3, { width: cols.qty  - 4, lineBreak: false, align: "right" });
  doc.text(unit.toFixed(2),  x += cols.qty,   y + 3, { width: cols.unit - 4, lineBreak: false, align: "right" });
  doc.text(total.toFixed(2), x + cols.unit,   y + 3, { width: cols.total - 4, lineBreak: false, align: "right" });
  return y + 14;
}

/** Footer with signature lines. */
function drawFooter(doc: InstanceType<typeof PDFDocument>): void {
  const footerY = A4_H - MARGIN - 55;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY)
    .lineWidth(0.5).strokeColor(C_BORDER).stroke();

  const sigY = footerY + 10;
  const sigW = COL / 3 - 8;
  const labels = ["Prepared by", "Approved by", "Received by"];
  labels.forEach((lbl, i) => {
    const sx = MARGIN + i * (sigW + 12);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED)
      .text(lbl + ":", sx, sigY, { width: sigW, lineBreak: false });
    doc.moveTo(sx, sigY + 22).lineTo(sx + sigW - 4, sigY + 22)
      .lineWidth(0.5).strokeColor(C_MUTED).stroke();
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text("Signature / Date", sx, sigY + 25, { width: sigW, lineBreak: false });
  });

  const pgY = A4_H - MARGIN - 14;
  doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
    .text(`Page 1  ·  ${new Date().toLocaleDateString("en-GB", { timeZone: TZ })}`, MARGIN, pgY, { width: COL, align: "center", lineBreak: false });
}

async function buildRequisitionBuffer(
  doc: InstanceType<typeof PDFDocument>,
  reqData: any,
  org: any,
  logoData: Buffer | null,
  blank: boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const B = (v: string) => blank ? "______________________" : (v || "—");
    const items: any[] = Array.isArray(reqData?.items) && !blank ? reqData.items : [];
    const showItems = items.length > 0;

    let y = drawLetterhead(doc, org, logoData, "REQUISITION FORM");

    // ── Meta rows ──────────────────────────────────────────────
    y = twoCol(doc, y,
      "Requisition No:", B(reqData?.requisitionNumber),
      "Date Raised:", blank ? "______________________" : fmtDate(reqData?.raisedDate || reqData?.createdAt));
    y = twoCol(doc, y,
      "Needed By:", blank ? "______________________" : fmtDate(reqData?.neededByDate),
      "Payee:", B(reqData?.payee));
    y = twoCol(doc, y,
      "Requested By:", B(reqData?.requesterName),
      "Currency:", B(reqData?.currency));

    // Status pill (filled only)
    if (!blank && reqData?.status) {
      const sc = statusColor(reqData.status);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED)
        .text("Status:", MARGIN, y, { width: 84, lineBreak: false });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(sc)
        .text((reqData.status as string).toUpperCase(), MARGIN + 88, y, { lineBreak: false });
      y += 16;
    }

    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 8;

    // ── Items table ────────────────────────────────────────────
    y = tableHeader(doc, y);

    if (blank) {
      // Five blank rows for hand-filling
      for (let i = 0; i < 5; i++) {
        if (i % 2 === 1) doc.rect(MARGIN, y, COL, 14).fill(C_FILL);
        doc.moveTo(MARGIN + 4, y + 10).lineTo(MARGIN + 196, y + 10).lineWidth(0.3).strokeColor(C_MUTED).stroke();
        y += 14;
      }
    } else if (showItems) {
      items.forEach((it: any, idx: number) => {
        y = tableRow(doc, y, it.description, it.category, Number(it.qty) || 1, Number(it.unitPrice) || 0, idx);
      });
    } else {
      // Single-line description row
      y = tableRow(doc, y, reqData?.description || "—", reqData?.category || "—", 1, Number(reqData?.amount) || 0, 0);
    }

    // Total row
    const total = blank ? "______" : (() => {
      if (showItems) return items.reduce((s: number, it: any) => s + (Number(it.qty) || 1) * (Number(it.unitPrice) || 0), 0).toFixed(2);
      return Number(reqData?.amount || 0).toFixed(2);
    })();
    doc.rect(MARGIN, y, COL, 16).fill(C_FILL);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT)
      .text(`TOTAL: ${blank ? "" : (reqData?.currency || "USD") + " "}${total}`, MARGIN + 4, y + 4, { width: COL - 8, align: "right" });
    y += 20;

    // ── Notes ──────────────────────────────────────────────────
    y += 4;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text("Notes:", MARGIN, y);
    y += 12;
    if (blank || !reqData?.notes) {
      for (let i = 0; i < 3; i++) {
        doc.moveTo(MARGIN, y).lineTo(MARGIN + COL, y).lineWidth(0.3).strokeColor(C_MUTED).stroke();
        y += 14;
      }
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(reqData.notes, MARGIN, y, { width: COL });
      y = doc.y + 8;
    }

    // Approver notes (filled only)
    if (!blank && reqData?.approverNotes) {
      y += 4;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text("Approver notes:", MARGIN, y);
      y += 12;
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(reqData.approverNotes, MARGIN, y, { width: COL });
      y = doc.y + 8;
    }

    drawFooter(doc);
    doc.end();
  });
}

export async function generateRequisitionPdf(req: any, orgId: string): Promise<Buffer> {
  const org = await storage.getOrganization(orgId);
  const logoData = org?.logoUrl ? await resolveImage(org.logoUrl) : null;
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true,
    info: { Title: `Requisition ${req?.requisitionNumber || ""}`, Author: org?.name || "POL263" } });
  return buildRequisitionBuffer(doc, req, org || {}, logoData, false);
}

export async function generateBlankRequisitionPdf(org: any): Promise<Buffer> {
  const logoData = org?.logoUrl ? await resolveImage(org.logoUrl) : null;
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true,
    info: { Title: "Requisition Form (Blank)", Author: org?.name || "POL263" } });
  return buildRequisitionBuffer(doc, {}, org || {}, logoData, true);
}
