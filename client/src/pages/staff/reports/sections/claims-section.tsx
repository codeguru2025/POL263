import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Clock, TrendingDown } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

type ClaimAgingRow = { claimNumber: string; policyNumber: string; deceased: string; status: string; branch: string; daysOpen: number; bucket: string; currency: string; amount: number; overdue: boolean };
type ClaimsAnalytics = {
  lossRatio: { currency: string; claimsIncurred: number; premiumCollected: number; ratio: number }[];
  repudiation: { claimType: string; submitted: number; approved: number; rejected: number; repudiationRate: number }[];
};

const agingColumns: EdtColumn<ClaimAgingRow>[] = [
  { id: "claim", header: "Claim #", accessor: (r) => r.claimNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.claimNumber}</span> },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "deceased", header: "Deceased", accessor: (r) => r.deceased },
  { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} variant="claim" /> },
  { id: "branch", header: "Branch", accessor: (r) => r.branch },
  { id: "days", header: "Days open", align: "right", accessor: (r) => r.daysOpen, cell: (r) => <span className={`tabular-nums ${r.overdue ? "text-destructive font-semibold" : ""}`}>{r.daysOpen}</span> },
  { id: "bucket", header: "Aging", accessor: (r) => r.bucket, cell: (r) => <Badge variant={r.overdue ? "destructive" : "secondary"} className="text-[10px]">{r.bucket}</Badge> },
  { id: "amount", header: "Amount", align: "right", accessor: (r) => r.amount, cell: (r) => <span className="tabular-nums">{r.amount > 0 ? `${r.currency} ${r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</span> },
];

const columns: EdtColumn<any>[] = [
  { id: "claimNumber", header: "Claim #", accessor: (c) => c.claimNumber, cell: (c) => <span className="font-mono text-sm whitespace-nowrap">{c.claimNumber}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (c) => c.policyNumber || "", cell: (c) => <span className="font-mono text-sm whitespace-nowrap">{c.policyNumber || "—"}</span> },
  { id: "type", header: "Type", accessor: (c) => c.claimType, cell: (c) => <Badge variant="outline">{c.claimType}</Badge> },
  { id: "status", header: "Status", accessor: (c) => c.status, cell: (c) => <StatusBadge status={c.status} variant="claim" /> },
  { id: "firstName", header: "First Name", accessor: (c) => c.clientFirstName || "" },
  { id: "surname", header: "Surname", accessor: (c) => c.clientLastName || "" },
  { id: "nationalId", header: "National ID", accessor: (c) => c.clientNationalId || "", cell: (c) => <span className="font-mono text-sm">{c.clientNationalId || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (c) => c.clientPhone || "" },
  { id: "branch", header: "Branch", accessor: (c) => c.branchName || "" },
  { id: "deceased", header: "Deceased", accessor: (c) => c.deceasedName || "" },
  {
    id: "dateOfDeath",
    header: "Date of Death",
    accessor: (c) => c.dateOfDeath ? new Date(c.dateOfDeath) : "",
    cell: (c) => <span className="text-sm whitespace-nowrap">{c.dateOfDeath ? new Date(c.dateOfDeath).toLocaleDateString() : "—"}</span>,
  },
  {
    id: "approvedAmount",
    header: "Approved Amount",
    accessor: (c) => c.approvedAmount ? parseFloat(c.approvedAmount) : "",
    cell: (c) => <span className="font-semibold tabular-nums">{c.approvedAmount ? `${c.currency || "USD"} ${c.approvedAmount}` : "—"}</span>,
  },
  {
    id: "submitted",
    header: "Submitted",
    accessor: (c) => c.createdAt ? new Date(c.createdAt) : "",
    cell: (c) => <span className="text-sm text-muted-foreground whitespace-nowrap">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</span>,
  },
];

export function ClaimsSection({ filters, q, qAppend, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: claimsReport = [], isLoading: loadingClaimsReport } = useQuery<any[]>({
    queryKey: ["reports", "claims-report", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("claimsReport"),
  });
  const { data: aging = [], isLoading: loadingAging } = useQuery<ClaimAgingRow[]>({
    queryKey: ["reports", "claims-aging", runKey],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/claims-aging", { credentials: "include" })).json().catch(() => []),
    enabled: need("claimsAging"),
  });
  const { data: analytics, isLoading: loadingAnalytics } = useQuery<ClaimsAnalytics | null>({
    queryKey: ["reports", "claims-analytics", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims-analytics" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("claimsAnalytics"),
  });

  const overdueCount = aging.filter((a) => a.overdue).length;

  return (
    <>
      <TabsContent value="claims">
        <CardSection title="Claims register" icon={FileText} description="Claims with policyholder details. Filter by date range, branch, or claim status." headerRight={<ExportButton reportType="claims" filters={filters} />} flush>
          {loadingClaimsReport ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable columns={columns} rows={claimsReport} getRowKey={(c) => c.claimId} exportFilename="claims-report" storageKey="reports-claims" emptyMessage="No claims match the filters." />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="claims-aging">
        <CardSection title="Claims aging" icon={Clock} description="Every open claim (not yet paid, rejected or closed) by how long it has been open. “Overdue” is more than 14 days open — the SLA target." headerRight={<ExportButton reportType="claims-aging" filters={filters} />} flush>
          {loadingAging ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : aging.length === 0 ? (
            <EmptyState title="No open claims" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                <KpiStatCard label="Open claims" value={aging.length} icon={Clock} />
                <KpiStatCard label="Overdue (>14 days)" value={<span className={overdueCount > 0 ? "text-destructive" : ""}>{overdueCount}</span>} icon={Clock} />
                <KpiStatCard label="Oldest (days)" value={aging[0]?.daysOpen ?? 0} icon={Clock} />
              </div>
              <EnhancedDataTable columns={agingColumns} rows={aging.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="claims-aging" storageKey="reports-claims-aging" emptyMessage="No open claims." />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="claims-analytics">
        <CardSection title="Loss ratio & repudiation" icon={TrendingDown} description="Loss ratio = claim payouts for claims raised in the period ÷ premium collected in the period (cash basis, per currency). Repudiation = declined claims as a share of claims raised, by claim type." headerRight={<ExportButton reportType="claims-analytics" filters={filters} />} flush>
          {loadingAnalytics ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !analytics || (analytics.lossRatio.length === 0 && analytics.repudiation.length === 0) ? (
            <EmptyState title="No claims or premium in this period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="p-4 space-y-6">
              <div>
                <p className="text-sm font-semibold mb-2">Loss ratio</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {analytics.lossRatio.map((l) => (
                    <div key={l.currency} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{l.currency}</p>
                      <p className={`text-lg font-bold tabular-nums ${l.ratio > 70 ? "text-destructive" : l.ratio > 50 ? "text-amber-600" : "text-emerald-600"}`}>{l.ratio}%</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{l.claimsIncurred.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} claims / {l.premiumCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} premium</p>
                    </div>
                  ))}
                </div>
              </div>
              {analytics.repudiation.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">Repudiation by claim type</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr><th className="text-left px-3 py-2">Claim type</th><th className="text-right px-3 py-2">Submitted</th><th className="text-right px-3 py-2">Approved</th><th className="text-right px-3 py-2">Rejected</th><th className="text-right px-3 py-2">Repudiation rate</th></tr>
                      </thead>
                      <tbody>
                        {analytics.repudiation.map((r) => (
                          <tr key={r.claimType} className="border-t">
                            <td className="px-3 py-2 capitalize">{r.claimType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.submitted}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.approved}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-destructive">{r.rejected}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.repudiationRate > 20 ? "text-destructive" : ""}`}>{r.repudiationRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
