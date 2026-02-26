import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase } from "@/lib/queryClient";
import { BarChart3, FileText, Loader2, Download, Truck, DollarSign, Users, Percent, Building, RotateCcw, Calendar, UserCheck, AlertCircle, Clock, CheckCircle } from "lucide-react";

function buildQuery(f: { fromDate?: string; toDate?: string; userId?: string }) {
  const p = new URLSearchParams();
  if (f.fromDate) p.set("fromDate", f.fromDate);
  if (f.toDate) p.set("toDate", f.toDate);
  if (f.userId) p.set("userId", f.userId);
  const q = p.toString();
  return q ? "?" + q : "";
}

function ExportButton({ reportType, filters }: { reportType: string; filters: { fromDate?: string; toDate?: string; userId?: string } }) {
  const handleExport = () => {
    const q = buildQuery(filters);
    window.open(getApiBase() + `/api/reports/export/${reportType}` + q, "_blank");
  };
  return (
    <Button variant="outline" size="sm" onClick={handleExport} data-testid={`button-export-${reportType}`}>
      <Download className="h-4 w-4 mr-1" />
      Export CSV
    </Button>
  );
}

export default function StaffReports() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userId, setUserId] = useState("");
  const filters = useMemo(() => ({ fromDate: fromDate || undefined, toDate: toDate || undefined, userId: userId || undefined }), [fromDate, toDate, userId]);
  const q = buildQuery(filters);

  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["reports", "policies", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/policies?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: claims = [], isLoading: loadingClaims } = useQuery<any[]>({
    queryKey: ["reports", "claims", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/claims?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({
    queryKey: ["reports", "payments", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payments?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["reports", "funerals", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/funeral-cases?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({ queryKey: ["/api/fleet"] });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({
    queryKey: ["reports", "expenditures", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/expenditures?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const { data: commissionPlans = [], isLoading: loadingCommissions } = useQuery<any[]>({ queryKey: ["/api/commission-plans"] });
  const { data: chibikhuluReceivables = [], isLoading: loadingChibikhulu } = useQuery<any[]>({
    queryKey: ["reports", "chibikhulu", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/chibikhulu/receivables?limit=200" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: reinstatements = [], isLoading: loadingReinstatements } = useQuery<any[]>({
    queryKey: ["reports", "reinstatements", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/reinstatements" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: activations = [], isLoading: loadingActivations } = useQuery<any[]>({
    queryKey: ["reports", "activations", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/activations" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: activePolicies = [], isLoading: loadingActivePolicies } = useQuery<any[]>({
    queryKey: ["reports", "active-policies", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/active-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: awaitingPayments = [], isLoading: loadingAwaitingPayments } = useQuery<any[]>({
    queryKey: ["reports", "awaiting-payments", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/awaiting-payments" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: overduePolicies = [], isLoading: loadingOverdue } = useQuery<any[]>({
    queryKey: ["reports", "overdue", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/overdue" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: preLapsePolicies = [], isLoading: loadingPreLapse } = useQuery<any[]>({
    queryKey: ["reports", "pre-lapse", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/pre-lapse" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: lapsedPolicies = [], isLoading: loadingLapsed } = useQuery<any[]>({
    queryKey: ["reports", "lapsed", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapsed" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: issuedPolicies = [], isLoading: loadingIssued } = useQuery<any[]>({
    queryKey: ["reports", "issued-policies", fromDate, toDate],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/issued-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: cashups = [], isLoading: loadingCashups } = useQuery<any[]>({
    queryKey: ["reports", "cashups", fromDate, toDate, userId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const policySummary = {
    draft: policies.filter((p: any) => p.status === "draft").length,
    pending: policies.filter((p: any) => p.status === "pending").length,
    active: policies.filter((p: any) => p.status === "active").length,
    grace: policies.filter((p: any) => p.status === "grace").length,
    lapsed: policies.filter((p: any) => p.status === "lapsed").length,
    reinstatement_pending: policies.filter((p: any) => p.status === "reinstatement_pending").length,
    cancelled: policies.filter((p: any) => p.status === "cancelled").length,
  };

  const claimSummary = {
    submitted: claims.filter((c: any) => c.status === "submitted").length,
    verified: claims.filter((c: any) => c.status === "verified").length,
    approved: claims.filter((c: any) => c.status === "approved").length,
    paid: claims.filter((c: any) => c.status === "paid").length,
    closed: claims.filter((c: any) => c.status === "closed").length,
    rejected: claims.filter((c: any) => c.status === "rejected").length,
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-reports-title">Reports</h1>
          <p className="text-muted-foreground">Date-filtered reports and analytics</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Report filters</CardTitle>
            <p className="text-sm text-muted-foreground">Apply date range (and user for Cashups) before generating or exporting.</p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-4">
              <div className="space-y-2">
                <Label htmlFor="fromDate">From date</Label>
                <Input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="toDate">To date</Label>
                <Input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="userId">User (for Cashups)</Label>
                <select id="userId" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48">
                  <option value="">All users</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                  ))}
                </select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold" data-testid="text-total-policies">{stats?.totalPolicies || 0}</p>
              <p className="text-sm text-muted-foreground">Total Policies</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-green-600">{stats?.activePolicies || 0}</p>
              <p className="text-sm text-muted-foreground">Active Policies</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-blue-600">{stats?.totalClaims || 0}</p>
              <p className="text-sm text-muted-foreground">Total Claims</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-orange-600">{stats?.totalTransactions || 0}</p>
              <p className="text-sm text-muted-foreground">Transactions</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="policies">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="policies" data-testid="tab-policies-report">Policies</TabsTrigger>
            <TabsTrigger value="active-policies" data-testid="tab-active-policies">Active</TabsTrigger>
            <TabsTrigger value="awaiting-payments" data-testid="tab-awaiting-payments">Awaiting payments</TabsTrigger>
            <TabsTrigger value="overdue" data-testid="tab-overdue">Overdue</TabsTrigger>
            <TabsTrigger value="pre-lapse" data-testid="tab-pre-lapse">Pre-lapse</TabsTrigger>
            <TabsTrigger value="lapsed" data-testid="tab-lapsed">Lapsed</TabsTrigger>
            <TabsTrigger value="issued" data-testid="tab-issued">Issued</TabsTrigger>
            <TabsTrigger value="activations" data-testid="tab-activations">Activations</TabsTrigger>
            <TabsTrigger value="reinstatements" data-testid="tab-reinstatements-report">Reinstatements</TabsTrigger>
            <TabsTrigger value="claims" data-testid="tab-claims-report">Claims</TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments-report">Payments</TabsTrigger>
            <TabsTrigger value="funerals" data-testid="tab-funerals-report">Funerals</TabsTrigger>
            <TabsTrigger value="fleet" data-testid="tab-fleet-report">Fleet</TabsTrigger>
            <TabsTrigger value="expenditures" data-testid="tab-expenditures-report">Expenditure</TabsTrigger>
            <TabsTrigger value="cashups" data-testid="tab-cashups-report">Cashups by user</TabsTrigger>
            <TabsTrigger value="payroll" data-testid="tab-payroll-report">Payroll</TabsTrigger>
            <TabsTrigger value="commissions" data-testid="tab-commissions-report">Commissions</TabsTrigger>
            <TabsTrigger value="chibikhulu" data-testid="tab-chibikhulu-report">POL263</TabsTrigger>
          </TabsList>

          <TabsContent value="policies">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Policy Summary</CardTitle>
                  <ExportButton reportType="policies" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                  {Object.entries(policySummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
                {loadingPolicies ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.slice(0, 20).map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm">{p.policyNumber}</TableCell>
                          <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                          <TableCell>{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell>{p.paymentSchedule}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="active-policies">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><CheckCircle className="h-5 w-5" />Active Policies</CardTitle>
                  <ExportButton reportType="active-policies" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingActivePolicies ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activePolicies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No active policies in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Premium</TableHead><TableHead>Schedule</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {activePolicies.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell><Badge variant="default">active</Badge></TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell>{p.paymentSchedule}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="awaiting-payments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" />Policies Awaiting Payments</CardTitle>
                  <ExportButton reportType="awaiting-payments" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingAwaitingPayments ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : awaitingPayments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">None in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Premium</TableHead><TableHead>Grace end</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {awaitingPayments.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell><Badge variant="secondary">{p.status}</Badge></TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell className="text-sm">{p.graceEndDate || "—"}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="overdue">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />Overdue Payments (Grace)</CardTitle>
                  <ExportButton reportType="overdue" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingOverdue ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : overduePolicies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">None in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Premium</TableHead><TableHead>Grace end</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {overduePolicies.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell className="text-sm">{p.graceEndDate || "—"}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pre-lapse">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />Pre-lapse (Grace period)</CardTitle>
                  <ExportButton reportType="pre-lapse" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPreLapse ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : preLapsePolicies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">None in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Premium</TableHead><TableHead>Grace end</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {preLapsePolicies.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell className="text-sm">{p.graceEndDate || "—"}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="lapsed">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><AlertCircle className="h-5 w-5" />Lapsed Policies</CardTitle>
                  <ExportButton reportType="lapsed" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingLapsed ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : lapsedPolicies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">None in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Premium</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {lapsedPolicies.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell><Badge variant="secondary">lapsed</Badge></TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="issued">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Issued Policies</CardTitle>
                  <ExportButton reportType="issued-policies" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingIssued ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : issuedPolicies.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">None in range</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow><TableHead>Policy #</TableHead><TableHead>Status</TableHead><TableHead>Premium</TableHead><TableHead>Created</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {issuedPolicies.slice(0, 50).map((p: any) => (
                        <TableRow key={p.id}><TableCell className="font-mono text-sm">{p.policyNumber}</TableCell><TableCell><Badge variant="outline">{p.status}</Badge></TableCell><TableCell>{p.currency} {p.premiumAmount}</TableCell><TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell></TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activations">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><UserCheck className="h-5 w-5" />Policy Activations</CardTitle>
                  <ExportButton reportType="activations" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingActivations ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activations.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No activations in range</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Previous status</TableHead>
                        <TableHead>Activated at</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Current status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activations.map((r: any) => (
                        <TableRow key={`${r.policyId}-${r.activatedAt}`}>
                          <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                          <TableCell>{r.clientName}</TableCell>
                          <TableCell><Badge variant="outline">{r.fromStatus || "—"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(r.activatedAt).toLocaleString()}</TableCell>
                          <TableCell>{r.reason || "—"}</TableCell>
                          <TableCell><Badge variant={r.currentStatus === "active" ? "default" : "secondary"}>{r.currentStatus}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="claims">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Claims Summary</CardTitle>
                  <ExportButton reportType="claims" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                  {Object.entries(claimSummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status}</p>
                    </div>
                  ))}
                </div>
                {loadingClaims ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Claim #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claims.slice(0, 20).map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-sm">{c.claimNumber}</TableCell>
                          <TableCell><Badge variant="outline">{c.claimType}</Badge></TableCell>
                          <TableCell><Badge>{c.status}</Badge></TableCell>
                          <TableCell>{c.deceasedName || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Payment Transactions</CardTitle>
                  <ExportButton reportType="payments" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPayments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No payments recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.slice(0, 20).map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm">{p.reference || "—"}</TableCell>
                          <TableCell className="font-semibold">{p.currency} {p.amount}</TableCell>
                          <TableCell>{p.paymentMethod}</TableCell>
                          <TableCell><Badge>{p.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="funerals">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Funeral Cases</CardTitle>
                  <ExportButton reportType="funerals" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {funeralCases.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No funeral cases recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case #</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Funeral Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {funeralCases.slice(0, 20).map((fc: any) => (
                        <TableRow key={fc.id}>
                          <TableCell className="font-mono text-sm">{fc.caseNumber}</TableCell>
                          <TableCell>{fc.deceasedName}</TableCell>
                          <TableCell><Badge>{fc.status}</Badge></TableCell>
                          <TableCell>{fc.funeralDate || "TBD"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fleet">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Fleet Vehicles</CardTitle>
                  <ExportButton reportType="fleet" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingFleet ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : fleet.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-fleet">No fleet vehicles recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registration</TableHead>
                        <TableHead>Make</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mileage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fleet.slice(0, 20).map((v: any) => (
                        <TableRow key={v.id} data-testid={`row-fleet-${v.id}`}>
                          <TableCell className="font-mono text-sm">{v.registration}</TableCell>
                          <TableCell>{v.make}</TableCell>
                          <TableCell>{v.model}</TableCell>
                          <TableCell>{v.year}</TableCell>
                          <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                          <TableCell>{v.currentMileage || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expenditures">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Expenditure Report</CardTitle>
                  <ExportButton reportType="expenditures" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingExpenditures ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : expenditures.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-expenditures">No expenditures recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Receipt ref</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenditures.slice(0, 20).map((e: any) => (
                        <TableRow key={e.id} data-testid={`row-expenditure-${e.id}`}>
                          <TableCell>{e.description}</TableCell>
                          <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                          <TableCell className="font-semibold">{e.currency} {e.amount}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.spentAt || (e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—")}</TableCell>
                          <TableCell>{e.receiptRef || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cashups">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Calendar className="h-5 w-5" />Daily Cashups by User</CardTitle>
                  <ExportButton reportType="cashups" filters={filters} />
                </div>
                <p className="text-sm text-muted-foreground">Use the Report filters above to set date range and optional user.</p>
              </CardHeader>
              <CardContent>
                {loadingCashups ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : cashups.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-cashups">No cashups in range</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cashup date</TableHead>
                        <TableHead>Total amount</TableHead>
                        <TableHead>Transaction count</TableHead>
                        <TableHead>Locked</TableHead>
                        <TableHead>Prepared by</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashups.map((c: any) => (
                        <TableRow key={c.id} data-testid={`row-cashup-${c.id}`}>
                          <TableCell className="font-mono text-sm">{c.cashupDate}</TableCell>
                          <TableCell className="font-semibold">{c.totalAmount}</TableCell>
                          <TableCell>{c.transactionCount}</TableCell>
                          <TableCell><Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge></TableCell>
                          <TableCell>{(users as any[])?.find((u: any) => u.id === c.preparedBy)?.displayName || c.preparedBy || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Payroll Report</CardTitle>
                  <ExportButton reportType="payroll" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPayroll ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payrollEmployees.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-payroll">No payroll employees recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee Name</TableHead>
                        <TableHead>ID Number</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Basic Salary</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollEmployees.slice(0, 20).map((emp: any) => (
                        <TableRow key={emp.id} data-testid={`row-payroll-${emp.id}`}>
                          <TableCell className="font-medium">{emp.employeeName}</TableCell>
                          <TableCell className="font-mono text-sm">{emp.idNumber}</TableCell>
                          <TableCell>{emp.position}</TableCell>
                          <TableCell>{emp.department}</TableCell>
                          <TableCell className="font-semibold">{emp.basicSalary}</TableCell>
                          <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commissions">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Percent className="h-5 w-5" />Commission Plans</CardTitle>
                  <ExportButton reportType="commissions" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingCommissions ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : commissionPlans.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-commissions">No commission plans recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plan Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Rate (%)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionPlans.slice(0, 20).map((cp: any) => (
                        <TableRow key={cp.id} data-testid={`row-commission-${cp.id}`}>
                          <TableCell className="font-medium">{cp.name}</TableCell>
                          <TableCell><Badge variant="outline">{cp.commissionType}</Badge></TableCell>
                          <TableCell>{cp.ratePercent}%</TableCell>
                          <TableCell><Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chibikhulu">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" />POL263 Revenue Share</CardTitle>
                  <ExportButton reportType="chibikhulu" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingChibikhulu ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : chibikhuluReceivables.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-chibikhulu">No POL263 receivables recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Settled</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chibikhuluReceivables.slice(0, 20).map((cr: any) => (
                        <TableRow key={cr.id} data-testid={`row-chibikhulu-${cr.id}`}>
                          <TableCell>{cr.description}</TableCell>
                          <TableCell className="font-semibold">{cr.amount}</TableCell>
                          <TableCell>{cr.currency}</TableCell>
                          <TableCell><Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="reinstatements">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" />Reinstated Policies</CardTitle>
                  <ExportButton reportType="reinstatements" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingReinstatements ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : reinstatements.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-reinstatements">No reinstated policies recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Previous status</TableHead>
                        <TableHead>Reinstated date</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Current status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reinstatements.map((r: any) => (
                        <TableRow key={`${r.policyId}-${r.reinstatedAt}`} data-testid={`row-reinstatement-${r.policyId}`}>
                          <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                          <TableCell>{r.clientName}</TableCell>
                          <TableCell><Badge variant="outline">{r.fromStatus || "—"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(r.reinstatedAt).toLocaleString()}</TableCell>
                          <TableCell>{r.reason || "—"}</TableCell>
                          <TableCell><Badge variant={r.currentStatus === "active" ? "default" : "secondary"}>{r.currentStatus}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </StaffLayout>
  );
}
