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
  billingFeatures,
  tenantSubscriptions,
  tenantInvoices,
  billingSettings,
} from "@shared/control-plane-schema";
import { applyTenantInvoicePayment } from "./tenant-billing-service";
import { invalidateTenantModuleCache, invalidateEnforcementCache, ALL_KNOWN_MODULES } from "./module-gate";
import { invalidateBillingModelCache } from "./platform-fee";
import { structuredLog } from "./logger";
import { auditLog } from "./route-helpers";

const BILLING_MODELS = new Set(["flat", "per_policy", "revenue_share"]);

/** Parse a "0.00"-style money/percent string; returns null if absent, throws a message string if invalid. */
function parseOptionalDecimal(v: unknown, field: string, opts: { min?: number; max?: number } = {}): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const n = parseFloat(String(v));
  const min = opts.min ?? 0;
  if (!Number.isFinite(n) || n < min || (opts.max !== undefined && n > opts.max)) {
    throw `${field} must be a number${opts.max !== undefined ? ` between ${min} and ${opts.max}` : ` ≥ ${min}`}, or blank`;
  }
  return n.toFixed(2);
}

/** Validate a { status: "0.10" } per-policy rate map. */
function parsePerStatusRates(v: unknown): Record<string, string> | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "object" || Array.isArray(v)) throw "perStatusRates must be an object of { status: ratePerPolicy }";
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n) || n < 0) throw `perStatusRates.${k} must be a non-negative number`;
    out[k] = n.toFixed(4);
  }
  return out;
}

/** Pull the billing-model columns (0005) out of a plan create/update body. Only keys that are
 *  present are returned, so PATCH stays partial. Throws a message string on invalid input. */
