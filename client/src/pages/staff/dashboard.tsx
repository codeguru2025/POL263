import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard, EmptyState } from "@/components/ds";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useLocation } from "wouter";
import {
  Users,
  Building2,
  ShieldCheck,
  Activity,
  FileStack,
  FileText,
  Box,
  TrendingUp,
  DollarSign,
  Target,
  Loader2,
  Heart,
  AlertTriangle,
  Filter,
  Plus,
  BarChart3,
  MessageSquare,
  HelpCircle,
  ThumbsUp,
  ThumbsDown,
  LayoutDashboard,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  PieChart,
  Pie,
  Legend,
} from "recharts";

interface DashboardStats {
  totalPolicies: number;
  activePolicies: number;
  totalClients: number;
  totalClaims: number;
  openClaims: number;
  totalFuneralCases: number;
  totalLeads: number;
  totalTransactions: number;
}

interface CoveredLives {
  coveredLives: number;
  activePolicyCount: number;
}

interface LapseRetention {
  total: number;
  active: number;
  lapsed: number;
  grace: number;
  cancelled: number;
  retentionRate: string;
  lapseRate: string;
}

interface ProductPerformance {
  id: string;
  name: string;
  totalPolicies: number;
  activePolicies: number;
  lapsedPolicies: number;
  revenue: number;
  currency?: string;
}

interface ControlPlaneTenantMetrics {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  logoUrl?: string | null;
  usersCount: number;
  policiesCount: number;
  activePoliciesCount: number;
  clientsCount: number;
  claimsCount: number;
  leadsCount: number;
  branchesCount: number;
  loadError: string | null;
}

interface ControlPlaneDashboard {
  summary: {
    tenants: number;
    users: number;
    policies: number;
    activePolicies: number;
    clients: number;
    claims: number;
    leads: number;
    branches: number;
  };
  tenants: ControlPlaneTenantMetrics[];
}

const FUNNEL_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];
const STATUS_COLORS: Record<string, string> = {
  inactive: "#3b82f6",
  active: "#10b981",
  grace: "#f97316",
  lapsed: "#ef4444",
  cancelled: "#94a3b8",
};

