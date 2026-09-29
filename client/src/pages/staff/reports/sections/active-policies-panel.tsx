import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, StatusBadge } from "@/components/ds";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Loader2 } from "lucide-react";
import { ExportButton, buildQuery, type ReportFiltersState } from "../export-button";

const dateCell = (value: string | undefined) => (
  <span className="text-sm whitespace-nowrap">{value ? new Date(value).toLocaleDateString() : "—"}</span>
);

const columns: EdtColumn<any>[] = [
  { id: "policyNumber", header: "Policy #", accessor: (p) => p.policyNumber, cell: (p) => <span className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</span> },
  { id: "status", header: "Status", accessor: (p) => p.status, cell: (p) => <StatusBadge status={p.status} variant="policy" /> },
  { id: "firstName", header: "First Name", accessor: (p) => p.clientFirstName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientFirstName || "—"}</span> },
  { id: "surname", header: "Surname", accessor: (p) => p.clientLastName || "", cell: (p) => <span className="whitespace-nowrap">{p.clientLastName || "—"}</span> },
  { id: "nationalId", header: "National ID", accessor: (p) => p.clientNationalId || "", cell: (p) => <span className="font-mono text-sm">{p.clientNationalId || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (p) => p.clientPhone || "" },
  { id: "product", header: "Product", accessor: (p) => p.productName || "" },
  { id: "group", header: "Group", accessor: (p) => p.groupName || "" },
  { id: "branch", header: "Branch", accessor: (p) => p.branchName || "" },
  { id: "agent", header: "Agent", accessor: (p) => p.agentDisplayName || p.agentEmail || "Walk-in" },
  { id: "premium", header: "Premium", accessor: (p) => parseFloat(p.premiumAmount || 0), cell: (p) => <span className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</span> },
  { id: "schedule", header: "Schedule", accessor: (p) => p.paymentSchedule || "" },
  { id: "paidUpTo", header: "Paid up to", accessor: (p) => (p.paidUpTo ? new Date(p.paidUpTo) : ""), cell: (p) => dateCell(p.paidUpTo) },
  {
    id: "lastPayment",
    header: "Last payment",
    accessor: (p) => (p.lastPaymentDate ? new Date(p.lastPaymentDate) : ""),
    cell: (p) =>
      p.lastPaymentDate ? (
        <span className="text-sm whitespace-nowrap">
          {new Date(p.lastPaymentDate).toLocaleDateString()}{" "}
          <span className="tabular-nums text-muted-foreground">
            {p.lastPaymentCurrency} {p.lastPaymentAmount}
            {p.lastPaymentSource === "group" ? " (group)" : ""}
          </span>
        </span>
      ) : (
        <span className="text-sm text-muted-foreground whitespace-nowrap">None recorded in POL263</span>
      ),
  },
  {
    id: "migrated",
    header: "Migrated",
    accessor: (p) => (p.isLegacy ? "Yes" : "No"),
    cell: (p) => (p.isLegacy ? <Badge variant="secondary">Migrated</Badge> : <span className="text-muted-foreground">—</span>),
  },
  { id: "inceptionDate", header: "Inception Date", accessor: (p) => (p.inceptionDate ? new Date(p.inceptionDate) : ""), cell: (p) => dateCell(p.inceptionDate) },
  {
    id: "captureDate",
    header: "Capture Date",
    accessor: (p) => (p.policyCreatedAt ? new Date(p.policyCreatedAt) : ""),
    cell: (p) => <span className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</span>,
  },
];

function formatByCurrency(m: Record<string, string> | undefined): string {
  const entries = Object.entries(m ?? {}).filter(([, v]) => parseFloat(v) !== 0);
  if (entries.length === 0) return "—";
  return entries
    .map(([c, v]) => `${c} ${parseFloat(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
    .join(" · ");
}

export function ActivePoliciesPanel({ filters, runKey, fk, enabled }: { filters: ReportFiltersState; runKey: number; fk: string[]; enabled: boolean }) {
  // Shown by default — migrated policies are genuinely active; this just lets you set aside the
  // ones whose payments all predate POL263.
  const [hideUnpaidMigrated, setHideUnpaidMigrated] = useState(false);
  const effective: ReportFiltersState = { ...filters, excludeUnpaidMigrated: hideUnpaidMigrated || undefined };
  const q = buildQuery(effective);

  const list = useQuery<any[]>({
    queryKey: ["reports", "active-policies", runKey, ...fk, hideUnpaidMigrated],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/active-policies" + q, { credentials: "include" });
      if (!res.ok) throw new Error("Could not load active policies");
      return res.json();
    },
    enabled,
  });

  // Count + monthly premium come from the database (same endpoint as the Policy overview).
  const summary = useQuery<{ summary: { counts: Record<string, number>; monthlyPremium: Record<string, Record<string, string>> } }>({
    queryKey: ["reports", "active-policies-summary", runKey, ...fk, hideUnpaidMigrated],
    queryFn: async () => {
      const { status: _status, ...rest } = effective;
      const sq = buildQuery(rest);
      const res = await fetch(getApiBase() + "/api/reports/policy-overview" + (sq ? sq + "&" : "?") + "status=active&limit=1", { credentials: "include" });
      if (!res.ok) throw new Error("Could not load the summary");
      return res.json();
    },
    enabled,
  });
  const s = summary.data?.summary;

  return (
    <CardSection
      title="Active policies"
      icon={CheckCircle}
      description="Policies with status active, with when each was last paid and what it's paid up to. Migrated policies whose payments were all made before POL263 show “None recorded in POL263”. From/to limit policies by capture date."
      headerRight={<ExportButton reportType="active-policies" filters={effective} />}
      flush
    >
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b">
        <p className="text-sm">
          {s ? (
            <>
              <span className="font-semibold tabular-nums">{(s.counts.active ?? 0).toLocaleString()}</span>
              <span className="text-muted-foreground"> active policies · monthly premium </span>
              <span className="font-semibold tabular-nums">{formatByCurrency(s.monthlyPremium.active)}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Counting…</span>
          )}
        </p>
        <div className="flex items-center gap-2">
          <Checkbox id="hide-unpaid-migrated" checked={hideUnpaidMigrated} onCheckedChange={(v) => setHideUnpaidMigrated(v === true)} data-testid="checkbox-hide-unpaid-migrated" />
          <Label htmlFor="hide-unpaid-migrated" className="text-sm font-normal cursor-pointer">
            Hide migrated policies with no POL263 payment
          </Label>
        </div>
      </div>
      {list.isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      ) : list.isError ? (
        <p className="text-sm text-destructive py-6 text-center">{(list.error as Error).message}. Try again.</p>
      ) : (
        <EnhancedDataTable
          columns={columns}
          rows={list.data ?? []}
          getRowKey={(p) => p.policyId || p.id}
          exportFilename="active-policies"
          storageKey="reports-active-policies-v2"
          emptyMessage="No active policies match the filters."
        />
      )}
    </CardSection>
  );
}
