import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Users, Building2, ShieldCheck, Activity } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function StaffDashboard() {
  const { user, roles, permissions } = useAuth();

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

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Welcome back, {user?.displayName || user?.email}. Here is your current tenant context.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Audit Events</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-display" data-testid="stat-audit-events">
                {auditLogs?.length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Logged actions</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Active Branches</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-xl font-bold font-display" data-testid="stat-branches">
                {branchesList?.length || 0}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Configured in system</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="font-display">Recent Audit Activity</CardTitle>
            </CardHeader>
            <CardContent>
              {auditLogs && auditLogs.length > 0 ? (
                <div className="space-y-4">
                  {auditLogs.slice(0, 5).map((log: any) => (
                    <div key={log.id} className="flex items-center gap-4 border-b last:border-0 pb-4 last:pb-0">
                      <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        <Activity className="h-5 w-5" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{log.action}</p>
                        <p className="text-xs text-muted-foreground">
                          {log.entityType} ({log.entityId}) — by {log.actorEmail || "system"}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {new Date(log.timestamp).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No audit events yet.</p>
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
                  <span className="font-medium">{user?.email}</span>
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