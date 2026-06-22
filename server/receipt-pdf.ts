/**
 * Receipt PDF generation — two formats:
 *
 *   A4   (default) — branded, full-page, screen-friendly. Uses explicit y
 *        coordinates with doc.y tracking so wrapped lines never collide.
 *   80mm (thermal) — narrow roll format for thermal POS printers. Uses
 *        PDFKit's natural flow (no explicit y) which is the only safe way
 *        to avoid overlap on a 227pt-wide column where almost every line wraps.
 */

import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { storage, findPaymentReceiptById } from "./storage";
import { resolveImage } from "./object-storage";
import * as objectStorage from "./object-storage";

/** Exported for tests. */
export const RECEIPT_PDF_WIDTH_PT = 226; // 80mm in points (kept for tests)

// ── A4 constants ────────────────────────────────────────────
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

// ── 80mm thermal constants ──────────────────────────────────
const MM_TO_PT = 2.83465;
const THERMAL_W_MM = 80;
const THERMAL_W = Math.round(THERMAL_W_MM * MM_TO_PT); // ≈ 227pt
const THERMAL_M = 8;   // side margin
const THERMAL_INNER = THERMAL_W - THERMAL_M * 2;
const THERMAL_PAGE_H = 2000; // tall enough; thermal cutter trims the rest

// ── Shared colours ──────────────────────────────────────────
const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#e5e7eb";

const TZ = "Africa/Harare"; // SAST UTC+2

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: TZ });
}
function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}
function fmtDateTime(d: Date): string {
  return `${fmtDate(d)} at ${fmtTime(d)}`;
}

