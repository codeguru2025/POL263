import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart3, FileText, Loader2, CheckCircle, Clock, AlertCircle, UserCheck, RotateCcw } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

const policiesOverviewColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm">{p.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
  { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || 0), cell: (p) => <span className="tabular-nums">{p.currency} {p.premiumAmount}</span> },
  { id: "schedule", header: "Schedule", accessor: (p) => p.paymentSchedule },
  {
    id: "created",
    header: "Created",
    accessor: (p) => new Date(p.createdAt),
    cell: (p) => <span className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>,
  },
];

const policyDetailsColumns: EdtColumn<any>[] = [
  { id: "branch", header: "Branch", accessor: (r) => r.branchName || "" },
  { id: "memberNo", header: "Member No", accessor: (r) => r.memberNumber || "", cell: (r) => <span className="font-mono text-sm">{r.memberNumber || "—"}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "nationalId", header: "National ID", accessor: (r) => r.clientNationalId || "", cell: (r) => <span className="font-mono text-sm">{r.clientNationalId || "—"}</span> },
  { id: "firstName", header: "First Name", accessor: (r) => r.clientFirstName },
  { id: "surname", header: "Surname", accessor: (r) => r.clientLastName },
  { id: "address", header: "Address", accessor: (r) => r.clientAddress || "", cell: (r) => <span className="text-sm max-w-[200px] truncate block" title={r.clientAddress || ""}>{r.clientAddress || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (r) => r.clientPhone || "" },
  {
    id: "dob",
    header: "DOB",
    accessor: (r) => r.clientDateOfBirth ? new Date(r.clientDateOfBirth) : "",
    cell: (r) => <span className="text-sm whitespace-nowrap">{r.clientDateOfBirth ? new Date(r.clientDateOfBirth).toLocaleDateString() : "—"}</span>,
  },
  { id: "product", header: "Product", accessor: (r) => r.productName || "" },
  { id: "productCode", header: "Product Code", accessor: (r) => r.productCode || "", cell: (r) => <span className="font-mono text-sm">{r.productCode || "—"}</span> },
  {
    id: "inceptionDate",
    header: "Inception Date",
    accessor: (r) => r.inceptionDate ? new Date(r.inceptionDate) : "",
    cell: (r) => <span className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</span>,
  },
  { id: "premium", header: "Premium", accessor: (r) => parseFloat(r.premiumAmount || 0), cell: (r) => <span className="whitespace-nowrap">{r.currency} {r.premiumAmount}</span> },
  { id: "coverAmount", header: "Cover Amount", accessor: (r) => r.coverAmount || "", cell: (r) => <span className="whitespace-nowrap">{r.coverAmount ? `${r.coverCurrency || r.currency} ${r.coverAmount}` : "—"}</span> },
  { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} variant="policy" /> },
  {
    id: "dateAdded",
    header: "Date Added",
    accessor: (r) => r.policyCreatedAt ? new Date(r.policyCreatedAt) : "",
    cell: (r) => <span className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</span>,
  },
  { id: "group", header: "Group", accessor: (r) => r.groupName || "" },
  { id: "agent", header: "Agent", accessor: (r) => r.agentDisplayName || r.agentEmail || "" },
  { id: "beneficiary", header: "Beneficiary", accessor: (r) => [r.beneficiaryFirstName, r.beneficiaryLastName].filter(Boolean).join(" ") || "" },
  { id: "beneficiaryId", header: "Beneficiary ID", accessor: (r) => r.beneficiaryNationalId || "", cell: (r) => <span className="font-mono text-sm">{r.beneficiaryNationalId || "—"}</span> },
  { id: "beneficiaryPhone", header: "Beneficiary Phone", accessor: (r) => r.beneficiaryPhone || "" },
  { id: "beneficiaryRel", header: "Beneficiary Rel.", accessor: (r) => r.beneficiaryRelationship || "" },
  {
    id: "dependents",
    header: "Dependents",
    sortable: false,
    cell: (r) => (
      <span className="text-sm max-w-[300px] block">
        {r.dependents?.length > 0
          ? r.dependents.map((d: any, i: number) => (
              <span key={i} className="block whitespace-nowrap">{d.firstName} {d.lastName} ({d.relationship})</span>
            ))
          : "—"}
      </span>
    ),
  },
];

