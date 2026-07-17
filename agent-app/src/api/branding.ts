import { apiJson } from "./client";

export interface Branding {
  name: string;
  logoUrl: string;
  primaryColor: string;
  isWhitelabeled: boolean;
}

/** Matches server/routes.ts's NEUTRAL fallback exactly (no orgId resolvable pre-login,
 *  same as the endpoint's own behavior when it can't resolve a tenant). */
const NEUTRAL: Branding = { name: "POL263", logoUrl: "/assets/logo.png", isWhitelabeled: false, primaryColor: "#0d9488" };

/** Pre-login: no orgId is knowable yet (no subdomain on a native app), so this
 *  intentionally returns the same neutral branding the backend itself falls back to. */
export async function getNeutralBranding(): Promise<Branding> {
  try {
    return await apiJson<Branding>("/api/public/branding");
  } catch {
    return NEUTRAL;
  }
}

/** Post-login: real per-org branding, once we know organizationId. */
export async function getOrgBranding(orgId: string): Promise<Branding> {
  try {
    return await apiJson<Branding>(`/api/public/branding?orgId=${encodeURIComponent(orgId)}`);
  } catch {
    return NEUTRAL;
  }
}
