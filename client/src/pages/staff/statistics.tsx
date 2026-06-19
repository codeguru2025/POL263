import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard } from "@/components/ds";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, TrendingUp, Users, FileText, ShieldCheck, Activity } from "lucide-react";

export default function StaffStatistics() {
  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: statusBreakdown } = useQuery<Record<string, number>>({ queryKey: ["/api/dashboard/policy-status-breakdown"] });
  const { data: productPerformance } = useQuery<any[]>({ queryKey: ["/api/dashboard/product-performance"] });
  const { data: coveredLives } = useQuery<any>({ queryKey: ["/api/dashboard/covered-lives"] });
  const { data: lapseRetention } = useQuery<any>({ queryKey: ["/api/dashboard/lapse-retention"] });
  const { data: leadFunnel } = useQuery<Record<string, number>>({ queryKey: ["/api/dashboard/lead-funnel"] });

  const retentionRate = lapseRetention?.retentionRate != null
    ? `${Number(lapseRetention.retentionRate).toFixed(1)}%`
    : "—";

  const lapseRate = lapseRetention?.lapseRate != null
    ? `${Number(lapseRetention.lapseRate).toFixed(1)}%`
    : "—";

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">Statistics</span>}
          description="Operational numbers at a glance — policies, collections, claims, and retention."
        />

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiStatCard label="Total policies" icon={FileText} value={stats?.totalPolicies ?? "—"} />
          <KpiStatCard label="Active policies" icon={ShieldCheck} value={stats?.activePolicies ?? "—"} />
          <KpiStatCard label="Covered lives" icon={Users} value={coveredLives?.coveredLives ?? "—"} />
          <KpiStatCard label="Total clients" icon={Users} value={stats?.totalClients ?? "—"} />
          <KpiStatCard label="Retention rate" icon={TrendingUp} value={retentionRate} />
          <KpiStatCard label="Lapse rate" icon={Activity} value={lapseRate} />
        </div>

        {/* Policy status breakdown */}
        <CardSection title="Policies by status" icon={FileText}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4 font-medium">Status</th>
                  <th className="text-right py-2 pr-4 font-medium">Count</th>
                  <th className="text-right py-2 font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {statusBreakdown && Object.entries(statusBreakdown).length > 0 ? (
                  (() => {
                    const total = Object.values(statusBreakdown).reduce((a, b) => a + b, 0);
                    return Object.entries(statusBreakdown)
                      .sort(([, a], [, b]) => b - a)
                      .map(([status, count]) => (
                        <tr key={status} className="border-b last:border-0">
                          <td className="py-2 pr-4 capitalize font-medium">{status}</td>
                          <td className="py-2 pr-4 text-right tabular-nums">{count.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums text-muted-foreground">
                            {total > 0 ? `${((count / total) * 100).toFixed(1)}%` : "—"}
                          </td>
                        </tr>
                      ));
                  })()
                ) : (
                  <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No data available</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardSection>

        {/* Product performance */}
        {productPerformance && productPerformance.length > 0 && (
          <CardSection title="Product performance" icon={BarChart3}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Product</th>
                    <th className="text-right py-2 pr-4 font-medium">Total</th>
                    <th className="text-right py-2 pr-4 font-medium">Active</th>
                    <th className="text-right py-2 pr-4 font-medium">Lapsed</th>
                    <th className="text-right py-2 font-medium">Revenue collected</th>
                  </tr>
                </thead>
                <tbody>
                  {productPerformance.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{p.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{p.totalPolicies.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-emerald-700">{p.activePolicies.toLocaleString()}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-destructive">{p.lapsedPolicies.toLocaleString()}</td>
                      <td className="py-2 text-right tabular-nums">
                        {p.currency} {Number(p.revenue).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardSection>
        )}

        {/* Lead funnel */}
        {leadFunnel && Object.keys(leadFunnel).length > 0 && (
          <CardSection title="Lead conversion funnel" icon={TrendingUp}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-4 font-medium">Stage</th>
                    <th className="text-right py-2 font-medium">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(leadFunnel)
                    .sort(([, a], [, b]) => b - a)
                    .map(([stage, count]) => (
                      <tr key={stage} className="border-b last:border-0">
                        <td className="py-2 pr-4 capitalize font-medium">{stage.replace(/_/g, " ")}</td>
                        <td className="py-2 text-right tabular-nums">{count.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </CardSection>
        )}
      </PageShell>
    </StaffLayout>
  );
}
