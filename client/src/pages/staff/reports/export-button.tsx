import { Button } from "@/components/ui/button";
import { getApiBase } from "@/lib/queryClient";
import { Download, FileText } from "lucide-react";

/**
 * Reports narrow enough to read as a landscape-A4 PDF (≤14 columns). The wide Easipol-format
 * policy exports are CSV-only — the server refuses a PDF for them.
 */
const PDF_CAPABLE = new Set([
  "claims", "cashups", "payments", "expenditures", "platform",
  "reinstatements", "conversions", "activations", "receipt-amendments", "complaint-report",
  "branch-report", "audit-trail", "irp5-reconciliation", "data-integrity", "collection-efficiency",
  "persistency", "lapse-analysis", "member-movement",
  "active-policies", "awaiting-payments", "overdue", "pre-lapse", "lapsed",
]);

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
  const q = buildQuery(filters);
  const open = (extra?: string) => {
    const url = getApiBase() + `/api/reports/export/${reportType}` + q + (extra ? (q ? "&" : "?") + extra : "");
    const a = document.createElement("a");
    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={() => open()} data-testid={`button-export-${reportType}`}>
        <Download className="h-4 w-4 mr-1" />
        CSV
      </Button>
      {PDF_CAPABLE.has(reportType) && (
        <Button variant="outline" size="sm" onClick={() => open("format=pdf&download=1")} data-testid={`button-export-pdf-${reportType}`}>
          <FileText className="h-4 w-4 mr-1" />
          PDF
        </Button>
      )}
    </div>
  );
}
