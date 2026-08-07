import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { CardSection, DataTable, dataTableStickyHeaderClass, EnhancedDataTable, type EdtColumn, EmptyState, KpiStatCard, StatusBadge } from "@/components/ds";
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

const cashupReconciliationColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (cu2) => cu2.cashupDate },
  { id: "currency", header: "Currency", accessor: (cu2) => cu2.currency },
  { id: "status", header: "Status", accessor: (cu2) => cu2.status, cell: (cu2) => <span className="capitalize">{cu2.status}</span> },
  { id: "expected", header: "Expected", align: "right", accessor: (cu2) => Number(cu2.totalAmount || 0), cell: (cu2) => <span className="tabular-nums">{Number(cu2.totalAmount || 0).toFixed(2)}</span> },
  { id: "counted", header: "Counted", align: "right", accessor: (cu2) => cu2.countedTotal != null ? Number(cu2.countedTotal) : "", cell: (cu2) => <span className="tabular-nums">{cu2.countedTotal != null ? Number(cu2.countedTotal).toFixed(2) : "—"}</span> },
  { id: "discrepancy", header: "Discrepancy", align: "right", accessor: (cu2) => cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount) : "", cell: (cu2) => <span className="tabular-nums">{cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount).toFixed(2) : "—"}</span> },
];

const ledgerColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (e) => e.date, cell: (e) => <span className="whitespace-nowrap">{e.date}</span> },
  {
    id: "type",
    header: "Type",
    accessor: (e) => e.type,
    cell: (e) => <span className={e.type === "income" ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>{e.type === "income" ? "Income" : "Expense"}</span>,
  },
  { id: "description", header: "Description", accessor: (e) => e.description, cell: (e) => <span className="max-w-[280px] truncate block" title={e.description}>{e.description}</span> },
  { id: "reference", header: "Reference", accessor: (e) => e.reference || "", cell: (e) => <span className="whitespace-nowrap">{e.reference || "—"}</span> },
  { id: "person", header: "Person", accessor: (e) => e.person || "", cell: (e) => <span className="whitespace-nowrap">{e.person || "—"}</span> },
  { id: "department", header: "Department / Cost centre", accessor: (e) => e.department || "", cell: (e) => <span className="whitespace-nowrap">{e.department || "—"}</span> },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    accessor: (e) => e.type === "expense" ? -Number(e.amount || 0) : Number(e.amount || 0),
    cell: (e) => (
      <span className={`tabular-nums whitespace-nowrap ${e.type === "income" ? "text-emerald-600" : "text-destructive"}`}>
        {e.type === "expense" ? "-" : ""}{e.currency} {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
    ),
  },
];

const financeReportColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (r) => r.status, cell: (r) => <StatusBadge status={r.status} variant="policy" /> },
  { id: "premium", header: "Premium", accessor: (r) => parseFloat(r.premiumAmount || 0), cell: (r) => <span className="whitespace-nowrap tabular-nums">{r.currency} {r.premiumAmount}</span> },
  { id: "captureDate", header: "Capture date", accessor: (r) => r.policyCreatedAt ? new Date(r.policyCreatedAt) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</span> },
  { id: "inceptionDate", header: "Inception date", accessor: (r) => r.inceptionDate ? new Date(r.inceptionDate) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</span> },
  { id: "coverDate", header: "Cover date", accessor: (r) => r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate).toLocaleDateString() : "—"}</span> },
  { id: "dueDate", header: "Due date", accessor: (r) => r.dueDate ? new Date(r.dueDate) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</span> },
  { id: "datePaid", header: "Date paid", accessor: (r) => r.datePaid ? new Date(r.datePaid) : "", cell: (r) => <span className="text-sm whitespace-nowrap">{r.datePaid ? new Date(r.datePaid).toLocaleDateString() : "—"}</span> },
  { id: "receiptCount", header: "Receipt count", accessor: (r) => r.receiptCount, cell: (r) => <span className="tabular-nums">{r.receiptCount}</span> },
  { id: "monthsPaid", header: "Months paid", accessor: (r) => r.monthsPaid, cell: (r) => <span className="tabular-nums">{r.monthsPaid}</span> },
  { id: "graceUsed", header: "Grace used", accessor: (r) => r.graceDaysUsed, cell: (r) => <span className="tabular-nums">{r.graceDaysUsed}</span> },
  { id: "graceRemaining", header: "Grace remaining", accessor: (r) => r.graceDaysRemaining != null ? r.graceDaysRemaining : "", cell: (r) => <span className="tabular-nums">{r.graceDaysRemaining != null ? r.graceDaysRemaining : "—"}</span> },
  { id: "outstanding", header: "Outstanding", accessor: (r) => parseFloat(r.outstandingPremium || 0), cell: (r) => <span className="font-medium tabular-nums">{r.currency} {r.outstandingPremium}</span> },
  { id: "advance", header: "Advance", accessor: (r) => parseFloat(r.advancePremium || 0), cell: (r) => <span className="text-green-700 tabular-nums">{r.currency} {r.advancePremium}</span> },
  { id: "client", header: "Client", accessor: (r) => [r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), cell: (r) => <span className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</span> },
  { id: "product", header: "Product", accessor: (r) => r.productName || "" },
  { id: "productCode", header: "Product code", accessor: (r) => r.productCode || "", cell: (r) => <span className="font-mono text-sm">{r.productCode || "—"}</span> },
  { id: "branch", header: "Branch", accessor: (r) => r.branchName || "" },
  { id: "group", header: "Group", accessor: (r) => r.groupName || "" },
  { id: "agent", header: "Agent", accessor: (r) => r.agentDisplayName || r.agentEmail || "" },
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

