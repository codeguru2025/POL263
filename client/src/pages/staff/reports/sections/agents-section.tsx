import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, FileText, UserCircle, TrendingUp, Percent, Download } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

interface AgentsSectionProps extends ReportSectionBaseProps {
  fromDate: string;
  toDate: string;
  agentId: string;
  canReadCommission: boolean;
}

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const byCur = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0).map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";

const agentSummaryColumns: EdtColumn<any>[] = [
  { id: "agent", header: "Agent", accessor: (a) => a.agent, cell: (a) => <span className="text-sm whitespace-nowrap">{a.agent}</span> },
  { id: "active", header: "Active", align: "right", accessor: (a) => a.active },
  { id: "grace", header: "Grace", align: "right", accessor: (a) => a.grace },
  { id: "lapsed", header: "Lapsed", align: "right", accessor: (a) => a.lapsed },
  { id: "neverPaid", header: "Never paid", align: "right", accessor: (a) => a.neverPaid, cell: (a) => <span className="tabular-nums text-muted-foreground">{a.neverPaid}</span> },
  { id: "premium", header: "Monthly premium in force", align: "right", accessor: (a) => Object.values(a.monthlyPremiumInForce ?? {}).reduce((s: number, v: any) => s + Number(v), 0), cell: (a) => <span className="tabular-nums whitespace-nowrap">{byCur(a.monthlyPremiumInForce)}</span> },
  { id: "behind", header: "Behind on payment", align: "right", accessor: (a) => a.behind, cell: (a) => <span className={`tabular-nums ${a.behind ? "text-rose-700 font-medium" : ""}`}>{a.behind}</span> },
];

const agentPortfolioColumns: EdtColumn<any>[] = [
  { id: "agent", header: "Agent", accessor: (p) => p.agent, cell: (p) => <span className="text-sm whitespace-nowrap">{p.agent}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber || "—"}</span> },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
  { id: "firstName", header: "First name", accessor: (p) => p.firstName, cell: (p) => <span className="whitespace-nowrap">{p.firstName || "—"}</span> },
  { id: "lastName", header: "Last name", accessor: (p) => p.lastName, cell: (p) => <span className="whitespace-nowrap">{p.lastName || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.phone },
  { id: "product", header: "Product", accessor: (p) => p.product },
  { id: "premium", header: "Premium", align: "right", accessor: (p) => Number(p.premium), cell: (p) => <span className="tabular-nums whitespace-nowrap">{p.currency} {p.premium}</span> },
  { id: "paidUpTo", header: "Paid up to", accessor: (p) => p.paidUpTo ?? "", cell: (p) => <span className="text-sm whitespace-nowrap">{fmtDay(p.paidUpTo)}</span> },
  { id: "behind", header: "Behind", align: "right", accessor: (p) => p.periodsBehind, cell: (p) => p.periodsBehind ? <span className="tabular-nums text-rose-700 whitespace-nowrap">{p.periodsBehind} ({p.currency} {p.amountBehind})</span> : <span className="text-muted-foreground">—</span> },
  { id: "lastPayment", header: "Last payment", accessor: (p) => p.lastPaymentDate ?? "", cell: (p) => <span className="text-sm whitespace-nowrap">{p.lastPaymentDate ? `${fmtDay(p.lastPaymentDate)} · ${p.lastPaymentCurrency ?? p.currency} ${p.lastPaymentAmount}` : "—"}</span> },
  { id: "group", header: "Group", accessor: (p) => p.group },
  { id: "branch", header: "Branch", accessor: (p) => p.branch },
  { id: "effectiveDate", header: "Effective date", accessor: (p) => p.inceptionDate ?? "", cell: (p) => <span className="text-sm whitespace-nowrap">{fmtDay(p.inceptionDate)}</span> },
];

const pctCell = (v: number | null, goodHigh = true) => v == null ? <span className="text-muted-foreground">—</span>
  : <span className={`tabular-nums ${goodHigh ? (v >= 70 ? "text-emerald-700" : v < 40 ? "text-rose-700" : "") : ""}`}>{v}%</span>;

