import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen, Truck } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

const funeralColumns: EdtColumn<any>[] = [
  { id: "caseNumber", header: "Case #", accessor: (fc) => fc.caseNumber, cell: (fc) => <span className="font-mono text-sm">{fc.caseNumber}</span> },
  { id: "deceased", header: "Deceased", accessor: (fc) => fc.deceasedName },
  { id: "status", header: "Status", accessor: (fc) => fc.status, cell: (fc) => <Badge>{fc.status}</Badge> },
  { id: "funeralDate", header: "Funeral Date", accessor: (fc) => fc.funeralDate || "", cell: (fc) => <span>{fc.funeralDate || "TBD"}</span> },
];

const fleetColumns: EdtColumn<any>[] = [
  { id: "registration", header: "Registration", accessor: (v) => v.registration, cell: (v) => <span className="font-mono text-sm">{v.registration}</span> },
  { id: "make", header: "Make", accessor: (v) => v.make },
  { id: "model", header: "Model", accessor: (v) => v.model },
  { id: "year", header: "Year", accessor: (v) => v.year },
  {
    id: "status",
    header: "Status",
    accessor: (v) => v.status,
    cell: (v) => <Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge>,
  },
  { id: "mileage", header: "Mileage", accessor: (v) => v.currentMileage || "", cell: (v) => <span>{v.currentMileage || "—"}</span> },
];

export function OperationsSection({ filters, qAppend, fk, runKey, need }: ReportSectionBaseProps) {
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["reports", "funerals", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/funeral-cases?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("funeralCases"),
  });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({
    queryKey: ["reports", "fleet", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/fleet", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("fleet"),
  });

  return (
    <>
      <TabsContent value="funerals">
        <CardSection title="Funeral Cases" icon={FolderOpen} headerRight={<ExportButton reportType="funerals" filters={filters} />} flush>
          <EnhancedDataTable
            columns={funeralColumns}
            rows={funeralCases}
            getRowKey={(fc) => fc.id}
            exportFilename="funeral-cases"
            storageKey="reports-funerals"
            emptyMessage="No funeral cases recorded."
          />
        </CardSection>
      </TabsContent>

      <TabsContent value="fleet">
        <CardSection title="Fleet Vehicles" icon={Truck} headerRight={<ExportButton reportType="fleet" filters={filters} />} flush>
          {loadingFleet ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : (
            <EnhancedDataTable
              columns={fleetColumns}
              rows={fleet}
              getRowKey={(v) => v.id}
              rowTestId={(v) => `row-fleet-${v.id}`}
              exportFilename="fleet-vehicles"
              storageKey="reports-fleet"
              emptyMessage="No fleet vehicles recorded."
            />
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
