import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearch, useLocation } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import {
  buildStaffReportHref,
  parseReportSearchParams,
  reportContextLabel,
  tabUsesDataset,
  tabsForSection,
  visibleReportSections,
  type ReportDatasetId,
  type ReportSectionId,
} from "@/lib/staff-reports-nav";
import { BarChart3, FileText, Loader2, Download, Truck, DollarSign, Users, Percent, Building, RotateCcw, Calendar, UserCheck, AlertCircle, Clock, CheckCircle, Receipt, Eye, TrendingUp, FolderOpen, UserCircle, Wrench } from "lucide-react";
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

  const sectionOpts = useMemo(
    () => ({ canReadCommission, canReadFuneralOps, canReadFleet }),
    [canReadCommission, canReadFuneralOps, canReadFleet],
  );

  const visibleSections = useMemo(
    () =>
      visibleReportSections({
        canReadFinance,
        canReadClaim,
        canReadFuneralOps,
        canReadFleet,
        canReadPayroll,
      }),
    [canReadFinance, canReadClaim, canReadFuneralOps, canReadFleet, canReadPayroll],
  );

  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const { reportSection, activeReport } = useMemo(() => {
    const parsed = parseReportSearchParams(searchString);
    let section: ReportSectionId = parsed.section;
    if (!visibleSections.includes(section)) section = visibleSections[0]!;
    const tabs = tabsForSection(section, sectionOpts);
    let tab = parsed.tab;
    if (!tabs.some((x) => x.value === tab)) tab = tabs[0]!.value;
    return { reportSection: section, activeReport: tab };
  }, [searchString, visibleSections, sectionOpts]);

  useEffect(() => {
    const parsed = parseReportSearchParams(searchString);
    if (parsed.section === reportSection && parsed.tab === activeReport) return;
    setLocation(buildStaffReportHref(reportSection, activeReport));
  }, [searchString, reportSection, activeReport, setLocation]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userId, setUserId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setRunKey(0);
  }, [reportSection, activeReport]);

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
  const fk = [fromDate, toDate, userId, branchId, productId, agentId, statusFilter];

  const load = runKey > 0;
  const need = (d: ReportDatasetId) => load && tabUsesDataset(activeReport, d);
  const needFilters = load;

  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["reports", "policies", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/policies?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("policies"),
  });
  const { data: claims = [], isLoading: loadingClaims } = useQuery<any[]>({
    queryKey: ["reports", "claims", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/claims?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("claims"),
  });
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({
    queryKey: ["reports", "payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payments?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payments"),
  });
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["reports", "funerals", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/funeral-cases?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("funeralCases"),
  });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({
    queryKey: ["reports", "fleet", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/fleet", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("fleet"),
  });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({
    queryKey: ["reports", "expenditures", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/expenditures?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("expenditures"),
  });
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({
    queryKey: ["reports", "payroll-employees", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payroll/employees", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payrollEmployees"),
  });
  const { data: commissionPlans = [], isLoading: loadingCommissionPlans } = useQuery<any[]>({
    queryKey: ["reports", "commission-plans", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/commission-plans", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionPlans") && canReadCommission,
  });
  const { data: commissionSummary = [], isLoading: loadingCommissionSummary } = useQuery<any[]>({
    queryKey: ["reports", "commissions-summary", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commissions-summary" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionSummary") && canReadCommission,
  });
  const { data: platformReceivables = [], isLoading: loadingPlatform } = useQuery<any[]>({
    queryKey: ["reports", "platform", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/platform/receivables?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("platformReceivables"),
  });
  const { data: reinstatements = [], isLoading: loadingReinstatements } = useQuery<any[]>({
    queryKey: ["reports", "reinstatements", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/reinstatements" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("reinstatements"),
  });
  const { data: activations = [], isLoading: loadingActivations } = useQuery<any[]>({
    queryKey: ["reports", "activations", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/activations" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("activations"),
  });
  const { data: conversions = [], isLoading: loadingConversions } = useQuery<any[]>({
    queryKey: ["reports", "conversions", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/conversions" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("conversions"),
  });
  const { data: activePolicies = [], isLoading: loadingActivePolicies } = useQuery<any[]>({
    queryKey: ["reports", "active-policies", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/active-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("activePolicies"),
  });
  const { data: awaitingPayments = [], isLoading: loadingAwaitingPayments } = useQuery<any[]>({
    queryKey: ["reports", "awaiting-payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/awaiting-payments" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("awaitingPayments"),
  });
  const { data: overduePolicies = [], isLoading: loadingOverdue } = useQuery<any[]>({
    queryKey: ["reports", "overdue", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/overdue" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("overduePolicies"),
  });
  const { data: preLapsePolicies = [], isLoading: loadingPreLapse } = useQuery<any[]>({
    queryKey: ["reports", "pre-lapse", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/pre-lapse" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("preLapsePolicies"),
  });
  const { data: lapsedPolicies = [], isLoading: loadingLapsed } = useQuery<any[]>({
    queryKey: ["reports", "lapsed", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapsed" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("lapsedPolicies"),
  });
  const { data: newJoinings = [], isLoading: loadingNewJoinings } = useQuery<any[]>({
    queryKey: ["reports", "new-joinings", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/new-joinings?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("newJoinings"),
  });
  const { data: agentProductivity = [], isLoading: loadingAgentProductivity } = useQuery<any[]>({
    queryKey: ["reports", "agent-productivity", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-productivity?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("agentProductivity"),
  });
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-users", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: needFilters,
  });
  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-branches", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/branches", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: needFilters,
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-products", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/products", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: needFilters,
  });
  const { data: policyDetails = [], isLoading: loadingPolicyDetails } = useQuery<any[]>({
    queryKey: ["reports", "policy-details", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/policy-details?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("policyDetails"),
  });
  const { data: financeReport = [], isLoading: loadingFinance } = useQuery<any[]>({
    queryKey: ["reports", "finance", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/finance?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("financeReport"),
  });
  const { data: underwriterPayableResult, isLoading: loadingUnderwriterPayable } = useQuery<{ rows: any[]; summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; policyCount: number } }>({
    queryKey: ["reports", "underwriter-payable", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/underwriter-payable?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return { rows: [], summary: { totalMonthlyPayable: 0, totalPayableIncludingAdvance: 0, policyCount: 0 } };
      return res.json();
    },
    enabled: need("underwriterPayable"),
  });
  const { data: cashups = [], isLoading: loadingCashups } = useQuery<any[]>({
    queryKey: ["reports", "cashups", runKey, ...fk, userId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("cashups"),
  });
  const { data: receiptReport = [], isLoading: loadingReceipts } = useQuery<any[]>({
    queryKey: ["reports", "receipts", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/receipts?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("receiptReport"),
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
      <PageShell>
        <PageHeader
          title="Reports"
          description={reportContextLabel(reportSection, activeReport)}
          titleDataTestId="text-reports-title"
        />

        <CardSection title="Filters" icon={Calendar}>
          <div className="space-y-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Reporting period</p>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="fromDate">From</Label>
                  <Input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-40" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toDate">To</Label>
                  <Input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-40" />
                </div>
              </div>
            </div>
            <Separator />
            <div>
              <p className="text-xs font-medium text-muted-foreground mb-2">Scope</p>
              <div className="flex flex-wrap items-end gap-4">
                <div className="space-y-2">
                  <Label htmlFor="branchId">Branch</Label>
                  <select id="branchId" value={branchId} onChange={(e) => setBranchId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-full min-w-[12rem] max-w-xs">
                    <option value="">All branches</option>
                    {(branches as any[]).map((b: any) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="productId">Product</Label>
                  <select id="productId" value={productId} onChange={(e) => setProductId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-full min-w-[12rem] max-w-xs">
                    <option value="">All products</option>
                    {(products as any[]).map((p: any) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="agentId">Agent</Label>
                  <select id="agentId" value={agentId} onChange={(e) => setAgentId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-full min-w-[12rem] max-w-xs">
                    <option value="">All agents</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="statusFilter">Policy status</Label>
                  <select id="statusFilter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-full min-w-[12rem] max-w-xs">
                    <option value="">All statuses</option>
                    <option value="inactive">Inactive</option>
                    <option value="active">Active</option>
                    <option value="grace">Grace</option>
                    <option value="lapsed">Lapsed</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="userId">Cashups user</Label>
                  <select id="userId" value={userId} onChange={(e) => setUserId(e.target.value)} className="h-9 rounded-md border border-input bg-background px-3 py-1 text-sm w-full min-w-[12rem] max-w-xs">
                    <option value="">All users</option>
                    {users.map((u: any) => (
                      <option key={u.id} value={u.id}>{u.displayName || u.email}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button type="button" onClick={() => setRunKey((k) => k + 1)} data-testid="button-run-report">
                Run report
              </Button>
              {!load && (
                <p className="text-sm text-muted-foreground">Choose filters, then run to load data for this report.</p>
              )}
            </div>
          </div>
        </CardSection>

        <div className="min-w-0 space-y-4">
            <Tabs value={activeReport}>
              <TabsList className="sr-only absolute h-px w-px overflow-hidden whitespace-nowrap p-0 -m-px border-0">
                {tabsForSection(reportSection, sectionOpts).map((t) => (
                  <TabsTrigger key={t.value} value={t.value} data-testid={t.testId}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

          <TabsContent value="policies">
            <CardSection
              title="Policy overview"
              description="Quick counts and a short policy list. From/to limit policies by capture date, same as CSV exports."
              icon={BarChart3}
              headerRight={<ExportButton reportType="policies" filters={filters} />}
            >
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                  {Object.entries(policySummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold tabular-nums">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
                {loadingPolicies ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <DataTable>
                    <TableHeader className={dataTableStickyHeaderClass}>
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
                        <TableRow key={p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm">{p.policyNumber}</TableCell>
                          <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                          <TableCell className="tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell>{p.paymentSchedule}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="policy-details">
            <CardSection
              title="Policy report (full details)"
              description="Comprehensive policy report with client, product, beneficiary and dependent details. Use filters above to narrow results."
              icon={FileText}
              headerRight={<ExportButton reportType="policy-details" filters={filters} />}
              flush
            >
                {loadingPolicyDetails ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : policyDetails.length === 0 ? (
                  <EmptyState
                    title="No policies match the filters"
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-policy-details"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
                      <TableHeader className={dataTableStickyHeaderClass}>
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
                            <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
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
                    </DataTable>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="finance">
            <CardSection
              title="Finance report"
              description="Policies are narrowed by capture date when you set from/to. Receipt count, months paid, and totals use issued receipts in that same window when dates are set; otherwise receipts are lifetime-to-date."
              icon={DollarSign}
              headerRight={<ExportButton reportType="finance" filters={filters} />}
              flush
            >
                {loadingFinance ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : financeReport.length === 0 ? (
                  <EmptyState
                    title="No policies match the filters"
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-finance-report"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                      <TableHeader className={dataTableStickyHeaderClass}>
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
                            <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">{r.currency} {r.premiumAmount}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.datePaid ? new Date(r.datePaid).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="tabular-nums">{r.receiptCount}</TableCell>
                            <TableCell className="tabular-nums">{r.monthsPaid}</TableCell>
                            <TableCell className="tabular-nums">{r.graceDaysUsed}</TableCell>
                            <TableCell className="tabular-nums">{r.graceDaysRemaining != null ? r.graceDaysRemaining : "—"}</TableCell>
                            <TableCell className="font-medium tabular-nums">{r.currency} {r.outstandingPremium}</TableCell>
                            <TableCell className="text-green-700 tabular-nums">{r.currency} {r.advancePremium}</TableCell>
                            <TableCell className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                            <TableCell>{r.branchName || "—"}</TableCell>
                            <TableCell>{r.groupName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="underwriter-payable">
            <CardSection
              title="Underwriter payable"
              description="Monthly amount the tenant pays to the underwriter per policy (per adult/child). Includes advance months where applicable. Use filters to narrow by branch, product or status."
              icon={Truck}
              headerRight={<ExportButton reportType="underwriter-payable" filters={filters} />}
            >
                {loadingUnderwriterPayable ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : !underwriterPayableResult?.rows?.length ? (
                  <EmptyState
                    title="No matching policies"
                    description="No policies with underwriter configuration match the filters."
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-underwriter-report"
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <KpiStatCard
                        label="Policies"
                        value={<span data-testid="text-underwriter-policy-count">{underwriterPayableResult.summary.policyCount}</span>}
                        icon={FolderOpen}
                      />
                      <KpiStatCard
                        label="Total monthly payable"
                        value={
                          <span className="tabular-nums" data-testid="text-underwriter-monthly">
                            {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalMonthlyPayable.toFixed(2)}
                          </span>
                        }
                        icon={DollarSign}
                      />
                      <KpiStatCard
                        label="Total (incl. advance months)"
                        value={
                          <span className="tabular-nums" data-testid="text-underwriter-total">
                            {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalPayableIncludingAdvance.toFixed(2)}
                          </span>
                        }
                        icon={TrendingUp}
                      />
                    </div>
                    <div className="overflow-x-auto">
                      <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[900px]">
                        <TableHeader className={dataTableStickyHeaderClass}>
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
                            <TableRow key={r.policyId} className="hover:bg-muted/40" data-testid={`row-underwriter-${r.policyId}`}>
                              <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                              <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                              <TableCell className="whitespace-nowrap">{[r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.clientPhone || "—"}</TableCell>
                              <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                              <TableCell>{r.branchName || "—"}</TableCell>
                              <TableCell>{r.adults}</TableCell>
                              <TableCell>{r.children}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.underwriterAmountAdult ?? "—"} / {r.underwriterAmountChild ?? "—"}</TableCell>
                              <TableCell>{r.underwriterAdvanceMonths}</TableCell>
                              <TableCell className="font-medium tabular-nums">{r.currency} {r.monthlyPayable.toFixed(2)}</TableCell>
                              <TableCell className="font-medium tabular-nums">{r.currency} {r.totalPayable.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </DataTable>
                    </div>
                  </>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="active-policies">
            <CardSection title="Active policies" icon={CheckCircle} description="Policies with status active. When from/to are set, results are limited to policies captured in that window (same as other policy lists)." headerRight={<ExportButton reportType="active-policies" filters={filters} />} flush>
              {loadingActivePolicies ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activePolicies.length === 0 ? (
                <EmptyState title="No active policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="awaiting-payments">
            <CardSection title="Policies Awaiting Payments" icon={Clock} headerRight={<ExportButton reportType="awaiting-payments" filters={filters} />} flush>
              {loadingAwaitingPayments ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : awaitingPayments.length === 0 ? (
                <EmptyState title="None in range" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="overdue">
            <CardSection title="Overdue Payments (Grace)" icon={AlertCircle} headerRight={<ExportButton reportType="overdue" filters={filters} />} flush>
              {loadingOverdue ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : overduePolicies.length === 0 ? (
                <EmptyState title="None in range" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="pre-lapse">
            <CardSection title="Pre-lapse (Grace period)" icon={AlertCircle} headerRight={<ExportButton reportType="pre-lapse" filters={filters} />} flush>
              {loadingPreLapse ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : preLapsePolicies.length === 0 ? (
                <EmptyState title="None in range" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="lapsed">
            <CardSection title="Lapsed Policies" icon={AlertCircle} headerRight={<ExportButton reportType="lapsed" filters={filters} />} flush>
              {loadingLapsed ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : lapsedPolicies.length === 0 ? (
                <EmptyState title="None in range" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="new-joinings">
            <CardSection title="New joinings report" icon={FileText} description="All policies captured in the date range (inactive through cancelled), paid or unpaid. Filter by branch, product, or agent above; status filter does not apply to this report." headerRight={<ExportButton reportType="new-joinings" filters={filters} />} flush>
                {loadingNewJoinings ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : newJoinings.length === 0 ? (
                  <EmptyState title="No policies in range" description="Set from/to dates or widen filters." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">Franchise_Branch_ID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Franchise_BranchName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Marketing_Member_ID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Policy_num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ID_Number</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">First_Name</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Surname</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PolicyHolder</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Title</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Initials</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">UsualPrem</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Cell_Num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PhysicalAdd</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PostalAdd</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">EasyPayNo</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Payment_M</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">StopOrder</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Waiting_Pe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalRe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentNam</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MaturityTe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">GroupName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Idate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Status</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Captured</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newJoinings.slice(0, 100).map((r: any) => (
                          <TableRow key={r._policyId || `${r.Policy_num}-${r._policyCreatedAt}`}>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Franchise_Branch_ID || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate" title={r.Franchise_BranchName}>{r.Franchise_BranchName || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Marketing_Member_ID || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Policy_num}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.ID_Number || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.First_Name}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Surname}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.PolicyHolder}>{r.PolicyHolder || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Title || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Initials || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.UsualPrem || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Cell_Num || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.PhysicalAdd}>{r.PhysicalAdd || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.PostalAdd}>{r.PostalAdd || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.EasyPayNo || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Payment_M || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.StopOrder || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Waiting_Pe || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[120px] truncate" title={r.InternalRe}>{r.InternalRe || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.AgentNam}>{r.AgentNam || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[160px] truncate" title={r.MaturityTe}>{r.MaturityTe || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.GroupName}>{r.GroupName || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Idate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate || "—"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{r._status || "—"}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {r._policyCreatedAt ? new Date(r._policyCreatedAt).toLocaleDateString() : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="agent-productivity">
            <CardSection title="Agent productivity" icon={TrendingUp} description="Policies captured and issued at least one receipt in the same from/to window. Set both dates; branch, product, and agent filters apply." headerRight={<ExportButton reportType="agent-productivity" filters={filters} />} flush>
              {!fromDate || !toDate ? (
                <EmptyState title="Set date range" description="Choose a from date and to date to run this report." className="border-0 rounded-none bg-transparent py-8" />
              ) : loadingAgentProductivity ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : agentProductivity.length === 0 ? (
                <EmptyState title="No policies match" description="No policies registered and receipt-issued in range." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">agent_id</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentsNar</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Policy_Nur</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">FullName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">UsualPrem</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">StatusDes</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptsC</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Colour</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MembersB</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentsBra</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Active</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentProductivity.slice(0, 100).map((r: any) => (
                          <TableRow key={r.policyId}>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.agent_id || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate" title={r.AgentsNar}>{r.AgentsNar || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_ || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Policy_Nur}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.FullName}>{r.FullName || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.UsualPrem || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.StatusDes}</TableCell>
                            <TableCell className="text-xs">{r.ReceiptsC}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Colour || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.MembersB}>{r.MembersB || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.AgentsBra}>{r.AgentsBra || "—"}</TableCell>
                            <TableCell className="text-xs">{r.Active}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fdate}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="activations">
            <CardSection title="Policy activations" icon={UserCheck} description="Rows when a policy moved to active (status history). From/to filter that event time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="activations" filters={filters} />} flush>
              {loadingActivations ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activations.length === 0 ? (
                <EmptyState title="No activations in this period" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="claims">
            <CardSection title="Claims Summary" icon={FileText} headerRight={<ExportButton reportType="claims" filters={filters} />}>
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
                      <TableHead>Approved Amount</TableHead>
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
                        <TableCell className="font-semibold">{c.approvedAmount ? `${c.currency || "USD"} ${c.approvedAmount}` : "—"}</TableCell>
                        <TableCell>{c.deceasedName || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="receipts">
            <CardSection title="Daily receipts report" icon={Receipt} description={<>{receiptReport.length} receipts{filters.fromDate ? ` from ${filters.fromDate}` : ""}{filters.toDate ? ` to ${filters.toDate}` : ""}. Includes UTC <span className="font-mono">DTSTAMP</span> (YYYYMMDDTHHmmssZ) per receipt and policy-receipt detail columns for export.</>} headerRight={<ExportButton reportType="receipts" filters={filters} />} flush>
                {loadingReceipts ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : receiptReport.length === 0 ? (
                  <EmptyState title="No receipts found" description="Use the date filters above to select a reporting period." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap font-mono">DTSTAMP</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">agentsName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthsPaidInAdvance</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">policy_number</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">surname</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalReferenceNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_Name</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">YearNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptCount</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PaymentBy</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ManualUser</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DatePaid</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Transaction</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PremiumDue</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Currency</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AmountCollected</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthsPaid</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Remarks</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PaymentMethod</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DefaultPay</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DebitMethod</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptMonth</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptYear</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">policy_num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PolicyBranch</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Sstatus</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalRe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">CollectedBy</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fromDate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">toDate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">GroupName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InceptionD</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MemberID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ActualPen</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">CapturedBy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receiptReport.map((r: any, idx: number) => (
                          <TableRow key={r.receiptId || idx}>
                            <TableCell className="text-xs font-mono whitespace-nowrap" title={r.DTSTAMP}>{r.DTSTAMP || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.agentsName}>{r.agentsName || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthsPaidInAdvance ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_number || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.surname || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.InternalReferenceNumber}>{r.InternalReferenceNumber || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.Product_Name}>{r.Product_Name || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthNumber ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.YearNumber ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptCount ?? "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fdate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.PaymentBy}>{r.PaymentBy || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{formatReceiptNumber(r.ReceiptNumber || r.receiptNumber)}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.ManualUser}>{r.ManualUser || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DatePaid || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[160px] truncate" title={r.Transaction}>{r.Transaction || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.PremiumDue || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Currency || "—"}</TableCell>
                            <TableCell className="text-xs font-semibold whitespace-nowrap">{parseFloat(String(r.AmountCollected ?? r.amount ?? "0")).toFixed(2)}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthsPaid ?? "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.Remarks}>{r.Remarks || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{r.PaymentMethod || "—"}</Badge></TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DefaultPay || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DebitMethod || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptMonth ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptYear ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_num || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.PolicyBranch}>{r.PolicyBranch || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_ || "—"}</TableCell>
                            <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.Sstatus || "—"}</Badge></TableCell>
                            <TableCell className="text-xs font-mono max-w-[100px] truncate" title={r.InternalRe}>{r.InternalRe || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.CollectedBy}>{r.CollectedBy || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fromDate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.toDate || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.GroupName}>{r.GroupName || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.InceptionD || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.MemberID || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ActualPen || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.ReceiptID}>{r.ReceiptID || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.CapturedBy}>{r.CapturedBy || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="payments">
            <CardSection title="Payment Transactions" icon={Receipt} headerRight={<ExportButton reportType="payments" filters={filters} />} flush>
              {loadingPayments ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : payments.length === 0 ? (
                <EmptyState title="No payments recorded" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="funerals">
            <CardSection title="Funeral Cases" icon={FolderOpen} headerRight={<ExportButton reportType="funerals" filters={filters} />} flush>
              {funeralCases.length === 0 ? (
                <EmptyState title="No funeral cases recorded" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="fleet">
            <CardSection title="Fleet Vehicles" icon={Truck} headerRight={<ExportButton reportType="fleet" filters={filters} />} flush>
              {loadingFleet ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : fleet.length === 0 ? (
                <EmptyState title="No fleet vehicles recorded" data-testid="text-no-fleet" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="expenditures">
            <CardSection title="Expenditure Report" icon={DollarSign} headerRight={<ExportButton reportType="expenditures" filters={filters} />} flush>
              {loadingExpenditures ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : expenditures.length === 0 ? (
                <EmptyState title="No expenditures recorded" data-testid="text-no-expenditures" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="cashups">
            <CardSection title="Daily Cashups by User" icon={Calendar} description="Use the Report filters above to set date range and optional user." headerRight={<ExportButton reportType="cashups" filters={filters} />} flush>
              {loadingCashups ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : cashups.length === 0 ? (
                <EmptyState title="No cashups in range" data-testid="text-no-cashups" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cashup date</TableHead>
                      <TableHead>Currency</TableHead>
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
                        <TableCell>{c.currency || "USD"}</TableCell>
                        <TableCell className="font-semibold">{c.currency || "USD"} {c.totalAmount}</TableCell>
                        <TableCell>{c.transactionCount}</TableCell>
                        <TableCell><Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge></TableCell>
                        <TableCell>{(users as any[])?.find((u: any) => u.id === c.preparedBy)?.displayName || c.preparedBy || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="payroll">
            <CardSection title="Payroll Report" icon={Users} headerRight={<ExportButton reportType="payroll" filters={filters} />} flush>
              {loadingPayroll ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : payrollEmployees.length === 0 ? (
                <EmptyState title="No payroll employees recorded" data-testid="text-no-payroll" className="border-0 rounded-none bg-transparent py-8" />
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
                        <TableCell className="font-semibold">{emp.currency || "USD"} {emp.basicSalary}</TableCell>
                        <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="commissions" className="space-y-6">
            <CardSection
              title="Commissions report"
              icon={Percent}
              description={<>Per-agent totals from the commission ledger for the selected date range and filters. Payroll columns without a system source (PAYE, advances, etc.) are left blank.{!agentId ? <span className="block mt-1">Select an agent above to download that agent&apos;s detailed ledger lines (optional).</span> : null}</>}
              headerRight={
                <div className="flex flex-wrap items-center gap-2">
                  <ExportButton reportType="commissions" filters={filters} />
                  {agentId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const suffix = q ? `${q}&` : "?";
                        window.open(getApiBase() + `/api/reports/export/commissions${suffix}mode=ledger`, "_blank");
                      }}
                      data-testid="button-export-commission-ledger"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Agent ledger CSV
                    </Button>
                  )}
                </div>
              }
              contentClassName="overflow-x-auto"
              flush>
                {loadingCommissionSummary ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : commissionSummary.length === 0 ? (
                  <EmptyState title="No commission ledger activity in this period" data-testid="text-no-commissions" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">AGENT NAME</TableHead>
                        <TableHead className="w-6 p-1" aria-label="Spacer" />
                        <TableHead className="whitespace-nowrap">NUMBER OF POLICIES</TableHead>
                        <TableHead className="whitespace-nowrap">Groups</TableHead>
                        <TableHead className="whitespace-nowrap">Groups</TableHead>
                        <TableHead className="whitespace-nowrap">individ</TableHead>
                        <TableHead className="whitespace-nowrap">Individ</TableHead>
                        <TableHead className="whitespace-nowrap">Investm</TableHead>
                        <TableHead className="whitespace-nowrap">Clawb</TableHead>
                        <TableHead className="whitespace-nowrap">Call Cen</TableHead>
                        <TableHead className="whitespace-nowrap">Trips</TableHead>
                        <TableHead className="whitespace-nowrap">Cash se</TableHead>
                        <TableHead className="whitespace-nowrap">Basic</TableHead>
                        <TableHead className="whitespace-nowrap">Overtim</TableHead>
                        <TableHead className="whitespace-nowrap">TOTAL</TableHead>
                        <TableHead className="whitespace-nowrap">PA</TableHead>
                        <TableHead className="whitespace-nowrap">TAX LE</TableHead>
                        <TableHead className="whitespace-nowrap">CRED</TableHead>
                        <TableHead className="whitespace-nowrap">ADVAN</TableHead>
                        <TableHead className="whitespace-nowrap">POLICY DEDUCTI</TableHead>
                        <TableHead className="whitespace-nowrap">MEDICAL AID DEDUCTI</TableHead>
                        <TableHead className="whitespace-nowrap">UNPAID M</TableHead>
                        <TableHead className="whitespace-nowrap">NET P</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionSummary.map((row: any) => (
                        <TableRow key={row.agentId} data-testid={`row-commission-summary-${row.agentId}`}>
                          <TableCell className="font-medium whitespace-nowrap">{row.agentName}</TableCell>
                          <TableCell className="w-6 p-1" />
                          <TableCell>{row.numberOfPolicies}</TableCell>
                          <TableCell>{row.groupsCount}</TableCell>
                          <TableCell className="font-mono text-xs">{row.groupsCommission}</TableCell>
                          <TableCell>{row.individualsCount}</TableCell>
                          <TableCell className="font-mono text-xs">{row.individualsCommission}</TableCell>
                          <TableCell className="font-mono text-xs">{row.investment}</TableCell>
                          <TableCell className="font-mono text-xs">{row.clawback}</TableCell>
                          <TableCell className="font-mono text-xs">{row.callCenter}</TableCell>
                          <TableCell className="font-mono text-xs">{row.trips}</TableCell>
                          <TableCell className="font-mono text-xs">{row.cashSettlement}</TableCell>
                          <TableCell className="font-mono text-xs">{row.basic}</TableCell>
                          <TableCell className="font-mono text-xs">{row.overtime}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{row.total}</TableCell>
                          <TableCell className="text-xs">{row.paye}</TableCell>
                          <TableCell className="text-xs">{row.taxLevy}</TableCell>
                          <TableCell className="text-xs">{row.credit}</TableCell>
                          <TableCell className="text-xs">{row.advance}</TableCell>
                          <TableCell className="text-xs">{row.policyDeduction}</TableCell>
                          <TableCell className="text-xs">{row.medicalAidDeduction}</TableCell>
                          <TableCell className="text-xs">{row.unpaidMonths}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{row.netPay}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardSection>

            <CardSection title="Commission plans" icon={Percent} description="Configured commission rules for products (reference)." flush>
              {loadingCommissionPlans ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : commissionPlans.length === 0 ? (
                <EmptyState title="No commission plans recorded" className="border-0 rounded-none bg-transparent py-8" />
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
                      <TableRow key={cp.id} data-testid={`row-commission-plan-${cp.id}`}>
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
            </CardSection>
          </TabsContent>

          <TabsContent value="platform">
            <CardSection title="POL263 Platform Revenue Share" icon={Building} headerRight={<ExportButton reportType="platform" filters={filters} />} flush>
              {loadingPlatform ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : platformReceivables.length === 0 ? (
                <EmptyState title="No POL263 Platform receivables recorded" data-testid="text-no-platform-receivables" className="border-0 rounded-none bg-transparent py-8" />
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
                        <TableCell className="font-semibold">{cr.currency || "USD"} {cr.amount}</TableCell>
                        <TableCell>{cr.currency}</TableCell>
                        <TableCell><Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="conversions">
            <CardSection title="Policy conversions" icon={RotateCcw} description="Inactive to active conversions. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="conversions" filters={filters} />} flush>
              {loadingConversions ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : conversions.length === 0 ? (
                <EmptyState title="No conversions in this period" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>

          <TabsContent value="reinstatements">
            <CardSection title="Reinstated policies" icon={RotateCcw} description="Lapsed to active reinstatements. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="reinstatements" filters={filters} />} flush>
              {loadingReinstatements ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : reinstatements.length === 0 ? (
                <EmptyState title="No reinstatements in this period" data-testid="text-no-reinstatements" className="border-0 rounded-none bg-transparent py-8" />
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
            </CardSection>
          </TabsContent>
            </Tabs>
        </div>
      </PageShell>
    </StaffLayout>
  );
}