function policyListColumns(dateHeader: string, dateAccessor: (p: any) => any): EdtColumn<any>[] {
  return [
    { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
    { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
    { id: "firstName", header: "First Name", accessor: (p) => p.clientFirstName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientFirstName || "—"}</span> },
    { id: "surname", header: "Surname", accessor: (p) => p.clientLastName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientLastName || "—"}</span> },
    { id: "nationalId", header: "National ID", accessor: (p) => p.clientNationalId || "", cell: (p) => <span className="font-mono text-sm">{p.clientNationalId || "—"}</span> },
    { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
    { id: "product", header: "Product", accessor: (p) => p.productName || "" },
    { id: "branch", header: "Branch", accessor: (p) => p.branchName || "" },
    { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "" },
    { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || 0), cell: (p) => <span className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</span> },
    {
      id: "date",
      header: dateHeader,
      accessor: dateAccessor,
      cell: (p) => {
        const d = dateAccessor(p);
        return <span className="text-sm whitespace-nowrap">{d ? d.toLocaleDateString() : "—"}</span>;
      },
    },
    {
      id: "captureDate",
      header: "Capture Date",
      accessor: (p) => p.policyCreatedAt ? new Date(p.policyCreatedAt) : "",
      cell: (p) => <span className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</span>,
    },
  ];
}

const activePoliciesColumns = policyListColumns("Inception Date", (p) => p.inceptionDate ? new Date(p.inceptionDate) : "");
const lapsedPoliciesColumns = policyListColumns("Inception Date", (p) => p.inceptionDate ? new Date(p.inceptionDate) : "");

function graceListColumns(): EdtColumn<any>[] {
  return [
    { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
    { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
    { id: "firstName", header: "First Name", accessor: (p) => p.clientFirstName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientFirstName || "—"}</span> },
    { id: "surname", header: "Surname", accessor: (p) => p.clientLastName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientLastName || "—"}</span> },
    { id: "nationalId", header: "National ID", accessor: (p) => p.clientNationalId || "", cell: (p) => <span className="font-mono text-sm">{p.clientNationalId || "—"}</span> },
    { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
    { id: "product", header: "Product", accessor: (p) => p.productName || "" },
    { id: "branch", header: "Branch", accessor: (p) => p.branchName || "" },
    { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "" },
    { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || 0), cell: (p) => <span className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</span> },
    {
      id: "graceEnd",
      header: "Grace End",
      accessor: (p) => p.graceEndDate ? new Date(p.graceEndDate) : "",
      cell: (p) => <span className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</span>,
    },
    {
      id: "captureDate",
      header: "Capture Date",
      accessor: (p) => p.policyCreatedAt ? new Date(p.policyCreatedAt) : "",
      cell: (p) => <span className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</span>,
    },
  ];
}

const awaitingPaymentsColumns = graceListColumns();
const overduePoliciesColumns: EdtColumn<any>[] = graceListColumns().filter((c) => c.id !== "status");
const preLapsePoliciesColumns = graceListColumns();

