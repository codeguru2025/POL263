import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, UserCheck } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

export type ActivationType = "first_payment" | "legacy_capture" | "back_from_grace" | "reinstated" | "reactivated" | "correction";

const TYPE_LABEL: Record<ActivationType, string> = {
  first_payment: "First payment (new)",
  legacy_capture: "Legacy (existing client)",
  back_from_grace: "Back from grace",
  reinstated: "Reinstated (was lapsed)",
  reactivated: "Reactivated (was cancelled)",
  correction: "Correction",
};
const TYPE_CLASS: Record<ActivationType, string> = {
  first_payment: "bg-emerald-500/10 text-emerald-700 border-emerald-200",
  legacy_capture: "bg-slate-500/10 text-slate-700 border-slate-200",
  back_from_grace: "bg-amber-500/10 text-amber-700 border-amber-200",
  reinstated: "bg-sky-500/10 text-sky-700 border-sky-200",
  reactivated: "bg-violet-500/10 text-violet-700 border-violet-200",
  correction: "bg-muted text-muted-foreground",
};
const ORDER: ActivationType[] = ["first_payment", "back_from_grace", "reinstated", "reactivated", "legacy_capture", "correction"];

interface ActivationsResponse {
  rows: any[];
  truncated: boolean;
  summary: { total: number; byType: Record<ActivationType, number>; firstPaymentPremium: Record<string, string> };
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
    id: "activatedOn", header: "Activated", accessor: (r) => r.activatedAt,
    cell: (r) => <span className="text-sm whitespace-nowrap">{fmtDate(r.activatedOn)} <span className="text-xs text-muted-foreground">{new Date(r.activatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></span>,
  },
  { id: "type", header: "Type", accessor: (r) => TYPE_LABEL[r.type as ActivationType], cell: (r) => <Badge variant="outline" className={`whitespace-nowrap ${TYPE_CLASS[r.type as ActivationType]}`}>{TYPE_LABEL[r.type as ActivationType]}</Badge> },
  { id: "policyNumber", header: "Policy #", accessor: (r) => r.policyNumber, cell: (r) => <span className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</span> },
  { id: "client", header: "Client", accessor: (r) => r.clientName, cell: (r) => <span className="whitespace-nowrap">{r.clientName}</span> },
  { id: "phone", header: "Phone", accessor: (r) => r.phone, cell: (r) => <span className="text-sm whitespace-nowrap">{r.phone || "—"}</span> },
  { id: "product", header: "Product", accessor: (r) => r.productName },
  { id: "premium", header: "Premium", accessor: (r) => parseFloat(r.premium || "0"), cell: (r) => <span className="tabular-nums whitespace-nowrap">{r.currency} {r.premium}</span> },
  { id: "agent", header: "Agent", accessor: (r) => r.agentName, cell: (r) => <span className="whitespace-nowrap">{r.agentName}</span> },
  { id: "group", header: "Group", accessor: (r) => r.groupName, cell: (r) => <span className="text-sm whitespace-nowrap">{r.groupName || "—"}</span> },
  {
    id: "payment", header: "Payment", accessor: (r) => r.paymentDate || "",
    cell: (r) => r.paymentAmount ? (
      <span className="text-sm whitespace-nowrap tabular-nums">
        {r.paymentCurrency} {r.paymentAmount} <span className="text-muted-foreground">{fmtDate(r.paymentDate)}{r.paymentReceiptNumber ? ` · #${r.paymentReceiptNumber}` : ""}{r.paymentSource === "group" ? " · group receipt" : ""}</span>
      </span>
    ) : <span className="text-sm text-muted-foreground">—</span>,
  },
  { id: "now", header: "Status now", accessor: (r) => r.currentStatus, cell: (r) => <span className="text-sm capitalize">{r.currentStatus}</span> },
  { id: "reason", header: "Recorded reason", accessor: (r) => r.reason, cell: (r) => <span className="text-xs text-muted-foreground max-w-[220px] truncate block" title={r.reason}>{r.reason || "—"}</span> },
];

export function ActivationsPanel({ filters, runKey, fk, enabled, initialType }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean; initialType?: ActivationType }) {
  // Status never applies: this is about the moment a policy became active, not its state now.
  const { status: _s, ...rest } = filters;
  const [show, setShow] = useState<ActivationType | "all">(initialType ?? "all");
  const query = useQuery<ActivationsResponse>({
    queryKey: ["reports", "activations", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/activations" + buildQuery(rest), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load activations");
      return res.json();
    },
    enabled,
  });
  const s = query.data?.summary;
  const rows = query.data?.rows ?? [];
  const shown = show === "all" ? rows : rows.filter((r) => r.type === show);

  const filterButton = (value: ActivationType | "all", label: string, count: number) => (
    <Button key={value} size="sm" variant={show === value ? "default" : "outline"} className="h-7" onClick={() => setShow(value)} data-testid={`button-activations-${value}`}>
      {label} ({count})
    </Button>
  );

  return (
    <CardSection
      title="Activations"
      icon={UserCheck}
      description="Every time a policy became active, and why: a new policy's first payment, a late payer back from grace, a reinstatement, or an existing client captured as a legacy policy. Only first payments are new policies starting to pay. From/to filter the day it became active; branch, product and agent filters apply."
      headerRight={<ExportButton reportType="activations" filters={rest} />}
      flush
    >
      {s && (
        <div className="px-4 py-3 border-b text-sm space-y-2">
          <div>
            <span className="font-semibold tabular-nums text-emerald-700">{s.byType.first_payment}</span> new {s.byType.first_payment === 1 ? "policy" : "policies"} started paying
            {" "}(premium <span className="font-semibold tabular-nums">{byCurrency(s.firstPaymentPremium)}</span>)
            <span className="text-muted-foreground">
              {" "}· {s.byType.back_from_grace} back from grace · {s.byType.reinstated} reinstated
              {s.byType.reactivated > 0 && <> · {s.byType.reactivated} reactivated after cancellation</>}
              {" "}· {s.byType.legacy_capture} legacy (existing clients)
              {s.byType.correction > 0 && <> · {s.byType.correction} corrections</>}
            </span>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {filterButton("all", "All", s.total)}
            {ORDER.filter((t) => s.byType[t] > 0 || t === "first_payment" || t === "reinstated").map((t) => filterButton(t, TYPE_LABEL[t], s.byType[t]))}
          </div>
          {query.data?.truncated && <div className="text-destructive">Too many activations to show them all — narrow the dates.</div>}
        </div>
      )}
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : (
        <EnhancedDataTable
          columns={columns}
          rows={shown}
          getRowKey={(r) => r.id}
          exportFilename="policy-activations"
          storageKey="reports-activations-v2"
          emptyMessage="No activations in this period."
        />
      )}
    </CardSection>
  );
}
