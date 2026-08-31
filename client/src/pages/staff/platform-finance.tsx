import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, TrendingUp, Wallet, AlertCircle, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface FinanceOverview {
  currency: string;
  mrrEstimate: string;
  arrEstimate: string;
  collected: { last30d: string; thisMonth: string; allTime: string; count: number };
  outstanding: { total: string; count: number; aging: { current: string; d1_7: string; d8_30: string; d30plus: string } };
  byModel: Record<string, { tenants: number; mrrEstimate: string; outstanding: string }>;
  topDebtors: { tenantId: string; name: string; amount: string }[];
  recentPayments: { id: string; tenant: string; kind: string; amount: string; currency: string; paidAt: string; manual: boolean }[];
}

const MODEL_LABELS: Record<string, string> = { flat: "Flat monthly fee", per_policy: "Per policy", revenue_share: "Share of revenue" };
const KIND_LABELS: Record<string, string> = { subscription: "Subscription", setup: "Setup fee", per_policy: "Per policy", revenue_share: "Revenue share", adjustment: "Adjustment" };

const usd = (v: string) => `$${parseFloat(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Stat({ label, value, sub, icon: Icon }: { label: string; value: string; sub?: string; icon: any }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide">
        <Icon className="h-3.5 w-3.5" /> {label}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
    </div>
  );
}

export default function PlatformFinance() {
  const { data, isLoading } = useQuery<FinanceOverview>({ queryKey: ["/api/platform/billing/finance-overview"] });

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Platform finances" description="POL263's own recurring revenue, collections, and what tenants owe. Figures in USD." />
        {isLoading || !data ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Stat label="Recurring revenue (est.)" value={usd(data.mrrEstimate)} sub={`${usd(data.arrEstimate)} / year`} icon={TrendingUp} />
              <Stat label="Collected — 30 days" value={usd(data.collected.last30d)} sub={`${usd(data.collected.thisMonth)} this month`} icon={Wallet} />
              <Stat label="Outstanding" value={usd(data.outstanding.total)} sub={`${data.outstanding.count} open invoice(s)`} icon={AlertCircle} />
              <Stat label="Collected — all time" value={usd(data.collected.allTime)} sub={`${data.collected.count} payment(s)`} icon={Wallet} />
            </div>

            <CardSection title="By billing model" icon={Layers}>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Model</TableHead><TableHead>Tenants</TableHead><TableHead>Recurring revenue (est.)</TableHead><TableHead>Outstanding</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(data.byModel).map(([model, v]) => (
                      <TableRow key={model}>
                        <TableCell>{MODEL_LABELS[model] ?? model}</TableCell>
                        <TableCell className="tabular-nums">{v.tenants}</TableCell>
                        <TableCell className="tabular-nums">{usd(v.mrrEstimate)}</TableCell>
                        <TableCell className="tabular-nums">{usd(v.outstanding)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardSection>

            <CardSection title="Outstanding by age" description="Open invoices bucketed by how far past due they are." icon={AlertCircle}>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
                <Stat label="Not yet due" value={usd(data.outstanding.aging.current)} icon={AlertCircle} />
                <Stat label="1–7 days" value={usd(data.outstanding.aging.d1_7)} icon={AlertCircle} />
                <Stat label="8–30 days" value={usd(data.outstanding.aging.d8_30)} icon={AlertCircle} />
                <Stat label="Over 30 days" value={usd(data.outstanding.aging.d30plus)} icon={AlertCircle} />
              </div>
            </CardSection>

            <CardSection title="Who owes the most" icon={AlertCircle}>
              {data.topDebtors.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">Nothing outstanding.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Outstanding</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.topDebtors.map((d) => (
                        <TableRow key={d.tenantId}>
                          <TableCell><a className="underline" href={`/staff/platform/tenants/${d.tenantId}`}>{d.name}</a></TableCell>
                          <TableCell className="tabular-nums">{usd(d.amount)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardSection>

            <CardSection title="Recent payments" icon={Wallet}>
              {data.recentPayments.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No payments yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Tenant</TableHead><TableHead>Type</TableHead><TableHead>Amount</TableHead><TableHead>Paid</TableHead></TableRow></TableHeader>
                    <TableBody>
                      {data.recentPayments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.tenant}</TableCell>
                          <TableCell>{KIND_LABELS[p.kind] ?? p.kind}</TableCell>
                          <TableCell className="tabular-nums">{p.currency} {parseFloat(p.amount).toFixed(2)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {new Date(p.paidAt).toLocaleDateString()}{p.manual ? " (manual)" : ""}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardSection>
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}
