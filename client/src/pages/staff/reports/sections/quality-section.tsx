import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, ShieldAlert, TrendingUp, Activity, RotateCcw, Users, CalendarClock } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

type IntegrityIssue = { category: string; severity: "high" | "medium" | "low"; policyNumber: string; client: string; detail: string };
type CollectionRow = { branch: string; currency: string; expected: number; collected: number; collectionRate: number; policyCount: number };
type PersistencyRow = { cohort: string; monthsSinceSale: number | null; sold: number; neverPaid: number; notTakenUpPct: number | null; startedPaying: number; inForce: number; lapsed: number; cancelled: number; persistencyPct: number | null };
type PersistencyData = { cohorts: PersistencyRow[]; typedIn: PersistencyRow };
type LapseMonth = { month: string; inForceAtStart: number; intoGrace: number; recovered: number; lapsed: number; reinstated: number; lapseRatePct: number | null };
type LapsedPolicy = { policyNumber: string; client: string; phone: string; agent: string; typedIn: boolean; product: string; currency: string; premium: string; lapsedOn: string | null; paidUpTo: string | null; lastPaymentDate: string | null; lastPaymentAmount: string | null };
type LapseAnalysis = {
  months: LapseMonth[]; totals: { lapsed: number; intoGrace: number; recovered: number; reinstated: number }; graceSavePct: number | null;
  byDuration: { duration: string; newSales: number; typedIn: number }[]; byAgent: { agent: string; newSales: number; typedIn: number }[]; lapsedNow: LapsedPolicy[];
};
type MovementRow = { date: string; action: "Added" | "Removed"; policyNumber: string; member: string; actor: string };
type AnnivRow = { policyNumber: string; client: string; phone: string; product: string; branch: string; currency: string; premium: string; inceptionDate: string; nextAnniversary: string; daysUntil: number; yearsInForce: number };

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

const pctCell = (v: number | null, goodHigh: boolean) => v == null ? <span className="text-muted-foreground">—</span>
  : <span className={`tabular-nums font-semibold ${goodHigh ? rateColor(v) : v > 40 ? "text-destructive" : v > 20 ? "text-amber-600" : "text-emerald-600"}`}>{v}%</span>;
