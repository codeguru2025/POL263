/**
 * Platform-owner-only billing console API: global settings, plan CRUD, per-tenant
 * subscription management, invoice history, and the manual "mark as paid" escape
 * hatch. Same requireAuth+requirePlatformOwner-only convention as platform-routes.ts
 * — no permission-string variant, platform-owner-exclusive by design.
 */
import type { Express } from "express";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requirePlatformOwner } from "./auth";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
  billingPlans,
  tenantSubscriptions,
  tenantInvoices,
  billingSettings,
} from "@shared/control-plane-schema";
import { applyTenantInvoicePayment } from "./tenant-billing-service";
import { invalidateTenantModuleCache, invalidateEnforcementCache, ALL_KNOWN_MODULES } from "./module-gate";
import { structuredLog } from "./logger";
import { auditLog } from "./route-helpers";

async function requireTenant(id: string, res: any): Promise<boolean> {
  const [tenant] = await cpDb.select({ id: cpTenants.id }).from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
  if (!tenant) {
    res.status(404).json({ message: "Tenant not found" });
    return false;
  }
  return true;
}

export function registerPlatformBillingRoutes(app: Express): void {
  // ── Global settings ─────────────────────────────────────────────
  app.get("/api/platform/billing/settings", requireAuth, requirePlatformOwner, async (_req, res) => {
    const [row] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    return res.json(row || { id: "global", trialDays: 14, graceDays: 7, reminderLeadDays: 3, moduleEnforcementEnabled: false, updatedAt: null });
  });

  app.put("/api/platform/billing/settings", requireAuth, requirePlatformOwner, async (req, res) => {
    const { trialDays, graceDays, reminderLeadDays, moduleEnforcementEnabled } = req.body;
    if (trialDays !== undefined && (!Number.isInteger(trialDays) || trialDays < 0)) {
      return res.status(400).json({ message: "trialDays must be a non-negative integer" });
    }
    if (graceDays !== undefined && (!Number.isInteger(graceDays) || graceDays < 0)) {
      return res.status(400).json({ message: "graceDays must be a non-negative integer" });
    }
    if (reminderLeadDays !== undefined && (!Number.isInteger(reminderLeadDays) || reminderLeadDays < 0)) {
      return res.status(400).json({ message: "reminderLeadDays must be a non-negative integer" });
    }
    if (moduleEnforcementEnabled !== undefined && typeof moduleEnforcementEnabled !== "boolean") {
      return res.status(400).json({ message: "moduleEnforcementEnabled must be a boolean" });
    }

    const [existing] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (trialDays !== undefined) patch.trialDays = trialDays;
    if (graceDays !== undefined) patch.graceDays = graceDays;
    if (reminderLeadDays !== undefined) patch.reminderLeadDays = reminderLeadDays;
    if (moduleEnforcementEnabled !== undefined) patch.moduleEnforcementEnabled = moduleEnforcementEnabled;

    if (existing) {
      await cpDb.update(billingSettings).set(patch).where(eq(billingSettings.id, "global"));
    } else {
      await cpDb.insert(billingSettings).values({ id: "global", ...patch });
    }
    invalidateEnforcementCache();
    const [after] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    structuredLog("warn", "Billing settings changed by platform owner", { patch });
    await auditLog(req, "UPDATE_BILLING_SETTINGS", "BillingSettings", "global", existing || null, after);
    return res.json(after);
  });

  // ── Plans ────────────────────────────────────────────────────────
  app.get("/api/platform/billing/plans", requireAuth, requirePlatformOwner, async (_req, res) => {
    const plans = await cpDb.select().from(billingPlans).orderBy(billingPlans.sortOrder);
    return res.json({ knownModules: ALL_KNOWN_MODULES, plans });
  });

  app.post("/api/platform/billing/plans", requireAuth, requirePlatformOwner, async (req, res) => {
    const { key, name, description, priceMonthlyUsd, modules, sortOrder } = req.body;
    if (!key || typeof key !== "string") return res.status(400).json({ message: "key is required" });
    if (!name || typeof name !== "string") return res.status(400).json({ message: "name is required" });
    const price = parseFloat(priceMonthlyUsd);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "priceMonthlyUsd must be a non-negative number" });
    const moduleList = Array.isArray(modules) ? modules.filter((m) => typeof m === "string") : [];

    try {
      const [created] = await cpDb.insert(billingPlans).values({
        key, name, description: description || null,
        priceMonthlyUsd: String(price), modules: moduleList,
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
      }).returning();
      await auditLog(req, "CREATE_BILLING_PLAN", "BillingPlan", created.id, null, created);
      return res.status(201).json(created);
    } catch (err: any) {
      if (err?.code === "23505") return res.status(409).json({ message: "A plan with this key already exists." });
      throw err;
    }
  });

  app.patch("/api/platform/billing/plans/:id", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [existing] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "Plan not found" });

    const patch: Record<string, any> = { updatedAt: new Date() };
    const { name, description, priceMonthlyUsd, modules, isActive, sortOrder } = req.body;
    if (name !== undefined) patch.name = name;
    if (description !== undefined) patch.description = description;
    if (priceMonthlyUsd !== undefined) {
      const price = parseFloat(priceMonthlyUsd);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "priceMonthlyUsd must be a non-negative number" });
      patch.priceMonthlyUsd = String(price);
    }
    if (modules !== undefined) patch.modules = Array.isArray(modules) ? modules.filter((m: any) => typeof m === "string") : [];
    if (isActive !== undefined) patch.isActive = !!isActive;
    if (sortOrder !== undefined && Number.isInteger(sortOrder)) patch.sortOrder = sortOrder;

    await cpDb.update(billingPlans).set(patch).where(eq(billingPlans.id, id));
    const [after] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, id)).limit(1);
    // Every tenant on this plan needs its module-gate cache invalidated so a module
    // change takes effect immediately rather than waiting out the 5-minute TTL.
    const subs = await cpDb.select({ tenantId: tenantSubscriptions.tenantId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.planId, id));
    for (const s of subs) invalidateTenantModuleCache(s.tenantId);
    await auditLog(req, "UPDATE_BILLING_PLAN", "BillingPlan", id, existing, after);
    return res.json(after);
  });

  app.delete("/api/platform/billing/plans/:id", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [inUse] = await cpDb.select({ id: tenantSubscriptions.id }).from(tenantSubscriptions).where(eq(tenantSubscriptions.planId, id)).limit(1);
    if (inUse) {
      // Never hard-delete a plan with subscribers — historical invoices reference it.
      await cpDb.update(billingPlans).set({ isActive: false, updatedAt: new Date() }).where(eq(billingPlans.id, id));
      await auditLog(req, "RETIRE_BILLING_PLAN", "BillingPlan", id, null, { isActive: false });
      return res.json({ retired: true });
    }
    await cpDb.delete(billingPlans).where(eq(billingPlans.id, id));
    await auditLog(req, "DELETE_BILLING_PLAN", "BillingPlan", id, { id }, null);
    return res.status(204).send();
  });

  // ── Per-tenant subscription ─────────────────────────────────────
  app.get("/api/platform/tenants/:id/subscription", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [subscription] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    if (!subscription) return res.json({ subscription: null, plan: null });
    const [plan] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, subscription.planId)).limit(1);
    return res.json({ subscription, plan: plan || null });
  });

  app.put("/api/platform/tenants/:id/subscription", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { planId, graceDaysOverride, status } = req.body;

    const [existing] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "No subscription exists for this tenant yet" });

    const patch: Record<string, any> = { updatedAt: new Date() };
    if (planId !== undefined) {
      const [plan] = await cpDb.select({ id: billingPlans.id }).from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
      if (!plan) return res.status(400).json({ message: "Plan not found" });
      patch.planId = planId;
    }
    if (graceDaysOverride !== undefined) {
      if (graceDaysOverride !== null && (!Number.isInteger(graceDaysOverride) || graceDaysOverride < 0)) {
        return res.status(400).json({ message: "graceDaysOverride must be a non-negative integer or null" });
      }
      patch.graceDaysOverride = graceDaysOverride;
    }
    if (status !== undefined) {
      const VALID = new Set(["trialing", "active", "past_due", "suspended", "cancelled"]);
      if (!VALID.has(status)) return res.status(400).json({ message: `status must be one of: ${Array.from(VALID).join(", ")}` });
      patch.status = status;
    }

    await cpDb.update(tenantSubscriptions).set(patch).where(eq(tenantSubscriptions.tenantId, id));
    const [after] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    invalidateTenantModuleCache(id);
    await auditLog(req, "UPDATE_TENANT_SUBSCRIPTION", "TenantSubscription", id, existing, after, id);
    return res.json(after);
  });

  // ── Invoices ─────────────────────────────────────────────────────
  app.get("/api/platform/tenants/:id/invoices", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const invoices = await cpDb.select().from(tenantInvoices).where(eq(tenantInvoices.tenantId, id)).orderBy(desc(tenantInvoices.issuedAt));
    return res.json(invoices);
  });

  app.post("/api/platform/tenants/:id/invoices/:invoiceId/mark-paid", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const invoiceId = req.params.invoiceId as string;
    const reason = String(req.body?.reason || "").trim();
    if (!reason) return res.status(400).json({ message: "A reason is required for manually marking an invoice as paid" });

    const [invoice] = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.id, invoiceId), eq(tenantInvoices.tenantId, id))).limit(1);
    if (!invoice) return res.status(404).json({ message: "Invoice not found" });

    const actorId = (req.user as any)?.id;
    const result = await applyTenantInvoicePayment(invoiceId, { source: "manual", actorId, note: reason });
    if (!result.ok) return res.status(400).json({ message: result.error || "Failed to mark invoice as paid" });

    await auditLog(req, "MANUAL_MARK_INVOICE_PAID", "TenantInvoice", invoiceId, invoice, { status: "paid", reason }, id);
    return res.json({ ok: true });
  });

  // ── Manual sweep trigger (testing/on-demand) ────────────────────
  app.post("/api/platform/billing/sweep", requireAuth, requirePlatformOwner, async (_req, res) => {
    try {
      const { runTenantBillingSweep } = await import("./tenant-billing-sweep");
      const result = await runTenantBillingSweep("manual");
      return res.json(result);
    } catch (err: any) {
      structuredLog("error", "Manual billing sweep failed", { error: err?.message });
      return res.status(500).json({ message: "Sweep failed. Check logs for details." });
    }
  });
}
