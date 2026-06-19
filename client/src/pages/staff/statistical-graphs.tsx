import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

const STATUS_COLORS: Record<string, string> = {
  active: "#10b981",
  grace: "#f59e0b",
  lapsed: "#ef4444",
  inactive: "#3b82f6",
  cancelled: "#6b7280",
};
const PIE_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"];

export default function StaffStatisticalGraphs() {
  const { data: revenueTrend } = useQuery<{ date: string; total: number }[]>({ queryKey: ["/api/dashboard/revenue-trend"] });
  const { data: statusBreakdown } = useQuery<Record<string, number>>({ queryKey: ["/api/dashboard/policy-status-breakdown"] });
  const { data: productPerformance } = useQuery<any[]>({ queryKey: ["/api/dashboard/product-performance"] });
  const { data: lapseRetention } = useQuery<any>({ queryKey: ["/api/dashboard/lapse-retention"] });

  const pieData = statusBreakdown
    ? Object.entries(statusBreakdown).map(([name, value]) => ({ name, value }))
    : [];

  const retentionData = lapseRetention
    ? [
        { name: "Retained", value: Number(lapseRetention.retentionRate ?? 0) },
        { name: "Lapsed", value: Number(lapseRetention.lapseRate ?? 0) },
      ]
    : [];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">Statistical Graphs</span>}
          description="Visual trend analysis — collections, policy mix, product performance, and retention."
        />

        {/* Revenue trend */}
        {revenueTrend && revenueTrend.length > 0 && (
          <CardSection title="Revenue collected over time" icon={BarChart3}>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={revenueTrend} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <defs>
                  <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.18} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(d) => d.slice(5)}
                  className="text-muted-foreground"
                />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <Tooltip
                  formatter={(v: number) => [v.toLocaleString(undefined, { minimumFractionDigits: 2 }), "Revenue"]}
                  labelFormatter={(d) => `Date: ${d}`}
                />
                <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#revenueGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardSection>
        )}

        {/* Policy status breakdown (pie) */}
        {pieData.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <CardSection title="Policy status mix" icon={BarChart3}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {pieData.map((entry, i) => (
                      <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [v, "Policies"]} />
                </PieChart>
              </ResponsiveContainer>
            </CardSection>

            {/* Retention vs lapse */}
            {retentionData.length > 0 && (
              <CardSection title="Retention vs lapse rate" icon={BarChart3}>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={retentionData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} ${Number(value).toFixed(1)}%`} labelLine={false}>
                      <Cell fill="#10b981" />
                      <Cell fill="#ef4444" />
                    </Pie>
                    <Tooltip formatter={(v: number) => [`${v.toFixed(1)}%`, ""]} />
                  </PieChart>
                </ResponsiveContainer>
              </CardSection>
            )}
          </div>
        )}

        {/* Product performance bar chart */}
        {productPerformance && productPerformance.length > 0 && (
          <CardSection title="Policies per product" icon={BarChart3}>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={productPerformance} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <YAxis tick={{ fontSize: 11 }} className="text-muted-foreground" />
                <Tooltip />
                <Legend />
                <Bar dataKey="activePolicies" name="Active" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="lapsedPolicies" name="Lapsed" fill="#ef4444" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardSection>
        )}
      </PageShell>
    </StaffLayout>
  );
}