const monthLabel = (c: string) => (c === "typed-in" ? "Existing policies typed in" : new Date(c + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" }));
const persistencyColumns: EdtColumn<PersistencyRow>[] = [
  { id: "cohort", header: "Month sold", accessor: (r) => r.cohort, cell: (r) => <span className={`whitespace-nowrap ${r.cohort === "typed-in" ? "italic text-muted-foreground" : "font-medium"}`}>{monthLabel(r.cohort)}</span> },
  { id: "months", header: "Months since", align: "right", accessor: (r) => r.monthsSinceSale ?? -1, cell: (r) => <span className="tabular-nums">{r.monthsSinceSale ?? "—"}</span> },
  { id: "sold", header: "Sold", align: "right", accessor: (r) => r.sold, cell: (r) => <span className="tabular-nums">{r.sold}</span> },
  { id: "neverPaid", header: "Never paid", align: "right", accessor: (r) => r.neverPaid, cell: (r) => <span className="tabular-nums">{r.neverPaid}</span> },
  { id: "ntu", header: "Not taken up", align: "right", accessor: (r) => r.notTakenUpPct ?? -1, cell: (r) => pctCell(r.notTakenUpPct, false) },
  { id: "started", header: "Started paying", align: "right", accessor: (r) => r.startedPaying, cell: (r) => <span className="tabular-nums">{r.startedPaying}</span> },
  { id: "inForce", header: "Still in force", align: "right", accessor: (r) => r.inForce, cell: (r) => <span className="tabular-nums">{r.inForce}</span> },
  { id: "lapsed", header: "Lapsed", align: "right", accessor: (r) => r.lapsed, cell: (r) => <span className="tabular-nums">{r.lapsed}</span> },
  { id: "cancelled", header: "Cancelled", align: "right", accessor: (r) => r.cancelled, cell: (r) => <span className="tabular-nums">{r.cancelled}</span> },
  { id: "persistency", header: "Persistency", align: "right", accessor: (r) => r.persistencyPct ?? -1, cell: (r) => pctCell(r.persistencyPct, true) },
];

const movementColumns: EdtColumn<MovementRow>[] = [
  { id: "date", header: "Date", accessor: (r) => r.date, cell: (r) => <span className="text-sm whitespace-nowrap">{r.date ? new Date(r.date).toLocaleString() : "—"}</span> },
  { id: "action", header: "Action", accessor: (r) => r.action, cell: (r) => <Badge variant={r.action === "Added" ? "default" : "secondary"}>{r.action}</Badge> },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm">{r.policyNumber}</span> },
  { id: "member", header: "Member", accessor: (r) => r.member },
  { id: "actor", header: "By", accessor: (r) => r.actor, cell: (r) => <span className="text-sm text-muted-foreground">{r.actor}</span> },
];

const annivColumns: EdtColumn<AnnivRow>[] = [
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (r) => r.client },
  { id: "phone", header: "Phone", accessor: (r) => r.phone },
  { id: "product", header: "Product", accessor: (r) => r.product },
  { id: "branch", header: "Branch", accessor: (r) => r.branch },
  { id: "premium", header: "Premium", align: "right", accessor: (r) => parseFloat(r.premium || "0"), cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.currency} {r.premium}</span> },
  { id: "years", header: "Years in force", align: "right", accessor: (r) => r.yearsInForce, cell: (r) => <span className="tabular-nums">{r.yearsInForce}</span> },
  { id: "next", header: "Next anniversary", accessor: (r) => r.nextAnniversary, cell: (r) => <span className="text-sm whitespace-nowrap">{r.nextAnniversary}</span> },
  { id: "days", header: "Days until", align: "right", accessor: (r) => r.daysUntil, cell: (r) => <span className={`tabular-nums ${r.daysUntil <= 14 ? "text-amber-600 font-semibold" : ""}`}>{r.daysUntil}</span> },
];

