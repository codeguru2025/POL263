/**
 * Payment Voucher PDF — filled and blank variants.
 * Pattern mirrors receipt-pdf.ts: explicit y-coordinate tracking on A4.
 */

import PDFDocument from "pdfkit";
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

// ── Amount in words ──────────────────────────────────────────────────────────

const ONES  = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
               "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
               "Seventeen", "Eighteen", "Nineteen"];
const TENS  = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsUnder1000(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n]!;
  if (n < 100) return TENS[Math.floor(n / 10)]! + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)]! + " Hundred" + (n % 100 ? " and " + wordsUnder1000(n % 100) : "");
}

function integerInWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  if (n >= 1_000_000) {
    parts.push(wordsUnder1000(Math.floor(n / 1_000_000)) + " Million");
    n %= 1_000_000;
  }
  if (n >= 1_000) {
    parts.push(wordsUnder1000(Math.floor(n / 1_000)) + " Thousand");
    n %= 1_000;
  }
  if (n > 0) parts.push(wordsUnder1000(n));
  return parts.join(" ");
}

function amountInWords(amount: number, currency: string): string {
  const wholePart  = Math.floor(Math.abs(amount));
  const centsPart  = Math.round((Math.abs(amount) - wholePart) * 100);
  const currencyLabels: Record<string, { major: string; minor: string }> = {
    USD: { major: "US Dollars",        minor: "Cents" },
    ZAR: { major: "South African Rand", minor: "Cents" },
    ZIG: { major: "Zimbabwe Gold",     minor: "Cents" },
    GBP: { major: "British Pounds",    minor: "Pence" },
  };
  const lbl = currencyLabels[(currency || "USD").toUpperCase()] || { major: currency, minor: "Cents" };
  let words = integerInWords(wholePart) + " " + lbl.major;
  if (centsPart > 0) words += " and " + integerInWords(centsPart) + " " + lbl.minor;
  return words + " only";
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function drawLetterhead(doc: InstanceType<typeof PDFDocument>, org: any, logoData: Buffer | null, title: string): number {
  let y = MARGIN;
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "POL263", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone)   parts.push(org.phone);
  if (org.email)   parts.push(org.email);
  if (org.address) parts.push(org.address);
  parts.forEach(p => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 22;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 10;
  return y;
}

function twoCol(doc: InstanceType<typeof PDFDocument>, y: number,
  leftLabel: string, leftVal: string,
  rightLabel: string, rightVal: string): number {
  const colW  = (COL - 10) / 2;
  const labelW = 90;
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

function paymentMethodLabel(m: string): string {
  const map: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    mobile_money: "Mobile Money",
  };
  return map[(m || "").toLowerCase()] || m || "—";
}

async function buildVoucherBuffer(
  doc: InstanceType<typeof PDFDocument>,
  voucher: any,
  req: any | null,
  org: any,
  logoData: Buffer | null,
  blank: boolean,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end",  () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const B  = (v: string) => blank ? "______________________" : (v || "—");
    const BD = (d: string | Date | null | undefined) => blank ? "______________________" : fmtDate(d);

    let y = drawLetterhead(doc, org, logoData, "PAYMENT VOUCHER");

    // ── Meta block ──────────────────────────────────────────────
    y = twoCol(doc, y,
      "Voucher No:", B(voucher?.voucherNumber),
      "Date:",       BD(voucher?.paidDate));
    y = twoCol(doc, y,
      "Paid To:",    B(voucher?.receivedBy),
      "Payment Method:", blank ? B("") : paymentMethodLabel(voucher?.paymentMethod));
    y = twoCol(doc, y,
      "Linked Req:", blank ? B("") : (req?.requisitionNumber || "N/A"),
      "Reference:",  B(voucher?.reference));
    if (!blank && voucher?.paidByName) {
      y = twoCol(doc, y, "Processed By:", voucher.paidByName, "", "");
    }

    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 14;

    // ── Amount box ──────────────────────────────────────────────
    const boxH = 60;
    doc.rect(MARGIN, y, COL, boxH).lineWidth(1).strokeColor(C_PRIMARY).stroke();

    if (blank) {
      // Large blank line for handwriting the amount
      doc.moveTo(MARGIN + 20, y + boxH - 14).lineTo(MARGIN + COL - 20, y + boxH - 14)
        .lineWidth(0.5).strokeColor(C_MUTED).stroke();
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_MUTED)
        .text("AMOUNT:", MARGIN + 20, y + 10, { width: 60, lineBreak: false });
    } else {
      const amt = Number(voucher?.amount || 0);
      const cur = (voucher?.currency || "USD").toUpperCase();
      doc.font("Helvetica-Bold").fontSize(22).fillColor(C_PRIMARY)
        .text(`${cur} ${amt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
          MARGIN + 8, y + 12, { width: COL - 16, align: "center", lineBreak: false });
    }
    y += boxH + 8;

    // Amount in words
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED)
      .text("In words:", MARGIN, y, { width: 55, lineBreak: false });
    if (blank) {
      doc.moveTo(MARGIN + 60, y + 10).lineTo(MARGIN + COL, y + 10)
        .lineWidth(0.3).strokeColor(C_MUTED).stroke();
    } else {
      const words = amountInWords(Number(voucher?.amount || 0), voucher?.currency || "USD");
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(words, MARGIN + 60, y, { width: COL - 60, lineBreak: false });
    }
    y += 20;

    // Linked requisition description
    if (!blank && req?.description) {
      doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.3).strokeColor(C_BORDER).stroke();
      y += 8;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text("Description:", MARGIN, y);
      y += 12;
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(req.description, MARGIN, y, { width: COL });
      y = doc.y + 10;
    }

    // ── Notes ──────────────────────────────────────────────────
    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 8;
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text("Notes:", MARGIN, y);
    y += 12;
    if (blank || !voucher?.notes) {
      for (let i = 0; i < 3; i++) {
        doc.moveTo(MARGIN, y).lineTo(MARGIN + COL, y).lineWidth(0.3).strokeColor(C_MUTED).stroke();
        y += 14;
      }
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(voucher.notes, MARGIN, y, { width: COL });
      y = doc.y + 10;
    }

    // ── Signature + stamp ───────────────────────────────────────
    const sigTop = Math.max(y + 20, A4_H - MARGIN - 130);
    doc.moveTo(MARGIN, sigTop).lineTo(A4_W - MARGIN, sigTop)
      .lineWidth(0.5).strokeColor(C_BORDER).stroke();

    const sigY   = sigTop + 10;
    const threeW = COL / 3 - 8;

    // Three signature columns
    const sigLabels = ["Prepared by", "Authorised by", "Received by"];
    sigLabels.forEach((lbl, i) => {
      const sx = MARGIN + i * (threeW + 12);
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED)
        .text(lbl + ":", sx, sigY, { width: threeW, lineBreak: false });
      doc.moveTo(sx, sigY + 22).lineTo(sx + threeW - 4, sigY + 22)
        .lineWidth(0.5).strokeColor(C_MUTED).stroke();
      doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
        .text("Signature / Date", sx, sigY + 25, { width: threeW, lineBreak: false });
    });

    // Company stamp box (bottom-right)
    const stampY = sigY + 38;
    const stampX = MARGIN + 2 * (threeW + 12);
    const stampW = threeW;
    const stampH = 45;
    doc.rect(stampX, stampY, stampW, stampH)
      .dash(3, { space: 2 }).lineWidth(0.8).strokeColor(C_MUTED).stroke();
    doc.undash();
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text("COMPANY STAMP", stampX, stampY + stampH / 2 - 5, { width: stampW, align: "center", lineBreak: false });

    // Page footer
    const pgY = A4_H - MARGIN - 14;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`Page 1  ·  ${new Date().toLocaleDateString("en-GB", { timeZone: TZ })}`,
        MARGIN, pgY, { width: COL, align: "center", lineBreak: false });

    doc.end();
  });
}

export async function generatePaymentVoucherPdf(voucher: any, req: any | null, org: any): Promise<Buffer> {
  const logoData = org?.logoUrl ? await resolveImage(org.logoUrl) : null;
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true,
    info: { Title: `Payment Voucher ${voucher?.voucherNumber || ""}`, Author: org?.name || "POL263" } });
  return buildVoucherBuffer(doc, voucher, req, org || {}, logoData, false);
}

export async function generateBlankPaymentVoucherPdf(org: any): Promise<Buffer> {
  const logoData = org?.logoUrl ? await resolveImage(org.logoUrl) : null;
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true,
    info: { Title: "Payment Voucher (Blank)", Author: org?.name || "POL263" } });
  return buildVoucherBuffer(doc, {}, null, org || {}, logoData, true);
}
