import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

export function ClaimsSection({ filters, qAppend, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: claimsReport = [], isLoading: loadingClaimsReport } = useQuery<any[]>({
    queryKey: ["reports", "claims-report", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("claimsReport"),
  });

  return (
    <TabsContent value="claims">
      <CardSection title="Claims report" icon={FileText} description="Claims with policyholder details. Filter by date range, branch, or claim status." headerRight={<ExportButton reportType="claims" filters={filters} />} flush>
        {loadingClaimsReport ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : claimsReport.length === 0 ? (
          <EmptyState title="No claims match the filters" className="border-0 rounded-none bg-transparent py-8" />
        ) : (
          <div className="overflow-x-auto">
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead>Claim #</TableHead>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>First Name</TableHead>
                  <TableHead>Surname</TableHead>
                  <TableHead>National ID</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Deceased</TableHead>
                  <TableHead>Date of Death</TableHead>
                  <TableHead>Approved Amount</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {claimsReport.slice(0, 100).map((c: any) => (
                  <TableRow key={c.claimId} className="hover:bg-muted/40">
                    <TableCell className="font-mono text-sm whitespace-nowrap">{c.claimNumber}</TableCell>
                    <TableCell className="font-mono text-sm whitespace-nowrap">{c.policyNumber || "—"}</TableCell>
                    <TableCell><Badge variant="outline">{c.claimType}</Badge></TableCell>
                    <TableCell><StatusBadge status={c.status} variant="claim" /></TableCell>
                    <TableCell className="whitespace-nowrap">{c.clientFirstName || "—"}</TableCell>
                    <TableCell className="whitespace-nowrap">{c.clientLastName || "—"}</TableCell>
                    <TableCell className="font-mono text-sm">{c.clientNationalId || "—"}</TableCell>
                    <TableCell className="text-sm">{c.clientPhone || "—"}</TableCell>
                    <TableCell>{c.branchName || "—"}</TableCell>
                    <TableCell>{c.deceasedName || "—"}</TableCell>
                    <TableCell className="text-sm whitespace-nowrap">{c.dateOfDeath ? new Date(c.dateOfDeath).toLocaleDateString() : "—"}</TableCell>
                    <TableCell className="font-semibold tabular-nums">{c.approvedAmount ? `${c.currency || "USD"} ${c.approvedAmount}` : "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          </div>
        )}
      </CardSection>
    </TabsContent>
  );
}
