import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

const columns: EdtColumn<any>[] = [
  { id: "claimNumber", header: "Claim #", accessor: (c) => c.claimNumber, cell: (c) => <span className="font-mono text-sm whitespace-nowrap">{c.claimNumber}</span> },
  { id: "policyNumber", header: "Policy #", accessor: (c) => c.policyNumber || "", cell: (c) => <span className="font-mono text-sm whitespace-nowrap">{c.policyNumber || "—"}</span> },
  { id: "type", header: "Type", accessor: (c) => c.claimType, cell: (c) => <Badge variant="outline">{c.claimType}</Badge> },
  { id: "status", header: "Status", accessor: (c) => c.status, cell: (c) => <StatusBadge status={c.status} variant="claim" /> },
  { id: "firstName", header: "First Name", accessor: (c) => c.clientFirstName || "" },
  { id: "surname", header: "Surname", accessor: (c) => c.clientLastName || "" },
  { id: "nationalId", header: "National ID", accessor: (c) => c.clientNationalId || "", cell: (c) => <span className="font-mono text-sm">{c.clientNationalId || "—"}</span> },
  { id: "phone", header: "Phone", accessor: (c) => c.clientPhone || "" },
  { id: "branch", header: "Branch", accessor: (c) => c.branchName || "" },
  { id: "deceased", header: "Deceased", accessor: (c) => c.deceasedName || "" },
  {
    id: "dateOfDeath",
    header: "Date of Death",
    accessor: (c) => c.dateOfDeath ? new Date(c.dateOfDeath) : "",
    cell: (c) => <span className="text-sm whitespace-nowrap">{c.dateOfDeath ? new Date(c.dateOfDeath).toLocaleDateString() : "—"}</span>,
  },
  {
    id: "approvedAmount",
    header: "Approved Amount",
    accessor: (c) => c.approvedAmount ? parseFloat(c.approvedAmount) : "",
    cell: (c) => <span className="font-semibold tabular-nums">{c.approvedAmount ? `${c.currency || "USD"} ${c.approvedAmount}` : "—"}</span>,
  },
  {
    id: "submitted",
    header: "Submitted",
    accessor: (c) => c.createdAt ? new Date(c.createdAt) : "",
    cell: (c) => <span className="text-sm text-muted-foreground whitespace-nowrap">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</span>,
  },
];

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
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={claimsReport}
            getRowKey={(c) => c.claimId}
            exportFilename="claims-report"
            storageKey="reports-claims"
            emptyMessage="No claims match the filters."
          />
        )}
      </CardSection>
    </TabsContent>
  );
}
