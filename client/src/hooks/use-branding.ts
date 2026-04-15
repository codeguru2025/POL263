import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { getDefaultLogoUrl } from "@/lib/assetUrl";

export interface PlatformBranding {
  name: string;
  logoUrl: string;
  primaryColor: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  isWhitelabeled: boolean;
}

const FALLBACK: PlatformBranding = {
  name: "POL263",
  logoUrl: getDefaultLogoUrl(),
  primaryColor: "#0d9488",
  isWhitelabeled: false,
};

function isStockOrEmptyLogoUrl(url: string | null | undefined): boolean {
  if (!url?.trim()) return true;
  const path = url.trim().split("?")[0].toLowerCase();
  return path.endsWith("/assets/logo.png");
}

/**
 * Fetches the platform/tenant branding from the public endpoint.
 * When orgId is provided (e.g. after login), returns that tenant's branding so the app
 * can show tenant name/logo when whitelabeled. Without orgId (e.g. login page), returns POL263.
 */
export function useBranding(orgId?: string | null) {
  const { data, isLoading } = useQuery<PlatformBranding>({
    queryKey: ["/api/public/branding", orgId ?? ""],
    queryFn: async () => {
      const base = getApiBase();
      const url = orgId
        ? `${base}/api/public/branding?orgId=${encodeURIComponent(orgId)}`
        : `${base}/api/public/branding`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return FALLBACK;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    enabled: true,
  });

  const branding = data ?? FALLBACK;
  const displayName = branding.isWhitelabeled ? branding.name : "POL263";
  /** Use tenant logo whenever the API returns a real URL (e.g. Spaces CDN), not only when isWhitelabeled is true. */
  const displayLogo = !isStockOrEmptyLogoUrl(branding.logoUrl) ? branding.logoUrl!.trim() : getDefaultLogoUrl();

  return {
    branding,
    displayName,
    displayLogo,
    isWhitelabeled: branding.isWhitelabeled,
    isLoading,
  };
}
