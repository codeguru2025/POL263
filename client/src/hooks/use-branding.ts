import { useQuery } from "@tanstack/react-query";

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
  logoUrl: "/assets/logo.png",
  primaryColor: "#D4AF37",
  isWhitelabeled: false,
};

/**
 * Fetches the platform/tenant branding from the public endpoint.
 * Available without authentication — used on login, home, and splash screens.
 * When whitelabeled, all POL263 references are replaced with tenant branding.
 */
export function useBranding() {
  const { data, isLoading } = useQuery<PlatformBranding>({
    queryKey: ["/api/public/branding"],
    staleTime: 5 * 60 * 1000,
  });

  const branding = data ?? FALLBACK;
  const displayName = branding.isWhitelabeled ? branding.name : "POL263";
  const displayLogo = branding.isWhitelabeled ? branding.logoUrl : "/assets/logo.png";

  return {
    branding,
    displayName,
    displayLogo,
    isWhitelabeled: branding.isWhitelabeled,
    isLoading,
  };
}
