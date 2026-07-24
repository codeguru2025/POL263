import { useEffect, useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Loader2, Receipt } from "lucide-react";
import { PolicySearchInput } from "@/components/policy-search-input";
import { CurrencySelect } from "@/components/currency-select";
import { getApiBase } from "@/lib/queryClient";
import { formatAmount } from "@shared/validation";

/**
 * Shared "receipt a policy premium payment" dialog — merges what were 3 near-duplicate dialogs
 * (finance.tsx's "Receipt a Policy Payment" and "Record cash receipt", policies.tsx's "Receipt
 * Payment"). Every mutation stays parent-owned (matches mortuary.tsx's RecordPaymentDialog
 * convention) — this component owns only form-field UI state, the policy-search enrichment
 * fetch, and PayNow phase bookkeeping (select/waiting, OTP input, InnBucks display).
 *
 * Behavioral asymmetries between the 3 original dialogs are preserved via props rather than
 * unified, on purpose (see the plan file this was built from): #1 has no PayNow poll timeout,
 * #3 does; #3 shows a gateway-status-aware waiting message, #1/#2 don't (both driven purely by
 * what the parent chooses to put in `pollStatus`/`pollTimedOut`, not by branching in here).
 */

export interface PolicyLike {
  id: string;
  policyNumber?: string;
  clientId?: string;
  status?: string;
  premiumAmount?: string | number | null;
  premiumCurrency?: string;
}

export interface PaynowInitiateResult {
  redirectUrl?: string;
  message?: string;
  innbucksCode?: string;
  innbucksExpiry?: string;
  omariOtpReference?: string;
  needsOtp?: boolean;
}

export interface PaynowVerifyOtpResult {
  paid?: boolean;
  message?: string;
}

export interface PolicyPollStatus {
  paid?: boolean;
  status?: string;
  error?: string;
  /** Only set by callers that want the gateway-status-aware "Payment received — recording
   *  transaction..." waiting message (policies.tsx's dialog did; finance.tsx's didn't). */
  paynowStatus?: string;
}

export interface PolicyPremiumReceiptDialogTestIds {
  policySearch?: string;
  policySummary?: string;
  amount?: string;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  submit?: string;
}

export interface PolicyPremiumReceiptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;

  policyMode: "search" | "fixed";
  /** Required when policyMode === "fixed". Ignored (internally resolved) in "search" mode. */
  policy?: PolicyLike | null;
  policySearchPlaceholder?: string;
  /** Fires whenever the resolved (premium-enriched) policy changes, including back to null on
   *  reset — lets the parent read clientId/premiumAmount for its own mutation payloads. */
  onPolicyResolved?: (policy: PolicyLike | null) => void;
  policySummaryVariant?: "card" | "compact" | "none";
  getClientLabel?: (clientId: string) => string | null;

  currency: string;
  onCurrencyChange: (v: string) => void;
  months?: number;
  onMonthsChange?: (v: number) => void;
  showMonths?: boolean;

  allowAmountOverride?: boolean;
  amountOverride?: string | null;
  onAmountOverrideChange?: (v: string | null) => void;
  submitterNote?: string;
  onSubmitterNoteChange?: (v: string) => void;

  enablePaynow: boolean;
  isAgent?: boolean;
  paymentMethod: string;
  onPaymentMethodChange: (v: string) => void;
  reference: string;
  onReferenceChange: (v: string) => void;
  notes: string;
  onNotesChange: (v: string) => void;

  /** Cash-only mode (no PayNow) extra field. */
  receivedAt?: string;
  onReceivedAtChange?: (v: string) => void;

  onSubmitCash: (payload: {
    policyId: string;
    clientId?: string;
    amount: string;
    currency: string;
    months?: number;
    paymentMethod?: string;
    reference?: string;
    notes?: string;
    submitterNote?: string;
    receivedAt?: string;
  }) => void;
  isSubmittingCash: boolean;

  onInitiatePaynow?: (ctx: {
    policyId: string;
    clientId?: string;
    amount: string;
    currency: string;
    method: string;
    reference: string;
  }) => Promise<PaynowInitiateResult>;
  isInitiatingPaynow?: boolean;
  onVerifyOtp?: (otp: string) => Promise<PaynowVerifyOtpResult>;
  isVerifyingOtp?: boolean;
  pollStatus?: PolicyPollStatus | null;
  isPolling?: boolean;
  onIsPollingChange?: (v: boolean) => void;
  pollTimedOut?: boolean;
  onRetryPolling?: () => void;

  /** Fired for a click-time validation failure the disabled-button state doesn't already cover
   *  (currently: non-cash reference under 5 chars for innbucks/omari/visa_mastercard, which
   *  the disabled condition doesn't gate on — only ecocash/onemoney's digit-count does). Parent
   *  is expected to toast it; the dialog itself never toasts. */
  onValidationError?: (title: string, description?: string) => void;

  title: string;
  description?: React.ReactNode;
  submitLabel?: { cash?: string; paynow?: string };
  submitIcon?: React.ReactNode;
  testIds?: PolicyPremiumReceiptDialogTestIds;
}

