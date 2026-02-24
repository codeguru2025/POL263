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
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

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

export default function StaffDashboard() {
  const { user, roles, permissions } = useAuth();

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
  });

  const { data: auditLogs } = useQuery<any[]>({
    queryKey: ["/api/audit-logs"],
  });

  const currentOrg = orgs?.[0];
  const primaryRole = roles[0]?.name || "—";

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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Security Context</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Current User</span>
                  <span className="font-medium" data-testid="text-current-user">{user?.email}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Assigned Role</span>
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 font-semibold capitalize">
                    {primaryRole}
                  </Badge>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Tenant Scoping</span>
                  <span className="font-medium">{currentOrg?.name || "—"}</span>
                </div>
                <div className="flex justify-between py-2 border-b">
                  <span className="text-muted-foreground">Branch Scoping</span>
                  <span className="font-medium">{branchesList?.[0]?.name || "—"}</span>
                </div>
                <div className="flex flex-col py-2">
                  <span className="text-muted-foreground mb-2">Effective Permissions</span>
                  <div className="flex flex-wrap gap-1">
                    {permissions.slice(0, 12).map((p) => (
                      <Badge key={p} variant="secondary" className="text-[10px] font-mono">
                        {p}
                      </Badge>
                    ))}
                    {permissions.length > 12 && (
                      <Badge variant="secondary" className="text-[10px]">
                        +{permissions.length - 12} more
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </StaffLayout>
  );
}
