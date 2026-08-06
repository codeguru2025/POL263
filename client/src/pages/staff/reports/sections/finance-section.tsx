import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, KpiStatCard, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, DollarSign, Download, Truck, FolderOpen, TrendingUp, Receipt, Calendar, Building, FileText } from "lucide-react";
import { ExportButton } from "../export-button";
import { BalanceSheetPanel } from "./balance-sheet-panel";
import type { ReportSectionBaseProps } from "../use-report-filters";

interface FinanceSectionProps extends ReportSectionBaseProps {
  userId: string;
  users: any[];
}

export function FinanceSection({ filters, q, qAppend, fk, runKey, need, userId, users }: FinanceSectionProps) {
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({
    queryKey: ["reports", "payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payments?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payments"),
  });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({
    queryKey: ["reports", "expenditures", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/expenditures?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("expenditures"),
  });
  const { data: platformReceivables = [], isLoading: loadingPlatform } = useQuery<any[]>({
    queryKey: ["reports", "platform", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/platform/receivables?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("platformReceivables"),
  });
  const { data: financeReport = [], isLoading: loadingFinance } = useQuery<any[]>({
    queryKey: ["reports", "finance", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/finance?limit=500" + qAppend, { credentials: "include" });
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
      const res = await fetch(getApiBase() + "/api/reports/transaction-ledger?limit=1000" + qAppend, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("transactionLedger"),
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
  const { data: underwriterPayableResult, isLoading: loadingUnderwriterPayable } = useQuery<{ rows: any[]; summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; policyCount: number } }>({
    queryKey: ["reports", "underwriter-payable", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/underwriter-payable?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return { rows: [], summary: { totalMonthlyPayable: 0, totalPayableIncludingAdvance: 0, policyCount: 0 } };
      return res.json();
    },
    enabled: need("underwriterPayable"),
  });
  const { data: cashups = [], isLoading: loadingCashups } = useQuery<any[]>({
    queryKey: ["reports", "cashups", runKey, ...fk, userId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("cashups"),
  });
  const { data: receiptReport = [], isLoading: loadingReceipts } = useQuery<any[]>({
    queryKey: ["reports", "receipts", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/receipts?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("receiptReport"),
  });

  return (
    <>
      <TabsContent value="income-statement">
        <CardSection
          title="Income Statement"
          description="Cash basis — income from issued receipts (premium individual/group + cash services) less paid requisitions and expenditures, for the selected period. Per-currency, with a consolidated USD total."
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
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total income (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.income).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total expenses (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.expenses).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net surplus (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.net).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                </div>
                {cu.unconvertible?.length > 0 && (
                  <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total. Set rates in Settings → FX Rates.</p>
                )}
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
                        <TableRow><TableCell>Legacy group receipts</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.legacyGroupIncome, c)}</TableCell>)}</TableRow>
                      )}
                      <TableRow className="font-semibold border-t"><TableCell>Total income</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.total, c)}</TableCell>)}</TableRow>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Expenses</TableCell></TableRow>
                      {is.expenses.lines.length === 0 && <TableRow><TableCell className="text-muted-foreground text-sm" colSpan={curs.length + 1}>No expenses in period</TableCell></TableRow>}
                      {is.expenses.lines.map((l: any, i: number) => (
                        <TableRow key={i}><TableCell>{l.label} <span className="text-[10px] text-muted-foreground">({l.source})</span></TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(l.amounts, c)}</TableCell>)}</TableRow>
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
          description="Cash basis — cash received (by method) less cash paid out, for the selected period, reconciled against confirmed daily cash-ups."
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
                <div className="grid grid-cols-3 gap-3">
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash in (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.cashIn).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash out (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.cashOut).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                  <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net cash (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.netCash >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.netCash).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                </div>
                {cu.unconvertible?.length > 0 && (
                  <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total.</p>
                )}
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border rounded-md min-w-[520px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash in (by method)</TableCell></TableRow>
                      {channels.map((ch) => (
                        <TableRow key={ch}><TableCell className="capitalize">{ch.replace(/_/g, " ")}</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.inflowsByChannel[ch], c)}</TableCell>)}</TableRow>
                      ))}
                      <TableRow className="font-semibold border-t"><TableCell>Total cash in</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.cashIn, c)}</TableCell>)}</TableRow>
                      <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash out</TableCell></TableRow>
                      <TableRow><TableCell>Requisitions paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.requisitions, c)}</TableCell>)}</TableRow>
                      <TableRow><TableCell>Expenditures paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.expenditures, c)}</TableCell>)}</TableRow>
                      <TableRow><TableCell>Agent commissions paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.commissions, c)}</TableCell>)}</TableRow>
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
                    <DataTable containerClassName="border rounded-md">
                      <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Currency</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Discrepancy</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {cf.cashups.map((cu2: any) => (
                          <TableRow key={cu2.id}>
                            <TableCell>{cu2.cashupDate}</TableCell>
                            <TableCell>{cu2.currency}</TableCell>
                            <TableCell className="capitalize">{cu2.status}</TableCell>
                            <TableCell className="text-right tabular-nums">{Number(cu2.totalAmount || 0).toFixed(2)}</TableCell>
                            <TableCell className="text-right tabular-nums">{cu2.countedTotal != null ? Number(cu2.countedTotal).toFixed(2) : "—"}</TableCell>
                            <TableCell className="text-right tabular-nums">{cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount).toFixed(2) : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  )}
                </div>
              </div>
            );
          })()}
        </CardSection>
      </TabsContent>

      <TabsContent value="ledger">
        <CardSection
          title="Transaction Ledger"
          description="Every income and expense transaction in the selected period, in the order they occurred, with who recorded it and which department / cost-centre it belongs to."
          icon={DollarSign}
          flush
        >
          {loadingLedger ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !ledger || ledger.entries.length === 0 ? (
            <EmptyState title="No transactions for the selected period" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto">
              {ledger.total > ledger.entries.length && (
                <p className="text-xs text-muted-foreground px-4 pt-3">
                  Showing {ledger.entries.length} of {ledger.total} transactions — narrow the date range to see the rest.
                </p>
              )}
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[900px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Person</TableHead>
                    <TableHead>Department / Cost centre</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ledger.entries.map((e: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                      <TableCell>
                        <span className={e.type === "income" ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                          {e.type === "income" ? "Income" : "Expense"}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate" title={e.description}>{e.description}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.reference || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.person || "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{e.department || "—"}</TableCell>
                      <TableCell className={`text-right tabular-nums whitespace-nowrap ${e.type === "income" ? "text-emerald-600" : "text-destructive"}`}>
                        {e.type === "expense" ? "-" : ""}{e.currency} {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
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
          description="Policies are narrowed by capture date when you set from/to. Receipt count, months paid, and totals use issued receipts in that same window when dates are set; otherwise receipts are lifetime-to-date."
          icon={DollarSign}
          headerRight={<ExportButton reportType="finance" filters={filters} />}
          flush
        >
          {loadingFinance ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : financeReport.length === 0 ? (
            <EmptyState
              title="No policies match the filters"
              className="border-0 rounded-none bg-transparent py-8"
              dataTestId="text-no-finance-report"
            />
          ) : (
            <div className="overflow-x-auto">
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Capture date</TableHead>
                    <TableHead>Inception date</TableHead>
                    <TableHead>Cover date</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Date paid</TableHead>
                    <TableHead>Receipt count</TableHead>
                    <TableHead>Months paid</TableHead>
                    <TableHead>Grace used</TableHead>
                    <TableHead>Grace remaining</TableHead>
                    <TableHead>Outstanding</TableHead>
                    <TableHead>Advance</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Product code</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead>Agent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financeReport.map((r: any) => (
                    <TableRow key={r.policyId} data-testid={`row-finance-${r.policyId}`}>
                      <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                      <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{r.currency} {r.premiumAmount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{r.datePaid ? new Date(r.datePaid).toLocaleDateString() : "—"}</TableCell>
                      <TableCell className="tabular-nums">{r.receiptCount}</TableCell>
                      <TableCell className="tabular-nums">{r.monthsPaid}</TableCell>
                      <TableCell className="tabular-nums">{r.graceDaysUsed}</TableCell>
                      <TableCell className="tabular-nums">{r.graceDaysRemaining != null ? r.graceDaysRemaining : "—"}</TableCell>
                      <TableCell className="font-medium tabular-nums">{r.currency} {r.outstandingPremium}</TableCell>
                      <TableCell className="text-green-700 tabular-nums">{r.currency} {r.advancePremium}</TableCell>
                      <TableCell className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                      <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                      <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                      <TableCell>{r.branchName || "—"}</TableCell>
                      <TableCell>{r.groupName || "—"}</TableCell>
                      <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="underwriter-payable">
        <CardSection
          title="Underwriter payable"
          description="Monthly amount the tenant pays to the underwriter per policy (per adult/child). Includes advance months where applicable. Use filters to narrow by branch, product or status."
          icon={Truck}
          headerRight={<ExportButton reportType="underwriter-payable" filters={filters} />}
        >
          {loadingUnderwriterPayable ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : !underwriterPayableResult?.rows?.length ? (
            <EmptyState
              title="No matching policies"
              description="No policies with underwriter configuration match the filters."
              className="border-0 rounded-none bg-transparent py-8"
              dataTestId="text-no-underwriter-report"
            />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <KpiStatCard
                  label="Policies"
                  value={<span data-testid="text-underwriter-policy-count">{underwriterPayableResult.summary.policyCount}</span>}
                  icon={FolderOpen}
                />
                <KpiStatCard
                  label="Total monthly payable"
                  value={
                    <span className="tabular-nums" data-testid="text-underwriter-monthly">
                      {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalMonthlyPayable.toFixed(2)}
                    </span>
                  }
                  icon={DollarSign}
                />
                <KpiStatCard
                  label="Total (incl. advance months)"
                  value={
                    <span className="tabular-nums" data-testid="text-underwriter-total">
                      {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalPayableIncludingAdvance.toFixed(2)}
                    </span>
                  }
                  icon={TrendingUp}
                />
              </div>
              <div className="overflow-x-auto">
                <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[900px]">
                  <TableHeader className={dataTableStickyHeaderClass}>
                    <TableRow>
                      <TableHead>Policy #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Branch</TableHead>
                      <TableHead>Adults</TableHead>
                      <TableHead>Children</TableHead>
                      <TableHead>Rate (A/C)</TableHead>
                      <TableHead>Advance (mo)</TableHead>
                      <TableHead>Monthly</TableHead>
                      <TableHead>Total payable</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {underwriterPayableResult.rows.map((r: any) => (
                      <TableRow key={r.policyId} className="hover:bg-muted/40" data-testid={`row-underwriter-${r.policyId}`}>
                        <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                        <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                        <TableCell className="whitespace-nowrap">{[r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{r.clientPhone || "—"}</TableCell>
                        <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                        <TableCell>{r.branchName || "—"}</TableCell>
                        <TableCell>{r.adults}</TableCell>
                        <TableCell>{r.children}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{r.underwriterAmountAdult ?? "—"} / {r.underwriterAmountChild ?? "—"}</TableCell>
                        <TableCell>{r.underwriterAdvanceMonths}</TableCell>
                        <TableCell className="font-medium tabular-nums">{r.currency} {r.monthlyPayable.toFixed(2)}</TableCell>
                        <TableCell className="font-medium tabular-nums">{r.currency} {r.totalPayable.toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </DataTable>
              </div>
            </>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="receipts">
        <CardSection title="Daily receipts report" icon={Receipt} description={<>{receiptReport.length} receipts{filters.fromDate ? ` from ${filters.fromDate}` : ""}{filters.toDate ? ` to ${filters.toDate}` : ""}. Includes UTC <span className="font-mono">DTSTAMP</span> (YYYYMMDDTHHmmssZ) per receipt and policy-receipt detail columns for export.</>} headerRight={<ExportButton reportType="receipts" filters={filters} />} flush>
          {loadingReceipts ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : receiptReport.length === 0 ? (
            <EmptyState title="No receipts found" description="Use the date filters above to select a reporting period." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <div className="overflow-x-auto min-w-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs whitespace-nowrap font-mono">DTSTAMP</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">agentsName</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">MonthsPaidInAdvance</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">policy_number</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">surname</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">InternalReferenceNumber</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Product_Name</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">MonthNumber</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">YearNumber</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ReceiptCount</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">PaymentBy</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ReceiptNumber</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ManualUser</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">DatePaid</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Transaction</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">PremiumDue</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Currency</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">AmountCollected</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">MonthsPaid</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Remarks</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">PaymentMethod</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">DefaultPay</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">DebitMethod</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ReceiptMonth</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ReceiptYear</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">policy_num</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">PolicyBranch</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Inception_</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Sstatus</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">InternalRe</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">CollectedBy</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">fromDate</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">toDate</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">GroupName</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">InceptionD</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">MemberID</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ActualPen</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">ReceiptID</TableHead>
                    <TableHead className="text-xs whitespace-nowrap">CapturedBy</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {receiptReport.map((r: any, idx: number) => (
                    <TableRow key={r.receiptId || idx}>
                      <TableCell className="text-xs font-mono whitespace-nowrap" title={r.DTSTAMP}>{r.DTSTAMP || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.agentsName}>{r.agentsName || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.MonthsPaidInAdvance ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_number || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.surname || "—"}</TableCell>
                      <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.InternalReferenceNumber}>{r.InternalReferenceNumber || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.Product_Name}>{r.Product_Name || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.MonthNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.YearNumber ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.ReceiptCount ?? "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.fdate || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.tdate || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate" title={r.PaymentBy}>{r.PaymentBy || "—"}</TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{formatReceiptNumber(r.ReceiptNumber || r.receiptNumber)}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.ManualUser}>{r.ManualUser || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.DatePaid || "—"}</TableCell>
                      <TableCell className="text-xs font-mono max-w-[160px] truncate" title={r.Transaction}>{r.Transaction || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.PremiumDue || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.Currency || "—"}</TableCell>
                      <TableCell className="text-xs font-semibold whitespace-nowrap">{parseFloat(String(r.AmountCollected ?? r.amount ?? "0")).toFixed(2)}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.MonthsPaid ?? "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.Remarks}>{r.Remarks || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{r.PaymentMethod || "—"}</Badge></TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.DefaultPay || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.DebitMethod || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.ReceiptMonth ?? "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.ReceiptYear ?? "—"}</TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_num || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.PolicyBranch}>{r.PolicyBranch || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.Inception_ || "—"}</TableCell>
                      <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.Sstatus || "—"}</Badge></TableCell>
                      <TableCell className="text-xs font-mono max-w-[100px] truncate" title={r.InternalRe}>{r.InternalRe || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[120px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.CollectedBy}>{r.CollectedBy || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.fromDate || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.toDate || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.GroupName}>{r.GroupName || "—"}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{r.InceptionD || "—"}</TableCell>
                      <TableCell className="text-xs font-mono whitespace-nowrap">{r.MemberID || "—"}</TableCell>
                      <TableCell className="text-xs tabular-nums">{r.ActualPen || "—"}</TableCell>
                      <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.ReceiptID}>{r.ReceiptID || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[100px] truncate" title={r.CapturedBy}>{r.CapturedBy || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="payments">
        <CardSection title="Payment Transactions" icon={Receipt} headerRight={<ExportButton reportType="payments" filters={filters} />} flush>
          {loadingPayments ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : payments.length === 0 ? (
            <EmptyState title="No payments recorded" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Received</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.slice(0, 20).map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-mono text-sm">{p.reference || "—"}</TableCell>
                    <TableCell className="font-semibold">{p.currency} {p.amount}</TableCell>
                    <TableCell>{p.paymentMethod}</TableCell>
                    <TableCell><Badge variant={p.status === "cleared" ? "default" : p.status === "reversed" ? "destructive" : "secondary"}>{p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : p.status}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="expenditures">
        <CardSection title="Expenditure Report" icon={DollarSign} headerRight={<ExportButton reportType="expenditures" filters={filters} />} flush>
          {loadingExpenditures ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : expenditures.length === 0 ? (
            <EmptyState title="No expenditures recorded" data-testid="text-no-expenditures" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Receipt ref</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenditures.slice(0, 20).map((e: any) => (
                  <TableRow key={e.id} data-testid={`row-expenditure-${e.id}`}>
                    <TableCell>{e.description}</TableCell>
                    <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                    <TableCell className="font-semibold">{e.currency} {e.amount}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.spentAt || (e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—")}</TableCell>
                    <TableCell>{e.receiptRef || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="cashups">
        <CardSection title="Daily Cashups by User" icon={Calendar} description="Use the Report filters above to set date range and optional user." headerRight={<ExportButton reportType="cashups" filters={filters} />} flush>
          {loadingCashups ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : cashups.length === 0 ? (
            <EmptyState title="No cashups in range" data-testid="text-no-cashups" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cashup date</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Total amount</TableHead>
                  <TableHead>Transaction count</TableHead>
                  <TableHead>Locked</TableHead>
                  <TableHead>Prepared by</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashups.map((c: any) => (
                  <TableRow key={c.id} data-testid={`row-cashup-${c.id}`}>
                    <TableCell className="font-mono text-sm">{c.cashupDate}</TableCell>
                    <TableCell>{c.currency || "USD"}</TableCell>
                    <TableCell className="font-semibold">{c.currency || "USD"} {c.totalAmount}</TableCell>
                    <TableCell>{c.transactionCount}</TableCell>
                    <TableCell><Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge></TableCell>
                    <TableCell>{(users as any[])?.find((u: any) => u.id === c.preparedBy)?.displayName || c.preparedBy || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="platform">
        <CardSection title="POL263 Platform Revenue Share" icon={Building} headerRight={<ExportButton reportType="platform" filters={filters} />} flush>
          {loadingPlatform ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : platformReceivables.length === 0 ? (
            <EmptyState title="No POL263 Platform receivables recorded" data-testid="text-no-platform-receivables" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Currency</TableHead>
                  <TableHead>Settled</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {platformReceivables.slice(0, 20).map((cr: any) => (
                  <TableRow key={cr.id} data-testid={`row-platform-receivable-${cr.id}`}>
                    <TableCell>{cr.description}</TableCell>
                    <TableCell className="font-semibold">{cr.currency || "USD"} {cr.amount}</TableCell>
                    <TableCell>{cr.currency}</TableCell>
                    <TableCell><Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge></TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="actuarial">
        <CardSection
          title="Actuarial data export"
          icon={FileText}
          description="Clean exports for an external actuary's SFCR/ORSA prep — insured-lives exposure by product and age band, balance sheet, plus premium/payment and claims history."
        >
          <div className="p-4 space-y-3">
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
