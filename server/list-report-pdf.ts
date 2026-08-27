/**
 * Generic "list report → landscape A4 PDF on company letterhead" renderer. The reports CSV
 * export handler (server/routes.ts) already builds every report down to a `headers: string[]`
 * plus `rows: (string|number)[][]` plus an optional per-currency totals block; this turns that
 * same data into a branded, paginated PDF so every register — not just the financial statements —
 * has a print/board/regulator-ready output.
 *
 * Wide reports (the 45-column Easipol-format policy exports) are refused with a clear message —
 * a PDF of 45 columns on one page is unreadable and CSV is the right tool there.
 */
import PDFDocument from "pdfkit";
import type { Response } from "express";
import { resolveImage } from "./object-storage";

const A4_LANDSCAPE_W = 841.89;
const A4_LANDSCAPE_H = 595.28;
const M = 36;
const COL = A4_LANDSCAPE_W - M * 2;
const C_PRIMARY = "#0f766e";
const C_ACCENT = "#134e4a";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_ROW_ALT = "#f9fafb";

/** Max columns that still read on a landscape A4 page. */
export const LIST_PDF_MAX_COLUMNS = 16;

function fitText(doc: InstanceType<typeof PDFDocument>, text: string, maxWidth: number): string {
  if (doc.widthOfString(text) <= maxWidth) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.widthOfString(text.slice(0, mid) + "…") <= maxWidth) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + "…";
}

export interface ListReportPdfInput {
  org: { name: string | null; phone: string | null; email: string | null; address: string | null; logoUrl?: string | null; footerText?: string | null };
  title: string;
  subtitle: string;
  headers: string[];
  rows: (string | number)[][];
  /** { "Premium": { USD: 1234.5, ZAR: 90 }, ... } — rendered as a totals panel after the table. */
  currencyTotals?: Record<string, Record<string, number>> | null;
  truncatedAt?: number | null;
}

export async function streamListReportPdf(input: ListReportPdfInput, res: Response, opts?: { attachment?: boolean }) {
  const { org, title, subtitle, headers, rows, currencyTotals, truncatedAt } = input;

  if (headers.length > LIST_PDF_MAX_COLUMNS) {
    res.status(422).json({
      message: `This report has ${headers.length} columns — too many for a readable PDF. Use the CSV export instead.`,
    });
    return;
  }

  const logoData = await resolveImage(org.logoUrl ?? null);
  const doc = new PDFDocument({ size: [A4_LANDSCAPE_W, A4_LANDSCAPE_H], margin: M, bufferPages: true, info: { Title: title, Author: org.name || "POL263" } });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")}.pdf"`);
  doc.pipe(res);

  // Column widths: numeric-looking columns get a share, text columns get the rest, all clamped.
  const colWidths = ((): number[] => {
    const min = 46, weights = headers.map((h) => Math.max(h.length, 8));
    const totalW = weights.reduce((a, b) => a + b, 0);
    return weights.map((w) => Math.max(min, (w / totalW) * COL));
  })();
  const scale = COL / colWidths.reduce((a, b) => a + b, 0);
  const widths = colWidths.map((w) => w * scale);

  let y = M;
  let pageNum = 0;

  const drawLetterhead = () => {
    y = M;
    if (logoData) { try { doc.image(logoData, M, y, { height: 40, fit: [90, 40] }); } catch { /* skip */ } }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY).text(org.name || "Company", M + 100, y, { width: COL - 100, align: "right" });
    y += 14;
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED);
    for (const p of [org.phone, org.email, org.address].filter(Boolean) as string[]) { doc.text(p, M + 100, y, { width: COL - 100, align: "right" }); y += 9; }
    y = Math.max(y, M + 44) + 6;
    doc.moveTo(M, y).lineTo(A4_LANDSCAPE_W - M, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 6;
    doc.rect(M, y, COL, 22).fill(C_ACCENT);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff").text(title.toUpperCase(), M, y + 6, { width: COL, align: "center" });
    y += 26;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text(subtitle, M, y, { width: COL, align: "center" });
    y += 16;
  };

  const drawHeaderRow = () => {
    doc.rect(M, y, COL, 14).fill("#e2e8f0");
    let cx = M + 3;
    for (let i = 0; i < headers.length; i++) {
      doc.font("Helvetica-Bold").fontSize(6.8).fillColor(C_ACCENT);
      doc.text(fitText(doc, headers[i], widths[i] - 4), cx, y + 3.5, { width: widths[i] - 4, lineBreak: false });
      cx += widths[i];
    }
    y += 16;
  };

  const newPage = () => {
    if (pageNum > 0) doc.addPage();
    pageNum++;
    drawLetterhead();
    drawHeaderRow();
  };

  newPage();

  if (rows.length === 0) {
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text("No records for the selected filters.", M, y + 4, { width: COL });
  }

  for (let r = 0; r < rows.length; r++) {
    if (y + 12 > A4_LANDSCAPE_H - M - 18) newPage();
    if (r % 2 === 1) doc.rect(M, y, COL, 11).fill(C_ROW_ALT);
    let cx = M + 3;
    for (let i = 0; i < headers.length; i++) {
      doc.font("Helvetica").fontSize(6.6).fillColor(C_TEXT);
      doc.text(fitText(doc, String(rows[r][i] ?? ""), widths[i] - 4), cx, y + 2, { width: widths[i] - 4, lineBreak: false });
      cx += widths[i];
    }
    y += 11;
  }

  if (truncatedAt && rows.length >= truncatedAt) {
    y += 4;
    doc.font("Helvetica-Oblique").fontSize(7).fillColor("#b45309")
      .text(`Truncated at ${truncatedAt} rows — narrow the date range or add filters to see the rest.`, M, y, { width: COL });
    y += 12;
  }

  if (currencyTotals && Object.keys(currencyTotals).length > 0) {
    if (y + 40 > A4_LANDSCAPE_H - M - 18) newPage();
    y += 8;
    doc.rect(M, y, COL, 14).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff").text(`TOTALS  ·  ${rows.length} rows`, M + 6, y + 3.5);
    y += 18;
    for (const [label, totals] of Object.entries(currencyTotals)) {
      const parts = Object.entries(totals)
        .filter(([, v]) => Math.abs(v) > 0.004)
        .map(([c, v]) => `${c} ${v.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
      if (parts.length === 0) continue;
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT).text(label, M, y, { width: 200 });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY).text(parts.join("   ·   "), M + 200, y, { width: COL - 200 });
      y += 13;
    }
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const fy = A4_LANDSCAPE_H - M + 4;
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
      .text(`${org.name || ""}  ·  ${title}  ·  Confidential  ·  Page ${i + 1} of ${range.count}`, M, fy, { width: COL, align: "center", lineBreak: false });
    if (org.footerText) {
      doc.font("Helvetica").fontSize(6).fillColor(C_MUTED).text(org.footerText, M, fy + 8, { width: COL, align: "center", lineBreak: false });
    }
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
}
