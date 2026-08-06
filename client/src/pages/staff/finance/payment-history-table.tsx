import { useQuery } from "@tanstack/react-query";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";

export function PaymentHistoryTable({ disbursements, currency }: { disbursements: any[]; currency: string }) {
  if (disbursements.length === 0) return <p className="text-sm text-muted-foreground py-3">No payments recorded yet.</p>;
  const total = disbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0);
  return (
    <div className="space-y-2 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment History</p>
      <div className="border rounded-md overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4 text-xs">Date</TableHead>
              <TableHead className="text-xs">Amount</TableHead>
              <TableHead className="text-xs">Method</TableHead>
              <TableHead className="text-xs">Paid by</TableHead>
              <TableHead className="text-xs">Received by</TableHead>
              <TableHead className="text-xs">Reference</TableHead>
              <TableHead className="text-xs pr-4 text-right">Voucher</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disbursements.map((d: any) => (
              <TableRow key={d.id} className="text-xs">
                <TableCell className="pl-4">{d.paidDate}</TableCell>
                <TableCell className="font-semibold tabular-nums">{currency} {parseFloat(d.amount).toFixed(2)}</TableCell>
                <TableCell className="capitalize">{(d.paymentMethod || "cash").replace(/_/g, " ")}</TableCell>
                <TableCell>{d.paidByName || "—"}</TableCell>
                <TableCell>{d.receivedByName || d.receivedBy || "—"}</TableCell>
                <TableCell className="font-mono">{d.reference || "—"}</TableCell>
                <TableCell className="pr-4 text-right">
                  <a href={getApiBase() + `/api/payment-disbursements/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Print payment voucher">
                    <Button size="icon" variant="ghost" className="h-6 w-6" type="button" aria-label="Print payment voucher">
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-semibold text-xs">
              <TableCell className="pl-4">Total paid</TableCell>
              <TableCell className="tabular-nums">{currency} {total.toFixed(2)}</TableCell>
              <TableCell colSpan={5} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
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
