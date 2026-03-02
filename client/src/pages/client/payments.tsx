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
import { Loader2, CreditCard, CheckCircle, AlertCircle, Receipt, ArrowLeft, Printer } from "lucide-react";
import { printDocument } from "@/lib/print-document";
import { useToast } from "@/hooks/use-toast";
import { openPaymentInSystemBrowser, redirectToAppIfMobileReturn, isNativeMobile } from "@/lib/mobile-payment";

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

  // On mobile: when return URL loads in system browser, redirect back into the app
  useEffect(() => {
    if (returnedFromPaynow) {
      redirectToAppIfMobileReturn("client/payments?returned=1");
    }
  }, [returnedFromPaynow]);

  const [selectedPolicyId, setSelectedPolicyId] = useState(policyIdParam || "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("ecocash");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [currentIntent, setCurrentIntent] = useState<PaymentIntent | null>(null);
  const [polling, setPolling] = useState(false);
  const [payForPhone, setPayForPhone] = useState("");
  const [innbucksCode, setInnbucksCode] = useState("");
  const [innbucksExpiry, setInnbucksExpiry] = useState("");
  const [omariOtp, setOmariOtp] = useState("");
  const [omariOtpRef, setOmariOtpRef] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [lookedUp, setLookedUp] = useState<{ clientName: string; policies: Policy[] } | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");

  const { data: me, isFetched: meFetched, isError: meError } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
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

  const mobileMethods = ["ecocash", "onemoney", "innbucks", "omari"];
  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/client-auth/payment-intents/${currentIntent!.id}/initiate`, {
        method,
        payerPhone: mobileMethods.includes(method) ? payerPhone : undefined,
        payerEmail: method === "visa_mastercard" ? payerEmail : undefined,
      });
      return res.json() as Promise<{
        redirectUrl?: string;
        pollUrl?: string;
        message?: string;
        innbucksCode?: string;
        innbucksExpiry?: string;
        omariOtpReference?: string;
        needsOtp?: boolean;
      }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }

      if (method === "innbucks" && data.innbucksCode) {
        setInnbucksCode(data.innbucksCode);
        setInnbucksExpiry(data.innbucksExpiry || "");
        setPolling(true);
        toast({ title: "InnBucks code ready", description: "Open InnBucks app and enter the code shown below." });
        return;
      }

      if (method === "omari" && data.needsOtp) {
        setNeedsOtp(true);
        setOmariOtpRef(data.omariOtpReference || "");
        toast({ title: "OTP sent", description: "An OTP has been sent to your phone. Enter it below." });
        return;
      }

      if (data.redirectUrl) {
        openPaymentInSystemBrowser(data.redirectUrl);
        setPolling(true);
        return;
      }

      setPolling(true);
      toast({ title: "Pending", description: "Check your phone for the payment prompt. We'll update status shortly." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const otpMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/client-auth/payment-intents/${currentIntent!.id}/otp`, {
        otp: omariOtp,
      });
      return res.json() as Promise<{ paid?: boolean; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      if (data.paid) {
        setNeedsOtp(false);
        setPolling(false);
        qc.invalidateQueries({ queryKey: ["/api/client-auth/payment-intents"] });
        qc.invalidateQueries({ queryKey: ["/api/client-auth/policies"] });
        qc.invalidateQueries({ queryKey: ["/api/client-auth/receipts"] });
        toast({ title: "Payment successful", description: "You can download your receipt below." });
      } else {
        setPolling(true);
        toast({ title: "OTP accepted", description: "Payment is being processed..." });
      }
    },
    onError: (e: Error) => toast({ title: "OTP failed", description: e.message, variant: "destructive" }),
  });

  const { data: paymentStatusData } = useQuery({
    queryKey: ["/api/client-auth/payment-intents", currentIntent?.id, polling],
    queryFn: async () => {
      if (!currentIntent?.id) return null;
      const res = await fetch(getApiBase() + `/api/client-auth/payment-intents/${currentIntent.id}/status`, { credentials: "include" });
      if (!res.ok) return null;
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

  const policy = policies?.find((p) => p.id === selectedPolicyId) ?? lookedUp?.policies?.find((p) => p.id === selectedPolicyId);
  // Enable payments for all statuses; only disable when there is no policy number (e.g. captured clients
  // who don't have an issued policy yet — only clients who self-capture via agent links get a policy number immediately).
  const hasPolicyNumber = policy?.policyNumber != null && String(policy.policyNumber).trim() !== "";
  const canPay = paynowConfig?.enabled && policy && hasPolicyNumber;

  // Effective amount: user input or policy premium when a policy is selected
  const amountStr = typeof amount === "string" ? amount.trim() : "";
  const amountNum = amountStr !== "" ? parseFloat(amount) : (policy?.premiumAmount != null && policy.premiumAmount !== "" ? parseFloat(String(policy.premiumAmount)) : NaN);
  const hasValidAmount = !!policy && Number.isFinite(amountNum) && amountNum >= 0;

  // Default amount to policy premium when policy selection changes
  useEffect(() => {
    if (policy?.premiumAmount != null && policy.premiumAmount !== "") {
      setAmount(String(policy.premiumAmount));
    } else if (!selectedPolicyId) {
      setAmount("");
    }
  }, [selectedPolicyId, policy?.id, policy?.premiumAmount]);

  // Auto-select when only one policy is available so the form is ready immediately
  useEffect(() => {
    if (policies?.length === 1 && !selectedPolicyId) {
      setSelectedPolicyId(policies[0].id);
    }
  }, [policies, selectedPolicyId]);

  // Session guard: show friendly message instead of broken page when not authenticated
  if (meFetched && (meError || !me?.client)) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold">Session Expired</h2>
            <p className="text-muted-foreground">Please sign in again to access your portal.</p>
            <Button onClick={() => setLocation("/client/login")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canInitiatePay = currentIntent && currentIntent.status !== "paid" && !needsOtp && !innbucksCode && (
    method === "visa_mastercard"
      ? (payerEmail && payerEmail.trim().length > 3)
      : mobileMethods.includes(method)
        ? (payerPhone && payerPhone.trim().length >= 9)
        : true
  );

  const handleLookupByPhone = async () => {
    const phone = payForPhone.trim();
    if (!phone || phone.length < 9) {
      setLookupError("Enter a valid phone number");
      return;
    }
    setLookupError("");
    setLookupLoading(true);
    try {
      const base = getApiBase();
      const res = await fetch(base + `/api/client-auth/lookup-by-phone?phone=${encodeURIComponent(phone)}`, { credentials: "include" });
      const data = await res.json();
      if (!res.ok) {
        setLookedUp(null);
        setLookupError(data.message || "Lookup failed");
        return;
      }
      setLookedUp({ clientName: data.clientName, policies: data.policies });
      if (data.policies?.length === 1) setSelectedPolicyId(data.policies[0].id);
      else if (data.policies?.length > 0) setSelectedPolicyId(data.policies[0].id);
      else setSelectedPolicyId("");
    } finally {
      setLookupLoading(false);
    }
  };

  const showPayForOther = lookedUp !== undefined;
  const effectivePolicies = lookedUp ? (lookedUp?.policies ?? []) : (policies ?? []);
  const isPayingForOther = lookedUp !== null && lookedUp !== undefined;
  const displayPolicies = isPayingForOther ? (lookedUp?.policies ?? []) : (policies ?? []);

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
              {isNativeMobile() && (
                <span className="block mt-2 text-primary font-medium">On this device you’ll complete payment in your browser, then return to the app.</span>
              )}
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
                  {displayPolicies?.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.policyNumber} — {p.status} — {p.currency} {p.premiumAmount}
                      {isPayingForOther && lookedUp?.clientName ? ` (${lookedUp.clientName})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {isPayingForOther && lookedUp?.clientName && (
                <p className="text-xs text-muted-foreground mt-1">Paying for {lookedUp.clientName}. Look up expires in 5 minutes.</p>
              )}
            </div>

            <div className="space-y-2 rounded-lg border p-3 bg-muted/40">
              <Label>Pay for someone else</Label>
              <p className="text-xs text-muted-foreground">Enter the client&apos;s phone number to find their policies and pay on their behalf.</p>
              <div className="flex gap-2">
                <Input
                  placeholder="e.g. 0771234567"
                  value={payForPhone}
                  onChange={(e) => { setPayForPhone(e.target.value); setLookupError(""); }}
                />
                <Button type="button" variant="secondary" onClick={handleLookupByPhone} disabled={lookupLoading}>
                  {lookupLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
                </Button>
              </div>
              {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
              {lookedUp && lookedUp.clientName && (
                <p className="text-sm text-green-700">Found: {lookedUp.clientName}. Select their policy above.</p>
              )}
              {lookedUp && (
                <Button type="button" variant="ghost" size="sm" onClick={() => { setLookedUp(null); setLookupError(""); setSelectedPolicyId(policies?.[0]?.id ?? ""); }}>
                  Show my policies instead
                </Button>
              )}
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
              <Select value={method} onValueChange={(v) => { setMethod(v); setInnbucksCode(""); setNeedsOtp(false); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="omari">O'Mari</SelectItem>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(method === "ecocash" || method === "onemoney") && (
              <div>
                <Label>Mobile number</Label>
                <Input placeholder="0771234567" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">A USSD prompt will be sent to your phone. Enter your PIN to approve the payment.</p>
              </div>
            )}
            {method === "innbucks" && (
              <div>
                <Label>Mobile number</Label>
                <Input placeholder="0771234567" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">You will receive an authorization code. Open the InnBucks app and enter the code to approve.</p>
              </div>
            )}
            {method === "omari" && (
              <div>
                <Label>Mobile number</Label>
                <Input placeholder="0771234567" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">An OTP will be sent to your phone via SMS. You will need to enter it below to complete the payment.</p>
              </div>
            )}
            {method === "visa_mastercard" && (
              <div>
                <Label>Email address</Label>
                <Input type="email" placeholder="you@example.com" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
                <p className="text-xs text-muted-foreground mt-1">You will be redirected to Paynow's secure payment page to enter your card details.</p>
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

                {innbucksCode && (
                  <div className="p-4 rounded-lg border-2 border-blue-300 bg-blue-50 space-y-3">
                    <p className="font-semibold text-blue-900">InnBucks Authorization Code</p>
                    <p className="text-3xl font-mono font-bold text-center tracking-widest text-blue-800">{innbucksCode}</p>
                    {innbucksExpiry && (
                      <p className="text-xs text-blue-700 text-center">Expires: {innbucksExpiry}</p>
                    )}
                    <div className="space-y-2 text-sm text-blue-800">
                      <p className="font-medium">How to complete payment:</p>
                      <ol className="list-decimal list-inside space-y-1">
                        <li>Open the <strong>InnBucks</strong> app on your phone</li>
                        <li>Go to <strong>Payments</strong></li>
                        <li>Enter the authorization code shown above</li>
                        <li>Confirm the payment</li>
                      </ol>
                    </div>
                    <a
                      href={`schinn.wbpycode://innbucks.co.zw?pymInnCode=${innbucksCode}`}
                      className="block text-center text-sm font-medium text-blue-700 underline"
                    >
                      Open InnBucks app directly
                    </a>
                    {polling && (
                      <div className="flex items-center justify-center gap-2 text-sm text-blue-700">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Waiting for payment confirmation...
                      </div>
                    )}
                  </div>
                )}

                {needsOtp && (
                  <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3">
                    <p className="font-semibold text-amber-900">Enter O'Mari OTP</p>
                    <p className="text-sm text-amber-800">An OTP has been sent to your phone via SMS. Enter it below to complete payment.</p>
                    {omariOtpRef && (
                      <p className="text-xs text-amber-700">Reference: {omariOtpRef}</p>
                    )}
                    <Input
                      placeholder="Enter OTP"
                      value={omariOtp}
                      onChange={(e) => setOmariOtp(e.target.value)}
                      maxLength={10}
                      className="text-center text-lg font-mono tracking-widest"
                    />
                    <Button
                      className="w-full"
                      disabled={!omariOtp || omariOtp.trim().length < 4 || otpMutation.isPending}
                      onClick={() => otpMutation.mutate()}
                    >
                      {otpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Verify OTP
                    </Button>
                  </div>
                )}

                {currentIntent.status !== "paid" && !innbucksCode && !needsOtp && (
                  <Button
                    className="w-full"
                    disabled={!canInitiatePay || initiateMutation.isPending || polling}
                    onClick={() => initiateMutation.mutate()}
                  >
                    {initiateMutation.isPending || polling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {polling ? "Waiting for approval…" : "Pay now"}
                  </Button>
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
                <div className="flex items-center gap-2">
                  <a
                    href={`${base}/api/client-auth/receipts/${r.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline"
                  >
                    Download PDF
                  </a>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1 text-xs"
                    onClick={() => printDocument(`${base}/api/client-auth/receipts/${r.id}/download`)}
                  >
                    <Printer className="h-3.5 w-3.5" />
                    Print
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
