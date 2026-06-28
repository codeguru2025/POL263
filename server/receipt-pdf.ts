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
import QRCode from "qrcode";
import { storage, findPaymentReceiptById } from "./storage";
import { resolveImage } from "./object-storage";
import * as objectStorage from "./object-storage";
import { structuredLog } from "./logger";
import { buildVerifyUrl, buildVerifyQrBuffer, drawCompanyStamp, drawVerifyQrPanel } from "./pdf-utils";

/** Exported for tests. */
export const RECEIPT_PDF_WIDTH_PT = 226; // 80mm in points (kept for tests)

// ── A4 constants ────────────────────────────────────────────
const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

// ── Thermal constants ────────────────────────────────────────
const MM_TO_PT = 2.83465;
const THERMAL_PAGE_H = 2000; // tall enough; thermal cutter trims the rest

export type ThermalSize = 48 | 58 | 80;

function thermalLayout(sizeMm: ThermalSize) {
  const W = Math.round(sizeMm * MM_TO_PT);
  // Narrower paper gets tighter margins so more content fits
  const M = sizeMm === 48 ? 5 : sizeMm === 58 ? 6 : 8;
  const INNER = W - M * 2;
  // Label column for the lft() helper
  const LABEL_W = sizeMm === 48 ? 38 : sizeMm === 58 ? 52 : 68;
  // Fonts — 48mm gets slightly larger text so it's legible on the narrow roll
  const F_BODY  = sizeMm === 48 ? 9   : sizeMm === 58 ? 8.5 : 8;
  const F_SM    = sizeMm === 48 ? 8   : sizeMm === 58 ? 7.5 : 7.5;
  const F_HEAD  = sizeMm === 48 ? 10  : sizeMm === 58 ? 9.5 : 9;
  const F_AMT   = sizeMm === 48 ? 13  : sizeMm === 58 ? 12  : 10;
  // Logo — proportionally larger on narrower paper so it stays visible
  const LOGO_SZ = sizeMm === 48 ? 56  : sizeMm === 58 ? 48  : 36;
  return { W, M, INNER, LABEL_W, F_BODY, F_SM, F_HEAD, F_AMT, LOGO_SZ };
}

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

/** Number of calendar months a receipt covers (e.g. "01 Jun 2026 – 30 Jun 2026" → 1). */
function monthsFromPeriod(from: string, to: string): number {
  const f = new Date(from + "T00:00:00");
  const t = new Date(to + "T00:00:00");
  return Math.max(1, (t.getFullYear() - f.getFullYear()) * 12 + (t.getMonth() - f.getMonth()) + 1);
}

async function loadReceiptContext(receipt: any, orgId: string) {
  const [policy, client, org, activeAdvert] = await Promise.all([
    storage.getPolicy(receipt.policyId, orgId),
    storage.getClient(receipt.clientId, orgId),
    storage.getOrganization(orgId),
    storage.getActiveReceiptAdvert(orgId),
  ]);
  let productName: string | null = null;
  if (policy?.productVersionId) {
    const pv = await storage.getProductVersion(policy.productVersionId, orgId);
    if (pv) {
      const prod = await storage.getProduct(pv.productId, orgId);
      if (prod) productName = prod.name;
    }
  }
  let issuedByName: string | null = null;
  if (receipt.issuedByUserId) {
    const u = await storage.getUser(receipt.issuedByUserId);
    if (u) issuedByName = u.displayName || u.email || null;
  }
  let advertImageData: Buffer | null = null;
  if (activeAdvert?.imageUrl) {
    advertImageData = await resolveImage(activeAdvert.imageUrl);
  }
  return { policy, client, org, productName, issuedByName, activeAdvert, advertImageData };
}

/** Build a document-verification QR for the receipt (B&W, larger, more scannable). */
async function buildReceiptVerifyQr(receiptId: string): Promise<Buffer | null> {
  const url = buildVerifyUrl("receipt", receiptId);
  if (!url) return null;
  return buildVerifyQrBuffer(url, 180);
}

