import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EnhancedDataTable, type EdtColumn, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getApiBase } from "@/lib/queryClient";
import { useBranding } from "@/hooks/use-branding";
import { useAuth } from "@/hooks/use-auth";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";
import { Loader2, FileDown, Download } from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

/**
 * Validated default categorical palette (dataviz skill, references/palette.md) — fixed order,
 * never cycled/reassigned per filter. Reused across every categorical chart on this page so
 * "product 1" or "stage 1" always gets the same slot regardless of which chart it appears in.
 */
const CATEGORICAL = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
// Existing app-wide semantic status colors (statistical-graphs.tsx) — reused unchanged for
// policy-adjacent statuses per the skill's "status colors are reserved" rule.
const STATUS_COLORS: Record<string, string> = {
  active: "#10b981", grace: "#f59e0b", lapsed: "#ef4444", inactive: "#3b82f6", cancelled: "#6b7280",
};

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function currencyLines(m: Record<string, number> | undefined) {
  if (!m || Object.keys(m).length === 0) return "—";
  return Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => `${c} ${money(v)}`).join(" · ") || "—";
}
function pct(n: number | null | undefined) {
  return n == null ? "—" : `${n}%`;
}

const branchBreakdownColumns: EdtColumn<any>[] = [
  { id: "branch", header: "Branch", accessor: (r) => r.branchName },
  { id: "currency", header: "Currency", accessor: (r) => r.currency },
  { id: "policies", header: "Policies", align: "right", accessor: (r) => r.policyCount },
  {
    id: "income",
    header: "Income",
    align: "right",
    accessor: (r) => Number(r.income || 0),
    cell: (r) => <span className="tabular-nums">{money(r.income)}</span>,
  },
];

/** Pivots {group, currency, value} rows into one row per group with one field per currency —
 *  never blends currencies into a single bar; each currency gets its own <Bar> series instead. */
function pivotByCurrency<T extends { currency: string }>(
  rows: T[],
  groupOf: (r: T) => string,
  valueOf: (r: T) => number,
): { data: Record<string, any>[]; currencies: string[] } {
  const currencies = Array.from(new Set(rows.map((r) => r.currency))).sort();
  const byGroup = new Map<string, Record<string, any>>();
  for (const r of rows) {
    const g = groupOf(r);
    if (!byGroup.has(g)) byGroup.set(g, { name: g });
    byGroup.get(g)![r.currency] = (byGroup.get(g)![r.currency] || 0) + valueOf(r);
  }
  return { data: Array.from(byGroup.values()), currencies };
}

function StatTile({ label, value, color, delta }: { label: string; value: string; color?: string; delta?: number | null }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</p>
      {delta != null && (
        <p className={`text-[11px] tabular-nums ${delta > 0 ? "text-emerald-600" : delta < 0 ? "text-destructive" : "text-muted-foreground"}`}>
          {delta > 0 ? "▲" : delta < 0 ? "▼" : "■"} {Math.abs(delta)}% vs prior period
        </p>
      )}
    </div>
  );
}

