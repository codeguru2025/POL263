import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Building, Loader2 } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

type BillState = "open" | "overdue" | "paid";
const STATE: Record<BillState, { label: string; cls: string }> = {
  open: { label: "Not paid yet", cls: "bg-amber-500/10 text-amber-700 border-amber-200" },
  overdue: { label: "Overdue", cls: "bg-rose-500/10 text-rose-700 border-rose-200" },
  paid: { label: "Paid", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
};

interface FeesResponse {
  bills: any[];
  paidBills: any[];
  openBills: any[];
  fees: any[];
  billsUnavailable: boolean;
  summary: Record<"billed" | "feesNotBilled" | "cost" | "paid" | "owedNow" | "overdueNow" | "buildingUp", Record<string, string>>;
}

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const byCur = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";
const money = (cur: string, v: string) => `${cur} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const billColumns: EdtColumn<any>[] = [
  { id: "reference", header: "Bill", accessor: (b) => b.reference, cell: (b) => <span className="text-xs font-mono whitespace-nowrap">{b.reference}</span> },
  { id: "kind", header: "For", accessor: (b) => b.kind, cell: (b) => <span className="text-xs">{b.kind}</span> },
  { id: "period", header: "Covers", accessor: (b) => b.periodFrom ?? "", cell: (b) => <span className="text-xs whitespace-nowrap">{b.periodFrom ? (b.periodFrom === b.periodTo ? `up to ${fmtDay(b.periodTo)}` : `${fmtDay(b.periodFrom)} – ${fmtDay(b.periodTo)}`) : "—"}</span> },
  { id: "issued", header: "Issued", accessor: (b) => b.issued, cell: (b) => <span className="text-xs whitespace-nowrap">{fmtDay(b.issued)}</span> },
  { id: "due", header: "Due", accessor: (b) => b.due, cell: (b) => <span className="text-xs whitespace-nowrap">{fmtDay(b.due)}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (b) => Number(b.amount), cell: (b) => <span className="text-xs tabular-nums font-medium whitespace-nowrap">{money(b.currency, b.amount)}</span> },
  { id: "paid", header: "Paid on", accessor: (b) => b.paid ?? "", cell: (b) => <span className="text-xs whitespace-nowrap">{fmtDay(b.paid)}</span> },
  { id: "state", header: "Status", accessor: (b) => STATE[b.state as BillState].label, cell: (b) => <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${STATE[b.state as BillState].cls}`}>{STATE[b.state as BillState].label}</Badge> },
];

const feeColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (f) => f.date, cell: (f) => <span className="text-xs whitespace-nowrap">{fmtDay(f.date)}</span> },
  { id: "source", header: "Charged on", accessor: (f) => f.source, cell: (f) => <span className="text-xs">{f.source}</span> },
  { id: "policy", header: "Policy", accessor: (f) => f.policyNumber ?? "", cell: (f) => <span className="text-xs font-mono">{f.policyNumber ?? "—"}</span> },
  { id: "fee", header: "Fee", align: "right", accessor: (f) => Number(f.fee), cell: (f) => <span className="text-xs tabular-nums whitespace-nowrap">{money(f.currency, f.fee)}</span> },
];

export function Pol263FeesPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const { status: _s, ...rest } = filters;
  const query = useQuery<FeesResponse>({
    queryKey: ["reports", "pol263-fees", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/pol263-fees" + buildQuery(rest), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load POL263 fees");
      return res.json();
    },
    enabled,
  });
  const d = query.data;
  const s = d?.summary;

  return (
    <CardSection
      title="POL263 fees"
      icon={Building}
      description="What the POL263 system costs you: the bills POL263 sent, what you've paid, what is still owed, and the 2.5% fees on money received that will go on the next bill. The cost for the period is the same POL263 figure as on the Income Statement."
      headerRight={<ExportButton reportType="platform" filters={rest} />}
      flush
    >
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError || !d || !s ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error)?.message ?? "Could not load POL263 fees"}. Try again.</p>
      ) : (
        <>
          <div className="px-4 py-3 border-b text-sm space-y-1">
            <div>
              Owed to POL263 now <span className={`font-semibold tabular-nums ${byCur(s.overdueNow) !== "—" ? "text-rose-700" : ""}`}>{byCur(s.owedNow)}</span>
              {byCur(s.overdueNow) !== "—" && <> (overdue <span className="font-semibold tabular-nums text-rose-700">{byCur(s.overdueNow)}</span>)</>}
              {" "}· fees waiting for the next bill <span className="font-semibold tabular-nums">{byCur(s.buildingUp)}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              This period: billed {byCur(s.billed)} · fees not yet billed {byCur(s.feesNotBilled)} · <span className="font-medium text-foreground">cost {byCur(s.cost)}</span> · paid to POL263 {byCur(s.paid)}
            </div>
            {d.billsUnavailable && <p className="text-xs text-amber-700">POL263 bills couldn't be loaded just now — only the fees are shown. Try again shortly.</p>}
          </div>
          <div className="px-4 pt-3 text-xs font-semibold uppercase text-muted-foreground">Bills issued this period</div>
          <EnhancedDataTable
            columns={billColumns}
            rows={d.bills}
            getRowKey={(b) => b.id}
            exportFilename="pol263-bills"
            storageKey="reports-pol263-bills"
            emptyMessage="No POL263 bills were issued in this period."
          />
          {d.openBills.some((b) => !d.bills.find((x) => x.id === b.id)) && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              Still unpaid from before this period: {d.openBills.filter((b) => !d.bills.find((x) => x.id === b.id)).map((b) => `${b.reference} ${money(b.currency, b.amount)} (due ${fmtDay(b.due)})`).join(", ")}.
            </p>
          )}
          <div className="px-4 pt-4 text-xs font-semibold uppercase text-muted-foreground">Fees not yet on a bill ({d.fees.length})</div>
          <EnhancedDataTable
            columns={feeColumns}
            rows={d.fees}
            getRowKey={(f) => f.id}
            exportFilename="pol263-fees-not-billed"
            storageKey="reports-pol263-fees"
            emptyMessage="No unbilled fees in this period."
          />
        </>
      )}
    </CardSection>
  );
}
