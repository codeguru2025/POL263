import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

type Kind = "premium" | "service" | "society";
const KIND_LABEL: Record<Kind, string> = { premium: "Premium", service: "Funeral service", society: "Society lump sum" };

interface ReceiptsResponse {
  rows: any[];
  truncated: boolean;
  summary: {
    count: number;
    byCurrency: Record<string, string>;
    byKind: Record<Kind, Record<string, string>>;
    byMethod: Record<string, Record<string, string>>;
    pending: { count: number; byCurrency: Record<string, string> };
    excludedForFilter: string[];
  };
}

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const byCur = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";
const methodLabel = (m: string) => (m ? m.replace(/_/g, " ") : "not recorded");

const columns: EdtColumn<any>[] = [
  { id: "datePaid", header: "Date paid", accessor: (r) => r.issuedAt, cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDay(r.datePaid)}</span> },
  { id: "receiptNumber", header: "Receipt #", accessor: (r) => r.receiptNumber, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.kind === "premium" ? formatReceiptNumber(r.receiptNumber) : r.receiptNumber}</span> },
  {
    id: "kind", header: "Type", accessor: (r) => KIND_LABEL[r.kind as Kind],
    cell: (r) => (
      <span className="whitespace-nowrap text-xs">
        {KIND_LABEL[r.kind as Kind]}
        {r.pending && <Badge variant="outline" className="ml-1 text-[10px] bg-amber-500/10 text-amber-700 border-amber-200">Waiting for approval</Badge>}
      </span>
    ),
  },
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="text-xs font-mono whitespace-nowrap">{r.policyNumber || "—"}</span> },
  { id: "payer", header: "Paid by", accessor: (r) => r.payer, cell: (r) => <span className="text-xs whitespace-nowrap">{r.payer || "—"}</span> },
  { id: "description", header: "Product / description", accessor: (r) => r.description, cell: (r) => <span className="text-xs max-w-[200px] truncate block" title={r.description}>{r.description || "—"}</span> },
  {
    id: "amount", header: "Amount", align: "right", accessor: (r) => Number(r.amount),
    cell: (r) => <span className={`text-xs font-semibold whitespace-nowrap tabular-nums ${r.pending ? "text-muted-foreground line-through" : ""}`}>{r.currency} {Number(r.amount).toFixed(2)}</span>,
  },
  { id: "premiumDue", header: "Premium due", accessor: (r) => r.premiumDue, cell: (r) => <span className="text-xs whitespace-nowrap tabular-nums">{r.premiumDue || "—"}</span> },
  { id: "monthsPaid", header: "Months paid", align: "right", accessor: (r) => r.monthsPaid ?? -1, cell: (r) => <span className="text-xs tabular-nums">{r.monthsPaid ?? "—"}</span> },
  { id: "method", header: "Method", accessor: (r) => methodLabel(r.method), cell: (r) => <Badge variant="outline" className="text-[10px] capitalize">{methodLabel(r.method)}</Badge> },
  { id: "agent", header: "Agent", accessor: (r) => r.agent, cell: (r) => <span className="text-xs whitespace-nowrap">{r.agent || "—"}</span> },
  { id: "capturedBy", header: "Captured by", accessor: (r) => r.capturedBy, cell: (r) => <span className="text-xs whitespace-nowrap">{r.capturedBy || "—"}</span> },
  { id: "group", header: "Group", accessor: (r) => r.groupName, cell: (r) => <span className="text-xs whitespace-nowrap">{r.groupName || "—"}</span> },
  { id: "branch", header: "Branch", accessor: (r) => r.branch, cell: (r) => <span className="text-xs whitespace-nowrap">{r.branch || "—"}</span> },
];

export function ReceiptsPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const [type, setType] = useState<Kind | "all">("all");
  const { status: _s, ...rest } = filters;
  const qs = buildQuery(rest);
  const query = useQuery<ReceiptsResponse>({
    queryKey: ["reports", "receipts", runKey, ...fk, type],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/receipts" + qs + (type === "all" ? "" : `${qs ? "&" : "?"}type=${type}`), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load receipts");
      return res.json();
    },
    enabled,
  });
  const s = query.data?.summary;
  const tab = (value: Kind | "all", label: string) => (
    <Button key={value} size="sm" variant={type === value ? "default" : "outline"} className="h-7" onClick={() => setType(value)} data-testid={`button-receipts-${value}`}>{label}</Button>
  );

  return (
    <CardSection
      title="Receipts"
      icon={Receipt}
      description="Every receipt in the period — policy premiums, funeral services and society lump sums. 'All' is everything received, the same as the Income Statement. Receipts waiting for approval are listed but not counted."
      headerRight={<ExportButton reportType="receipts" filters={rest} />}
      flush
    >
      <div className="px-4 py-3 border-b text-sm space-y-2">
        <div className="flex gap-1.5 flex-wrap">
          {tab("all", "All")}{tab("premium", "Premiums")}{tab("service", "Funeral services")}{tab("society", "Society lump sums")}
        </div>
        {s && (
          <>
            <div>
              <span className="font-semibold tabular-nums">{s.count}</span> receipts · received <span className="font-semibold tabular-nums">{byCur(s.byCurrency)}</span>
              {s.pending.count > 0 && <span className="text-amber-700"> · {s.pending.count} waiting for approval ({byCur(s.pending.byCurrency)}) — not counted</span>}
            </div>
            {type === "all" && (
              <div className="text-xs text-muted-foreground">
                Premiums {byCur(s.byKind.premium)} · Funeral services {byCur(s.byKind.service)} · Society lump sums {byCur(s.byKind.society)}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              By method: {Object.entries(s.byMethod).map(([m, v]) => `${methodLabel(m)} ${byCur(v)}`).join("  |  ") || "—"}
            </div>
            {s.excludedForFilter.length > 0 && (
              <div className="text-xs text-amber-700">{s.excludedForFilter.join(" and ")} aren't kept per {filters.agentId ? "agent" : "branch"}, so they're not included with this filter.</div>
            )}
            {query.data?.truncated && <div className="text-xs text-destructive">Too many receipts to show them all — narrow the dates.</div>}
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
          exportFilename="receipts"
          storageKey="reports-receipts-v2"
          emptyMessage="No receipts in this period."
        />
      )}
    </CardSection>
  );
}