export async function generateReceiptPdf(receiptId: string): Promise<string | null> {
  const receipt = await findPaymentReceiptById(receiptId);
  if (!receipt) return null;
  const orgId = receipt.organizationId;
  const policy = await storage.getPolicy(receipt.policyId, orgId);
  const client = await storage.getClient(receipt.clientId, orgId);
  const org = await storage.getOrganization(orgId);
  if (!policy || !client || !org) return null;

  const displayReceiptNum = /^\d+$/.test(String(receipt.receiptNumber).trim())
    ? `RCP-${String(receipt.receiptNumber).padStart(5, "0")}`
    : receipt.receiptNumber;

  const filename = `RCP-${displayReceiptNum.replace(/[^a-zA-Z0-9-]/g, "-")}-${receiptId.slice(0, 8)}.pdf`;
  const logoData = await resolveImage(org.logoUrl);

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Receipt ${displayReceiptNum}`, Author: org.name || "POL263" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));

    // ── Branded header ──────────────────────────────────────────
    let y = MARGIN;
    if (logoData) {
      try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
      .text(org.name || "POL263", MARGIN + 130, y, { width: COL - 130, align: "right" });
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
    const contactParts: string[] = [];
    if (org.phone) contactParts.push(org.phone);
    if (org.email) contactParts.push(org.email);
    if (org.address) contactParts.push(org.address);
    if (org.website) contactParts.push(org.website);
    contactParts.forEach((part) => {
      doc.text(part, MARGIN + 130, y, { width: COL - 130, align: "right" });
      y += 11;
    });
    y = Math.max(y, MARGIN + 56) + 12;
    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 8;

    // ── Title ───────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(17).fillColor(C_TEXT)
      .text("PAYMENT RECEIPT", MARGIN, y, { width: COL, align: "center" });
    y += 22;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT)
      .text(displayReceiptNum, MARGIN, y, { width: COL, align: "center" });
    y += 14;
    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text(`Issued: ${fmtDateTime(new Date(receipt.issuedAt))}`, MARGIN, y, { width: COL, align: "center" });
    y += 20;

    // ── Section helper ──────────────────────────────────────────
    const sectionHeader = (title: string) => {
      doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
      doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
        .text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
      y += 22;
      doc.fillColor(C_TEXT);
    };

    const row = (label: string, value: string) => {
      const lw = 140;
      const vw = COL - lw - 8;
      const startY = y;
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
        .text(label, MARGIN, startY, { width: lw, lineBreak: false });
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(value, MARGIN + lw + 8, startY, { width: vw });
      y = doc.y + 2;
      if (y - startY < 14) y = startY + 14;
    };

    // ── Client & Policy ─────────────────────────────────────────
    sectionHeader("Client & Policy");
    row("Client Name", `${client.firstName} ${client.lastName}`);
    if (client.phone) row("Phone", client.phone);
    if (client.nationalId) row("National ID", client.nationalId);
    row("Policy Number", policy.policyNumber);
    row("Policy Status", policy.status.toUpperCase());
    y += 6;

    // ── Payment Details ─────────────────────────────────────────
    sectionHeader("Payment Details");
    row("Amount", `${receipt.currency} ${Number(receipt.amount).toFixed(2)}`);
    row("Channel", String(receipt.paymentChannel || "—").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const meta = receipt.metadataJson as Record<string, string> | null;
    if (receipt.periodFrom && receipt.periodTo) {
      const pfmt = (s: string) => fmtDate(new Date(s + "T00:00:00"));
      row("Cover Period", `${pfmt(receipt.periodFrom)} – ${pfmt(receipt.periodTo)}`);
    }
    if (meta?.paynowReference) row("Paynow Reference", meta.paynowReference);
    if (meta?.mobileNumber) row("Mobile Number", meta.mobileNumber);
    row("Date & Time", fmtDateTime(new Date(receipt.issuedAt)));
    row("Receipt Number", displayReceiptNum);
    y += 6;

    // ── Footer ──────────────────────────────────────────────────
    const footerY = A4_H - MARGIN - 28;
    doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    const footerText = org.footerText || "Thank you for your payment.";
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY)
      .text(footerText, MARGIN, footerY + 6, { width: COL, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`Generated by ${org.name || "POL263"} · ${fmtDateTime(new Date())}`, MARGIN, footerY + 18, { width: COL, align: "center" });

    doc.end();
    doc.on("end", async () => {
      try {
        const pdfBuffer = Buffer.concat(chunks);
        const { key } = await objectStorage.uploadFile(pdfBuffer, filename, "application/pdf", "receipts");
        resolve(key);
      } catch {
        resolve(null);
      }
    });
    doc.on("error", () => resolve(null));
  });
}

/**
 * Stream receipt PDF directly to an HTTP response (no file storage).
 * Used for the inline view endpoint.
 */
export async function streamReceiptToResponse(
  receiptId: string,
  orgId: string,
  res: import("express").Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const receipt = await findPaymentReceiptById(receiptId);
  if (!receipt || receipt.organizationId !== orgId) {
    res.status(404).json({ message: "Receipt not found" });
    return;
  }
  const policy = await storage.getPolicy(receipt.policyId, orgId);
  const client = await storage.getClient(receipt.clientId, orgId);
  const org = await storage.getOrganization(orgId);
  if (!policy || !client || !org) {
    res.status(404).json({ message: "Receipt data incomplete" });
    return;
  }

  const displayReceiptNum = /^\d+$/.test(String(receipt.receiptNumber).trim())
    ? `RCP-${String(receipt.receiptNumber).padStart(5, "0")}`
    : receipt.receiptNumber;

  const filename = `Receipt-${displayReceiptNum}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", opts?.attachment
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`);

  const logoData = await resolveImage(org.logoUrl);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = MARGIN;
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "POL263", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const contactParts: string[] = [];
  if (org.phone) contactParts.push(org.phone);
  if (org.email) contactParts.push(org.email);
  if (org.address) contactParts.push(org.address);
  if (org.website) contactParts.push(org.website);
  contactParts.forEach((part) => {
    doc.text(part, MARGIN + 130, y, { width: COL - 130, align: "right" });
    y += 11;
  });
  y = Math.max(y, MARGIN + 56) + 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;

  doc.font("Helvetica-Bold").fontSize(17).fillColor(C_TEXT)
    .text("PAYMENT RECEIPT", MARGIN, y, { width: COL, align: "center" });
  y += 22;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT)
    .text(displayReceiptNum, MARGIN, y, { width: COL, align: "center" });
  y += 14;
  doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
    .text(`Issued: ${fmtDateTime(new Date(receipt.issuedAt))}`, MARGIN, y, { width: COL, align: "center" });
  y += 20;

  const sectionHeader = (title: string) => {
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
    y += 22;
  };
  const row = (label: string, value: string) => {
    const lw = 140; const vw = COL - lw - 8;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN, startY, { width: lw, lineBreak: false });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, startY, { width: vw });
    y = doc.y + 2;
    if (y - startY < 14) y = startY + 14;
  };

  sectionHeader("Client & Policy");
  row("Client Name", `${client.firstName} ${client.lastName}`);
  if (client.phone) row("Phone", client.phone);
  if (client.nationalId) row("National ID", client.nationalId);
  row("Policy Number", policy.policyNumber);
  row("Policy Status", policy.status.toUpperCase());
  y += 6;

  sectionHeader("Payment Details");
  row("Amount", `${receipt.currency} ${Number(receipt.amount).toFixed(2)}`);
  row("Channel", String(receipt.paymentChannel || "—").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
  const meta = receipt.metadataJson as Record<string, string> | null;
  if (receipt.periodFrom && receipt.periodTo) {
    const pfmt2 = (s: string) => fmtDate(new Date(s + "T00:00:00"));
    row("Cover Period", `${pfmt2(receipt.periodFrom)} – ${pfmt2(receipt.periodTo)}`);
  }
  if (meta?.paynowReference) row("Paynow Reference", meta.paynowReference);
  if (meta?.mobileNumber) row("Mobile Number", meta.mobileNumber);
  row("Date & Time", fmtDateTime(new Date(receipt.issuedAt)));
  row("Receipt Number", displayReceiptNum);
  y += 6;

  const footerY = A4_H - MARGIN - 28;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY)
    .text(org.footerText || "Thank you for your payment.", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
    .text(`Generated by ${org.name || "POL263"} · ${fmtDateTime(new Date())}`, MARGIN, footerY + 18, { width: COL, align: "center" });

  doc.end();
}

/**
 * Stream an 80mm thermal receipt PDF.
 *
 * Uses PDFKit's natural text flow (no explicit y coordinates) so that
 * wrapped lines on the narrow column never overlap. The page is 2000pt tall;
 * thermal cutters trim at the last line of content.
 */
export async function streamThermalReceiptToResponse(
  receiptId: string,
  orgId: string,
  res: import("express").Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const receipt = await findPaymentReceiptById(receiptId);
  if (!receipt || receipt.organizationId !== orgId) {
    res.status(404).json({ message: "Receipt not found" });
    return;
  }
  const policy = await storage.getPolicy(receipt.policyId, orgId);
  const client = await storage.getClient(receipt.clientId, orgId);
  const org = await storage.getOrganization(orgId);
  if (!policy || !client || !org) {
    res.status(404).json({ message: "Receipt data incomplete" });
    return;
  }

  const displayReceiptNum = /^\d+$/.test(String(receipt.receiptNumber).trim())
    ? `RCP-${String(receipt.receiptNumber).padStart(5, "0")}`
    : receipt.receiptNumber;

  const filename = `Thermal-${displayReceiptNum}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", opts?.attachment
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`);

  const logoData = await resolveImage(org.logoUrl);

  // Use tall page; thermal cutter ignores blank space at the bottom
  const doc = new PDFDocument({
    size: [THERMAL_W, THERMAL_PAGE_H],
    margin: THERMAL_M,
    bufferPages: false,
    info: { Title: `Receipt ${displayReceiptNum}` },
  });
  doc.pipe(res);

  // Use PDFKit natural flow — no explicit x/y after the initial margin setup.
  // This is critical: on a 211pt inner column, most text wraps; explicit y
  // coordinates would cause the cursor to fall behind and lines to stack.
  doc.x = THERMAL_M;
  doc.y = THERMAL_M;

  const ctr = (text: string, opts2?: { bold?: boolean; size?: number }) => {
    if (opts2?.bold) doc.font("Helvetica-Bold"); else doc.font("Helvetica");
    if (opts2?.size) doc.fontSize(opts2.size); else doc.fontSize(8);
    doc.text(text, THERMAL_M, doc.y, { width: THERMAL_INNER, align: "center" });
  };
  const lft = (label: string, value: string) => {
    doc.font("Helvetica-Bold").fontSize(7.5)
      .text(label, THERMAL_M, doc.y, { width: 68, lineBreak: false });
    doc.font("Helvetica").fontSize(7.5)
      .text(value, THERMAL_M + 70, doc.y - doc.currentLineHeight(), { width: THERMAL_INNER - 70 });
  };
  const rule = () => {
    const rY = doc.y + 2;
    doc.moveTo(THERMAL_M, rY).lineTo(THERMAL_W - THERMAL_M, rY).lineWidth(0.5).strokeColor("#999").stroke();
    doc.y = rY + 4;
  };
  const gap = (n = 4) => { doc.y += n; };

  // ── Logo ──────────────────────────────────────────────────
  if (logoData) {
    try {
      const logoSize = 36;
      const logoX = Math.round((THERMAL_W - logoSize) / 2);
      doc.image(logoData, logoX, doc.y, { width: logoSize, height: logoSize });
      doc.y += logoSize + 3;
    } catch { /* skip */ }
  }

  // ── Header ────────────────────────────────────────────────
  ctr(org.name || "POL263", { bold: true, size: 9 });
  if (org.address) ctr(org.address);
  if (org.phone) ctr(`Tel: ${org.phone}`);
  if (org.email) ctr(org.email);
  gap();
  rule();
  ctr("PAYMENT RECEIPT", { bold: true, size: 9 });
  ctr(displayReceiptNum, { bold: true });
  ctr(fmtDateTime(new Date(receipt.issuedAt)));
  rule();

  // ── Client & policy ───────────────────────────────────────
  lft("Client:", `${client.firstName} ${client.lastName}`);
  if (client.phone) lft("Phone:", client.phone);
  if (client.nationalId) lft("ID:", client.nationalId);
  lft("Policy:", policy.policyNumber);
  gap(2);
  rule();

  // ── Payment ───────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(10).fillColor(C_PRIMARY)
    .text(`${receipt.currency} ${Number(receipt.amount).toFixed(2)}`, THERMAL_M, doc.y, { width: THERMAL_INNER, align: "center" });
  doc.fillColor(C_TEXT);
  const channel = String(receipt.paymentChannel || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  ctr(channel);
  const meta = receipt.metadataJson as Record<string, string> | null;
  if (receipt.periodFrom && receipt.periodTo) {
    const pfmtT = (s: string) => fmtDate(new Date(s + "T00:00:00"));
    lft("Period:", `${pfmtT(receipt.periodFrom)} – ${pfmtT(receipt.periodTo)}`);
  }
  if (meta?.paynowReference) lft("Ref:", meta.paynowReference);
  if (meta?.mobileNumber) lft("Mobile:", meta.mobileNumber);
  rule();

  // ── Footer ────────────────────────────────────────────────
  ctr(org.footerText || "Thank you for your payment.", { bold: true });
  gap(2);
  ctr(`Printed: ${fmtDateTime(new Date())}`, { size: 7 });
  gap(8);

  doc.end();
}

/**
 * Resolve receipt PDF for download. Returns either a local file path (string)
 * or an object-storage Buffer, or null if not found.
 */
export async function getReceiptPdfPath(pdfStorageKey: string | null): Promise<string | Buffer | null> {
  if (!pdfStorageKey) return null;
  if (objectStorage.isObjectStorageEnabled) {
    const buf = await objectStorage.fetchFile(pdfStorageKey);
    if (buf) return buf;
  }
  const normalized = path.normalize(pdfStorageKey).replace(/^(\.\.(\/|\\))+/g, "");
  const full = path.resolve(process.cwd(), "uploads", normalized);
  return fs.existsSync(full) ? full : null;
}
