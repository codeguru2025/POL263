import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Activity,
  Database,
  AlertTriangle,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  CreditCard,
  Bell,
  Server,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface SystemHealth {
  dbConnected: boolean;
  uptime: number;
  tableCounts: Record<string, number>;
  timestamp: string;
}

interface NotificationFailure {
  id: string;
  channel: string;
  subject: string | null;
  recipientType: string;
  failureReason: string | null;
  attempts: number;
  createdAt: string;
}

interface UnallocatedPayment {
  id: string;
  amount: string;
  currency: string;
  method: string;
  reference: string | null;
  status: string;
  receivedAt: string | null;
  createdAt: string;
}

interface RecentError {
  id: string;
  action: string;
  entityType: string;
  actorEmail: string | null;
  timestamp: string;
}

function formatUptime(seconds: number) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (mins > 0) parts.push(`${mins}m`);
  parts.push(`${secs}s`);
  return parts.join(" ");
}

export default function StaffDiagnostics() {
  const [refreshKey, setRefreshKey] = useState(0);

  const { data: health, isLoading: healthLoading, isError: healthError } = useQuery<SystemHealth>({
    queryKey: ["/api/diagnostics/health", refreshKey],
  });

  const { data: failures, isLoading: failuresLoading } = useQuery<NotificationFailure[]>({
    queryKey: ["/api/diagnostics/notification-failures", refreshKey],
  });

  const { data: unallocated, isLoading: unallocatedLoading } = useQuery<UnallocatedPayment[]>({
    queryKey: ["/api/diagnostics/unallocated-payments", refreshKey],
  });

  const { data: errors, isLoading: errorsLoading } = useQuery<RecentError[]>({
    queryKey: ["/api/diagnostics/recent-errors", refreshKey],
  });

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Admin Diagnostics"
          description="System health, errors, and operational diagnostics."
          titleDataTestId="text-diagnostics-title"
          actions={(
            <Button variant="outline" onClick={handleRefresh} data-testid="button-refresh-diagnostics">
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiStatCard
            label="Database"
            value={<span data-testid="text-db-status">{healthLoading ? "Checking..." : healthError ? "Error" : health?.dbConnected ? "Connected" : "Disconnected"}</span>}
            icon={Database}
          />
          <KpiStatCard
            label="Uptime"
            value={<span data-testid="text-uptime">{healthLoading ? "..." : health ? formatUptime(health.uptime) : "N/A"}</span>}
            icon={Clock}
          />
          <KpiStatCard
            label="Notification Failures"
            value={<span data-testid="text-failure-count">{failuresLoading ? "..." : failures?.length ?? 0}</span>}
            icon={Bell}
          />
          <KpiStatCard
            label="Unallocated Payments"
            value={<span data-testid="text-unallocated-count">{unallocatedLoading ? "..." : unallocated?.length ?? 0}</span>}
            icon={CreditCard}
          />
        </div>

        <Tabs defaultValue="health" className="w-full">
          <TabsList className="grid w-full grid-cols-4 max-w-2xl">
            <TabsTrigger value="health" data-testid="tab-health">
              <Server className="mr-2 h-4 w-4" />
              System Health
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">
              <Bell className="mr-2 h-4 w-4" />
              Notifications
            </TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments">
              <CreditCard className="mr-2 h-4 w-4" />
              Payments
            </TabsTrigger>
            <TabsTrigger value="errors" data-testid="tab-errors">
              <AlertTriangle className="mr-2 h-4 w-4" />
              Recent Errors
            </TabsTrigger>
          </TabsList>

          <TabsContent value="health" className="mt-6">
            <CardSection title="System Health" description="Database connection status and table record counts." icon={Activity}>
              {healthLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : health ? (
                <div className="space-y-6">
                  <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/20">
                    {health.dbConnected ? (
                      <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                    ) : (
                      <XCircle className="h-6 w-6 text-red-500" />
                    )}
                    <div>
                      <p className="font-medium">
                        Database: {health.dbConnected ? "Connected" : "Disconnected"}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Last checked: {new Date(health.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                      Table Row Counts
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {Object.entries(health.tableCounts).map(([table, count]) => (
                        <div
                          key={table}
                          className="flex items-center justify-between p-3 rounded-lg border bg-card"
                          data-testid={`table-count-${table}`}
                        >
                          <span className="text-sm font-mono truncate mr-2">{table}</span>
                          <Badge variant="secondary" className="shrink-0">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">Failed to load health data.</p>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="notifications" className="mt-6">
            <CardSection title="Notification Failures" description="Recent failed notification delivery attempts." icon={Bell}>
              {failuresLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : failures && failures.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Channel</TableHead>
                        <TableHead>Subject</TableHead>
                        <TableHead>Recipient Type</TableHead>
                        <TableHead>Attempts</TableHead>
                        <TableHead>Failure Reason</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {failures.map((f) => (
                        <TableRow key={f.id} data-testid={`row-notification-failure-${f.id}`}>
                          <TableCell>
                            <Badge variant="outline">{f.channel}</Badge>
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">{f.subject || "—"}</TableCell>
                          <TableCell>{f.recipientType}</TableCell>
                          <TableCell>{f.attempts}</TableCell>
                          <TableCell className="max-w-[250px] truncate text-red-600 text-sm">
                            {f.failureReason || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(f.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title="No notification failures"
                  description="All notifications are delivering successfully."
                  className="border-0 rounded-none bg-transparent py-8"
                />
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="payments" className="mt-6">
            <CardSection title="Unallocated Payments Queue" description="Payments received but not yet allocated to a policy." icon={CreditCard}>
              {unallocatedLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : unallocated && unallocated.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unallocated.map((p) => (
                        <TableRow key={p.id} data-testid={`row-unallocated-payment-${p.id}`}>
                          <TableCell className="font-mono font-medium">
                            {p.currency || "USD"} {parseFloat(p.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline">{p.method}</Badge>
                          </TableCell>
                          <TableCell className="text-sm">{p.reference || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary">{p.status}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {p.receivedAt ? new Date(p.receivedAt).toLocaleString() : new Date(p.createdAt).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title="No unallocated payments"
                  description="All received payments have been allocated to policies."
                  className="border-0 rounded-none bg-transparent py-8"
                />
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="errors" className="mt-6">
            <CardSection title="Recent Errors" description="Recent error-level audit log entries." icon={AlertTriangle}>
              {errorsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : errors && errors.length > 0 ? (
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>Action</TableHead>
                        <TableHead>Entity Type</TableHead>
                        <TableHead>Actor</TableHead>
                        <TableHead>Timestamp</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {errors.map((e) => (
                        <TableRow key={e.id} data-testid={`row-recent-error-${e.id}`}>
                          <TableCell className="font-mono text-sm">{e.action}</TableCell>
                          <TableCell>{e.entityType}</TableCell>
                          <TableCell className="text-sm">{e.actorEmail || "System"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(e.timestamp).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState
                  title="No recent errors"
                  description="No error-level events in the audit log."
                  className="border-0 rounded-none bg-transparent py-8"
                />
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>
    </StaffLayout>
  );
}