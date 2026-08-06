import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CardSection, KpiStatCard } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, TrendingUp } from "lucide-react";

export function MyPnlTab({ commissionOnly }: { commissionOnly: boolean }) {
  const [pnlFrom, setPnlFrom] = useState(() => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [pnlTo, setPnlTo] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: agentPnl, isLoading: pnlLoading, refetch: refetchPnl } = useQuery<any>({
    queryKey: ["/api/agent/pnl", pnlFrom, pnlTo],
    queryFn: () => fetch(`/api/agent/pnl?fromDate=${pnlFrom}&toDate=${pnlTo}`, { credentials: "include" }).then(r => r.json()),
    enabled: commissionOnly,
  });

  return (
    <TabsContent value="my-pnl">
      <div className="space-y-6">
        {/* Date range filters */}
        <CardSection title="My P&L — collections vs commissions" icon={TrendingUp}
          description="Shows your premium collections and commission earnings for the selected period.">
          <div className="flex flex-wrap gap-3 p-4 border-b">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">From</label>
              <Input type="date" value={pnlFrom} onChange={e => setPnlFrom(e.target.value)} className="h-8 w-36 text-sm" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">To</label>
              <Input type="date" value={pnlTo} onChange={e => setPnlTo(e.target.value)} className="h-8 w-36 text-sm" />
            </div>
            <Button size="sm" variant="outline" onClick={() => refetchPnl()} className="h-8">Apply</Button>
          </div>

          {pnlLoading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : agentPnl ? (() => {
            const fmtMap = (m: Record<string, number>) =>
              Object.entries(m || {}).map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("  ") || "—";
            const p = agentPnl;
            const port = p.portfolio || {};
            const coll = p.collections || {};
            const comm = p.commissions || {};
            return (
              <>
                {/* Portfolio KPIs */}
                <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4">
                  <KpiStatCard label="Total Policies" value={port.totalPolicies ?? 0} className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
                  <KpiStatCard label="Active" value={<span className="text-emerald-700">{port.activePolicies ?? 0}</span>} className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200" />
                  <KpiStatCard label="Grace" value={<span className="text-amber-700">{port.gracePolicies ?? 0}</span>} className="bg-amber-50 dark:bg-amber-950/20 border-amber-200" />
                  <KpiStatCard label="Lapsed" value={<span className="text-red-700">{port.lapsedPolicies ?? 0}</span>} className="bg-red-50 dark:bg-red-950/20 border-red-200" />
                  <KpiStatCard label="New in period" value={<span className="text-blue-700">{port.newInPeriod ?? 0}</span>} className="bg-blue-50 dark:bg-blue-950/20 border-blue-200" />
                  <KpiStatCard label="Retention rate" value={<span className="text-indigo-700">{port.retentionRate ?? "—"}%</span>} hint="active ÷ total" className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
                </div>

                {/* Collections vs Commissions side-by-side */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t">
                  <div className="p-4 border-r">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Collections (premiums paid in period)</p>
                    <p className="text-2xl font-bold tabular-nums text-emerald-700">{fmtMap(coll.total)}</p>
                    {(coll.byMonth || []).length > 0 && (
                      <div className="mt-3 space-y-1">
                        {(coll.byMonth as any[]).map((m: any) => (
                          <div key={m.month} className="flex justify-between text-sm">
                            <span className="text-muted-foreground">{m.month}</span>
                            <span className="tabular-nums font-medium">{fmtMap(m.amounts)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Commissions (period)</p>
                    <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                        <span>Earned</span>
                        <span className="tabular-nums font-semibold text-emerald-700">{fmtMap(comm.earned)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Paid out</span>
                        <span className="tabular-nums font-semibold text-blue-700">{fmtMap(comm.paid)}</span>
                      </div>
                      {Object.keys(comm.clawbacks || {}).length > 0 && (
                        <div className="flex justify-between text-sm">
                          <span>Clawbacks</span>
                          <span className="tabular-nums font-semibold text-red-700">−{fmtMap(comm.clawbacks)}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-sm border-t pt-2 mt-2">
                        <span className="font-medium">Outstanding (period)</span>
                        <span className="tabular-nums font-bold text-amber-700">{fmtMap(comm.outstanding)}</span>
                      </div>
                    </div>
                    <div className="mt-4 pt-4 border-t">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium">Total outstanding (all time)</span>
                        <span className="tabular-nums font-bold text-indigo-700">{fmtMap(p.lifetimeOutstanding || {})}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-1">Commissions earned but not yet paid out, across all periods.</p>
                    </div>
                  </div>
                </div>
              </>
            );
          })() : (
            <p className="p-4 text-sm text-muted-foreground">No data available.</p>
          )}
        </CardSection>
      </div>
    </TabsContent>
  );
}
