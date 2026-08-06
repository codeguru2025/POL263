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

const agentPortfolioColumns: EdtColumn<any>[] = [
  { id: "agent", header: "Agent", accessor: (p) => p.AgentsName || "", cell: (p) => <span className="text-sm whitespace-nowrap">{p.AgentsName || "—"}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.Policy_Number || "", cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.Policy_Number || "—"}</span> },
  { id: "status", header: "Status", accessor: (p) => p.currstatus, cell: (p) => <StatusBadge status={p.currstatus} variant="policy" /> },
  { id: "firstName", header: "First Name", accessor: (p) => (p.fullname ?? "").split(" ")[0] || "", cell: (p) => <span className="whitespace-nowrap">{(p.fullname ?? "").split(" ")[0] || "—"}</span> },
  { id: "lastName", header: "Last Name", accessor: (p) => (p.fullname ?? "").split(" ").slice(1).join(" ") || "", cell: (p) => <span className="whitespace-nowrap">{(p.fullname ?? "").split(" ").slice(1).join(" ") || "—"}</span> },
  { id: "nationalId", header: "National ID", accessor: (p) => p.ID_Number || "", cell: (p) => <span className="font-mono text-sm">{p.ID_Number || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.Cell_Number || "" },
  { id: "product", header: "Product", accessor: (p) => p.ProductName || "" },
  { id: "branch", header: "Branch", accessor: (p) => p.BranchName || "" },
  { id: "premium", header: "Premium", accessor: (p) => p.UsualPremium || "", cell: (p) => <span className="tabular-nums whitespace-nowrap">{p.UsualPremium || "—"}</span> },
  {
    id: "effectiveDate",
    header: "Effective Date",
    accessor: (p) => p.Inception_Date ? new Date(p.Inception_Date) : "",
    cell: (p) => <span className="text-sm whitespace-nowrap">{p.Inception_Date ? new Date(p.Inception_Date).toLocaleDateString() : "—"}</span>,
  },
  { id: "callOutcome", header: "Call Outcome", sortable: false, headClassName: "text-muted-foreground italic", cell: () => <span className="text-muted-foreground text-xs italic border-l">____________</span> },
  { id: "nextEngagement", header: "Next Engagement", sortable: false, headClassName: "text-muted-foreground italic", cell: () => <span className="text-muted-foreground text-xs italic border-l">____________</span> },
];

const agentProductivityColumns: EdtColumn<any>[] = [
  { id: "agentId", header: "agent_id", accessor: (r) => r.agent_id || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.agent_id || "—"}</span> },
  { id: "agentsName", header: "AgentsName", accessor: (r) => r.AgentsName || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[120px] truncate block" title={r.AgentsName}>{r.AgentsName || "—"}</span> },
  { id: "inceptionDate", header: "Inception_Date", accessor: (r) => r.Inception_Date || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</span> },
  { id: "policyNumber", header: "Policy_Number", accessor: (r) => r.Policy_Number, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.Policy_Number}</span> },
  { id: "fullName", header: "FullName", accessor: (r) => r.FullName || "", cell: (r) => <span className="text-xs max-w-[140px] truncate block" title={r.FullName}>{r.FullName || "—"}</span> },
  { id: "productName", header: "Product_Name", accessor: (r) => r.Product_Name || "", cell: (r) => <span className="text-xs max-w-[140px] truncate block" title={r.Product_Name}>{r.Product_Name || "—"}</span> },
  { id: "usualPremium", header: "UsualPremium", accessor: (r) => r.UsualPremium || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.UsualPremium || "—"}</span> },
  { id: "statusDesc", header: "StatusDesc", accessor: (r) => r.StatusDesc, cell: (r) => <span className="text-xs whitespace-nowrap">{r.StatusDesc}</span> },
  { id: "receiptsCollected", header: "ReceiptsCollected", accessor: (r) => r.ReceiptsCollected, cell: (r) => <span className="text-xs">{r.ReceiptsCollected}</span> },
  { id: "colour", header: "Colour", accessor: (r) => r.Colour || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Colour || "—"}</span> },
  { id: "membersBranch", header: "MembersBranch", accessor: (r) => r.MembersBranch || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[100px] truncate block" title={r.MembersBranch}>{r.MembersBranch || "—"}</span> },
  { id: "agentsBranch", header: "AgentsBranch", accessor: (r) => r.AgentsBranch || "", cell: (r) => <span className="text-xs whitespace-nowrap max-w-[100px] truncate block" title={r.AgentsBranch}>{r.AgentsBranch || "—"}</span> },
  { id: "active", header: "Active", accessor: (r) => r.Active, cell: (r) => <span className="text-xs">{r.Active}</span> },
  { id: "fdate", header: "fdate", accessor: (r) => r.fdate, cell: (r) => <span className="text-xs whitespace-nowrap">{r.fdate}</span> },
  { id: "tdate", header: "tdate", accessor: (r) => r.tdate, cell: (r) => <span className="text-xs whitespace-nowrap">{r.tdate}</span> },
];

