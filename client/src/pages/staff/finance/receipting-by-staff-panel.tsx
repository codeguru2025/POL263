import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EmptyState } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";

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
              {!data?.byUser.length ? (
                <EmptyState title="No receipts in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byUser.map((u, i) => (
                      <TableRow key={`${u.userId}-${u.currency}-${i}`}>
                        <TableCell className={!u.userId ? "text-muted-foreground italic" : ""}>{u.displayName}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.currency} {parseFloat(u.total).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">By branch</h4>
              {!data?.byBranch.length ? (
                <EmptyState title="No receipts in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byBranch.map((b, i) => (
                      <TableRow key={`${b.branchId}-${b.currency}-${i}`}>
                        <TableCell className={!b.branchId ? "text-muted-foreground italic" : ""}>{b.branchName}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.currency} {parseFloat(b.total).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
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
