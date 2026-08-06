import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Loader2, Users } from "lucide-react";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";

const byStaffColumns: EdtColumn<{ userId: string | null; displayName: string; currency: string; total: string; count: number }>[] = [
  { id: "staff", header: "Staff", accessor: (u) => u.displayName, cell: (u) => <span className={!u.userId ? "text-muted-foreground italic" : ""}>{u.displayName}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (u) => parseFloat(u.total), cell: (u) => <span className="tabular-nums">{u.currency} {parseFloat(u.total).toFixed(2)}</span> },
  { id: "receipts", header: "Receipts", align: "right", accessor: (u) => u.count },
];

const byBranchColumns: EdtColumn<{ branchId: string | null; branchName: string; currency: string; total: string; count: number }>[] = [
  { id: "branch", header: "Branch", accessor: (b) => b.branchName, cell: (b) => <span className={!b.branchId ? "text-muted-foreground italic" : ""}>{b.branchName}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (b) => parseFloat(b.total), cell: (b) => <span className="tabular-nums">{b.currency} {parseFloat(b.total).toFixed(2)}</span> },
  { id: "receipts", header: "Receipts", align: "right", accessor: (b) => b.count },
];

export function ReceiptingByStaffPanel() {
  const [period, setPeriod] = useState<Period>(() => periodForPreset("today"));

  const { data, isLoading } = useQuery<{
    byUser: Array<{ userId: string | null; displayName: string; currency: string; total: string; count: number }>;
    byBranch: Array<{ branchId: string | null; branchName: string; currency: string; total: string; count: number }>;
    legacyUnattributed: Array<{ currency: string; total: string; count: number }>;
  }>({
    queryKey: ["/api/reports/receipting-by-user", period.from, period.to],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/reports/receipting-by-user?fromDate=${period.from}&toDate=${period.to}`, { credentials: "include" });
      if (!res.ok) return { byUser: [], byBranch: [], legacyUnattributed: [] };
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <CardSection
        title="Receipting by staff & branch"
        description="How much each staff member and branch has receipted for the selected period."
        icon={Users}
        headerRight={<PeriodSelector value={period} onChange={setPeriod} />}
      >
        {isLoading ? (
          <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">By staff member</h4>
              <EnhancedDataTable
                columns={byStaffColumns}
                rows={(data?.byUser ?? []).map((u, i) => ({ ...u, _rowKey: `${u.userId}-${u.currency}-${i}` }))}
                getRowKey={(u: any) => u._rowKey}
                exportFilename="receipting-by-staff"
                storageKey="finance-receipting-by-staff"
                emptyMessage="No receipts in this period."
              />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">By branch</h4>
              <EnhancedDataTable
                columns={byBranchColumns}
                rows={(data?.byBranch ?? []).map((b, i) => ({ ...b, _rowKey: `${b.branchId}-${b.currency}-${i}` }))}
                getRowKey={(b: any) => b._rowKey}
                exportFilename="receipting-by-branch"
                storageKey="finance-receipting-by-branch"
                emptyMessage="No receipts in this period."
              />
            </div>
          </div>
        )}
        {!!data?.legacyUnattributed.length && (
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
            Plus legacy group receipts in this period ({data.legacyUnattributed.map(l => `${l.currency} ${parseFloat(l.total).toFixed(2)}`).join(", ")}) —
            these can't be attributed to a specific staff member or branch since legacy receipts don't record who entered them.
          </p>
        )}
      </CardSection>
    </div>
  );
}
