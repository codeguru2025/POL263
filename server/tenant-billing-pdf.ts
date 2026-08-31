/**
 * POL263-branded PDF for the platform's OWN invoices and receipts to a tenant (money flows
 * tenant → platform, so this is POL263's letterhead, not the tenant's). Attached to the billing
 * emails in tenant-billing-email.ts. Self-contained pdfkit like server/receipt-pdf.ts.
 */
import PDFDocument from "pdfkit";
import type { TenantInvoice } from "@shared/control-plane-schema";

const A4_W = 595.28;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;
const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#e5e7eb";

const money = (v: unknown) => {
  const n = parseFloat(String(v ?? "0"));
  return (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";

const KIND_TITLE: Record<string, string> = {
  subscription: "Subscription invoice",
  setup: "Setup fee invoice",
  per_policy: "Usage invoice",
  revenue_share: "Revenue-share invoice",
  adjustment: "Adjustment",
};

export interface TenantBillingPdfInput {
  invoice: Pick<TenantInvoice,
    | "id" | "kind" | "amount" | "currency" | "status" | "periodStart" | "periodEnd"
    | "dueDate" | "issuedAt" | "paidAt" | "merchantReference" | "lineItems">;
  tenantName: string;
  planName?: string | null;
  /** "invoice" = amount due; "receipt" = confirmation of payment received. */
  variant: "invoice" | "receipt";
}

export function buildTenantBillingPdf(input: TenantBillingPdfInput): Promise<{ buffer: Buffer; filename: string }> {
  const { invoice, tenantName, planName, variant } = input;
  const isReceipt = variant === "receipt";
  const docTitle = isReceipt ? "Payment Receipt" : (KIND_TITLE[invoice.kind] ?? "Invoice");
  const ref = invoice.merchantReference || invoice.id.slice(0, 12).toUpperCase();
  const filename = `POL263-${isReceipt ? "receipt" : "invoice"}-${ref.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf`;

  const lines = (invoice.lineItems && invoice.lineItems.length > 0)
    ? invoice.lineItems
    : [{ label: planName ? `${planName} — ${KIND_TITLE[invoice.kind] ?? "charge"}` : (KIND_TITLE[invoice.kind] ?? "Charge"), amount: String(invoice.amount) }];

  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN, info: { Title: `${docTitle} ${ref}`, Author: "POL263" } });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve({ buffer: Buffer.concat(chunks), filename }));

    let y = MARGIN;

    // ── Header ──────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(20).fillColor(C_PRIMARY).text("POL263", MARGIN, y);
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
      .text("Policy Management System", MARGIN, y + 24)
      .text("billing@pol263.com", MARGIN, y + 35);
    doc.font("Helvetica-Bold").fontSize(15).fillColor(C_TEXT)
      .text(isReceipt ? "PAYMENT RECEIPT" : docTitle.toUpperCase(), MARGIN, y, { width: COL, align: "right" });
    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text(`Reference: ${ref}`, MARGIN, y + 22, { width: COL, align: "right" })
      .text(`Issued: ${fmtDate(invoice.issuedAt)}`, MARGIN, y + 34, { width: COL, align: "right" });
    y += 58;
    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 18;

    // ── Bill-to + meta ──────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text("BILLED TO", MARGIN, y);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT).text(tenantName, MARGIN, y + 11);

    const metaX = MARGIN + COL / 2;
    const meta: [string, string][] = [];
    if (invoice.periodStart && invoice.periodEnd) meta.push(["Billing period", `${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`]);
    if (isReceipt) meta.push(["Paid on", fmtDate(invoice.paidAt)]);
    else meta.push(["Due date", fmtDate(invoice.dueDate)]);
    meta.push(["Status", isReceipt ? "Paid" : (invoice.status === "paid" ? "Paid" : "Awaiting payment")]);
    let my = y;
    for (const [k, v] of meta) {
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(k, metaX, my, { width: COL / 2, align: "right" });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text(v, metaX, my + 10, { width: COL / 2, align: "right" });
      my += 26;
    }
    y = Math.max(y + 40, my) + 8;

    // ── Line items ──────────────────────────────────────────────
    doc.rect(MARGIN, y, COL, 20).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
      .text("DESCRIPTION", MARGIN + 8, y + 6, { width: COL - 120 })
      .text("AMOUNT (USD)", MARGIN + COL - 112, y + 6, { width: 104, align: "right" });
    y += 20;

    doc.fillColor(C_TEXT);
    for (const li of lines) {
      const h = Math.max(18, doc.font("Helvetica").fontSize(9).heightOfString(li.label, { width: COL - 130 }) + 8);
      doc.font("Helvetica").fontSize(9).fillColor(C_TEXT).text(li.label, MARGIN + 8, y + 4, { width: COL - 130 });
      doc.font("Helvetica").fontSize(9).fillColor(C_TEXT).text(money(li.amount), MARGIN + COL - 112, y + 4, { width: 104, align: "right" });
      y += h;
      doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    }

    // ── Total ───────────────────────────────────────────────────
    y += 10;
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT)
      .text(isReceipt ? "Total paid" : "Total due", MARGIN + COL - 260, y, { width: 150, align: "right" })
      .text(`${invoice.currency} ${money(invoice.amount)}`, MARGIN + COL - 108, y, { width: 108, align: "right" });
    y += 30;

    if (!isReceipt && invoice.status !== "paid") {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
        .text("Pay online using the link in the accompanying email. Payment restores or continues your POL263 access automatically.", MARGIN, y, { width: COL });
      y += 24;
    }
    if (isReceipt) {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
        .text("Thank you. This receipt confirms the payment above was received and applied to your POL263 account.", MARGIN, y, { width: COL });
      y += 24;
    }

    // ── Footer ──────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`POL263 · Reference ${ref} · Generated ${fmtDate(new Date())} · This document is electronically issued and needs no signature.`,
        MARGIN, 800, { width: COL, align: "center" });

    doc.end();
  });
}
