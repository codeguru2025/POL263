import { apiJson } from "./client";

export interface NeutralBranding {
  name: string;
  logoUrl: string;
  primaryColor: string;
  isWhitelabeled: boolean;
}

const NEUTRAL: NeutralBranding = { name: "POL263", logoUrl: "/assets/logo.png", isWhitelabeled: false, primaryColor: "#0d9488" };

/** Pre-login: no orgId is knowable yet (policy-number login doesn't reveal the org up
 *  front, and there's no subdomain on a native app), so this shows the same neutral
 *  branding the backend itself falls back to. Same pattern as agent-app/src/api/branding.ts. */
export async function getNeutralBranding(): Promise<NeutralBranding> {
  try {
    return await apiJson<NeutralBranding>("/api/public/branding");
  } catch {
    return NEUTRAL;
  }
}
