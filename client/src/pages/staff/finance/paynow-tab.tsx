import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { TabsContent } from "@/components/ui/tabs";
import { Loader2, Landmark, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PolicyPremiumReceiptDialog } from "@/components/policy-premium-receipt-dialog";
import { QK_PAYMENTS, QK_PAYMENT_INTENTS } from "./query-keys";

interface PaynowTabProps {
  policies: any[];
  clientMap: Record<string, any>;
  getClient: (clientId: string) => any;
  getPolicyNumber: (policyId: string) => string;
  isAgent: boolean;
}

export function PaynowTab({ getPolicyNumber, isAgent }: PaynowTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showCashReceiptDialog, setShowCashReceiptDialog] = useState(false);
  const [cashReceiptCurrency, setCashReceiptCurrency] = useState("USD");
  const [cashReceiptNotes, setCashReceiptNotes] = useState("");
  const [cashReceiptReceivedAt, setCashReceiptReceivedAt] = useState(new Date().toISOString().slice(0, 16));
  const [reprintReceiptId, setReprintReceiptId] = useState("");
  const [pollingIntentId, setPollingIntentId] = useState<string | null>(null);

  const { data: rawPaymentIntents, isLoading: loadingIntents } = useQuery<any[]>({ queryKey: QK_PAYMENT_INTENTS });
  const paymentIntents = Array.isArray(rawPaymentIntents) ? rawPaymentIntents : [];

  const cashReceiptMutation = useMutation({
    mutationFn: async (payload: { policyId: string; amount: string; currency: string; notes?: string; receivedAt?: string }) => {
      const res = await apiRequest("POST", "/api/admin/receipts/cash", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_PAYMENTS });
      queryClient.invalidateQueries({ queryKey: QK_PAYMENT_INTENTS });
      setShowCashReceiptDialog(false);
      setCashReceiptCurrency("USD");
      setCashReceiptNotes("");
      setCashReceiptReceivedAt(new Date().toISOString().slice(0, 16));
      toast({ title: "Cash receipt recorded", description: "Receipt generated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reprintMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/receipts/reprint", { receiptId: reprintReceiptId });
      return res.json();
    },
    onSuccess: () => {
      setReprintReceiptId("");
      toast({ title: "Reprint logged", description: "Audit log updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pollIntentMutation = useMutation({
    mutationFn: async (intentId: string) => {
      const res = await apiRequest("POST", `/api/payment-intents/${intentId}/poll`);
      return res.json();
    },
    onMutate: (intentId) => setPollingIntentId(intentId),
    onSettled: () => setPollingIntentId(null),
    onSuccess: (_, intentId) => {
      queryClient.invalidateQueries({ queryKey: QK_PAYMENT_INTENTS });
      queryClient.invalidateQueries({ queryKey: QK_PAYMENTS });
      toast({ title: "Status updated", description: "Payment intent status refreshed." });
    },
    onError: (e: any) => toast({ title: "Poll failed", description: e.message, variant: "destructive" }),
  });

  return (
    <>
      <TabsContent value="paynow">
        <CardSection
          title="Payment intents (Paynow)"
          description="Online collection attempts and manual cash receipt logging."
          icon={Landmark}
          headerRight={!isAgent ? (
              <Button variant="outline" size="sm" onClick={() => { setShowCashReceiptDialog(true); setCashReceiptCurrency("USD"); setCashReceiptNotes(""); }}>
                Record cash receipt
              </Button>
          ) : undefined}
          contentClassName="space-y-4"
        >
            {loadingIntents ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : paymentIntents.length === 0 ? (
              <EmptyState title="No payment intents yet" className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <DataTable>
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Policy</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paymentIntents.map((pi: any) => (
                    <TableRow key={pi.id} className="hover:bg-muted/40">
                      <TableCell className="font-mono text-sm tabular-nums">{pi.policyNumber || getPolicyNumber(pi.policyId)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{pi.currency} {parseFloat(pi.amount || "0").toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant={pi.status === "paid" ? "default" : pi.status === "failed" ? "destructive" : "secondary"}>{pi.status}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{pi.merchantReference || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">{new Date(pi.createdAt).toLocaleString()}</TableCell>
                      <TableCell>
                        {pi.status === "pending_paynow" && (
                          <Button variant="ghost" size="sm" disabled={pollIntentMutation.isPending && pollingIntentId === pi.id} onClick={() => pollIntentMutation.mutate(pi.id)}>
                            {pollingIntentId === pi.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            )}
            <Separator />
            <div className="flex flex-wrap items-center gap-4">
              <Label className="text-sm">Reprint receipt</Label>
              <Input placeholder="Receipt ID" className="max-w-[200px]" value={reprintReceiptId} onChange={(e) => setReprintReceiptId(e.target.value)} />
              <Button variant="outline" size="sm" disabled={!reprintReceiptId || reprintMutation.isPending} onClick={() => reprintMutation.mutate()}>
                {reprintMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Log reprint
              </Button>
            </div>
        </CardSection>
      </TabsContent>

      <PolicyPremiumReceiptDialog
        open={showCashReceiptDialog}
        onOpenChange={setShowCashReceiptDialog}
        policyMode="search"
        policySearchPlaceholder="Search by policy number or client..."
        policySummaryVariant="compact"
        currency={cashReceiptCurrency} onCurrencyChange={setCashReceiptCurrency}
        enablePaynow={false}
        paymentMethod="cash" onPaymentMethodChange={() => {}}
        reference="" onReferenceChange={() => {}}
        notes={cashReceiptNotes} onNotesChange={setCashReceiptNotes}
        receivedAt={cashReceiptReceivedAt} onReceivedAtChange={setCashReceiptReceivedAt}
        onSubmitCash={(payload) => cashReceiptMutation.mutate({
          policyId: payload.policyId, amount: payload.amount, currency: payload.currency,
          notes: payload.notes, receivedAt: payload.receivedAt,
        })}
        isSubmittingCash={cashReceiptMutation.isPending}
        title="Record cash receipt"
        description="Record a manual cash payment and generate a receipt (no Paynow)."
        submitLabel={{ cash: "Record & generate receipt" }}
        submitIcon={null}
      />
    </>
  );
}
