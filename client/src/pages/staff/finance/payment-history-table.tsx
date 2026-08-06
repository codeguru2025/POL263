import { useQuery } from "@tanstack/react-query";
import { EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";

const paymentHistoryColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (d) => d.paidDate, cell: (d) => <span className="text-xs">{d.paidDate}</span> },
  { id: "amount", header: "Amount", accessor: (d) => parseFloat(d.amount), cell: (d) => <span className="text-xs font-semibold tabular-nums">{parseFloat(d.amount).toFixed(2)}</span> },
  { id: "method", header: "Method", accessor: (d) => d.paymentMethod || "cash", cell: (d) => <span className="text-xs capitalize">{(d.paymentMethod || "cash").replace(/_/g, " ")}</span> },
  { id: "paidBy", header: "Paid by", accessor: (d) => d.paidByName || "", cell: (d) => <span className="text-xs">{d.paidByName || "—"}</span> },
  { id: "receivedBy", header: "Received by", accessor: (d) => d.receivedByName || d.receivedBy || "", cell: (d) => <span className="text-xs">{d.receivedByName || d.receivedBy || "—"}</span> },
  { id: "reference", header: "Reference", accessor: (d) => d.reference || "", cell: (d) => <span className="text-xs font-mono">{d.reference || "—"}</span> },
  {
    id: "voucher",
    header: "Voucher",
    align: "right",
    sortable: false,
    exportable: false,
    cell: (d) => (
      <a href={getApiBase() + `/api/payment-disbursements/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Print payment voucher">
        <Button size="icon" variant="ghost" className="h-6 w-6" type="button" aria-label="Print payment voucher">
          <Printer className="h-3.5 w-3.5" />
        </Button>
      </a>
    ),
  },
];

export function PaymentHistoryTable({ disbursements, currency }: { disbursements: any[]; currency: string }) {
  if (disbursements.length === 0) return <p className="text-sm text-muted-foreground py-3">No payments recorded yet.</p>;
  const total = disbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0);
  return (
    <div className="space-y-2 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment History</p>
      <EnhancedDataTable
        columns={paymentHistoryColumns}
        rows={disbursements}
        getRowKey={(d: any) => d.id}
        searchable={false}
        exportFilename="payment-history"
        storageKey="finance-payment-history"
        emptyMessage="No payments recorded yet."
      />
      <p className="text-xs font-semibold tabular-nums text-right pr-1">Total paid: {currency} {total.toFixed(2)}</p>
    </div>
  );
}

export function RequisitionPaymentHistory({ requisitionId, currency }: { requisitionId: string; currency: string }) {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/payment-disbursements", { entityType: "requisition", entityId: requisitionId }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/payment-disbursements?entityType=requisition&entityId=${requisitionId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  return <PaymentHistoryTable disbursements={data} currency={currency} />;
}

export function ExpenditurePaymentHistory({ expenditureId, currency }: { expenditureId: string; currency: string }) {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/payment-disbursements", { entityType: "expenditure", entityId: expenditureId }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/payment-disbursements?entityType=expenditure&entityId=${expenditureId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  return <PaymentHistoryTable disbursements={data} currency={currency} />;
}
