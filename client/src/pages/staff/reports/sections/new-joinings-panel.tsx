import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FileText, Loader2 } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

interface AgentJoinings { agentId: string | null; agentName: string; count: number; paid: number; unpaid: number; premium: Record<string, string> }
interface NewJoiningsResponse {
  rows: any[];
  truncated: boolean;
  summary: {
    newBusiness: number;
    paid: number;
    paidThroughGroup: number;
    unpaid: number;
    premium: Record<string, string>;
    legacyCaptured: number;
    byAgent: AgentJoinings[];
  };
}

const fmtDate = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");

function byCurrency(m: Record<string, string> | undefined): string {
  const parts = Object.entries(m ?? {})
    .filter(([, v]) => parseFloat(v) !== 0)
    .map(([c, v]) => `${c} ${parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return parts.join(" · ") || "—";
}

const paidCell = (p: any) =>
  p.paid === "paid" ? (
    <span className="text-sm whitespace-nowrap">
      <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 border-emerald-200">Paid</Badge>{" "}
      <span className="text-muted-foreground">{fmtDate(p.firstPaymentDate)} · {p.firstPaymentCurrency} {p.firstPaymentAmount}</span>
    </span>
  ) : p.paid === "group" ? (
    <span className="text-sm whitespace-nowrap">
      <Badge variant="outline" className="bg-indigo-500/10 text-indigo-700 border-indigo-200">Through group</Badge>{" "}
      <span className="text-muted-foreground">last group receipt {fmtDate(p.firstPaymentDate)}</span>
    </span>
  ) : (
    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200">Not paid yet</Badge>
  );

const columns: EdtColumn<any>[] = [
  { id: "capturedOn", header: "Captured on", accessor: (p) => p.capturedOn, cell: (p) => <span className="text-sm whitespace-nowrap">{fmtDate(p.capturedOn)}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
  { id: "memberNumber", header: "Member #", accessor: (p) => p.memberNumber, cell: (p) => <span className="font-mono text-xs whitespace-nowrap">{p.memberNumber || "—"}</span> },
  { id: "client", header: "Client", accessor: (p) => p.clientName, cell: (p) => <span className="whitespace-nowrap">{p.clientName || "—"}</span> },
  { id: "nationalId", header: "National ID", accessor: (p) => p.nationalId, cell: (p) => <span className="font-mono text-xs whitespace-nowrap">{p.nationalId || "—"}</span> },
  { id: "dateOfBirth", header: "Date of birth", accessor: (p) => p.dateOfBirth, cell: (p) => <span className="text-sm whitespace-nowrap">{fmtDate(p.dateOfBirth)}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.phone, cell: (p) => <span className="text-sm whitespace-nowrap">{p.phone || "—"}</span> },
  { id: "address", header: "Address", accessor: (p) => p.address, cell: (p) => <span className="text-sm max-w-[180px] truncate block" title={p.address}>{p.address || "—"}</span> },
  { id: "product", header: "Product", accessor: (p) => p.productName },
  {
    id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premium || "0"),
    cell: (p) => <span className="tabular-nums whitespace-nowrap">{p.currency} {p.premium}{p.paymentSchedule && p.paymentSchedule !== "monthly" && <span className="text-xs text-muted-foreground"> /{p.paymentSchedule}</span>}</span>,
  },
  { id: "agent", header: "Agent", accessor: (p) => p.agentName, cell: (p) => <span className="whitespace-nowrap">{p.agentName}</span> },
  { id: "group", header: "Group", accessor: (p) => p.groupName, cell: (p) => <span className="text-sm whitespace-nowrap">{p.groupName || "—"}</span> },
  { id: "branch", header: "Branch", accessor: (p) => p.branchName, cell: (p) => <span className="text-sm whitespace-nowrap">{p.branchName || "—"}</span> },
  { id: "startDate", header: "Start date", accessor: (p) => p.startDate, cell: (p) => <span className="text-sm whitespace-nowrap">{fmtDate(p.startDate)}</span> },
  {
    id: "type", header: "New / Legacy", accessor: (p) => (p.isLegacy ? "Legacy" : "New"),
    cell: (p) => (p.isLegacy ? <Badge variant="secondary" className="whitespace-nowrap">Existing client (legacy)</Badge> : <Badge variant="outline" className="bg-sky-500/10 text-sky-700 border-sky-200">New</Badge>),
  },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <span className="text-sm capitalize">{p.status}</span> },
  { id: "paid", header: "Paid?", accessor: (p) => (p.paid === "paid" ? 2 : p.paid === "group" ? 1 : 0), cell: paidCell },
];

const agentColumns: EdtColumn<AgentJoinings>[] = [
  { id: "agent", header: "Agent", accessor: (a) => a.agentName },
  { id: "count", header: "New policies", accessor: (a) => a.count, cell: (a) => <span className="tabular-nums">{a.count}</span> },
  { id: "paid", header: "Paid", accessor: (a) => a.paid, cell: (a) => <span className="tabular-nums">{a.paid}</span> },
  { id: "unpaid", header: "Not paid yet", accessor: (a) => a.unpaid, cell: (a) => <span className={`tabular-nums ${a.unpaid ? "text-amber-700 font-medium" : ""}`}>{a.unpaid}</span> },
  { id: "premium", header: "Premium", accessor: (a) => byCurrency(a.premium), cell: (a) => <span className="tabular-nums whitespace-nowrap">{byCurrency(a.premium)}</span> },
];

export function NewJoiningsPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  // Status never applies: a new joining is a new joining whatever state it is in now.
  const { status: _s, ...rest } = filters;
  const query = useQuery<NewJoiningsResponse>({
    queryKey: ["reports", "new-joinings", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/new-joinings" + buildQuery(rest), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load new joinings");
      return res.json();
    },
    enabled,
  });
  const [show, setShow] = useState<"all" | "new" | "legacy">("all");
  const s = query.data?.summary;
  const rows = query.data?.rows ?? [];
  const shown = show === "all" ? rows : rows.filter((r) => (show === "legacy" ? r.isLegacy : !r.isLegacy));

  const body = (content: ReactNode) =>
    query.isLoading ? (
      <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
    ) : query.isError ? (
      <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
    ) : content;

  const filterButton = (value: typeof show, label: string) => (
    <Button key={value} size="sm" variant={show === value ? "default" : "outline"} className="h-7" onClick={() => setShow(value)} data-testid={`button-joinings-${value}`}>
      {label}
    </Button>
  );

  return (
    <div className="space-y-4">
      <CardSection
        title="New joinings"
        icon={FileText}
        description="Every policy captured in the period. Each row says whether it is new business or an existing client entered as a legacy policy — only new business counts in the totals. From/to filter the day the policy was captured; branch, product and agent filters apply."
        headerRight={<ExportButton reportType="new-joinings" filters={rest} />}
        flush
      >
        {s && (
          <div className="px-4 py-3 border-b text-sm space-y-2">
            <div>
              <span className="font-semibold tabular-nums">{s.newBusiness}</span> new {s.newBusiness === 1 ? "policy" : "policies"} ·{" "}
              <span className="font-semibold tabular-nums text-emerald-700">{s.paid}</span> paid
              {s.paidThroughGroup > 0 && <> · <span className="font-semibold tabular-nums">{s.paidThroughGroup}</span> paid through their group</>}
              {" "}· <span className="font-semibold tabular-nums text-amber-700">{s.unpaid}</span> not paid yet ·
              premium <span className="font-semibold tabular-nums">{byCurrency(s.premium)}</span>
              <span className="text-muted-foreground"> · plus <span className="tabular-nums">{s.legacyCaptured}</span> existing {s.legacyCaptured === 1 ? "client" : "clients"} captured (legacy, not new business)</span>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {filterButton("all", `All (${s.newBusiness + s.legacyCaptured})`)}
              {filterButton("new", `New only (${s.newBusiness})`)}
              {filterButton("legacy", `Legacy only (${s.legacyCaptured})`)}
            </div>
            {query.data?.truncated && <div className="text-destructive">Too many policies to show them all — narrow the dates.</div>}
          </div>
        )}
        {body(
          <EnhancedDataTable
            columns={columns}
            rows={shown}
            getRowKey={(p) => p.policyId}
            exportFilename="new-joinings"
            storageKey="reports-new-joinings-v3"
            emptyMessage="No policies captured in this period."
          />,
        )}
      </CardSection>

      <CardSection title="New joinings by agent" icon={FileText} description="New business per agent (legacy captures not counted). Walk-in = no agent on the policy." headerRight={<ExportButton reportType="new-joinings-summary" filters={rest} />} flush>
        {body(
          <EnhancedDataTable
            columns={agentColumns}
            rows={s?.byAgent ?? []}
            getRowKey={(a) => a.agentId ?? "walk-in"}
            exportFilename="new-joinings-by-agent"
            storageKey="reports-new-joinings-agents"
            emptyMessage="No new policies in this period."
          />,
        )}
      </CardSection>
    </div>
  );
}
