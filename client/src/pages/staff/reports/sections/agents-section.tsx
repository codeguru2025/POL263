import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
          ) : agentPortfolio.length === 0 ? (
            <EmptyState title="No policies found" description="Adjust filters and click Run report." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Effective Date</TableHead>
                    <TableHead className="text-muted-foreground italic">Call Outcome</TableHead>
                    <TableHead className="text-muted-foreground italic">Next Engagement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agentPortfolio.map((p: any, idx: number) => (
                    <TableRow key={p.Policy_Number ?? idx} className="hover:bg-muted/40">
                      <TableCell className="text-sm whitespace-nowrap">{p.AgentsName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{p.Policy_Number || "—"}</TableCell>
                      <TableCell><StatusBadge status={p.currstatus} variant="policy" /></TableCell>
                      <TableCell className="whitespace-nowrap">{(p.fullname ?? "").split(" ")[0] || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{(p.fullname ?? "").split(" ").slice(1).join(" ") || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{p.ID_Number || "—"}</TableCell>
                      <TableCell className="text-sm">{p.Cell_Number || "—"}</TableCell>
                      <TableCell className="text-sm">{p.ProductName || "—"}</TableCell>
                      <TableCell className="text-sm">{p.BranchName || "—"}</TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">{p.UsualPremium || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{p.Inception_Date ? new Date(p.Inception_Date).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-xs italic border-l">____________</TableCell>
                      <TableCell className="text-muted-foreground text-xs italic border-l">____________</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="agent-productivity">
        <CardSection title="Agent productivity" icon={TrendingUp} description="Policies captured and issued at least one receipt in the same from/to window. Set both dates; branch, product, and agent filters apply." headerRight={<ExportButton reportType="agent-productivity" filters={filters} />} flush>
          {!fromDate || !toDate ? (
            <EmptyState title="Set date range" description="Choose a from date and to date to run this report." className="border-0 rounded-none bg-transparent py-8" />
          ) : loadingAgentProductivity ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : agentProductivity.length === 0 ? (
            <EmptyState title="No policies match" description="No policies registered and receipt-issued in range." className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <div className="overflow-x-auto min-w-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs whitespace-nowrap">agent_id</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">AgentsName</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Policy_Number</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">FullName</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Product_Name</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">UsualPremium</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">StatusDesc</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">ReceiptsCollected</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Colour</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">MembersBranch</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">AgentsBranch</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">Active</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                      <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agentProductivity.slice(0, 100).map((r: any) => (
                      <TableRow key={r.policyId}>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{r.agent_id || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate" title={r.AgentsName}>{r.AgentsName || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                        <TableCell className="text-xs font-mono whitespace-nowrap">{r.Policy_Number}</TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate" title={r.FullName}>{r.FullName || "—"}</TableCell>
                        <TableCell className="text-xs max-w-[140px] truncate" title={r.Product_Name}>{r.Product_Name || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.UsualPremium || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.StatusDesc}</TableCell>
                        <TableCell className="text-xs">{r.ReceiptsCollected}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.Colour || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.MembersBranch}>{r.MembersBranch || "—"}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.AgentsBranch}>{r.AgentsBranch || "—"}</TableCell>
                        <TableCell className="text-xs">{r.Active}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.fdate}</TableCell>
                        <TableCell className="text-xs whitespace-nowrap">{r.tdate}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
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
            ) : commissionSummary.length === 0 ? (
              <EmptyState title="No commission ledger activity in this period" data-testid="text-no-commissions" className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">AGENT NAME</TableHead>
                    <TableHead className="w-6 p-1" aria-label="Spacer" />
                    <TableHead className="whitespace-nowrap">NUMBER OF POLICIES</TableHead>
                    <TableHead className="whitespace-nowrap">Groups</TableHead>
                    <TableHead className="whitespace-nowrap">Groups</TableHead>
                    <TableHead className="whitespace-nowrap">individ</TableHead>
                    <TableHead className="whitespace-nowrap">Individ</TableHead>
                    <TableHead className="whitespace-nowrap">Investm</TableHead>
                    <TableHead className="whitespace-nowrap">Clawb</TableHead>
                    <TableHead className="whitespace-nowrap">Call Cen</TableHead>
                    <TableHead className="whitespace-nowrap">Trips</TableHead>
                    <TableHead className="whitespace-nowrap">Cash se</TableHead>
                    <TableHead className="whitespace-nowrap">Basic</TableHead>
                    <TableHead className="whitespace-nowrap">Overtim</TableHead>
                    <TableHead className="whitespace-nowrap">TOTAL</TableHead>
                    <TableHead className="whitespace-nowrap">PA</TableHead>
                    <TableHead className="whitespace-nowrap">TAX LE</TableHead>
                    <TableHead className="whitespace-nowrap">CRED</TableHead>
                    <TableHead className="whitespace-nowrap">ADVAN</TableHead>
                    <TableHead className="whitespace-nowrap">POLICY DEDUCTI</TableHead>
                    <TableHead className="whitespace-nowrap">MEDICAL AID DEDUCTI</TableHead>
                    <TableHead className="whitespace-nowrap">UNPAID M</TableHead>
                    <TableHead className="whitespace-nowrap">NET P</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionSummary.map((row: any) => (
                    <TableRow key={row.agentId} data-testid={`row-commission-summary-${row.agentId}`}>
                      <TableCell className="font-medium whitespace-nowrap">{row.agentName}</TableCell>
                      <TableCell className="w-6 p-1" />
                      <TableCell>{row.numberOfPolicies}</TableCell>
                      <TableCell>{row.groupsCount}</TableCell>
                      <TableCell className="font-mono text-xs">{row.groupsCommission}</TableCell>
                      <TableCell>{row.individualsCount}</TableCell>
                      <TableCell className="font-mono text-xs">{row.individualsCommission}</TableCell>
                      <TableCell className="font-mono text-xs">{row.investment}</TableCell>
                      <TableCell className="font-mono text-xs">{row.clawback}</TableCell>
                      <TableCell className="font-mono text-xs">{row.callCenter}</TableCell>
                      <TableCell className="font-mono text-xs">{row.trips}</TableCell>
                      <TableCell className="font-mono text-xs">{row.cashSettlement}</TableCell>
                      <TableCell className="font-mono text-xs">{row.basic}</TableCell>
                      <TableCell className="font-mono text-xs">{row.overtime}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{row.total}</TableCell>
                      <TableCell className="text-xs">{row.paye}</TableCell>
                      <TableCell className="text-xs">{row.taxLevy}</TableCell>
                      <TableCell className="text-xs">{row.credit}</TableCell>
                      <TableCell className="text-xs">{row.advance}</TableCell>
                      <TableCell className="text-xs">{row.policyDeduction}</TableCell>
                      <TableCell className="text-xs">{row.medicalAidDeduction}</TableCell>
                      <TableCell className="text-xs">{row.unpaidMonths}</TableCell>
                      <TableCell className="font-mono text-xs font-semibold">{row.netPay}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
        </CardSection>

        <CardSection title="Commission plans" icon={Percent} description="Configured commission rules for products (reference)." flush>
          {loadingCommissionPlans ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : commissionPlans.length === 0 ? (
            <EmptyState title="No commission plans recorded" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Plan Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Rate (%)</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissionPlans.slice(0, 20).map((cp: any) => (
                  <TableRow key={cp.id} data-testid={`row-commission-plan-${cp.id}`}>
                    <TableCell className="font-medium">{cp.name}</TableCell>
                    <TableCell><Badge variant="outline">{cp.commissionType}</Badge></TableCell>
                    <TableCell>{cp.ratePercent}%</TableCell>
                    <TableCell><Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
          ) : commissionPayments.length === 0 ? (
            <EmptyState title="No payment receipts match the filters" description="Set a date range and click Run report." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1400px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Receipt #</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Surname</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Policy Status</TableHead>
                    <TableHead>Policy Premium</TableHead>
                    <TableHead>Amount Due</TableHead>
                    <TableHead>Amount Paid</TableHead>
                    <TableHead>Commission Payable</TableHead>
                    <TableHead>Comm. Type</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Months Paid</TableHead>
                    <TableHead>Receipt Count</TableHead>
                    <TableHead>Policy Branch</TableHead>
                    <TableHead>Payment Branch</TableHead>
                    <TableHead>Period From</TableHead>
                    <TableHead>Period To</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Issued At</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionPayments.slice(0, 200).map((r: any) => (
                    <TableRow key={r.receiptId} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm whitespace-nowrap">{r.receiptNumber}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.clientFirstName || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{r.clientLastName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{r.clientNationalId || "—"}</TableCell>
                      <TableCell className="text-sm">{r.clientPhone || "—"}</TableCell>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                      <TableCell><StatusBadge status={r.policyStatus} variant="policy" /></TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">{r.currency} {r.policyPremium}</TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap">{r.currency} {r.amountDue}</TableCell>
                      <TableCell className="font-medium tabular-nums whitespace-nowrap">{r.currency} {parseFloat(String(r.amountPaid ?? 0)).toFixed(2)}</TableCell>
                      <TableCell className="tabular-nums whitespace-nowrap text-emerald-700 font-medium">
                        {r.commissionPayable != null ? `${r.currency} ${parseFloat(String(r.commissionPayable)).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{r.commissionType ? <Badge variant="outline" className="text-xs">{r.commissionType}</Badge> : "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.agentName || "—"}</TableCell>
                      <TableCell className="tabular-nums text-center">{r.monthsPaidFor}</TableCell>
                      <TableCell className="tabular-nums text-center">{r.receiptCount}</TableCell>
                      <TableCell>{r.policyBranch || "—"}</TableCell>
                      <TableCell>{r.paymentBranch || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.periodFrom || "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.periodTo || "—"}</TableCell>
                      <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.paymentChannel || "—"}</Badge></TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