const agentProductivityColumns: EdtColumn<any>[] = [
  { id: "rank", header: "#", align: "right", accessor: (r) => r.rank ?? 999, cell: (r) => <span className="tabular-nums text-muted-foreground">{r.rank ?? "—"}</span> },
  { id: "agent", header: "Agent", accessor: (r) => r.agent, cell: (r) => <span className="text-sm whitespace-nowrap">{r.agent}</span> },
  { id: "newSold", header: "Sold", align: "right", accessor: (r) => r.newSold },
  { id: "paid", header: "Paid", align: "right", accessor: (r) => r.paid },
  { id: "conversion", header: "Conversion", align: "right", accessor: (r) => r.conversionPct ?? -1, cell: (r) => pctCell(r.conversionPct) },
  { id: "premium", header: "New monthly premium", align: "right", accessor: (r) => Object.values(r.newMonthlyPremium ?? {}).reduce((a: number, v: any) => a + Number(v), 0), cell: (r) => <span className="tabular-nums whitespace-nowrap">{byCur(r.newMonthlyPremium)}</span> },
  { id: "avg", header: "Avg premium / lives", align: "right", accessor: (r) => r.avgPremiumUsd ?? -1, cell: (r) => <span className="tabular-nums whitespace-nowrap text-xs">{r.avgPremiumUsd != null ? `USD ${r.avgPremiumUsd.toFixed(2)}` : "—"} · {r.avgLives ?? "—"} lives</span> },
  { id: "collected", header: "Collected on their book", align: "right", accessor: (r) => Object.values(r.collected ?? {}).reduce((a: number, v: any) => a + Number(v), 0), cell: (r) => <span className="tabular-nums whitespace-nowrap">{byCur(r.collected)}</span> },
  { id: "lapses", header: "Lapses", align: "right", accessor: (r) => r.lapses, cell: (r) => <span className={`tabular-nums ${r.lapses ? "text-rose-700" : ""}`}>{r.lapses}</span> },
  { id: "persistency", header: "Persistency", align: "right", accessor: (r) => r.persistencyPct ?? -1, cell: (r) => pctCell(r.persistencyPct) },
  { id: "stuck", header: "Didn't stick (6 mo)", align: "right", accessor: (r) => (r.recentSold ? r.recentNotStuck / r.recentSold : -1), cell: (r) => r.recentSold ? <span className={`tabular-nums whitespace-nowrap ${r.recentNotStuck / r.recentSold > 0.5 ? "text-rose-700" : ""}`} title="Sold in the 6 months to the period end that never paid (30+ days on) or have lapsed">{r.recentNotStuck} of {r.recentSold}</span> : <span className="text-muted-foreground">—</span> },
  { id: "commission", header: "Commission / clawed back", align: "right", accessor: (r) => Object.values(r.commissionEarned ?? {}).reduce((a: number, v: any) => a + Number(v), 0), cell: (r) => <span className="tabular-nums whitespace-nowrap text-xs">{byCur(r.commissionEarned)}{byCur(r.clawedBack) !== "—" && <span className="text-rose-700"> · {byCur(r.clawedBack)}</span>}</span> },
  { id: "commPct", header: "Commission % of collected", align: "right", accessor: (r) => r.commissionPctOfCollected ?? -1, cell: (r) => pctCell(r.commissionPctOfCollected, false) },
  { id: "typedIn", header: "Typed in (not sales)", align: "right", accessor: (r) => r.typedIn, cell: (r) => <span className="tabular-nums text-muted-foreground">{r.typedIn || "—"}</span> },
];

