import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { CardSection } from "@/components/ds";
import { BarChart3 } from "lucide-react";

/** Split out of dashboard.tsx alongside RevenueAndPolicyCharts — same recharts lazy-chunk reason. */
export default function LeadFunnelChart({ leadFunnelData }: { leadFunnelData: { name: string; value: number; fill: string }[] }) {
  return (
    <CardSection title="Lead conversion funnel" icon={BarChart3} contentClassName="pt-2">
      {leadFunnelData.length > 0 ? (
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={leadFunnelData} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis type="number" tick={{ fontSize: 11 }} />
            <YAxis dataKey="name" type="category" tick={{ fontSize: 11 }} width={120} />
            <Tooltip formatter={(value: number) => [value, "Leads"]} />
            <Bar dataKey="value" radius={[0, 4, 4, 0]}>
              {leadFunnelData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-[280px] flex items-center justify-center text-sm text-muted-foreground" data-testid="text-no-leads">
          No lead data available
        </div>
      )}
    </CardSection>
  );
}
