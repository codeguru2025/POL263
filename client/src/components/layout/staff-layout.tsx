import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  BarChart2,
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
  Clock,
  Check,
  Globe,
  HelpCircle,
  Archive,
  Receipt,
  Milestone,
  FileMinus,
  Landmark,
  CreditCard,
  Printer,
  LineChart,
  Zap,
  ClipboardList,
  UserCheck,
  Briefcase,
  MapPin,
  GitBranch,
  Shield,
  HeartHandshake,
  Monitor,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { useBranding } from "@/hooks/use-branding";
import { PolicySearchInput } from "@/components/policy-search-input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { resolveAssetUrl } from "@/lib/assetUrl";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import AppFooter from "@/components/app-footer";
import { APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";

type StaffNavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission?: string;
  permissions?: string[];
  badge?: number;
  agentHidden?: boolean;
  agentOnly?: boolean;
};


function StaffNavDropdown({
  label,
  items,
  prefetchForHref,
}: {
  label: string;
  items: StaffNavItem[];
  prefetchForHref: (href: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 px-2 sm:px-3 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground gap-1 shrink-0"
        >
          <span className="max-w-[140px] truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-80" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(100vw-2rem,18rem)] max-h-[min(24rem,70vh)] overflow-y-auto">
        {items.map((item) => (
          <DropdownMenuItem key={`${item.href}-${item.label}`} asChild>
            <Link
              href={item.href}
              className="flex items-center gap-2 cursor-pointer"
              onMouseEnter={() => prefetchForHref(item.href)}
            >
              <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{item.label}</span>
              {item.badge != null && item.badge > 0 && (
                <Badge variant="destructive" className="ml-auto text-[10px] px-1.5 py-0 shrink-0">
                  {item.badge}
                </Badge>
              )}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [policyJumpId, setPolicyJumpId] = useState("");
  const { user, roles, permissions, isAuthenticated, isPlatformOwner, isLoading, isError: authError, logout } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/upload/avatar", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message || "Upload failed");
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({ title: "Avatar updated" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setAvatarUploading(false);
      if (avatarInputRef.current) avatarInputRef.current.value = "";
    }
  }

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const safeRoles = Array.isArray(roles) ? roles : [];
  const isAgent = safeRoles.some((r: any) => r.name === "agent");
  const hasAny = (perms: string[]) => perms.length === 0 || perms.some((p) => permissions.includes(p));

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

  const effectiveOrgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const hasTenant = !!effectiveOrgId;
  const isControlPlaneMode = isPlatformOwner && !effectiveOrgId;

  // In control-plane mode, keep navigation on control-plane pages only.
  useEffect(() => {
    if (!isLoading && isAuthenticated && isControlPlaneMode) {
      const allowed = location === "/staff" || location.startsWith("/staff/settings");
      if (!allowed) setLocation("/staff");
    }
  }, [isLoading, isAuthenticated, isControlPlaneMode, location, setLocation]);

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
    enabled: isAuthenticated,
  });

  const { displayName: brandName, displayLogo: brandLogo, isWhitelabeled } = useBranding(effectiveOrgId);

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    enabled: isAuthenticated && hasTenant,
  });

  const switchTenantMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", "/api/platform/switch-tenant", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      window.location.href = "/staff";
    },
    onError: (err: any) => {
      toast({ title: "Switch failed", description: err.message || "Could not switch tenant", variant: "destructive" });
    },
  });

  const filterNav = (items: StaffNavItem[]) =>
    items.filter((item) => {
      if (isAgent && item.agentHidden) return false;
      if (!isAgent && item.agentOnly) return false;
      const perms = item.permissions ?? (item.permission ? [item.permission] : []);
      return hasAny(perms);
    });

  const administrationMenu: StaffNavItem[] = isControlPlaneMode
    ? []
    : filterNav([
        { href: "/staff/policies", label: "Policy Admin", icon: FileStack, permission: "read:policy", agentHidden: true },
        { href: "/staff/admin/society", label: "Society Admin", icon: Building2, agentHidden: true },
        { href: "/staff/funerals", label: "Funeral Files", icon: Truck, permission: "read:funeral_ops" },
        { href: "/staff/admin/tombstones", label: "Tombstones Admin", icon: Milestone, agentHidden: true },
        { href: "/staff/claims", label: "Claims Admin", icon: FileText, permission: "read:claim" },
        { href: "/staff/products", label: "Product Admin", icon: Box, permission: "write:product" },
        { href: "/staff/admin/invoice-items", label: "Invoice Items Admin", icon: ClipboardList, agentHidden: true },
        { href: "/staff/users", label: "User Admin", icon: UserCog, permission: "read:user" },
        { href: "/staff/admin/agents", label: "Agent Admin", icon: UserCheck, agentHidden: true },
        { href: "/staff/admin/brokers", label: "Broker Admin", icon: Briefcase, agentHidden: true },
        { href: "/staff/admin/member-cards", label: "Member Card Admin", icon: CreditCard, agentHidden: true },
        { href: "/staff/admin/terminals", label: "Terminals + Cards Admin", icon: Monitor, agentHidden: true },
        { href: "/staff/admin/branches", label: "Branch Admin", icon: MapPin, agentHidden: true },
        { href: "/staff/groups", label: "Employer Admin", icon: Layers, permissions: ["write:policy"], agentHidden: true },
        { href: "/staff/admin/sub-groups", label: "Sub Group Admin", icon: GitBranch, agentHidden: true },
        { href: "/staff/admin/underwriters", label: "Underwriter Admin", icon: Shield, agentHidden: true },
        { href: "/staff/admin/undertakers", label: "Undertaker Admin", icon: HeartHandshake, agentHidden: true },
        { href: "/staff/pricebook", label: "Price Book", icon: BookOpen, permission: "write:product" },
        { href: "/staff/clients", label: isAgent ? "My Clients" : "Clients", icon: Users, permission: "read:client" },
        { href: "/staff/settings?tab=tenants", label: "Tenants", icon: Building2, permission: "create:tenant" },
        { href: "/staff/approvals", label: "Approvals", icon: ShieldCheck, permission: "manage:approvals" },
      ]);

  const transactionsMenu: StaffNavItem[] = isControlPlaneMode
    ? []
    : filterNav([
        { href: "/staff/policies", label: "Policy Transactions", icon: FileStack, permission: "read:policy", agentOnly: true },
        { href: "/staff/funerals", label: "Funeral File Transactions", icon: Truck, permission: "read:funeral_ops" },
        { href: "/staff/transactions/society", label: "Society Transactions", icon: Building2, agentHidden: true },
        { href: "/staff/transactions/tombstone", label: "Tombstone Transactions", icon: Milestone, agentHidden: true },
        { href: "/staff/transactions/credit-notes", label: "Credit Notes", icon: FileMinus, agentHidden: true },
        { href: "/staff/transactions/invoices", label: "Invoices", icon: FileText, agentHidden: true },
        { href: "/staff/finance", label: "Receipts", icon: Receipt, permissions: ["read:finance", "read:commission"] },
        { href: "/staff/leads", label: "Quotations", icon: Target, permission: "read:lead" },
        { href: "/staff/finance?tab=cashups", label: "Cashup", icon: DollarSign, permissions: ["read:finance", "read:commission"] },
        { href: "/staff/transactions/petty-cash", label: "Petty Cash", icon: Wallet2, agentHidden: true },
        { href: "/staff/transactions/bank-deposits", label: "Bank Deposits", icon: Landmark, agentHidden: true },
        { href: "/staff/transactions/debit-orders", label: "Debit Orders", icon: CreditCard, agentHidden: true },
        { href: "/staff/transactions/fax", label: "Fax", icon: Printer, agentHidden: true },
        { href: "/staff/payroll", label: "Payroll", icon: Wallet2, permission: "read:payroll" },
      ]);

  const reportsMenu: StaffNavItem[] = isControlPlaneMode
    ? []
    : filterNav([
        { href: "/staff/reports/dynamic-generic", label: "Dynamic Reports (Generic)", icon: BarChart2, agentHidden: true },
        { href: "/staff/reports", label: "Dynamic Reports", icon: BarChart3, permission: "read:report" },
        { href: "/staff/employee-reports", label: "Employee Reports", icon: Users, permission: "read:report", agentHidden: true },
        { href: "/staff/reports?section=policies", label: "Policy Reports", icon: FileStack, permission: "read:report" },
        { href: "/staff/reports?section=finance", label: "Transactional Reports", icon: Receipt, permission: "read:report" },
        { href: "/staff/diagnostics", label: "System Issue Reports", icon: Stethoscope, permission: "read:audit_log" },
      ]);

  const toolsMenu: StaffNavItem[] = isControlPlaneMode
    ? []
    : filterNav([
        { href: "/staff/tools/assets", label: "Asset Register", icon: Archive, permission: "read:audit_log" },
        { href: "/staff/audit", label: "Audit Trail", icon: History, permission: "read:audit_log" },
        { href: "/staff/tools/easypay", label: "Manage EasyPay", icon: Zap, agentHidden: true },
        { href: "/staff/clients", label: "CRM Module", icon: Users, permission: "read:client" },
        { href: "/staff/tools/print-policy-cards", label: "Print Policy Cards", icon: Printer },
        { href: "/staff/notifications", label: "SMS Tools", icon: Bell, permission: "read:notification" },
        { href: "/staff/tools/statistics", label: "Statistics", icon: BarChart2, agentHidden: true },
        { href: "/staff/tools/statistical-graphs", label: "Statistical Graphs", icon: LineChart, agentHidden: true },
        { href: "/staff/settings", label: "System Setup", icon: Settings, agentHidden: true },
        { href: "/staff/finance", label: "Billing", icon: DollarSign, permissions: ["read:finance", "read:commission"] },
        { href: "/staff/tools/claims-form", label: "Manage Online Claims Form", icon: ClipboardList, agentHidden: true },
        { href: "/staff/tools/transport-companies", label: "Transport Companies", icon: Truck, agentHidden: true },
        { href: "/staff/tools/contacts", label: "Contacts Manager", icon: BookOpen },
        { href: "/staff/help", label: "Help Centre", icon: HelpCircle },
        { href: "/staff/reminders", label: "Reminders", icon: Clock },
        { href: "/staff/order-services", label: "Order SMS & Prepaid", icon: DollarSign, agentHidden: true },
      ]);

  const controlPlaneNavExtras: StaffNavItem[] = isControlPlaneMode
    ? filterNav([
        { href: "/staff/settings?tab=tenants", label: "Tenants", icon: Building2, permission: "create:tenant" },
        { href: "/staff/settings", label: "Settings", icon: Settings },
      ])
    : [];

  const mobileNavSections = isControlPlaneMode
    ? [
        {
          title: "Menu",
          items: [{ href: "/staff", label: "Home", icon: LayoutDashboard }, ...controlPlaneNavExtras],
        },
      ]
    : [
        { title: "Overview", items: [{ href: "/staff", label: "Home", icon: LayoutDashboard }] as StaffNavItem[] },
        { title: "Transactions", items: transactionsMenu },
        { title: "Reports", items: reportsMenu },
        { title: "Tools", items: toolsMenu },
        { title: "Administration", items: administrationMenu },
      ].filter((s) => s.items.length > 0);

  const prefetchForHref = (href: string) => {
    const hrefBase = href.split("?")[0];
    const prefetchKey: string | null = {
      "/staff": "/api/dashboard/stats",
      "/staff/policies": "/api/policies",
      "/staff/clients": "/api/clients",
      "/staff/claims": "/api/claims",
      "/staff/funerals": "/api/funerals",
      "/staff/leads": "/api/leads",
      "/staff/finance": "/api/finance/summary",
      "/staff/users": "/api/users",
      "/staff/audit": "/api/audit-logs",
      "/staff/groups": "/api/groups",
      "/staff/products": "/api/products",
    }[hrefBase] ?? null;
    if (prefetchKey) {
      queryClient.prefetchQuery({ queryKey: [prefetchKey], staleTime: 30_000 });
    }
  };

  const navIsActive = (href: string) => {
    const path = href.split("?")[0];
    if (path === "/staff") return location === "/staff" || location === "/staff/";
    return location === href || location.startsWith(`${path}/`);
  };

  const currentOrg = isPlatformOwner
    ? (Array.isArray(orgs) ? orgs.find((o: any) => o.id === effectiveOrgId) || orgs[0] : undefined)
    : (Array.isArray(orgs) ? orgs[0] : undefined);

  // When whitelabeled, set app title to tenant name (must run every render to satisfy hooks order)
  useEffect(() => {
    if (isWhitelabeled && currentOrg?.name) {
      const prev = document.title;
      document.title = currentOrg.name;
      return () => { document.title = prev; };
    }
  }, [isWhitelabeled, currentOrg?.name]);

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

  const currentBranch = branchesList?.[0];
  const primaryRole = safeRoles[0]?.name || "staff";
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
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="border-b bg-card shrink-0 z-30">
        <div className={cn(APP_SHELL_MAX, "px-3 sm:px-4 py-2.5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between")}>
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={resolveAssetUrl((currentOrg?.logoUrl && String(currentOrg.logoUrl).trim()) || brandLogo)}
              alt={brandName}
              className="h-8 w-auto max-w-[160px] sm:max-w-[200px] rounded-md object-contain object-left shrink-0"
              loading="lazy"
            />
            <div className="min-w-0 leading-tight">
              <p className="text-xs text-muted-foreground truncate">{currentOrg?.name || brandName}</p>
              {!isWhitelabeled && (
                <p className="font-display font-semibold text-sm text-foreground truncate">POL263</p>
              )}
            </div>
          </div>

          {hasTenant && !isControlPlaneMode && (
            <div className="w-full lg:flex-1 lg:max-w-md lg:mx-4 order-last lg:order-none">
              <PolicySearchInput
                value={policyJumpId}
                onChange={(id) => {
                  if (id) {
                    setLocation(`/staff/policies?openPolicy=${encodeURIComponent(id)}`);
                  }
                  setPolicyJumpId("");
                }}
                placeholder="Search policies…"
                data-testid="input-global-policy-search"
              />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:text-sm text-muted-foreground justify-start lg:justify-end">
            {isPlatformOwner && Array.isArray(orgs) && orgs.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-8 gap-1.5 min-w-0 shrink">
                    <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="truncate max-w-[100px] sm:max-w-[140px]">{currentOrg?.name || "Tenant"}</span>
                    <ChevronDown className="h-3 w-3 opacity-50 shrink-0" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64 max-h-80 overflow-y-auto">
                  {(orgs ?? []).map((org: any) => (
                    <DropdownMenuItem
                      key={org.id}
                      className="flex items-center gap-2 cursor-pointer"
                      onClick={() => switchTenantMutation.mutate(org.id)}
                    >
                      {org.id === currentOrg?.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                      {org.id !== currentOrg?.id && <span className="w-3.5 shrink-0" />}
                      <span className="truncate">{org.name}</span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="flex items-center gap-2 cursor-pointer text-muted-foreground"
                    onClick={() => setLocation("/staff/settings?tab=tenants")}
                  >
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Manage tenants</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : isPlatformOwner && (orgs == null || !Array.isArray(orgs) || orgs.length === 0) ? (
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setLocation("/staff/settings?tab=tenants")}>
                <Globe className="h-3.5 w-3.5 text-primary shrink-0" />
                <span>Add tenant</span>
              </Button>
            ) : !isPlatformOwner ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 min-w-0">
                <Building className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate max-w-[120px] font-medium text-foreground">{currentOrg?.name || "—"}</span>
              </span>
            ) : null}

            {hasTenant && currentBranch?.name && (
              <span className="hidden md:inline text-muted-foreground">
                Branch: <span className="font-medium text-foreground">{currentBranch.name}</span>
              </span>
            )}

            <span className="hidden sm:inline truncate max-w-[120px] font-medium text-foreground" title={user?.email || ""}>
              {displayName}
            </span>
            <span className="capitalize text-[11px] sm:text-xs font-semibold text-primary">{isPlatformOwner ? "owner" : primaryRole}</span>
            <span className="hidden sm:inline-flex items-center gap-1 tabular-nums" title="Current date and time">
              <Clock className="h-3.5 w-3.5" />
              {dateTimeStr}
            </span>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Account"
                  className="relative shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar className="h-8 w-8 border">
                    <AvatarImage src={user?.avatarUrl || undefined} />
                    <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">{initials}</AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <div className="px-2 py-1.5 text-xs text-muted-foreground border-b mb-1 truncate">{user?.email}</div>
                <DropdownMenuItem asChild>
                  <Link href="/staff/settings" className="cursor-pointer">Settings</Link>
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="cursor-pointer"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                >
                  Change avatar…
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="cursor-pointer text-destructive focus:text-destructive" onClick={handleLogout} data-testid="btn-logout">
                  <LogOut className="h-4 w-4 mr-2" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <input ref={avatarInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleAvatarUpload} />

            <ThemeSwitcher />
          </div>
        </div>
      </header>

      <nav className="border-b bg-primary text-primary-foreground shrink-0 z-20" aria-label="Primary navigation">
        <div className={cn(APP_SHELL_MAX, "px-1 sm:px-2 flex items-center justify-between gap-1 min-h-11")}>
          <div className="hidden md:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto py-0.5">
            <Link href="/staff">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-9 px-2 sm:px-3 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground shrink-0",
                  navIsActive("/staff") && "bg-primary-foreground/15 font-medium",
                )}
              >
                Home
              </Button>
            </Link>
            {!isControlPlaneMode && (
              <>
                <StaffNavDropdown label="Transactions" items={transactionsMenu} prefetchForHref={prefetchForHref} />
                <StaffNavDropdown label="Reports" items={reportsMenu} prefetchForHref={prefetchForHref} />
                <StaffNavDropdown label="Tools" items={toolsMenu} prefetchForHref={prefetchForHref} />
                <StaffNavDropdown label="Administration" items={administrationMenu} prefetchForHref={prefetchForHref} />
              </>
            )}
            {isControlPlaneMode && (
              <>
                {controlPlaneNavExtras.map((item) => (
                  <Link key={item.href} href={item.href}>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className={cn(
                        "h-9 px-2 sm:px-3 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground shrink-0",
                        navIsActive(item.href) && "bg-primary-foreground/15 font-medium",
                      )}
                    >
                      {item.label}
                    </Button>
                  </Link>
                ))}
              </>
            )}
          </div>

          <div className="md:hidden flex items-center justify-between w-full gap-2 px-1 py-1">
            <Link href="/staff" className="text-sm font-medium text-primary-foreground/95 truncate">
              {isControlPlaneMode ? "Control plane" : "Staff"}
            </Link>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-primary-foreground hover:bg-primary-foreground/15 shrink-0"
                  aria-label="Open navigation menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(100vw-1rem,20rem)] flex flex-col p-0 gap-0">
                <SheetHeader className="p-4 border-b text-left space-y-1">
                  <SheetTitle>Menu</SheetTitle>
                  <p className="text-xs font-normal text-muted-foreground truncate">{currentOrg?.name || brandName}</p>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-3 space-y-5">
                  {mobileNavSections.map((section) => (
                    <div key={section.title}>
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{section.title}</p>
                      <div className="space-y-0.5">
                        {section.items.map((item) => (
                          <Link
                            key={`${item.href}-${item.label}`}
                            href={item.href}
                            onMouseEnter={() => prefetchForHref(item.href)}
                            onClick={() => setMobileMenuOpen(false)}
                            className={cn(
                              "flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted transition-colors",
                              navIsActive(item.href) && "bg-muted font-medium",
                            )}
                          >
                            <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <span className="truncate flex-1">{item.label}</span>
                            {item.badge != null && item.badge > 0 && (
                              <Badge variant="destructive" className="text-[10px] px-1.5 py-0 shrink-0">{item.badge}</Badge>
                            )}
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t p-3 space-y-2 bg-muted/30">
                  {user?.referralCode && <ReferralLinkBox referralCode={user.referralCode} />}
                  <Button variant="outline" className="w-full" data-testid="btn-logout-mobile" onClick={handleLogout}>
                    <LogOut className="h-4 w-4 mr-2" />
                    Log out
                  </Button>
                </div>
              </SheetContent>
            </Sheet>
          </div>

          <div className="hidden md:flex items-center shrink-0 py-0.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-primary-foreground/35 text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground"
              onClick={handleLogout}
              data-testid="btn-logout-nav"
            >
              Log out
            </Button>
          </div>
        </div>
      </nav>

      <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <div className={cn(APP_SHELL_MAX, "px-3 py-4 sm:px-6 sm:py-8 min-h-0")}>{children}</div>
      </main>

      <AppFooter />
    </div>
  );
}