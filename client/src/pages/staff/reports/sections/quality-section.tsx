import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, TrendingUp } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

type IntegrityIssue = { category: string; severity: "high" | "medium" | "low"; policyNumber: string; client: string; detail: string };
type CollectionRow = { branch: string; currency: string; expected: number; collected: number; collectionRate: number; policyCount: number };

const sevVariant = (s: string) => (s === "high" ? "destructive" : s === "medium" ? "default" : "secondary");

const integrityColumns: EdtColumn<IntegrityIssue>[] = [
  { id: "severity", header: "Severity", accessor: (r) => r.severity, cell: (r) => <Badge variant={sevVariant(r.severity)} className="capitalize text-[10px]">{r.severity}</Badge> },
  { id: "category", header: "Category", accessor: (r) => r.category, cell: (r) => <span className="whitespace-nowrap font-medium">{r.category}</span> },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm">{r.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (r) => r.client, cell: (r) => <span className="max-w-[260px] truncate block" title={r.client}>{r.client}</span> },
  { id: "detail", header: "What's wrong", sortable: false, accessor: (r) => r.detail, cell: (r) => <span className="text-sm text-muted-foreground max-w-[420px] block">{r.detail}</span> },
];

const collectionColumns: EdtColumn<CollectionRow>[] = [
  { id: "branch", header: "Branch", accessor: (r) => r.branch, cell: (r) => <span className="whitespace-nowrap font-medium">{r.branch}</span> },
  { id: "currency", header: "Currency", accessor: (r) => r.currency },
  { id: "policyCount", header: "Policies", align: "right", accessor: (r) => r.policyCount, cell: (r) => <span className="tabular-nums">{r.policyCount}</span> },
  { id: "expected", header: "Expected premium", align: "right", accessor: (r) => r.expected, cell: (r) => <span className="tabular-nums">{r.currency} {r.expected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
  { id: "collected", header: "Collected", align: "right", accessor: (r) => r.collected, cell: (r) => <span className="tabular-nums">{r.currency} {r.collected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> },
  {
    id: "rate", header: "Collection rate", align: "right", accessor: (r) => r.collectionRate,
    cell: (r) => <span className={`tabular-nums font-semibold ${r.collectionRate >= 90 ? "text-emerald-600" : r.collectionRate >= 70 ? "text-amber-600" : "text-destructive"}`}>{r.collectionRate}%</span>,
  },
];

export function QualitySection({ filters, q, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: integrity = [], isLoading: loadingIntegrity } = useQuery<IntegrityIssue[]>({
    queryKey: ["reports", "data-integrity", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/data-integrity", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("dataIntegrity"),
  });
  const { data: collection = [], isLoading: loadingCollection } = useQuery<CollectionRow[]>({
    queryKey: ["reports", "collection-efficiency", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/collection-efficiency" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("collectionEfficiency"),
  });

  const highCount = integrity.filter((i) => i.severity === "high").length;

  return (
    <>
      <TabsContent value="data-integrity">
        <CardSection
          title="Data integrity — exceptions"
          description="Records that are internally inconsistent and need a human to look at them — missing agent or beneficiary, zero premium, duplicate clients, policies with no principal member. Fix these before they surface as a failed claim or a wrong commission run."
          icon={ShieldAlert}
          headerRight={<ExportButton reportType="data-integrity" filters={filters} />}
          flush
        >
          {loadingIntegrity ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : integrity.length === 0 ? (
            <EmptyState title="No exceptions found" description="Every active/grace policy has an agent, a beneficiary, a valid premium and a principal member; no duplicate clients detected." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                <KpiStatCard label="Total exceptions" value={integrity.length} icon={ShieldAlert} />
                <KpiStatCard label="High severity" value={<span className={highCount > 0 ? "text-destructive" : ""}>{highCount}</span>} icon={ShieldAlert} />
                <KpiStatCard label="Categories" value={new Set(integrity.map((i) => i.category)).size} icon={ShieldAlert} />
              </div>
              <EnhancedDataTable
                columns={integrityColumns}
                rows={integrity.map((r, i) => ({ ...r, _k: i }))}
                getRowKey={(r: any) => String(r._k)}
                exportFilename="data-integrity"
                storageKey="reports-data-integrity"
                emptyMessage="No exceptions found."
              />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="collection-efficiency">
        <CardSection
          title="Premium collection efficiency"
          description="Expected premium (one billing cycle per active/grace policy) vs premium actually collected (issued receipts) in the selected period, and the collection rate, by branch and currency. Cash basis."
          icon={TrendingUp}
          headerRight={<ExportButton reportType="collection-efficiency" filters={filters} />}
          flush
        >
          {loadingCollection ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : collection.length === 0 ? (
            <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <EnhancedDataTable
              columns={collectionColumns}
              rows={collection.map((r, i) => ({ ...r, _k: i }))}
              getRowKey={(r: any) => String(r._k)}
              exportFilename="collection-efficiency"
              storageKey="reports-collection-efficiency"
              emptyMessage="No data for the selected period."
            />
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
