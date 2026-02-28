import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Settings,
  History,
  Building,
  LogOut,
  ChevronDown,
  Box,
  FileStack,
  Users,
  FileText,
  Loader2,
  DollarSign,
  BarChart3,
  Target,
  Bell,
  Truck,
  Layers,
  ShieldCheck,
  Stethoscope,
  BookOpen,
  Wallet2,
  UserCog,
  Copy,
  Link2,
  Building2,
  Menu,
  X,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeSwitcher } from "@/components/theme-switcher";

function ReferralLinkBox({ referralCode }: { referralCode: string }) {
  const [copied, setCopied] = useState(false);
  const referralUrl = `${window.location.origin}/join?ref=${referralCode}`;

  const copyLink = () => {
    navigator.clipboard.writeText(referralUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="mb-3 p-3 rounded-lg border bg-gradient-to-r from-primary/5 to-primary/10 space-y-2">
      <div className="flex items-center gap-2">
        <Link2 className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider text-primary">My Referral Link</span>
      </div>
      <div className="flex items-center gap-1">
        <input
          readOnly
          value={referralUrl}
          className="flex-1 text-xs bg-background border rounded px-2 py-1.5 font-mono truncate"
          data-testid="input-referral-link"
          onClick={(e) => (e.target as HTMLInputElement).select()}
        />
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={copyLink} data-testid="button-copy-referral-link">
          {copied ? <span className="text-green-600 text-xs font-medium">OK</span> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">Share this link with clients to track referrals</p>
    </div>
  );
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { user, roles, permissions, isAuthenticated, isLoading, isError: authError, logout } = useAuth();

  // Close mobile sidebar when route changes
  useEffect(() => {
    setSidebarOpen(false);
  }, [location]);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (sidebarOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

  const canManageTenants = permissions.includes("create:tenant") || permissions.includes("delete:tenant");
  const isAgent = roles.some((r) => r.name === "agent");
  const hasAny = (perms: string[]) => perms.length === 0 || perms.some((p) => permissions.includes(p));
  const hasAll = (perms: string[]) => perms.length === 0 || perms.every((p) => permissions.includes(p));

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Redirect to login when not authenticated (in effect to avoid "update during render")
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      setLocation(authError ? "/staff/login?error=session" : "/staff/login");
    }
  }, [isLoading, isAuthenticated, authError, setLocation]);

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
    enabled: isAuthenticated,
  });

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    enabled: isAuthenticated,
  });

  const { data: approvals } = useQuery<any[]>({
    queryKey: ["/api/approvals"],
    enabled: isAuthenticated,
  });

  const pendingApprovalsCount = approvals?.filter((a: any) => a.status === "pending").length || 0;

  const navGroupsRaw: { title: string; items: { href: string; label: string; icon: any; permission?: string; permissions?: string[]; badge?: number; hidden?: boolean }[] }[] = [
    {
      title: "Overview",
      items: [{ href: "/staff", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      title: "Core Operations",
      items: [
        { href: "/staff/policies", label: "Policies", icon: FileStack, permission: "read:policy" },
        { href: "/staff/clients", label: isAgent ? "My Clients" : "Leads & Clients", icon: Users, permission: "read:client" },
        { href: "/staff/claims", label: "Claims", icon: FileText, permission: "read:claim" },
        { href: "/staff/funerals", label: "Funeral Ops", icon: Truck, permission: "read:funeral_ops" },
        { href: "/staff/leads", label: "Lead Pipeline", icon: Target, permission: "read:lead" },
        { href: "/staff/groups", label: "Groups", icon: Layers, permissions: ["write:policy"] },
      ],
    },
    {
      title: "Finance",
      items: [
        { href: "/staff/finance", label: isAgent ? "My Commissions" : "Finance", icon: DollarSign, permissions: ["read:finance", "read:commission"] },
        { href: "/staff/pricebook", label: "Price Book", icon: BookOpen, permission: "write:product" },
        { href: "/staff/payroll", label: "Payroll", icon: Wallet2, permission: "read:payroll" },
        { href: "/staff/reports", label: "Reports", icon: BarChart3, permission: "read:report" },
      ],
    },
    {
      title: "Configuration",
      items: [
        { href: "/staff/products", label: "Product Builder", icon: Box, permission: "write:product" },
        { href: "/staff/notifications", label: "Notifications", icon: Bell, permission: "read:notification" },
      ],
    },
    {
      title: "System & Audit",
      items: [
        ...(canManageTenants ? [{ href: "/staff/tenants", label: "Tenants", icon: Building2 }] : []),
        { href: "/staff/users", label: "User Management", icon: UserCog, permission: "read:user" },
        { href: "/staff/approvals", label: "Approvals", icon: ShieldCheck, permission: "manage:approvals", badge: pendingApprovalsCount },
        { href: "/staff/audit", label: "Audit Logs", icon: History, permission: "read:audit_log" },
        { href: "/staff/diagnostics", label: "Diagnostics", icon: Stethoscope, permission: "read:audit_log" },
        { href: "/staff/settings", label: "Tenant Settings", icon: Settings, permission: "manage:settings" },
        { href: "/staff/settings?tab=terms", label: "Terms & Conditions", icon: FileText, permission: "manage:settings" },
      ].filter(Boolean) as { href: string; label: string; icon: any; permission?: string; permissions?: string[]; badge?: number; hidden?: boolean }[],
    },
  ];

  const navGroups = navGroupsRaw
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const perms = item.permissions ?? (item.permission ? [item.permission] : []);
        return hasAny(perms);
      }),
    }))
    .filter((group) => group.items.length > 0);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  const currentOrg = orgs?.[0];
  const currentBranch = branchesList?.[0];
  const primaryRole = roles[0]?.name || "staff";
  const initials = (user?.displayName || user?.email || "U")
    .split(/[@\s]/)
    .map((s: string) => s[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  const displayName = user?.displayName || user?.email || "User";
  const dateTimeStr = now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="min-h-screen flex bg-background">
      {/* Mobile/tablet overlay - tap to close sidebar; only when sidebar is open below lg */}
      <button
        type="button"
        aria-label="Close menu"
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity lg:hidden ${sidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-50 w-64 max-w-[85vw] lg:max-w-none border-r border-primary/20 bg-card flex flex-col shadow-[2px_0_20px_rgba(0,0,0,0.15)]
          transform transition-transform duration-200 ease-out
          lg:translate-x-0 lg:flex
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}
        `}
      >
        <div className="h-16 flex items-center justify-between px-4 border-b shrink-0">
          <div className="flex items-center min-w-0">
            <img
              src={currentOrg?.logoUrl || "/assets/logo.png"}
              alt="POL263"
              className="h-10 w-10 rounded-lg object-contain mr-2 shrink-0"
            />
            <span className="font-display font-bold text-lg tracking-tight text-foreground truncate">POL263</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden shrink-0"
            aria-label="Close menu"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <ScrollArea className="flex-1 px-4 py-6">
          <div className="space-y-6">
            {navGroups.map((group, i) => (
              <div key={i} className="space-y-1">
                <h4 className="px-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                  {group.title}
                </h4>
                {group.items.map((item) => {
                  const isActive = location === item.href || (item.href !== "/staff" && location.startsWith(`${item.href}/`));
                  return (
                    <Link key={item.href} href={item.href}>
                      <Button
                        variant={isActive ? "secondary" : "ghost"}
                        className={`w-full justify-start h-10 ${isActive ? "font-medium bg-secondary/80 text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"}`}
                        data-testid={`nav-link-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <item.icon className={`mr-3 h-5 w-5 shrink-0 ${isActive ? "text-primary" : ""}`} />
                        <span className="truncate">{item.label}</span>
                        {"badge" in item && (item as any).badge > 0 && (
                          <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px] shrink-0" data-testid={`badge-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
                            {(item as any).badge}
                          </Badge>
                        )}
                      </Button>
                    </Link>
                  );
                })}
              </div>
            ))}
          </div>
        </ScrollArea>

        <div className="p-4 border-t bg-muted/10 shrink-0">
          {user?.referralCode && (
            <ReferralLinkBox referralCode={user.referralCode} />
          )}
          <div className="flex items-center gap-3 px-2 py-2 mb-2 bg-card rounded-lg border shadow-sm">
            <Avatar className="h-9 w-9 border shrink-0">
              <AvatarImage src={user?.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.email}</p>
              <p className="text-[10px] uppercase tracking-wider font-semibold text-primary mt-0.5">
                {primaryRole}
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            data-testid="btn-logout"
            onClick={handleLogout}
          >
            <LogOut className="mr-3 h-4 w-4 shrink-0" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-h-screen lg:min-h-screen overflow-hidden bg-background min-w-0">
        <header className="h-14 md:h-16 border-b bg-card/50 backdrop-blur-sm flex items-center px-4 md:px-8 justify-between shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-2 md:gap-6 min-w-0">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden shrink-0"
              aria-label="Open menu"
              onClick={() => setSidebarOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <Building className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground font-medium shrink-0">Tenant:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2 bg-background shadow-sm border-primary/20 hover:border-primary/50 min-w-0">
                <span className="truncate max-w-[120px]">{currentOrg?.name || "Loading..."}</span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </Button>
            </div>
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <div className="h-5 w-px bg-border" />
              <span className="text-muted-foreground font-medium shrink-0">Branch:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2 bg-background shadow-sm min-w-0">
                <span className="truncate max-w-[100px]">{currentBranch?.name || "Loading..."}</span>
                <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm text-muted-foreground shrink-0">
            <span className="hidden md:inline truncate max-w-[140px]" title={user?.email}>{displayName}</span>
            <span className="hidden sm:inline font-medium text-foreground">{primaryRole}</span>
            <span className="flex items-center gap-1.5" title="Current date and time">
              <Clock className="h-4 w-4 hidden sm:block" />
              {dateTimeStr}
            </span>
            <ThemeSwitcher />
          </div>
        </header>

        <div className="flex-1 overflow-auto p-4 sm:p-6 md:p-8 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-transparent to-transparent pointer-events-none -z-10" />
          <div className="max-w-6xl mx-auto relative z-0 min-w-0">{children}</div>
        </div>
      </main>
    </div>
  );
}