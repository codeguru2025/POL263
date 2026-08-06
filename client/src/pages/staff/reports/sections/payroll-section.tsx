import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EmptyState } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

export function PayrollSection({ filters, runKey, need }: ReportSectionBaseProps) {
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({
    queryKey: ["reports", "payroll-employees", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payroll/employees", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payrollEmployees"),
  });

  return (
    <TabsContent value="payroll">
      <CardSection title="Payroll Report" icon={Users} headerRight={<ExportButton reportType="payroll" filters={filters} />} flush>
        {loadingPayroll ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : payrollEmployees.length === 0 ? (
          <EmptyState title="No payroll employees recorded" data-testid="text-no-payroll" className="border-0 rounded-none bg-transparent py-8" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee Name</TableHead>
                <TableHead>ID Number</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Basic Salary</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payrollEmployees.slice(0, 20).map((emp: any) => (
                <TableRow key={emp.id} data-testid={`row-payroll-${emp.id}`}>
                  <TableCell className="font-medium">{emp.employeeName}</TableCell>
                  <TableCell className="font-mono text-sm">{emp.idNumber}</TableCell>
                  <TableCell>{emp.position}</TableCell>
                  <TableCell>{emp.department}</TableCell>
                  <TableCell className="font-semibold">{emp.currency || "USD"} {emp.basicSalary}</TableCell>
                  <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardSection>
    </TabsContent>
  );
}
