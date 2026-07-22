/**
 * Single source of truth for "what should this tenant's UI show" — nav, reports, dashboards,
 * and (once built) the product builders all consult this instead of hardcoding funeral/fleet/
 * payroll assumptions or checking permissions as a proxy for business relevance.
 *
 * Two independent axes, matching the onboarding design:
 *   - productTypes (organizations.productTypes) — what the tenant sells, drives which product
 *     builder(s) (risk vs accumulation) are relevant.
 *   - modules (billing plan modules + platform-owner overrides, via getTenantModuleSet) — which
 *     operational areas (funeral ops, fleet, payroll, claims) the tenant actually runs.
 *
 * Fail-open for unprofiled tenants (isProfiled: false) — same convention as hasModule()'s
 * "no subscription row" case. A tenant that predates onboarding (i.e. Falakhe, until explicitly
 * backfilled) must never have its nav/reports silently collapse to nothing.
 */
import { db } from "./db";
import { organizations } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getTenantModuleSet, type ModuleKey } from "./module-gate";
import { PRODUCT_TYPE_ENGINE, type OrgType, type ProductType } from "@shared/org-profile";

export interface TenantCapabilities {
  isProfiled: boolean;
  orgType: OrgType | null;
  productTypes: ProductType[];
  modules: Set<string>;
  hasRiskProducts: boolean;
  hasAccumulationProducts: boolean;
}

export async function getTenantCapabilities(orgId: string | undefined): Promise<TenantCapabilities> {
  if (!orgId) {
    return {
      isProfiled: false, orgType: null, productTypes: [],
      modules: new Set(), hasRiskProducts: true, hasAccumulationProducts: true,
    };
  }

  const [org] = await db
    .select({ orgType: organizations.orgType, productTypes: organizations.productTypes })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);

  const isProfiled = !!org?.orgType;
  const productTypes = (org?.productTypes ?? []) as ProductType[];
  const modules = await getTenantModuleSet(orgId);

  return {
    isProfiled,
    orgType: (org?.orgType as OrgType) ?? null,
    productTypes,
    modules,
    // Unprofiled tenants fail open — show both engines' surfaces rather than guess.
    hasRiskProducts: !isProfiled || productTypes.some((t) => PRODUCT_TYPE_ENGINE[t] === "risk"),
    hasAccumulationProducts: !isProfiled || productTypes.some((t) => PRODUCT_TYPE_ENGINE[t] === "accumulation"),
  };
}

export function hasModuleCapability(caps: TenantCapabilities, moduleKey: ModuleKey): boolean {
  return !caps.isProfiled || caps.modules.has(moduleKey);
}
