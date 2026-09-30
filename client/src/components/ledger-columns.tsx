import type { EdtColumn } from "@/components/ds";

/** Transaction-ledger table columns — shared by Reports → Finance → Transaction Ledger and the
 *  daily report. Entry shape: server/financial-statements.ts LedgerEntry. */

const TYPE_LABEL: Record<string, string> = { income: "Income", expense: "Expense", payment: "Payment" };
const SOURCE_LABEL: Record<string, string> = {
  premium: "Premium",
  premium_group: "Premium (society member)",
  cash_service: "Funeral service",
  legacy_group: "Society lump sum",
  requisition: "Requisition",
  expenditure: "Expenditure",
  petty_cash: "Petty cash",
  commission_earned: "Commission earned",
  commission_paid: "Commission paid",
  platform_fee: "POL263 fee",
  pol263_bill: "POL263 bill paid",
  payroll: "Payroll",
  payroll_paid: "Salaries paid",
  claim: "Claim",
  claim_paid: "Claim paid",
};

const money = (v: unknown) => Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const ledgerColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (e) => e.date, cell: (e) => <span className="whitespace-nowrap">{e.date}</span> },
  {
    id: "type",
    header: "Type",
    accessor: (e) => TYPE_LABEL[e.type] ?? e.type,
    cell: (e) => (
      <span className="whitespace-nowrap">
        <span className={e.type === "income" ? "text-emerald-600 font-medium" : e.type === "payment" ? "text-sky-700 font-medium" : "text-destructive font-medium"}>
          {TYPE_LABEL[e.type] ?? e.type}
        </span>
        <span className="block text-[11px] text-muted-foreground">{SOURCE_LABEL[e.source] ?? e.source}{e.cash === false ? " · no cash moved" : ""}</span>
      </span>
    ),
  },
  { id: "description", header: "Description", accessor: (e) => e.description, cell: (e) => <span className="max-w-[280px] truncate block" title={e.description}>{e.description}</span> },
  { id: "reference", header: "Reference", accessor: (e) => e.reference || "", cell: (e) => <span className="whitespace-nowrap">{e.reference || "—"}</span> },
  { id: "person", header: "Person", accessor: (e) => e.person || "", cell: (e) => <span className="whitespace-nowrap">{e.person || "—"}</span> },
  { id: "department", header: "Department / cost centre", accessor: (e) => e.department || "", cell: (e) => <span className="whitespace-nowrap">{e.department || "—"}</span> },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    accessor: (e) => (e.type === "income" ? Number(e.amount || 0) : -Number(e.amount || 0)),
    cell: (e) => (
      <span className={`tabular-nums whitespace-nowrap ${e.type === "income" ? "text-emerald-600" : e.type === "payment" ? "text-sky-700" : "text-destructive"}`}>
        {e.type === "income" ? "" : "-"}{e.currency} {money(e.amount)}
      </span>
    ),
  },
];
