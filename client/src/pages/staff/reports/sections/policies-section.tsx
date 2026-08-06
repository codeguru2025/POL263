import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { BarChart3, FileText, Loader2, CheckCircle, Clock, AlertCircle, UserCheck, RotateCcw } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

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

      <TabsContent value="active-policies">
        <CardSection title="Active policies" icon={CheckCircle} description="Policies with status active. When from/to are set, results are limited to policies captured in that window." headerRight={<ExportButton reportType="active-policies" filters={filters} />} flush>
          {loadingActivePolicies ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activePolicies.length === 0 ? (
            <EmptyState title="No active policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Inception Date</TableHead>
                    <TableHead>Capture Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activePolicies.slice(0, 100).map((p: any) => (
                    <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                      <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                      <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                      <TableCell>{p.branchName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.inceptionDate ? new Date(p.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="awaiting-payments">
        <CardSection title="Policies Awaiting Payments" icon={Clock} description="Active and grace policies — awaiting premium payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="awaiting-payments" filters={filters} />} flush>
          {loadingAwaitingPayments ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : awaitingPayments.length === 0 ? (
            <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Grace End</TableHead>
                    <TableHead>Capture Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {awaitingPayments.slice(0, 100).map((p: any) => (
                    <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                      <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                      <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                      <TableCell>{p.branchName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="overdue">
        <CardSection title="Overdue Payments (Grace)" icon={AlertCircle} description="Policies currently in grace period — payment overdue. Filter by branch, product, or agent." headerRight={<ExportButton reportType="overdue" filters={filters} />} flush>
          {loadingOverdue ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : overduePolicies.length === 0 ? (
            <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Grace End</TableHead>
                    <TableHead>Capture Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overduePolicies.slice(0, 100).map((p: any) => (
                    <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                      <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                      <TableCell>{p.branchName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="pre-lapse">
        <CardSection title="Pre-lapse (Grace period)" icon={AlertCircle} description="Policies in grace period at risk of lapsing. Filter by branch, product, or agent." headerRight={<ExportButton reportType="pre-lapse" filters={filters} />} flush>
          {loadingPreLapse ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : preLapsePolicies.length === 0 ? (
            <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Grace End</TableHead>
                    <TableHead>Capture Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preLapsePolicies.slice(0, 100).map((p: any) => (
                    <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                      <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                      <TableCell>{p.branchName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="lapsed">
        <CardSection title="Lapsed Policies" icon={AlertCircle} description="Policies that have lapsed due to non-payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="lapsed" filters={filters} />} flush>
          {loadingLapsed ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : lapsedPolicies.length === 0 ? (
            <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Inception Date</TableHead>
                    <TableHead>Capture Date</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lapsedPolicies.slice(0, 100).map((p: any) => (
                    <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                      <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                      <TableCell>{p.branchName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.inceptionDate ? new Date(p.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
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
    </>
  );
}
