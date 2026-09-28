import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Loader2 } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

interface LapsedResponse {
  today: string;
  rows: any[];
  summary: {
    count: number;
    lapsedThisMonth: number;
    monthlyPremiumLost: Record<string, string>;
    reinstateAll: Record<string, string>;
  };
}

const fmtDate = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");

function byCurrency(m: Record<string, string> | undefined): string {
  const parts = Object.entries(m ?? {})
    .filter(([, v]) => parseFloat(v) !== 0)
    .map(([c, v]) => `${c} ${parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return parts.join(" · ") || "—";
}

const columns: EdtColumn<any>[] = [
  {
    id: "lapsedOn",
    header: "Lapsed",
    accessor: (p) => p.lapsedOn || "",
    cell: (p) => (
      <span className="text-sm whitespace-nowrap">
        {fmtDate(p.lapsedOn)}
        {p.daysSinceLapse != null && <span className="block text-xs text-muted-foreground">{p.daysSinceLapse === 0 ? "today" : `${p.daysSinceLapse} days ago`}</span>}
      </span>
    ),
  },
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
  { id: "name", header: "Client", accessor: (p) => `${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim(), cell: (p) => <span className="whitespace-nowrap">{`${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim() || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
  { id: "product", header: "Product", accessor: (p) => p.productName || "" },
  { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "" },
  {
    id: "reinstate",
    header: "To reinstate",
    accessor: (p) => parseFloat(p.reinstateCost || "0"),
    cell: (p) => (
      <span className="tabular-nums whitespace-nowrap font-medium">
        {p.currency} {p.reinstateCost}
        <span className="block text-xs font-normal text-muted-foreground">{p.reinstateBasis === "arrears" ? "must clear arrears" : "one premium"}</span>
      </span>
    ),
  },
  {
    id: "waiting",
    header: "New waiting period",
    accessor: (p) => (p.newWaitingPeriod ? p.newWaitingPeriodDays ?? 0 : -1),
    cell: (p) => (p.newWaitingPeriod ? <span className="text-sm whitespace-nowrap">Yes, {p.newWaitingPeriodDays} days</span> : <span className="text-sm text-muted-foreground">No</span>),
  },
  {
    id: "times",
    header: "Times lapsed",
    accessor: (p) => p.timesLapsed,
    cell: (p) => (p.timesLapsed > 1 ? <Badge variant="destructive">{p.timesLapsed}×</Badge> : <span className="tabular-nums">{p.timesLapsed || "—"}</span>),
  },
  {
    id: "lastPayment",
    header: "Last payment",
    accessor: (p) => p.lastPaymentDate || "",
    cell: (p) =>
      p.lastPaymentDate ? (
        <span className="text-sm whitespace-nowrap">
          {fmtDate(p.lastPaymentDate)} <span className="text-muted-foreground tabular-nums">{p.lastPaymentCurrency} {p.lastPaymentAmount}</span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground whitespace-nowrap">None recorded in POL263</span>
      ),
  },
  { id: "migrated", header: "Migrated", accessor: (p) => (p.isLegacy ? "Yes" : "No"), cell: (p) => (p.isLegacy ? <Badge variant="secondary">Migrated</Badge> : <span className="text-muted-foreground">—</span>) },
];

export function LapsedPoliciesPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const { status: _s, ...rest } = filters;
  const query = useQuery<LapsedResponse>({
    queryKey: ["reports", "lapsed", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapsed" + buildQuery(rest), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load lapsed policies");
      return res.json();
    },
    enabled,
  });
  const s = query.data?.summary;

  return (
    <CardSection
      title="Lapsed policies"
      icon={AlertCircle}
      description="Lapsed policies to win back, most recent first, with what the client must pay to reinstate — worked out the same way the system decides it when the payment comes in. From/to filter the date the policy lapsed."
      headerRight={<ExportButton reportType="lapsed" filters={rest} />}
      flush
    >
      {s && (
        <div className="px-4 py-3 border-b text-sm">
          <span className="font-semibold tabular-nums">{s.count}</span> lapsed
          {" "}(<span className="tabular-nums">{s.lapsedThisMonth}</span> this month) · premium lost{" "}
          <span className="font-semibold tabular-nums">{byCurrency(s.monthlyPremiumLost)}</span>/month · to reinstate all{" "}
          <span className="font-semibold tabular-nums">{byCurrency(s.reinstateAll)}</span>
        </div>
      )}
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : (
        <EnhancedDataTable
          columns={columns}
          rows={query.data?.rows ?? []}
          getRowKey={(p) => p.policyId}
          exportFilename="lapsed-policies"
          storageKey="reports-lapsed-v2"
          emptyMessage="No lapsed policies match the filters."
        />
      )}
    </CardSection>
  );
}
