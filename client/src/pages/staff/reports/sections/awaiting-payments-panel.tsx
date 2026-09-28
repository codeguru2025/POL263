import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, StatusBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Clock, Loader2, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";
import { toCents, centsToNumber } from "@shared/money";

const WINDOWS = [7, 14, 30] as const;

interface AwaitingResponse {
  today: string;
  withinDays: number;
  due: any[];
  undated: any[];
  groups: {
    groupId: string;
    groupName: string;
    policies: number;
    inGrace: number;
    monthlyPremium: Record<string, string>;
    lastPayment: { date: string; amount: string; currency: string } | null;
  }[];
}

const fmtDate = (d?: string | null) => (d ? new Date(d.slice(0, 10) + "T00:00:00").toLocaleDateString() : "—");

const personColumns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
  { id: "name", header: "Client", accessor: (p) => `${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim(), cell: (p) => <span className="whitespace-nowrap">{`${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`.trim() || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
  { id: "product", header: "Product", accessor: (p) => p.productName || "" },
  { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "" },
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

const dueColumns: EdtColumn<any>[] = [
  {
    id: "due",
    header: "Due",
    accessor: (p) => p.daysUntilDue,
    cell: (p) => (
      <span className={cn("text-sm whitespace-nowrap font-medium", p.daysUntilDue < 0 ? "text-destructive" : p.daysUntilDue === 0 ? "text-amber-600" : "")}>
        {p.daysUntilDue < 0 ? `${-p.daysUntilDue} days overdue` : p.daysUntilDue === 0 ? "Due today" : `In ${p.daysUntilDue} days`}
        <span className="block text-xs font-normal text-muted-foreground">{fmtDate(p.dueDate)}</span>
      </span>
    ),
  },
  ...personColumns,
  {
    id: "amountDue",
    header: "Amount due",
    accessor: (p) => parseFloat(p.amountDue || "0"),
    cell: (p) => (
      <span className="tabular-nums whitespace-nowrap font-medium">
        {p.currency} {p.amountDue}
        {p.cyclesDue > 1 && <span className="block text-xs font-normal text-muted-foreground">{p.cyclesDue} × {p.premiumAmount}</span>}
      </span>
    ),
  },
  { id: "schedule", header: "Schedule", accessor: (p) => p.paymentSchedule || "" },
  lastPaymentColumn,
];

const undatedColumns: EdtColumn<any>[] = [
  ...personColumns,
  { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || "0"), cell: (p) => <span className="tabular-nums whitespace-nowrap">{p.currency} {p.premiumAmount}</span> },
  { id: "migrated", header: "Migrated", accessor: (p) => (p.isLegacy ? "Yes" : "No") },
  lastPaymentColumn,
];

const groupColumns: EdtColumn<AwaitingResponse["groups"][number]>[] = [
  { id: "group", header: "Group", accessor: (g) => g.groupName },
  { id: "policies", header: "Policies", accessor: (g) => g.policies, cell: (g) => <span className="tabular-nums">{g.policies}{g.inGrace ? <span className="text-destructive"> ({g.inGrace} in grace)</span> : null}</span> },
  {
    id: "premium",
    header: "Monthly premium",
    accessor: (g) => Object.values(g.monthlyPremium).map(Number).reduce((a, b) => a + b, 0),
    cell: (g) => <span className="tabular-nums whitespace-nowrap">{Object.entries(g.monthlyPremium).map(([c, v]) => `${c} ${v}`).join(" · ") || "—"}</span>,
  },
  {
    id: "lastPayment",
    header: "Last group payment",
    accessor: (g) => g.lastPayment?.date ?? "",
    cell: (g) =>
      g.lastPayment ? (
        <span className="text-sm whitespace-nowrap">
          {fmtDate(g.lastPayment.date)} <span className="text-muted-foreground tabular-nums">{g.lastPayment.currency} {g.lastPayment.amount}</span>
        </span>
      ) : (
        <span className="text-sm text-destructive">No group payment recorded</span>
      ),
  },
];

/** "USD 1,234.00 · ZAR 90.00" — never summed across currencies. */
function totalsByCurrency(rows: any[]): string {
  const cents: Record<string, number> = {};
  for (const r of rows) {
    const c = r.currency || "USD";
    cents[c] = (cents[c] ?? 0) + toCents(r.amountDue);
  }
  const parts = Object.entries(cents).map(([c, v]) => `${c} ${centsToNumber(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  return parts.join(" · ") || "—";
}

export function AwaitingPaymentsPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  const [withinDays, setWithinDays] = useState<number>(7);
  const { fromDate: _f, toDate: _t, status: _s, ...rest } = filters;
  const effective: ReportFiltersState = { ...rest, withinDays };

  const query = useQuery<AwaitingResponse>({
    queryKey: ["reports", "awaiting-payments", runKey, ...fk, withinDays],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/awaiting-payments" + buildQuery(effective), { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the due list");
      return res.json();
    },
    enabled,
  });
  const data = query.data;
  const overdue = data?.due.filter((r) => r.daysUntilDue < 0) ?? [];
  const dueSoon = data?.due.filter((r) => r.daysUntilDue >= 0) ?? [];

  return (
    <CardSection
      title="Policies Awaiting Payments"
      icon={Clock}
      description="Who needs to pay: individual policies already overdue or due soon, worked out from each policy's paid-up-to date. Group policies are paid through their group, so they're listed per group. Branch, product and agent filters apply; capture dates don't."
      headerRight={<ExportButton reportType="awaiting-payments" filters={effective} />}
      flush
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Due within</span>
          {WINDOWS.map((d) => (
            <Button key={d} size="sm" variant={withinDays === d ? "default" : "outline"} onClick={() => setWithinDays(d)} data-testid={`button-due-window-${d}`}>
              {d} days
            </Button>
          ))}
        </div>
        {data && (
          <p className="text-sm">
            <span className="text-destructive font-semibold tabular-nums">{overdue.length}</span> overdue ({totalsByCurrency(overdue)}) ·{" "}
            <span className="font-semibold tabular-nums">{dueSoon.length}</span> due soon ({totalsByCurrency(dueSoon)})
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
            columns={dueColumns}
            rows={data.due}
            getRowKey={(p) => p.policyId}
            exportFilename="due-list"
            storageKey="reports-awaiting-due"
            emptyMessage={`Nothing overdue or due in the next ${withinDays} days.`}
          />

          {data.undated.length > 0 && (
            <div>
              <div className="flex items-start gap-2 px-4 pb-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <p className="text-sm">
                  <span className="font-semibold">No due date on record ({data.undated.length})</span>
                  <span className="text-muted-foreground">
                    {" "}— these policies have no paid-up-to date, so the system can't tell when they're due and won't move them to grace or lapsed. Mostly migrated policies whose date didn't come across from the old system. Check each one and record its next payment.
                  </span>
                </p>
              </div>
              <EnhancedDataTable
                columns={undatedColumns}
                rows={data.undated}
                getRowKey={(p) => p.policyId}
                exportFilename="no-due-date"
                storageKey="reports-awaiting-undated"
                emptyMessage=""
              />
            </div>
          )}

          {data.groups.length > 0 && (
            <div>
              <div className="flex items-start gap-2 px-4 pb-2">
                <Users className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-sm">
                  <span className="font-semibold">Paid through group ({data.groups.length} groups)</span>
                  <span className="text-muted-foreground"> — oldest last payment first.</span>
                </p>
              </div>
              <EnhancedDataTable
                columns={groupColumns}
                rows={data.groups}
                getRowKey={(g) => g.groupId}
                exportFilename="groups-due"
                storageKey="reports-awaiting-groups"
                emptyMessage=""
              />
            </div>
          )}
        </div>
      ) : null}
    </CardSection>
  );
}
