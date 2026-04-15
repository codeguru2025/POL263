import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell } from "@/components/ds";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${health?.dbConnected ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"}`}>
                  <Database className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Database</p>
                  <p className="font-semibold" data-testid="text-db-status">
                    {healthLoading ? "Checking..." : healthError ? "Error" : health?.dbConnected ? "Connected" : "Disconnected"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 text-blue-600">
                  <Clock className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Uptime</p>
                  <p className="font-semibold" data-testid="text-uptime">
                    {healthLoading ? "..." : health ? formatUptime(health.uptime) : "N/A"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-600">
                  <Bell className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Notification Failures</p>
                  <p className="font-semibold" data-testid="text-failure-count">
                    {failuresLoading ? "..." : failures?.length ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 text-purple-600">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Unallocated Payments</p>
                  <p className="font-semibold" data-testid="text-unallocated-count">
                    {unallocatedLoading ? "..." : unallocated?.length ?? 0}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
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
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  System Health
                </CardTitle>
                <CardDescription>Database connection status and table record counts.</CardDescription>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5 text-amber-500" />
                  Notification Failures
                </CardTitle>
                <CardDescription>Recent failed notification delivery attempts.</CardDescription>
              </CardHeader>
              <CardContent>
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
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                    <p>No notification failures found.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-purple-500" />
                  Unallocated Payments Queue
                </CardTitle>
                <CardDescription>Payments received but not yet allocated to a policy.</CardDescription>
              </CardHeader>
              <CardContent>
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
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                    <p>No unallocated payments in the queue.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="errors" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-red-500" />
                  Recent Errors
                </CardTitle>
                <CardDescription>Recent error-level audit log entries.</CardDescription>
              </CardHeader>
              <CardContent>
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
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-400" />
                    <p>No recent errors found.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </PageShell>
    </StaffLayout>
  );
}