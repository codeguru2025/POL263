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

function fmt(v: string | number | null | undefined): string {
  return v != null && String(v).trim() ? String(v).trim() : "—";
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return String(v);
  }
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(v);
  }
}

function fmtAmount(amount: string | number | null | undefined, currency = "USD"): string {
  if (amount == null || amount === "") return "—";
  const n = parseFloat(String(amount));
  return isNaN(n) ? "—" : `${currency} ${n.toFixed(2)}`;
}

async function buildHeader(
  doc: InstanceType<typeof PDFDocument>,
  org: { name: string | null; phone: string | null; email: string | null; address: string | null; logoUrl: string | null },
  title: string,
  subtitle: string
): Promise<number> {
  let y = MARGIN;
  const logoData = await resolveImage(org.logoUrl);
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Organisation", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone) parts.push(org.phone);
  if (org.email) parts.push(org.email);
  if (org.address) parts.push(org.address);
  parts.forEach((p) => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 12;

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 20;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(subtitle, MARGIN, y, { width: COL, align: "center" });
  y += 20;
  return y;
}

function sectionHeader(doc: InstanceType<typeof PDFDocument>, title: string, y: number): number {
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
  doc.fillColor(C_TEXT);
  return y + 26;
}

function infoRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string, y: number): number {
  const lw = 160;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, y, { width: COL - lw - 16 });
  return y + 14;
}

function sigBlock(doc: InstanceType<typeof PDFDocument>, label: string, xStart: number, width: number, y: number): void {
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(label, xStart, y, { width });
  doc.moveTo(xStart, y + 30).lineTo(xStart + width, y + 30).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Signature", xStart, y + 33, { width });
  doc.moveTo(xStart, y + 55).lineTo(xStart + width, y + 55).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Printed Name", xStart, y + 58, { width });
  doc.moveTo(xStart, y + 80).lineTo(xStart + width, y + 80).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date & Time", xStart, y + 83, { width });
}

function footer(doc: InstanceType<typeof PDFDocument>, orgName: string | null, docType: string, refNo: string): void {
  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(`${orgName || "POL263"} — ${docType} · Ref: ${refNo} · For official use only`, MARGIN, footerY + 6, { width: COL, align: "center" });
}

function blankUnderline(doc: InstanceType<typeof PDFDocument>, label: string, y: number, lineWidth = 200): number {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: 155 });
  doc.moveTo(MARGIN + 168, y + 10).lineTo(MARGIN + 168 + lineWidth, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  return y + 22;
}

function amountRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string, y: number, bold = false): number {
  const rw = 120;
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(bold ? C_TEXT : C_MUTED)
    .text(label, MARGIN + 8, y, { width: COL - rw - 24 });
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(value, A4_W - MARGIN - rw, y, { width: rw, align: "right" });
  return y + 14;
}

// ─── HELPER: table header row ────────────────────────────────

function tableHeaderRow(doc: InstanceType<typeof PDFDocument>, cols: { label: string; x: number; w: number; align?: "left" | "right" | "center" }[], y: number): number {
  doc.rect(MARGIN, y, COL, 16).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  for (const c of cols) {
    doc.text(c.label, c.x, y + 4, { width: c.w, align: c.align || "left" });
  }
  doc.fillColor(C_TEXT);
  return y + 18;
}

function tableRow(doc: InstanceType<typeof PDFDocument>, cols: { value: string; x: number; w: number; align?: "left" | "right" | "center" }[], y: number): number {
  doc.font("Helvetica").fontSize(8).fillColor(C_TEXT);
  let maxH = 14;
  for (const c of cols) {
    const h = doc.heightOfString(c.value, { width: c.w, align: c.align || "left" });
    if (h > maxH) maxH = h;
  }
  for (const c of cols) {
    doc.text(c.value, c.x, y + 2, { width: c.w, align: c.align || "left" });
  }
  doc.moveTo(MARGIN, y + maxH + 4).lineTo(A4_W - MARGIN, y + maxH + 4).lineWidth(0.3).strokeColor(C_BORDER).stroke();
  return y + maxH + 6;
}

// ─── FORM 16: PAYMENT RECEIPT ─────────────────────────────────