export default function ExecutiveReport() {
  const { user } = useAuth();
  const { branding, displayName, displayLogo } = useBranding(user?.organizationId ?? null);
  const [period, setPeriod] = useState<Period>(() => periodForPreset("mtd"));
  const [branchId, setBranchId] = useState<string>("all");

  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["executive-report", "filter-branches"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/branches", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const effectiveBranchId = branchId === "all" ? undefined : branchId;
  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/executive", period.from, period.to, effectiveBranchId],
    queryFn: async () => {
      const qs = new URLSearchParams({ from: period.from, to: period.to });
      if (effectiveBranchId) qs.set("branchId", effectiveBranchId);
      const res = await fetch(getApiBase() + `/api/reports/executive?${qs}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const pdfQs = useMemo(() => {
    const qs = new URLSearchParams({ from: period.from, to: period.to });
    if (effectiveBranchId) qs.set("branchId", effectiveBranchId);
    return qs.toString();
  }, [period, effectiveBranchId]);

  // Which currencies actually have income/expense activity in this period — one small-multiple
  // area chart per currency, never a blended total (see financial-statements.ts convention).
  const timeSeriesCurrencies = useMemo(() => {
    if (!report?.financial?.incomeTimeSeries) return [];
    const set = new Set<string>();
    for (const p of report.financial.incomeTimeSeries) {
      for (const c of Object.keys(p.income)) set.add(c);
      for (const c of Object.keys(p.expenses)) set.add(c);
    }
    return Array.from(set).sort();
  }, [report]);

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Executive Report"
          description="Cross-module business intelligence — financials, policies, funeral services, quotes, mortuary, fleet, and claims for a date range."
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <PeriodSelector value={period} onChange={setPeriod} />
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`${getApiBase()}/api/reports/executive/pdf?${pdfQs}`, "_blank")}>
                <FileDown className="h-3.5 w-3.5" /> Preview PDF
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => window.open(`${getApiBase()}/api/reports/executive/pdf?${pdfQs}&download=1`, "_blank")}>
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            </div>
          }
        />

        {isLoading || !report ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            {/* Letterhead */}
            <div className="flex items-center gap-4 border-b-2 pb-4" style={{ borderColor: branding?.primaryColor || undefined }}>
              <img src={displayLogo} alt="" className="h-12 w-12 object-contain shrink-0" />
              <div>
                <p className="text-lg font-serif font-semibold leading-tight">{displayName}</p>
                <p className="text-xs text-muted-foreground">{[branding?.address, branding?.phone, branding?.email].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm font-semibold tabular-nums">{period.from} – {period.to}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Executive report</p>
              </div>
            </div>

            <AiInsightsPanel
              surface="executive_report"
              from={period.from}
              to={period.to}
              branchId={effectiveBranchId}
              title="Executive Summary"
              description="Ask AI to summarize this period's performance across every module and flag anything worth attention."
            />

            {/* KPI tiles */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <StatTile label="Total income" value={`USD ${money(report.financial.incomeStatement.consolidatedUsd?.income)}`} color="#15803d" delta={report.comparison?.deltaPct?.totalIncomeUsd} />
              <StatTile
                label="Net"
                value={`USD ${money(report.financial.incomeStatement.consolidatedUsd?.net)}`}
                color={Number(report.financial.incomeStatement.consolidatedUsd?.net ?? 0) >= 0 ? "#15803d" : "#b91c1c"}
                delta={report.comparison?.deltaPct?.netUsd}
              />
              <StatTile label="New policies" value={String(report.policies.newPoliciesCount)} delta={report.comparison?.deltaPct?.newPoliciesCount} />
              <StatTile label="Funeral services" value={report.funeralServices ? String(report.funeralServices.byType.reduce((s: number, r: any) => s + r.count, 0)) : "—"} />
              <StatTile label="Quote conversion" value={report.quotes ? pct(report.quotes.conversionRate) : "—"} />
              <StatTile label="Claims overdue" value={report.claims?.overdue ? pct(report.claims.overdue.overduePercent) : "—"} color={report.claims?.overdue?.overdueCount ? "#b91c1c" : undefined} />
            </div>

            {/* Revenue trend — one small-multiple area chart per currency present */}
            {timeSeriesCurrencies.length > 0 && (
              <CardSection title="Revenue Trend" description="Income vs expenses over the period, by currency.">
                <div className={`grid gap-4 ${timeSeriesCurrencies.length > 1 ? "md:grid-cols-2" : ""}`}>
                  {timeSeriesCurrencies.map((currency, i) => {
                    const data = report.financial.incomeTimeSeries.map((p: any) => ({
                      label: p.periodLabel, income: p.income[currency] || 0, expenses: p.expenses[currency] || 0,
                    }));
                    return (
                      <div key={currency}>
                        <p className="text-xs text-muted-foreground mb-1">{currency}</p>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                            <defs>
                              <linearGradient id={`incomeGrad-${currency}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CATEGORICAL[0]} stopOpacity={0.25} />
                                <stop offset="95%" stopColor={CATEGORICAL[0]} stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id={`expenseGrad-${currency}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={CATEGORICAL[1]} stopOpacity={0.25} />
                                <stop offset="95%" stopColor={CATEGORICAL[1]} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                            <Tooltip formatter={(v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
                            <Legend />
                            <Area type="monotone" dataKey="income" name="Income" stroke={CATEGORICAL[0]} fill={`url(#incomeGrad-${currency})`} strokeWidth={2} />
                            <Area type="monotone" dataKey="expenses" name="Expenses" stroke={CATEGORICAL[1]} fill={`url(#expenseGrad-${currency})`} strokeWidth={2} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  })}
                </div>
              </CardSection>
            )}

            {/* Income by branch */}
            {report.financial.branchBreakdown.length > 0 && (
              <CardSection title="Income by Branch">
                <EnhancedDataTable
                  columns={branchBreakdownColumns}
                  rows={report.financial.branchBreakdown.map((r: any, i: number) => ({ ...r, _rowKey: i }))}
                  getRowKey={(row) => String(row._rowKey)}
                  searchable={false}
                  exportFilename={`executive-report-branch-breakdown-${period.from}-${period.to}`}
                  storageKey="executive-report-branch-breakdown"
                  emptyMessage="No branch data."
                />
              </CardSection>
            )}

            {/* Revenue by product */}
            <CardSection title="Premium Revenue by Product" description="Which products drove income this period.">
              {report.policies.revenueByProduct.length === 0 ? <EmptyState title="No premium revenue in this period" className="border-0 rounded-none bg-transparent py-8" /> : (() => {
                const { data, currencies } = pivotByCurrency(report.policies.revenueByProduct, (r: any) => r.productName, (r: any) => r.revenue);
                return (
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                      <Tooltip formatter={(v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
                      {currencies.length > 1 && <Legend />}
                      {currencies.map((c, i) => <Bar key={c} dataKey={c} name={c} fill={CATEGORICAL[i % CATEGORICAL.length]} radius={[3, 3, 0, 0]} />)}
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()}
            </CardSection>

            {/* SA vs Home */}
            {report.policies.countryFlag && (
              <CardSection title={`${report.policies.countryFlag.flagLabel} vs ${report.policies.countryFlag.homeLabel}`} description="Policy revenue split, plus cross-border funeral services and their cost.">
                {(() => {
                  const cf = report.policies.countryFlag;
                  const { data, currencies } = pivotByCurrency(
                    cf.revenueByCountry,
                    (r: any) => r.flagged ? cf.flagLabel : cf.homeLabel,
                    (r: any) => r.income,
                  );
                  return (
                    <div className="grid md:grid-cols-2 gap-4 items-start">
                      <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                          <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                          <Tooltip formatter={(v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
                          {currencies.length > 1 && <Legend />}
                          {currencies.map((c, i) => <Bar key={c} dataKey={c} name={c} fill={CATEGORICAL[i % CATEGORICAL.length]} radius={[3, 3, 0, 0]} />)}
                        </BarChart>
                      </ResponsiveContainer>
                      <div className="space-y-2 text-sm">
                        <StatTile label={`${cf.flagLabel} funeral services`} value={String(cf.serviceCount)} />
                        <StatTile label={`${cf.flagLabel} cost`} value={currencyLines(Object.fromEntries(cf.costByCurrency.map((c: any) => [c.currency, c.cost])))} />
                      </div>
                    </div>
                  );
                })()}
              </CardSection>
            )}

            {/* Funeral services */}
            {report.funeralServices && (
              <CardSection title="Funeral Services" description="Conducted this period, by type, branch, and location.">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">By service type (cash vs claim)</p>
                    {report.funeralServices.byType.length === 0 ? <EmptyState title="No funeral services in this period" className="border-0 rounded-none bg-transparent py-8" /> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={report.funeralServices.byType.map((r: any) => ({ name: r.serviceType || "Unspecified", value: r.count }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                            {report.funeralServices.byType.map((r: any, i: number) => <Cell key={r.serviceType || i} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">By branch</p>
                    {report.funeralServices.byBranch.length === 0 ? <EmptyState title="No branch data" className="border-0 rounded-none bg-transparent py-8" /> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={report.funeralServices.byBranch.map((r: any) => ({ name: r.branchName, count: r.count }))} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                          <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                          <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                          <Tooltip />
                          <Bar dataKey="count" name="Services" fill={CATEGORICAL[0]} radius={[3, 3, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                </div>
                {report.funeralServices.trend.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-1">Trend</p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={pivotTrend(report.funeralServices.trend)} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 10 }} allowDecimals={false} className="text-muted-foreground" />
                        <Tooltip /><Legend />
                        <Line type="monotone" dataKey="cash" name="Cash" stroke={CATEGORICAL[0]} strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="claim" name="Claim" stroke={CATEGORICAL[1]} strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
                {report.funeralServices.topLocations.length > 0 && (
                  <div className="mt-4">
                    <p className="text-xs text-muted-foreground mb-1.5">Top locations</p>
                    <ul className="text-sm space-y-0.5">
                      {report.funeralServices.topLocations.map((l: any, i: number) => (
                        <li key={i} className="flex justify-between max-w-sm"><span>{l.location}</span><span className="tabular-nums text-muted-foreground">{l.count}</span></li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardSection>
            )}

            {/* Quotes / conversion */}
            {report.quotes && (
              <CardSection title="Quotes & Conversion" description="How many quotes were issued and how many converted to a paid service.">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                  <StatTile label="Total quotes" value={String(report.quotes.totalQuotes)} />
                  <StatTile label="Converted" value={String(report.quotes.convertedQuotes)} color="#15803d" />
                  <StatTile label="Conversion rate" value={pct(report.quotes.conversionRate)} />
                </div>
                {report.quotes.stats.length > 0 && (() => {
                  const { data, currencies } = pivotByCurrency(report.quotes.stats, (r: any) => r.conversionStatus, (r: any) => r.value);
                  return (
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                        <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                        <Tooltip formatter={(v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
                        {currencies.length > 1 && <Legend />}
                        {currencies.map((c, i) => <Bar key={c} dataKey={c} name={`${c} value`} fill={CATEGORICAL[i % CATEGORICAL.length]} radius={[3, 3, 0, 0]} />)}
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </CardSection>
            )}

            {/* Lead funnel */}
            {report.leadFunnel && (
              <CardSection title="Lead Funnel" description="Insurance lead pipeline stage counts (distinct from funeral quotations above).">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={report.leadFunnel.map((s: any) => ({ name: s.label, count: s.count }))} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} className="text-muted-foreground" />
                    <Tooltip />
                    <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                      {report.leadFunnel.map((s: any, i: number) => <Cell key={s.stage} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardSection>
            )}

            {/* Mortuary */}
            {report.mortuary && (
              <CardSection title="Mortuary" description="Intake volume and revenue by service stream (storage, chapel/wash-bay, and other ancillary services).">
                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Intakes by scope</p>
                    {report.mortuary.byScope.length === 0 ? <EmptyState title="No intakes in this period" className="border-0 rounded-none bg-transparent py-8" /> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <PieChart>
                          <Pie data={report.mortuary.byScope.map((r: any) => ({ name: r.serviceScope, value: r.count }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                            {report.mortuary.byScope.map((r: any, i: number) => <Cell key={r.serviceScope} fill={CATEGORICAL[i % CATEGORICAL.length]} />)}
                          </Pie>
                          <Tooltip />
                        </PieChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Revenue by stream</p>
                    {report.mortuary.revenueByStream.length === 0 ? <EmptyState title="No paid service charges in this period" className="border-0 rounded-none bg-transparent py-8" /> : (() => {
                      const { data, currencies } = pivotByCurrency(report.mortuary.revenueByStream, (r: any) => r.serviceKey, (r: any) => r.revenue);
                      return (
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} className="text-muted-foreground" />
                            <YAxis tick={{ fontSize: 10 }} className="text-muted-foreground" />
                            <Tooltip formatter={(v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 2 })} />
                            {currencies.length > 1 && <Legend />}
                            {currencies.map((c, i) => <Bar key={c} dataKey={c} name={c} fill={CATEGORICAL[i % CATEGORICAL.length]} radius={[3, 3, 0, 0]} />)}
                          </BarChart>
                        </ResponsiveContainer>
                      );
                    })()}
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                  <StatTile label="Storage fees (cross-check)" value={currencyLines(report.mortuary.storageFeeTotal)} />
                  <StatTile label="Chapel/wash-bay fees (cross-check)" value={currencyLines(report.mortuary.chapelFeeTotal)} />
                </div>
              </CardSection>
            )}

            {/* Fleet */}
            {report.fleet && (
              <CardSection title="Fleet Costs" description="Fuel and maintenance spend for the period.">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <StatTile label="Fuel" value={currencyLines(report.fleet.fuelCost)} color="#b91c1c" />
                  <StatTile label="Maintenance" value={currencyLines(report.fleet.maintenanceCost)} color="#b91c1c" />
                </div>
              </CardSection>
            )}

            {/* Claims */}
            {report.claims && (
              <CardSection title="Claims" description="By status this period, plus current SLA overdue rate (as of now, not date-bound).">
                <div className="grid md:grid-cols-2 gap-4">
                  {report.claims.stats.length === 0 ? <EmptyState title="No claims in this period" className="border-0 rounded-none bg-transparent py-8" /> : (
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={report.claims.stats.map((r: any) => ({ name: r.status, value: r.count }))} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} (${value})`} labelLine={false}>
                          {report.claims.stats.map((r: any, i: number) => <Cell key={`${r.status}-${i}`} fill={STATUS_COLORS[r.status] ?? CATEGORICAL[i % CATEGORICAL.length]} />)}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                  {report.claims.overdue && (
                    <div className="space-y-2">
                      <StatTile label="Open claims" value={String(report.claims.overdue.openCount)} />
                      <StatTile label="Overdue (SLA)" value={`${report.claims.overdue.overdueCount} (${pct(report.claims.overdue.overduePercent)})`} color={report.claims.overdue.overdueCount > 0 ? "#b91c1c" : undefined} />
                    </div>
                  )}
                </div>
              </CardSection>
            )}
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}

/** Pivots [{date, serviceType, count}] into [{date, cash, claim}] rows for a multi-series line chart. */
function pivotTrend(rows: { date: string; serviceType: string | null; count: number }[]) {
  const byDate = new Map<string, Record<string, any>>();
  for (const r of rows) {
    if (!byDate.has(r.date)) byDate.set(r.date, { date: r.date });
    byDate.get(r.date)![r.serviceType || "unspecified"] = r.count;
  }
  return Array.from(byDate.values()).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
