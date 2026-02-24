import { useState } from "react";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";

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
  const { user, roles, isAuthenticated, isLoading, logout } = useAuth();

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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    setLocation("/staff/login");
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

  const navGroups = [
    {
      title: "Overview",
      items: [{ href: "/staff", label: "Dashboard", icon: LayoutDashboard }],
    },
    {
      title: "Core Operations",
      items: [
        { href: "/staff/policies", label: "Policies", icon: FileStack },
        { href: "/staff/clients", label: "Clients", icon: Users },
        { href: "/staff/claims", label: "Claims", icon: FileText },
        { href: "/staff/funerals", label: "Funeral Ops", icon: Truck },
        { href: "/staff/leads", label: "Lead Pipeline", icon: Target },
        { href: "/staff/groups", label: "Groups", icon: Layers },
      ],
    },
    {
      title: "Finance",
      items: [
        { href: "/staff/finance", label: "Finance", icon: DollarSign },
        { href: "/staff/pricebook", label: "Price Book", icon: BookOpen },
        { href: "/staff/payroll", label: "Payroll", icon: Wallet2 },
        { href: "/staff/reports", label: "Reports", icon: BarChart3 },
      ],
    },
    {
      title: "Configuration",
      items: [
        { href: "/staff/products", label: "Product Builder", icon: Box },
        { href: "/staff/notifications", label: "Notifications", icon: Bell },
      ],
    },
    {
      title: "System & Audit",
      items: [
        { href: "/staff/users", label: "User Management", icon: UserCog },
        { href: "/staff/approvals", label: "Approvals", icon: ShieldCheck, badge: pendingApprovalsCount },
        { href: "/staff/audit", label: "Audit Logs", icon: History },
        { href: "/staff/diagnostics", label: "Diagnostics", icon: Stethoscope },
        { href: "/staff/settings", label: "Tenant Settings", icon: Settings },
      ],
    },
  ];

  const handleLogout = async () => {
    await logout();
    setLocation("/");
  };

  return (
    <div className="min-h-screen flex bg-background">
      <aside className="w-64 border-r bg-card flex flex-col shadow-[1px_0_10px_rgba(0,0,0,0.02)] z-10 relative">
        <div className="h-16 flex items-center px-6 border-b shrink-0">
          <img
            src={currentOrg?.logoUrl || "/assets/logo.png"}
            alt="Logo"
            className="h-8 w-8 rounded mr-3 shadow-sm border border-border/50"
          />
          <span className="font-display font-bold text-lg tracking-tight">Falakhe Staff</span>
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
                        <item.icon className={`mr-3 h-5 w-5 ${isActive ? "text-primary" : ""}`} />
                        {item.label}
                        {"badge" in item && (item as any).badge > 0 && (
                          <Badge variant="destructive" className="ml-auto h-5 min-w-[20px] px-1.5 text-[10px]" data-testid={`badge-nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}>
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
            <Avatar className="h-9 w-9 border">
              <AvatarImage src={user?.avatarUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary font-medium">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
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
            <LogOut className="mr-3 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-background">
        <header className="h-16 border-b bg-card/50 backdrop-blur-sm flex items-center px-8 justify-between shrink-0 z-10 sticky top-0">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 text-sm">
              <Building className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground font-medium">Tenant:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2 bg-background shadow-sm border-primary/20 hover:border-primary/50">
                {currentOrg?.name || "Loading..."} <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </div>
            <div className="h-5 w-px bg-border"></div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground font-medium">Branch:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2 bg-background shadow-sm">
                {currentBranch?.name || "Loading..."} <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 relative">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none -z-10"></div>
          <div className="max-w-6xl mx-auto relative z-0">{children}</div>
        </div>
      </main>
    </div>
  );
}