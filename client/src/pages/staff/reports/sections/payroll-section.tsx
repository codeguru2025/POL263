import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Loader2, Users } from "lucide-react";
import { ExportButton } from "../export-button";
import type { ReportSectionBaseProps } from "../use-report-filters";

const columns: EdtColumn<any>[] = [
  { id: "employeeName", header: "Employee Name", accessor: (emp) => emp.employeeName, cell: (emp) => <span className="font-medium">{emp.employeeName}</span> },
  { id: "idNumber", header: "ID Number", accessor: (emp) => emp.idNumber, cell: (emp) => <span className="font-mono text-sm">{emp.idNumber}</span> },
  { id: "position", header: "Position", accessor: (emp) => emp.position },
  { id: "department", header: "Department", accessor: (emp) => emp.department },
  {
    id: "basicSalary",
    header: "Basic Salary",
    accessor: (emp) => parseFloat(emp.basicSalary || 0),
    cell: (emp) => <span className="font-semibold">{emp.currency || "USD"} {emp.basicSalary}</span>,
  },
  {
    id: "status",
    header: "Status",
    accessor: (emp) => emp.status,
    cell: (emp) => <Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge>,
  },
];

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
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={payrollEmployees}
            getRowKey={(emp) => emp.id}
            rowTestId={(emp) => `row-payroll-${emp.id}`}
            exportFilename="payroll-report"
            storageKey="reports-payroll"
            emptyMessage="No payroll employees recorded."
          />
        )}
      </CardSection>
    </TabsContent>
  );
}
