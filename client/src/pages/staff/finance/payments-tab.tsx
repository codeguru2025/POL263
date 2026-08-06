import { useQuery } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

export function PaymentsTab({ policies, clientMap, getClient, getPolicyNumber, onOpenPaymentDialog }: PaymentsTabProps) {
  const { data: rawPayments, isLoading: loadingPayments } = useQuery<any[]>({ queryKey: QK_PAYMENTS });
  const payments = Array.isArray(rawPayments) ? rawPayments : [];

  return (
    <TabsContent value="payments">
      <CardSection title="Payment transactions" description="Receipted movements linked to policies and clients." icon={Receipt} flush>
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
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead>Policy</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map((p: any) => {
                  const client = p.clientId ? getClient(p.clientId) : null;
                  return (
                    <TableRow key={p.id} className="hover:bg-muted/40" data-testid={`row-payment-${p.id}`}>
                      <TableCell className="font-mono text-sm tabular-nums">{p.policyNumber || (p.policyId ? getPolicyNumber(p.policyId) : "—")}</TableCell>
                      <TableCell>{client ? `${client.firstName} ${client.lastName}` : "—"}</TableCell>
                      <TableCell className="font-semibold text-right tabular-nums">{p.currency} {parseFloat(p.amount || "0").toFixed(2)}</TableCell>
                      <TableCell><Badge variant="outline">{p.paymentMethod}</Badge></TableCell>
                      <TableCell>
                        <StatusBadge
                          variant="payment"
                          status={p.status}
                          label={p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : undefined}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.reference || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
          )}
      </CardSection>
    </TabsContent>
  );
}
