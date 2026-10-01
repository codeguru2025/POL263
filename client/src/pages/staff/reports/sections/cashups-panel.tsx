import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

type Status = "agrees" | "short" | "over" | "not_cashed_up" | "unassigned";
const STATUS: Record<Status, { label: string; cls: string }> = {
  agrees: { label: "Agrees", cls: "bg-emerald-500/10 text-emerald-700 border-emerald-200" },
  short: { label: "Short", cls: "bg-rose-500/10 text-rose-700 border-rose-200" },
  over: { label: "Over", cls: "bg-amber-500/10 text-amber-700 border-amber-200" },
  not_cashed_up: { label: "Not cashed up", cls: "bg-rose-500/10 text-rose-700 border-rose-200" },
  unassigned: { label: "Not assigned to staff", cls: "bg-muted text-muted-foreground" },
};

interface CashupResponse {
  rows: any[];
  summary: {
    cashTaken: Record<string, string>;
    cashedUp: Record<string, string>;
    notCashedUp: Record<string, string>;
    unassigned: Record<string, string>;
    counts: Record<Status, number>;
  };
}

const fmtDay = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");
const byCur = (m: Record<string, string> | undefined) =>
  Object.entries(m ?? {}).filter(([, v]) => Number(v) !== 0)
    .map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") || "—";
const money = (cur: string, v: string | null) => (v == null ? "—" : `${cur} ${Number(v).toFixed(2)}`);

const columns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (r) => r.date, cell: (r) => <span className="text-xs whitespace-nowrap">{fmtDay(r.date)}</span> },
  { id: "staff", header: "Staff member", accessor: (r) => r.staff, cell: (r) => <span className="text-xs whitespace-nowrap">{r.staff}</span> },
  { id: "taken", header: "Cash taken (system)", align: "right", accessor: (r) => Number(r.cashTaken), cell: (r) => <span className="text-xs tabular-nums whitespace-nowrap">{money(r.currency, r.cashTaken)} <span className="text-muted-foreground">({r.receipts})</span></span> },
  { id: "counted", header: "Cashed up", align: "right", accessor: (r) => (r.counted == null ? -1 : Number(r.counted)), cell: (r) => <span className="text-xs tabular-nums whitespace-nowrap">{money(r.currency, r.counted)}</span> },
  { id: "difference", header: "Difference", align: "right", accessor: (r) => (r.difference == null ? 0 : Number(r.difference)), cell: (r) => <span className={`text-xs tabular-nums whitespace-nowrap font-medium ${r.difference && Number(r.difference) !== 0 ? "text-rose-700" : ""}`}>{money(r.currency, r.difference)}</span> },
  { id: "state", header: "Cash-up", accessor: (r) => r.cashupState ?? "", cell: (r) => <span className="text-xs capitalize text-muted-foreground">{r.cashupState ?? "—"}</span> },
  { id: "status", header: "Check", accessor: (r) => STATUS[r.status as Status].label, cell: (r) => <Badge variant="outline" className={`text-[10px] whitespace-nowrap ${STATUS[r.status as Status].cls}`}>{STATUS[r.status as Status].label}</Badge> },
];

export function CashupsPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const [problemsOnly, setProblemsOnly] = useState(false);
  const { status: _s, ...rest } = filters;
  const query = useQuery<CashupResponse>({
    queryKey: ["reports", "cashups", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + buildQuery(rest), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the cash-up check");
      return res.json();
    },
    enabled,
  });
  const s = query.data?.summary;
  const rows = (query.data?.rows ?? []).filter((r) => !problemsOnly || ["short", "over", "not_cashed_up"].includes(r.status));

  return (
    <CardSection
      title="Cash-ups"
      icon={ShieldCheck}
      description="Each staff member's cash for each day, as the system recorded it, against the cash-up they did for that day — so you can see who is holding how much and since when. One line per currency."
      headerRight={<ExportButton reportType="cashups" filters={rest} />}
      flush
    >
      {s && (
        <div className="px-4 py-3 border-b text-sm space-y-1">
          <div>
            Cash taken <span className="font-semibold tabular-nums">{byCur(s.cashTaken)}</span> ·
            cashed up <span className="font-semibold tabular-nums text-emerald-700">{byCur(s.cashedUp)}</span> ·
            not cashed up <span className="font-semibold tabular-nums text-rose-700">{byCur(s.notCashedUp)}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {s.counts.agrees} agree · {s.counts.short} short · {s.counts.over} over · {s.counts.not_cashed_up} not cashed up
            {byCur(s.unassigned) !== "—" && <> · society lump sums {byCur(s.unassigned)} aren't recorded against a staff member</>}
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer pt-1">
            <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} data-testid="checkbox-cashups-problems" />
            Only show days that need attention
          </label>
        </div>
      )}
      {query.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : query.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(query.error as Error).message}. Try again.</p>
      ) : (
        <EnhancedDataTable
          columns={columns}
          rows={rows}
          getRowKey={(r) => `${r.date}-${r.userId ?? "x"}-${r.currency}-${r.staff}`}
          exportFilename="cash-ups"
          storageKey="reports-cashups-v2"
          emptyMessage="No cash taken in this period."
        />
      )}
    </CardSection>
  );
}
