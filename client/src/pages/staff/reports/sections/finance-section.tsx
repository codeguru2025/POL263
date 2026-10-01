import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { CardSection, DataTable, dataTableStickyHeaderClass, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DollarSign, Download, Truck, FolderOpen, TrendingUp, Receipt, Calendar, Building, FileText, Shield, BookOpen, Scale } from "lucide-react";
import { ExportButton } from "../export-button";
import { BalanceSheetPanel } from "./balance-sheet-panel";
import { ledgerColumns } from "@/components/ledger-columns";
import { ReceiptsPanel } from "./receipts-panel";
import { ExpenditurePanel } from "./expenditure-panel";
import { CashupsPanel } from "./cashups-panel";
import { Pol263FeesPanel } from "./pol263-fees-panel";
import type { ReportSectionBaseProps } from "../use-report-filters";

interface FinanceSectionProps extends ReportSectionBaseProps {
  userId: string;
  users: any[];
}

const cashupReconciliationColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (cu2) => cu2.cashupDate },
  { id: "currency", header: "Currency", accessor: (cu2) => cu2.currency },
  { id: "status", header: "Status", accessor: (cu2) => cu2.status, cell: (cu2) => <span className="capitalize">{cu2.status}</span> },
  { id: "expected", header: "Expected", align: "right", accessor: (cu2) => Number(cu2.totalAmount || 0), cell: (cu2) => <span className="tabular-nums">{Number(cu2.totalAmount || 0).toFixed(2)}</span> },
  { id: "counted", header: "Counted", align: "right", accessor: (cu2) => cu2.countedTotal != null ? Number(cu2.countedTotal) : "", cell: (cu2) => <span className="tabular-nums">{cu2.countedTotal != null ? Number(cu2.countedTotal).toFixed(2) : "—"}</span> },
  { id: "discrepancy", header: "Discrepancy", align: "right", accessor: (cu2) => cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount) : "", cell: (cu2) => <span className="tabular-nums">{cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount).toFixed(2) : "—"}</span> },
];


const fmtDay = (d?: string | null) => (d ? new Date(String(d).slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const financeReportColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} variant="policy" /> },
  { id: "client", header: "Client", accessor: (r) => [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), cell: (r) => <span className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</span> },
  { id: "premium", header: "Premium", accessor: (r) => parseFloat(r.premiumAmount || 0), cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.currency} {r.premiumAmount}</span> },
  { id: "paidUpTo", header: "Paid up to", accessor: (r) => r.dueDate || "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.paidThroughGroup ? <span className="text-muted-foreground">Group</span> : fmtDay(r.dueDate)}</span> },
  {
    id: "owed", header: "Owed", accessor: (r) => parseFloat(r.outstandingPremium || 0),
    cell: (r) => Number(r.outstandingPremium) > 0
      ? <span className="font-medium tabular-nums text-amber-700 whitespace-nowrap">{r.currency} {r.outstandingPremium} <span className="text-xs font-normal">({r.periodsOwed} {r.periodsOwed === 1 ? "month" : "months"})</span></span>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "ahead", header: "Paid ahead", accessor: (r) => parseFloat(r.advancePremium || 0),
    cell: (r) => Number(r.advancePremium) > 0
      ? <span className="tabular-nums text-green-700 whitespace-nowrap">{r.currency} {r.advancePremium} <span className="text-xs">({r.periodsAhead} {r.periodsAhead === 1 ? "month" : "months"})</span></span>
      : <span className="text-muted-foreground">—</span>,
  },
  {
    id: "received", header: "Received (period)", accessor: (r) => Object.values(r.receivedByCurrency ?? {}).reduce((s: number, v: any) => s + Number(v), 0),
    cell: (r) => r.paidThroughGroup && !r.receiptCount
      ? <span className="text-xs text-muted-foreground whitespace-nowrap">Paid through group{r.lastGroupReceipt ? ` · last ${fmtDay(r.lastGroupReceipt)}` : ""}</span>
      : <span className="tabular-nums whitespace-nowrap">{r.receiptCount ? Object.entries(r.receivedByCurrency ?? {}).map(([c, v]: [string, any]) => `${c} ${v}`).join(" + ") : "—"}</span>,
  },
  { id: "receiptCount", header: "Receipts", accessor: (r) => r.receiptCount, cell: (r) => <span className="tabular-nums">{r.receiptCount || "—"}</span> },
  { id: "monthsPaid", header: "Months paid", accessor: (r) => r.monthsPaid, cell: (r) => <span className="tabular-nums">{r.monthsPaid || "—"}</span> },
  { id: "datePaid", header: "Last paid", accessor: (r) => r.datePaid || "", cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.datePaid)}</span> },
  { id: "graceRemaining", header: "Grace left", accessor: (r) => r.graceDaysRemaining != null ? r.graceDaysRemaining : "", cell: (r) => <span className="tabular-nums">{r.graceDaysRemaining != null ? `${r.graceDaysRemaining} days` : "—"}</span> },
  { id: "captureDate", header: "Captured", accessor: (r) => r.policyCreatedAt ? new Date(r.policyCreatedAt) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</span> },
  { id: "inceptionDate", header: "Start date", accessor: (r) => r.inceptionDate || "", cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDay(r.inceptionDate)}</span> },
  { id: "product", header: "Product", accessor: (r) => r.productName || "" },
  { id: "branch", header: "Branch", accessor: (r) => r.branchName || "" },
  { id: "group", header: "Group", accessor: (r) => r.groupName || "" },
  { id: "agent", header: "Agent", accessor: (r) => r.agentDisplayName || r.agentEmail || "Walk-in" },
];

const underwriterPayableColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} variant="policy" /> },
  { id: "client", header: "Client", accessor: (r) => [r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), cell: (r) => <span className="whitespace-nowrap">{[r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</span> },
  { id: "phone", header: "Phone", accessor: (r) => r.clientPhone || "" },
  { id: "product", header: "Product", accessor: (r) => r.productName || "" },
  { id: "branch", header: "Branch", accessor: (r) => r.branchName || "" },
  { id: "adults", header: "Adults", accessor: (r) => r.adults },
  { id: "children", header: "Children", accessor: (r) => r.children },
  { id: "rate", header: "Rate (A/C)", sortable: false, accessor: (r) => `${r.underwriterAmountAdult ?? ""}/${r.underwriterAmountChild ?? ""}`, cell: (r) => <span className="text-sm whitespace-nowrap">{r.underwriterAmountAdult ?? "—"} / {r.underwriterAmountChild ?? "—"}</span> },
  { id: "advanceMonths", header: "Advance (mo)", accessor: (r) => r.underwriterAdvanceMonths },
  { id: "monthly", header: "Monthly", align: "right", accessor: (r) => r.monthlyPayable, cell: (r) => <span className="font-medium tabular-nums">{r.currency} {r.monthlyPayable.toFixed(2)}</span> },
  { id: "totalPayable", header: "Total payable", align: "right", accessor: (r) => r.totalPayable, cell: (r) => <span className="font-medium tabular-nums">{r.currency} {r.totalPayable.toFixed(2)}</span> },
];

// Curated default columns for the on-screen receipts table. The CSV export carries the fuller
// Easipol-format column set; the screen view is for scanning, not spreadsheet work.

/** Raised-but-unpaid requisitions are spending that has probably happened but isn't in the
 *  statement yet — say so, with a way to clear them. */
function UnpaidRequisitionsWarning({ info }: { info?: { count: number; amounts: Record<string, number> } }) {
  if (!info || info.count === 0) return null;
  const owing = Object.entries(info.amounts ?? {})
    .map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" + ");
  return (
    <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">
      {info.count} requisition{info.count === 1 ? " is" : "s are"} still waiting for approval or payment ({owing}) — spending may be understated until {info.count === 1 ? "it's" : "they're"} paid.{" "}
      <a href="/staff/finance?tab=requisitions" className="underline font-medium">Open requisitions</a>
    </p>
  );
}

