import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EmptyState } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, FolderOpen, Truck } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

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
          {funeralCases.length === 0 ? (
            <EmptyState title="No funeral cases recorded" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Case #</TableHead>
                  <TableHead>Deceased</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Funeral Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {funeralCases.slice(0, 20).map((fc: any) => (
                  <TableRow key={fc.id}>
                    <TableCell className="font-mono text-sm">{fc.caseNumber}</TableCell>
                    <TableCell>{fc.deceasedName}</TableCell>
                    <TableCell><Badge>{fc.status}</Badge></TableCell>
                    <TableCell>{fc.funeralDate || "TBD"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>

      <TabsContent value="fleet">
        <CardSection title="Fleet Vehicles" icon={Truck} headerRight={<ExportButton reportType="fleet" filters={filters} />} flush>
          {loadingFleet ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : fleet.length === 0 ? (
            <EmptyState title="No fleet vehicles recorded" data-testid="text-no-fleet" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Registration</TableHead>
                  <TableHead>Make</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Year</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mileage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleet.slice(0, 20).map((v: any) => (
                  <TableRow key={v.id} data-testid={`row-fleet-${v.id}`}>
                    <TableCell className="font-mono text-sm">{v.registration}</TableCell>
                    <TableCell>{v.make}</TableCell>
                    <TableCell>{v.model}</TableCell>
                    <TableCell>{v.year}</TableCell>
                    <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                    <TableCell>{v.currentMileage || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>
      </TabsContent>
    </>
  );
}