function parsePlanBillingModelFields(body: Record<string, unknown>): Record<string, any> {
  const out: Record<string, any> = {};
  if (body.billingModel !== undefined) {
    if (!BILLING_MODELS.has(String(body.billingModel))) throw `billingModel must be one of: ${Array.from(BILLING_MODELS).join(", ")}`;
    out.billingModel = String(body.billingModel);
  }
  const baseFee = parseOptionalDecimal(body.baseFeeUsd, "baseFeeUsd");
  if (baseFee !== undefined) out.baseFeeUsd = baseFee;
  const revShare = parseOptionalDecimal(body.revenueSharePercent, "revenueSharePercent", { max: 100 });
  if (revShare !== undefined) out.revenueSharePercent = revShare;
  const monthlyMin = parseOptionalDecimal(body.monthlyMinimumUsd, "monthlyMinimumUsd");
  if (monthlyMin !== undefined) out.monthlyMinimumUsd = monthlyMin ?? "0.00";
  const setupFee = parseOptionalDecimal(body.setupFeeUsd, "setupFeeUsd");
  if (setupFee !== undefined) out.setupFeeUsd = setupFee;
  if (body.includedPolicyUnits !== undefined) {
    const n = Number(body.includedPolicyUnits);
    if (!Number.isInteger(n) || n < 0) throw "includedPolicyUnits must be a non-negative integer";
    out.includedPolicyUnits = n;
  }
  const rates = parsePerStatusRates(body.perStatusRates);
  if (rates !== undefined) out.perStatusRates = rates;
  return out;
}

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
    return res.json(row || { id: "global", trialDays: 14, graceDays: 7, reminderLeadDays: 3, moduleEnforcementEnabled: false, platformFeeRatePercent: "2.50", updatedAt: null });
  });

  app.put("/api/platform/billing/settings", requireAuth, requirePlatformOwner, async (req, res) => {
    const { trialDays, graceDays, reminderLeadDays, moduleEnforcementEnabled, platformFeeRatePercent } = req.body;
    let defaultMonthlyMinimumUsd: string | null | undefined;
    let defaultOutstandingFeeCapUsd: string | null | undefined;
    const { deletionGraceDays } = req.body;
    try {
      defaultMonthlyMinimumUsd = parseOptionalDecimal(req.body.defaultMonthlyMinimumUsd, "defaultMonthlyMinimumUsd");
      defaultOutstandingFeeCapUsd = parseOptionalDecimal(req.body.defaultOutstandingFeeCapUsd, "defaultOutstandingFeeCapUsd");
    } catch (msg) {
      return res.status(400).json({ message: String(msg) });
    }
    if (deletionGraceDays !== undefined && (!Number.isInteger(deletionGraceDays) || deletionGraceDays < 1)) {
      return res.status(400).json({ message: "deletionGraceDays must be a positive integer" });
    }
    const { hardDeleteEnabled } = req.body;
    if (hardDeleteEnabled !== undefined && typeof hardDeleteEnabled !== "boolean") {
      return res.status(400).json({ message: "hardDeleteEnabled must be a boolean" });
    }
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
    let feeRate: number | undefined;
    if (platformFeeRatePercent !== undefined) {
      feeRate = parseFloat(platformFeeRatePercent);
      if (!Number.isFinite(feeRate) || feeRate < 0 || feeRate > 100) {
        return res.status(400).json({ message: "platformFeeRatePercent must be a number between 0 and 100" });
      }
    }

    const [existing] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (trialDays !== undefined) patch.trialDays = trialDays;
    if (graceDays !== undefined) patch.graceDays = graceDays;
    if (reminderLeadDays !== undefined) patch.reminderLeadDays = reminderLeadDays;
    if (moduleEnforcementEnabled !== undefined) patch.moduleEnforcementEnabled = moduleEnforcementEnabled;
    if (feeRate !== undefined) patch.platformFeeRatePercent = feeRate.toFixed(2);
    if (defaultMonthlyMinimumUsd !== undefined) patch.defaultMonthlyMinimumUsd = defaultMonthlyMinimumUsd;
    if (defaultOutstandingFeeCapUsd !== undefined) patch.defaultOutstandingFeeCapUsd = defaultOutstandingFeeCapUsd;
    if (deletionGraceDays !== undefined) patch.deletionGraceDays = deletionGraceDays;
    if (hardDeleteEnabled !== undefined) patch.hardDeleteEnabled = hardDeleteEnabled;

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
    const [plans, features] = await Promise.all([
      cpDb.select().from(billingPlans).orderBy(billingPlans.sortOrder),
      cpDb.select().from(billingFeatures).orderBy(billingFeatures.name),
    ]);
    return res.json({ knownModules: ALL_KNOWN_MODULES, plans, features });
  });

  // ── Feature price-delta catalog (billing_features) ───────────────
  app.patch("/api/platform/billing/features/:id", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [existing] = await cpDb.select().from(billingFeatures).where(eq(billingFeatures.id, id)).limit(1);
    if (!existing) return res.status(404).json({ message: "Feature not found" });

    const patch: Record<string, any> = { updatedAt: new Date() };
    const { name, description, isActive } = req.body;
    if (name !== undefined) patch.name = String(name);
    if (description !== undefined) patch.description = description ? String(description) : null;
    if (isActive !== undefined) patch.isActive = !!isActive;
    try {
      const bd = parseOptionalDecimal(req.body.baseFeeDeltaUsd, "baseFeeDeltaUsd");
      if (bd !== undefined) patch.baseFeeDeltaUsd = bd ?? "0";
      const rd = parseOptionalDecimal(req.body.revenueSharePercentDelta, "revenueSharePercentDelta", { max: 100 });
      if (rd !== undefined) patch.revenueSharePercentDelta = rd ?? "0";
      if (req.body.perPolicyRateDeltaUsd !== undefined) {
        const n = parseFloat(String(req.body.perPolicyRateDeltaUsd));
        if (!Number.isFinite(n) || n < 0) return res.status(400).json({ message: "perPolicyRateDeltaUsd must be a non-negative number" });
        patch.perPolicyRateDeltaUsd = n.toFixed(4);
      }
    } catch (msg) {
      return res.status(400).json({ message: String(msg) });
    }

    await cpDb.update(billingFeatures).set(patch).where(eq(billingFeatures.id, id));
    const [after] = await cpDb.select().from(billingFeatures).where(eq(billingFeatures.id, id)).limit(1);
    await auditLog(req, "UPDATE_BILLING_FEATURE", "BillingFeature", id, existing, after);
    return res.json(after);
  });

  app.post("/api/platform/billing/plans", requireAuth, requirePlatformOwner, async (req, res) => {
    const { key, name, description, priceMonthlyUsd, modules, sortOrder } = req.body;
    if (!key || typeof key !== "string") return res.status(400).json({ message: "key is required" });
    if (!name || typeof name !== "string") return res.status(400).json({ message: "name is required" });
    const price = parseFloat(priceMonthlyUsd);
    if (!Number.isFinite(price) || price < 0) return res.status(400).json({ message: "priceMonthlyUsd must be a non-negative number" });
    const moduleList = Array.isArray(modules) ? modules.filter((m) => typeof m === "string") : [];
    const unknownModules = moduleList.filter((m) => !(ALL_KNOWN_MODULES as readonly string[]).includes(m));
    if (unknownModules.length > 0) return res.status(400).json({ message: `Unknown module key(s): ${unknownModules.join(", ")}` });

    let modelFields: Record<string, any>;
    try {
      modelFields = parsePlanBillingModelFields(req.body);
    } catch (msg) {
      return res.status(400).json({ message: String(msg) });
    }

    try {
      const [created] = await cpDb.insert(billingPlans).values({
        key, name, description: description || null,
        priceMonthlyUsd: String(price), modules: moduleList,
        sortOrder: Number.isInteger(sortOrder) ? sortOrder : 0,
        ...modelFields,
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
    if (modules !== undefined) {
      const moduleList = Array.isArray(modules) ? modules.filter((m: any) => typeof m === "string") : [];
      const unknownModules = moduleList.filter((m: string) => !(ALL_KNOWN_MODULES as readonly string[]).includes(m));
      if (unknownModules.length > 0) return res.status(400).json({ message: `Unknown module key(s): ${unknownModules.join(", ")}` });
      patch.modules = moduleList;
    }
    if (isActive !== undefined) patch.isActive = !!isActive;
    if (sortOrder !== undefined && Number.isInteger(sortOrder)) patch.sortOrder = sortOrder;
    try {
      Object.assign(patch, parsePlanBillingModelFields(req.body));
    } catch (msg) {
      return res.status(400).json({ message: String(msg) });
    }

    await cpDb.update(billingPlans).set(patch).where(eq(billingPlans.id, id));
    const [after] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, id)).limit(1);
    // Every tenant on this plan needs its module-gate cache invalidated so a module
    // change takes effect immediately rather than waiting out the 5-minute TTL.
    const subs = await cpDb.select({ tenantId: tenantSubscriptions.tenantId }).from(tenantSubscriptions).where(eq(tenantSubscriptions.planId, id));
    for (const s of subs) { invalidateTenantModuleCache(s.tenantId); invalidateBillingModelCache(s.tenantId); }
    await auditLog(req, "UPDATE_BILLING_PLAN", "BillingPlan", id, existing, after);
    return res.json(after);
  });

  app.delete("/api/platform/billing/plans/:id", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    // Check both tables that FK to billingPlans.id — a plan can have zero current
    // subscriptions but still be referenced by a historical (already-paid) invoice
    // if a tenant was since reassigned to a different plan.
    const [subscriberRow] = await cpDb.select({ id: tenantSubscriptions.id }).from(tenantSubscriptions).where(eq(tenantSubscriptions.planId, id)).limit(1);
    const [invoiceRow] = await cpDb.select({ id: tenantInvoices.id }).from(tenantInvoices).where(eq(tenantInvoices.planId, id)).limit(1);
    if (subscriberRow || invoiceRow) {
      // Never hard-delete a plan with subscribers or invoice history referencing it.
      await cpDb.update(billingPlans).set({ isActive: false, updatedAt: new Date() }).where(eq(billingPlans.id, id));
      await auditLog(req, "RETIRE_BILLING_PLAN", "BillingPlan", id, null, { isActive: false });
      return res.json({ retired: true });
    }
    try {
      await cpDb.delete(billingPlans).where(eq(billingPlans.id, id));
      await auditLog(req, "DELETE_BILLING_PLAN", "BillingPlan", id, { id }, null);
      return res.status(204).send();
    } catch (err: any) {
      // Safety net for the check-then-act race (a subscription/invoice created between
      // the checks above and this delete) — same 23505 pattern used elsewhere in this
      // file, but for the foreign_key_violation code instead.
      if (err?.code === "23503") {
        await cpDb.update(billingPlans).set({ isActive: false, updatedAt: new Date() }).where(eq(billingPlans.id, id));
        await auditLog(req, "RETIRE_BILLING_PLAN", "BillingPlan", id, null, { isActive: false });
        return res.json({ retired: true });
      }
      throw err;
    }
  });

  // ── Per-tenant subscription ─────────────────────────────────────
  app.get("/api/platform/tenants/:id/subscription", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [subscription] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    if (!subscription) return res.json({ subscription: null, plan: null, effectivePricing: null });
    const [plan] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, subscription.planId)).limit(1);

    let effectivePricing = null;
    if (plan) {
      try {
        const { resolveEffectivePricing } = await import("./billing-model-math");
        const { getTenantModuleSet } = await import("./module-gate");
        const [moduleSet, allFeatures, settingsRow] = await Promise.all([
          getTenantModuleSet(id),
          cpDb.select().from(billingFeatures).where(eq(billingFeatures.isActive, true)),
          cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1),
        ]);
        const s = settingsRow[0];
        effectivePricing = resolveEffectivePricing(
          plan,
          allFeatures.filter((f) => moduleSet.has(f.key)),
          subscription,
          {
            platformFeeRatePercent: s?.platformFeeRatePercent ?? null,
            defaultMonthlyMinimumUsd: s?.defaultMonthlyMinimumUsd ?? null,
            defaultOutstandingFeeCapUsd: s?.defaultOutstandingFeeCapUsd ?? null,
          },
        );
      } catch (err: any) {
        structuredLog("error", "effective pricing preview failed", { tenantId: id, error: err?.message });
      }
    }
    return res.json({ subscription, plan: plan || null, effectivePricing });
  });

  // Tenants created before billing existed (or whose auto-trial insert failed soft
  // because no plan had been seeded yet — see the CREATE_ORGANIZATION handler) have no
  // subscription row at all, and PUT below requires one to already exist. This is the
  // only way to give such a tenant its first subscription.
  app.post("/api/platform/tenants/:id/subscription", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { planId, status } = req.body;

    const [existing] = await cpDb.select({ id: tenantSubscriptions.id }).from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    if (existing) return res.status(409).json({ message: "This tenant already has a subscription — use PUT to change it." });

    const [plan] = await cpDb.select({ id: billingPlans.id }).from(billingPlans).where(eq(billingPlans.id, planId)).limit(1);
    if (!plan) return res.status(400).json({ message: "Plan not found" });

    const VALID_STATUS = new Set(["trialing", "active", "past_due", "suspended", "cancelled"]);
    const initialStatus = status !== undefined && VALID_STATUS.has(status) ? status : "active";

    const [settings] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    const now = new Date();
    const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const trialEndsAt = initialStatus === "trialing"
      ? new Date(now.getTime() + (settings?.trialDays ?? 14) * 24 * 60 * 60 * 1000)
      : null;

    const [created] = await cpDb.insert(tenantSubscriptions).values({
      tenantId: id,
      planId,
      status: initialStatus,
      trialEndsAt,
      currentPeriodStart: now,
      currentPeriodEnd: trialEndsAt ?? periodEnd,
    }).returning();
    invalidateTenantModuleCache(id);
    await auditLog(req, "CREATE_TENANT_SUBSCRIPTION", "TenantSubscription", created.id, null, created, id);
    return res.status(201).json(created);
  });

  app.put("/api/platform/tenants/:id/subscription", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    if (!(await requireTenant(id, res))) return;
    const { planId, graceDaysOverride, platformFeeRateOverride, status } = req.body;

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
    if (platformFeeRateOverride !== undefined) {
      if (platformFeeRateOverride !== null) {
        const rate = parseFloat(platformFeeRateOverride);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
          return res.status(400).json({ message: "platformFeeRateOverride must be a number between 0 and 100, or null" });
        }
        patch.platformFeeRateOverride = rate.toFixed(2);
      } else {
        patch.platformFeeRateOverride = null;
      }
    }
    if (status !== undefined) {
      const VALID = new Set(["trialing", "active", "past_due", "suspended", "cancelled"]);
      if (!VALID.has(status)) return res.status(400).json({ message: `status must be one of: ${Array.from(VALID).join(", ")}` });
      patch.status = status;
    }

    // Per-tenant billing-model overrides (0005) — null on any of them = "inherit the plan".
    try {
      if (req.body.billingModelOverride !== undefined) {
        const m = req.body.billingModelOverride;
        if (m !== null && !BILLING_MODELS.has(String(m))) throw `billingModelOverride must be one of: ${Array.from(BILLING_MODELS).join(", ")}, or null`;
        patch.billingModelOverride = m === null ? null : String(m);
      }
      const baseFeeOverride = parseOptionalDecimal(req.body.baseFeeOverrideUsd, "baseFeeOverrideUsd");
      if (baseFeeOverride !== undefined) patch.baseFeeOverrideUsd = baseFeeOverride;
      const minOverride = parseOptionalDecimal(req.body.monthlyMinimumOverrideUsd, "monthlyMinimumOverrideUsd");
      if (minOverride !== undefined) patch.monthlyMinimumOverrideUsd = minOverride;
      const capOverride = parseOptionalDecimal(req.body.outstandingFeeCapUsd, "outstandingFeeCapUsd");
      if (capOverride !== undefined) patch.outstandingFeeCapUsd = capOverride;
      const setupOverride = parseOptionalDecimal(req.body.setupFeeOverrideUsd, "setupFeeOverrideUsd");
      if (setupOverride !== undefined) patch.setupFeeOverrideUsd = setupOverride;
      if (req.body.includedPolicyUnitsOverride !== undefined) {
        const v = req.body.includedPolicyUnitsOverride;
        if (v === null) patch.includedPolicyUnitsOverride = null;
        else {
          const n = Number(v);
          if (!Number.isInteger(n) || n < 0) throw "includedPolicyUnitsOverride must be a non-negative integer or null";
          patch.includedPolicyUnitsOverride = n;
        }
      }
      const ratesOverride = parsePerStatusRates(req.body.perStatusRatesOverride);
      if (ratesOverride !== undefined) patch.perStatusRatesOverride = ratesOverride;
    } catch (msg) {
      return res.status(400).json({ message: String(msg) });
    }

    await cpDb.update(tenantSubscriptions).set(patch).where(eq(tenantSubscriptions.tenantId, id));
    const [after] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    invalidateTenantModuleCache(id);
    invalidateBillingModelCache(id);
    await auditLog(req, "UPDATE_TENANT_SUBSCRIPTION", "TenantSubscription", id, existing, after, id);
    return res.json(after);
  });

  // ── Permanent deletion (Phase 6) ────────────────────────────────
  app.post("/api/platform/tenants/:id/purge", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [tenant] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, id)).limit(1);
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });
    if (tenant.licenseStatus === "purged") return res.status(409).json({ message: "This tenant has already been purged" });

    // Typed-confirmation guard — the request body must echo the tenant's exact name.
    if (String(req.body?.confirmName || "").trim() !== tenant.name.trim()) {
      return res.status(400).json({ message: `Type the tenant's exact name ("${tenant.name}") to confirm permanent deletion` });
    }
    if (tenant.isActive) {
      return res.status(400).json({ message: "Suspend the tenant first — only suspended tenants can be purged" });
    }

    const { purgeTenant } = await import("./tenant-purge");
    const result = await purgeTenant(id, { actorEmail: (req.user as any)?.email });
    await auditLog(req, "PURGE_TENANT", "Tenant", id, { name: tenant.name }, result as any, id);
    structuredLog("warn", "Tenant purged by platform owner", { tenantId: id, actor: (req.user as any)?.email, result });
    return res.json(result);
  });

  // ── Setup fee ────────────────────────────────────────────────────
  app.post("/api/platform/tenants/:id/setup-fee/waive", requireAuth, requirePlatformOwner, async (req, res) => {
    const id = req.params.id as string;
    const [sub] = await cpDb.select().from(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, id)).limit(1);
    if (!sub) return res.status(404).json({ message: "No subscription exists for this tenant" });
    if (sub.setupFeeStatus === "paid") return res.status(409).json({ message: "Setup fee has already been paid" });

    // Void any open setup invoice, then mark waived.
    await cpDb.update(tenantInvoices)
      .set({ status: "void", updatedAt: new Date() })
      .where(and(eq(tenantInvoices.tenantId, id), eq(tenantInvoices.kind, "setup"), eq(tenantInvoices.status, "open")));
    await cpDb.update(tenantSubscriptions)
      .set({ setupFeeStatus: "waived", updatedAt: new Date() })
      .where(eq(tenantSubscriptions.tenantId, id));
    await auditLog(req, "WAIVE_SETUP_FEE", "TenantSubscription", id, { setupFeeStatus: sub.setupFeeStatus }, { setupFeeStatus: "waived" }, id);
    return res.json({ ok: true, setupFeeStatus: "waived" });
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

  // ── Platform's own finances ─────────────────────────────────────
  app.get("/api/platform/billing/finance-overview", requireAuth, requirePlatformOwner, async (_req, res) => {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [plans, subs, invoices, settingsRow] = await Promise.all([
      cpDb.select().from(billingPlans),
      cpDb.select().from(tenantSubscriptions),
      cpDb.select().from(tenantInvoices),
      cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1),
    ]);
    const tenantRows = await cpDb.select({ id: cpTenants.id, name: cpTenants.name }).from(cpTenants);
    const tenantName = new Map(tenantRows.map((t) => [t.id, t.name]));
    const planById = new Map(plans.map((p) => [p.id, p]));
    const s = settingsRow[0];
    const globalMin = parseFloat(String(s?.defaultMonthlyMinimumUsd ?? "250"));

    const num = (v: unknown) => { const n = parseFloat(String(v ?? "0")); return Number.isFinite(n) ? n : 0; };

    // Collected
    const paid = invoices.filter((i) => i.status === "paid" && i.paidAt);
    const sum = (arr: typeof invoices) => arr.reduce((a, i) => a + num(i.amount), 0);
    const collected = {
      last30d: sum(paid.filter((i) => new Date(i.paidAt!) >= d30)),
      thisMonth: sum(paid.filter((i) => new Date(i.paidAt!) >= monthStart)),
      allTime: sum(paid),
      count: paid.length,
    };

    // Outstanding + aging
    const open = invoices.filter((i) => i.status === "open");
    const aging = { current: 0, d1_7: 0, d8_30: 0, d30plus: 0 };
    for (const i of open) {
      const daysOverdue = Math.floor((now.getTime() - new Date(i.dueDate).getTime()) / (24 * 60 * 60 * 1000));
      const amt = num(i.amount);
      if (daysOverdue <= 0) aging.current += amt;
      else if (daysOverdue <= 7) aging.d1_7 += amt;
      else if (daysOverdue <= 30) aging.d8_30 += amt;
      else aging.d30plus += amt;
    }
    const outstanding = { total: sum(open), count: open.length, aging };

    // Per-model rollup + MRR estimate
    const lastInvoiceBySub = new Map<string, typeof invoices[number]>();
    for (const i of [...invoices].sort((a, b) => new Date(a.issuedAt).getTime() - new Date(b.issuedAt).getTime())) {
      if (i.subscriptionId) lastInvoiceBySub.set(i.subscriptionId, i);
    }
    const models = ["flat", "per_policy", "revenue_share"] as const;
    const byModel = Object.fromEntries(models.map((m) => [m, { tenants: 0, mrrEstimate: 0, outstanding: 0 }])) as Record<string, { tenants: number; mrrEstimate: number; outstanding: number }>;
    let mrrEstimate = 0;
    for (const sub of subs) {
      if (!["active", "trialing", "past_due"].includes(sub.status)) continue;
      const plan = planById.get(sub.planId);
      const model = (sub.billingModelOverride || plan?.billingModel || "flat") as string;
      const bucket = byModel[model] ?? byModel.flat;
      bucket.tenants++;
      const recent = lastInvoiceBySub.get(sub.id);
      const recentFresh = recent && new Date(recent.issuedAt) >= new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
      let estimate: number;
      if (recentFresh) estimate = num(recent!.amount);
      else if (model === "flat") estimate = num(sub.baseFeeOverrideUsd ?? plan?.baseFeeUsd ?? plan?.priceMonthlyUsd);
      else estimate = num(sub.monthlyMinimumOverrideUsd ?? plan?.monthlyMinimumUsd ?? globalMin);
      bucket.mrrEstimate += estimate;
      mrrEstimate += estimate;
    }
    for (const i of open) {
      const sub = subs.find((x) => x.id === i.subscriptionId);
      const plan = sub && planById.get(sub.planId);
      const model = (sub?.billingModelOverride || plan?.billingModel || "flat") as string;
      (byModel[model] ?? byModel.flat).outstanding += num(i.amount);
    }

    // Top debtors + recent payments
    const debtByTenant = new Map<string, number>();
    for (const i of open) debtByTenant.set(i.tenantId, (debtByTenant.get(i.tenantId) ?? 0) + num(i.amount));
    const topDebtors = Array.from(debtByTenant.entries())
      .map(([id, amount]) => ({ tenantId: id, name: tenantName.get(id) ?? "—", amount: amount.toFixed(2) }))
      .sort((a, b) => parseFloat(b.amount) - parseFloat(a.amount)).slice(0, 10);
    const recentPayments = [...paid]
      .sort((a, b) => new Date(b.paidAt!).getTime() - new Date(a.paidAt!).getTime()).slice(0, 20)
      .map((i) => ({ id: i.id, tenant: tenantName.get(i.tenantId) ?? "—", kind: i.kind, amount: i.amount, currency: i.currency, paidAt: i.paidAt, manual: !!i.markedPaidBy }));

    return res.json({
      currency: "USD",
      mrrEstimate: mrrEstimate.toFixed(2),
      arrEstimate: (mrrEstimate * 12).toFixed(2),
      collected: { last30d: collected.last30d.toFixed(2), thisMonth: collected.thisMonth.toFixed(2), allTime: collected.allTime.toFixed(2), count: collected.count },
      outstanding: {
        total: outstanding.total.toFixed(2), count: outstanding.count,
        aging: { current: aging.current.toFixed(2), d1_7: aging.d1_7.toFixed(2), d8_30: aging.d8_30.toFixed(2), d30plus: aging.d30plus.toFixed(2) },
      },
      byModel: Object.fromEntries(Object.entries(byModel).map(([k, v]) => [k, { tenants: v.tenants, mrrEstimate: v.mrrEstimate.toFixed(2), outstanding: v.outstanding.toFixed(2) }])),
      topDebtors,
      recentPayments,
    });
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
