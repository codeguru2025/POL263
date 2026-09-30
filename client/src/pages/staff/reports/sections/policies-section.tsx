import { useQuery, useInfiniteQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { FileText, Loader2, Clock, AlertCircle, UserCheck, RotateCcw } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";
import { PolicyOverviewPanel } from "./policy-overview-panel";
import { ActivePoliciesPanel } from "./active-policies-panel";
import { AwaitingPaymentsPanel } from "./awaiting-payments-panel";
import { GracePoliciesPanel } from "./grace-policies-panel";
import { LapsedPoliciesPanel } from "./lapsed-policies-panel";
import { NewJoiningsPanel } from "./new-joinings-panel";
import { isLegacyPreLapseLink } from "@/lib/staff-reports-nav";

const POLICY_DETAILS_PAGE = 500;

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
  { id: "agent", header: "Agent", accessor: (r) => r.agentDisplayName || r.agentEmail || "Walk-in" },
  { id: "beneficiary", header: "Beneficiary", accessor: (r) => [r.beneficiaryFirstName, r.beneficiaryLastName].filter(Boolean).join(" ") || "" },
  { id: "beneficiaryId", header: "Beneficiary ID", accessor: (r) => r.beneficiaryNationalId || "", cell: (r) => <span className="font-mono text-sm">{r.beneficiaryNationalId || "—"}</span> },
  { id: "beneficiaryPhone", header: "Beneficiary Phone", accessor: (r) => r.beneficiaryPhone || "" },
  { id: "beneficiaryRel", header: "Beneficiary Rel.", accessor: (r) => r.beneficiaryRelationship || "" },
  { id: "dependentCount", header: "Dependants", accessor: (r) => r.dependents?.length ?? 0, cell: (r) => <span className="tabular-nums">{r.dependents?.length ?? 0}</span> },
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
  // Paged: the server sends X-Total-Count so the table can say "showing X of Y" and load the rest
  // (it used to stop silently at 500 rows).
  const policyDetailsQuery = useInfiniteQuery<{ rows: any[]; total: number }>({
    queryKey: ["reports", "policy-details", runKey, ...fk],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const res = await fetch(getApiBase() + `/api/reports/policy-details?limit=${POLICY_DETAILS_PAGE}&offset=${pageParam}` + qAppend, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the policy report");
      const rows = await res.json();
      return { rows, total: Number(res.headers.get("X-Total-Count")) || rows.length };
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.total && last.rows.length > 0 ? loaded : undefined;
    },
    enabled: need("policyDetails"),
  });
  const policyDetails = policyDetailsQuery.data?.pages.flatMap((p) => p.rows) ?? [];
  const policyDetailsTotal = policyDetailsQuery.data?.pages[0]?.total ?? 0;
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

  return (
    <>
      <TabsContent value="policies">
        <PolicyOverviewPanel filters={filters} runKey={runKey} fk={fk} enabled={need("policies")} />
      </TabsContent>

      <TabsContent value="policy-details">
        <CardSection
          title="Policy report (full details)"
          description="Every policy with its client, product, beneficiary and the dependants that policy covers today. Export gives each dependant their own columns. Use filters above to narrow results."
          icon={FileText}
          headerRight={<ExportButton reportType="policy-details" filters={filters} />}
          flush
        >
          {policyDetailsQuery.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : policyDetailsQuery.isError ? (
            <p className="text-sm text-destructive py-6 text-center">{(policyDetailsQuery.error as Error).message}. Try again.</p>
          ) : (
            <>
              <EnhancedDataTable
                columns={policyDetailsColumns}
                rows={policyDetails}
                getRowKey={(r) => r.policyId}
                rowTestId={(r) => `row-policy-detail-${r.policyId}`}
                exportFilename="policy-details"
                storageKey="reports-policy-details"
                emptyMessage="No policies match the filters."
              />
              <div className="flex items-center justify-between gap-3 p-3 text-sm text-muted-foreground">
                <span>Showing {policyDetails.length.toLocaleString()} of {policyDetailsTotal.toLocaleString()} policies</span>
                {policyDetailsQuery.hasNextPage && (
                  <Button variant="outline" size="sm" onClick={() => policyDetailsQuery.fetchNextPage()} disabled={policyDetailsQuery.isFetchingNextPage} data-testid="button-policy-details-load-more">
                    {policyDetailsQuery.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Load {Math.min(POLICY_DETAILS_PAGE, policyDetailsTotal - policyDetails.length).toLocaleString()} more
                  </Button>
                )}
              </div>
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="active-policies">
        <ActivePoliciesPanel filters={filters} runKey={runKey} fk={fk} enabled={need("activePolicies")} />
      </TabsContent>

      <TabsContent value="awaiting-payments">
        <AwaitingPaymentsPanel filters={filters} runKey={runKey} fk={fk} enabled={need("awaitingPayments")} />
      </TabsContent>

      <TabsContent value="overdue">
        <GracePoliciesPanel
          filters={filters}
          runKey={runKey}
          fk={fk}
          enabled={need("overduePolicies")}
          initialLapseWithinDays={typeof window !== "undefined" && isLegacyPreLapseLink(window.location.search) ? 7 : undefined}
        />
      </TabsContent>

      <TabsContent value="lapsed">
        <LapsedPoliciesPanel filters={filters} runKey={runKey} fk={fk} enabled={need("lapsedPolicies")} />
      </TabsContent>

      <TabsContent value="new-joinings">
        <NewJoiningsPanel filters={filters} runKey={runKey} fk={fk} enabled={need("newJoinings")} />
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
