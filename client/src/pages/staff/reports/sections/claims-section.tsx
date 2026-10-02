import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText, Clock, TrendingDown } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

// One definition of a claim across the three tabs (server/claims-view.ts): a claim record, or a
// funeral done under a policy where no claim was raised.
type ClaimRecord = {
  kind: "claim" | "funeral"; reference: string; funeralCase: string; policyNumber: string; client: string; clientPhone: string; branch: string;
  deceased: string; relationship: string; dateOfDeath: string | null; reported: string; decided: string | null; daysToDecide: number | null;
  status: string; state: "open" | "settled" | "repudiated"; decisionReason: string; claimType: string; currency: string;
  cashInLieu: string | null; funeralCost: Record<string, string>; chargedToSociety: string | null; daysOpen: number | null; overdue: boolean;
};
type LossRatio = { currency: string; claimsIncurred: number; premiumCollected: number; ratio: number };
type Repudiation = { claimType: string; reported: number; settled: number; repudiated: number; open: number; repudiationRate: number };
type ClaimsAnalytics = { lossRatio: LossRatio[]; repudiation: Repudiation[] };

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const byCur = (m: Record<string, string>) => Object.entries(m).filter(([, v]) => Number(v)).map(([c, v]) => `${c} ${money(Number(v))}`).join(" · ");
const STATE: Record<ClaimRecord["state"], { label: string; cls: string }> = {
  open: { label: "Open", cls: "bg-amber-500/10 text-amber-700 border-amber-200" },
  settled: { label: "Settled", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
  repudiated: { label: "Declined", cls: "bg-rose-500/10 text-rose-700 border-rose-200" },
};
const stateBadge = (r: ClaimRecord) => <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${STATE[r.state].cls}`}>{STATE[r.state].label}</Badge>;
const refCell = (r: ClaimRecord) => (
  <span className="whitespace-nowrap">
    <span className="font-mono text-sm">{r.reference}</span>
    {r.kind === "funeral" && <span className="block text-[10px] text-amber-700">funeral — no claim raised</span>}
    {r.kind === "claim" && r.funeralCase && <span className="block text-[10px] text-muted-foreground">funeral {r.funeralCase}</span>}
  </span>
);
const costCell = (r: ClaimRecord) => {
  const parts = [r.cashInLieu ? `${r.currency} ${money(Number(r.cashInLieu))} cash` : "", byCur(r.funeralCost)].filter(Boolean);
  return parts.length ? <span className="tabular-nums whitespace-nowrap text-xs">{parts.join(" · ")}</span> : <span className="text-xs text-amber-700" title="No requisition is linked to this funeral case">not costed</span>;
};

const columns: EdtColumn<ClaimRecord>[] = [
  { id: "reference", header: "Claim / funeral", accessor: (r) => r.reference, cell: refCell },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber || "—"}</span> },
  { id: "deceased", header: "Deceased", accessor: (r) => r.deceased, cell: (r) => <span className="whitespace-nowrap">{r.deceased}{r.relationship && <span className="block text-[10px] text-muted-foreground">{r.relationship}</span>}</span> },
  { id: "client", header: "Policyholder", accessor: (r) => r.client, cell: (r) => <span className="whitespace-nowrap text-sm">{r.client || "—"}{r.clientPhone && <span className="block text-[10px] text-muted-foreground">{r.clientPhone}</span>}</span> },
  { id: "dod", header: "Date of death", accessor: (r) => r.dateOfDeath ?? "", cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.dateOfDeath)}</span> },
  { id: "reported", header: "Reported", accessor: (r) => r.reported, cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.reported)}</span> },
  { id: "decided", header: "Decided / done", accessor: (r) => r.decided ?? "", cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.decided)}{r.daysToDecide != null && <span className="block text-[10px] text-muted-foreground">{r.daysToDecide} day{r.daysToDecide === 1 ? "" : "s"}</span>}</span> },
  { id: "state", header: "Status", accessor: (r) => STATE[r.state].label, cell: (r) => <span className="whitespace-nowrap">{stateBadge(r)}<span className="block text-[10px] text-muted-foreground">{r.status.replace(/_/g, " ")}</span></span> },
  { id: "cost", header: "Cost", align: "right", accessor: (r) => Number(r.cashInLieu ?? 0) + Object.values(r.funeralCost).reduce((a, v) => a + Number(v), 0), cell: costCell },
  { id: "society", header: "Charged to society", align: "right", accessor: (r) => Number(r.chargedToSociety ?? 0), cell: (r) => <span className="tabular-nums text-xs text-muted-foreground">{r.chargedToSociety ? `${r.currency} ${money(Number(r.chargedToSociety))}` : "—"}</span> },
  { id: "reason", header: "Decline reason", accessor: (r) => r.decisionReason, cell: (r) => <span className="text-xs">{r.state === "repudiated" ? r.decisionReason || "—" : ""}</span> },
  { id: "branch", header: "Branch", accessor: (r) => r.branch },
];

const agingColumns: EdtColumn<ClaimRecord>[] = [
  { id: "reference", header: "Claim / funeral", accessor: (r) => r.reference, cell: refCell },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber || "—"}</span> },
  { id: "deceased", header: "Deceased", accessor: (r) => r.deceased },
  { id: "status", header: "Where it stands", accessor: (r) => r.status, cell: (r) => <span className="text-sm capitalize">{r.status.replace(/_/g, " ")}</span> },
  { id: "reported", header: "Reported", accessor: (r) => r.reported, cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.reported)}</span> },
  { id: "days", header: "Days open", align: "right", accessor: (r) => r.daysOpen ?? 0, cell: (r) => <span className={`tabular-nums ${r.overdue ? "text-destructive font-semibold" : ""}`}>{r.daysOpen}</span> },
  { id: "overdue", header: "", accessor: (r) => (r.overdue ? 1 : 0), cell: (r) => r.overdue ? <Badge variant="destructive" className="text-[10px]">Overdue</Badge> : null },
  { id: "cost", header: "Spent so far", align: "right", accessor: (r) => Object.values(r.funeralCost).reduce((a, v) => a + Number(v), 0), cell: costCell },
  { id: "branch", header: "Branch", accessor: (r) => r.branch },
];

export function ClaimsSection({ filters, q, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: claimsReport = [], isLoading: loadingClaimsReport } = useQuery<ClaimRecord[]>({
    queryKey: ["reports", "claims-report", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the claims register");
      return res.json();
    },
    enabled: need("claimsReport"),
  });
  const { data: aging = [], isLoading: loadingAging } = useQuery<{ slaDays: number; rows: ClaimRecord[] } | ClaimRecord[], Error, { slaDays: number; rows: ClaimRecord[] }>({
    queryKey: ["reports", "claims-aging", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims-aging" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load claims aging");
      return res.json();
    },
    select: (d: any) => (Array.isArray(d) ? { slaDays: 5, rows: d } : d),
    enabled: need("claimsAging"),
  });
  const agingRows = (aging as any)?.rows ?? [];
  const slaDays = (aging as any)?.slaDays ?? 5;
  const { data: analytics, isLoading: loadingAnalytics } = useQuery<ClaimsAnalytics | null>({
    queryKey: ["reports", "claims-analytics", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims-analytics" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("claimsAnalytics"),
  });

  const overdueCount = agingRows.filter((a: ClaimRecord) => a.overdue).length;
  const notCosted = claimsReport.filter((r) => r.state !== "repudiated" && !r.cashInLieu && Object.keys(r.funeralCost).length === 0).length;
  const noClaimRaised = claimsReport.filter((r) => r.kind === "funeral").length;

  return (
    <>
      <TabsContent value="claims">
        <CardSection
          title="Claims register"
          icon={FileText}
          description="Every claim reported in the period — and every funeral done under a policy where no claim was raised, since those are claims too. Cost is cash in lieu plus what was spent on the funeral (requisitions linked to the case). The society deduction is shown separately: it's the society paying at the agreed rate, not a cost."
          headerRight={<ExportButton reportType="claims" filters={filters} />}
          flush
        >
          {loadingClaimsReport ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              {(noClaimRaised > 0 || notCosted > 0) && (
                <p className="px-4 py-2 text-xs text-amber-700 border-b">
                  {noClaimRaised > 0 && <>{noClaimRaised} funeral{noClaimRaised === 1 ? " was" : "s were"} done under a policy with no claim raised (see Book Health → Data integrity). </>}
                  {notCosted > 0 && <>{notCosted} {notCosted === 1 ? "has" : "have"} no costs recorded — link the funeral&apos;s requisitions to its case so the cost is known.</>}
                </p>
              )}
              <EnhancedDataTable columns={columns} rows={claimsReport} getRowKey={(c) => `${c.kind}-${c.reference}`} exportFilename="claims-report" storageKey="reports-claims-v2" emptyMessage="No claims in this period." />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="claims-aging">
        <CardSection
          title="Claims aging"
          icon={Clock}
          description={`Every claim still open — not yet paid, declined or closed, and the funeral not yet completed — by how long it has been open. Overdue is more than ${slaDays} days, the claims deadline.`}
          headerRight={<ExportButton reportType="claims-aging" filters={filters} />}
          flush
        >
          {loadingAging ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : agingRows.length === 0 ? (
            <EmptyState title="No open claims" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 p-4">
                <KpiStatCard label="Open" value={agingRows.length} icon={Clock} />
                <KpiStatCard label={`Overdue (over ${slaDays} days)`} value={<span className={overdueCount > 0 ? "text-destructive" : ""}>{overdueCount}</span>} icon={Clock} />
                <KpiStatCard label="Oldest (days)" value={agingRows[0]?.daysOpen ?? 0} icon={Clock} />
              </div>
              <EnhancedDataTable columns={agingColumns} rows={agingRows} getRowKey={(r) => `${r.kind}-${r.reference}`} exportFilename="claims-aging" storageKey="reports-claims-aging-v2" emptyMessage="No open claims." />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="claims-analytics">
        <CardSection
          title="Loss ratio & repudiation"
          icon={TrendingDown}
          description="Loss ratio = claims in the period (cash in lieu decided + money spent on funerals done under a policy) ÷ premium in the period (premiums and society lump sums, as on the Income Statement), per currency — the same figures as the IPEC return. Repudiation = declined as a share of decided, by claim type."
          headerRight={<ExportButton reportType="claims-analytics" filters={filters} />}
          flush
        >
          {loadingAnalytics ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !analytics || (analytics.lossRatio.length === 0 && analytics.repudiation.length === 0) ? (
            <EmptyState title="No claims or premium in this period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="p-4 space-y-6">
              <div>
                <p className="text-sm font-semibold mb-2">Loss ratio</p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {analytics.lossRatio.map((l) => (
                    <div key={l.currency} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{l.currency}</p>
                      <p className={`text-lg font-bold tabular-nums ${l.ratio > 70 ? "text-destructive" : l.ratio > 50 ? "text-amber-600" : "text-emerald-600"}`}>{l.ratio}%</p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">{money(l.claimsIncurred)} claims / {money(l.premiumCollected)} premium</p>
                    </div>
                  ))}
                </div>
              </div>
              {analytics.repudiation.length > 0 && (
                <div>
                  <p className="text-sm font-semibold mb-2">By claim type</p>
                  <div className="overflow-x-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                        <tr><th className="text-left px-3 py-2">Claim type</th><th className="text-right px-3 py-2">Reported</th><th className="text-right px-3 py-2">Settled</th><th className="text-right px-3 py-2">Declined</th><th className="text-right px-3 py-2">Still open</th><th className="text-right px-3 py-2">Repudiation rate</th></tr>
                      </thead>
                      <tbody>
                        {analytics.repudiation.map((r) => (
                          <tr key={r.claimType} className="border-t">
                            <td className="px-3 py-2 capitalize">{r.claimType.replace(/_/g, " ")}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.reported}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-emerald-600">{r.settled}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-destructive">{r.repudiated}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{r.open}</td>
                            <td className={`px-3 py-2 text-right tabular-nums font-semibold ${r.repudiationRate > 20 ? "text-destructive" : ""}`}>{r.repudiationRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