const newJoiningsColumns: EdtColumn<any>[] = [
  { id: "franchiseBranchId", header: "Franchise_Branch_ID", accessor: (r) => r.Franchise_Branch_ID || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.Franchise_Branch_ID || "—"}</span> },
  { id: "franchiseBranchName", header: "Franchise_BranchName", accessor: (r) => r.Franchise_BranchName || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[120px] truncate block" title={r.Franchise_BranchName}>{r.Franchise_BranchName || "—"}</span> },
  { id: "marketingMemberId", header: "Marketing_Member_ID", accessor: (r) => r.Marketing_Member_ID || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.Marketing_Member_ID || "—"}</span> },
  { id: "policyNum", header: "Policy_num", accessor: (r) => r.Policy_num, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.Policy_num}</span> },
  { id: "inceptionDate", header: "Inception_Date", accessor: (r) => r.Inception_Date || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</span> },
  { id: "idNumber", header: "ID_Number", accessor: (r) => r.ID_Number || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.ID_Number || "—"}</span> },
  { id: "firstName", header: "First_Name", accessor: (r) => r.First_Name, cell: (r) => <span className="text-xs whitespace-nowrap">{r.First_Name}</span> },
  { id: "surname", header: "Surname", accessor: (r) => r.Surname, cell: (r) => <span className="text-xs whitespace-nowrap">{r.Surname}</span> },
  { id: "policyHolder", header: "PolicyHolder", accessor: (r) => r.PolicyHolder || "", cell: (r) => <span className="text-xs max-w-[140px] truncate block" title={r.PolicyHolder}>{r.PolicyHolder || "—"}</span> },
  { id: "title", header: "Title", accessor: (r) => r.Title || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Title || "—"}</span> },
  { id: "initials", header: "Initials", accessor: (r) => r.Initials || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Initials || "—"}</span> },
  { id: "usualPrem", header: "UsualPrem", accessor: (r) => r.UsualPrem || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.UsualPrem || "—"}</span> },
  { id: "cellNum", header: "Cell_Num", accessor: (r) => r.Cell_Num || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Cell_Num || "—"}</span> },
  { id: "physicalAdd", header: "PhysicalAdd", accessor: (r) => r.PhysicalAdd || "", cell: (r) => <span className="text-xs max-w-[140px] truncate block" title={r.PhysicalAdd}>{r.PhysicalAdd || "—"}</span> },
  { id: "postalAdd", header: "PostalAdd", accessor: (r) => r.PostalAdd || "", cell: (r) => <span className="text-xs max-w-[120px] truncate block" title={r.PostalAdd}>{r.PostalAdd || "—"}</span> },
  { id: "easyPayNo", header: "EasyPayNo", accessor: (r) => r.EasyPayNo || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.EasyPayNo || "—"}</span> },
  { id: "paymentM", header: "Payment_M", accessor: (r) => r.Payment_M || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Payment_M || "—"}</span> },
  { id: "stopOrder", header: "StopOrder", accessor: (r) => r.StopOrder || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.StopOrder || "—"}</span> },
  { id: "productN", header: "Product_N", accessor: (r) => r.Product_N || "", cell: (r) => <span className="text-xs max-w-[140px] truncate block" title={r.Product_N}>{r.Product_N || "—"}</span> },
  { id: "waitingPe", header: "Waiting_Pe", accessor: (r) => r.Waiting_Pe || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Waiting_Pe || "—"}</span> },
  { id: "internalRe", header: "InternalRe", accessor: (r) => r.InternalRe || "", cell: (r) => <span className="text-xs font-mono max-w-[120px] truncate block" title={r.InternalRe}>{r.InternalRe || "—"}</span> },
  { id: "agentNam", header: "AgentNam", accessor: (r) => r.AgentNam || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[100px] truncate block" title={r.AgentNam}>{r.AgentNam || "—"}</span> },
  { id: "maturityTe", header: "MaturityTe", accessor: (r) => r.MaturityTe || "", cell: (r) => <span className="text-xs max-w-[160px] truncate block" title={r.MaturityTe}>{r.MaturityTe || "—"}</span> },
  { id: "groupName", header: "GroupName", accessor: (r) => r.GroupName || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[100px] truncate block" title={r.GroupName}>{r.GroupName || "—"}</span> },
  { id: "idate", header: "Idate", accessor: (r) => r.Idate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Idate || "—"}</span> },
  { id: "tdate", header: "tdate", accessor: (r) => r.tdate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.tdate || "—"}</span> },
  { id: "status", header: "Status", accessor: (r) => r._status || "", cell: (r) => <Badge variant="outline" className="text-xs">{r._status || "—"}</Badge> },
  {
    id: "captured",
    header: "Captured",
    accessor: (r) => r._policyCreatedAt ? new Date(r._policyCreatedAt) : "",
    cell: (r) => <span className="text-xs text-muted-foreground whitespace-nowrap">{r._policyCreatedAt ? new Date(r._policyCreatedAt).toLocaleDateString() : "—"}</span>,
  },
];

