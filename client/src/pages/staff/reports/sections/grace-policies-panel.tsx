import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { AlertCircle, AlertTriangle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { toCents, centsToNumber } from "@shared/money";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

interface GraceResponse {
  today: string;
  lapseWithinDays: number | null;
  individual: any[];
  groupStuck: any[];
}

const fmtDate = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");

const FILTERS: { label: string; value: number | undefined }[] = [
  { label: "All in grace", value: undefined },
  { label: "Lapsing within 7 days", value: 7 },
  { label: "Lapsing within 14 days", value: 14 },
];

const personColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
  { id: "name", header: "Client", accessor: (p) => `${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim(), cell: (p) => <span className="whitespace-nowrap">{`${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim() || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
  { id: "product", header: "Product", accessor: (p) => p.productName || "" },
  { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "Walk-in" },
];

const lastPaymentColumn: EdtColumn<any> = {
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
};

const graceColumns: EdtColumn<any>[] = [
  {
    id: "lapse",
    header: "Lapses",
    accessor: (p) => p.daysUntilLapse ?? Number.MAX_SAFE_INTEGER,
    cell: (p) =>
      p.lapseDate ? (
        <span className={cn("text-sm whitespace-nowrap font-medium", p.daysUntilLapse <= 3 ? "text-destructive" : p.daysUntilLapse <= 7 ? "text-amber-600" : "")}>
          {p.daysUntilLapse <= 0 ? "Today" : p.daysUntilLapse === 1 ? "Tomorrow" : `In ${p.daysUntilLapse} days`}
          <span className="block text-xs font-normal text-muted-foreground">{fmtDate(p.lapseDate)}</span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground">No grace end date</span>
      ),
  },
  ...personColumns,
  { id: "overdue", header: "Days overdue", accessor: (p) => p.daysOverdue, cell: (p) => <span className="tabular-nums">{p.daysOverdue}</span> },
  {
    id: "keep",
    header: "To keep the policy",
    accessor: (p) => parseFloat(p.amountDue || "0"),
    cell: (p) => (
      <span className="tabular-nums whitespace-nowrap font-medium">
        {p.currency} {p.amountDue}
        {p.cyclesDue > 1 && <span className="block text-xs font-normal text-muted-foreground">{p.cyclesDue} × {p.premiumAmount}</span>}
      </span>
    ),
  },
  lastPaymentColumn,
];

const groupStuckColumns: EdtColumn<any>[] = [
  ...personColumns,
  { id: "group", header: "Group", accessor: (p) => p.groupName || "" },
  lastPaymentColumn,
];

/** "USD 1,234.00 · ZAR 90.00" — never summed across currencies. */
function totalsByCurrency(rows: any[]): string {
  const cents: Record<string, number> = {};
  for (const r of rows) cents[r.currency || "USD"] = (cents[r.currency || "USD"] ?? 0) + toCents(r.amountDue);
  return Object.entries(cents)
    .map(([c, v]) => `${c} ${centsToNumber(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" · ") || "—";
}

/** Overdue / grace, with the old Pre-lapse tab folded in as the "Lapsing within" filter. */
export function GracePoliciesPanel({ filters, runKey, fk, enabled, initialLapseWithinDays }: {
  filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean; initialLapseWithinDays?: number;
}) {
  const [lapseWithinDays, setLapseWithinDays] = useState<number | undefined>(initialLapseWithinDays);
  const { fromDate: _f, toDate: _t, status: _s, ...rest } = filters;
  const effective: ReportFiltersState = { ...rest, lapseWithinDays };

  const query = useQuery<GraceResponse>({
    queryKey: ["reports", "overdue", runKey, ...fk, lapseWithinDays ?? "all"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/overdue" + buildQuery(effective), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load policies in grace");
      return res.json();
    },
    enabled,
  });
  const data = query.data;
  const lapsingThisWeek = data?.individual.filter((r) => r.daysUntilLapse != null && r.daysUntilLapse <= 7).length ?? 0;

  return (
    <CardSection
      title="Overdue / grace"
      icon={AlertCircle}
      description="Policies in grace: payment is late, and the policy lapses when grace runs out. Soonest lapse first, with what the client must pay to keep it. Branch, product and agent filters apply; capture dates don't."
      headerRight={<ExportButton reportType="overdue" filters={effective} />}
      flush
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <Button key={f.label} size="sm" variant={lapseWithinDays === f.value ? "default" : "outline"} onClick={() => setLapseWithinDays(f.value)} data-testid={`button-grace-filter-${f.value ?? "all"}`}>
              {f.label}
            </Button>
          ))}
        </div>
        {data && (
          <p className="text-sm">
            <span className="font-semibold tabular-nums">{data.individual.length}</span> policies · to keep them{" "}
            <span className="font-semibold tabular-nums">{totalsByCurrency(data.individual)}</span>
            {lapseWithinDays == null && (
              <>
                {" "}· <span className="text-destructive font-semibold tabular-nums">{lapsingThisWeek}</span> lapse this week
              </>
            )}
          </p>
        )}
      </div>

      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : data ? (
        <div className="space-y-6 pb-4">
          <EnhancedDataTable
            columns={graceColumns}
            rows={data.individual}
            getRowKey={(p) => p.policyId}
            exportFilename="in-grace"
            storageKey="reports-grace"
            emptyMessage={lapseWithinDays != null ? `Nothing lapses in the next ${lapseWithinDays} days.` : "No policies are in grace."}
          />
          {data.groupStuck.length > 0 && (
            <div>
              <div className="flex items-start gap-2 px-4 pb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm">
                  <span className="font-semibold">Group policies stuck in grace ({data.groupStuck.length})</span>
                  <span className="text-muted-foreground">
                    {" "}— group policies are paid through their group and never lapse on their own, so one in grace stays there until someone moves it. Check the group is paying and set the policy back to active.
                  </span>
                </p>
              </div>
              <EnhancedDataTable
                columns={groupStuckColumns}
                rows={data.groupStuck}
                getRowKey={(p) => p.policyId}
                exportFilename="group-policies-in-grace"
                storageKey="reports-grace-groups"
                emptyMessage=""
              />
            </div>
          )}
        </div>
      ) : null}
    </CardSection>
  );
}