/**
 * Render the advert + verification QR + company stamp panel.
 *
 * Layout (left→right within the panel):
 *   [advert image + text]   [company stamp]   [verification QR]
 *
 * Height is bounded so content never bleeds into the footer zone.
 * footerTop is the absolute y where the footer divider line sits.
 */
function drawAdvertAndQr(
  doc: InstanceType<typeof PDFDocument>,
  y: number,
  activeAdvert: { title: string | null; body: string | null } | null | undefined,
  advertImageData: Buffer | null,
  qrBuffer: Buffer | null,
  footerTop: number,
  orgName: string,
): void {
  const PANEL_MIN = 120; // minimum pt needed for a useful panel
  const hasAdvert = !!(activeAdvert && (activeAdvert.title || activeAdvert.body || advertImageData));
  if (!hasAdvert && !qrBuffer) return;
  if (y + PANEL_MIN > footerTop) return; // not enough room — skip entirely

  // ── divider ──────────────────────────────────────────────────
  const ay = y + 10;
  doc.moveTo(MARGIN, ay).lineTo(A4_W - MARGIN, ay).lineWidth(0.4).strokeColor(C_BORDER).stroke();

  const panelTop  = ay + 10;
  const panelBot  = footerTop - 8;       // usable bottom edge
  const panelH    = panelBot - panelTop; // available height

  const QR_SIZE   = Math.min(90, panelH - 20); // QR never taller than available space
  const STAMP_R   = 32;                  // stamp radius
  const STAMP_D   = STAMP_R * 2;

  const qrX    = A4_W - MARGIN - QR_SIZE;
  const stampCx = qrX - STAMP_D - 12 + STAMP_R; // stamp sits left of QR
  const stampCy = panelTop + panelH / 2;

  const advW = stampCx - STAMP_R - 14 - MARGIN; // advert left column width

  // ── verification QR (right) ───────────────────────────────────
  if (qrBuffer && QR_SIZE >= 50) {
    drawVerifyQrPanel(doc, qrBuffer, qrX, panelTop, QR_SIZE);
  }

  // ── company stamp (centre-right) ─────────────────────────────
  if (panelH >= STAMP_D + 10) {
    drawCompanyStamp(doc, orgName, stampCx, stampCy, STAMP_R);
  }

  // ── advert content (left column) ─────────────────────────────
  // Strictly clip content to panelBot so it never touches the footer.
  let ly = panelTop;

  if (advertImageData) {
    const imgMaxH = Math.min(55, panelH - 30);
    if (ly + imgMaxH <= panelBot) {
      try {
        const imgW = Math.min(advW, 180);
        doc.image(advertImageData, MARGIN, ly, { width: imgW, height: imgMaxH, fit: [imgW, imgMaxH] });
        ly += imgMaxH + 5;
      } catch { /* skip */ }
    }
  }

  if (activeAdvert?.title) {
    const titleH = 14;
    if (ly + titleH <= panelBot) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_PRIMARY)
        .text(activeAdvert.title, MARGIN, ly, { width: advW, lineBreak: false });
      ly += titleH + 2;
    }
  }

  if (activeAdvert?.body && ly + 12 <= panelBot) {
    // Calculate how many pt are left and clip the body text to fit
    const bodyH = panelBot - ly - 2;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT)
      .text(activeAdvert.body, MARGIN, ly, { width: advW, height: bodyH, ellipsis: true });
  }
}