const lapseColumns: EdtColumn<LapseMonth>[] = [
  { id: "month", header: "Month", accessor: (r) => r.month, cell: (r) => <span className="text-sm whitespace-nowrap">{new Date(r.month + "-01T00:00:00").toLocaleDateString(undefined, { month: "short", year: "numeric" })}</span> },
  { id: "inForce", header: "In force at start", align: "right", accessor: (r) => r.inForceAtStart, cell: (r) => <span className="tabular-nums">{r.inForceAtStart}</span> },
  { id: "grace", header: "Into grace", align: "right", accessor: (r) => r.intoGrace, cell: (r) => <span className="tabular-nums text-amber-600">{r.intoGrace}</span> },
  { id: "recovered", header: "Paid their way back", align: "right", accessor: (r) => r.recovered, cell: (r) => <span className="tabular-nums text-emerald-600">{r.recovered}</span> },
  { id: "lapsed", header: "Lapsed", align: "right", accessor: (r) => r.lapsed, cell: (r) => <span className="tabular-nums text-destructive">{r.lapsed}</span> },
  { id: "reinstated", header: "Reinstated", align: "right", accessor: (r) => r.reinstated, cell: (r) => <span className="tabular-nums text-emerald-600">{r.reinstated}</span> },
  { id: "rate", header: "Lapse rate", align: "right", accessor: (r) => r.lapseRatePct ?? -1, cell: (r) => r.lapseRatePct == null ? <span className="text-muted-foreground">—</span> : <span className={`tabular-nums font-semibold ${r.lapseRatePct > 5 ? "text-destructive" : r.lapseRatePct > 2 ? "text-amber-600" : "text-emerald-600"}`}>{r.lapseRatePct}%</span> },
];
const lapsedNowColumns: EdtColumn<LapsedPolicy>[] = [
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (r) => r.client, cell: (r) => <span className="whitespace-nowrap">{r.client}</span> },
  { id: "phone", header: "Phone", accessor: (r) => r.phone },
  { id: "lapsedOn", header: "Lapsed on", accessor: (r) => r.lapsedOn ?? "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.lapsedOn ? new Date(r.lapsedOn + "T00:00:00").toLocaleDateString() : "—"}</span> },
  { id: "paidUpTo", header: "Paid up to", accessor: (r) => r.paidUpTo ?? "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.paidUpTo ? new Date(r.paidUpTo + "T00:00:00").toLocaleDateString() : "—"}</span> },
  { id: "last", header: "Last payment", accessor: (r) => r.lastPaymentDate ?? "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.lastPaymentDate ? `${new Date(r.lastPaymentDate + "T00:00:00").toLocaleDateString()} · ${r.currency} ${r.lastPaymentAmount}` : "never"}</span> },
  { id: "premium", header: "Premium", align: "right", accessor: (r) => Number(r.premium), cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.currency} {r.premium}</span> },
  { id: "agent", header: "Agent", accessor: (r) => r.agent, cell: (r) => <span className="whitespace-nowrap text-sm">{r.agent}{r.typedIn && <span className="block text-[10px] text-muted-foreground">typed in</span>}</span> },
];

export function QualitySection({ filters, q, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: persistencyData, isLoading: loadingPersistency } = useQuery<PersistencyData>({
    queryKey: ["reports", "persistency", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/persistency" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load persistency");
      return res.json();
    },
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
  const { data: anniversary = [], isLoading: loadingAnniversary } = useQuery<AnnivRow[]>({
    queryKey: ["reports", "anniversary", runKey],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/anniversary?withinDays=60", { credentials: "include" })).json().catch(() => []),
    enabled: need("anniversary"),
  });
  const { data: integrity = [], isLoading: loadingIntegrity } = useQuery<IntegrityIssue[]>({
    queryKey: ["reports", "data-integrity", runKey],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/data-integrity", { credentials: "include" })).json().catch(() => []),
    enabled: need("dataIntegrity"),
  });

  const highCount = integrity.filter((i) => i.severity === "high").length;
  const persistency = persistencyData?.cohorts ?? [];
  const p13 = persistency.find((r) => r.monthsSinceSale === 13);
  const p25 = persistency.find((r) => r.monthsSinceSale === 25);
  const soldLast6 = persistency.filter((r) => (r.monthsSinceSale ?? 99) >= 1 && (r.monthsSinceSale ?? 99) <= 6);
  const ntu6 = (() => { const s = soldLast6.reduce((a, r) => a + r.sold, 0); const n = soldLast6.reduce((a, r) => a + r.neverPaid, 0); return s ? Number(((n / s) * 100).toFixed(1)) : null; })();

  return (
    <>
      <TabsContent value="persistency">
        <CardSection
          title="Persistency — how each month's sales are holding up"
          description="New sales grouped by the month they were sold. “Not taken up” = sold but never paid. “Persistency” = still in force today ÷ those that started paying. Existing policies typed in are shown on their own line — they're not sales. The 13- and 25-month figures are the ones the industry watches."
          icon={Activity}
          headerRight={<ExportButton reportType="persistency" filters={filters} />}
          flush
        >
          {loadingPersistency ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : persistency.length === 0 ? (
            <EmptyState title="No sales yet" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                <KpiStatCard label="Not taken up (sold in last 6 months)" value={ntu6 == null ? "—" : <span className={ntu6 > 40 ? "text-destructive" : ntu6 > 20 ? "text-amber-600" : ""}>{ntu6}%</span>} icon={Activity} />
                <KpiStatCard label="13-month persistency" value={p13?.persistencyPct != null ? <span className={rateColor(p13.persistencyPct)}>{p13.persistencyPct}%</span> : "not yet (no 13-month-old sales)"} icon={Activity} />
                <KpiStatCard label="25-month persistency" value={p25?.persistencyPct != null ? <span className={rateColor(p25.persistencyPct)}>{p25.persistencyPct}%</span> : "not yet"} icon={Activity} />
              </div>
              <EnhancedDataTable columns={persistencyColumns} rows={[...persistency, ...(persistencyData?.typedIn?.sold ? [persistencyData.typedIn] : [])]} getRowKey={(r) => r.cohort} exportFilename="persistency" storageKey="reports-persistency-v2" emptyMessage="No sales." />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="lapse-analysis">
        <CardSection
          title="Lapse analysis"
          description="From the status history, by month: policies in force at the start of the month, how many went into grace and how many paid their way back, how many lapsed (policies, not events) and were reinstated. Lapse rate = lapsed ÷ in force at the start of the month. Below: when in their cover policies lapse, by agent, and who is lapsed now to call."
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
                <KpiStatCard label="Lapsed (policies)" value={<span className="text-destructive">{lapse.totals.lapsed}</span>} icon={RotateCcw} />
                <KpiStatCard label="Grace save rate" value={lapse.graceSavePct == null ? "—" : <span className={rateColor(lapse.graceSavePct)}>{lapse.graceSavePct}%</span>} icon={TrendingUp} />
                <KpiStatCard label="Reinstated" value={<span className="text-emerald-600">{lapse.totals.reinstated}</span>} icon={RotateCcw} />
                <KpiStatCard label="Lapsed now (call list)" value={lapse.lapsedNow.length} icon={Activity} />
              </div>
              <EnhancedDataTable columns={lapseColumns} rows={lapse.months} getRowKey={(r) => r.month} exportFilename="lapse-analysis" storageKey="reports-lapse-analysis-v2" emptyMessage="No months." />
              {(lapse.byDuration.length > 0 || lapse.byAgent.length > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4">
                  <div>
                    <p className="text-sm font-semibold mb-1">When in their cover they lapsed</p>
                    <table className="w-full text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="text-left py-1">Cover had run</th><th className="text-right">New sales</th><th className="text-right">Typed in</th></tr></thead>
                      <tbody>{lapse.byDuration.map((d) => <tr key={d.duration} className="border-t"><td className="py-1">{d.duration}</td><td className="text-right tabular-nums">{d.newSales}</td><td className="text-right tabular-nums text-muted-foreground">{d.typedIn}</td></tr>)}</tbody></table>
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">By agent</p>
                    <table className="w-full text-sm"><thead className="text-xs uppercase text-muted-foreground"><tr><th className="text-left py-1">Agent</th><th className="text-right">New sales</th><th className="text-right">Typed in</th></tr></thead>
                      <tbody>{lapse.byAgent.map((x) => <tr key={x.agent} className="border-t"><td className="py-1">{x.agent}</td><td className="text-right tabular-nums">{x.newSales}</td><td className="text-right tabular-nums text-muted-foreground">{x.typedIn}</td></tr>)}</tbody></table>
                  </div>
                </div>
              )}
              <div className="px-4 pt-2 text-xs font-semibold uppercase text-muted-foreground">Lapsed now — call to reinstate</div>
              <EnhancedDataTable columns={lapsedNowColumns} rows={lapse.lapsedNow} getRowKey={(r) => r.policyNumber} exportFilename="lapsed-call-list" storageKey="reports-lapsed-now" emptyMessage="No policies are lapsed right now." />
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

      <TabsContent value="anniversary">
        <CardSection
          title="Policy anniversary / review list"
          description="Active and grace policies whose inception-date anniversary falls within the next 60 days — the natural point for an annual review, a CPI / sum-assured conversation, or a check-in call."
          icon={CalendarClock}
          headerRight={<ExportButton reportType="anniversary" filters={filters} />}
          flush
        >
          {loadingAnniversary ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : anniversary.length === 0 ? (
            <EmptyState title="No anniversaries in the next 60 days" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <EnhancedDataTable columns={annivColumns} rows={anniversary.map((r, i) => ({ ...r, _k: i }))} getRowKey={(r: any) => String(r._k)} exportFilename="anniversary" storageKey="reports-anniversary" emptyMessage="No anniversaries." />
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