const receiptsColumns: EdtColumn<any>[] = [
  { id: "dtstamp", header: "DTSTAMP", accessor: (r) => r.DTSTAMP || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap" title={r.DTSTAMP}>{r.DTSTAMP || "—"}</span> },
  { id: "agentsName", header: "agentsName", accessor: (r) => r.agentsName || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.agentsName}>{r.agentsName || "—"}</span> },
  { id: "monthsPaidInAdvance", header: "MonthsPaidInAdvance", accessor: (r) => r.MonthsPaidInAdvance ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.MonthsPaidInAdvance ?? "—"}</span> },
  { id: "policyNumber", header: "policy_number", accessor: (r) => r.policy_number || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.policy_number || "—"}</span> },
  { id: "surname", header: "surname", accessor: (r) => r.surname || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.surname || "—"}</span> },
  { id: "internalReferenceNumber", header: "InternalReferenceNumber", accessor: (r) => r.InternalReferenceNumber || "", cell: (r) => <span className="text-xs font-mono max-w-[90px] truncate block" title={r.InternalReferenceNumber}>{r.InternalReferenceNumber || "—"}</span> },
  { id: "productName", header: "Product_Name", accessor: (r) => r.Product_Name || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.Product_Name}>{r.Product_Name || "—"}</span> },
  { id: "inceptionDate", header: "Inception_Date", accessor: (r) => r.Inception_Date || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</span> },
  { id: "monthNumber", header: "MonthNumber", accessor: (r) => r.MonthNumber ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.MonthNumber ?? "—"}</span> },
  { id: "yearNumber", header: "YearNumber", accessor: (r) => r.YearNumber ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.YearNumber ?? "—"}</span> },
  { id: "receiptCount", header: "ReceiptCount", accessor: (r) => r.ReceiptCount ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.ReceiptCount ?? "—"}</span> },
  { id: "fdate", header: "fdate", accessor: (r) => r.fdate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.fdate || "—"}</span> },
  { id: "tdate", header: "tdate", accessor: (r) => r.tdate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.tdate || "—"}</span> },
  { id: "paymentBy", header: "PaymentBy", accessor: (r) => r.PaymentBy || "", cell: (r) => <span className="text-xs max-w-[120px] truncate block" title={r.PaymentBy}>{r.PaymentBy || "—"}</span> },
  { id: "receiptNumber", header: "ReceiptNumber", accessor: (r) => formatReceiptNumber(r.ReceiptNumber || r.receiptNumber), cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{formatReceiptNumber(r.ReceiptNumber || r.receiptNumber)}</span> },
  { id: "manualUser", header: "ManualUser", accessor: (r) => r.ManualUser || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.ManualUser}>{r.ManualUser || "—"}</span> },
  { id: "datePaid", header: "DatePaid", accessor: (r) => r.DatePaid || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.DatePaid || "—"}</span> },
  { id: "transaction", header: "Transaction", accessor: (r) => r.Transaction || "", cell: (r) => <span className="text-xs font-mono max-w-[160px] truncate block" title={r.Transaction}>{r.Transaction || "—"}</span> },
  { id: "premiumDue", header: "PremiumDue", accessor: (r) => r.PremiumDue || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.PremiumDue || "—"}</span> },
  { id: "currency", header: "Currency", accessor: (r) => r.Currency || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Currency || "—"}</span> },
  { id: "amountCollected", header: "AmountCollected", accessor: (r) => parseFloat(String(r.AmountCollected ?? r.amount ?? "0")), cell: (r) => <span className="text-xs font-semibold whitespace-nowrap">{parseFloat(String(r.AmountCollected ?? r.amount ?? "0")).toFixed(2)}</span> },
  { id: "monthsPaid", header: "MonthsPaid", accessor: (r) => r.MonthsPaid ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.MonthsPaid ?? "—"}</span> },
  { id: "remarks", header: "Remarks", accessor: (r) => r.Remarks || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.Remarks}>{r.Remarks || "—"}</span> },
  { id: "paymentMethod", header: "PaymentMethod", accessor: (r) => r.PaymentMethod || "", cell: (r) => <span className="text-xs whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{r.PaymentMethod || "—"}</Badge></span> },
  { id: "defaultPay", header: "DefaultPay", accessor: (r) => r.DefaultPay || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.DefaultPay || "—"}</span> },
  { id: "debitMethod", header: "DebitMethod", accessor: (r) => r.DebitMethod || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.DebitMethod || "—"}</span> },
  { id: "receiptMonth", header: "ReceiptMonth", accessor: (r) => r.ReceiptMonth ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.ReceiptMonth ?? "—"}</span> },
  { id: "receiptYear", header: "ReceiptYear", accessor: (r) => r.ReceiptYear ?? "", cell: (r) => <span className="text-xs tabular-nums">{r.ReceiptYear ?? "—"}</span> },
  { id: "policyNum", header: "policy_num", accessor: (r) => r.policy_num || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.policy_num || "—"}</span> },
  { id: "policyBranch", header: "PolicyBranch", accessor: (r) => r.PolicyBranch || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.PolicyBranch}>{r.PolicyBranch || "—"}</span> },
  { id: "inceptionUnderscore", header: "Inception_", accessor: (r) => r.Inception_ || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.Inception_ || "—"}</span> },
  { id: "sstatus", header: "Sstatus", accessor: (r) => r.Sstatus || "", cell: (r) => <span className="text-xs"><Badge variant="outline" className="text-[10px]">{r.Sstatus || "—"}</Badge></span> },
  { id: "internalRe", header: "InternalRe", accessor: (r) => r.InternalRe || "", cell: (r) => <span className="text-xs font-mono max-w-[100px] truncate block" title={r.InternalRe}>{r.InternalRe || "—"}</span> },
  { id: "productN", header: "Product_N", accessor: (r) => r.Product_N || "", cell: (r) => <span className="text-xs max-w-[120px] truncate block" title={r.Product_N}>{r.Product_N || "—"}</span> },
  { id: "collectedBy", header: "CollectedBy", accessor: (r) => r.CollectedBy || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.CollectedBy}>{r.CollectedBy || "—"}</span> },
  { id: "fromDate", header: "fromDate", accessor: (r) => r.fromDate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.fromDate || "—"}</span> },
  { id: "toDate", header: "toDate", accessor: (r) => r.toDate || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.toDate || "—"}</span> },
  { id: "groupName", header: "GroupName", accessor: (r) => r.GroupName || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.GroupName}>{r.GroupName || "—"}</span> },
  { id: "inceptionD", header: "InceptionD", accessor: (r) => r.InceptionD || "", cell: (r) => <span className="text-xs whitespace-nowrap">{r.InceptionD || "—"}</span> },
  { id: "memberId", header: "MemberID", accessor: (r) => r.MemberID || "", cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.MemberID || "—"}</span> },
  { id: "actualPen", header: "ActualPen", accessor: (r) => r.ActualPen || "", cell: (r) => <span className="text-xs tabular-nums">{r.ActualPen || "—"}</span> },
  { id: "receiptId", header: "ReceiptID", accessor: (r) => r.ReceiptID || "", cell: (r) => <span className="text-xs font-mono max-w-[90px] truncate block" title={r.ReceiptID}>{r.ReceiptID || "—"}</span> },
  { id: "capturedBy", header: "CapturedBy", accessor: (r) => r.CapturedBy || "", cell: (r) => <span className="text-xs max-w-[100px] truncate block" title={r.CapturedBy}>{r.CapturedBy || "—"}</span> },
];

