import { useQuery } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn, EmptyState, StatusBadge } from "@/components/ds";
import { TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, Plus } from "lucide-react";
import { QK_PAYMENTS } from "./query-keys";

interface PaymentsTabProps {
  policies: any[];
  clientMap: Record<string, any>;
  getClient: (clientId: string) => any;
  getPolicyNumber: (policyId: string) => string;
  onOpenPaymentDialog: () => void;
}

function paymentsColumns(opts: {
  getClient: (clientId: string) => any;
  getPolicyNumber: (policyId: string) => string;
}): EdtColumn<any>[] {
  const { getClient, getPolicyNumber } = opts;
  return [
    { id: "policy", header: "Policy", accessor: (p) => p.policyNumber || (p.policyId ? getPolicyNumber(p.policyId) : ""), cell: (p) => <span className="font-mono text-sm tabular-nums">{p.policyNumber || (p.policyId ? getPolicyNumber(p.policyId) : "—")}</span> },
    {
      id: "client",
      header: "Client",
      accessor: (p) => {
        const client = p.clientId ? getClient(p.clientId) : null;
        return client ? `${client.firstName} ${client.lastName}` : "";
      },
      cell: (p) => {
        const client = p.clientId ? getClient(p.clientId) : null;
        return <span>{client ? `${client.firstName} ${client.lastName}` : "—"}</span>;
      },
    },
    { id: "amount", header: "Amount", align: "right", accessor: (p) => parseFloat(p.amount || "0"), cell: (p) => <span className="font-semibold text-right tabular-nums">{p.currency} {parseFloat(p.amount || "0").toFixed(2)}</span> },
    { id: "method", header: "Method", accessor: (p) => p.paymentMethod, cell: (p) => <Badge variant="outline">{p.paymentMethod}</Badge> },
    {
      id: "status",
      header: "Status",
      accessor: (p) => p.status,
      cell: (p) => <StatusBadge variant="payment" status={p.status} label={p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : undefined} />,
    },
    { id: "reference", header: "Reference", accessor: (p) => p.reference || "", cell: (p) => <span className="font-mono text-xs text-muted-foreground">{p.reference || "—"}</span> },
    { id: "date", header: "Date", accessor: (p) => p.receivedAt ? new Date(p.receivedAt) : "", cell: (p) => <span className="text-sm text-muted-foreground tabular-nums">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</span> },
  ];
}

export function PaymentsTab({ policies, clientMap, getClient, getPolicyNumber, onOpenPaymentDialog }: PaymentsTabProps) {
  const { data: rawPayments, isLoading: loadingPayments } = useQuery<any[]>({ queryKey: QK_PAYMENTS });
  const payments = Array.isArray(rawPayments) ? rawPayments : [];

  return (
    <TabsContent value="payments">
      <CardSection title="Payment transactions" description="Receipted movements linked to policies and clients." icon={Receipt}>
          {loadingPayments ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : payments.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title="No payments recorded yet"
              description='Click "Receipt a Policy" above to record the first payment.'
              className="border-0 rounded-none bg-transparent py-10"
              action={<Button variant="outline" size="sm" onClick={onOpenPaymentDialog}><Plus className="h-4 w-4 mr-2" />Record first payment</Button>}
            />
          ) : (
            <EnhancedDataTable
              columns={paymentsColumns({ getClient, getPolicyNumber })}
              rows={payments}
              getRowKey={(p: any) => p.id}
              rowTestId={(p: any) => `row-payment-${p.id}`}
              exportFilename="payments"
              storageKey="finance-payments"
              emptyMessage="No payments recorded yet."
            />
          )}
      </CardSection>
    </TabsContent>
  );
}
