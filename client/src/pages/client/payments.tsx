/**
 * Client payment page: create intent, choose method, initiate Paynow, poll status, download receipt.
 * Paynow Integration Key is never sent to client; all initiation is server-side.
 */

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CreditCard, CheckCircle, AlertCircle, Receipt, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface PaymentIntent {
  id: string;
  policyId: string;
  amount: string;
  currency: string;
  purpose: string;
  status: string;
  merchantReference: string;
  paynowRedirectUrl: string | null;
}

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
}

export default function ClientPayments() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const qc = useQueryClient();
  const { toast } = useToast();
  const params = new URLSearchParams(search || "");
  const policyIdParam = params.get("policyId");
  const returnedFromPaynow = params.get("returned") === "1";

  useEffect(() => {
    if (returnedFromPaynow) {
      toast({ title: "Returned from payment", description: "If you completed payment, status will update below. You can also download your receipt when ready." });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/payment-intents"] });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/receipts"] });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/policies"] });
    }
  }, [returnedFromPaynow, toast, qc]);

  const [selectedPolicyId, setSelectedPolicyId] = useState(policyIdParam || "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("visa_mastercard");
  const [payerPhone, setPayerPhone] = useState("");
  const [currentIntent, setCurrentIntent] = useState<PaymentIntent | null>(null);
  const [polling, setPolling] = useState(false);

  const { data: me } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies } = useQuery<Policy[]>({ queryKey: ["/api/client-auth/policies"], enabled: !!me?.client });
  const { data: paynowConfig } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/client-auth/paynow-config"], retry: false });

  const createIntentMutation = useMutation({
    mutationFn: async () => {
      const idempotencyKey = `client-${me?.client?.id}-${selectedPolicyId}-${Date.now()}`;
      const res = await apiRequest("POST", "/api/client-auth/payment-intents", {
        policyId: selectedPolicyId,
        amount: amount || (policies?.find((p) => p.id === selectedPolicyId)?.premiumAmount ?? "0"),
        purpose: "premium",
        idempotencyKey,
      });
      return res.json() as Promise<{ intent: PaymentIntent; created: boolean; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      setCurrentIntent(data.intent);
      if (data.intent.status === "paid") {
        toast({ title: "Already paid", description: "This payment was already completed." });
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/client-auth/payment-intents/${currentIntent!.id}/initiate`, {
        method,
        payerPhone: method === "ecocash" || method === "onemoney" ? payerPhone : undefined,
      });
      return res.json() as Promise<{ redirectUrl?: string; pollUrl?: string; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setPolling(true);
      toast({ title: "Pending", description: "Check your phone for USSD prompt. We'll update status shortly." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: paymentStatusData } = useQuery({
    queryKey: ["/api/client-auth/payment-intents", currentIntent?.id, polling],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/client-auth/payment-intents/${currentIntent!.id}/status`, { credentials: "include" });
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!currentIntent?.id && polling && currentIntent?.status !== "paid",
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    const d = paymentStatusData;
    if (!d) return;
    if (d.paid || d.status === "paid") {
      setPolling(false);
      qc.invalidateQueries({ queryKey: ["/api/client-auth/payment-intents"] });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/policies"] });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/receipts"] });
      toast({ title: "Payment successful", description: "You can download your receipt below." });
    }
    if (d.status === "failed") setPolling(false);
  }, [paymentStatusData, qc, toast]);

  const policy = policies?.find((p) => p.id === selectedPolicyId);
  const canPay = paynowConfig?.enabled && policy && (["active", "grace", "reinstatement_pending", "pending"].includes(policy.status) || policy.status === "lapsed");

  const amountNum = typeof amount === "string" ? parseFloat(amount) : NaN;
  const hasValidAmount = typeof amount === "string" && amount.trim() !== "" && Number.isFinite(amountNum) && amountNum > 0;

  // Default amount to policy premium when policy selection changes
  useEffect(() => {
    if (policy?.premiumAmount) setAmount(policy.premiumAmount);
    else if (!selectedPolicyId) setAmount("");
  }, [selectedPolicyId, policy?.id, policy?.premiumAmount]);

  // For Pay now: require phone when method is ecocash/onemoney
  const canInitiatePay = currentIntent && currentIntent.status !== "paid" && (method !== "ecocash" && method !== "onemoney" || (payerPhone && payerPhone.trim().length >= 9));

  return (
    <ClientLayout clientName="">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client")}>
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              Pay premium
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Choose your policy, amount, and payment method. You will be redirected to Paynow or receive a USSD prompt.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {!paynowConfig?.enabled && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-center gap-2 text-amber-800 text-sm">
                <AlertCircle className="h-4 w-4 shrink-0" />
                Online payment is not configured. Please pay at your nearest branch.
              </div>
            )}

            <div>
              <Label>Policy</Label>
              <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
                <SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger>
                <SelectContent>
                  {policies?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.policyNumber} — {p.status} — {p.currency} {p.premiumAmount}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                placeholder={policy ? `${policy.currency} ${policy.premiumAmount}` : "Amount"}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div>
              <Label>Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="onemoney">One Money</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="omari">O Mari</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(method === "ecocash" || method === "onemoney") && (
              <div>
                <Label>Mobile number</Label>
                <Input
                  placeholder="0771234567"
                  value={payerPhone}
                  onChange={(e) => setPayerPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground mt-1">A USSD prompt will appear; enter PIN to approve.</p>
              </div>
            )}

            {!currentIntent ? (
              <Button
                className="w-full"
                disabled={!canPay || createIntentMutation.isPending || !hasValidAmount}
                onClick={() => createIntentMutation.mutate()}
              >
                {createIntentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Continue to payment
              </Button>
            ) : (
              <>
                {currentIntent.status === "paid" && (
                  <div className="p-3 rounded-lg bg-green-50 border border-green-200 flex items-center gap-2 text-green-800">
                    <CheckCircle className="h-4 w-4" />
                    This payment was already completed.
                  </div>
                )}
                {currentIntent.status !== "paid" && (
                  <>
                    <div>
                      <Label>Payment method</Label>
                      <Select value={method} onValueChange={setMethod}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                          <SelectItem value="ecocash">EcoCash</SelectItem>
                          <SelectItem value="onemoney">One Money</SelectItem>
                          <SelectItem value="innbucks">InnBucks</SelectItem>
                          <SelectItem value="omari">O Mari</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {(method === "ecocash" || method === "onemoney") && (
                      <div>
                        <Label>Mobile number</Label>
                        <Input
                          placeholder="0771234567"
                          value={payerPhone}
                          onChange={(e) => setPayerPhone(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground mt-1">A USSD prompt will appear; enter PIN to approve.</p>
                      </div>
                    )}
                    <Button
                      className="w-full"
                      disabled={!canInitiatePay || initiateMutation.isPending || polling}
                      onClick={() => initiateMutation.mutate()}
                    >
                      {initiateMutation.isPending || polling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      {polling ? "Waiting for approval…" : "Pay now"}
                    </Button>
                  </>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <ReceiptsList />
      </div>
    </ClientLayout>
  );
}

function ReceiptsList() {
  const { data: receipts } = useQuery<{ id: string; receiptNumber: string; amount: string; currency: string; issuedAt: string }[]>({
    queryKey: ["/api/client-auth/receipts"],
    retry: false,
  });
  const base = getApiBase();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-5 w-5" />
          My receipts
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!receipts || receipts.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">No receipts yet.</p>
        ) : (
          <ul className="space-y-2">
            {receipts.map((r) => (
              <li key={r.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div>
                  <p className="font-medium text-sm">Receipt #{r.receiptNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.currency} {r.amount} — {new Date(r.issuedAt).toLocaleString()}
                  </p>
                </div>
                <a
                  href={`${base}/api/client-auth/receipts/${r.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline"
                >
                  Download PDF
                </a>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
