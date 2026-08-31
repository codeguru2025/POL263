import { describe, it, expect } from "vitest";
import { buildTenantBillingPdf, REVENUE_SHARE_BILLING_TERMS } from "../../server/tenant-billing-pdf";

const baseInvoice = {
  id: "11111111-2222-3333-4444-555555555555",
  kind: "revenue_share",
  amount: "374.63",
  currency: "USD",
  status: "open" as const,
  periodStart: new Date("2026-08-01"),
  periodEnd: new Date("2026-08-31"),
  dueDate: new Date("2026-09-07"),
  issuedAt: new Date("2026-08-31"),
  paidAt: null,
  merchantReference: "BILL-abc1234-20260831-deadbeef",
  lineItems: [
    { label: "2.50% of $10,000.00 collected this month", amount: "250.00", currency: "USD" },
    { label: "2.50% of ZAR 90,000.00 collected this month (converted to USD at 0.055)", amount: "123.75", currency: "ZAR", nativeAmount: "2250.00" },
    { label: "Minimum monthly charge — usage this month came to $373.75, which is below the $250.00 plan minimum", amount: "0.88" },
  ],
};

describe("buildTenantBillingPdf", () => {
  it("renders an invoice PDF buffer", async () => {
    const { buffer, filename } = await buildTenantBillingPdf({
      invoice: baseInvoice, tenantName: "IFALAKHE FUNERAL SERVICES", planName: "Revenue Share", variant: "invoice",
    });
    expect(buffer.length).toBeGreaterThan(800);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(filename).toBe("POL263-invoice-BILL-abc1234-20260831-deadbeef.pdf");
  });

  it("renders a receipt PDF buffer for a paid invoice", async () => {
    const { buffer, filename } = await buildTenantBillingPdf({
      invoice: { ...baseInvoice, status: "paid", paidAt: new Date("2026-09-02") },
      tenantName: "IFALAKHE FUNERAL SERVICES", variant: "receipt",
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(filename).toBe("POL263-receipt-BILL-abc1234-20260831-deadbeef.pdf");
  });

  it("falls back to a single line when the invoice has no lineItems", async () => {
    const { buffer } = await buildTenantBillingPdf({
      invoice: { ...baseInvoice, kind: "setup", lineItems: null },
      tenantName: "Acme", planName: "Starter", variant: "invoice",
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("renders a partial-payment receipt with a remaining balance and T&Cs", async () => {
    const { buffer } = await buildTenantBillingPdf({
      invoice: { ...baseInvoice, amount: "617.60" },
      tenantName: "FALAKHE FUNERAL PARLOUR",
      variant: "receipt",
      amountPaidUsd: "250.00",
      balanceDueUsd: "367.60",
      payment: { method: "Bank transfer", reference: "FLK-PAY-001", receivedOn: new Date("2026-08-31") },
      terms: REVENUE_SHARE_BILLING_TERMS,
    });
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(2000);
    expect(REVENUE_SHARE_BILLING_TERMS.length).toBeGreaterThan(5);
  });
});
