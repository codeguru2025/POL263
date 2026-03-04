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
import { BarChart3, FileText, Loader2, Download, Truck, DollarSign, Users, Percent, Building, RotateCcw, Calendar, UserCheck, AlertCircle, Clock, CheckCircle, Receipt, Eye } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export type ReportFiltersState = {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  branchId?: string;
  productId?: string;
  agentId?: string;
  status?: string;
};

function buildQuery(f: ReportFiltersState) {
  const p = new URLSearchParams();
  if (f.fromDate) p.set("fromDate", f.fromDate);
  if (f.toDate) p.set("toDate", f.toDate);
  if (f.userId) p.set("userId", f.userId);
  if (f.branchId) p.set("branchId", f.branchId);
  if (f.productId) p.set("productId", f.productId);
  if (f.agentId) p.set("agentId", f.agentId);
  if (f.status) p.set("status", f.status);
  const q = p.toString();
  return q ? "?" + q : "";
}

function ExportButton({ reportType, filters }: { reportType: string; filters: ReportFiltersState }) {
  const handleExport = () => {
    const q = buildQuery(filters);
    window.open(getApiBase() + `/api/reports/export/${reportType}` + q, "_blank");
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={handleExport} data-testid={`button-export-${reportType}`}>
        <Download className="h-4 w-4 mr-1" />
        Download CSV
      </Button>
    </div>
  );
}

