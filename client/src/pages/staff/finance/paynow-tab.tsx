import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
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

function paymentIntentsColumns(opts: {
  getPolicyNumber: (policyId: string) => string;
  pollIntentMutation: { mutate: (id: string) => void; isPending: boolean };
  pollingIntentId: string | null;
}): EdtColumn<any>[] {
  const { getPolicyNumber, pollIntentMutation, pollingIntentId } = opts;
  return [
    { id: "policy", header: "Policy", accessor: (pi) => pi.policyNumber || getPolicyNumber(pi.policyId), cell: (pi) => <span className="font-mono text-sm tabular-nums">{pi.policyNumber || getPolicyNumber(pi.policyId)}</span> },
    { id: "amount", header: "Amount", align: "right", accessor: (pi) => parseFloat(pi.amount || "0"), cell: (pi) => <span className="tabular-nums font-medium">{pi.currency} {parseFloat(pi.amount || "0").toFixed(2)}</span> },
    {
      id: "status",
      header: "Status",
      accessor: (pi) => pi.status,
      cell: (pi) => <Badge variant={pi.status === "paid" ? "default" : pi.status === "failed" ? "destructive" : "secondary"}>{pi.status}</Badge>,
    },
    { id: "reference", header: "Reference", accessor: (pi) => pi.merchantReference || "", cell: (pi) => <span className="font-mono text-xs text-muted-foreground">{pi.merchantReference || "—"}</span> },
    { id: "created", header: "Created", accessor: (pi) => new Date(pi.createdAt), cell: (pi) => <span className="text-sm text-muted-foreground tabular-nums">{new Date(pi.createdAt).toLocaleString()}</span> },
    {
      id: "actions",
      header: "Actions",
      sortable: false,
      exportable: false,
      cell: (pi) =>
        pi.status === "pending_paynow" ? (
          <Button variant="ghost" size="sm" disabled={pollIntentMutation.isPending && pollingIntentId === pi.id} onClick={() => pollIntentMutation.mutate(pi.id)}>
            {pollingIntentId === pi.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          </Button>
        ) : null,
    },
  ];
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
            ) : (
              <EnhancedDataTable
                columns={paymentIntentsColumns({ getPolicyNumber, pollIntentMutation, pollingIntentId })}
                rows={paymentIntents}
                getRowKey={(pi: any) => pi.id}
                exportFilename="payment-intents"
                storageKey="finance-paynow-intents"
                emptyMessage="No payment intents yet."
              />
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
