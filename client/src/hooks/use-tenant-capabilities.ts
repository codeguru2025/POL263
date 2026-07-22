import { useQuery } from "@tanstack/react-query";

export interface TenantCapabilities {
  isProfiled: boolean;
  orgType: string | null;
  productTypes: string[];
  modules: string[];
  hasRiskProducts: boolean;
  hasAccumulationProducts: boolean;
}

/** Single query for the tenant's business-profile capabilities — see server/org-capabilities.ts.
 *  Shared across nav, reports, and dashboard so they all read the same cached result instead of
 *  each firing their own request. */
export function useTenantCapabilities(enabled = true) {
  return useQuery<TenantCapabilities>({
    queryKey: ["/api/tenant-capabilities"],
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

/** Fail open exactly like the server resolver: while loading, or for an unprofiled tenant, a
 *  capability-gated section/nav-item stays visible rather than flashing/hiding. */
export function hasCapabilityModule(caps: TenantCapabilities | undefined, moduleKey?: string): boolean {
  return !moduleKey || !caps || !caps.isProfiled || caps.modules.includes(moduleKey);
}