const commissionSummaryColumns: EdtColumn<any>[] = [
  { id: "agentName", header: "AGENT NAME", accessor: (row) => row.agentName, cell: (row) => <span className="font-medium whitespace-nowrap">{row.agentName}</span> },
  { id: "numberOfPolicies", header: "NUMBER OF POLICIES", accessor: (row) => row.numberOfPolicies },
  { id: "groupsCount", header: "Groups", accessor: (row) => row.groupsCount },
  { id: "groupsCommission", header: "Groups", accessor: (row) => row.groupsCommission, cell: (row) => <span className="font-mono text-xs">{row.groupsCommission}</span> },
  { id: "individualsCount", header: "individ", accessor: (row) => row.individualsCount },
  { id: "individualsCommission", header: "Individ", accessor: (row) => row.individualsCommission, cell: (row) => <span className="font-mono text-xs">{row.individualsCommission}</span> },
  { id: "investment", header: "Investm", accessor: (row) => row.investment, cell: (row) => <span className="font-mono text-xs">{row.investment}</span> },
  { id: "clawback", header: "Clawb", accessor: (row) => row.clawback, cell: (row) => <span className="font-mono text-xs">{row.clawback}</span> },
  { id: "callCenter", header: "Call Cen", accessor: (row) => row.callCenter, cell: (row) => <span className="font-mono text-xs">{row.callCenter}</span> },
  { id: "trips", header: "Trips", accessor: (row) => row.trips, cell: (row) => <span className="font-mono text-xs">{row.trips}</span> },
  { id: "cashSettlement", header: "Cash se", accessor: (row) => row.cashSettlement, cell: (row) => <span className="font-mono text-xs">{row.cashSettlement}</span> },
  { id: "basic", header: "Basic", accessor: (row) => row.basic, cell: (row) => <span className="font-mono text-xs">{row.basic}</span> },
  { id: "overtime", header: "Overtim", accessor: (row) => row.overtime, cell: (row) => <span className="font-mono text-xs">{row.overtime}</span> },
  { id: "total", header: "TOTAL", accessor: (row) => row.total, cell: (row) => <span className="font-mono text-xs font-semibold">{row.total}</span> },
  { id: "paye", header: "PA", accessor: (row) => row.paye, cell: (row) => <span className="text-xs">{row.paye}</span> },
  { id: "taxLevy", header: "TAX LE", accessor: (row) => row.taxLevy, cell: (row) => <span className="text-xs">{row.taxLevy}</span> },
  { id: "credit", header: "CRED", accessor: (row) => row.credit, cell: (row) => <span className="text-xs">{row.credit}</span> },
  { id: "advance", header: "ADVAN", accessor: (row) => row.advance, cell: (row) => <span className="text-xs">{row.advance}</span> },
  { id: "policyDeduction", header: "POLICY DEDUCTI", accessor: (row) => row.policyDeduction, cell: (row) => <span className="text-xs">{row.policyDeduction}</span> },
  { id: "medicalAidDeduction", header: "MEDICAL AID DEDUCTI", accessor: (row) => row.medicalAidDeduction, cell: (row) => <span className="text-xs">{row.medicalAidDeduction}</span> },
  { id: "unpaidMonths", header: "UNPAID M", accessor: (row) => row.unpaidMonths, cell: (row) => <span className="text-xs">{row.unpaidMonths}</span> },
  { id: "netPay", header: "NET P", accessor: (row) => row.netPay, cell: (row) => <span className="font-mono text-xs font-semibold">{row.netPay}</span> },
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
        {r.commissionPayable != null ? `${r.currency} ${parseFloat(String(r.commissionPayable)).toFixed(2)}` : "—"}
      </span>
    ),
  },
  { id: "commType", header: "Comm. Type", accessor: (r) => r.commissionType || "", cell: (r) => <span className="text-xs">{r.commissionType ? <Badge variant="outline" className="text-xs">{r.commissionType}</Badge> : "—"}</span> },
  { id: "agent", header: "Agent", accessor: (r) => r.agentName || "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.agentName || "—"}</span> },
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
  const { data: agentPortfolio = [], isLoading: loadingAgentPortfolio } = useQuery<any[]>({
    queryKey: ["reports", "agent-portfolio", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-portfolio?limit=2000" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("agentPortfolio"),
  });
  const { data: agentProductivity = [], isLoading: loadingAgentProductivity } = useQuery<any[]>({
    queryKey: ["reports", "agent-productivity", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-productivity?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
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
  const { data: commissionSummary = [], isLoading: loadingCommissionSummary } = useQuery<any[]>({
    queryKey: ["reports", "commissions-summary", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commissions-summary" + q, { credentials: "include" });
      if (!res.ok) return [];
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
          description="All policies assigned to each agent. Filter by agent or status. Export as PDF for printing or CSV for Excel — both include Call Outcome and Next Engagement Date columns for client follow-up."
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
            <EnhancedDataTable
              columns={agentPortfolioColumns}
              rows={agentPortfolio}
              getRowKey={(p) => p.Policy_Number || `${p.AgentsName}-${p.ID_Number}-${p.Inception_Date}`}
              exportFilename="agent-portfolio"
              storageKey="reports-agent-portfolio"
              emptyMessage="No policies found. Adjust filters and click Run report."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="agent-productivity">
        <CardSection title="Agent productivity" icon={TrendingUp} description="Policies captured and issued at least one receipt in the same from/to window. Set both dates; branch, product, and agent filters apply." headerRight={<ExportButton reportType="agent-productivity" filters={filters} />} flush>
          {!fromDate || !toDate ? (
            <EmptyState title="Set date range" description="Choose a from date and to date to run this report." className="border-0 rounded-none bg-transparent py-8" />
          ) : loadingAgentProductivity ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={agentProductivityColumns}
              rows={agentProductivity}
              getRowKey={(r) => r.policyId}
              exportFilename="agent-productivity"
              storageKey="reports-agent-productivity"
              emptyMessage="No policies registered and receipt-issued in range."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="commissions" className="space-y-6">
        <CardSection
          title="Commissions report"
          icon={Percent}
          description={<>Per-agent totals from the commission ledger for the selected date range and filters. Payroll columns without a system source (PAYE, advances, etc.) are left blank.{!agentId ? <span className="block mt-1">Select an agent above to download that agent&apos;s detailed ledger lines (optional).</span> : null}</>}
          headerRight={
            <div className="flex flex-wrap items-center gap-2">
              <ExportButton reportType="commissions" filters={filters} />
              {agentId && (
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
              )}
            </div>
          }
          contentClassName="overflow-x-auto"
          flush>
          {loadingCommissionSummary ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={commissionSummaryColumns}
              rows={commissionSummary}
              getRowKey={(row) => row.agentId}
              rowTestId={(row) => `row-commission-summary-${row.agentId}`}
              exportFilename="commissions-summary"
              storageKey="reports-commissions-summary"
              emptyMessage="No commission ledger activity in this period."
            />
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
