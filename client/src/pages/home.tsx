import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, UserCircle } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import AppFooter from "@/components/app-footer";
import { getDefaultLogoUrl, resolveAssetUrl } from "@/lib/assetUrl";
import { useAuth } from "@/hooks/use-auth";
import { useBranding } from "@/hooks/use-branding";
import { getApiBase } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const returnTo =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("returnTo") : null;
  const { isAuthenticated, isLoading: staffAuthLoading } = useAuth();

  // Detect whether we're on a tenant subdomain (e.g. falakhe.pol263.com).
  const { data: tenantCtx } = useQuery<{ id: string; name: string; slug: string } | null>({
    queryKey: ["/api/public/tenant-context"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/public/tenant-context", { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const tenantId = tenantCtx?.id ?? null;
  const { branding, displayName, displayLogo } = useBranding(tenantId);

  // Append ?orgId= to login links when on a tenant subdomain so those pages
  // also show the correct branding.
  const loginSuffix = tenantId ? `?orgId=${encodeURIComponent(tenantId)}` : "";

  const portals = [
    {
      title: "Staff Portal",
      description: "Manage policies, claims, funeral operations, and configure the tenant policy engine.",
      icon: Building2,
      href: `/staff/login${loginSuffix}`,
      buttonLabel: "Access Staff Portal",
      testId: "link-staff-portal",
    },
    {
      title: "Agent Portal",
      description: "Sign in to access your clients, issue policies, and manage your referral links.",
      icon: UserCircle,
      href: `/agent/login${loginSuffix}`,
      buttonLabel: "Access Agent Portal",
      testId: "link-agent-portal",
    },
    {
      title: "Client Portal",
      description: "Secure access for policyholders to view coverage, pay premiums, and update details.",
      icon: Users,
      href: `/client/login${loginSuffix}`,
      buttonLabel: "Access Client Portal",
      testId: "link-client-portal",
    },
  ];

  const { data: clientMe, isFetched: clientMeFetched } = useQuery<{ client: { id: string } | null }>({
    queryKey: ["/api/client-auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch(getApiBase() + "/api/client-auth/me", { credentials: "include" });
        if (!res.ok) return { client: null };
        return res.json();
      } catch {
        return { client: null };
      }
    },
    retry: false,
    enabled: !!returnTo?.startsWith("/client") || (typeof window !== "undefined" && !returnTo),
  });

  // After OAuth or server redirect: land on home with ?returnTo=...; redirect once auth is ready.
  useEffect(() => {
    if (returnTo && returnTo !== "/") {
      if (returnTo.startsWith("/staff") && !staffAuthLoading && isAuthenticated) {
        window.history.replaceState(null, "", window.location.pathname || "/");
        setLocation(returnTo);
      } else if (returnTo.startsWith("/client") && clientMeFetched && clientMe?.client) {
        window.history.replaceState(null, "", window.location.pathname || "/");
        setLocation(returnTo);
      }
      return;
    }
    // No returnTo: if already logged in, open the right app (staff/agent → /staff, client → /client)
    if (returnTo !== null) return; // still reading search params
    if (!staffAuthLoading && isAuthenticated) {
      setLocation("/staff");
      return;
    }
    if (clientMeFetched && clientMe?.client) {
      setLocation("/client");
    }
  }, [returnTo, staffAuthLoading, isAuthenticated, clientMeFetched, clientMe, setLocation]);

  const isRedirecting =
    (returnTo &&
      ((returnTo.startsWith("/staff") && !staffAuthLoading && isAuthenticated) ||
        (returnTo.startsWith("/client") && clientMeFetched && clientMe?.client))) ||
    (!returnTo && !staffAuthLoading && isAuthenticated) ||
    (!returnTo && clientMeFetched && !!clientMe?.client);

  if (isRedirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>
      <div className="mb-14 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <img src={displayLogo} alt={displayName} className="h-20 w-20 mb-5 rounded-2xl object-contain" fetchPriority="high" />
        <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">{displayName}</h1>
        <p className="text-muted-foreground text-lg font-medium mt-2">Insurance Management Platform</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 w-full max-w-5xl">
        {portals.map((portal) => (
          <Link key={portal.href} href={portal.href} className="block">
            <Card className="h-full flex flex-col hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 cursor-pointer group border-border/60">
              <CardHeader className="flex-1">
                <div className="h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                  <portal.icon size={28} />
                </div>
                <CardTitle className="text-xl font-display">{portal.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed min-h-[3rem]">
                  {portal.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  className="w-full h-11 font-medium shadow-sm group-hover:shadow-md transition-all bg-primary text-primary-foreground hover:bg-primary/90"
                  size="lg"
                  data-testid={portal.testId}
                >
                  {portal.buttonLabel}
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <AppFooter />
    </div>
  );
}