/**
 * Module gating: does this tenant's plan include a given app module?
 *
 * Resolution order: an explicit tenantFeatureFlags row for tenant+flag always wins
 * (platform-owner override) — else a trialing subscription gets everything — else
 * check the assigned plan's modules list — else (no subscription row at all) fail
 * open, same resilience convention as isTenantAccessAllowed in server/auth.ts.
 *
 * NOT mounted to any route yet — see server/routes.ts for where requireModule()
 * gets applied, gated behind billingSettings.moduleEnforcementEnabled.
 */
import type { Request, Response, NextFunction } from "express";
import { eq, and } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { billingPlans, tenantSubscriptions, tenantFeatureFlags, billingSettings } from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

export const ALL_KNOWN_MODULES = ["claims", "funeral_ops", "fleet", "payroll", "whatsapp_notifications", "mobile_payments"] as const;
export type ModuleKey = (typeof ALL_KNOWN_MODULES)[number];

interface CachedModules {
  modules: Set<string>;
  isTrialing: boolean;
  /** false only when no subscription row exists at all — distinct from a plan that
   * legitimately has an empty modules list, which must still deny ungated modules. */
  hasSubscription: boolean;
  cachedAt: number;
}

const moduleCache = new Map<string, CachedModules>();
const MODULE_CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateTenantModuleCache(orgId: string) {
  moduleCache.delete(orgId);
}

async function getTenantModules(orgId: string): Promise<CachedModules> {
  const cached = moduleCache.get(orgId);
  if (cached && Date.now() - cached.cachedAt < MODULE_CACHE_TTL_MS) return cached;

  try {
    const [row] = await cpDb
      .select({ status: tenantSubscriptions.status, modules: billingPlans.modules })
      .from(tenantSubscriptions)
      .innerJoin(billingPlans, eq(billingPlans.id, tenantSubscriptions.planId))
      .where(eq(tenantSubscriptions.tenantId, orgId))
      .limit(1);
    // No subscription row at all — tenant predates this feature, or control-plane
    // migration hasn't run for it yet. Fail open via hasSubscription:false below —
    // NOT via an empty modules Set, which a real plan can legitimately also have.
    const result: CachedModules = row
      ? { modules: new Set(row.modules as string[]), isTrialing: row.status === "trialing", hasSubscription: true, cachedAt: Date.now() }
      : { modules: new Set<string>(), isTrialing: false, hasSubscription: false, cachedAt: Date.now() };
    moduleCache.set(orgId, result);
    return result;
  } catch (err) {
    structuredLog("error", "Module gate lookup failed, failing open", { orgId, error: (err as Error).message });
    return { modules: new Set(ALL_KNOWN_MODULES), isTrialing: true, hasSubscription: false, cachedAt: Date.now() };
  }
}

/** Global kill switch — see billingSettings.moduleEnforcementEnabled. Cached inline, same TTL. */
let enforcementEnabledCache: { value: boolean; cachedAt: number } | null = null;
async function isEnforcementEnabled(): Promise<boolean> {
  if (enforcementEnabledCache && Date.now() - enforcementEnabledCache.cachedAt < MODULE_CACHE_TTL_MS) {
    return enforcementEnabledCache.value;
  }
  try {
    const [row] = await cpDb.select({ moduleEnforcementEnabled: billingSettings.moduleEnforcementEnabled }).from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
    const value = row?.moduleEnforcementEnabled ?? false;
    enforcementEnabledCache = { value, cachedAt: Date.now() };
    return value;
  } catch (err) {
    structuredLog("error", "Billing settings lookup failed, enforcement stays off", { error: (err as Error).message });
    return false;
  }
}

export function invalidateEnforcementCache() {
  enforcementEnabledCache = null;
}

export async function hasModule(orgId: string | undefined, moduleKey: string): Promise<boolean> {
  if (!orgId) return true; // no tenant scope (control-plane mode) — nothing to gate
  if (!(await isEnforcementEnabled())) return true; // global kill switch

  const override = await cpDb
    .select({ enabled: tenantFeatureFlags.enabled })
    .from(tenantFeatureFlags)
    .where(and(eq(tenantFeatureFlags.tenantId, orgId), eq(tenantFeatureFlags.flag, moduleKey)))
    .limit(1);
  if (override.length) return override[0].enabled;

  const { modules, isTrialing, hasSubscription } = await getTenantModules(orgId);
  if (isTrialing) return true;
  if (!hasSubscription) return true; // no subscription row — never lock out a pre-migration tenant
  return modules.has(moduleKey);
}

export function requireModule(moduleKey: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user as any;
    if (!user || user.isPlatformOwner) return next(); // owner bypasses, same convention as requirePermission
    const orgId = user.organizationId as string | undefined;
    if (await hasModule(orgId, moduleKey)) return next();
    return res.status(403).json({
      message: "This feature isn't included in your current plan.",
      code: "MODULE_NOT_INCLUDED",
      module: moduleKey,
    });
  };
}