const newSaleColumns: EdtColumn<any>[] = [
  { id: "agent", header: "Agent", accessor: (r) => r.agent, cell: (r) => <span className="text-xs whitespace-nowrap">{r.agent}</span> },
  { id: "policy", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-xs whitespace-nowrap">{r.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (r) => r.client, cell: (r) => <span className="text-xs whitespace-nowrap">{r.client}</span> },
  { id: "product", header: "Product", accessor: (r) => r.product },
  { id: "captured", header: "Captured", accessor: (r) => r.capturedOn, cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDay(r.capturedOn)}</span> },
  { id: "premium", header: "Premium", align: "right", accessor: (r) => Number(r.premium), cell: (r) => <span className="tabular-nums whitespace-nowrap text-xs">{r.currency} {r.premium}</span> },
  { id: "paid", header: "Paid?", accessor: (r) => r.paid, cell: (r) => r.paid === "unpaid" ? <span className="text-xs text-rose-700 font-medium">Not yet</span> : <span className="text-xs text-emerald-700">{r.paid === "group" ? "Through society" : "Yes"}</span> },
  { id: "first", header: "First payment", accessor: (r) => r.firstPaymentDate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.firstPaymentDate ? `${fmtDay(r.firstPaymentDate)} · ${r.firstPaymentCurrency || r.currency} ${r.firstPaymentAmount}` : "—"}</span> },
];

const money2 = (v: string) => Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const commissionSummaryColumns: EdtColumn<any>[] = [
  { id: "agent", header: "Agent", accessor: (r) => r.agent, cell: (r) => <span className={`whitespace-nowrap ${r.agentId ? "font-medium" : "text-muted-foreground italic"}`}>{r.agent}</span> },
  { id: "currency", header: "Currency", accessor: (r) => r.currency, cell: (r) => <span className="font-mono text-xs">{r.currency}</span> },
  { id: "opening", header: "Owed at start", align: "right", accessor: (r) => Number(r.opening), cell: (r) => <span className="tabular-nums">{money2(r.opening)}</span> },
  { id: "earnedPolicies", header: "Earned on policies", align: "right", accessor: (r) => Number(r.earnedPolicies), cell: (r) => <span className="tabular-nums">{money2(r.earnedPolicies)}</span> },
  { id: "earnedSocieties", header: "Earned on societies", align: "right", accessor: (r) => Number(r.earnedSocieties), cell: (r) => <span className="tabular-nums">{money2(r.earnedSocieties)}</span> },
  { id: "clawedBack", header: "Clawed back", align: "right", accessor: (r) => Number(r.clawedBack), cell: (r) => <span className={`tabular-nums ${Number(r.clawedBack) ? "text-rose-700" : ""}`}>{money2(r.clawedBack)}</span> },
  { id: "paid", header: "Paid to agent", align: "right", accessor: (r) => Number(r.paid), cell: (r) => <span className="tabular-nums">{money2(r.paid)}</span> },
  { id: "closing", header: "Still owed", align: "right", accessor: (r) => Number(r.closing), cell: (r) => <span className={`tabular-nums font-semibold ${Number(r.closing) < 0 ? "text-rose-700" : ""}`}>{money2(r.closing)}</span> },
  { id: "policies", header: "Policies that earned", align: "right", accessor: (r) => r.policies },
];

const commissionPlansColumns: EdtColumn<any>[] = [
  { id: "name", header: "Plan Name", accessor: (cp) => cp.name, cell: (cp) => <span className="font-medium">{cp.name}</span> },
  { id: "type", header: "Type", accessor: (cp) => cp.commissionType, cell: (cp) => <Badge variant="outline">{cp.commissionType}</Badge> },
  { id: "rate", header: "Rate (%)", accessor: (cp) => cp.ratePercent, cell: (cp) => <span>{cp.ratePercent}%</span> },
  {
    id: "status",
    header: "Status",
    accessor: (cp) => (cp.isActive ? "Active" : "Inactive"),
    cell: (cp) => <Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge>,
  },
  {
    id: "created",
    header: "Created",
    accessor: (cp) => new Date(cp.createdAt),
    cell: (cp) => <span className="text-sm text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</span>,
  },
];