function renderReceiptHalf(
  doc: InstanceType<typeof PDFDocument>,
  org: { name: string | null; phone: string | null; email: string | null; address: string | null; logoUrl: string | null },
  tx: any,
  policy: any,
  client: any,
  copyLabel: string,
  startY: number
): number {
  let y = startY;

  // Copy label badge
  doc.rect(MARGIN, y, COL, 14).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED)
    .text(copyLabel, MARGIN + 8, y + 3, { width: COL - 16, align: "center" });
  doc.fillColor(C_TEXT);
  y += 18;

  // "RECEIPT" large + ref on right
  doc.font("Helvetica-Bold").fontSize(22).fillColor(C_PRIMARY).text("RECEIPT", MARGIN + 8, y, { width: COL / 2 });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("Receipt No:", A4_W - MARGIN - 160, y, { width: 60 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_TEXT).text(fmt(tx.reference || tx.id?.slice(0, 8).toUpperCase()), A4_W - MARGIN - 96, y, { width: 96, align: "right" });
  y += 14;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("Date:", A4_W - MARGIN - 160, y, { width: 60 });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(fmtDate(tx.receivedAt), A4_W - MARGIN - 96, y, { width: 96, align: "right" });
  y += 24;

  // Body rows
  y = infoRow(doc, "Received From", client ? `${client.firstName} ${client.lastName}` : "—", y);
  y = infoRow(doc, "Policy Number", fmt(policy?.policyNumber ?? policy?.id?.slice(0, 8)), y);

  // Amount — large prominent
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Amount:", MARGIN + 8, y, { width: 155 });
  doc.font("Helvetica-Bold").fontSize(14).fillColor(C_PRIMARY).text(fmtAmount(tx.amount, tx.currency), MARGIN + 168, y - 2, { width: COL - 168 });
  y += 22;

  y = infoRow(doc, "Payment Method", fmt(tx.paymentMethod), y);
  if (tx.reference) y = infoRow(doc, "Reference", tx.reference, y);
  if (tx.periodFrom || tx.periodTo) y = infoRow(doc, "Period", `${fmtDate(tx.periodFrom)} – ${fmtDate(tx.periodTo)}`, y);
  if (tx.notes) y = infoRow(doc, "Notes", tx.notes, y);
  y += 6;

  // Sig line (cashier only — small)
  const halfW = (COL - 32) / 2;
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Cashier Signature", MARGIN + 8, y, { width: halfW });
  doc.moveTo(MARGIN + 8, y + 24).lineTo(MARGIN + 8 + halfW, y + 24).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Payer Signature", MARGIN + 24 + halfW, y, { width: halfW });
  doc.moveTo(MARGIN + 24 + halfW, y + 24).lineTo(MARGIN + 24 + halfW + halfW, y + 24).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 30;
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date: ___________________________", MARGIN + 8, y, { width: COL });
  y += 18;

  return y;
}

