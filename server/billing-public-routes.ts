/**
 * Unauthenticated tenant-billing routes — reachable by a locked-out tenant admin
 * who can't even log in, since suspension blocks authentication entirely.
 *
 * Every route here is looked up ONLY by the invoice's opaque paymentToken (never
 * by invoice/tenant id) — the token is the sole public identifier. Never add a
 * "list invoices/tenants" endpoint here; that would let anyone enumerate billing
 * status for arbitrary tenants.
 */
import type { Express } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, billingPlans, tenantInvoices } from "@shared/control-plane-schema";
import { initiatePaynowForInvoice, pollInvoiceStatus, handleTenantBillingPaynowResult } from "./tenant-billing-service";
import { structuredLog } from "./logger";

function publicPayPageUrl(token: string): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/pay/${token}`;
}

export function registerBillingPublicRoutes(app: Express): void {
  app.get("/api/public/billing/invoice/:token", async (req, res) => {
    const token = req.params.token as string;
    const [invoice] = await cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.paymentToken, token)).limit(1);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const [tenant] = await cpDb.select({ name: cpTenants.name }).from(cpTenants).where(eq(cpTenants.id, invoice.tenantId)).limit(1);
    const [plan] = await cpDb.select({ name: billingPlans.name }).from(billingPlans).where(eq(billingPlans.id, invoice.planId)).limit(1);

    return res.json({
      tenantName: tenant?.name || "Organization",
      planName: plan?.name || "Plan",
      amount: invoice.amount,
      currency: invoice.currency,
      dueDate: invoice.dueDate,
      status: invoice.status,
    });
  });

  app.post("/api/public/billing/invoice/:token/initiate", async (req, res) => {
    const token = req.params.token as string;
    const [invoice] = await cpDb.select({ id: tenantInvoices.id }).from(tenantInvoices).where(eq(tenantInvoices.paymentToken, token)).limit(1);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const { method, payerPhone, payerEmail } = req.body;
    if (!method || typeof method !== "string") return res.status(400).json({ message: "method is required" });

    const result = await initiatePaynowForInvoice({
      invoiceId: invoice.id,
      method,
      payerPhone,
      payerEmail,
      returnUrl: publicPayPageUrl(token),
    });
    if (!result.ok) return res.status(400).json({ message: result.error || "Payment initiation failed" });
    return res.json({ redirectUrl: result.redirectUrl });
  });

  app.post("/api/public/billing/invoice/:token/poll", async (req, res) => {
    const token = req.params.token as string;
    const [invoice] = await cpDb.select({ id: tenantInvoices.id }).from(tenantInvoices).where(eq(tenantInvoices.paymentToken, token)).limit(1);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const result = await pollInvoiceStatus(invoice.id);
    return res.json(result);
  });

  // PayNow result URL (webhook) — no auth; hash verified in handler. Always return 200
  // to avoid PayNow retries, same convention as /api/payments/paynow/result.
  app.post("/api/public/billing/paynow-result", express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await handleTenantBillingPaynowResult(req.body as Record<string, string>);
      return res.status(200).send(result.ok ? "OK" : "Error");
    } catch (err: any) {
      structuredLog("error", "Tenant billing PayNow result handler threw", { error: err?.message });
      return res.status(200).send("Error");
    }
  });
}
