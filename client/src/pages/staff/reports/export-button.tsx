import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/queryClient";
import { Download } from "lucide-react";

export type ReportFiltersState = {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  branchId?: string;
  productId?: string;
  agentId?: string;
  status?: string;
};

export function buildQuery(f: ReportFiltersState) {
  const p = new URLSearchParams();
  if (f.fromDate) p.set("fromDate", f.fromDate);
  if (f.toDate) p.set("toDate", f.toDate);
  if (f.userId) p.set("userId", f.userId);
  if (f.branchId) p.set("branchId", f.branchId);
  if (f.productId) p.set("productId", f.productId);
  if (f.agentId) p.set("agentId", f.agentId);
  if (f.status) p.set("status", f.status);
  const q = p.toString();
  return q ? "?" + q : "";
}

export function ExportButton({ reportType, filters }: { reportType: string; filters: ReportFiltersState }) {
  const handleExport = () => {
    const q = buildQuery(filters);
    const url = getApiBase() + `/api/reports/export/${reportType}` + q;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType}-report.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={handleExport} data-testid={`button-export-${reportType}`}>
        <Download className="h-4 w-4 mr-1" />
        Download CSV
      </Button>
    </div>
  );
}