export async function streamPaymentReceiptPDF(
  transactionId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const tx = await storage.getPaymentTransaction(transactionId, orgId);
  if (!tx) { res.status(404).json({ message: "Payment transaction not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const policy = tx.policyId ? await storage.getPolicy(tx.policyId, orgId) : null;
  const client = tx.clientId ? await storage.getClient(tx.clientId, orgId) : null;

  const filename = `receipt-${(tx.reference || tx.id.slice(0, 8)).toUpperCase()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  // Top half — customer copy
  let y = MARGIN;
  renderReceiptHalf(doc, { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl }, tx, policy, client, "ORIGINAL — CUSTOMER COPY", y);

  // Dashed divider
  const midY = A4_H / 2 - 10;
  doc.moveTo(MARGIN, midY).lineTo(A4_W - MARGIN, midY).dash(4, { space: 4 }).lineWidth(0.5).strokeColor(C_MUTED).stroke();
  doc.undash();
  doc.font("Helvetica").fontSize(7).fillColor(C_MUTED).text("✂  Cut here", MARGIN, midY + 3, { width: COL, align: "center" });

  // Bottom half — office copy
  renderReceiptHalf(doc, { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl }, tx, policy, client, "DUPLICATE — OFFICE COPY", midY + 16);

  footer(doc, org.name, "Payment Receipt", tx.reference || tx.id.slice(0, 8).toUpperCase());
  doc.end();
}

export async function streamPaymentReceiptBlankPDF(res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="blank-payment-receipt.pdf"');
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  const renderBlankHalf = (copyLabel: string, startY: number): number => {
    let y = startY;
    doc.rect(MARGIN, y, COL, 14).fill(C_LIGHT_BG);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(copyLabel, MARGIN + 8, y + 3, { width: COL - 16, align: "center" });
    doc.fillColor(C_TEXT);
    y += 18;

    doc.font("Helvetica-Bold").fontSize(22).fillColor(C_PRIMARY).text("RECEIPT", MARGIN + 8, y, { width: COL / 2 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("Receipt No: ____________________", A4_W - MARGIN - 200, y, { width: 200, align: "right" });
    y += 14;
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("Date: __________________________", A4_W - MARGIN - 200, y, { width: 200, align: "right" });
    y += 24;

    const fields = ["Received From", "Policy Number", "Amount", "Payment Method", "Reference", "Period (From – To)", "Notes"];
    for (const f of fields) {
      y = blankUnderline(doc, f, y, 240);
    }
    y += 6;

    const halfW = (COL - 32) / 2;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Cashier Signature", MARGIN + 8, y, { width: halfW });
    doc.moveTo(MARGIN + 8, y + 24).lineTo(MARGIN + 8 + halfW, y + 24).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Payer Signature", MARGIN + 24 + halfW, y, { width: halfW });
    doc.moveTo(MARGIN + 24 + halfW, y + 24).lineTo(MARGIN + 24 + halfW + halfW, y + 24).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 30;
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date: ___________________________", MARGIN + 8, y, { width: COL });
    return y + 18;
  };

  renderBlankHalf("ORIGINAL — CUSTOMER COPY", MARGIN);
  const midY = A4_H / 2 - 10;
  doc.moveTo(MARGIN, midY).lineTo(A4_W - MARGIN, midY).dash(4, { space: 4 }).lineWidth(0.5).strokeColor(C_MUTED).stroke();
  doc.undash();
  doc.font("Helvetica").fontSize(7).fillColor(C_MUTED).text("✂  Cut here", MARGIN, midY + 3, { width: COL, align: "center" });
  renderBlankHalf("DUPLICATE — OFFICE COPY", midY + 16);

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("POL263 — Payment Receipt (Blank) · For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}

// ─── FORM 17: DAILY CASHUP SHEET ────────────────────────────

export async function streamCashupSheetPDF(
  cashupId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const cashup = await storage.getCashup(cashupId, orgId);
  if (!cashup) { res.status(404).json({ message: "Cashup not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const filename = `cashup-${cashup.cashupDate}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl }, "DAILY CASH RECONCILIATION SHEET", `Date: ${fmtDate(cashup.cashupDate)} · Status: ${(cashup.status || "draft").toUpperCase()}`);

  y = sectionHeader(doc, "Session Details", y);
  y = infoRow(doc, "Cashup Date", fmtDate(cashup.cashupDate), y);
  y = infoRow(doc, "Currency", fmt(cashup.currency), y);
  y = infoRow(doc, "Transaction Count", fmt(cashup.transactionCount), y);
  y = infoRow(doc, "Status", fmt(cashup.status), y);
  if (cashup.notes) y = infoRow(doc, "Notes", cashup.notes, y);
  y += 8;

  const methods = [
    { key: "cash", label: "Cash" },
    { key: "paynow_ecocash", label: "EcoCash / Mobile Money" },
    { key: "paynow_card", label: "Card" },
    { key: "other", label: "Other" },
  ];

  const expectedAmounts: Record<string, number> = {};
  if (cashup.amountsByMethod && typeof cashup.amountsByMethod === "object") {
    for (const m of methods) {
      expectedAmounts[m.key] = parseFloat(String((cashup.amountsByMethod as any)[m.key] || "0"));
    }
  }
  const countedAmounts: Record<string, number> = {};
  if (cashup.countedAmountsByMethod && typeof cashup.countedAmountsByMethod === "object") {
    for (const m of methods) {
      countedAmounts[m.key] = parseFloat(String((cashup.countedAmountsByMethod as any)[m.key] || "0"));
    }
  }

  // Two-column table: Expected vs Counted
  const col1X = MARGIN;
  const col2X = MARGIN + COL / 2 + 8;
  const colW = COL / 2 - 8;

  // Expected header
  doc.rect(col1X, y, colW, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#fff").text("EXPECTED (FROM SYSTEM)", col1X + 8, y + 4, { width: colW - 16 });
  // Counted header
  doc.rect(col2X, y, colW, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#fff").text("PHYSICAL COUNT", col2X + 8, y + 4, { width: colW - 16 });
  doc.fillColor(C_TEXT);
  y += 22;

  let expectedTotal = 0;
  let countedTotal = cashup.countedTotal ? parseFloat(String(cashup.countedTotal)) : 0;

  for (const m of methods) {
    const exp = expectedAmounts[m.key] ?? 0;
    expectedTotal += exp;
    const cnt = countedAmounts[m.key] ?? 0;

    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text(m.label, col1X + 8, y, { width: 110 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(`${cashup.currency} ${exp.toFixed(2)}`, col1X + 120, y, { width: colW - 128, align: "right" });

    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text(m.label, col2X + 8, y, { width: 110 });
    if (countedAmounts[m.key] !== undefined) {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(`${cashup.currency} ${cnt.toFixed(2)}`, col2X + 120, y, { width: colW - 128, align: "right" });
    } else {
      // Blank line for handwriting
      doc.moveTo(col2X + 120, y + 10).lineTo(col2X + colW - 8, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    }
    y += 16;
  }

  // Totals row
  doc.rect(col1X, y, colW, 18).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("SYSTEM TOTAL", col1X + 8, y + 4, { width: 110 });
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_PRIMARY).text(`${cashup.currency} ${(parseFloat(String(cashup.totalAmount || "0"))).toFixed(2)}`, col1X + 120, y + 4, { width: colW - 128, align: "right" });

  doc.rect(col2X, y, colW, 18).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("COUNTED TOTAL", col2X + 8, y + 4, { width: 110 });
  if (cashup.countedTotal) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C_PRIMARY).text(`${cashup.currency} ${countedTotal.toFixed(2)}`, col2X + 120, y + 4, { width: colW - 128, align: "right" });
  } else {
    doc.moveTo(col2X + 120, y + 14).lineTo(col2X + colW - 8, y + 14).lineWidth(0.8).strokeColor(C_PRIMARY).stroke();
  }
  doc.fillColor(C_TEXT);
  y += 26;

  // Discrepancy
  y = sectionHeader(doc, "Reconciliation", y);
  const disc = cashup.discrepancyAmount ? parseFloat(String(cashup.discrepancyAmount)) : null;
  if (disc !== null) {
    const discColor = disc === 0 ? "#059669" : "#dc2626";
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Discrepancy:", MARGIN + 8, y, { width: 155 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(discColor).text(`${cashup.currency} ${disc.toFixed(2)} ${disc > 0 ? "(surplus)" : disc < 0 ? "(shortage)" : "(balanced)"}`, MARGIN + 168, y);
    y += 16;
  } else {
    y = blankUnderline(doc, "Discrepancy Amount", y, 200);
  }
  y = infoRow(doc, "Discrepancy Notes", fmt(cashup.discrepancyNotes), y);
  y += 10;

  y = sectionHeader(doc, "Signatures", y);
  y += 4;
  const sw = (COL - 32) / 3;
  sigBlock(doc, "Prepared By", MARGIN + 8, sw, y);
  sigBlock(doc, "Submitted To Finance", MARGIN + 20 + sw, sw, y);
  sigBlock(doc, "Finance Confirmed By", MARGIN + 32 + sw * 2, sw, y);
  y += 100;

  if (cashup.submittedAt || cashup.confirmedAt) {
    y += 6;
    if (cashup.submittedAt) y = infoRow(doc, "Submitted At", fmtDateTime(cashup.submittedAt), y);
    if (cashup.confirmedAt) y = infoRow(doc, "Confirmed At", fmtDateTime(cashup.confirmedAt), y);
  }

  footer(doc, org.name, "Cash Reconciliation", cashupId.slice(0, 8).toUpperCase());
  doc.end();
}

export async function streamCashupSheetBlankPDF(res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="blank-cashup-sheet.pdf"');
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  // Minimal header
  let y = MARGIN;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_PRIMARY).text("DAILY CASH RECONCILIATION SHEET", MARGIN, y, { width: COL, align: "center" });
  y += 24;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 16;

  const fields = ["Date", "Branch", "Prepared By", "Currency", "Transaction Count"];
  for (const f of fields) y = blankUnderline(doc, f, y);
  y += 8;

  const methods = ["Cash", "EcoCash / Mobile Money", "Card", "Other"];
  const col1X = MARGIN;
  const col2X = MARGIN + COL / 2 + 8;
  const colW = COL / 2 - 8;

  doc.rect(col1X, y, colW, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#fff").text("EXPECTED (FROM SYSTEM)", col1X + 8, y + 4, { width: colW - 16 });
  doc.rect(col2X, y, colW, 16).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#fff").text("PHYSICAL COUNT", col2X + 8, y + 4, { width: colW - 16 });
  doc.fillColor(C_TEXT);
  y += 22;

  for (const m of methods) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text(m, col1X + 8, y, { width: 110 });
    doc.moveTo(col1X + 120, y + 10).lineTo(col1X + colW - 8, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text(m, col2X + 8, y, { width: 110 });
    doc.moveTo(col2X + 120, y + 10).lineTo(col2X + colW - 8, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 20;
  }

  doc.rect(col1X, y, colW, 18).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("SYSTEM TOTAL", col1X + 8, y + 4, { width: 110 });
  doc.moveTo(col1X + 120, y + 14).lineTo(col1X + colW - 8, y + 14).lineWidth(0.8).strokeColor(C_PRIMARY).stroke();
  doc.rect(col2X, y, colW, 18).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("COUNTED TOTAL", col2X + 8, y + 4, { width: 110 });
  doc.moveTo(col2X + 120, y + 14).lineTo(col2X + colW - 8, y + 14).lineWidth(0.8).strokeColor(C_PRIMARY).stroke();
  doc.fillColor(C_TEXT);
  y += 26;

  y = sectionHeader(doc, "Reconciliation", y);
  y = blankUnderline(doc, "Discrepancy Amount", y, 200);
  y = blankUnderline(doc, "Discrepancy Notes", y, 200);
  y += 8;

  y = sectionHeader(doc, "Signatures", y);
  y += 4;
  const sw = (COL - 32) / 3;
  sigBlock(doc, "Prepared By", MARGIN + 8, sw, y);
  sigBlock(doc, "Submitted To Finance", MARGIN + 20 + sw, sw, y);
  sigBlock(doc, "Finance Confirmed By", MARGIN + 32 + sw * 2, sw, y);

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("POL263 — Daily Cash Reconciliation (Blank) · For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}

// ─── FORM 18: REQUISITION FORM ───────────────────────────────

export async function streamRequisitionFormPDF(
  requisitionId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const req = await storage.getRequisition(requisitionId, orgId);
  if (!req) { res.status(404).json({ message: "Requisition not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  // Fetch items
  const allItems = await storage.getRequisitionItemsByIds([requisitionId], orgId);
  const items = allItems.filter((i: any) => i.requisitionId === requisitionId);

  const filename = `requisition-${req.requisitionNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl }, "REQUISITION FORM", `Ref: ${req.requisitionNumber} · Status: ${(req.status || "draft").toUpperCase()} · Date: ${fmtDate(req.createdAt)}`);

  y = sectionHeader(doc, "Requisition Details", y);
  y = infoRow(doc, "Requisition No.", req.requisitionNumber, y);
  y = infoRow(doc, "Category", fmt(req.category), y);
  y = infoRow(doc, "Description", fmt(req.description), y);
  if (req.payee) y = infoRow(doc, "Payee", req.payee, y);
  if (req.neededByDate) y = infoRow(doc, "Needed By", fmtDate(req.neededByDate), y);
  if (req.paymentMethod) y = infoRow(doc, "Payment Method", req.paymentMethod, y);
  if (req.reference) y = infoRow(doc, "Reference", req.reference, y);
  if (req.notes) y = infoRow(doc, "Notes", req.notes, y);
  y += 8;

  // Line items table
  y = sectionHeader(doc, "Line Items", y);
  const tCols = [
    { label: "#", x: MARGIN + 4, w: 20 },
    { label: "Description", x: MARGIN + 28, w: 180 },
    { label: "Category", x: MARGIN + 212, w: 80 },
    { label: "Qty", x: MARGIN + 296, w: 30, align: "right" as const },
    { label: "Unit Price", x: MARGIN + 330, w: 70, align: "right" as const },
    { label: "Total", x: MARGIN + 404, w: 90, align: "right" as const },
  ];
  y = tableHeaderRow(doc, tCols, y);

  for (let i = 0; i < items.length; i++) {
    const item: any = items[i];
    const qty = parseFloat(String(item.quantity || 1));
    const unitPrice = parseFloat(String(item.unitPrice || 0));
    const total = qty * unitPrice;
    y = tableRow(doc, [
      { value: String(i + 1), x: tCols[0].x, w: tCols[0].w },
      { value: fmt(item.description), x: tCols[1].x, w: tCols[1].w },
      { value: fmt(item.category), x: tCols[2].x, w: tCols[2].w },
      { value: String(qty), x: tCols[3].x, w: tCols[3].w, align: "right" },
      { value: `${req.currency} ${unitPrice.toFixed(2)}`, x: tCols[4].x, w: tCols[4].w, align: "right" },
      { value: `${req.currency} ${total.toFixed(2)}`, x: tCols[5].x, w: tCols[5].w, align: "right" },
    ], y);
  }
  // Blank rows for handwriting
  const blankRowsNeeded = Math.max(0, 5 - items.length);
  for (let i = 0; i < blankRowsNeeded; i++) {
    y = tableRow(doc, [
      { value: String(items.length + i + 1), x: tCols[0].x, w: tCols[0].w },
      { value: "", x: tCols[1].x, w: tCols[1].w },
      { value: "", x: tCols[2].x, w: tCols[2].w },
      { value: "", x: tCols[3].x, w: tCols[3].w, align: "right" },
      { value: "", x: tCols[4].x, w: tCols[4].w, align: "right" },
      { value: "", x: tCols[5].x, w: tCols[5].w, align: "right" },
    ], y);
  }

  // Grand total
  y += 4;
  y = amountRow(doc, `GRAND TOTAL (${req.currency})`, `${req.currency} ${parseFloat(String(req.amount || 0)).toFixed(2)}`, y, true);
  y += 10;

  // Approval section
  y = sectionHeader(doc, "Approval", y);
  if (req.approverNotes) y = infoRow(doc, "Approver Notes", req.approverNotes, y);
  if (req.rejectionReason) y = infoRow(doc, "Rejection Reason", req.rejectionReason, y);
  if (req.paidAt) y = infoRow(doc, "Paid At", fmtDateTime(req.paidAt), y);
  y += 8;

  const sw = (COL - 32) / 3;
  sigBlock(doc, "Requested By", MARGIN + 8, sw, y);
  sigBlock(doc, "Approved By", MARGIN + 20 + sw, sw, y);
  sigBlock(doc, "Paid By / Date", MARGIN + 32 + sw * 2, sw, y);

  footer(doc, org.name, "Requisition", req.requisitionNumber);
  doc.end();
}

export async function streamRequisitionBlankPDF(res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="blank-requisition.pdf"');
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = MARGIN;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_PRIMARY).text("REQUISITION FORM", MARGIN, y, { width: COL, align: "center" });
  y += 24;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 16;

  const headerFields = ["Requisition No.", "Date", "Branch", "Category", "Description", "Payee", "Needed By Date", "Payment Method", "Reference", "Notes"];
  for (const f of headerFields) y = blankUnderline(doc, f, y);
  y += 8;

  y = sectionHeader(doc, "Line Items", y);
  const tCols = [
    { label: "#", x: MARGIN + 4, w: 20 },
    { label: "Description", x: MARGIN + 28, w: 180 },
    { label: "Category", x: MARGIN + 212, w: 80 },
    { label: "Qty", x: MARGIN + 296, w: 30, align: "right" as const },
    { label: "Unit Price", x: MARGIN + 330, w: 70, align: "right" as const },
    { label: "Total", x: MARGIN + 404, w: 90, align: "right" as const },
  ];
  y = tableHeaderRow(doc, tCols, y);
  for (let i = 1; i <= 8; i++) {
    y = tableRow(doc, [
      { value: String(i), x: tCols[0].x, w: tCols[0].w },
      { value: "", x: tCols[1].x, w: tCols[1].w },
      { value: "", x: tCols[2].x, w: tCols[2].w },
      { value: "", x: tCols[3].x, w: tCols[3].w, align: "right" },
      { value: "", x: tCols[4].x, w: tCols[4].w, align: "right" },
      { value: "", x: tCols[5].x, w: tCols[5].w, align: "right" },
    ], y);
  }
  y += 4;
  y = amountRow(doc, "GRAND TOTAL", "___________________________", y, true);
  y += 12;

  y = sectionHeader(doc, "Approval", y);
  y += 4;
  const sw = (COL - 32) / 3;
  sigBlock(doc, "Requested By", MARGIN + 8, sw, y);
  sigBlock(doc, "Approved By", MARGIN + 20 + sw, sw, y);
  sigBlock(doc, "Paid By / Date", MARGIN + 32 + sw * 2, sw, y);

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("POL263 — Requisition Form (Blank) · For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}

// ─── FORM 19: EXPENDITURE VOUCHER ───────────────────────────

export async function streamExpenditureVoucherPDF(
  expenditureId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const expenditures = await storage.getExpenditures(orgId, 1000);
  const expenditure = expenditures.find((e) => e.id === expenditureId);
  if (!expenditure) { res.status(404).json({ message: "Expenditure not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const filename = `expenditure-${expenditureId.slice(0, 8).toUpperCase()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl }, "EXPENDITURE VOUCHER", `Ref: ${expenditureId.slice(0, 8).toUpperCase()} · Date: ${fmtDate(expenditure.spentAt || expenditure.createdAt)}`);

  y = sectionHeader(doc, "Expenditure Details", y);
  y = infoRow(doc, "Voucher No.", expenditureId.slice(0, 8).toUpperCase(), y);
  y = infoRow(doc, "Date", fmtDate(expenditure.spentAt || expenditure.createdAt), y);
  y = infoRow(doc, "Category", fmt(expenditure.category), y);
  y += 6;

  // Description with multi-line area
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Description:", MARGIN + 8, y, { width: 155 });
  y += 14;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(fmt(expenditure.description), MARGIN + 8, y, { width: COL - 16 });
  const descH = doc.heightOfString(fmt(expenditure.description), { width: COL - 16 });
  y += Math.max(descH + 8, 30);

  // Amount — large
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Amount:", MARGIN + 8, y, { width: 155 });
  doc.font("Helvetica-Bold").fontSize(18).fillColor(C_PRIMARY).text(fmtAmount(expenditure.amount, expenditure.currency), MARGIN + 168, y - 4, { width: COL - 168 });
  y += 28;

  if (expenditure.receiptRef) y = infoRow(doc, "Receipt / Invoice Ref", expenditure.receiptRef, y);
  if (expenditure.funeralCaseId) y = infoRow(doc, "Linked Funeral Case", expenditure.funeralCaseId.slice(0, 8).toUpperCase(), y);
  y += 12;

  y = sectionHeader(doc, "Approval", y);
  y += 8;
  const halfW = (COL - 24) / 2;
  sigBlock(doc, "Submitted By", MARGIN + 8, halfW, y);
  sigBlock(doc, "Approved By", MARGIN + 20 + halfW, halfW, y);
  y += 100;

  footer(doc, org.name, "Expenditure Voucher", expenditureId.slice(0, 8).toUpperCase());
  doc.end();
}

export async function streamExpenditureVoucherBlankPDF(res: Response): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", 'inline; filename="blank-expenditure-voucher.pdf"');
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = MARGIN;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_PRIMARY).text("EXPENDITURE VOUCHER", MARGIN, y, { width: COL, align: "center" });
  y += 24;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 16;

  const fields = ["Voucher No.", "Date", "Branch", "Category", "Description", "Amount", "Currency", "Receipt / Invoice Ref", "Linked Funeral Case No."];
  for (const f of fields) {
    if (f === "Description") {
      y = blankUnderline(doc, f, y, 240);
      y += 16; // extra line for description
    } else if (f === "Amount") {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(f, MARGIN + 8, y, { width: 155 });
      doc.font("Helvetica-Bold").fontSize(18).fillColor(C_BORDER).text("___________________", MARGIN + 168, y - 2);
      y += 28;
    } else {
      y = blankUnderline(doc, f, y);
    }
  }
  y += 12;

  const halfW = (COL - 24) / 2;
  sigBlock(doc, "Submitted By", MARGIN + 8, halfW, y);
  sigBlock(doc, "Approved By", MARGIN + 20 + halfW, halfW, y);

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("POL263 — Expenditure Voucher (Blank) · For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}