const DEFAULT_SUBMIT_ICON = <Receipt className="h-4 w-4 mr-2" />;

export function PolicyPremiumReceiptDialog(props: PolicyPremiumReceiptDialogProps) {
  const {
    open, onOpenChange,
    policyMode, policy: fixedPolicy, policySearchPlaceholder, onPolicyResolved,
    policySummaryVariant = "card", getClientLabel,
    currency, onCurrencyChange, months = 1, onMonthsChange, showMonths = false,
    allowAmountOverride = false, amountOverride = null, onAmountOverrideChange,
    submitterNote = "", onSubmitterNoteChange,
    enablePaynow, isAgent = false, paymentMethod, onPaymentMethodChange,
    reference, onReferenceChange, notes, onNotesChange,
    receivedAt, onReceivedAtChange,
    onSubmitCash, isSubmittingCash,
    onInitiatePaynow, isInitiatingPaynow = false, onVerifyOtp, isVerifyingOtp = false,
    pollStatus, isPolling = false, onIsPollingChange, pollTimedOut = false, onRetryPolling,
    onValidationError,
    title, description, submitLabel, submitIcon = DEFAULT_SUBMIT_ICON, testIds = {},
  } = props;

  // finance.tsx renders two instances of this component simultaneously (dialogs #1 and #2, only
  // one "open" at a time) — element ids must be unique per instance, not just per field, so a
  // closed-but-still-mounted dialog's ids never collide with the open one's.
  const uid = useId();

  // ── Policy resolution (search mode owns its own enrichment fetch; fixed mode just uses the prop) ──
  const [searchPolicyId, setSearchPolicyId] = useState("");
  const { data: searchPolicyData } = useQuery<PolicyLike | null>({
    queryKey: ["/api/policies", searchPolicyId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${searchPolicyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: policyMode === "search" && !!searchPolicyId,
  });
  const resolvedPolicy: PolicyLike | null = policyMode === "fixed" ? (fixedPolicy ?? null) : (searchPolicyData ?? null);

  useEffect(() => {
    onPolicyResolved?.(resolvedPolicy);
  }, [resolvedPolicy?.id, resolvedPolicy?.premiumAmount]);

  // ── PayNow phase bookkeeping (internal — resets fresh every time the dialog opens) ──
  const [phase, setPhase] = useState<"select" | "waiting">("select");
  const [otp, setOtp] = useState("");
  const [innbucksCode, setInnbucksCode] = useState("");
  const [innbucksExpiry, setInnbucksExpiry] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const [otpRef, setOtpRef] = useState("");

  useEffect(() => {
    if (!open) return;
    setPhase("select");
    setOtp("");
    setInnbucksCode("");
    setInnbucksExpiry("");
    setNeedsOtp(false);
    setOtpRef("");
    if (policyMode === "search") setSearchPolicyId("");
  }, [open]);

  const systemAmount = resolvedPolicy?.premiumAmount
    ? parseFloat(String(resolvedPolicy.premiumAmount)) * (showMonths ? months : 1)
    : 0;
  const enteredAmount = allowAmountOverride && amountOverride != null ? parseFloat(amountOverride) : systemAmount;
  const isOverridden = allowAmountOverride && Number.isFinite(enteredAmount) && Math.abs(enteredAmount - systemAmount) >= 0.01;
  const finalAmount = Number.isFinite(enteredAmount) ? enteredAmount : systemAmount;

  const submitDisabled =
    !resolvedPolicy?.premiumAmount ||
    isSubmittingCash ||
    isInitiatingPaynow ||
    (enablePaynow && ["ecocash", "onemoney"].includes(paymentMethod) && (!reference || reference.trim().replace(/\D/g, "").length < 9)) ||
    (isOverridden && !submitterNote.trim());

  const handleSubmit = () => {
    if (!resolvedPolicy) return;
    if (!enablePaynow || paymentMethod === "cash") {
      onSubmitCash({
        policyId: resolvedPolicy.id,
        clientId: resolvedPolicy.clientId,
        amount: finalAmount.toFixed(2),
        currency,
        months: showMonths ? months : undefined,
        paymentMethod: enablePaynow ? paymentMethod : undefined,
        reference: reference || undefined,
        notes: notes || undefined,
        submitterNote: allowAmountOverride ? (submitterNote.trim() || undefined) : undefined,
        receivedAt: receivedAt ? new Date(receivedAt).toISOString() : undefined,
      });
      return;
    }
    if (!onInitiatePaynow) return;
    if (!reference || reference.trim().length < 5) {
      const label = paymentMethod === "visa_mastercard" ? "email address" : "mobile number";
      onValidationError?.(`Enter ${label}`, `Required for ${paymentMethod === "visa_mastercard" ? "card" : "mobile"} payment.`);
      return;
    }
    onIsPollingChange?.(false);
    onInitiatePaynow({
      policyId: resolvedPolicy.id,
      clientId: resolvedPolicy.clientId,
      amount: finalAmount.toFixed(2),
      currency,
      method: paymentMethod,
      reference,
    }).then((data) => {
      if (data.message) return; // parent surfaces the toast; nothing to render here
      setPhase("waiting");
      if (paymentMethod === "innbucks" && data.innbucksCode) {
        setInnbucksCode(data.innbucksCode);
        setInnbucksExpiry(data.innbucksExpiry || "");
        onIsPollingChange?.(true);
        return;
      }
      if (paymentMethod === "omari" && data.needsOtp) {
        setNeedsOtp(true);
        setOtpRef(data.omariOtpReference || "");
        return;
      }
      onIsPollingChange?.(true);
    });
  };

  const handleVerifyOtp = () => {
    if (!onVerifyOtp) return;
    onVerifyOtp(otp).then((data) => {
      if (data.message) return;
      if (!data.paid) {
        onIsPollingChange?.(true);
        setNeedsOtp(false);
      }
      // paid:true — parent's onVerifyOtp caller is expected to close the dialog itself.
    });
  };

  const clientLabel = resolvedPolicy?.clientId ? getClientLabel?.(resolvedPolicy.clientId) : null;
  const genericWaitingLabel = pollStatus?.paynowStatus && isPaynowPaidLike(pollStatus.paynowStatus)
    ? { title: "Payment received — recording transaction...", body: "The payment gateway confirmed receipt. Finalising your receipt now..." }
    : {
        title: paymentMethod === "visa_mastercard" ? "Waiting for card payment..." : "Waiting for client to approve on their phone...",
        body: paymentMethod === "visa_mastercard"
          ? "The client should complete payment in the card payment page that was opened."
          : "EcoCash/OneMoney use USSD — the client should see a prompt on their phone to enter their PIN. If nothing appears within 30 seconds, check the mobile number is correct (e.g. 0771234567) and try again.",
      };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-5">
          {policyMode === "search" && (
            <div>
              <Label className="text-sm font-medium">Search Policy</Label>
              <PolicySearchInput
                value={searchPolicyId}
                onChange={(id) => setSearchPolicyId(id)}
                placeholder={policySearchPlaceholder || "Type policy number or client name..."}
                data-testid={testIds.policySearch || "input-policy-search"}
              />
            </div>
          )}

          {resolvedPolicy && policySummaryVariant === "card" && (
            <div className="rounded-lg bg-muted/40 border border-dashed p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-mono font-semibold text-sm" data-testid={testIds.policySummary || "text-selected-policy"}>{resolvedPolicy.policyNumber}</p>
                  {clientLabel && <p className="text-sm text-muted-foreground">{clientLabel}</p>}
                </div>
                <div className="text-right">
                  <Badge variant={resolvedPolicy.status === "active" ? "default" : "secondary"}>{resolvedPolicy.status}</Badge>
                  {resolvedPolicy.premiumAmount && (
                    <p className="text-xs text-muted-foreground mt-1">
                      Premium: {formatAmount(resolvedPolicy.premiumAmount, resolvedPolicy.premiumCurrency)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
          {resolvedPolicy && policySummaryVariant === "compact" && (
            <p className="text-xs text-muted-foreground mt-1">Selected: {resolvedPolicy.policyNumber}</p>
          )}

          {policyMode === "search" && <Separator />}

          <div className={`grid grid-cols-1 ${showMonths ? "sm:grid-cols-3" : "sm:grid-cols-2"} gap-4`}>
            {showMonths && (
              <div>
                <Label className="text-xs" htmlFor={`${uid}-months`}>Months</Label>
                <Select value={String(months)} onValueChange={(v) => onMonthsChange?.(Number(v))} disabled={phase !== "select"}>
                  <SelectTrigger id={`${uid}-months`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <SelectItem key={m} value={String(m)}>{m} {m === 1 ? "month" : "months"}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label htmlFor={`${uid}-amount`}>{allowAmountOverride ? "Amount" : "Amount (auto from policy premium)"}</Label>
              <Input id={`${uid}-amount`}
                type="number"
                step="0.01"
                min="0.01"
                value={amountOverride ?? systemAmount.toFixed(2)}
                onChange={allowAmountOverride ? (e) => onAmountOverrideChange?.(e.target.value) : undefined}
                readOnly={!allowAmountOverride}
                className={!allowAmountOverride ? "bg-muted cursor-not-allowed" : undefined}
                data-testid={testIds.amount || "input-payment-amount"}
              />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={currency} onValueChange={onCurrencyChange} />
            </div>
          </div>

          {isOverridden && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                Amount differs from system premium ({currency} {systemAmount.toFixed(2)}) — this receipt will be held for approval and won't apply to the policy until approved.
              </p>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor={`${uid}-submitter-note`}>Notes for approver *</Label>
                <Textarea id={`${uid}-submitter-note`} value={submitterNote} onChange={(e) => onSubmitterNoteChange?.(e.target.value)}
                  placeholder="Explain why this amount differs from the system premium..." rows={2} className="text-sm" data-testid="textarea-in-policy-submitter-note" />
              </div>
            </div>
          )}

          {showMonths && months > 1 && resolvedPolicy?.premiumAmount && (
            <p className="text-xs text-muted-foreground">
              {months}× premium of {currency} {parseFloat(String(resolvedPolicy.premiumAmount)).toFixed(2)} = <strong>{currency} {systemAmount.toFixed(2)}</strong>
            </p>
          )}

          {enablePaynow && (
            <div>
              <Label htmlFor={`${uid}-method`}>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={onPaymentMethodChange}>
                <SelectTrigger id={`${uid}-method`} data-testid={testIds.paymentMethod || "select-payment-method"}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {!isAgent && <SelectItem value="cash">Cash</SelectItem>}
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="omari">O'Mari</SelectItem>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {(!enablePaynow || phase === "select") && (
            <>
              {enablePaynow && (paymentMethod === "ecocash" || paymentMethod === "onemoney") && (
                <div>
                  <Label htmlFor={`${uid}-reference`}>Client's Mobile Number (EcoCash/OneMoney)</Label>
                  <Input id={`${uid}-reference`} placeholder="e.g. 0771234567" value={reference} onChange={(e) => onReferenceChange(e.target.value)} data-testid={testIds.reference || "input-payment-reference"} />
                  <p className="text-xs text-muted-foreground mt-1">EcoCash/OneMoney use USSD — a prompt is sent to this number. The client enters their PIN on their phone (no app push). Use the number registered with EcoCash/OneMoney.</p>
                </div>
              )}
              {enablePaynow && paymentMethod === "innbucks" && (
                <div>
                  <Label htmlFor={`${uid}-reference`}>Client's Mobile Number</Label>
                  <Input id={`${uid}-reference`} placeholder="e.g. 0771234567" value={reference} onChange={(e) => onReferenceChange(e.target.value)} data-testid={testIds.reference || "input-payment-reference"} />
                  <p className="text-xs text-muted-foreground mt-1">An authorization code will be generated. The client enters it in their InnBucks app.</p>
                </div>
              )}
              {enablePaynow && paymentMethod === "omari" && (
                <div>
                  <Label htmlFor={`${uid}-reference`}>Client's Mobile Number</Label>
                  <Input id={`${uid}-reference`} placeholder="e.g. 0771234567" value={reference} onChange={(e) => onReferenceChange(e.target.value)} data-testid={testIds.reference || "input-payment-reference"} />
                  <p className="text-xs text-muted-foreground mt-1">An OTP will be sent via SMS. You will need to enter the OTP the client receives.</p>
                </div>
              )}
              {enablePaynow && paymentMethod === "visa_mastercard" && (
                <div>
                  <Label htmlFor={`${uid}-reference`}>Client's Email Address</Label>
                  <Input id={`${uid}-reference`} type="email" placeholder="client@example.com" value={reference} onChange={(e) => onReferenceChange(e.target.value)} data-testid={testIds.reference || "input-payment-reference"} />
                  <p className="text-xs text-muted-foreground mt-1">A secure payment page will open where the client enters card details.</p>
                </div>
              )}
              {enablePaynow && paymentMethod === "cash" && (
                <div>
                  <Label htmlFor={`${uid}-reference`}>Notes (optional)</Label>
                  <Input id={`${uid}-reference`} placeholder="e.g. Walk-in payment" value={reference} onChange={(e) => onReferenceChange(e.target.value)} data-testid={testIds.reference || "input-payment-reference"} />
                  <p className="text-xs text-muted-foreground mt-1">Receipt number is auto-generated by the system.</p>
                </div>
              )}

              <div>
                <Label htmlFor={`${uid}-notes`}>Notes (optional)</Label>
                <Input id={`${uid}-notes`} placeholder="Additional notes..." value={notes} onChange={(e) => onNotesChange(e.target.value)} data-testid={testIds.notes || "input-payment-notes"} />
              </div>

              {!enablePaynow && (
                <div>
                  <Label htmlFor={`${uid}-received-at`}>Received at</Label>
                  <Input id={`${uid}-received-at`} type="datetime-local" value={receivedAt} onChange={(e) => onReceivedAtChange?.(e.target.value)} />
                </div>
              )}
            </>
          )}

          {enablePaynow && phase === "waiting" && (
            <>
              {innbucksCode && (
                <div className="p-4 rounded-lg border-2 border-blue-300 bg-blue-50 space-y-3">
                  <p className="font-semibold text-blue-900">InnBucks Authorization Code</p>
                  <p className="text-3xl font-mono font-bold text-center tracking-widest text-blue-800">{innbucksCode}</p>
                  {innbucksExpiry && <p className="text-xs text-blue-700 text-center">Expires: {innbucksExpiry}</p>}
                  <div className="text-sm text-blue-800">
                    <p className="font-medium">Give this code to the client:</p>
                    <ol className="list-decimal list-inside space-y-1 mt-1">
                      <li>Open the <strong>InnBucks</strong> app</li>
                      <li>Go to <strong>Payments</strong></li>
                      <li>Enter the code above</li>
                      <li>Confirm the payment</li>
                    </ol>
                  </div>
                  {isPolling && (
                    <div className="flex items-center justify-center gap-2 text-sm text-blue-700">
                      <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation...
                    </div>
                  )}
                </div>
              )}

              {needsOtp && (
                <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3">
                  <p className="font-semibold text-amber-900">Enter O'Mari OTP</p>
                  <p className="text-sm text-amber-800">Ask the client for the OTP sent to their phone via SMS.</p>
                  {otpRef && <p className="text-xs text-amber-700">Reference: {otpRef}</p>}
                  <Input
                    placeholder="Enter OTP"
                    value={otp}
                    onChange={(e) => setOtp(e.target.value)}
                    maxLength={10}
                    className="text-center text-lg font-mono tracking-widest"
                  />
                  <Button
                    className="w-full"
                    disabled={!otp || otp.trim().length < 4 || isVerifyingOtp}
                    onClick={handleVerifyOtp}
                  >
                    {isVerifyingOtp && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Verify OTP
                  </Button>
                </div>
              )}

              {!innbucksCode && !needsOtp && isPolling && (
                <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50 space-y-3 text-center">
                  <Loader2 className="h-8 w-8 animate-spin mx-auto text-green-700" />
                  <p className="font-semibold text-green-900">{genericWaitingLabel.title}</p>
                  <p className="text-sm text-green-800">{genericWaitingLabel.body}</p>
                  {pollStatus?.error && <p className="text-xs text-amber-700 mt-1">{pollStatus.error}</p>}
                </div>
              )}

              {!innbucksCode && !needsOtp && !isPolling && pollTimedOut && (
                <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3 text-center">
                  <p className="font-semibold text-amber-900">Confirmation timed out</p>
                  <p className="text-sm text-amber-800">
                    If the money was deducted, the payment will be recorded automatically once the gateway confirms. You can close this dialog and check back shortly.
                  </p>
                  <Button variant="outline" size="sm" onClick={onRetryPolling}>Retry polling</Button>
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {(!enablePaynow || phase === "select") && (
            <Button
              onClick={handleSubmit}
              disabled={submitDisabled}
              data-testid={testIds.submit || "button-submit-payment"}
            >
              {(isSubmittingCash || isInitiatingPaynow) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitIcon}
              {(!enablePaynow || paymentMethod === "cash")
                ? (submitLabel?.cash ?? "Record Payment & Generate Receipt")
                : (submitLabel?.paynow ?? "Send Payment Request")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isPaynowPaidLike(s: string) {
  const l = s.toLowerCase();
  return l === "paid" || l === "sent" || l === "awaiting delivery" || l === "delivered";
}
