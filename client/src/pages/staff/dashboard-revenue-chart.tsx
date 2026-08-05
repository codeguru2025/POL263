import { AreaChart, Area, PieChart, Pie, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, Legend } from "recharts";
import { CardSection } from "@/components/ds";
import { PeriodSelector, type Period } from "@/components/period-selector";
import { DollarSign, FileStack } from "lucide-react";

/**
 * Split out of dashboard.tsx so recharts (a ~400KB dependency) loads as its own
 * lazy chunk instead of blocking the initial render of the most-visited page in
 * the app — see StaffDashboard's `<Suspense>` wrapper around this component.
 */
export default function RevenueAndPolicyCharts({
  revenueTrend,
  execPeriod,
  onExecPeriodChange,
  policyStatusData,
}: {
  revenueTrend: { date: string; total: number }[];
  execPeriod: Period;
  onExecPeriodChange: (p: Period) => void;
  policyStatusData: { name: string; value: number; color: string }[];
}) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <CardSection title="Revenue trend" icon={DollarSign} contentClassName="pt-2" headerRight={<PeriodSelector value={execPeriod} onChange={onExecPeriodChange} />}>
        {revenueTrend.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={revenueTrend}>
              <defs>
                <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(d) => d.slice(5)} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                formatter={(value: number) => [value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }), "Revenue"]}
                labelFormatter={(label) => `Date: ${label}`}
              />
              <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#colorRevenue)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-revenue">
            No revenue data available
          </div>
        )}
      </CardSection>

      <CardSection title="Policy status breakdown" icon={FileStack} contentClassName="pt-2">
        {policyStatusData.length > 0 ? (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                data={policyStatusData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={100}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {policyStatusData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip formatter={(value: number) => [value, "Policies"]} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-policies">
            No policy data available
          </div>
        )}
      </CardSection>
    </div>
  );
}
