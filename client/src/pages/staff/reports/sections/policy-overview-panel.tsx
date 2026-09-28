import { useEffect, useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, StatusBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { BarChart3, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportButton, type ReportFiltersState } from "../export-button";

const PAGE_SIZE = 200;
const STATUS_ORDER = ["active", "grace", "inactive", "lapsed", "cancelled", "archived"];

interface OverviewRow {
  id: string;
  policyNumber: string;
  status: string;
  clientName: string;
  productName: string;
  agentName: string;
  currency: string;
  premiumAmount: string;
  paymentSchedule: string;
  createdAt: string;
}

interface OverviewResponse {
  summary: {
    total: number;
    counts: Record<string, number>;
    monthlyPremium: Record<string, Record<string, string>>;
    inForceMonthlyPremium: Record<string, string>;
  };
  matchingTotal: number;
  rows: OverviewRow[];
}

const columns: EdtColumn<OverviewRow>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm">{p.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (p) => p.clientName },
  { id: "product", header: "Product", accessor: (p) => p.productName },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
  { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || "0"), cell: (p) => <span className="tabular-nums whitespace-nowrap">{p.currency} {p.premiumAmount}</span> },
  { id: "schedule", header: "Schedule", accessor: (p) => p.paymentSchedule },
  { id: "agent", header: "Agent", accessor: (p) => p.agentName || "" },
  {
    id: "created",
    header: "Captured",
    accessor: (p) => new Date(p.createdAt),
    cell: (p) => <span className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</span>,
  },
];

/** "USD 1,234.50 · ZAR 300.00" — one figure per currency, never summed across currencies. */
function formatByCurrency(m: Record<string, string> | undefined): string {
  const entries = Object.entries(m ?? {}).filter(([, v]) => parseFloat(v) !== 0);
  if (entries.length === 0) return "—";
  return entries
    .map(([c, v]) => `${c} ${parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" · ");
}

export function PolicyOverviewPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  // A status picked in the filter bar pre-selects a tile; clicking tiles overrides it.
  const [status, setStatus] = useState<string | undefined>(filters.status);
  useEffect(() => setStatus(filters.status), [filters.status]);

  const baseParams = new URLSearchParams();
  for (const key of ["fromDate", "toDate", "branchId", "productId", "agentId"] as const) {
    const v = filters[key];
    if (v) baseParams.set(key, v);
  }
  if (status) baseParams.set("status", status);

  const query = useInfiniteQuery<OverviewResponse>({
    queryKey: ["reports", "policy-overview", runKey, ...fk, status ?? ""],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams(baseParams);
      params.set("limit", String(PAGE_SIZE));
      params.set("offset", String(pageParam));
      const res = await fetch(`${getApiBase()}/api/reports/policy-overview?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the policy overview");
      return res.json();
    },
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((n, p) => n + p.rows.length, 0);
      return loaded < last.matchingTotal && last.rows.length > 0 ? loaded : undefined;
    },
    enabled,
  });

  const pages = query.data?.pages ?? [];
  const summary = pages[0]?.summary;
  const matchingTotal = pages[0]?.matchingTotal ?? 0;
  const rows = pages.flatMap((p) => p.rows);
  const statuses = summary
    ? [...STATUS_ORDER, ...Object.keys(summary.counts).filter((s) => !STATUS_ORDER.includes(s))]
    : STATUS_ORDER;

  const tile = (key: string | undefined, label: string, count: number | undefined, premium?: string) => (
    <button
      key={key ?? "all"}
      type="button"
      onClick={() => setStatus(key)}
      aria-pressed={status === key}
      className={cn(
        "text-left p-3 rounded-lg border transition-colors",
        status === key ? "border-primary bg-primary/10" : "border-transparent bg-muted hover:bg-muted/70",
      )}
      data-testid={`tile-policy-status-${key ?? "all"}`}
    >
      <p className="text-xl font-bold tabular-nums">{count ?? "—"}</p>
      <p className="text-xs text-muted-foreground capitalize">{label}</p>
      {premium !== undefined && <p className="text-[11px] text-muted-foreground tabular-nums mt-1 leading-tight">{premium}</p>}
    </button>
  );

  return (
    <CardSection
      title="Policy overview"
      description="Every policy matching the filters, counted by status. Premiums are converted to a monthly figure (a weekly premium × 52 ÷ 12, a yearly one ÷ 12) and kept separate per currency. From/to limit policies by capture date."
      icon={BarChart3}
      headerRight={<ExportButton reportType="policies" filters={filters} />}
    >
      {query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-3">
            {tile(undefined, "All policies", summary?.total)}
            {statuses.map((s) => tile(s, s.replace(/_/g, " "), summary?.counts[s], summary ? formatByCurrency(summary.monthlyPremium[s]) + " /mo" : undefined))}
          </div>
          {summary && (
            <p className="text-sm mb-6">
              <span className="text-muted-foreground">Monthly premium in force (active + grace): </span>
              <span className="font-semibold tabular-nums">{formatByCurrency(summary.inForceMonthlyPremium)}</span>
            </p>
          )}
          {query.isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <>
              <EnhancedDataTable
                columns={columns}
                rows={rows}
                getRowKey={(p) => p.id}
                exportFilename="policies-overview"
                storageKey="reports-policies-overview"
                emptyMessage="No policies match the filters."
              />
              <div className="flex items-center justify-between gap-3 pt-3 text-sm text-muted-foreground">
                <span>
                  Showing {rows.length.toLocaleString()} of {matchingTotal.toLocaleString()}
                  {status ? ` ${status.replace(/_/g, " ")}` : ""} policies
                </span>
                {query.hasNextPage && (
                  <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage} data-testid="button-overview-load-more">
                    {query.isFetchingNextPage && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Load {Math.min(PAGE_SIZE, matchingTotal - rows.length).toLocaleString()} more
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </CardSection>
  );
}