export async function generateReceiptPdf(receiptId: string): Promise<string | null> {
  const receipt = await findPaymentReceiptById(receiptId);
  if (!receipt) return null;
  const orgId = receipt.organizationId;
  const { policy, client, org, productName, issuedByName, activeAdvert, advertImageData } = await loadReceiptContext(receipt, orgId);
  if (!policy || !client || !org) return null;
  const qrBuffer = await buildReceiptVerifyQr(receipt.id);

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
    if (productName) row("Product", productName);
    row("Payment Schedule", (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() + (policy.paymentSchedule || "monthly").slice(1));
    row("Policy Status", policy.status.toUpperCase());
    y += 6;

    // ── Payment Details ─────────────────────────────────────────
    sectionHeader("Payment Details");
    row("Amount", `${receipt.currency} ${Number(receipt.amount).toFixed(2)}`);
    row("Channel", String(receipt.paymentChannel || "—").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const meta = receipt.metadataJson as Record<string, string> | null;
    if (receipt.periodFrom && receipt.periodTo) {
      const pfmt = (s: string) => fmtDate(new Date(s + "T00:00:00"));
      const months = monthsFromPeriod(receipt.periodFrom, receipt.periodTo);
      row("Cover Period", `${pfmt(receipt.periodFrom)} – ${pfmt(receipt.periodTo)}`);
      row("Months Paid", `${months} ${months === 1 ? "month" : "months"}`);
    }
    if (meta?.paynowReference) row("Paynow Reference", meta.paynowReference);
    if (meta?.mobileNumber) row("Mobile Number", meta.mobileNumber);
    if (issuedByName) row("Issued By", issuedByName);
    row("Date & Time", fmtDateTime(new Date(receipt.issuedAt)));
    row("Receipt Number", displayReceiptNum);
    y += 6;

    // ── Advert + QR ─────────────────────────────────────────────
    drawAdvertAndQr(doc, y, activeAdvert, advertImageData, qrBuffer, A4_H - MARGIN - 55, org.name || "POL263");

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
  const { policy, client, org, productName, issuedByName, activeAdvert, advertImageData } = await loadReceiptContext(receipt, orgId);
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
  const qrBuffer = await buildReceiptVerifyQr(receipt.id);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  try {
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
    if (productName) row("Product", productName);
    row("Payment Schedule", (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() + (policy.paymentSchedule || "monthly").slice(1));
    row("Policy Status", policy.status.toUpperCase());
    y += 6;

    sectionHeader("Payment Details");
    row("Amount", `${receipt.currency} ${Number(receipt.amount).toFixed(2)}`);
    row("Channel", String(receipt.paymentChannel || "—").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()));
    const meta = receipt.metadataJson as Record<string, string> | null;
    if (receipt.periodFrom && receipt.periodTo) {
      const pfmt2 = (s: string) => fmtDate(new Date(s + "T00:00:00"));
      const months2 = monthsFromPeriod(receipt.periodFrom, receipt.periodTo);
      row("Cover Period", `${pfmt2(receipt.periodFrom)} – ${pfmt2(receipt.periodTo)}`);
      row("Months Paid", `${months2} ${months2 === 1 ? "month" : "months"}`);
    }
    if (meta?.paynowReference) row("Paynow Reference", meta.paynowReference);
    if (meta?.mobileNumber) row("Mobile Number", meta.mobileNumber);
    if (issuedByName) row("Issued By", issuedByName);
    row("Date & Time", fmtDateTime(new Date(receipt.issuedAt)));
    row("Receipt Number", displayReceiptNum);
    y += 6;

    // ── Advert + QR ─────────────────────────────────────────────
    drawAdvertAndQr(doc, y, activeAdvert, advertImageData, qrBuffer, A4_H - MARGIN - 55, org.name || "POL263");

    const footerY = A4_H - MARGIN - 28;
    doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY)
      .text(org.footerText || "Thank you for your payment.", MARGIN, footerY + 6, { width: COL, align: "center" });
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`Generated by ${org.name || "POL263"} · ${fmtDateTime(new Date())}`, MARGIN, footerY + 18, { width: COL, align: "center" });

    doc.end();
  } catch (err: any) {
    structuredLog("error", "A4 receipt PDF generation failed", { receiptId, error: err?.message });
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}

/**
 * Stream a thermal receipt PDF for 48mm, 58mm, or 80mm roll printers.
 *
 * Uses PDFKit's natural text flow (no explicit y coordinates) so that
 * wrapped lines on the narrow column never overlap. The page is 2000pt tall;
 * thermal cutters trim at the last line of content.
 *
 * Font and logo sizes scale up for narrower paper so the receipt stays legible.
 */
export async function streamThermalReceiptToResponse(
  receiptId: string,
  orgId: string,
  res: import("express").Response,
  opts?: { attachment?: boolean; size?: ThermalSize }
): Promise<void> {
  const receipt = await findPaymentReceiptById(receiptId);
  if (!receipt || receipt.organizationId !== orgId) {
    res.status(404).json({ message: "Receipt not found" });
    return;
  }
  const { policy, client, org, productName, issuedByName, activeAdvert, advertImageData } = await loadReceiptContext(receipt, orgId);
  if (!policy || !client || !org) {
    res.status(404).json({ message: "Receipt data incomplete" });
    return;
  }

  const displayReceiptNum = /^\d+$/.test(String(receipt.receiptNumber).trim())
    ? `RCP-${String(receipt.receiptNumber).padStart(5, "0")}`
    : receipt.receiptNumber;

  const sizeMm: ThermalSize = opts?.size ?? 80;
  const { W, M, INNER, LABEL_W, F_BODY, F_SM, F_HEAD, F_AMT, LOGO_SZ } = thermalLayout(sizeMm);

  const filename = `Thermal-${sizeMm}mm-${displayReceiptNum}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", opts?.attachment
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`);

  const logoData = await resolveImage(org.logoUrl);
  const qrBuffer = await buildReceiptVerifyQr(receipt.id);

  const doc = new PDFDocument({
    size: [W, THERMAL_PAGE_H],
    margin: M,
    bufferPages: false,
    info: { Title: `Receipt ${displayReceiptNum}` },
  });
  doc.pipe(res);

  try {
    doc.x = M;
    doc.y = M;

    const ctr = (text: string, bold = false, size = F_BODY) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size)
        .text(text, M, doc.y, { width: INNER, align: "center" });
    };
    const lft = (label: string, value: string) => {
      const lineY = doc.y;
      doc.font("Helvetica-Bold").fontSize(F_SM)
        .text(label, M, lineY, { width: LABEL_W, lineBreak: false });
      doc.font("Helvetica").fontSize(F_SM)
        .text(value, M + LABEL_W + 2, lineY, { width: INNER - LABEL_W - 2 });
    };
    const rule = () => {
      const rY = doc.y + 3;
      doc.moveTo(M, rY).lineTo(W - M, rY).lineWidth(0.5).strokeColor("#888").stroke();
      doc.y = rY + 5;
    };
    const gap = (n = 4) => { doc.y += n; };

    // ── Logo ──────────────────────────────────────────────────
    if (logoData) {
      try {
        const logoX = Math.round((W - LOGO_SZ) / 2);
        doc.image(logoData, logoX, doc.y, { width: LOGO_SZ, height: LOGO_SZ, fit: [LOGO_SZ, LOGO_SZ] });
        doc.y += LOGO_SZ + 4;
      } catch { /* skip */ }
    }

    // ── Header ────────────────────────────────────────────────
    ctr(org.name || "POL263", true, F_HEAD);
    if (org.address) ctr(org.address, false, F_SM);
    if (org.phone) ctr(`Tel: ${org.phone}`, false, F_SM);
    if (org.email) ctr(org.email, false, F_SM);
    gap(3);
    rule();

    ctr("PAYMENT RECEIPT", true, F_HEAD);
    gap(2);
    ctr(displayReceiptNum, true, F_BODY);
    gap(1);
    ctr(fmtDateTime(new Date(receipt.issuedAt)), false, F_SM);
    gap(2);
    rule();

    // ── Client & policy ───────────────────────────────────────
    lft("Client:", `${client.firstName} ${client.lastName}`);
    if (client.phone) lft("Phone:", client.phone);
    if (client.nationalId) lft("ID:", client.nationalId);
    lft("Policy:", policy.policyNumber);
    if (productName) lft("Product:", productName);
    lft("Schedule:", (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() + (policy.paymentSchedule || "monthly").slice(1));
    gap(3);
    rule();

    // ── Amount (big and bold) ─────────────────────────────────
    gap(2);
    doc.font("Helvetica-Bold").fontSize(F_AMT).fillColor(C_PRIMARY)
      .text(`${receipt.currency} ${Number(receipt.amount).toFixed(2)}`, M, doc.y, { width: INNER, align: "center" });
    doc.fillColor(C_TEXT);
    gap(3);
    const channel = String(receipt.paymentChannel || "").replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    ctr(channel, false, F_BODY);

    const meta = receipt.metadataJson as Record<string, string> | null;
    if (receipt.periodFrom && receipt.periodTo) {
      const pfmtT = (s: string) => fmtDate(new Date(s + "T00:00:00"));
      const monthsT = monthsFromPeriod(receipt.periodFrom, receipt.periodTo);
      gap(2);
      lft("Period:", `${pfmtT(receipt.periodFrom)} –`);
      lft("", `${pfmtT(receipt.periodTo)}`);
      gap(1);
      lft("Months paid:", `${monthsT} ${monthsT === 1 ? "month" : "months"}`);
    }
    if (meta?.paynowReference) { gap(1); lft("Ref:", meta.paynowReference); }
    if (meta?.mobileNumber) { gap(1); lft("Mobile:", meta.mobileNumber); }
    if (issuedByName) { gap(1); lft("Issued by:", issuedByName); }
    gap(3);
    rule();

    // ── Footer ────────────────────────────────────────────────
    ctr(org.footerText || "Thank you for your payment.", true, F_BODY);
    gap(3);
    ctr(`Printed: ${fmtDateTime(new Date())}`, false, F_SM);
    gap(4);

    // ── Advert + QR (thermal) ─────────────────────────────────
    const hasAdvert = !!(activeAdvert && (activeAdvert.title || activeAdvert.body || advertImageData));
    if (hasAdvert || qrBuffer) {
      rule();
      gap(4);

      // Full-width advert image — fills the 80mm column for max visibility
      if (advertImageData) {
        try {
          const imgH = Math.round(INNER * 0.55); // aspect-ratio-aware tall crop
          doc.image(advertImageData, M, doc.y, { width: INNER, height: imgH, fit: [INNER, imgH] });
          doc.y += imgH + 6;
        } catch { /* skip */ }
      }

      if (activeAdvert?.title) {
        doc.font("Helvetica-Bold").fontSize(F_HEAD).fillColor(C_PRIMARY)
          .text(activeAdvert.title, M, doc.y, { width: INNER, align: "center" });
        doc.fillColor(C_TEXT);
        gap(3);
      }
      if (activeAdvert?.body) {
        doc.font("Helvetica").fontSize(F_SM).fillColor(C_TEXT)
          .text(activeAdvert.body, M, doc.y, { width: INNER, align: "center" });
        gap(4);
      }

      // QR code — wide enough to scan comfortably on 80mm paper
      if (qrBuffer) {
        const QR_SZ = Math.round(INNER * 0.62); // ~130pt on 80mm
        try {
          const qrX = M + Math.round((INNER - QR_SZ) / 2);
          doc.image(qrBuffer, qrX, doc.y, { width: QR_SZ, height: QR_SZ });
          doc.y += QR_SZ + 4;
          doc.font("Helvetica-Bold").fontSize(F_BODY).fillColor(C_PRIMARY)
            .text("SCAN TO VERIFY", M, doc.y, { width: INNER, align: "center" });
          doc.fillColor(C_TEXT);
          gap(2);
          doc.font("Helvetica").fontSize(F_SM).fillColor(C_MUTED)
            .text("Verify document authenticity", M, doc.y, { width: INNER, align: "center" });
          gap(4);
        } catch { /* skip */ }
      }

      rule();
    }

    gap(10);
    doc.end();
  } catch (err: any) {
    structuredLog("error", "Thermal receipt PDF generation failed", { receiptId, sizeMm, error: err?.message });
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
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