export default function StaffReports() {
  const { permissions } = useAuth();
  const canReadFinance = permissions.includes("read:finance");
  const canReadClaim = permissions.includes("read:claim");
  const canReadFuneralOps = permissions.includes("read:funeral_ops");
  const canReadFleet = permissions.includes("read:fleet");
  const canReadPayroll = permissions.includes("read:payroll");
  const canReadCommission = permissions.includes("read:commission");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userId, setUserId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const filters = useMemo<ReportFiltersState>(() => ({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    userId: userId || undefined,
    branchId: branchId || undefined,
    productId: productId || undefined,
    agentId: agentId || undefined,
    status: statusFilter || undefined,
  }), [fromDate, toDate, userId, branchId, productId, agentId, statusFilter]);
  const q = buildQuery(filters);
  const qAppend = q ? q.replace("?", "&") : "";
  const fk = [fromDate, toDate, branchId, productId, agentId, statusFilter];

  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["reports", "policies", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/policies?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: claims = [], isLoading: loadingClaims } = useQuery<any[]>({
    queryKey: ["reports", "claims", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/claims?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({
    queryKey: ["reports", "payments", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payments?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["reports", "funerals", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/funeral-cases?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({ queryKey: ["/api/fleet"] });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({
    queryKey: ["reports", "expenditures", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/expenditures?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const { data: commissionPlans = [], isLoading: loadingCommissions } = useQuery<any[]>({ queryKey: ["/api/commission-plans"] });
  const { data: platformReceivables = [], isLoading: loadingPlatform } = useQuery<any[]>({
    queryKey: ["reports", "platform", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/platform/receivables?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: reinstatements = [], isLoading: loadingReinstatements } = useQuery<any[]>({
    queryKey: ["reports", "reinstatements", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/reinstatements" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: activations = [], isLoading: loadingActivations } = useQuery<any[]>({
    queryKey: ["reports", "activations", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/activations" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: conversions = [], isLoading: loadingConversions } = useQuery<any[]>({
    queryKey: ["reports", "conversions", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/conversions" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: activePolicies = [], isLoading: loadingActivePolicies } = useQuery<any[]>({
    queryKey: ["reports", "active-policies", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/active-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: awaitingPayments = [], isLoading: loadingAwaitingPayments } = useQuery<any[]>({
    queryKey: ["reports", "awaiting-payments", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/awaiting-payments" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: overduePolicies = [], isLoading: loadingOverdue } = useQuery<any[]>({
    queryKey: ["reports", "overdue", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/overdue" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: preLapsePolicies = [], isLoading: loadingPreLapse } = useQuery<any[]>({
    queryKey: ["reports", "pre-lapse", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/pre-lapse" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: lapsedPolicies = [], isLoading: loadingLapsed } = useQuery<any[]>({
    queryKey: ["reports", "lapsed", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapsed" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: issuedPolicies = [], isLoading: loadingIssued } = useQuery<any[]>({
    queryKey: ["reports", "issued-policies", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/issued-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: branches = [] } = useQuery<any[]>({ queryKey: ["/api/branches"] });
  const { data: products = [] } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: policyDetails = [], isLoading: loadingPolicyDetails } = useQuery<any[]>({
    queryKey: ["reports", "policy-details", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/policy-details?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: financeReport = [], isLoading: loadingFinance } = useQuery<any[]>({
    queryKey: ["reports", "finance", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/finance?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: underwriterPayableResult, isLoading: loadingUnderwriterPayable } = useQuery<{ rows: any[]; summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; policyCount: number } }>({
    queryKey: ["reports", "underwriter-payable", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/underwriter-payable?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return { rows: [], summary: { totalMonthlyPayable: 0, totalPayableIncludingAdvance: 0, policyCount: 0 } };
      return res.json();
    },
  });
  const { data: cashups = [], isLoading: loadingCashups } = useQuery<any[]>({
    queryKey: ["reports", "cashups", ...fk, userId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: receiptReport = [], isLoading: loadingReceipts } = useQuery<any[]>({
    queryKey: ["reports", "receipts", ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/receipts?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const policySummary = {
    inactive: policies.filter((p: any) => p.status === "inactive").length,
    active: policies.filter((p: any) => p.status === "active").length,
    grace: policies.filter((p: any) => p.status === "grace").length,
    lapsed: policies.filter((p: any) => p.status === "lapsed").length,
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
            <p className="text-sm text-muted-foreground">Apply date range, branch, product, agent and status for policy reports and exports.</p>
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
              <div className="space-y-2">
                <Label htmlFor="branchId">Branch</Label>
                <select id="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48">
                  <option value="">All branches</option>
                  {(branches as any[]).map((b: any) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="productId">Product</Label>
                <select id="productId" value={productId} onChange={(e) => setProductId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48">
                  <option value="">All products</option>
                  {(products as any[]).map((p: any) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agentId">Agent</Label>
                <select id="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48">
                  <option value="">All agents</option>
                  {users.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="statusFilter">Status</Label>
                <select id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-48">
                  <option value="">All statuses</option>
                  <option value="inactive">Inactive</option>
                  <option value="active">Active</option>
                  <option value="grace">Grace</option>
                  <option value="lapsed">Lapsed</option>
                  <option value="cancelled">Cancelled</option>
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
          {canReadClaim && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-blue-600">{stats?.totalClaims || 0}</p>
              <p className="text-sm text-muted-foreground">Total Claims</p>
            </CardContent>
          </Card>
          )}
          {canReadFinance && (
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-orange-600">{stats?.totalTransactions || 0}</p>
              <p className="text-sm text-muted-foreground">Transactions</p>
            </CardContent>
          </Card>
          )}
        </div>

        <Tabs defaultValue="policies">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="policies" data-testid="tab-policies-report">Policies</TabsTrigger>
            <TabsTrigger value="policy-details" data-testid="tab-policy-details">Policy report</TabsTrigger>
            {canReadFinance && <TabsTrigger value="finance" data-testid="tab-finance-report">Finance</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="underwriter-payable" data-testid="tab-underwriter-payable">Underwriter payable</TabsTrigger>}
            <TabsTrigger value="active-policies" data-testid="tab-active-policies">Active</TabsTrigger>
            <TabsTrigger value="awaiting-payments" data-testid="tab-awaiting-payments">Awaiting payments</TabsTrigger>
            <TabsTrigger value="overdue" data-testid="tab-overdue">Overdue</TabsTrigger>
            <TabsTrigger value="pre-lapse" data-testid="tab-pre-lapse">Pre-lapse</TabsTrigger>
            <TabsTrigger value="lapsed" data-testid="tab-lapsed">Lapsed</TabsTrigger>
            <TabsTrigger value="issued" data-testid="tab-issued">Issued</TabsTrigger>
            <TabsTrigger value="activations" data-testid="tab-activations">Activations</TabsTrigger>
            <TabsTrigger value="conversions" data-testid="tab-conversions-report">Conversions</TabsTrigger>
            <TabsTrigger value="reinstatements" data-testid="tab-reinstatements-report">Reinstatements</TabsTrigger>
            {canReadClaim && <TabsTrigger value="claims" data-testid="tab-claims-report">Claims</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="receipts" data-testid="tab-receipts-report">Receipts</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="payments" data-testid="tab-payments-report">Payments</TabsTrigger>}
            {canReadFuneralOps && <TabsTrigger value="funerals" data-testid="tab-funerals-report">Funerals</TabsTrigger>}
            {canReadFleet && <TabsTrigger value="fleet" data-testid="tab-fleet-report">Fleet</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="expenditures" data-testid="tab-expenditures-report">Expenditure</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="cashups" data-testid="tab-cashups-report">Cashups by user</TabsTrigger>}
            {canReadPayroll && <TabsTrigger value="payroll" data-testid="tab-payroll-report">Payroll</TabsTrigger>}
            {canReadCommission && <TabsTrigger value="commissions" data-testid="tab-commissions-report">Commissions</TabsTrigger>}
            {canReadFinance && <TabsTrigger value="platform" data-testid="tab-platform-report">POL263</TabsTrigger>}
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

          <TabsContent value="policy-details">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Policy report (full details)</CardTitle>
                  <ExportButton reportType="policy-details" filters={filters} />
                </div>
                <p className="text-sm text-muted-foreground">Comprehensive policy report with client, product, beneficiary and dependent details. Use filters above to narrow results.</p>
              </CardHeader>
              <CardContent>
                {loadingPolicyDetails ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : policyDetails.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-policy-details">No policies match the filters</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Branch</TableHead>
                          <TableHead>Member No</TableHead>
                          <TableHead>Policy #</TableHead>
                          <TableHead>National ID</TableHead>
                          <TableHead>First Name</TableHead>
                          <TableHead>Surname</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>DOB</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Product Code</TableHead>
                          <TableHead>Inception Date</TableHead>
                          <TableHead>Premium</TableHead>
                          <TableHead>Cover Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date Added</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Beneficiary</TableHead>
                          <TableHead>Beneficiary ID</TableHead>
                          <TableHead>Beneficiary Phone</TableHead>
                          <TableHead>Beneficiary Rel.</TableHead>
                          <TableHead>Dependents</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policyDetails.map((r: any) => (
                          <TableRow key={r.policyId} data-testid={`row-policy-detail-${r.policyId}`}>
                            <TableCell>{r.branchName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.memberNumber || "—"}</TableCell>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                            <TableCell className="font-mono text-sm">{r.clientNationalId || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.clientFirstName}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.clientLastName}</TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate" title={r.clientAddress || ""}>{r.clientAddress || "—"}</TableCell>
                            <TableCell className="text-sm">{r.clientPhone || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.clientDateOfBirth ? new Date(r.clientDateOfBirth).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.currency} {r.premiumAmount}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.coverAmount ? `${r.coverCurrency || r.currency} ${r.coverAmount}` : "—"}</TableCell>
                            <TableCell><Badge variant={r.status === "active" ? "default" : r.status === "lapsed" ? "destructive" : "secondary"}>{r.status}</Badge></TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell>{r.groupName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{[r.beneficiaryFirstName, r.beneficiaryLastName].filter(Boolean).join(" ") || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.beneficiaryNationalId || "—"}</TableCell>
                            <TableCell className="text-sm">{r.beneficiaryPhone || "—"}</TableCell>
                            <TableCell>{r.beneficiaryRelationship || "—"}</TableCell>
                            <TableCell className="text-sm max-w-[300px]">
                              {r.dependents?.length > 0
                                ? r.dependents.map((d: any, i: number) => (
                                    <div key={i} className="whitespace-nowrap">{d.firstName} {d.lastName} ({d.relationship})</div>
                                  ))
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="finance">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Finance report</CardTitle>
                  <ExportButton reportType="finance" filters={filters} />
                </div>
                <p className="text-sm text-muted-foreground">Date paid, due date, grace days used/remaining, receipt count, months paid, outstanding and advance premiums. Use filters above to narrow by branch, product, agent or status.</p>
              </CardHeader>
              <CardContent>
                {loadingFinance ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : financeReport.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-finance-report">No policies match the filters</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Policy #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Premium</TableHead>
                          <TableHead>Capture date</TableHead>
                          <TableHead>Inception date</TableHead>
                          <TableHead>Cover date</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead>Date paid</TableHead>
                          <TableHead>Receipt count</TableHead>
                          <TableHead>Months paid</TableHead>
                          <TableHead>Grace used</TableHead>
                          <TableHead>Grace remaining</TableHead>
                          <TableHead>Outstanding</TableHead>
                          <TableHead>Advance</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Product code</TableHead>
                          <TableHead>Branch</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead>Agent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {financeReport.map((r: any) => (
                          <TableRow key={r.policyId} data-testid={`row-finance-${r.policyId}`}>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                            <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                            <TableCell className="whitespace-nowrap">{r.currency} {r.premiumAmount}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.datePaid ? new Date(r.datePaid).toLocaleDateString() : "—"}</TableCell>
                            <TableCell>{r.receiptCount}</TableCell>
                            <TableCell>{r.monthsPaid}</TableCell>
                            <TableCell>{r.graceDaysUsed}</TableCell>
                            <TableCell>{r.graceDaysRemaining != null ? r.graceDaysRemaining : "—"}</TableCell>
                            <TableCell className="font-medium">{r.currency} {r.outstandingPremium}</TableCell>
                            <TableCell className="text-green-700">{r.currency} {r.advancePremium}</TableCell>
                            <TableCell className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                            <TableCell>{r.branchName || "—"}</TableCell>
                            <TableCell>{r.groupName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="underwriter-payable">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Underwriter payable</CardTitle>
                  <ExportButton reportType="underwriter-payable" filters={filters} />
                </div>
                <p className="text-sm text-muted-foreground">Monthly amount the tenant pays to the underwriter per policy (per adult/child). Includes advance months where applicable. Use filters to narrow by branch, product or status.</p>
              </CardHeader>
              <CardContent>
                {loadingUnderwriterPayable ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : !underwriterPayableResult?.rows?.length ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-underwriter-report">No policies with underwriter configuration match the filters</p>
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <Card>
                        <CardContent className="pt-6">
                          <p className="text-2xl font-bold" data-testid="text-underwriter-policy-count">{underwriterPayableResult.summary.policyCount}</p>
                          <p className="text-sm text-muted-foreground">Policies</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <p className="text-2xl font-bold" data-testid="text-underwriter-monthly">{underwriterPayableResult.summary.totalMonthlyPayable.toFixed(2)}</p>
                          <p className="text-sm text-muted-foreground">Total monthly payable</p>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <p className="text-2xl font-bold" data-testid="text-underwriter-total">{underwriterPayableResult.summary.totalPayableIncludingAdvance.toFixed(2)}</p>
                          <p className="text-sm text-muted-foreground">Total (incl. advance months)</p>
                        </CardContent>
                      </Card>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Policy #</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>Branch</TableHead>
                            <TableHead>Adults</TableHead>
                            <TableHead>Children</TableHead>
                            <TableHead>Rate (A/C)</TableHead>
                            <TableHead>Advance (mo)</TableHead>
                            <TableHead>Monthly</TableHead>
                            <TableHead>Total payable</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {underwriterPayableResult.rows.map((r: any) => (
                            <TableRow key={r.policyId} data-testid={`row-underwriter-${r.policyId}`}>
                              <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                              <TableCell><Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge></TableCell>
                              <TableCell className="whitespace-nowrap">{[r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.clientPhone || "—"}</TableCell>
                              <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                              <TableCell>{r.branchName || "—"}</TableCell>
                              <TableCell>{r.adults}</TableCell>
                              <TableCell>{r.children}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.underwriterAmountAdult ?? "—"} / {r.underwriterAmountChild ?? "—"}</TableCell>
                              <TableCell>{r.underwriterAdvanceMonths}</TableCell>
                              <TableCell className="font-medium">{r.monthlyPayable.toFixed(2)}</TableCell>
                              <TableCell className="font-medium">{r.totalPayable.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </>
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

          <TabsContent value="receipts">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />Daily Receipts Report</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">{receiptReport.length} receipts{filters.fromDate ? ` from ${filters.fromDate}` : ""}{filters.toDate ? ` to ${filters.toDate}` : ""}</p>
                  </div>
                  <ExportButton reportType="receipts" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingReceipts ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : receiptReport.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No receipts found. Use the date filters above to select a reporting period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Receipt #</TableHead>
                          <TableHead>Date Paid</TableHead>
                          <TableHead>Payment Method</TableHead>
                          <TableHead>Total</TableHead>
                          <TableHead>Premium</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Policy / Client</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Inception Date</TableHead>
                          <TableHead>Receipt Branch</TableHead>
                          <TableHead>Payment Branch</TableHead>
                          <TableHead>Month</TableHead>
                          <TableHead>Year</TableHead>
                          <TableHead>Reference</TableHead>
                          <TableHead>Remarks</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receiptReport.map((r: any, idx: number) => (
                          <TableRow key={r.receiptId || idx}>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{r.receiptNumber}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell><Badge variant="outline">{r.paymentChannel || r.txPaymentMethod || "—"}</Badge></TableCell>
                            <TableCell className="font-semibold whitespace-nowrap">{r.currency} {parseFloat(r.amount || "0").toFixed(2)}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.premiumAmount ? `${r.policyCurrency || r.currency} ${parseFloat(r.premiumAmount).toFixed(2)}` : "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                            <TableCell>
                              <div>
                                <p className="font-mono text-sm">{r.policyNumber || "—"}</p>
                                <p className="text-xs text-muted-foreground">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ") || "—"}</p>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate || "—"}</TableCell>
                            <TableCell className="text-sm">{r.receiptBranchName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.paymentBranchName || r.policyBranchName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.monthNumber ?? "—"}</TableCell>
                            <TableCell className="text-sm">{r.yearNumber ?? "—"}</TableCell>
                            <TableCell className="font-mono text-xs">{r.txReference || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[150px] truncate">{r.txNotes || "—"}</TableCell>
                            <TableCell><Badge variant={r.policyStatus === "active" ? "default" : "secondary"}>{r.policyStatus || "—"}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
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
                          <TableCell><Badge variant={p.status === "cleared" ? "default" : p.status === "reversed" ? "destructive" : "secondary"}>{p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : p.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</TableCell>
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
                  <div className="flex items-center gap-2">
                    <ExportButton reportType="commissions" filters={filters} />
                    {agentId && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => window.open(getApiBase() + `/api/reports/export/commissions?agentId=${agentId}`, "_blank")}
                        data-testid="button-export-commission-ledger"
                      >
                        <Download className="h-4 w-4 mr-1" />
                        Agent Ledger CSV
                      </Button>
                    )}
                  </div>
                </div>
                {!agentId && <p className="text-sm text-muted-foreground mt-1">Select an agent in the filters above to export their commission ledger.</p>}
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

          <TabsContent value="platform">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" />POL263 Platform Revenue Share</CardTitle>
                  <ExportButton reportType="platform" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPlatform ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : platformReceivables.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-platform-receivables">No POL263 Platform receivables recorded</p>
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
                      {platformReceivables.slice(0, 20).map((cr: any) => (
                        <TableRow key={cr.id} data-testid={`row-platform-receivable-${cr.id}`}>
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

          <TabsContent value="conversions">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><RotateCcw className="h-5 w-5" />Policy Conversions</CardTitle>
                  <ExportButton reportType="conversions" filters={filters} />
                </div>
              </CardHeader>
              <CardContent>
                {loadingConversions ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : conversions.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No conversions recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Converted at</TableHead>
                        <TableHead>Reason</TableHead>
                        <TableHead>Current status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {conversions.map((r: any) => (
                        <TableRow key={`${r.policyId}-${r.convertedAt}`}>
                          <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                          <TableCell>{r.clientName}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(r.convertedAt).toLocaleString()}</TableCell>
                          <TableCell>{r.reason || "—"}</TableCell>
                          <TableCell><Badge variant="outline">{r.currentStatus}</Badge></TableCell>
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