export default function StaffDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, roles, permissions, isPlatformOwner } = useAuth();
  const { toast } = useToast();
  const effectiveOrgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const isControlPlaneMode = isPlatformOwner && !effectiveOrgId;
  const isAgent = roles.some((r) => r.name === "agent");
  const canReadFinance = permissions.includes("read:finance");
  const canReadClaims = permissions.includes("read:claim");
  const canReadFuneralOps = permissions.includes("read:funeral_ops");
  const canReadAuditLog = permissions.includes("read:audit_log");
  const canReadLead = permissions.includes("read:lead");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  const [rateOpen, setRateOpen] = useState(false);

  const { data: controlPlaneData, isLoading: cpLoading } = useQuery<ControlPlaneDashboard>({
    queryKey: ["/api/platform/dashboard"],
    enabled: isControlPlaneMode,
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

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (statusFilter && statusFilter !== "all") p.set("status", statusFilter);
    if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
    return p.toString();
  }, [dateFrom, dateTo, statusFilter, branchFilter]);

  const filterKey = { dateFrom, dateTo, statusFilter, branchFilter };

  const base = getApiBase();
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", filterKey],
    queryFn: async () => {
      const url = base + "/api/dashboard/stats" + (filterParams ? `?${filterParams}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const { data: coveredLives } = useQuery<CoveredLives>({
    queryKey: ["/api/dashboard/covered-lives"],
    enabled: !isControlPlaneMode,
  });

  const { data: revenueTrend } = useQuery<{ date: string; total: number }[]>({
    queryKey: ["/api/dashboard/revenue-trend", filterKey],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      const url = base + "/api/dashboard/revenue-trend" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to load revenue trend");
      return res.json();
    },
    enabled: !isControlPlaneMode && canReadFinance,
  });

  const { data: policyBreakdown } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/policy-status-breakdown", filterKey],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
      const url = base + "/api/dashboard/policy-status-breakdown" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return {};
      if (!res.ok) throw new Error("Failed to load breakdown");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const { data: leadFunnel } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/lead-funnel"],
    enabled: !isControlPlaneMode && canReadLead,
  });

  const { data: lapseRetention } = useQuery<LapseRetention>({
    queryKey: ["/api/dashboard/lapse-retention", filterKey],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
      const url = base + "/api/dashboard/lapse-retention" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load lapse retention");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const { data: productPerformance } = useQuery<ProductPerformance[]>({
    queryKey: ["/api/dashboard/product-performance"],
    enabled: !isControlPlaneMode,
  });

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
    enabled: !isControlPlaneMode,
  });

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    enabled: !isControlPlaneMode && !isAgent,
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
    enabled: !isControlPlaneMode,
  });

  const { data: auditLogs } = useQuery<any[]>({
    queryKey: ["/api/audit-logs"],
    enabled: !isControlPlaneMode && canReadAuditLog,
  });

  const currentOrg = isPlatformOwner && effectiveOrgId
    ? (Array.isArray(orgs) ? orgs.find((o: any) => o.id === effectiveOrgId) ?? orgs[0] : undefined)
    : orgs?.[0];
  const primaryRole = roles[0]?.name || "—";

  const filteredRevenueTrend = revenueTrend || [];

  const policyStatusData = useMemo(() => {
    if (!policyBreakdown) return [];
    return Object.entries(policyBreakdown)
      .filter(([status]) => statusFilter === "all" || status === statusFilter)
      .map(([status, count]) => ({
        name: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " "),
        value: count,
        color: STATUS_COLORS[status] || "#6b7280",
      }));
  }, [policyBreakdown, statusFilter]);

  const leadFunnelData = useMemo(() => {
    if (!leadFunnel) return [];
    const order = ["lead", "captured", "contacted", "quote_generated", "application_started", "submitted", "approved", "agreed_to_pay", "activated", "lost"];
    return order
      .filter((stage) => leadFunnel[stage] !== undefined)
      .map((stage, i) => ({
        name: stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: leadFunnel[stage],
        fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
      }));
  }, [leadFunnel]);

  const allStatCards = [
    {
      title: "Total Policies",
      value: stats?.totalPolicies ?? 0,
      subtitle: `${stats?.activePolicies ?? 0} active`,
      icon: FileStack,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      show: true,
    },
    {
      title: "Covered Lives",
      value: coveredLives?.coveredLives ?? 0,
      subtitle: `${coveredLives?.activePolicyCount ?? 0} active policies`,
      icon: Heart,
      color: "text-rose-600",
      bgColor: "bg-rose-50",
      show: true,
    },
    {
      title: isAgent ? "My Clients" : "Leads & Clients",
      value: stats?.totalClients ?? 0,
      subtitle: `${stats?.totalPolicies ? Math.min(stats.totalPolicies, stats.totalClients) : 0} converted`,
      icon: Users,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      show: true,
    },
    {
      title: "Claims",
      value: stats?.totalClaims ?? 0,
      subtitle: `${stats?.openClaims ?? 0} open`,
      icon: FileText,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      show: canReadClaims,
    },
    {
      title: "Funeral Cases",
      value: stats?.totalFuneralCases ?? 0,
      subtitle: "Active cases",
      icon: Box,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      show: canReadFuneralOps,
    },
    {
      title: "Lead Conversion",
      value: stats?.totalClients
        ? `${((Math.min(stats.totalPolicies ?? 0, stats.totalClients) / stats.totalClients) * 100).toFixed(0)}%`
        : "0%",
      subtitle: `${stats?.totalLeads ?? 0} pipeline leads`,
      icon: Target,
      color: "text-pink-600",
      bgColor: "bg-pink-50",
      show: canReadLead,
    },
    {
      title: "Transactions",
      value: stats?.totalTransactions ?? 0,
      subtitle: "Payment records",
      icon: DollarSign,
      color: "text-teal-600",
      bgColor: "bg-teal-50",
      show: canReadFinance,
    },
    {
      title: "Retention Rate",
      value: `${lapseRetention?.retentionRate ?? 0}%`,
      subtitle: `${lapseRetention?.lapseRate ?? 0}% lapse rate`,
      icon: TrendingUp,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      show: true,
    },
  ];

  const statCards = allStatCards.filter((c) => c.show);

  if (isControlPlaneMode) {
    const summary = controlPlaneData?.summary;
    const tenants = controlPlaneData?.tenants ?? [];
    return (
      <StaffLayout>
        <PageShell>
          <PageHeader
            title="Control Plane Dashboard"
            description="Platform-wide overview across all active tenants."
            titleDataTestId="text-dashboard-title"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiStatCard label="Tenants" value={summary?.tenants ?? 0} icon={Building2} />
            <KpiStatCard label="Users" value={summary?.users ?? 0} icon={Users} />
            <KpiStatCard
              label="Policies"
              value={summary?.policies ?? 0}
              hint={<span className="tabular-nums">{summary?.activePolicies ?? 0} active</span>}
              icon={FileStack}
            />
            <KpiStatCard label="Clients" value={summary?.clients ?? 0} icon={Heart} />
          </div>

          <CardSection title="Tenants" description="Switch into a tenant workspace from here." icon={Building2}>
              {cpLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : tenants.length === 0 ? (
                <EmptyState
                  title="No tenants yet"
                  description="Create your first tenant to get started."
                  action={(
                    <Button size="sm" onClick={() => setLocation("/staff/settings?tab=tenants")}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create first tenant
                    </Button>
                  )}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <div className="space-y-3">
                  {tenants.map((t) => (
                    <div key={t.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{t.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">{t.slug}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {t.usersCount} users • {t.policiesCount} policies • {t.clientsCount} clients
                          </span>
                        </div>
                        {t.loadError && <p className="text-xs text-destructive mt-1">Metrics unavailable: {t.loadError}</p>}
                      </div>
                      <button
                        className="inline-flex items-center justify-center h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                        onClick={() => switchTenantMutation.mutate(t.id)}
                        disabled={switchTenantMutation.isPending}
                      >
                        Enter Tenant
                      </button>
                    </div>
                  ))}
                </div>
              )}
          </CardSection>
        </PageShell>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Dashboard"
          description={`Welcome back, ${user?.displayName || user?.email}. Here is your overview.`}
          titleDataTestId="text-dashboard-title"
        />

        {!isAgent && (
        <CardSection title="Quick access" description="Hub links inspired by classic admin home screens — uses your current theme." icon={LayoutDashboard}>
            <div className="grid gap-4 sm:grid-cols-3">
              <Link href="/staff/notifications" className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow flex gap-3 items-start">
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">Messaging & templates</p>
                  <p className="text-xs text-muted-foreground mt-1">Broadcasts, notification rules, and delivery settings.</p>
                </div>
              </Link>
              <Link href="/staff/help" className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow flex gap-3 items-start">
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <HelpCircle className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">Help centre</p>
                  <p className="text-xs text-muted-foreground mt-1">Staff guidance and links to configuration areas.</p>
                </div>
              </Link>
              <button
                type="button"
                className="rounded-xl border bg-card p-4 shadow-sm hover:shadow-md transition-shadow flex gap-3 items-start text-left w-full"
                onClick={() => setRateOpen(true)}
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <ThumbsUp className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="font-semibold text-sm">Rate this workspace</p>
                  <p className="text-xs text-muted-foreground mt-1">Quick feedback (stored locally for now).</p>
                </div>
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              <Link href="/staff/order-services" className="text-primary hover:underline font-medium">Order services</Link>
              <Link href="/staff/reminders" className="text-primary hover:underline font-medium">Reminders</Link>
              <Link href="/staff/finance" className="text-primary hover:underline font-medium">Finance</Link>
            </div>
        </CardSection>
        )}

        <Dialog open={rateOpen} onOpenChange={setRateOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Thanks for the feedback</DialogTitle>
              <DialogDescription>
                POL263 does not send this anywhere yet — tell your team what would make the dashboard more useful.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2 justify-center py-2">
              <Button type="button" variant="outline" className="gap-2" onClick={() => { toast({ title: "Thanks!", description: "Glad it is working for you." }); setRateOpen(false); }}>
                <ThumbsUp className="h-4 w-4" /> Good
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={() => { toast({ title: "Noted", description: "We will keep improving the layout." }); setRateOpen(false); }}>
                <ThumbsDown className="h-4 w-4" /> Could improve
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {!isAgent && (
        <CardSection title="Filters" icon={Filter}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date From</Label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="filter-date-from"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Date To</Label>
                <Input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="filter-date-to"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Policy Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="h-9" data-testid="filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="grace">Grace</SelectItem>
                    <SelectItem value="lapsed">Lapsed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Branch</Label>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger className="h-9" data-testid="filter-branch">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branchesList?.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
        </CardSection>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <KpiStatCard
              key={card.title}
              className="shadow-sm hover:shadow-md transition-shadow"
              label={card.title}
              icon={card.icon}
              hint={card.subtitle}
              value={
                statsLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <span className="font-display" data-testid={`stat-${card.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    {card.value}
                  </span>
                )
              }
            />
          ))}
        </div>

        {canReadFinance && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <CardSection title="Revenue trend" icon={DollarSign} contentClassName="pt-2">
              {filteredRevenueTrend.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart data={filteredRevenueTrend}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      formatter={(value: number) => [value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "Revenue"]}
                      labelFormatter={(label) => `Date: ${label}`}
                    />
                    <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#colorRevenue)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-revenue">
                  No revenue data available
                </div>
              )}
          </CardSection>

          <CardSection title="Policy status breakdown" icon={FileStack} contentClassName="pt-2">
              {policyStatusData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={policyStatusData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      {policyStatusData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: number) => [value, "Policies"]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-policies">
                  No policy data available
                </div>
              )}
          </CardSection>
        </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {!isAgent && canReadLead && (
          <CardSection title="Lead conversion funnel" icon={BarChart3} contentClassName="pt-2">
              {leadFunnelData.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={leadFunnelData} layout="vertical" margin={{ left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
                    <Tooltip formatter={(value: number) => [value, "Leads"]} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {leadFunnelData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-leads">
                  No lead data available
                </div>
              )}
          </CardSection>
          )}

          <CardSection title="Lapse & retention metrics" icon={AlertTriangle} contentClassName="pt-2">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Retention Rate</p>
                    <p className="text-3xl font-bold text-emerald-600 tabular-nums" data-testid="stat-retention-rate">
                      {lapseRetention?.retentionRate ?? "0"}%
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Lapse Rate</p>
                    <p className="text-3xl font-bold text-red-600 tabular-nums" data-testid="stat-lapse-rate">
                      {lapseRetention?.lapseRate ?? "0"}%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-active-count">{lapseRetention?.active ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-grace-count">{lapseRetention?.grace ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Grace</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-lapsed-count">{lapseRetention?.lapsed ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Lapsed</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-cancelled-count">{lapseRetention?.cancelled ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Cancelled</p>
                  </div>
                </div>
              </div>
          </CardSection>
        </div>

        {productPerformance && productPerformance.length > 0 && (
          <CardSection title="Product performance" description="Totals for the selected filters." icon={Target}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {productPerformance.map((prod) => (
                <div
                  key={prod.id}
                  className="rounded-xl border border-border/70 bg-muted/5 p-4 shadow-sm hover:shadow-md transition-shadow"
                  data-testid={`card-product-${prod.id}`}
                >
                  <p className="text-sm font-semibold mb-3">{prod.name}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Policies</p>
                      <p className="text-xl font-bold tabular-nums">{prod.totalPolicies}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Active</p>
                      <p className="text-xl font-bold text-emerald-600 tabular-nums">{prod.activePolicies}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Lapsed</p>
                      <p className="text-xl font-bold text-red-500 tabular-nums">{prod.lapsedPolicies}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Revenue</p>
                      <p className="text-xl font-bold text-indigo-600 tabular-nums">{prod.currency || "USD"} {(prod.revenue ?? 0).toLocaleString()}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardSection>
        )}

        {!isAgent && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <KpiStatCard
            label="Organization"
            icon={Building2}
            hint={`${branchesList?.length || 0} branch(es)`}
            value={<span className="font-display text-xl sm:text-2xl" data-testid="stat-organization">{currentOrg?.name || "—"}</span>}
          />
          <KpiStatCard
            label="Your role"
            icon={ShieldCheck}
            hint={`${permissions.length} permissions granted`}
            value={<span className="font-display text-xl sm:text-2xl capitalize" data-testid="stat-role">{primaryRole}</span>}
          />
        </div>
        )}

        {canReadAuditLog && (
        <CardSection title="Recent audit activity" icon={Activity}>
            {auditLogs && auditLogs.length > 0 ? (
              <div className="space-y-4">
                {auditLogs.slice(0, 8).map((log: any) => (
                  <div key={log.id} className="flex items-center gap-4 border-b last:border-0 pb-4 last:pb-0" data-testid={`audit-row-${log.id}`}>
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                      <Activity className="h-5 w-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{log.action}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {log.entityType} ({log.entityId?.slice(0, 8)}…) — by {log.actorEmail || "system"}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(log.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground py-2" data-testid="text-no-audit">No audit events yet.</p>
            )}
        </CardSection>
        )}
      </PageShell>
    </StaffLayout>
  );
}
