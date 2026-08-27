import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, TrendingUp, Activity, RotateCcw, Users } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

type IntegrityIssue = { category: string; severity: "high" | "medium" | "low"; policyNumber: string; client: string; detail: string };
type CollectionRow = { branch: string; currency: string; expected: number; collected: number; collectionRate: number; policyCount: number };
type PersistencyRow = { cohort: string; monthsElapsed: number; incepted: number; active: number; grace: number; lapsed: number; cancelled: number; persistency: number };
type LapseAnalysis = { months: { month: string; lapses: number; reinstatements: number }[]; totalLapses: number; totalReinstatements: number; inForceNow: number; approxLapseRate: number };
type MovementRow = { date: string; action: "Added" | "Removed"; policyNumber: string; member: string; actor: string };

const sevVariant = (s: string) => (s === "high" ? "destructive" : s === "medium" ? "default" : "secondary");
const money = (n: number, c: string) => `${c} ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rateColor = (r: number) => (r >= 90 ? "text-emerald-600" : r >= 70 ? "text-amber-600" : "text-destructive");

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
  { id: "expected", header: "Expected premium", align: "right", accessor: (r) => r.expected, cell: (r) => <span className="tabular-nums">{money(r.expected, r.currency)}</span> },
  { id: "collected", header: "Collected", align: "right", accessor: (r) => r.collected, cell: (r) => <span className="tabular-nums">{money(r.collected, r.currency)}</span> },
  { id: "rate", header: "Collection rate", align: "right", accessor: (r) => r.collectionRate, cell: (r) => <span className={`tabular-nums font-semibold ${rateColor(r.collectionRate)}`}>{r.collectionRate}%</span> },
];

const persistencyColumns: EdtColumn<PersistencyRow>[] = [
  { id: "cohort", header: "Inception cohort", accessor: (r) => r.cohort, cell: (r) => <span className="font-mono text-sm">{r.cohort}</span> },
  { id: "months", header: "Months elapsed", align: "right", accessor: (r) => r.monthsElapsed, cell: (r) => <span className="tabular-nums">{r.monthsElapsed}</span> },
  { id: "incepted", header: "Incepted", align: "right", accessor: (r) => r.incepted, cell: (r) => <span className="tabular-nums">{r.incepted}</span> },
  { id: "active", header: "Active", align: "right", accessor: (r) => r.active, cell: (r) => <span className="tabular-nums">{r.active}</span> },
  { id: "grace", header: "In grace", align: "right", accessor: (r) => r.grace, cell: (r) => <span className="tabular-nums">{r.grace}</span> },
  { id: "lapsed", header: "Lapsed", align: "right", accessor: (r) => r.lapsed, cell: (r) => <span className="tabular-nums">{r.lapsed}</span> },
  { id: "cancelled", header: "Cancelled", align: "right", accessor: (r) => r.cancelled, cell: (r) => <span className="tabular-nums">{r.cancelled}</span> },
  { id: "persistency", header: "Persistency", align: "right", accessor: (r) => r.persistency, cell: (r) => <span className={`tabular-nums font-semibold ${rateColor(r.persistency)}`}>{r.persistency}%</span> },
];

const movementColumns: EdtColumn<MovementRow>[] = [
  { id: "date", header: "Date", accessor: (r) => r.date, cell: (r) => <span className="text-sm whitespace-nowrap">{r.date ? new Date(r.date).toLocaleString() : "—"}</span> },
  { id: "action", header: "Action", accessor: (r) => r.action, cell: (r) => <Badge variant={r.action === "Added" ? "default" : "secondary"}>{r.action}</Badge> },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm">{r.policyNumber}</span> },
  { id: "member", header: "Member", accessor: (r) => r.member },
  { id: "actor", header: "By", accessor: (r) => r.actor, cell: (r) => <span className="text-sm text-muted-foreground">{r.actor}</span> },
];

const lapseColumns: EdtColumn<{ month: string; lapses: number; reinstatements: number }>[] = [
  { id: "month", header: "Month", accessor: (r) => r.month, cell: (r) => <span className="font-mono text-sm">{r.month}</span> },
  { id: "lapses", header: "Lapses", align: "right", accessor: (r) => r.lapses, cell: (r) => <span className="tabular-nums text-destructive">{r.lapses}</span> },
  { id: "reinstatements", header: "Reinstatements", align: "right", accessor: (r) => r.reinstatements, cell: (r) => <span className="tabular-nums text-emerald-600">{r.reinstatements}</span> },
];

export function QualitySection({ filters, q, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: persistency = [], isLoading: loadingPersistency } = useQuery<PersistencyRow[]>({
    queryKey: ["reports", "persistency", runKey],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/persistency", { credentials: "include" })).json().catch(() => []),
    enabled: need("persistency"),
  });
  const { data: lapse, isLoading: loadingLapse } = useQuery<LapseAnalysis | null>({
    queryKey: ["reports", "lapse-analysis", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapse-analysis" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("lapseAnalysis"),
  });
  const { data: collection = [], isLoading: loadingCollection } = useQuery<CollectionRow[]>({
    queryKey: ["reports", "collection-efficiency", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/collection-efficiency" + q, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: need("collectionEfficiency"),
  });
  const { data: movement = [], isLoading: loadingMovement } = useQuery<MovementRow[]>({
    queryKey: ["reports", "member-movement", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/member-movement" + q, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: need("memberMovement"),
  });
  const { data: integrity = [], isLoading: loadingIntegrity } = useQuery<IntegrityIssue[]>({
    queryKey: ["reports", "data-integrity", runKey],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/data-integrity", { credentials: "include" })).json().catch(() => []),
    enabled: need("dataIntegrity"),
  });

  const highCount = integrity.filter((i) => i.severity === "high").length;
  const p13 = persistency.find((r) => r.monthsElapsed >= 13 && r.monthsElapsed < 16);
  const p25 = persistency.find((r) => r.monthsElapsed >= 25 && r.monthsElapsed < 28);

  return (
    <>
      <TabsContent value="persistency">
        <CardSection
          title="Persistency by inception cohort"
          description="For each month's intake of policies, how many are still on the books today. “Persistency %” is (active + in-grace) ÷ incepted — as-of-now survivorship, not a snapshot at exactly month 13/25. The 13- and 25-month cohorts are the ones the industry watches."
          icon={Activity}
          headerRight={<ExportButton reportType="persistency" filters={filters} />}
          flush
        >
          {loadingPersistency ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : persistency.length === 0 ? (
            <EmptyState title="No cohorts yet" description="No policies with an inception date at least two months ago." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                <KpiStatCard label="13-month persistency" value={p13 ? <span className={rateColor(p13.persistency)}>{p13.persistency}%</span> : "—"} icon={Activity} />
                <KpiStatCard label="25-month persistency" value={p25 ? <span className={rateColor(p25.persistency)}>{p25.persistency}%</span> : "—"} icon={Activity} />
                <KpiStatCard label="Cohorts tracked" value={persistency.length} icon={Activity} />
              </div>
              <EnhancedDataTable columns={persistencyColumns} rows={persistency.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="persistency" storageKey="reports-persistency" emptyMessage="No cohorts." />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="lapse-analysis">
        <CardSection
          title="Lapse & reinstatement analysis"
          description="Policies that lapsed and were reinstated in the selected period, by month, from the status history. The period lapse rate is approximate — lapses ÷ (in-force now + lapses in period); the system keeps no point-in-time in-force count for a clean denominator."
          icon={RotateCcw}
          headerRight={<ExportButton reportType="lapse-analysis" filters={filters} />}
          flush
        >
          {loadingLapse ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !lapse || lapse.months.length === 0 ? (
            <EmptyState title="No lapse activity in this period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
                <KpiStatCard label="Lapses" value={<span className="text-destructive">{lapse.totalLapses}</span>} icon={RotateCcw} />
                <KpiStatCard label="Reinstatements" value={<span className="text-emerald-600">{lapse.totalReinstatements}</span>} icon={RotateCcw} />
                <KpiStatCard label="In force now" value={lapse.inForceNow} icon={Activity} />
                <KpiStatCard label="Approx. lapse rate" value={<span className={rateColor(100 - lapse.approxLapseRate)}>{lapse.approxLapseRate}%</span>} icon={TrendingUp} />
              </div>
              <EnhancedDataTable columns={lapseColumns} rows={lapse.months.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="lapse-analysis" storageKey="reports-lapse-analysis" emptyMessage="No months." />
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
            <EnhancedDataTable columns={collectionColumns} rows={collection.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="collection-efficiency" storageKey="reports-collection-efficiency" emptyMessage="No data for the selected period." />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="member-movement">
        <CardSection
          title="Member / dependant movement"
          description="Lives added to and removed from policies in the selected period, from the audit trail. Useful for underwriter reporting and scheme reconciliation."
          icon={Users}
          headerRight={<ExportButton reportType="member-movement" filters={filters} />}
          flush
        >
          {loadingMovement ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : movement.length === 0 ? (
            <EmptyState title="No member movement in this period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <EnhancedDataTable columns={movementColumns} rows={movement.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="member-movement" storageKey="reports-member-movement" emptyMessage="No movement." />
          )}
        </CardSection>
      </TabsContent>

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
              <EnhancedDataTable columns={integrityColumns} rows={integrity.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="data-integrity" storageKey="reports-data-integrity" emptyMessage="No exceptions found." />
            </>
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