const commissionPaymentsColumns: EdtColumn<any>[] = [
  { id: "receiptNumber", header: "Receipt #", accessor: (r) => r.receiptNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.receiptNumber}</span> },
  { id: "firstName", header: "First Name", accessor: (r) => r.clientFirstName || "", cell: (r) => <span className="whitespace-nowrap">{r.clientFirstName || "—"}</span> },
  { id: "surname", header: "Surname", accessor: (r) => r.clientLastName || "", cell: (r) => <span className="whitespace-nowrap">{r.clientLastName || "—"}</span> },
  { id: "nationalId", header: "National ID", accessor: (r) => r.clientNationalId || "", cell: (r) => <span className="font-mono text-sm">{r.clientNationalId || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (r) => r.clientPhone || "" },
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "policyStatus", header: "Policy Status", accessor: (r) => r.policyStatus, cell: (r) => <StatusBadge status={r.policyStatus} variant="policy" /> },
  { id: "policyPremium", header: "Policy Premium", accessor: (r) => parseFloat(r.policyPremium || 0), cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.currency} {r.policyPremium}</span> },
  { id: "amountDue", header: "Amount Due", accessor: (r) => parseFloat(r.amountDue || 0), cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.currency} {r.amountDue}</span> },
  {
    id: "amountPaid",
    header: "Amount Paid",
    accessor: (r) => parseFloat(String(r.amountPaid ?? 0)),
    cell: (r) => <span className="font-medium tabular-nums whitespace-nowrap">{r.currency} {parseFloat(String(r.amountPaid ?? 0)).toFixed(2)}</span>,
  },
  {
    id: "commissionPayable",
    header: "Commission Payable",
    accessor: (r) => r.commissionPayable != null ? parseFloat(String(r.commissionPayable)) : "",
    cell: (r) => (
      <span className="tabular-nums whitespace-nowrap text-emerald-700 font-medium">
        {r.commissionPayable != null ? `${r.commissionCurrency || r.currency} ${parseFloat(String(r.commissionPayable)).toFixed(2)}` : "—"}
      </span>
    ),
  },
  { id: "commType", header: "Comm. Type", accessor: (r) => r.commissionType || "", cell: (r) => <span className="text-xs">{r.commissionType ? <Badge variant="outline" className="text-xs">{r.commissionType}</Badge> : "—"}</span> },
  { id: "agent", header: "Agent", accessor: (r) => r.agentName || "Walk-in", cell: (r) => <span className="text-sm whitespace-nowrap">{r.agentName || "Walk-in"}</span> },
  { id: "monthsPaid", header: "Months Paid", accessor: (r) => r.monthsPaidFor, cell: (r) => <span className="tabular-nums text-center block">{r.monthsPaidFor}</span> },
  { id: "receiptCount", header: "Receipt Count", accessor: (r) => r.receiptCount, cell: (r) => <span className="tabular-nums text-center block">{r.receiptCount}</span> },
  { id: "policyBranch", header: "Policy Branch", accessor: (r) => r.policyBranch || "" },
  { id: "paymentBranch", header: "Payment Branch", accessor: (r) => r.paymentBranch || "" },
  { id: "periodFrom", header: "Period From", accessor: (r) => r.periodFrom || "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.periodFrom || "—"}</span> },
  { id: "periodTo", header: "Period To", accessor: (r) => r.periodTo || "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.periodTo || "—"}</span> },
  { id: "channel", header: "Channel", accessor: (r) => r.paymentChannel || "", cell: (r) => <span className="text-xs"><Badge variant="outline" className="text-[10px]">{r.paymentChannel || "—"}</Badge></span> },
  {
    id: "issuedAt",
    header: "Issued At",
    accessor: (r) => r.issuedAt ? new Date(r.issuedAt) : "",
    cell: (r) => <span className="text-sm text-muted-foreground whitespace-nowrap">{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "—"}</span>,
  },
];

export function AgentsSection({ filters, q, qAppend, fk, runKey, need, fromDate, toDate, agentId, canReadCommission }: AgentsSectionProps) {
  const { data: agentPortfolio, isLoading: loadingAgentPortfolio } = useQuery<{ agents: any[]; policies: any[]; asOf: string }>({
    queryKey: ["reports", "agent-portfolio", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-portfolio" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the agent portfolio");
      return res.json();
    },
    enabled: need("agentPortfolio"),
  });
  const { data: agentProductivity, isLoading: loadingAgentProductivity } = useQuery<{ scorecard: any[]; newSales: any[] }>({
    queryKey: ["reports", "agent-productivity", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-productivity" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load agent productivity");
      return res.json();
    },
    enabled: need("agentProductivity"),
  });
  const { data: commissionPlans = [], isLoading: loadingCommissionPlans } = useQuery<any[]>({
    queryKey: ["reports", "commission-plans", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/commission-plans", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionPlans") && canReadCommission,
  });
  const { data: commissionStatement, isLoading: loadingCommissionSummary } = useQuery<{ rows: any[]; totals: Record<string, { earned: string; clawedBack: string; paid: string; owed: string }> }>({
    queryKey: ["reports", "commissions-summary", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commissions-summary" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load commissions");
      return res.json();
    },
    enabled: need("commissionSummary") && canReadCommission,
  });
  const { data: commissionPayments = [], isLoading: loadingCommissionPayments } = useQuery<any[]>({
    queryKey: ["reports", "commission-payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commission-payments?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionPayments") && canReadCommission,
  });

  return (
    <>
      <TabsContent value="agent-portfolio">
        <CardSection
          title="Agent portfolio"
          description="Each agent's book at a glance, then every policy as a call list — most behind on payment first. A society's agent owns the society's policies. The PDF and CSV call sheets add blank Call Outcome and Next Engagement columns for follow-up."
          icon={UserCircle}
          headerRight={
            <div className="flex gap-2">
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={() => {
                  const a = document.createElement("a");
                  a.href = getApiBase() + "/api/reports/agent-portfolio/pdf?download=1" + qAppend;
                  a.download = "agent-portfolio.pdf";
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                }}
              >
                <FileText className="h-4 w-4" /> PDF
              </button>
              <ExportButton reportType="agent-portfolio" filters={filters} />
            </div>
          }
          flush
        >
          {loadingAgentPortfolio ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
            <div className="px-4 pt-3 text-xs font-semibold uppercase text-muted-foreground">By agent</div>
            <EnhancedDataTable
              columns={agentSummaryColumns}
              rows={agentPortfolio?.agents ?? []}
              getRowKey={(a) => a.agent}
              exportFilename="agent-portfolio-summary"
              storageKey="reports-agent-portfolio-summary"
              emptyMessage="No policies found."
            />
            <div className="px-4 pt-4 text-xs font-semibold uppercase text-muted-foreground">Policies — most behind first</div>
            <EnhancedDataTable
              columns={agentPortfolioColumns}
              rows={agentPortfolio?.policies ?? []}
              getRowKey={(p) => p.policyNumber || `${p.agent}-${p.nationalId}-${p.inceptionDate}`}
              exportFilename="agent-portfolio"
              storageKey="reports-agent-portfolio-v2"
              emptyMessage="No policies found. Adjust filters and click Run report."
            />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="agent-productivity">
        <CardSection
          title="Agent productivity"
          icon={TrendingUp}
          description="A scorecard per agent for the period: what they sold and how much of it paid, what came in on their book, how their sales hold up, and what their commission costs. New business only — existing policies typed in are counted separately. Ranked by new monthly premium sold."
          headerRight={<ExportButton reportType="agent-productivity" filters={filters} />}
          flush
        >
          {loadingAgentProductivity ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <EnhancedDataTable
                columns={agentProductivityColumns}
                rows={agentProductivity?.scorecard ?? []}
                getRowKey={(r) => r.agentId ?? "none"}
                exportFilename="agent-productivity"
                storageKey="reports-agent-productivity-v2"
                emptyMessage="No agent activity in this period."
              />
              <div className="px-4 pt-4 text-xs font-semibold uppercase text-muted-foreground">New policies sold in the period — unpaid first</div>
              <EnhancedDataTable
                columns={newSaleColumns}
                rows={agentProductivity?.newSales ?? []}
                getRowKey={(r) => r.policyNumber}
                exportFilename="agent-new-sales"
                storageKey="reports-agent-new-sales"
                emptyMessage="No new policies sold in this period."
              />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="commissions" className="space-y-6">
        <CardSection
          title="Commissions — what agents are owed"
          icon={Percent}
          description={<>What each agent is owed: owed at the start of the period, plus commission earned, less clawbacks and less what was paid to them (Commission requisitions that name the agent) = still owed. A month of clawbacks carries forward as a lower balance. The company&apos;s own walk-in commission is shown separately — it isn&apos;t owed to anyone.{!agentId ? <span className="block mt-1">Select an agent above to download that agent&apos;s detailed ledger lines (optional).</span> : null}</>}
          headerRight={
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton reportType="commissions" filters={filters} />
              {agentId && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const suffix = q ? `${q}&` : "?";
                      const url = getApiBase() + `/api/reports/export/commissions${suffix}mode=ledger`;
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = "commissions-ledger.csv";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                    data-testid="button-export-commission-ledger"
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Agent ledger CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const suffix = q ? `${q}&` : "?";
                      window.open(getApiBase() + `/api/reports/commission-statement/pdf${suffix}agentId=${encodeURIComponent(agentId)}&download=1`, "_blank");
                    }}
                    data-testid="button-commission-statement-pdf"
                  >
                    <FileText className="h-4 w-4 mr-1" />
                    Statement PDF
                  </Button>
                </>
              )}
            </div>
          }
          contentClassName="overflow-x-auto"
          flush>
          {loadingCommissionSummary ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
            {commissionStatement && Object.keys(commissionStatement.totals).length > 0 && (
              <div className="px-4 py-3 border-b text-sm">
                Still owed to agents{" "}
                <span className="font-semibold tabular-nums">{Object.entries(commissionStatement.totals).map(([cur, t]) => `${cur} ${money2(t.owed)}`).join(" · ")}</span>
                <span className="text-xs text-muted-foreground"> · this period earned {Object.entries(commissionStatement.totals).map(([cur, t]) => `${cur} ${money2(t.earned)}`).join(" · ")}, clawed back {Object.entries(commissionStatement.totals).map(([cur, t]) => `${cur} ${money2(t.clawedBack)}`).join(" · ")}, paid {Object.entries(commissionStatement.totals).map(([cur, t]) => `${cur} ${money2(t.paid)}`).join(" · ")}</span>
              </div>
            )}
            <EnhancedDataTable
              columns={commissionSummaryColumns}
              rows={commissionStatement?.rows ?? []}
              getRowKey={(row) => `${row.agentId ?? "company"}-${row.currency}`}
              rowTestId={(row) => `row-commission-summary-${row.agentId ?? "company"}-${row.currency}`}
              exportFilename="commissions-summary"
              storageKey="reports-commissions-summary-v2"
              emptyMessage="No commission activity in this period."
            />
            </>
          )}
        </CardSection>

        <CardSection title="Commission plans" icon={Percent} description="Configured commission rules for products (reference)." flush>
          {loadingCommissionPlans ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={commissionPlansColumns}
              rows={commissionPlans}
              getRowKey={(cp) => cp.id}
              rowTestId={(cp) => `row-commission-plan-${cp.id}`}
              exportFilename="commission-plans"
              storageKey="reports-commission-plans"
              emptyMessage="No commission plans recorded."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="commission-payments">
        <CardSection
          title="Commission by payment"
          description="One row per receipt. Shows client, policy premium, amount paid, commission earned by the agent, and branch info. Filter by date range, agent, or branch."
          icon={Percent}
          headerRight={<ExportButton reportType="commission-payments" filters={filters} />}
          flush
        >
          {loadingCommissionPayments ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={commissionPaymentsColumns}
              rows={commissionPayments}
              getRowKey={(r) => r.receiptId}
              exportFilename="commission-payments"
              storageKey="reports-commission-payments"
              emptyMessage="No payment receipts match the filters. Set a date range and click Run report."
            />
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
