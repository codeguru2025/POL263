import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#e5e7eb";
const C_LIGHT_BG = "#f9fafb";

const TERMS = [
  "Settlement as per agreed terms.",
  "We charge an interest rate of 35% per month on all overdue accounts.",
  "All telephone and other tracing charges are charged to the client.",
  "We charge 30% on all cancellations.",
];

function fmt(v: string | number | null | undefined): string {
  return v != null && String(v).trim() ? String(v).trim() : "—";
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }); } catch { return String(v); }
}

function fmtAmount(v: string | number | null | undefined, currency = "USD"): string {
  const n = parseFloat(String(v ?? "0"));
  return isNaN(n) ? "—" : `${currency} ${n.toFixed(2)}`;
}

export async function streamQuotationPDF(
  quotationId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const quote = await storage.getQuotationById(quotationId, orgId);
  if (!quote) { res.status(404).json({ message: "Quotation not found" }); return; }

  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const [guarantor, collateral, receipts] = await Promise.all([
    storage.getQuotationGuarantor(quotationId, orgId),
    storage.getQuotationCollateral(quotationId, orgId),
    quote.funeralCaseId ? storage.getServiceReceipts(orgId, { funeralCaseId: quote.funeralCaseId }) : Promise.resolve([]),
  ]);

  // Resolve receipt issuers
  const issuerIds = Array.from(new Set(receipts.map(r => r.issuedByUserId).filter((id): id is string => !!id)));
  const issuersMap: Record<string, string> = {};
  await Promise.all(issuerIds.map(async (id) => {
    const u = await storage.getUser(id);
    if (u) issuersMap[id] = u.displayName || u.email || id;
  }));

  const logoData = await resolveImage(org.logoUrl);
  const filename = `Quotation-${quote.quotationNumber}.pdf`;

  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Quotation ${quote.quotationNumber}`, Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = MARGIN;

  // ── Header ──────────────────────────────────────────────────
  if (logoData) { try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ } }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Funeral Parlour", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone) parts.push(org.phone);
  if (org.email) parts.push(org.email);
  if (org.address) parts.push(org.address);
  if (org.website) parts.push(org.website);
  parts.forEach(p => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 10;

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(18).fillColor(C_TEXT)
    .text("QUOTATION", MARGIN, y, { width: COL, align: "center" });
  y += 22;

  // Ref row
  const statusLabel = (quote.conversionStatus === "converted" ? "CONVERTED" : quote.conversionStatus === "partial" ? "PARTIAL PAYMENT" : (quote.status || "DRAFT")).toUpperCase();
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(`No: ${quote.quotationNumber}  ·  Date: ${fmtDate(quote.quotationDate)}  ·  Status: ${statusLabel}`, MARGIN, y, { width: COL, align: "center" });
  y += 20;

  // ── Section helper ───────────────────────────────────────────
  function sectionHeader(title: string) {
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
    doc.fillColor(C_TEXT);
    y += 26;
  }
  function infoRow(label: string, value: string) {
    const lw = 150;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, startY, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, startY, { width: COL - lw - 20 });
    y += 14;
  }
  function twoCol(l1: string, v1: string, l2: string, v2: string) {
    const half = COL / 2 - 4;
    const lw = 90;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l1, MARGIN + 8, startY, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v1, MARGIN + lw + 8, startY, { width: half - lw - 8 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l2, MARGIN + half + 16, startY, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v2, MARGIN + half + lw + 24, startY, { width: half - lw - 8 });
    y += 14;
  }

  // ── 1. Client / Informant ───────────────────────────────────
  sectionHeader("1. Client / Informant Details");
  infoRow("Informant Name:", fmt(quote.informantFullNames));
  infoRow("Phone:", fmt(quote.informantPhone));
  infoRow("Address:", fmt(quote.informantAddress));
  y += 6;

  // ── 2. Deceased Details ─────────────────────────────────────
  sectionHeader("2. Deceased Details");
  infoRow("Name:", fmt(quote.deceasedName));
  twoCol("Age:", fmt(quote.deceasedAge), "Sex:", fmt(quote.deceasedSex));
  const casketLabel: Record<string, string> = {
    flat_lid: "Flat Lid", dome: "Dome", mini_dome: "Mini Dome",
    executive_dome: "Executive Dome", two_tier: "2-Tier", three_tier: "3-Tier", coffin_shaped: "Coffin Shaped",
  };
  infoRow("Casket Type:", quote.casketType ? (casketLabel[quote.casketType] || quote.casketType) : "—");
  y += 6;

  // ── 3. Line Items ────────────────────────────────────────────
  sectionHeader("3. Quotation Items");
  const currency = quote.currency || "USD";

  // Table header
  const c0 = MARGIN + 8, c1 = MARGIN + 280, c2 = MARGIN + 350, c3 = MARGIN + COL - 8;
  const hdrY = y;
  doc.rect(MARGIN, hdrY, COL, 16).fill(C_LIGHT_BG).stroke();
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_TEXT);
  doc.text("Description", c0, hdrY + 3, { width: 260 });
  doc.text("Qty", c1, hdrY + 3, { width: 60, align: "center" });
  doc.text("Unit Price", c2, hdrY + 3, { width: 70, align: "right" });
  doc.text("Amount", c3 - 60, hdrY + 3, { width: 60, align: "right" });
  y += 18;

  doc.font("Helvetica").fontSize(8).fillColor(C_TEXT);
  let rowIdx = 0;
  for (const item of quote.items) {
    if (rowIdx % 2 === 0) doc.rect(MARGIN, y, COL, 14).fill("#f8fafc").stroke();
    doc.fillColor(C_TEXT);
    doc.text(item.description || "—", c0, y + 2, { width: 260 });
    doc.text(fmt(item.quantity), c1, y + 2, { width: 60, align: "center" });
    doc.text(fmtAmount(item.unitPrice, currency), c2, y + 2, { width: 70, align: "right" });
    doc.text(fmtAmount(item.lineTotal, currency), c3 - 60, y + 2, { width: 60, align: "right" });
    y += 14;
    rowIdx++;
  }
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 8;

  // ── 4. Totals ────────────────────────────────────────────────
  const totalsX = MARGIN + COL / 2;
  const totalsW = COL / 2;

  function totalRow(label: string, value: string, bold = false) {
    if (bold) doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT);
    else doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED);
    doc.text(label, totalsX, y, { width: totalsW * 0.55 });
    if (bold) doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT);
    else doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT);
    doc.text(value, totalsX + totalsW * 0.55, y, { width: totalsW * 0.45, align: "right" });
    y += 14;
  }

  totalRow("Subtotal:", fmtAmount(quote.subtotal, currency));
  totalRow(`VAT (${quote.vatRate ?? 15}%):`, fmtAmount(quote.vatAmount, currency));
  if (parseFloat(String(quote.discountAmount || "0")) > 0) {
    totalRow("Discount:", `- ${fmtAmount(quote.discountAmount, currency)}`);
  }
  doc.moveTo(totalsX, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;
  totalRow("GRAND TOTAL:", fmtAmount(quote.grandTotal || quote.total, currency), true);
  y += 8;

  // ── 5. Payment History ───────────────────────────────────────
  if (receipts.length > 0) {
    sectionHeader("4. Payment History");
    let totalPaid = 0;
    for (const r of receipts.filter(r => r.status === "issued")) {
      const issuedBy = r.issuedByUserId ? (issuersMap[r.issuedByUserId] || "—") : "—";
      totalPaid += parseFloat(String(r.amount));
      infoRow(`Receipt ${r.receiptNumber}:`, `${fmtAmount(r.amount, currency)}  ·  ${fmtDate(r.issuedAt)}  ·  Received by: ${issuedBy}`);
    }
    const grandTotalNum = parseFloat(String(quote.grandTotal || quote.total || "0"));
    const outstanding = Math.max(0, grandTotalNum - totalPaid);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(outstanding > 0 ? "#dc2626" : C_PRIMARY)
      .text(`Balance Outstanding: ${fmtAmount(outstanding, currency)}`, MARGIN + 8, y, { width: COL - 16 });
    y += 18;
  }

  // ── 6. Guarantor (Part Payment) ──────────────────────────────
  if (guarantor) {
    sectionHeader("5. Guarantor Details (Part Payment)");
    infoRow("Guarantor Name:", fmt(guarantor.guarantorName));
    infoRow("Contact:", fmt(guarantor.guarantorPhone));
    infoRow("Address:", fmt(guarantor.guarantorAddress));
    infoRow("ID Number:", fmt(guarantor.guarantorIdNumber));
    y += 6;
  }

  // ── 7. Collateral ────────────────────────────────────────────
  if (collateral.length > 0) {
    sectionHeader("6. Collateral");
    const secNum = guarantor ? 6 : 5;
    // Re-draw the header with correct number
    y -= 26;
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(`${secNum}. COLLATERAL`, MARGIN + 8, y + 4, { width: COL - 16 });
    doc.fillColor(C_TEXT);
    y += 26;

    for (const c of collateral) {
      infoRow("Item:", fmt(c.itemDescription));
      twoCol("Condition:", fmt(c.condition), "Value:", fmtAmount(c.value, currency));
      twoCol("Due Date:", fmtDate(c.dueDate), "Forfeiture Date:", fmtDate(c.forfeitureDate));
      y += 4;
    }

    // Auth box
    doc.rect(MARGIN, y, COL, 32).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text("AUTHORISED BY:", MARGIN + 8, y + 8, { width: 120 });
    doc.moveTo(MARGIN + 130, y + 20).lineTo(MARGIN + 300, y + 20).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text("CAPACITY:", MARGIN + 310, y + 8, { width: 80 });
    doc.moveTo(MARGIN + 390, y + 20).lineTo(A4_W - MARGIN - 8, y + 20).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 42;
  }

  // ── 8. Terms & Conditions ────────────────────────────────────
  if (y > A4_H - MARGIN - 80) { doc.addPage(); y = MARGIN; }
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 6;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED)
    .text("TERMS AND CONDITIONS OF SERVICE", MARGIN, y, { width: COL });
  y += 12;
  TERMS.forEach((term, i) => {
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`${i + 1}. ${term}`, MARGIN, y, { width: COL });
    y += 10;
  });
  y += 6;

  // ── Footer ───────────────────────────────────────────────────
  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(
      `${org.name || "POL263"} · Quotation ${quote.quotationNumber} · This is not a tax invoice`,
      MARGIN, footerY + 6, { width: COL, align: "center" }
    );

  doc.end();
}
