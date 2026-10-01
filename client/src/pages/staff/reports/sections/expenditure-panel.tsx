import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, Loader2 } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

type Kind = "requisition" | "expenditure" | "petty_cash";
const KIND_LABEL: Record<Kind, string> = { requisition: "Requisition", expenditure: "Expenditure", petty_cash: "Petty cash" };

interface SpendResponse {
  rows: any[];
  truncated: boolean;
  summary: {
    count: number;
    byCurrency: Record<string, string>;
    byKind: Record<Kind, Record<string, string>>;
    byCategory: Record<string, Record<string, string>>;
  };
}

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const byCur = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";

const columns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (r) => r.date, cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDay(r.date)}</span> },
  { id: "voucher", header: "Voucher", accessor: (r) => r.voucher, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.voucher || "—"}</span> },
  { id: "kind", header: "Type", accessor: (r) => KIND_LABEL[r.kind as Kind], cell: (r) => <span className="text-xs whitespace-nowrap">{KIND_LABEL[r.kind as Kind]}</span> },
  { id: "reference", header: "Requisition #", accessor: (r) => r.reference, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.reference || "—"}</span> },
  {
    id: "category", header: "Category", accessor: (r) => (r.commissionPayout ? "Commission paid to agents" : r.category),
    cell: (r) => r.commissionPayout
      ? <Badge variant="outline" className="text-[10px] bg-sky-500/10 text-sky-700 border-sky-200 whitespace-nowrap">Commission paid to agents</Badge>
      : <span className="text-xs whitespace-nowrap">{r.category}</span>,
  },
  { id: "description", header: "Description", accessor: (r) => r.description, cell: (r) => <span className="text-xs max-w-[220px] truncate block" title={r.description}>{r.description || "—"}</span> },
  { id: "payee", header: "Payee", accessor: (r) => r.payee, cell: (r) => <span className="text-xs whitespace-nowrap">{r.payee || "—"}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (r) => Number(r.amount), cell: (r) => <span className="text-xs font-semibold whitespace-nowrap tabular-nums">{r.currency} {Number(r.amount).toFixed(2)}</span> },
  { id: "method", header: "Method", accessor: (r) => r.method, cell: (r) => <span className="text-xs capitalize whitespace-nowrap">{(r.method || "—").replace(/_/g, " ")}</span> },
  { id: "paidBy", header: "Paid by", accessor: (r) => r.paidBy, cell: (r) => <span className="text-xs whitespace-nowrap">{r.paidBy || "—"}</span> },
  { id: "branch", header: "Branch", accessor: (r) => r.branch, cell: (r) => <span className="text-xs whitespace-nowrap">{r.branch || "—"}</span> },
  { id: "department", header: "Department", accessor: (r) => r.department, cell: (r) => <span className="text-xs whitespace-nowrap">{r.department || "—"}</span> },
];

export function ExpenditurePanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const [type, setType] = useState<Kind | "all">("all");
  const { status: _s, agentId: _a, ...rest } = filters;
  const qs = buildQuery({ ...rest, ...(type === "all" ? {} : { type }) });
  const query = useQuery<SpendResponse>({
    queryKey: ["reports", "expenditure", runKey, ...fk, type],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/expenditure" + qs, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load spending");
      return res.json();
    },
    enabled,
  });
  const s = query.data?.summary;
  const tab = (value: Kind | "all", label: string) => (
    <Button key={value} size="sm" variant={type === value ? "default" : "outline"} className="h-7" onClick={() => setType(value)} data-testid={`button-expenditure-${value}`}>{label}</Button>
  );
  const topCategories = Object.entries(s?.byCategory ?? {})
    .sort((a, b) => Object.values(b[1]).reduce((t, v) => t + Number(v), 0) - Object.values(a[1]).reduce((t, v) => t + Number(v), 0));

  return (
    <CardSection
      title="Expenditure"
      icon={DollarSign}
      description="All money spent in the period — requisitions paid, expenditures paid and petty cash — the same money out as the Cash Flow statement."
      headerRight={<ExportButton reportType="expenditures" filters={{ ...rest, ...(type === "all" ? {} : { type }) }} />}
      flush
    >
      <div className="px-4 py-3 border-b text-sm space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {tab("all", "All")}{tab("requisition", "Requisitions")}{tab("expenditure", "Expenditures")}{tab("petty_cash", "Petty cash")}
        </div>
        {s && (
          <>
            <div><span className="font-semibold tabular-nums">{s.count}</span> payouts · spent <span className="font-semibold tabular-nums">{byCur(s.byCurrency)}</span></div>
            {topCategories.length > 0 && (
              <div className="text-xs text-muted-foreground">
                By category: {topCategories.slice(0, 12).map(([c, v]) => `${c} ${byCur(v)}`).join("  |  ")}{topCategories.length > 12 ? `  |  +${topCategories.length - 12} more` : ""}
              </div>
            )}
            {query.data?.truncated && <div className="text-xs text-destructive">Too many payouts to show them all — narrow the dates.</div>}
          </>
        )}
      </div>
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : (
        <EnhancedDataTable
          columns={columns}
          rows={query.data?.rows ?? []}
          getRowKey={(r) => `${r.kind}-${r.id}`}
          exportFilename="expenditure"
          storageKey="reports-expenditure-v2"
          emptyMessage="Nothing spent in this period."
        />
      )}
    </CardSection>
  );
}