const paymentsColumns: EdtColumn<any>[] = [
  { id: "reference", header: "Reference", accessor: (p) => p.reference || "", cell: (p) => <span className="font-mono text-sm">{p.reference || "—"}</span> },
  { id: "amount", header: "Amount", accessor: (p) => parseFloat(p.amount || 0), cell: (p) => <span className="font-semibold">{p.currency} {p.amount}</span> },
  { id: "method", header: "Method", accessor: (p) => p.paymentMethod },
  {
    id: "status",
    header: "Status",
    accessor: (p) => p.status,
    cell: (p) => <Badge variant={p.status === "cleared" ? "default" : p.status === "reversed" ? "destructive" : "secondary"}>{p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : p.status}</Badge>,
  },
  { id: "received", header: "Received", accessor: (p) => p.receivedAt ? new Date(p.receivedAt) : "", cell: (p) => <span className="text-sm text-muted-foreground">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</span> },
];

const expendituresColumns: EdtColumn<any>[] = [
  { id: "description", header: "Description", accessor: (e) => e.description },
  { id: "category", header: "Category", accessor: (e) => e.category, cell: (e) => <Badge variant="outline">{e.category}</Badge> },
  { id: "amount", header: "Amount", accessor: (e) => parseFloat(e.amount || 0), cell: (e) => <span className="font-semibold">{e.currency} {e.amount}</span> },
  { id: "date", header: "Date", accessor: (e) => e.spentAt || (e.createdAt ? new Date(e.createdAt) : ""), cell: (e) => <span className="text-sm text-muted-foreground">{e.spentAt || (e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—")}</span> },
  { id: "receiptRef", header: "Receipt ref", accessor: (e) => e.receiptRef || "" },
];

const cashupsColumns = (users: any[]): EdtColumn<any>[] => [
  { id: "cashupDate", header: "Cashup date", accessor: (c) => c.cashupDate, cell: (c) => <span className="font-mono text-sm">{c.cashupDate}</span> },
  { id: "currency", header: "Currency", accessor: (c) => c.currency || "USD" },
  { id: "totalAmount", header: "Total amount", accessor: (c) => parseFloat(c.totalAmount || 0), cell: (c) => <span className="font-semibold">{c.currency || "USD"} {c.totalAmount}</span> },
  { id: "transactionCount", header: "Transaction count", accessor: (c) => c.transactionCount },
  { id: "locked", header: "Locked", accessor: (c) => (c.isLocked ? "Locked" : "Open"), cell: (c) => <Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge> },
  { id: "preparedBy", header: "Prepared by", accessor: (c) => (users as any[])?.find((u: any) => u.id === c.preparedBy)?.displayName || c.preparedBy || "" },
  { id: "created", header: "Created", accessor: (c) => new Date(c.createdAt), cell: (c) => <span className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</span> },
];

const platformColumns: EdtColumn<any>[] = [
  { id: "description", header: "Description", accessor: (cr) => cr.description },
  { id: "amount", header: "Amount", accessor: (cr) => parseFloat(cr.amount || 0), cell: (cr) => <span className="font-semibold">{cr.currency || "USD"} {cr.amount}</span> },
  { id: "currency", header: "Currency", accessor: (cr) => cr.currency },
  { id: "settled", header: "Settled", accessor: (cr) => (cr.isSettled ? "Settled" : "Pending"), cell: (cr) => <Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge> },
  { id: "created", header: "Created", accessor: (cr) => new Date(cr.createdAt), cell: (cr) => <span className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</span> },
];

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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
          description="Policies are narrowed by capture date when you set from/to. Receipt count, months paid, and totals use issued receipts in that same window when dates are set; otherwise receipts are lifetime-to-date."
          icon={DollarSign}
          headerRight={<ExportButton reportType="finance" filters={filters} />}
          flush
        >
          {loadingFinance ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={financeReportColumns}
              rows={financeReport}
              getRowKey={(r) => r.policyId}
              rowTestId={(r) => `row-finance-${r.policyId}`}
              exportFilename="finance-report"
              storageKey="reports-finance"
              emptyMessage="No policies match the filters."
            />
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
        <CardSection title="Daily receipts report" icon={Receipt} description={<>{receiptReport.length} receipts{filters.fromDate ? ` from ${filters.fromDate}` : ""}{filters.toDate ? ` to ${filters.toDate}` : ""}. Includes UTC <span className="font-mono">DTSTAMP</span> (YYYYMMDDTHHmmssZ) per receipt and policy-receipt detail columns for export.</>} headerRight={<ExportButton reportType="receipts" filters={filters} />} flush>
          {loadingReceipts ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={receiptsColumns}
              rows={receiptReport.map((r: any, idx: number) => ({ ...r, _rowKey: r.receiptId || idx }))}
              getRowKey={(row: any) => String(row._rowKey)}
              exportFilename="daily-receipts"
              storageKey="reports-receipts"
              emptyMessage="No receipts found. Use the date filters above to select a reporting period."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="payments">
        <CardSection title="Payment Transactions" icon={Receipt} headerRight={<ExportButton reportType="payments" filters={filters} />} flush>
          {loadingPayments ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={paymentsColumns}
              rows={payments}
              getRowKey={(p) => p.id}
              exportFilename="payment-transactions"
              storageKey="reports-payments"
              emptyMessage="No payments recorded."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="expenditures">
        <CardSection title="Expenditure Report" icon={DollarSign} headerRight={<ExportButton reportType="expenditures" filters={filters} />} flush>
          {loadingExpenditures ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={expendituresColumns}
              rows={expenditures}
              getRowKey={(e) => e.id}
              rowTestId={(e) => `row-expenditure-${e.id}`}
              exportFilename="expenditure-report"
              storageKey="reports-expenditures"
              emptyMessage="No expenditures recorded."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="cashups">
        <CardSection title="Daily Cashups by User" icon={Calendar} description="Use the Report filters above to set date range and optional user." headerRight={<ExportButton reportType="cashups" filters={filters} />} flush>
          {loadingCashups ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : (
            <EnhancedDataTable
              columns={cashupsColumns(users)}
              rows={cashups}
              getRowKey={(c) => c.id}
              rowTestId={(c) => `row-cashup-${c.id}`}
              exportFilename="daily-cashups"
              storageKey="reports-cashups"
              emptyMessage="No cashups in range."
            />
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="platform">
        <CardSection title="POL263 Platform Revenue Share" icon={Building} headerRight={<ExportButton reportType="platform" filters={filters} />} flush>
          {loadingPlatform ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={platformColumns}
              rows={platformReceivables}
              getRowKey={(cr) => cr.id}
              rowTestId={(cr) => `row-platform-receivable-${cr.id}`}
              exportFilename="platform-revenue-share"
              storageKey="reports-platform"
              emptyMessage="No POL263 Platform receivables recorded."
            />
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
