/**
 * POL263-branded PDF for the platform's OWN invoices and receipts to a tenant (money flows
 * tenant → platform, so this is POL263's letterhead, not the tenant's). Attached to the billing
 * emails in tenant-billing-email.ts. Self-contained pdfkit like server/receipt-pdf.ts.
 */
import PDFDocument from "pdfkit";
import type { TenantInvoice } from "@shared/control-plane-schema";

const A4_W = 595.28;
const A4_H = 841.89;
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

/** Standard POL263 platform-billing terms for revenue-share tenants. */
export const REVENUE_SHARE_BILLING_TERMS: string[] = [
  "The platform fee is 2.5% of every premium and service payment received and receipted through POL263, charged in the currency it was collected in.",
  "Fees are billed monthly and converted to US dollars for invoicing at POL263's posted exchange rates on the invoice date.",
  "A minimum charge of US$250 applies for any month in which 2.5% of collections is less than that amount.",
  "Payment is due within 30 days of the invoice date.",
  "If unpaid fees pass US$300 at any time, an invoice for the amount then owing is issued immediately.",
  "Payments are applied to the oldest outstanding fees first. Partial payments reduce the balance shown; the remainder stays due on the original date.",
  "If an invoice is unpaid 30 days after it falls due, the account is suspended: staff keep read-only access to their data for a further 30 days, after which the account and all its data are permanently deleted.",
  "Any query about an invoice must be raised in writing within 14 days of its date.",
  "These terms may be changed on 30 days' written notice to the account's administrators.",
];

export interface TenantBillingPdfInput {
  invoice: Pick<TenantInvoice,
    | "id" | "kind" | "amount" | "currency" | "status" | "periodStart" | "periodEnd"
    | "dueDate" | "issuedAt" | "paidAt" | "merchantReference" | "lineItems">;
  tenantName: string;
  planName?: string | null;
  /** "invoice" = amount due; "receipt" = confirmation of payment received. */
  variant: "invoice" | "receipt";
  /** receipt: the payment actually received now, if it differs from the invoice total (partial payment). */
  amountPaidUsd?: string | number;
  /** receipt: what is still owed after this payment. Omit / 0 = paid in full. */
  balanceDueUsd?: string | number;
  /** receipt: how the payment was made and its reference. */
  payment?: { method?: string; reference?: string; receivedOn?: Date | string };
  /** Terms & Conditions bullets to print at the end. Pass REVENUE_SHARE_BILLING_TERMS or your own. */
  terms?: string[];
}

export function buildTenantBillingPdf(input: TenantBillingPdfInput): Promise<{ buffer: Buffer; filename: string }> {
  const { invoice, tenantName, planName, variant, terms } = input;
  const isReceipt = variant === "receipt";
  const docTitle = isReceipt ? "Payment Receipt" : (KIND_TITLE[invoice.kind] ?? "Invoice");
  const ref = invoice.merchantReference || invoice.id.slice(0, 12).toUpperCase();
  const filename = `POL263-${isReceipt ? "receipt" : "invoice"}-${ref.replace(/[^a-zA-Z0-9-]/g, "-")}.pdf`;

  const amountPaid = input.amountPaidUsd != null ? money(input.amountPaidUsd) : money(invoice.amount);
  const balanceDue = input.balanceDueUsd != null ? money(input.balanceDueUsd) : "0.00";
  const hasBalance = parseFloat(balanceDue) > 0.005;

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
      .text(`${isReceipt ? "Receipt date" : "Issued"}: ${fmtDate(isReceipt ? (input.payment?.receivedOn ?? new Date()) : invoice.issuedAt)}`, MARGIN, y + 34, { width: COL, align: "right" });
    y += 58;
    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
    y += 18;

    // ── Bill-to + meta ──────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(isReceipt ? "RECEIVED FROM" : "BILLED TO", MARGIN, y);
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT).text(tenantName, MARGIN, y + 11);

    const metaX = MARGIN + COL / 2;
    const meta: [string, string][] = [];
    if (invoice.periodStart && invoice.periodEnd) meta.push(["Billing period", `${fmtDate(invoice.periodStart)} – ${fmtDate(invoice.periodEnd)}`]);
    if (isReceipt) {
      meta.push(["Payment received", fmtDate(input.payment?.receivedOn ?? invoice.paidAt ?? new Date())]);
      if (input.payment?.method) meta.push(["Method", input.payment.method]);
      if (input.payment?.reference) meta.push(["Payment ref.", input.payment.reference]);
      meta.push(["Against invoice", ref]);
    } else {
      meta.push(["Due date", fmtDate(invoice.dueDate)]);
      meta.push(["Status", invoice.status === "paid" ? "Paid" : "Awaiting payment"]);
    }
    let my = y;
    for (const [k, v] of meta) {
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(k, metaX, my, { width: COL / 2, align: "right" });
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text(v, metaX, my + 10, { width: COL / 2, align: "right" });
      my += 24;
    }
    y = Math.max(y + 40, my) + 8;

    // ── Line items ──────────────────────────────────────────────
    doc.rect(MARGIN, y, COL, 20).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#ffffff")
      .text(isReceipt ? "INVOICE THIS PAYMENT COVERS" : "DESCRIPTION", MARGIN + 8, y + 6, { width: COL - 120 })
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

    // ── Totals ──────────────────────────────────────────────────
    y += 10;
    const totalRow = (label: string, value: string, bold = false) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 11 : 9.5).fillColor(C_TEXT)
        .text(label, MARGIN + COL - 300, y, { width: 190, align: "right" })
        .text(value, MARGIN + COL - 108, y, { width: 108, align: "right" });
      y += bold ? 20 : 16;
    };
    if (isReceipt) {
      totalRow("Invoice total", `USD ${money(invoice.amount)}`);
      totalRow("Payment received", `USD ${amountPaid}`, true);
      doc.moveTo(MARGIN + COL - 300, y - 2).lineTo(A4_W - MARGIN, y - 2).lineWidth(0.5).strokeColor(C_BORDER).stroke();
      totalRow(hasBalance ? "Balance still owing" : "Balance", `USD ${balanceDue}`, hasBalance);
    } else {
      totalRow("Total due", `${invoice.currency} ${money(invoice.amount)}`, true);
    }
    y += 12;

    // ── Note ────────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED);
    if (isReceipt) {
      doc.text(
        hasBalance
          ? `Thank you. This confirms POL263 received the payment above. A balance of USD ${balanceDue} remains due on invoice ${ref} by ${fmtDate(invoice.dueDate)}.`
          : `Thank you. This confirms POL263 received the payment above; invoice ${ref} is now settled in full.`,
        MARGIN, y, { width: COL });
    } else if (invoice.status !== "paid") {
      doc.text("Pay using the link in the accompanying email. Payment continues your POL263 access automatically.", MARGIN, y, { width: COL });
    }
    y = doc.y + 18;

    // ── Terms & Conditions ─────────────────────────────────────
    if (terms && terms.length) {
      if (y > A4_H - 200) { doc.addPage(); y = MARGIN; }
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_PRIMARY).text("TERMS & CONDITIONS", MARGIN, y);
      y = doc.y + 6;
      doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT);
      for (const term of terms) {
        doc.text("•  " + term, MARGIN, y, { width: COL, lineGap: 1.5 });
        y = doc.y + 4;
      }
    }

    // ── Footer ──────────────────────────────────────────────────
    doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
      .text(`POL263 · Reference ${ref} · Generated ${fmtDate(new Date())} · This document is electronically issued and needs no signature.`,
        MARGIN, A4_H - 42, { width: COL, align: "center" });

    doc.end();
  });
}
