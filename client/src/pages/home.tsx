import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Building2, Users, UserCircle, ShieldCheck, Loader2, ArrowRight } from "lucide-react";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";
import { getDefaultLogoUrl, resolveAssetUrl } from "@/lib/assetUrl";
import { useAuth } from "@/hooks/use-auth";
import { useBranding } from "@/hooks/use-branding";
import { getApiBase } from "@/lib/queryClient";

export default function Home() {
  const [, setLocation] = useLocation();
  const returnTo =
    typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("returnTo") : null;
  const { isAuthenticated, isLoading: staffAuthLoading } = useAuth();
  const [orgSlug, setOrgSlug] = useState("");

  function goToOrg() {
    const value = orgSlug.trim().toLowerCase();
    if (!value || typeof window === "undefined") return;
    // This screen only renders when no tenant was resolved from the current host, so the
    // current hostname is already the base domain — a bare slug just gets it prepended.
    // A full domain pasted in (someone pasting "acme.pol263.com" wholesale) works as-is.
    const target = value.includes(".") ? value : `${value}.${window.location.hostname}`;
    window.location.href = `${window.location.protocol}//${target}${window.location.port ? `:${window.location.port}` : ""}`;
  }

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
  const { displayName, displayLogo } = useBranding(tenantId);

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
    if (returnTo !== null) return;
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

  const isAuthPending =
    (returnTo?.startsWith("/staff") && staffAuthLoading) ||
    (returnTo?.startsWith("/client") && !clientMeFetched);

  if (isRedirecting || isAuthPending) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div role="status" aria-label="Loading">
          <Loader2 className="h-8 w-8 animate-spin text-primary" aria-hidden />
          <span className="sr-only">Loading...</span>
        </div>
      </div>
    );
  }

  if (!tenantId) {
    return (
      <AppChrome center={false} mainClassName="flex flex-col flex-1">
        <div className={cn(APP_SHELL_MAX, "flex-1 flex flex-col items-center justify-center px-4 py-10")}>
          <div className="mb-10 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
            <img src={resolveAssetUrl(getDefaultLogoUrl())} alt="POL263" className="h-14 sm:h-16 w-auto max-w-[min(360px,90vw)] mb-5 object-contain object-center" fetchPriority="high" />
            <h1 className="sr-only">POL263</h1>
            <p className="text-muted-foreground text-lg font-medium">Insurance Management Platform</p>
          </div>

          <div className="w-full max-w-sm space-y-5">
            <Card className="border-border/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-base font-display">Go to your organisation</CardTitle>
                <CardDescription className="text-sm">
                  Staff, agents and clients sign in here — enter your organisation's short name.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <form
                  className="flex gap-2"
                  onSubmit={(e) => { e.preventDefault(); goToOrg(); }}
                >
                  <Input
                    value={orgSlug}
                    onChange={(e) => setOrgSlug(e.target.value)}
                    placeholder="yourorg"
                    aria-label="Organisation short name"
                    data-testid="input-org-slug"
                    className="font-mono"
                  />
                  <Button type="submit" disabled={!orgSlug.trim()} data-testid="btn-go-to-org">
                    Go <ArrowRight className="h-4 w-4 ml-1.5" />
                  </Button>
                </form>
              </CardContent>
            </Card>

            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" />
              <span>or</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <Link href="/staff/login">
              <Card className="hover:border-primary/50 hover:shadow-md transition-all duration-300 cursor-pointer group border-border/60">
                <CardContent className="py-3.5 flex items-center gap-3">
                  <div className="h-9 w-9 shrink-0 bg-primary/10 text-primary rounded-lg flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                    <ShieldCheck size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium" data-testid="link-staff-portal">Platform Owner Login</p>
                    <p className="text-xs text-muted-foreground">Platform owner access only</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          </div>
        </div>
      </AppChrome>
    );
  }

  return (
    <AppChrome
      center={false}
      mainClassName="flex flex-col flex-1"
      headerStart={(
        <span className="font-display font-semibold text-foreground truncate">{displayName}</span>
      )}
    >
      <div className={cn(APP_SHELL_MAX, "flex-1 flex flex-col items-center px-4 py-10")}>
        <div className="mb-14 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
          <img src={resolveAssetUrl(displayLogo)} alt={displayName || "Organization logo"} className="h-14 sm:h-16 w-auto max-w-[min(360px,90vw)] mb-5 object-contain object-center bg-white rounded-2xl p-2" fetchPriority="high" />
          <h1 className="sr-only">{displayName}</h1>
          <p className="text-muted-foreground text-lg font-medium">Insurance Management Platform</p>
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
                  <span
                    className="flex w-full h-11 items-center justify-center rounded-md bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm group-hover:shadow-md transition-all hover:bg-primary/90"
                    data-testid={portal.testId}
                  >
                    {portal.buttonLabel}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppChrome>
  );
}