function statusHistoryColumns(dateHeader: string, dateAccessor: (r: any) => any): EdtColumn<any>[] {
  return [
    { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm">{r.policyNumber}</span> },
    { id: "client", header: "Client", accessor: (r) => r.clientName },
    { id: "previousStatus", header: "Previous status", accessor: (r) => r.fromStatus || "", cell: (r) => <Badge variant="outline">{r.fromStatus || "—"}</Badge> },
    {
      id: "date",
      header: dateHeader,
      accessor: dateAccessor,
      cell: (r) => {
        const d = dateAccessor(r);
        return <span className="text-sm text-muted-foreground">{d ? d.toLocaleString() : "—"}</span>;
      },
    },
    { id: "reason", header: "Reason", accessor: (r) => r.reason || "" },
    {
      id: "currentStatus",
      header: "Current status",
      accessor: (r) => r.currentStatus,
      cell: (r) => <Badge variant={r.currentStatus === "active" ? "default" : "secondary"}>{r.currentStatus}</Badge>,
    },
  ];
}

const activationsColumns = statusHistoryColumns("Activated at", (r) => r.activatedAt ? new Date(r.activatedAt) : "");
const conversionsColumns = statusHistoryColumns("Converted at", (r) => r.convertedAt ? new Date(r.convertedAt) : "");
const reinstatementsColumns = statusHistoryColumns("Reinstated date", (r) => r.reinstatedAt ? new Date(r.reinstatedAt) : "");

export function PoliciesSection({ filters, q, qAppend, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["reports", "policies", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/policies?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("policies"),
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
  const { data: reinstatements = [], isLoading: loadingReinstatements } = useQuery<any[]>({
    queryKey: ["reports", "reinstatements", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/reinstatements" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("reinstatements"),
  });

  const policySummary = {
    inactive: policies.filter((p: any) => p.status === "inactive").length,
    active: policies.filter((p: any) => p.status === "active").length,
    grace: policies.filter((p: any) => p.status === "grace").length,
    lapsed: policies.filter((p: any) => p.status === "lapsed").length,
    cancelled: policies.filter((p: any) => p.status === "cancelled").length,
  };

  return (
    <>
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
            <EnhancedDataTable
              columns={policiesOverviewColumns}
              rows={policies}
              getRowKey={(p) => p.id}
              exportFilename="policies-overview"
              storageKey="reports-policies-overview"
              emptyMessage="No policies found."
            />
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
          ) : (
            <EnhancedDataTable
              columns={policyDetailsColumns}
              rows={policyDetails}
              getRowKey={(r) => r.policyId}
              rowTestId={(r) => `row-policy-detail-${r.policyId}`}
              exportFilename="policy-details"
              storageKey="reports-policy-details"
              emptyMessage="No policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="active-policies">
        <CardSection title="Active policies" icon={CheckCircle} description="Policies with status active. When from/to are set, results are limited to policies captured in that window." headerRight={<ExportButton reportType="active-policies" filters={filters} />} flush>
          {loadingActivePolicies ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={activePoliciesColumns}
              rows={activePolicies}
              getRowKey={(p) => p.policyId || p.id}
              exportFilename="active-policies"
              storageKey="reports-active-policies"
              emptyMessage="No active policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="awaiting-payments">
        <CardSection title="Policies Awaiting Payments" icon={Clock} description="Active and grace policies — awaiting premium payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="awaiting-payments" filters={filters} />} flush>
          {loadingAwaitingPayments ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={awaitingPaymentsColumns}
              rows={awaitingPayments}
              getRowKey={(p) => p.policyId || p.id}
              exportFilename="awaiting-payments"
              storageKey="reports-awaiting-payments"
              emptyMessage="No policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="overdue">
        <CardSection title="Overdue Payments (Grace)" icon={AlertCircle} description="Policies currently in grace period — payment overdue. Filter by branch, product, or agent." headerRight={<ExportButton reportType="overdue" filters={filters} />} flush>
          {loadingOverdue ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={overduePoliciesColumns}
              rows={overduePolicies}
              getRowKey={(p) => p.policyId || p.id}
              exportFilename="overdue-policies"
              storageKey="reports-overdue"
              emptyMessage="No policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="pre-lapse">
        <CardSection title="Pre-lapse (Grace period)" icon={AlertCircle} description="Policies in grace period at risk of lapsing. Filter by branch, product, or agent." headerRight={<ExportButton reportType="pre-lapse" filters={filters} />} flush>
          {loadingPreLapse ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={preLapsePoliciesColumns}
              rows={preLapsePolicies}
              getRowKey={(p) => p.policyId || p.id}
              exportFilename="pre-lapse-policies"
              storageKey="reports-pre-lapse"
              emptyMessage="No policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="lapsed">
        <CardSection title="Lapsed Policies" icon={AlertCircle} description="Policies that have lapsed due to non-payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="lapsed" filters={filters} />} flush>
          {loadingLapsed ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={lapsedPoliciesColumns}
              rows={lapsedPolicies}
              getRowKey={(p) => p.policyId || p.id}
              exportFilename="lapsed-policies"
              storageKey="reports-lapsed"
              emptyMessage="No policies match the filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="new-joinings">
        <CardSection title="New joinings report" icon={FileText} description="All policies captured in the date range (inactive through cancelled), paid or unpaid. Filter by branch, product, or agent above; status filter does not apply to this report." headerRight={<ExportButton reportType="new-joinings" filters={filters} />} flush>
          {loadingNewJoinings ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={newJoiningsColumns}
              rows={newJoinings}
              getRowKey={(r) => r._policyId || `${r.Policy_num}-${r._policyCreatedAt}`}
              exportFilename="new-joinings"
              storageKey="reports-new-joinings"
              emptyMessage="No policies in range. Set from/to dates or widen filters."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="activations">
        <CardSection title="Policy activations" icon={UserCheck} description="Rows when a policy moved to active (status history). From/to filter that event time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="activations" filters={filters} />} flush>
          {loadingActivations ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={activationsColumns}
              rows={activations}
              getRowKey={(r) => `${r.policyId}-${r.activatedAt}`}
              exportFilename="policy-activations"
              storageKey="reports-activations"
              emptyMessage="No activations in this period."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="conversions">
        <CardSection title="Policy conversions" icon={RotateCcw} description="Inactive to active conversions. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="conversions" filters={filters} />} flush>
          {loadingConversions ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={conversionsColumns}
              rows={conversions}
              getRowKey={(r) => `${r.policyId}-${r.convertedAt}`}
              exportFilename="policy-conversions"
              storageKey="reports-conversions"
              emptyMessage="No conversions in this period."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="reinstatements">
        <CardSection title="Reinstated policies" icon={RotateCcw} description="Lapsed to active reinstatements. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="reinstatements" filters={filters} />} flush>
          {loadingReinstatements ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={reinstatementsColumns}
              rows={reinstatements}
              getRowKey={(r) => `${r.policyId}-${r.reinstatedAt}`}
              rowTestId={(r) => `row-reinstatement-${r.policyId}`}
              exportFilename="reinstatements"
              storageKey="reports-reinstatements"
              emptyMessage="No reinstatements in this period."
            />
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
