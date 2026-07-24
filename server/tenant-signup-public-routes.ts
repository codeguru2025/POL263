/**
 * Unauthenticated self-serve tenant signup routes — mirrors server/billing-public-routes.ts's
 * conventions exactly: every route here is looked up ONLY by the pending signup's opaque
 * paymentToken (never by id), and this is the sole public identifier. Never add a "list
 * signups" endpoint here; that would let anyone enumerate in-progress signups.
 *
 * This is now an internet-open door that creates DB rows and initiates real PayNow charges —
 * see server/index.ts for the rate limiting applied to /api/public/tenant-signup.
 */
import type { Express } from "express";
import express from "express";
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { pendingTenantSignups, billingPlans } from "@shared/control-plane-schema";
import { storage } from "./storage";
import { ORG_TYPES, PRODUCT_TYPES, DISTRIBUTION_CHANNELS } from "@shared/org-profile";
import { createPendingSignup, initiatePendingSignupPaynow, pollPendingSignupStatus, handleSignupPaynowResult } from "./tenant-signup-service";
import { structuredLog } from "./logger";

function publicSignupPayPageUrl(token: string): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/signup/${token}/pay`;
}

export function registerTenantSignupPublicRoutes(app: Express): void {
  app.get("/api/public/billing/plans", async (_req, res) => {
    const plans = await cpDb
      .select({
        id: billingPlans.id, key: billingPlans.key, name: billingPlans.name,
        description: billingPlans.description, priceMonthlyUsd: billingPlans.priceMonthlyUsd,
        modules: billingPlans.modules, sortOrder: billingPlans.sortOrder,
      })
      .from(billingPlans)
      .where(eq(billingPlans.isActive, true))
      .orderBy(billingPlans.sortOrder);
    return res.json({ plans });
  });

  app.post("/api/public/tenant-signup", async (req, res) => {
    const {
      businessName, phone, email, website,
      orgType, productTypes, distributionChannels, bookStatus, bookSizeCurrent, bookSizeProjected12mo, staffComplement,
      adminEmail, adminDisplayName, adminPassword,
      planId, billingCycle,
    } = req.body || {};

    if (!businessName || typeof businessName !== "string") return res.status(400).json({ message: "businessName is required" });
    if (!adminEmail || typeof adminEmail !== "string") return res.status(400).json({ message: "adminEmail is required" });
    if (!adminPassword || String(adminPassword).length < 8) return res.status(400).json({ message: "A password of min 8 chars is required" });
    if (!planId || typeof planId !== "string") return res.status(400).json({ message: "planId is required" });
    const cycle = billingCycle === "annual" ? "annual" : "monthly";

    if (orgType !== undefined && orgType !== null && !(ORG_TYPES as readonly string[]).includes(orgType)) {
      return res.status(400).json({ message: `orgType must be one of: ${ORG_TYPES.join(", ")}` });
    }
    const productTypeList = Array.isArray(productTypes) ? productTypes : [];
    const unknownProducts = productTypeList.filter((t: any) => !(PRODUCT_TYPES as readonly string[]).includes(t));
    if (unknownProducts.length > 0) return res.status(400).json({ message: `Unknown product type(s): ${unknownProducts.join(", ")}` });
    const channelList = Array.isArray(distributionChannels) ? distributionChannels : [];
    const unknownChannels = channelList.filter((c: any) => !(DISTRIBUTION_CHANNELS as readonly string[]).includes(c));
    if (unknownChannels.length > 0) return res.status(400).json({ message: `Unknown distribution channel(s): ${unknownChannels.join(", ")}` });
    if (bookStatus !== undefined && bookStatus !== null && bookStatus !== "existing" && bookStatus !== "new") {
      return res.status(400).json({ message: "bookStatus must be 'existing', 'new', or omitted" });
    }

    const [plan] = await cpDb.select({ id: billingPlans.id }).from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
    if (!plan) return res.status(400).json({ message: "Unknown plan" });

    const existingAdmin = await storage.getUserByEmail(adminEmail);
    if (existingAdmin) return res.status(409).json({ message: "A user with this admin email already exists." });

    const { token } = await createPendingSignup({
      businessName, phone, email, website,
      orgType, productTypes: productTypeList, distributionChannels: channelList,
      bookStatus, bookSizeCurrent: bookSizeCurrent != null ? parseInt(bookSizeCurrent, 10) : undefined,
      bookSizeProjected12mo: bookSizeProjected12mo != null ? parseInt(bookSizeProjected12mo, 10) : undefined,
      staffComplement: staffComplement != null ? parseInt(staffComplement, 10) : undefined,
      adminEmail, adminDisplayName, adminPassword: String(adminPassword),
      planId, billingCycle: cycle,
    });
    return res.status(201).json({ token });
  });

  app.get("/api/public/tenant-signup/:token", async (req, res) => {
    const token = req.params.token as string;
    const [pending] = await cpDb.select().from(pendingTenantSignups).where(eq(pendingTenantSignups.paymentToken, token)).limit(1);
    if (!pending) return res.status(404).json({ message: "Signup not found" });

    const [plan] = await cpDb.select({ name: billingPlans.name }).from(billingPlans).where(eq(billingPlans.id, pending.planId)).limit(1);

    return res.json({
      businessName: pending.businessName,
      planName: plan?.name || "Plan",
      billingCycle: pending.billingCycle,
      amount: pending.verificationAmount,
      currency: pending.currency,
      status: pending.status,
    });
  });

  app.post("/api/public/tenant-signup/:token/initiate", async (req, res) => {
    const token = req.params.token as string;
    const [pending] = await cpDb.select({ id: pendingTenantSignups.id }).from(pendingTenantSignups).where(eq(pendingTenantSignups.paymentToken, token)).limit(1);
    if (!pending) return res.status(404).json({ message: "Signup not found" });

    const { method, payerPhone, payerEmail } = req.body;
    if (!method || typeof method !== "string") return res.status(400).json({ message: "method is required" });

    const result = await initiatePendingSignupPaynow({
      pendingId: pending.id,
      method, payerPhone, payerEmail,
      returnUrl: publicSignupPayPageUrl(token),
    });
    if (!result.ok) return res.status(400).json({ message: result.error || "Payment initiation failed" });
    return res.json({ redirectUrl: result.redirectUrl });
  });

  app.post("/api/public/tenant-signup/:token/poll", async (req, res) => {
    const token = req.params.token as string;
    const [pending] = await cpDb.select({ id: pendingTenantSignups.id }).from(pendingTenantSignups).where(eq(pendingTenantSignups.paymentToken, token)).limit(1);
    if (!pending) return res.status(404).json({ message: "Signup not found" });

    const result = await pollPendingSignupStatus(pending.id);
    return res.json(result);
  });

  // PayNow result URL (webhook) — no auth; hash verified in handler. Always return 200 to
  // avoid PayNow retries, same convention as /api/public/billing/paynow-result.
  app.post("/api/public/tenant-signup/paynow-result", express.urlencoded({ extended: false }), async (req, res) => {
    try {
      const result = await handleSignupPaynowResult(req.body as Record<string, string>);
      return res.status(200).send(result.ok ? "OK" : "Error");
    } catch (err: any) {
      structuredLog("error", "Tenant signup PayNow result handler threw", { error: err?.message });
      return res.status(200).send("Error");
    }
  });
}
