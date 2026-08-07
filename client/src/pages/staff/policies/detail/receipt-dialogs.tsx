import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { PolicyPremiumReceiptDialog } from "@/components/policy-premium-receipt-dialog";
import { CheckCircle2, FileText, ScrollText, Printer, Download, Share2, Copy, Send, Loader2 } from "lucide-react";

interface UseReceiptDialogsArgs {
  selectedPolicy: any;
  displayPolicy: any;
  isAgent: boolean;
  canEditPremium: boolean;
  principalPhone: string;
}

/**
 * Hook-plus-JSX bundle (mirrors finance/shared-dialogs.tsx's usePayDialog pattern) for the
 * detail-view "Receipt payment" flow (cash + Paynow, with OTP + polling), the ReceiptSuccess /
 * receipt-viewer dialog, and the "Send Payment Link" dialog. Instantiated once in
 * policy-detail-view.tsx; `openReceiptView` is also threaded down to payments-tab.tsx so its
 * receipt table's View/Thermal buttons can open the same viewer.
 */
export function useReceiptDialogs({ selectedPolicy, displayPolicy, isAgent, canEditPremium, principalPhone }: UseReceiptDialogsArgs) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showInPolicyReceiptDialog, setShowInPolicyReceiptDialog] = useState(false);
  const [inPolicyReceiptIdempotencyKey, setInPolicyReceiptIdempotencyKey] = useState(() => crypto.randomUUID());
  const [inPolicyReceiptMethod, setInPolicyReceiptMethod] = useState("cash");
  const [inPolicyReceiptCurrency, setInPolicyReceiptCurrency] = useState("USD");
  const [inPolicyReceiptRef, setInPolicyReceiptRef] = useState("");
  const [inPolicyReceiptNotes, setInPolicyReceiptNotes] = useState("");
  const [inPolicyReceiptMonths, setInPolicyReceiptMonths] = useState(1);
  const [inPolicyReceiptAmountOverride, setInPolicyReceiptAmountOverride] = useState<string | null>(null);
  const [inPolicyReceiptSubmitterNote, setInPolicyReceiptSubmitterNote] = useState("");

  const [showPaymentLinkDialog, setShowPaymentLinkDialog] = useState(false);
  const [paymentLinkAmount, setPaymentLinkAmount] = useState("");
  const [paymentLinkMethod, setPaymentLinkMethod] = useState("ecocash");
  const [generatedPaymentLink, setGeneratedPaymentLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const [pnIntentId, setPnIntentId] = useState<string | null>(null);
  const [pnPolling, setPnPolling] = useState(false);
  const [pnPollStartTime, setPnPollStartTime] = useState<number>(0);
  const [pnPollError, setPnPollError] = useState<string | null>(null);

  const [showReceiptSuccess, setShowReceiptSuccess] = useState(false);
  const [receiptSuccessData, setReceiptSuccessData] = useState<any>(null);
  const [receiptViewFormat, setReceiptViewFormat] = useState<"a4" | "thermal48" | "thermal58" | "thermal80">("a4");

  const openInPolicyReceipt = () => {
    setInPolicyReceiptMethod(isAgent ? "ecocash" : "cash");
    setInPolicyReceiptCurrency(displayPolicy.currency || "USD");
    setInPolicyReceiptRef(principalPhone);
    setInPolicyReceiptNotes("");
    // Fresh per attempt — a stable key for this one dialog session so a double-click or a
    // retried request collapses onto the same payment instead of posting twice (server
    // enforces this via a unique constraint).
    setInPolicyReceiptIdempotencyKey(crypto.randomUUID());
    setShowInPolicyReceiptDialog(true);
  };

  const openPaymentLinkDialog = () => {
    setPaymentLinkAmount(displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount).toFixed(2) : "");
    setPaymentLinkMethod("ecocash");
    setGeneratedPaymentLink(null);
    setShowPaymentLinkDialog(true);
  };

  const openReceiptView = (data: { viewOnly: true; receiptId: string; receiptNumber: string }, format: "a4" | "thermal48" | "thermal58" | "thermal80") => {
    setReceiptViewFormat(format);
    setReceiptSuccessData(data);
    setShowReceiptSuccess(true);
  };

  const resetPnState = () => {
    setPnIntentId(null); setPnPolling(false); setPnPollStartTime(0); setPnPollError(null);
    setInPolicyReceiptMethod("cash"); setInPolicyReceiptRef(""); setInPolicyReceiptNotes(""); setInPolicyReceiptMonths(1);
    setInPolicyReceiptAmountOverride(null); setInPolicyReceiptSubmitterNote("");
    setInPolicyReceiptIdempotencyKey(crypto.randomUUID());
  };

  const inPolicyReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      if (selectedPolicy) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "payments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
      }
      setShowInPolicyReceiptDialog(false);
      resetPnState();
      if (data?.pendingApproval) {
        toast({ title: "Submitted for approval", description: `Receipt ${data.receipt?.receiptNumber ?? ""} won't apply to the policy until a manager approves the amount.` });
      } else if (data?.receipt?.id) {
        setReceiptSuccessData({ ...data, receipt: data.receipt, policyNumber: displayPolicy?.policyNumber });
        setShowReceiptSuccess(true);
      } else {
        toast({ title: "Payment recorded", description: "Receipt generated successfully." });
      }
    },
    onError: (err: Error) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  const pnInitiateMutation = useMutation({
    mutationFn: async (ctx: { policyId: string; clientId?: string; amount: string; currency: string; method: string; reference: string }) => {
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: ctx.policyId, clientId: ctx.clientId, amount: ctx.amount, currency: ctx.currency, purpose: "premium",
      });
      const intent = await intentRes.json();
      if (intent.message) throw new Error(intent.message);
      setPnIntentId(intent.id);
      setPnPollStartTime(Date.now());
      setPnPollError(null);
      const initRes = await apiRequest("POST", `/api/payment-intents/${intent.id}/initiate`, {
        method: ctx.method,
        payerPhone: ["ecocash", "onemoney", "innbucks", "omari"].includes(ctx.method) ? ctx.reference : undefined,
        payerEmail: ctx.method === "visa_mastercard" ? ctx.reference : undefined,
      });
      const data = await initRes.json() as {
        redirectUrl?: string; pollUrl?: string; message?: string;
        innbucksCode?: string; innbucksExpiry?: string;
        omariOtpReference?: string; needsOtp?: boolean;
      };
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
      } else if (ctx.method === "innbucks" && data.innbucksCode) {
        toast({ title: "InnBucks code ready" });
      } else if (ctx.method === "omari" && data.needsOtp) {
        toast({ title: "OTP sent", description: "Ask the client for the OTP." });
      } else if (data.redirectUrl) {
        window.open(data.redirectUrl, "_blank");
        toast({ title: "Card payment page opened" });
      } else {
        toast({ title: "USSD sent", description: "Client should receive a prompt on their phone." });
      }
      return data;
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const pnOtpMutation = useMutation({
    mutationFn: async (otp: string) => {
      if (!pnIntentId) throw new Error("No intent");
      const res = await apiRequest("POST", `/api/payment-intents/${pnIntentId}/otp`, { otp });
      const data = await res.json() as { paid?: boolean; message?: string };
      if (data.message) {
        toast({ title: "OTP error", description: data.message, variant: "destructive" });
      } else if (data.paid) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        if (selectedPolicy) queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
        setShowInPolicyReceiptDialog(false); resetPnState();
        setReceiptSuccessData({ paynow: true, policyId: selectedPolicy?.id, policyNumber: displayPolicy?.policyNumber });
        setShowReceiptSuccess(true);
      } else {
        toast({ title: "OTP accepted", description: "Processing..." });
      }
      return data;
    },
    onError: (e: Error) => toast({ title: "OTP failed", description: e.message, variant: "destructive" }),
  });

  const createPaymentLinkMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPolicy) throw new Error("No policy");
      const res = await apiRequest("POST", `/api/policies/${selectedPolicy.id}/payment-links`, {
        amount: paymentLinkAmount,
        method: paymentLinkMethod,
      });
      return res.json() as Promise<{ token: string; expiresAt: string }>;
    },
    onSuccess: (link) => {
      setGeneratedPaymentLink({ url: `${window.location.origin}/pay/policy/${link.token}`, expiresAt: link.expiresAt });
      toast({ title: "Payment link created" });
    },
    onError: (e: Error) => toast({ title: "Could not create payment link", description: e.message, variant: "destructive" }),
  });

  const { data: pnPollData } = useQuery({
    queryKey: ["pn-poll-policy", pnIntentId],
    queryFn: async () => {
      if (!pnIntentId) return null;
      const res = await apiRequest("POST", `/api/payment-intents/${pnIntentId}/poll`, {});
      return res.json() as Promise<{ status: string; paid?: boolean; error?: string; paynowStatus?: string }>;
    },
    enabled: !!pnIntentId && pnPolling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!pnPollData) return;
    if (pnPollData.paid || pnPollData.status === "paid") {
      setPnPolling(false);
      setPnPollError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      if (selectedPolicy) queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
      setShowInPolicyReceiptDialog(false); resetPnState();
      setReceiptSuccessData({ paynow: true, policyId: selectedPolicy?.id, policyNumber: displayPolicy?.policyNumber });
      setShowReceiptSuccess(true);
      return;
    }
    if (pnPollData.status === "failed") {
      setPnPolling(false);
      toast({ title: "Payment failed", description: "The payment was declined or cancelled.", variant: "destructive" });
      return;
    }
    if (pnPollData.error) {
      setPnPollError(pnPollData.error);
    }
    const PN_POLL_TIMEOUT_MS = 5 * 60 * 1000;
    if (pnPollStartTime && Date.now() - pnPollStartTime > PN_POLL_TIMEOUT_MS) {
      setPnPolling(false);
      toast({
        title: "Payment confirmation timed out",
        description: "If the money was deducted, the payment will be recorded automatically once the gateway confirms. Check back shortly.",
        variant: "destructive",
      });
    }
  }, [pnPollData]);

  const node = (
    <>
      <PolicyPremiumReceiptDialog
        open={showInPolicyReceiptDialog}
        onOpenChange={(open) => { setShowInPolicyReceiptDialog(open); if (!open) resetPnState(); }}
        policyMode="fixed"
        policy={displayPolicy}
        policySummaryVariant="none"
        currency={inPolicyReceiptCurrency} onCurrencyChange={setInPolicyReceiptCurrency}
        months={inPolicyReceiptMonths} onMonthsChange={setInPolicyReceiptMonths} showMonths
        allowAmountOverride={canEditPremium}
        amountOverride={inPolicyReceiptAmountOverride} onAmountOverrideChange={setInPolicyReceiptAmountOverride}
        submitterNote={inPolicyReceiptSubmitterNote} onSubmitterNoteChange={setInPolicyReceiptSubmitterNote}
        enablePaynow isAgent={isAgent}
        paymentMethod={inPolicyReceiptMethod} onPaymentMethodChange={setInPolicyReceiptMethod}
        reference={inPolicyReceiptRef} onReferenceChange={setInPolicyReceiptRef}
        notes={inPolicyReceiptNotes} onNotesChange={setInPolicyReceiptNotes}
        onSubmitCash={(payload) => inPolicyReceiptMutation.mutate({
          policyId: payload.policyId,
          clientId: payload.clientId,
          amount: payload.amount,
          months: payload.months,
          currency: payload.currency,
          paymentMethod: inPolicyReceiptMethod,
          status: "cleared",
          reference: payload.reference,
          notes: payload.notes,
          submitterNote: payload.submitterNote,
          idempotencyKey: inPolicyReceiptIdempotencyKey,
        })}
        isSubmittingCash={inPolicyReceiptMutation.isPending}
        onInitiatePaynow={(ctx) => pnInitiateMutation.mutateAsync(ctx).catch((e: Error) => ({ message: e.message }))}
        isInitiatingPaynow={pnInitiateMutation.isPending}
        onVerifyOtp={(otp) => pnOtpMutation.mutateAsync(otp).catch((e: Error) => ({ message: e.message }))}
        isVerifyingOtp={pnOtpMutation.isPending}
        pollStatus={pnPollData ? { paid: pnPollData.paid, status: pnPollData.status, error: pnPollError ?? undefined, paynowStatus: pnPollData.paynowStatus } : null}
        isPolling={pnPolling}
        onIsPollingChange={setPnPolling}
        pollTimedOut={!pnPolling && pnPollStartTime > 0}
        onRetryPolling={() => { setPnPolling(true); setPnPollStartTime(Date.now()); setPnPollError(null); }}
        onValidationError={(title, description) => toast({ title, description, variant: "destructive" })}
        title="Receipt Payment"
        description={<>Record a payment for policy <strong>{displayPolicy?.policyNumber}</strong></>}
        submitLabel={{ cash: "Record Payment" }}
      />

      {/* Send Payment Link */}
      <Dialog open={showPaymentLinkDialog} onOpenChange={(open) => { setShowPaymentLinkDialog(open); if (!open) setGeneratedPaymentLink(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Send Payment Link</DialogTitle>
            <DialogDescription>The client opens this link on their own phone and pays directly — no staff needed. Expires in 48 hours, single-use, USD only.</DialogDescription>
          </DialogHeader>
          {!generatedPaymentLink ? (
            <div className="space-y-4">
              <div>
                <Label htmlFor="payment-link-amount">Amount (USD)</Label>
                <Input id="payment-link-amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={paymentLinkAmount}
                  onChange={(e) => setPaymentLinkAmount(e.target.value)}
                  data-testid="input-payment-link-amount"
                />
              </div>
              <div>
                <Label htmlFor="payment-link-method">Payment Method</Label>
                <Select value={paymentLinkMethod} onValueChange={setPaymentLinkMethod}>
                  <SelectTrigger id="payment-link-method" data-testid="select-payment-link-method"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ecocash">EcoCash</SelectItem>
                    <SelectItem value="onemoney">OneMoney</SelectItem>
                    <SelectItem value="innbucks">InnBucks</SelectItem>
                    <SelectItem value="omari">O'Mari</SelectItem>
                    <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">Cash isn't available for payment links — it can't be collected remotely.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 break-all text-sm font-mono" data-testid="text-payment-link-url">{generatedPaymentLink.url}</div>
              <p className="text-xs text-muted-foreground">Expires {new Date(generatedPaymentLink.expiresAt).toLocaleString()}</p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => { navigator.clipboard.writeText(generatedPaymentLink.url); toast({ title: "Link copied" }); }}
                  data-testid="btn-copy-payment-link"
                >
                  <Copy className="h-4 w-4" /> Copy Link
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(`Please use this link to complete your payment: ${generatedPaymentLink.url}`)}`, "_blank")}
                  data-testid="btn-whatsapp-payment-link"
                >
                  <Share2 className="h-4 w-4" /> WhatsApp
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowPaymentLinkDialog(false)}>{generatedPaymentLink ? "Done" : "Cancel"}</Button>
            {!generatedPaymentLink && (
              <Button
                onClick={() => createPaymentLinkMutation.mutate()}
                disabled={!paymentLinkAmount || parseFloat(paymentLinkAmount) <= 0 || createPaymentLinkMutation.isPending}
                data-testid="btn-generate-payment-link"
              >
                {createPaymentLinkMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Send className="h-4 w-4 mr-2" /> Generate Link
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReceiptSuccess} onOpenChange={(open) => { setShowReceiptSuccess(open); if (!open) setReceiptViewFormat("a4"); }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              {receiptSuccessData?.viewOnly ? "Receipt" : "Payment Successful"}
            </DialogTitle>
            <DialogDescription>
              {receiptSuccessData?.viewOnly
                ? `Viewing receipt ${receiptSuccessData?.receiptNumber || ""}`
                : `Payment has been recorded for policy ${receiptSuccessData?.policyNumber || ""}.`
              }
            </DialogDescription>
          </DialogHeader>
          {receiptSuccessData && (() => {
            const receiptId = receiptSuccessData.viewOnly
              ? receiptSuccessData.receiptId
              : receiptSuccessData.receipt?.id;
            if (!receiptId) return (
              <div className="text-center py-4 text-muted-foreground">
                {receiptSuccessData.paynow ? "Paynow payment processed. Receipt will appear shortly." : "No receipt ID available."}
              </div>
            );
            const thermalSize = receiptViewFormat === "thermal48" ? "48" : receiptViewFormat === "thermal58" ? "58" : "80";
            const isThermal = receiptViewFormat !== "a4";
            const iframeSrc = isThermal
              ? getApiBase() + `/api/receipts/${receiptId}/view?format=thermal&size=${thermalSize}`
              : getApiBase() + `/api/receipts/${receiptId}/view`;
            const receiptDownloadUrl = getApiBase() + `/api/receipts/${receiptId}/download`;
            const receiptDownloadThermalUrl = getApiBase() + `/api/receipts/${receiptId}/download?format=thermal&size=${thermalSize}`;
            const iframeH = isThermal ? "h-[600px]" : "h-[480px]";
            return (
              <div className="space-y-3">
                {/* Format toggle */}
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground mr-1">Format:</span>
                  <Button size="sm" variant={receiptViewFormat === "a4" ? "default" : "outline"} className="h-7 text-xs gap-1.5" onClick={() => setReceiptViewFormat("a4")}>
                    <FileText className="h-3 w-3" /> A4
                  </Button>
                  <Button size="sm" variant={receiptViewFormat === "thermal48" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal48")}>
                    <ScrollText className="h-3 w-3" /> 48mm
                  </Button>
                  <Button size="sm" variant={receiptViewFormat === "thermal58" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal58")}>
                    <ScrollText className="h-3 w-3" /> 58mm
                  </Button>
                  <Button size="sm" variant={receiptViewFormat === "thermal80" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal80")}>
                    <ScrollText className="h-3 w-3" /> 80mm
                  </Button>
                </div>
                {/* Inline PDF viewer */}
                <div className="border rounded-md overflow-hidden bg-muted/30">
                  <iframe
                    key={iframeSrc}
                    title="Receipt Preview"
                    src={iframeSrc}
                    className={`w-full ${iframeH}`}
                  />
                </div>
                <div className="flex justify-between gap-2 flex-wrap">
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printDocument(iframeSrc)}>
                      <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(isThermal ? receiptDownloadThermalUrl : receiptDownloadUrl, "_blank", "noopener")}>
                      <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                      const num = receiptSuccessData.receipt?.receiptNumber || receiptSuccessData.receiptNumber || "";
                      shareDocument(isThermal ? receiptDownloadThermalUrl : receiptDownloadUrl, `Receipt-${num}`);
                    }}>
                      <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> Share
                    </Button>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => { setShowReceiptSuccess(false); setReceiptSuccessData(null); }}>
                    Close
                  </Button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </>
  );

  return { openInPolicyReceipt, openPaymentLinkDialog, openReceiptView, node };
}