function BranchExclusionNote({ items }: { items?: string[] }) {
  if (!items?.length) return null;
  return (
    <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">
      One branch selected: {items.join(", ").replace(/, ([^,]*)$/, " and $1")} aren't recorded by branch, so they're not in this statement. Clear the branch filter to include them.
    </p>
  );
}

export function FinanceSection({ filters, q, qAppend, fk, runKey, need, userId, users }: FinanceSectionProps) {
  const [finPaidOnly, setFinPaidOnly] = useState(false);
  const { data: financeReport = [], isLoading: loadingFinance } = useQuery<any[]>({
    queryKey: ["reports", "finance", runKey, ...fk, finPaidOnly],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/finance" + (q ? `${q}&` : "?") + (finPaidOnly ? "paidOnly=1" : ""), { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("financeReport"),
  });
  const { data: incomeStatement, isLoading: loadingIncomeStatement } = useQuery<any>({
    queryKey: ["reports", "income-statement", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/income-statement" + q, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("incomeStatement"),
  });
  const { data: cashFlow, isLoading: loadingCashFlow } = useQuery<any>({
    queryKey: ["reports", "cash-flow", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cash-flow" + q, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("cashFlow"),
  });
  const { data: ledger, isLoading: loadingLedger } = useQuery<any>({
    queryKey: ["reports", "ledger", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/transaction-ledger" + q, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("transactionLedger"),
  });
  const { data: trialBalance, isLoading: loadingTrialBalance } = useQuery<any>({
    queryKey: ["reports", "trial-balance", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/trial-balance" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("trialBalance"),
  });
  const { data: bankRec, isLoading: loadingBankRec } = useQuery<any>({
    queryKey: ["reports", "bank-reconciliation", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/bank-reconciliation" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("bankReconciliation"),
  });
  const { data: ifrs17, isLoading: loadingIfrs17 } = useQuery<any>({
    queryKey: ["reports", "ifrs17-movement", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/ifrs17-movement" + q, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("ifrs17Movement"),
  });
  const [glAccount, setGlAccount] = useState<string>("");
  const IPEC_MANUAL_KEYS = ["insurerClass", "investmentIncome", "technicalProvisions", "prescribedAssetsHeld", "otherLiabilities", "riskBasedCapitalRequirement"] as const;
  const [ipecManual, setIpecManual] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("ipec-return-manual") || "{}"); } catch { return {}; }
  });
  const setIpecField = (k: string, v: string) => {
    setIpecManual((p) => { const next = { ...p, [k]: v }; try { localStorage.setItem("ipec-return-manual", JSON.stringify(next)); } catch { /* ignore */ } return next; });
  };
  const ipecQs = () => {
    const p = new URLSearchParams();
    if (filters.fromDate) p.set("fromDate", filters.fromDate);
    if (filters.toDate) p.set("toDate", filters.toDate);
    if (filters.branchId) p.set("branchId", filters.branchId);
    for (const k of IPEC_MANUAL_KEYS) if (ipecManual[k]) p.set(k, ipecManual[k]);
    return p.toString();
  };
  const { data: ipecReturn, isLoading: loadingIpec } = useQuery<any>({
    queryKey: ["reports", "ipec-return", runKey, ...fk, ipecManual],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/ipec-return?" + ipecQs(), { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("ipecReturn"),
  });
  const qc = useQueryClient();
  const budgetYear = (filters.toDate || new Date().toISOString().slice(0, 10)).slice(0, 4);
  const { data: budgetRows = [] } = useQuery<any[]>({
    queryKey: ["budgets", budgetYear],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/budgets?from=${budgetYear}-01-01&to=${budgetYear}-12-31`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: need("budget"),
  });
  const saveBudget = useMutation({
    mutationFn: async (b: { periodMonth: string; category: string; amount: string }) =>
      apiRequest("POST", "/api/budgets", { ...b, currency: "USD" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budgets", budgetYear] }),
  });

  const { data: premiumBordereau = [], isLoading: loadingPremBd } = useQuery<any[]>({
    queryKey: ["reports", "premium-bordereau", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/premium-bordereau" + q, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: need("premiumBordereau"),
  });
  const { data: claimsBordereau = [], isLoading: loadingClaimsBd } = useQuery<any[]>({
    queryKey: ["reports", "claims-bordereau", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims-bordereau" + q, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
    enabled: need("claimsBordereau"),
  });
  const { data: chartOfAccounts = [] } = useQuery<any[]>({
    queryKey: ["reports", "chart-of-accounts"],
    queryFn: async () => (await fetch(getApiBase() + "/api/reports/chart-of-accounts", { credentials: "include" })).json().catch(() => []),
    enabled: need("generalLedger"),
  });
  const { data: generalLedger, isLoading: loadingGeneralLedger } = useQuery<any>({
    queryKey: ["reports", "general-ledger", runKey, ...fk, glAccount],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/general-ledger" + (q ? `${q}&` : "?") + (glAccount ? `account=${glAccount}` : ""), { credentials: "include" });
      return res.ok ? res.json() : null;
    },
    enabled: need("generalLedger"),
  });
  const asOfParam = filters.toDate ? `?asOf=${filters.toDate}${filters.branchId ? `&branchId=${filters.branchId}` : ""}` : `?asOf=${new Date().toISOString().slice(0, 10)}${filters.branchId ? `&branchId=${filters.branchId}` : ""}`;
  const { data: balanceSheet, isLoading: loadingBalanceSheet } = useQuery<any>({
    queryKey: ["reports", "balance-sheet", runKey, filters.toDate, filters.branchId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/balance-sheet" + asOfParam, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("balanceSheet"),
  });
  const { data: insuranceContractSummary, isLoading: loadingInsuranceContractSummary } = useQuery<any>({
    queryKey: ["reports", "insurance-contract-summary", runKey, ...fk],
    queryFn: async () => {
      const asOf = `asOf=${filters.toDate || new Date().toISOString().slice(0, 10)}`;
      const res = await fetch(getApiBase() + "/api/reports/insurance-contract-summary" + (q ? `${q}&${asOf}` : `?${asOf}`), { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("insuranceContractSummary"),
  });
  const { data: underwriterPayableResult, isLoading: loadingUnderwriterPayable } = useQuery<{ rows: any[]; summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; noRatesConfigured?: boolean; policyCount: number; byCurrency?: Record<string, { monthlyPayable: number; totalPayable: number; policyCount: number }> } }>({
    queryKey: ["reports", "underwriter-payable", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/underwriter-payable" + q, { credentials: "include" });
      if (!res.ok) return { rows: [], summary: { totalMonthlyPayable: 0, totalPayableIncludingAdvance: 0, policyCount: 0, byCurrency: {} } };
      return res.json();
    },
    enabled: need("underwriterPayable"),
  });

  return (
    <>
      <TabsContent value="income-statement">
        <CardSection
          title="Income Statement"
          description="Money in (premiums, funeral services and society lump sums) less the cost of running the business: spending, petty cash, agent commission earned, POL263 fees, approved payroll and cash claims. Per currency, with a USD total."
          icon={DollarSign}
          flush
          headerRight={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`${getApiBase()}/api/reports/income-statement/pdf${q}${q ? "&" : "?"}download=1`, "_blank")}>
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
          }
        >
          {loadingIncomeStatement ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !incomeStatement ? (
            <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (() => {
            const is = incomeStatement;
            const curs: string[] = is.currencies?.length ? is.currencies : ["USD"];
            const money = (m: any, c: string) => Number((m?.[c]) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const cu = is.consolidatedUsd || { income: 0, expenses: 0, net: 0, unconvertible: [] };
            return (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total income (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.income).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total expenses (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.expenses).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net surplus (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.net).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                </div>
                {cu.unconvertible?.length > 0 && (
                  <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total. Set rates in Settings → FX Rates.</p>
                )}
                {Object.entries(is.fxRates ?? {}).filter(([c]) => c !== "USD" && curs.includes(c)).length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    USD total uses {Object.entries(is.fxRates ?? {}).filter(([c]) => c !== "USD" && curs.includes(c)).map(([c, r]: [string, any]) =>
                      `${c} ${Number(r) > 0 ? `${(1 / Number(r)).toLocaleString(undefined, { maximumFractionDigits: 2 })} = USD 1` : r}${is.fxRatesSetOn?.[c] ? ` (set ${new Date(is.fxRatesSetOn[c] + "T00:00:00").toLocaleDateString()})` : ""}`).join(" · ")}. Update it in Settings → FX Rates.
                  </p>
                )}
                <BranchExclusionNote items={is.excludedForBranch} />
                <UnpaidRequisitionsWarning info={is.unpaidRequisitions} />
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border rounded-md min-w-[520px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Income</TableCell></TableRow>
                      <TableRow><TableCell>Premium — Individual</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.premiumIndividual, c)}</TableCell>)}</TableRow>
                      <TableRow><TableCell>Premium — Group</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.premiumGroup, c)}</TableCell>)}</TableRow>
                      <TableRow><TableCell>Cash services</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.cashServices, c)}</TableCell>)}</TableRow>
                      {Object.keys(is.income.legacyGroupIncome ?? {}).some((c) => (is.income.legacyGroupIncome[c] || 0) !== 0) && (
                        <TableRow><TableCell>Society lump sums</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.legacyGroupIncome, c)}</TableCell>)}</TableRow>
                      )}
                      <TableRow className="font-semibold border-t"><TableCell>Total income</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.total, c)}</TableCell>)}</TableRow>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Expenses</TableCell></TableRow>
                      {is.expenses.lines.length === 0 && <TableRow><TableCell className="text-muted-foreground text-sm" colSpan={curs.length + 1}>No expenses in period</TableCell></TableRow>}
                      {is.expenses.lines.map((l: any, i: number) => (
                        <TableRow key={i}><TableCell>{l.label}{(l.source === "requisition" || l.source === "expenditure") && <span className="text-[10px] text-muted-foreground"> ({l.source})</span>}</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(l.amounts, c)}</TableCell>)}</TableRow>
                      ))}
                      <TableRow className="font-semibold border-t"><TableCell>Total expenses</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.expenses.total, c)}</TableCell>)}</TableRow>
                      <TableRow className="font-bold border-t-2"><TableCell>Net surplus / (deficit)</TableCell>{curs.map((c) => <TableCell key={c} className={`text-right tabular-nums ${Number(is.net?.[c] || 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{money(is.net, c)}</TableCell>)}</TableRow>
                    </TableBody>
                  </DataTable>
                </div>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="cash-flow">
        <CardSection
          title="Cash Flow Statement"
          description="Money actually received (by payment method) less money actually paid out in the period, checked against the daily cash-ups."
          icon={DollarSign}
          flush
          headerRight={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`${getApiBase()}/api/reports/cash-flow/pdf${q}${q ? "&" : "?"}download=1`, "_blank")}>
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
          }
        >
          {loadingCashFlow ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !cashFlow ? (
            <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (() => {
            const cf = cashFlow;
            const curs: string[] = cf.currencies?.length ? cf.currencies : ["USD"];
            const money = (m: any, c: string) => Number((m?.[c]) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const cu = cf.consolidatedUsd || { cashIn: 0, cashOut: 0, netCash: 0, unconvertible: [] };
            const channels = Object.keys(cf.inflowsByChannel || {});
            return (
              <div className="space-y-4 p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash in (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.cashIn).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash out (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.cashOut).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net cash (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.netCash >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.netCash).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                </div>
                {cu.unconvertible?.length > 0 && (
                  <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total.</p>
                )}
                <BranchExclusionNote items={cf.excludedForBranch} />
                <UnpaidRequisitionsWarning info={cf.unpaidRequisitions} />
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border rounded-md min-w-[520px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash in (by method)</TableCell></TableRow>
                      {channels.map((ch) => (
                        <TableRow key={ch}><TableCell className="capitalize">{ch === "society_lump_sums" ? "Society lump sums (method not recorded)" : ch.replace(/_/g, " ")}</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.inflowsByChannel[ch], c)}</TableCell>)}</TableRow>
                      ))}
                      <TableRow className="font-semibold border-t"><TableCell>Total cash in</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.cashIn, c)}</TableCell>)}</TableRow>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash out</TableCell></TableRow>
                      {([
                        ["Requisitions paid", cf.outflows.requisitions],
                        ["Expenditures paid", cf.outflows.expenditures],
                        ["Petty cash spent", cf.outflows.pettyCash],
                        ["Commission paid to agents", cf.outflows.commissions],
                        ["Salaries paid (payroll)", cf.outflows.payroll],
                        ["Cash claims paid", cf.outflows.claims],
                        ["POL263 bills paid", cf.outflows.pol263Bills],
                      ] as [string, any][]).filter(([label, m]) => label === "Requisitions paid" || Object.values(m ?? {}).some((v: any) => Number(v) !== 0)).map(([label, m]) => (
                        <TableRow key={label}><TableCell>{label}</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(m, c)}</TableCell>)}</TableRow>
                      ))}
                      <TableRow className="font-semibold border-t"><TableCell>Total cash out</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.total, c)}</TableCell>)}</TableRow>
                      <TableRow className="font-bold border-t-2"><TableCell>Net cash movement</TableCell>{curs.map((c) => <TableCell key={c} className={`text-right tabular-nums ${Number(cf.netCash?.[c] || 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{money(cf.netCash, c)}</TableCell>)}</TableRow>
                    </TableBody>
                  </DataTable>
                </div>
                {cf.bankDeposits && cf.bankDeposits.count > 0 && (
                  <div className="rounded-md border bg-muted/20 p-3">
                    <p className="text-sm font-semibold mb-1">Bank deposits in period</p>
                    <p className="text-xs text-muted-foreground">{cf.bankDeposits.count} deposit(s): {Object.entries(cf.bankDeposits.total || {}).map(([c, v]: any) => `${c} ${Number(v).toFixed(2)}`).join(", ")}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-semibold mb-2">Daily cash-up reconciliation</p>
                  {(!cf.cashups || cf.cashups.length === 0) ? (
                    <p className="text-sm text-muted-foreground">No cash-ups recorded in this period.</p>
                  ) : (
                    <EnhancedDataTable
                      columns={cashupReconciliationColumns}
                      rows={cf.cashups}
                      getRowKey={(cu2: any) => cu2.id}
                      searchable={false}
                      storageKey="reports-cashflow-reconciliation"
                      emptyMessage="No cash-ups recorded in this period."
                    />
                  )}
                </div>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="trial-balance">
        <CardSection
          title="Trial Balance & Financial Position"
          description="The income statement and balance sheet re-expressed in debit/credit form on a standard funeral/life-insurer chart of accounts. Derived from the subsidiary ledgers (receipts, disbursements, commission, claims) + manual balance-sheet entries — it re-presents the existing statements, it is not a second set of books."
          icon={Scale}
          headerRight={<ExportButton reportType="trial-balance" filters={filters} />}
          flush
        >
          {loadingTrialBalance ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !trialBalance ? (
            <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (() => {
            const tb = trialBalance.trialBalance;
            const pos = trialBalance.position;
            const curs: string[] = tb.currencies?.length ? tb.currencies : ["USD"];
            const m = (obj: any, c: string) => Number(obj?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            const tbl = (title: string, rowsIn: any[], totals: any, balanced: any) => (
              <div className="mb-6">
                <p className="text-sm font-semibold mb-2">{title}</p>
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border rounded-md min-w-[560px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow><TableHead>Code</TableHead><TableHead>Account</TableHead>{curs.map((c) => <TableHead key={`d${c}`} className="text-right">Dr ({c})</TableHead>)}{curs.map((c) => <TableHead key={`c${c}`} className="text-right">Cr ({c})</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {rowsIn.map((r: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono text-xs">{r.code}</TableCell>
                          <TableCell>{r.name}{r.source === "manual" ? <span className="text-[10px] text-muted-foreground"> (manual)</span> : null}</TableCell>
                          {curs.map((c) => <TableCell key={`d${c}`} className="text-right tabular-nums">{r.debit?.[c] ? m(r.debit, c) : "—"}</TableCell>)}
                          {curs.map((c) => <TableCell key={`c${c}`} className="text-right tabular-nums">{r.credit?.[c] ? m(r.credit, c) : "—"}</TableCell>)}
                        </TableRow>
                      ))}
                      <TableRow className="font-semibold border-t-2">
                        <TableCell colSpan={2}>Total</TableCell>
                        {curs.map((c) => <TableCell key={`d${c}`} className="text-right tabular-nums">{m(totals.debit, c)}</TableCell>)}
                        {curs.map((c) => <TableCell key={`c${c}`} className="text-right tabular-nums">{m(totals.credit, c)}</TableCell>)}
                      </TableRow>
                    </TableBody>
                  </DataTable>
                </div>
                <div className="mt-1 flex flex-wrap gap-2 text-[11px]">
                  {curs.map((c) => (
                    <span key={c} className={balanced?.[c] ? "text-emerald-600" : "text-amber-600"}>
                      {c}: {balanced?.[c] ? "balanced" : "out of balance — check manual balance-sheet entries"}
                    </span>
                  ))}
                </div>
              </div>
            );
            return (
              <div className="p-4">
                {tbl("Trial balance — movements for the period", tb.rows, tb.totals, tb.balanced)}
                {tb.surplus && Object.keys(tb.surplus).length > 0 && (
                  <p className="text-sm -mt-2 mb-4">
                    Surplus / (deficit) for the period:{" "}
                    {Object.entries(tb.surplus).map(([c, v]: [string, any]) => (
                      <span key={c} className={`font-semibold tabular-nums mr-3 ${Number(v) >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        {c} {Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                    ))}
                    <span className="text-xs text-muted-foreground">(income less expenses — already in the lines above)</span>
                  </p>
                )}
                {tbl(`Statement of financial position — as of ${pos.asOf}`, pos.rows, pos.totals, pos.balanced)}
                <p className="text-[11px] text-muted-foreground">{tb.note}</p>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="general-ledger">
        <CardSection
          title="General Ledger"
          description="Every money event in the period posted in double entry — each one a debit on one account and a credit on another, so each account's totals match the Trial Balance. Pick an account, or view all."
          icon={BookOpen}
          headerRight={<ExportButton reportType="general-ledger" filters={filters} />}
          flush
        >
          <div className="p-4">
            <div className="mb-3 flex items-center gap-2">
              <Select value={glAccount || "__all__"} onValueChange={(v) => setGlAccount(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-72 h-9"><SelectValue placeholder="All accounts" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All accounts</SelectItem>
                  {(chartOfAccounts as any[]).map((a: any) => <SelectItem key={a.code} value={a.code}>{a.code} — {a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {loadingGeneralLedger ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !generalLedger || generalLedger.lines.length === 0 ? (
              <EmptyState title="No transactions for the selected account and period" className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <>
              {generalLedger.truncated && (
                <p className="mb-2 text-[11px] text-destructive">Too many transactions to show them all — narrow the dates.</p>
              )}
              {generalLedger.accounts?.length > 0 && (
                <div className="mb-4 overflow-x-auto rounded-md border">
                  <table className="w-full text-sm min-w-[520px]">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr><th className="text-left px-3 py-2">Account</th><th className="text-right px-3 py-2">Total debits</th><th className="text-right px-3 py-2">Total credits</th></tr>
                    </thead>
                    <tbody>
                      {generalLedger.accounts.map((a: any) => (
                        <tr key={a.code} className="border-t">
                          <td className="px-3 py-1.5 whitespace-nowrap"><span className="font-mono text-xs">{a.code}</span> {a.name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Object.entries(a.debit).map(([c, v]: [string, any]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Object.entries(a.credit).map(([c, v]: [string, any]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm min-w-[720px]">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr><th className="text-left px-3 py-2">Date</th><th className="text-left px-3 py-2">Account</th><th className="text-left px-3 py-2">Other side</th><th className="text-left px-3 py-2">Description</th><th className="text-left px-3 py-2">Ref</th><th className="text-right px-3 py-2">Debit</th><th className="text-right px-3 py-2">Credit</th></tr>
                  </thead>
                  <tbody>
                    {generalLedger.lines.map((l: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1.5 whitespace-nowrap">{l.date}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs">{l.account} {l.accountName}</td>
                        <td className="px-3 py-1.5 whitespace-nowrap font-mono text-xs text-muted-foreground">{l.contraAccount}</td>
                        <td className="px-3 py-1.5 max-w-[280px] truncate" title={l.description}>{l.description}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{l.reference || "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.debit != null ? `${l.currency} ${Number(l.debit).toFixed(2)}` : ""}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{l.credit != null ? `${l.currency} ${Number(l.credit).toFixed(2)}` : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </CardSection>
      </TabsContent>

      <TabsContent value="bank-reconciliation">
        <CardSection
          title="Bank Reconciliation"
          description="For each bank account: the opening statement balance, plus cash deposited and money received through the bank, less money paid out through the bank, is what the bank should show. Compared with the closing statement, the difference is what to explain."
          icon={Building}
          headerRight={<ExportButton reportType="bank-reconciliation" filters={filters} />}
          flush
        >
          {loadingBankRec ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !bankRec || bankRec.accounts.length === 0 ? (
            <EmptyState
              title="No bank accounts set up"
              description="Add your bank accounts and each month-end statement balance under Finance → Banking & Cash, and this report will check them against what the system recorded."
              className="border-0 rounded-none bg-transparent py-8"
            />
          ) : (() => {
            const m = (v: string | null | undefined) => (v == null ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            const statusBadge: Record<string, { text: string; cls: string }> = {
              agrees: { text: "Agrees", cls: "text-emerald-700" },
              difference: { text: "Difference to explain", cls: "text-amber-700" },
              no_opening: { text: "No statement before this period — enter last month's closing balance", cls: "text-muted-foreground" },
              no_closing: { text: "No statement in this period — enter this month's closing balance", cls: "text-muted-foreground" },
            };
            return (
              <div className="p-4 space-y-4">
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm min-w-[980px]">
                    <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                      <tr>{["Account", "Opening", "+ Deposited", "+ Received via bank", "− Paid via bank", "= Should show", "Statement closing", "Difference", ""].map((h) => <th key={h} className="text-right first:text-left px-3 py-2 whitespace-nowrap">{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {bankRec.accounts.map((a: any, i: number) => (
                        <tr key={i} className="border-t align-top">
                          <td className="px-3 py-1.5 whitespace-nowrap">{a.accountName} <span className="text-xs text-muted-foreground">{a.bankName} · {a.currency}</span></td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{m(a.openingBalance)}<div className="text-[10px] text-muted-foreground">{a.openingDate || ""}</div></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m(a.deposits)} <span className="text-[10px] text-muted-foreground">({a.depositCount})</span></td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m(a.receivedThroughBank)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{m(a.paidThroughBank)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums font-medium">{m(a.expectedClosing)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">{m(a.closingBalance)}<div className="text-[10px] text-muted-foreground">{a.closingDate || ""}</div></td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-semibold ${a.status === "difference" ? "text-amber-700" : ""}`}>{m(a.difference)}</td>
                          <td className={`px-3 py-1.5 text-xs max-w-[200px] ${statusBadge[a.status]?.cls ?? ""}`}>{statusBadge[a.status]?.text ?? a.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {Object.keys(bankRec.unlinked ?? {}).length > 0 && (
                  <div className="rounded-md border bg-muted/20 p-3 text-sm">
                    <p className="font-semibold mb-1">Not linked to a specific account</p>
                    <p className="text-xs text-muted-foreground mb-1">There's more than one account in these currencies, and receipts and payouts don't say which account they went through — split these between them when reconciling.</p>
                    {Object.entries(bankRec.unlinked).map(([c, v]: [string, any]) => (
                      <p key={c} className="text-xs tabular-nums">{c}: received {m(v.received)} ({v.receivedCount}) · paid out {m(v.paid)} ({v.paidCount})</p>
                    ))}
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground">{bankRec.note}</p>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="ifrs17-movement">
        <CardSection
          title="IFRS 17 Movement Analysis (PAA)"
          description="The roll-forward of the two insurance-contract liabilities over the period: LRC (opening + premiums received − revenue recognised = closing) and LIC (opening + claims incurred − claims paid = closing). PAA-classified business only; LIC excludes IBNR."
          icon={Shield}
          headerRight={<ExportButton reportType="ifrs17-movement" filters={filters} />}
          flush
        >
          {loadingIfrs17 ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !ifrs17 || ifrs17.nothingClassified ? (
            <EmptyState title="No products are classified for IFRS 17 yet" description={`IFRS 17 figures only include products under the Premium Allocation Approach (PAA)${ifrs17?.classification?.excludedActivePolicyCount ? ` — all ${ifrs17.classification.excludedActivePolicyCount} active policies are on unclassified products` : ""}. Set the measurement approach to PAA on each product version under Products, and this report fills in.`} className="border-0 rounded-none bg-transparent py-8" />
          ) : (() => {
            const curs: string[] = ifrs17.currencies?.length ? ifrs17.currencies : ["USD"];
            const m = (obj: any, c: string) => (obj?.[c] != null ? Number(obj[c]).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
            const block = (title: string, L: any, lines: [string, string][]) => (
              <div className="mb-5">
                <p className="text-sm font-semibold mb-2">{title}</p>
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border rounded-md min-w-[420px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map(([key, label], i) => (
                        <TableRow key={i} className={key === "opening" || key === "closing" ? "font-semibold" : ""}>
                          <TableCell>{label}</TableCell>
                          {curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{m(L[key], c)}</TableCell>)}
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              </div>
            );
            return (
              <div className="p-4">
                {block("Liability for Remaining Coverage (LRC)", ifrs17.lrc, [
                  ["opening", "Opening balance"],
                  ["premiumsReceived", "Add: premiums received"],
                  ["revenueRecognised", "Less: insurance revenue recognised"],
                  ["closing", "Closing balance"],
                  ["residual", "Difference (should be 0)"],
                ])}
                {block("Liability for Incurred Claims (LIC)", ifrs17.lic, [
                  ["opening", "Opening balance"],
                  ["claimsIncurred", "Add: claims reported"],
                  ["claimsPaid", "Less: claims paid / settled"],
                  ["claimsDeclined", "Less: claims declined"],
                  ["closing", "Closing balance"],
                  ["residual", "Difference (should be 0)"],
                ])}
                <p className="text-xs text-muted-foreground">
                  {ifrs17.classification.paaPolicyCount} PAA-classified {ifrs17.classification.paaPolicyCount === 1 ? "policy" : "policies"} included.
                  {ifrs17.classification.excludedActivePolicyCount > 0 ? ` ${ifrs17.classification.excludedActivePolicyCount} excluded (unclassified / GMM / VFA).` : ""}
                </p>
                {ifrs17.lrc?.derivedPeriods > 0 && <p className="text-xs text-muted-foreground mt-1">{ifrs17.lrc.derivedPeriods} receipt{ifrs17.lrc.derivedPeriods === 1 ? "" : "s"} had no recorded covered months and were spread over amount ÷ premium months from the payment date.</p>}
                <p className="text-[11px] text-muted-foreground mt-1">{ifrs17.note}</p>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="ledger">
        <CardSection
          title="Transaction Ledger"
          description="Every money event in the period — the detail behind the Income Statement and Cash Flow, under the same rules: money in, costs (including ones not yet paid, marked no cash moved) and payments of what was owed. With who recorded it and the department / cost centre."
          icon={DollarSign}
          flush
        >
          {loadingLedger ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !ledger || ledger.entries.length === 0 ? (
            <EmptyState title="No transactions for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div>
              {ledger.total > ledger.entries.length && (
                <p className="text-xs text-muted-foreground px-4 pt-3">
                  Showing {ledger.entries.length} of {ledger.total} transactions — narrow the date range to see the rest.
                </p>
              )}
              <EnhancedDataTable
                columns={ledgerColumns}
                rows={ledger.entries.map((e: any, i: number) => ({ ...e, _rowKey: i }))}
                getRowKey={(row: any) => String(row._rowKey)}
                exportFilename="transaction-ledger"
                storageKey="reports-ledger"
                emptyMessage="No transactions for the selected period."
              />
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="balance-sheet">
        <BalanceSheetPanel
          balanceSheet={balanceSheet}
          loading={loadingBalanceSheet}
          asOf={filters.toDate || new Date().toISOString().slice(0, 10)}
          onEntryChanged={() => {}}
        />
      </TabsContent>

      <TabsContent value="finance">
        <CardSection
          title="Finance report"
          description="Every policy's payment position today: paid up to, what's owed (months behind × premium) and what's paid ahead. From/to dates choose which payments count as 'received in the period' — not which policies are listed."
          icon={DollarSign}
          headerRight={<ExportButton reportType="finance" filters={{ ...filters, paidOnly: finPaidOnly }} />}
          flush
        >
          {loadingFinance ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (() => {
            const sumBy = (key: string) => {
              const m: Record<string, number> = {};
              for (const r of financeReport) { const v = Number(r[key] || 0); if (v) m[r.currency || "USD"] = (m[r.currency || "USD"] || 0) + v; }
              return Object.entries(m).map(([c, v]) => `${c} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";
            };
            const owing = financeReport.filter((r: any) => Number(r.outstandingPremium) > 0).length;
            return (
              <>
                <div className="px-4 py-3 border-b text-sm flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span><span className="font-semibold tabular-nums">{financeReport.length}</span> policies</span>
                  <span>Received in period: <span className="font-semibold tabular-nums">{(() => { const m: Record<string, number> = {}; for (const r of financeReport) for (const [c, v] of Object.entries(r.receivedByCurrency ?? {})) m[c] = (m[c] || 0) + Number(v); return Object.entries(m).map(([c, v]) => `${c} ${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—"; })()}</span></span>
                  <span>Owed: <span className="font-semibold tabular-nums text-amber-700">{sumBy("outstandingPremium")}</span> <span className="text-muted-foreground">({owing} {owing === 1 ? "policy" : "policies"})</span></span>
                  <span>Paid ahead: <span className="font-semibold tabular-nums text-green-700">{sumBy("advancePremium")}</span></span>
                  <label className="ml-auto flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={finPaidOnly} onChange={(e) => setFinPaidOnly(e.target.checked)} data-testid="checkbox-finance-paid-only" />
                    Only policies that paid in this period
                  </label>
                </div>
                <EnhancedDataTable
                  columns={financeReportColumns}
                  rows={financeReport}
                  getRowKey={(r) => r.policyId}
                  rowTestId={(r) => `row-finance-${r.policyId}`}
                  exportFilename="finance-report"
                  storageKey="reports-finance-v2"
                  emptyMessage="No policies match the filters."
                />
              </>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="underwriter-payable">
        <CardSection
          title="Underwriter payable"
          description="What is owed to the underwriter each month for the policies in force (active and in grace): the per-adult and per-child underwriter rate times the people covered, plus any advance months."
          icon={Truck}
          headerRight={<ExportButton reportType="underwriter-payable" filters={filters} />}
        >
          {loadingUnderwriterPayable ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : underwriterPayableResult?.summary?.noRatesConfigured ? (
            <EmptyState
              title="No underwriter rates set"
              description="None of your products has an underwriter amount, so nothing is owed to an underwriter. If your policies are underwritten, add the per-adult and per-child underwriter amounts on each product version under Products."
              className="border-0 rounded-none bg-transparent py-8"
            />
          ) : !underwriterPayableResult?.rows?.length ? (
            <EmptyState
              title="No matching policies"
              description="No policies with underwriter configuration match the filters."
              className="border-0 rounded-none bg-transparent py-8"
              dataTestId="text-no-underwriter-report"
            />
          ) : (
            <>
              {(() => {
                const bc = underwriterPayableResult.summary.byCurrency ?? {};
                const curs = Object.keys(bc);
                const fmtByCur = (pick: (v: { monthlyPayable: number; totalPayable: number }) => number) =>
                  curs.length
                    ? curs.map((c) => `${c} ${pick(bc[c]).toFixed(2)}`).join("  ·  ")
                    : "—";
                return (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <KpiStatCard
                      label="Policies"
                      value={<span data-testid="text-underwriter-policy-count">{underwriterPayableResult.summary.policyCount}</span>}
                      icon={FolderOpen}
                    />
                    <KpiStatCard
                      label="Total monthly payable"
                      value={<span className="tabular-nums" data-testid="text-underwriter-monthly">{fmtByCur((v) => v.monthlyPayable)}</span>}
                      icon={DollarSign}
                    />
                    <KpiStatCard
                      label="Total (incl. advance months)"
                      value={<span className="tabular-nums" data-testid="text-underwriter-total">{fmtByCur((v) => v.totalPayable)}</span>}
                      icon={TrendingUp}
                    />
                  </div>
                );
              })()}
              <EnhancedDataTable
                columns={underwriterPayableColumns}
                rows={underwriterPayableResult.rows}
                getRowKey={(r) => r.policyId}
                rowTestId={(r) => `row-underwriter-${r.policyId}`}
                exportFilename="underwriter-payable"
                storageKey="reports-underwriter-payable"
                emptyMessage="No matching policies."
              />
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="receipts">
        <ReceiptsPanel filters={filters} runKey={runKey} fk={fk} enabled={need("receiptReport")} />
      </TabsContent>

      <TabsContent value="expenditures">
        <ExpenditurePanel filters={filters} runKey={runKey} fk={fk} enabled={need("expenditures")} />
      </TabsContent>

      <TabsContent value="cashups">
        <CashupsPanel filters={filters} runKey={runKey} fk={fk} enabled={need("cashups")} />
      </TabsContent>

      <TabsContent value="platform">
        <Pol263FeesPanel filters={filters} runKey={runKey} fk={fk} enabled={need("pol263Fees")} />
      </TabsContent>

      <TabsContent value="budget">
        <CardSection
          title={`Budget — ${budgetYear}`}
          description="Monthly targets by category. The executive report shows actual vs budget vs variance for total income, total expenses and new policies. Amounts are USD; edit a cell and click away to save."
          icon={Calendar}
          flush
        >
          <div className="p-4 overflow-x-auto">
            {(() => {
              const cats = [
                { key: "total_income", label: "Total income" },
                { key: "total_expenses", label: "Total expenses" },
                { key: "new_policies", label: "New policies" },
              ];
              const months = Array.from({ length: 12 }, (_, i) => `${budgetYear}-${String(i + 1).padStart(2, "0")}-01`);
              const valueOf = (month: string, cat: string) => {
                const r = (budgetRows as any[]).find((b) => String(b.periodMonth).slice(0, 10) === month && b.category === cat);
                return r ? String(Number(r.amount)) : "";
              };
              return (
                <table className="text-sm border-separate border-spacing-0 min-w-[760px]">
                  <thead>
                    <tr className="text-xs uppercase text-muted-foreground">
                      <th className="text-left px-2 py-2 sticky left-0 bg-card">Month</th>
                      {cats.map((c) => <th key={c.key} className="text-right px-2 py-2">{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {months.map((month) => (
                      <tr key={month} className="border-t">
                        <td className="px-2 py-1 whitespace-nowrap font-mono text-xs sticky left-0 bg-card">{month.slice(0, 7)}</td>
                        {cats.map((c) => (
                          <td key={c.key} className="px-2 py-1">
                            <input
                              type="number"
                              inputMode="decimal"
                              defaultValue={valueOf(month, c.key)}
                              className="w-28 h-8 rounded-md border border-input bg-background px-2 text-sm text-right tabular-nums"
                              placeholder="—"
                              onBlur={(e) => {
                                const v = e.target.value.trim();
                                if (v === "" || v === valueOf(month, c.key)) return;
                                saveBudget.mutate({ periodMonth: month, category: c.key, amount: String(Number(v).toFixed(2)) });
                              }}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              );
            })()}
            {saveBudget.isPending && <p className="text-xs text-muted-foreground mt-2">Saving…</p>}
          </div>
        </CardSection>
      </TabsContent>

      <TabsContent value="reinsurance">
        <CardSection
          title="Reinsurance premium bordereau"
          description="Per-policy premium ceded to the underwriter / reinsurer for the period. The cession is the configured per-adult / per-child underwriter amount (same basis as Underwriter payable). Exchanged with the reinsurer as CSV."
          icon={Truck}
          headerRight={<ExportButton reportType="premium-bordereau" filters={filters} />}
          flush
        >
          {loadingPremBd ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (premiumBordereau as any[]).length === 0 ? (
            <EmptyState title="Nothing underwritten" description="No product has an underwriter amount, so there is nothing to pass to an underwriter or reinsurer. If your policies are underwritten, add the per-adult and per-child underwriter amounts on each product version under Products." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs min-w-[900px]">
                <thead className="bg-muted/40 uppercase text-[10px] text-muted-foreground">
                  <tr>{["Policy", "Insured", "Product", "Inception", "Sum insured", "Gross prem (mo)", "Lives", "Ceded (mo)", "Retained (mo)"].map((h) => <th key={h} className="text-left px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(premiumBordereau as any[]).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{r.policyNumber}</td>
                      <td className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate" title={r.insured}>{r.insured}</td>
                      <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate" title={r.product}>{r.product}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.inceptionDate || "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{r.sumInsured != null ? `${r.sumInsuredCurrency} ${Number(r.sumInsured).toLocaleString()}` : "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{r.currency} {r.grossPremium.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{r.lives}</td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-medium">{r.currency} {r.cededPremiumMonthly.toFixed(2)}</td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{r.currency} {r.retainedPremiumMonthly.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>

        <CardSection
          title="Reinsurance claims bordereau"
          description="Claims reported in the period on underwritten products, for the reinsurer to apply the treaty. Shows the gross claim; the share recovered depends on the treaty."
          icon={Shield}
          headerRight={<ExportButton reportType="claims-bordereau" filters={filters} />}
          flush
        >
          {loadingClaimsBd ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (claimsBordereau as any[]).length === 0 ? (
            <EmptyState title="No claims on underwritten products in this period" description="Only claims on products with an underwriter amount are listed here — the rest are carried by the business itself." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-xs min-w-[820px]">
                <thead className="bg-muted/40 uppercase text-[10px] text-muted-foreground">
                  <tr>{["Claim", "Policy", "Insured", "Deceased", "Type", "Date of death", "Reported", "Status", "Gross claim"].map((h) => <th key={h} className="text-left px-2 py-1.5 whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {(claimsBordereau as any[]).map((r, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{r.claimNumber}</td>
                      <td className="px-2 py-1 font-mono whitespace-nowrap">{r.policyNumber}</td>
                      <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate" title={r.insured}>{r.insured}</td>
                      <td className="px-2 py-1 whitespace-nowrap max-w-[140px] truncate" title={r.deceased}>{r.deceased || "—"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.claimType}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.dateOfDeath || "—"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{r.dateReported}</td>
                      <td className="px-2 py-1 whitespace-nowrap capitalize">{r.status}</td>
                      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-medium">{r.grossClaim > 0 ? `${r.currency} ${r.grossClaim.toFixed(2)}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="ipec-return">
        <CardSection
          title="IPEC Return — Life / Funeral Assurer (indicative)"
          description="Assembles the data the system holds into the structure of an IPEC statutory return. Investment income, technical provisions, prescribed-asset holdings and the ZICARP capital requirement are not in the system — enter them below. This is a working draft; the return still needs an actuary's sign-off before submission."
          icon={Shield}
          headerRight={
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(`${getApiBase()}/api/reports/ipec-return/pdf?${ipecQs()}&download=1`, "_blank")}>
              <Download className="h-3.5 w-3.5" /> PDF
            </Button>
          }
          flush
        >
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Insurer class</label>
                <Select value={ipecManual.insurerClass || "funeral"} onValueChange={(v) => setIpecField("insurerClass", v)}>
                  <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="funeral">Funeral (min. capital USD 500,000)</SelectItem>
                    <SelectItem value="life">Life (min. capital USD 2,000,000)</SelectItem>
                    <SelectItem value="composite">Composite (USD 2,000,000)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {[
                ["investmentIncome", "Investment income (USD, period)"],
                ["technicalProvisions", "Technical provisions (USD, as of)"],
                ["prescribedAssetsHeld", "Prescribed assets held (USD, as of)"],
                ["otherLiabilities", "Other liabilities (USD, as of) — blank = derived"],
                ["riskBasedCapitalRequirement", "ZICARP RBC requirement (USD) — blank = flat minimum"],
              ].map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <label className="text-xs text-muted-foreground">{label}</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                    value={ipecManual[k] || ""}
                    onChange={(e) => setIpecField(k, e.target.value)}
                    placeholder="0.00"
                  />
                </div>
              ))}
            </div>

            {loadingIpec ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : !ipecReturn ? (
              <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
            ) : (() => {
              const R = ipecReturn;
              const u = (n: number) => `USD ${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
              const flag = (ok: boolean) => <span className={ok ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>{ok ? "Compliant" : "Not compliant"}</span>;
              const Row = ({ l, v }: { l: string; v: any }) => (
                <div className="flex justify-between gap-4 py-1 border-b border-border/40 text-sm"><span className="text-muted-foreground">{l}</span><span className="tabular-nums text-right">{v}</span></div>
              );
              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                  <p className="md:col-span-2 text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">{R.meta.disclaimer}</p>
                  <div>
                    <p className="text-sm font-semibold mb-1">Business summary</p>
                    <Row l="Policies in force" v={R.businessSummary.policiesInForce} />
                    <Row l="New policies in period" v={R.businessSummary.newPoliciesInPeriod} />
                    <Row l="Lapses in period" v={R.businessSummary.lapsesInPeriod} />
                    <Row l="Lives covered" v={R.businessSummary.livesCovered} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">Revenue account (USD)</p>
                    <Row l="Gross premium written" v={u(R.revenueAccount.grossPremiumWritten)} />
                    <Row l="Reinsurance ceded (estimate)" v={u(R.revenueAccount.reinsurancePremiumCeded)} />
                    <Row l="Net premium written" v={u(R.revenueAccount.netPremiumWritten)} />
                    <Row l="Investment income (manual)" v={u(R.revenueAccount.investmentIncome)} />
                    <Row l="Claims incurred" v={u(R.revenueAccount.claimsIncurred)} />
                    <Row l="Commission" v={u(R.revenueAccount.commission)} />
                    <Row l="Management expenses" v={u(R.revenueAccount.managementExpenses)} />
                    <Row l="Underwriting result" v={<span className={R.revenueAccount.underwritingResult >= 0 ? "text-emerald-600" : "text-destructive"}>{u(R.revenueAccount.underwritingResult)}</span>} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">Financial position (USD)</p>
                    <Row l="Total assets" v={u(R.financialPosition.totalAssets)} />
                    <Row l="Technical provisions (manual)" v={u(R.financialPosition.technicalProvisions)} />
                    <Row l="Total liabilities" v={u(R.financialPosition.totalLiabilities)} />
                    <Row l="Shareholders' funds" v={u(R.financialPosition.shareholdersFunds)} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">Prescribed assets &amp; capital</p>
                    <Row l={`Prescribed asset ratio (min ${R.prescribedAssets.minimumRatio}%)`} v={`${R.prescribedAssets.ratio}%`} />
                    <Row l="Prescribed asset shortfall" v={u(R.prescribedAssets.shortfall)} />
                    <Row l="Prescribed assets" v={flag(R.prescribedAssets.compliant)} />
                    <Row l="Available capital" v={u(R.capitalAdequacy.availableCapital)} />
                    <Row l="Min. capital requirement" v={u(R.capitalAdequacy.minimumCapitalRequirement)} />
                    <Row l={`Capital adequacy ratio`} v={`${R.capitalAdequacy.capitalAdequacyRatio}%`} />
                    <Row l="Capital adequacy" v={flag(R.capitalAdequacy.compliant)} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">Claims analysis</p>
                    <Row l="Reported" v={R.claimsAnalysis.reported} />
                    <Row l="Settled" v={R.claimsAnalysis.settled} />
                    <Row l="Repudiated" v={R.claimsAnalysis.repudiated} />
                    <Row l="Outstanding" v={R.claimsAnalysis.outstanding} />
                    <Row l="Avg settlement (days)" v={R.claimsAnalysis.averageSettlementDays} />
                  </div>
                  <div>
                    <p className="text-sm font-semibold mb-1">Complaints</p>
                    <Row l="Received" v={R.complaints.received} />
                    <Row l="Resolved" v={R.complaints.resolved} />
                    <Row l="Outstanding" v={R.complaints.outstanding} />
                  </div>
                </div>
              );
            })()}
          </div>
        </CardSection>
      </TabsContent>

      <TabsContent value="actuarial">
        <CardSection
          title="Actuarial data export"
          icon={FileText}
          description="Clean exports for an external actuary's SFCR/ORSA prep — insured-lives exposure by product and age band, balance sheet, plus premium/payment and claims history."
        >
          <div className="p-4 space-y-3">
            <div className="border rounded-lg p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-sm">Insurance contract summary (IFRS 17 — PAA, indicative)</p>
                  <p className="text-xs text-muted-foreground">Earned revenue and liability for remaining coverage, computed only for product versions classified "PAA" — see Classification coverage below for what's excluded.</p>
                </div>
                <ExportButton reportType="insurance-contract-summary" filters={filters} />
              </div>
              {loadingInsuranceContractSummary ? (
                <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
              ) : !insuranceContractSummary ? (
                <p className="text-xs text-muted-foreground">No data for the selected period.</p>
              ) : (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <KpiStatCard
                      label="Insurance revenue (earned)"
                      value={
                        <span className="tabular-nums" data-testid="text-insurance-revenue-earned">
                          {Object.entries(insuranceContractSummary.insuranceRevenue.earned).map(([c, amt]: [string, any]) => `${c} ${amt.toFixed(2)}`).join(" · ") || "—"}
                        </span>
                      }
                      icon={TrendingUp}
                    />
                    <KpiStatCard
                      label="Liability for remaining coverage (unearned premium)"
                      value={
                        <span className="tabular-nums" data-testid="text-liability-remaining-coverage">
                          {Object.entries(insuranceContractSummary.liabilityForRemainingCoverage.unearnedPremium).map(([c, amt]: [string, any]) => `${c} ${amt.toFixed(2)}`).join(" · ") || "—"}
                        </span>
                      }
                      icon={DollarSign}
                    />
                    <KpiStatCard
                      label="Liability for incurred claims"
                      value={
                        <span className="tabular-nums" data-testid="text-liability-incurred-claims">
                          {Object.entries(insuranceContractSummary.liabilityForIncurredClaims.total).map(([c, amt]: [string, any]) => `${c} ${amt.toFixed(2)}`).join(" · ") || "—"}
                        </span>
                      }
                      icon={Shield}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground italic">{insuranceContractSummary.liabilityForIncurredClaims.note}</p>
                  <p className="text-xs text-muted-foreground" data-testid="text-classification-coverage">
                    {insuranceContractSummary.classification.paaPolicyCount} active polic{insuranceContractSummary.classification.paaPolicyCount === 1 ? "y" : "ies"} on PAA-classified products included.
                    {insuranceContractSummary.classification.excludedActivePolicyCount > 0
                      ? ` ${insuranceContractSummary.classification.excludedActivePolicyCount} excluded (unclassified or GMM/VFA) — classify products under Products to include them.`
                      : ""}
                  </p>
                </>
              )}
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium text-sm">Insured-lives exposure</p>
                <p className="text-xs text-muted-foreground">Active member counts by product and age band (0-17 / 18-65 / 66-84 / 85+).</p>
              </div>
              <ExportButton reportType="actuarial-exposure" filters={filters} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium text-sm">Balance sheet</p>
                <p className="text-xs text-muted-foreground">All recorded balance sheet entries — assets, liabilities, equity.</p>
              </div>
              <ExportButton reportType="actuarial-balance-sheet" filters={filters} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium text-sm">Premium &amp; payment history</p>
                <p className="text-xs text-muted-foreground">Every recorded payment — reference, amount, currency, method, date.</p>
              </div>
              <ExportButton reportType="payments" filters={filters} />
            </div>
            <div className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="font-medium text-sm">Claims history</p>
                <p className="text-xs text-muted-foreground">Every claim — type, status, approved amount, currency, date.</p>
              </div>
              <ExportButton reportType="claims" filters={filters} />
            </div>
          </div>
        </CardSection>
      </TabsContent>
    </>
  );
}
