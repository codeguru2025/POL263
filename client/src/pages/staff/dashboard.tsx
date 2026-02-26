import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
}

const FUNNEL_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];
const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  draft: "#6b7280",
  pending: "#f59e0b",
  grace: "#f97316",
  lapsed: "#ef4444",
  cancelled: "#94a3b8",
  reinstatement_pending: "#3b82f6",
};

export default function StaffDashboard() {
  const { user, roles, permissions } = useAuth();

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: coveredLives } = useQuery<CoveredLives>({
    queryKey: ["/api/dashboard/covered-lives"],
  });

  const { data: revenueTrend } = useQuery<{ date: string; total: number }[]>({
    queryKey: ["/api/dashboard/revenue-trend"],
  });

  const { data: policyBreakdown } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/policy-status-breakdown"],
  });

  const { data: leadFunnel } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/lead-funnel"],
  });

  const { data: lapseRetention } = useQuery<LapseRetention>({
    queryKey: ["/api/dashboard/lapse-retention"],
  });

  const { data: productPerformance } = useQuery<ProductPerformance[]>({
    queryKey: ["/api/dashboard/product-performance"],
  });

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: auditLogs } = useQuery<any[]>({
    queryKey: ["/api/audit-logs"],
  });

  const currentOrg = orgs?.[0];
  const primaryRole = roles[0]?.name || "—";

  const filteredRevenueTrend = useMemo(() => {
    if (!revenueTrend) return [];
    return revenueTrend.filter((item) => {
      if (dateFrom && item.date < dateFrom) return false;
      if (dateTo && item.date > dateTo) return false;
      return true;
    });
  }, [revenueTrend, dateFrom, dateTo]);

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

  const statCards = [
    {
      title: "Total Policies",
      value: stats?.totalPolicies ?? 0,
      subtitle: `${stats?.activePolicies ?? 0} active`,
      icon: FileStack,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
    },
    {
      title: "Covered Lives",
      value: coveredLives?.coveredLives ?? 0,
      subtitle: `${coveredLives?.activePolicyCount ?? 0} active policies`,
      icon: Heart,
      color: "text-rose-600",
      bgColor: "bg-rose-50",
    },
    {
      title: "Clients",
      value: stats?.totalClients ?? 0,
      subtitle: "Registered policyholders",
      icon: Users,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
    },
    {
      title: "Claims",
      value: stats?.totalClaims ?? 0,
      subtitle: `${stats?.openClaims ?? 0} open`,
      icon: FileText,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
    },
    {
      title: "Funeral Cases",
      value: stats?.totalFuneralCases ?? 0,
      subtitle: "Active cases",
      icon: Box,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
    },
    {
      title: "Leads",
      value: stats?.totalLeads ?? 0,
      subtitle: "Pipeline entries",
      icon: Target,
      color: "text-pink-600",
      bgColor: "bg-pink-50",
    },
    {
      title: "Transactions",
      value: stats?.totalTransactions ?? 0,
      subtitle: "Payment records",
      icon: DollarSign,
      color: "text-teal-600",
      bgColor: "bg-teal-50",
    },
    {
      title: "Retention Rate",
      value: `${lapseRetention?.retentionRate ?? 0}%`,
      subtitle: `${lapseRetention?.lapseRate ?? 0}% lapse rate`,
      icon: TrendingUp,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
    },
  ];

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user?.displayName || user?.email}. Here is your overview.
          </p>
        </div>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="grace">Grace</SelectItem>
                    <SelectItem value="lapsed">Lapsed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Branch</Label>
                <Select defaultValue="all">
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
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <Card key={card.title} className="shadow-sm hover:shadow-md transition-shadow">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
                <div className={`h-9 w-9 rounded-lg ${card.bgColor} flex items-center justify-center`}>
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                {statsLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <div className="text-2xl font-bold font-display" data-testid={`stat-${card.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    {card.value}
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">{card.subtitle}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display text-base">Revenue Trend</CardTitle>
            </CardHeader>
            <CardContent>
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
                      formatter={(value: number) => [`$${value.toLocaleString()}`, "Revenue"]}
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
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display text-base">Policy Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display text-base">Lead Conversion Funnel</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Lapse & Retention Metrics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Retention Rate</p>
                    <p className="text-3xl font-bold text-emerald-600" data-testid="stat-retention-rate">
                      {lapseRetention?.retentionRate ?? "0"}%
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Lapse Rate</p>
                    <p className="text-3xl font-bold text-red-600" data-testid="stat-lapse-rate">
                      {lapseRetention?.lapseRate ?? "0"}%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold" data-testid="stat-active-count">{lapseRetention?.active ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold" data-testid="stat-grace-count">{lapseRetention?.grace ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Grace</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold" data-testid="stat-lapsed-count">{lapseRetention?.lapsed ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Lapsed</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold" data-testid="stat-cancelled-count">{lapseRetention?.cancelled ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Cancelled</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {productPerformance && productPerformance.length > 0 && (
          <div>
            <h2 className="text-lg font-display font-semibold mb-3">Product Performance</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {productPerformance.map((prod) => (
                <Card key={prod.id} className="shadow-sm hover:shadow-md transition-shadow" data-testid={`card-product-${prod.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">{prod.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <p className="text-xs text-muted-foreground">Policies</p>
                        <p className="text-xl font-bold">{prod.totalPolicies}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Active</p>
                        <p className="text-xl font-bold text-emerald-600">{prod.activePolicies}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Lapsed</p>
                        <p className="text-xl font-bold text-red-500">{prod.lapsedPolicies}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Revenue</p>
                        <p className="text-xl font-bold text-indigo-600">${prod.revenue.toLocaleString()}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Organization</CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-display" data-testid="stat-organization">
                {currentOrg?.name || "—"}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {branchesList?.length || 0} branch(es)
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Your Role</CardTitle>
              <ShieldCheck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-display capitalize" data-testid="stat-role">
                {primaryRole}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {permissions.length} permissions granted
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="font-display">Recent Audit Activity</CardTitle>
          </CardHeader>
          <CardContent>
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
              <p className="text-sm text-muted-foreground" data-testid="text-no-audit">No audit events yet.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}
