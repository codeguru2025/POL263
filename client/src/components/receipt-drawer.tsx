import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Loader2, Receipt, Search, CheckCircle2, Phone, ArrowLeft, Printer, RefreshCw, Download,
} from "lucide-react";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

// ── Context ──────────────────────────────────────────────────────────────────

type Ctx = { openReceiptDrawer: () => void };
const ReceiptDrawerCtx = createContext<Ctx | null>(null);

export function useReceiptDrawer() {
  const ctx = useContext(ReceiptDrawerCtx);
  if (!ctx) throw new Error("useReceiptDrawer requires ReceiptDrawerProvider");
  return ctx;
}

// ── Internal types ────────────────────────────────────────────────────────────

type Step = "search" | "pay" | "paying" | "done";
type PayMethod = "cash" | "bank" | "ecocash" | "onemoney" | "innbucks";

const MOBILE_METHODS: PayMethod[] = ["ecocash", "onemoney", "innbucks"];

interface PolicyHit {
  id: string;
  policyNumber: string;
  status?: string;
}

interface PolicyDetail {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount?: string | null;
  currency?: string;
  clientId: string;
  clientFirstName?: string;
  clientLastName?: string;
  clientPhone?: string;
}

// ── Step 1: Policy search ─────────────────────────────────────────────────────

function PolicySearchStep({ onSelect }: { onSelect: (p: PolicyHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PolicyHit[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 50); }, []);

  useEffect(() => {
    if (q.length < 2) { setHits([]); setBusy(false); return; }
    const t = setTimeout(async () => {
      const s = ++seq.current;
      setBusy(true);
      try {
        const res = await fetch(getApiBase() + `/api/policies?q=${encodeURIComponent(q)}&limit=10`, { credentials: "include" });
        if (s !== seq.current) return;
        setHits(res.ok ? await res.json() : []);
      } catch { if (s === seq.current) setHits([]); }
      finally { if (s === seq.current) setBusy(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={inputRef}
          className="pl-9"
          placeholder="Policy number, client name or phone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          data-testid="input-receipt-search"
        />
        {busy && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
        )}
      </div>
      {q.length >= 2 && (
        <ul className="border rounded-md divide-y max-h-60 overflow-y-auto bg-popover shadow-md">
          {hits.length === 0 && !busy ? (
            <li className="px-3 py-3 text-sm text-muted-foreground text-center">No policies found</li>
          ) : (
            hits.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 cursor-pointer hover:bg-accent transition-colors text-sm"
                onClick={() => onSelect(p)}
                data-testid="item-receipt-policy"
              >
                <span className="font-mono font-medium">{p.policyNumber}</span>
                {p.status && (
                  <Badge variant="outline" className="text-xs capitalize shrink-0">
                    {p.status}
                  </Badge>
                )}
              </li>
            ))
          )}
        </ul>
      )}
      {q.length === 1 && (
        <p className="text-xs text-muted-foreground">Type at least 2 characters to search</p>
      )}
    </div>
  );
}

// ── Step 2: Payment form ──────────────────────────────────────────────────────

function PayStep({
  policy,
  onBack,
  onCashDone,
  onPaynowStart,
}: {
  policy: PolicyDetail;
  onBack: () => void;
  onCashDone: (result: any) => void;
  onPaynowStart: (intentId: string, method: PayMethod) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const prefilled = policy.premiumAmount ? parseFloat(policy.premiumAmount).toFixed(2) : "";
  const [amount, setAmount] = useState(prefilled);
  const [currency, setCurrency] = useState(policy.currency || "USD");
  const [method, setMethod] = useState<PayMethod>("cash");
  const [phone, setPhone] = useState(policy.clientPhone || "");
  const [reference, setReference] = useState("");

  const isMobile = MOBILE_METHODS.includes(method);
  const clientName = [policy.clientFirstName, policy.clientLastName].filter(Boolean).join(" ") || "—";

  const mutation = useMutation({
    mutationFn: async () => {
      const amt = amount || prefilled;
      if (!amt || parseFloat(amt) <= 0) throw new Error("Enter an amount");
      if (isMobile && phone.replace(/\D/g, "").length < 9) throw new Error("Enter a valid phone number");

      if (!isMobile) {
        const res = await apiRequest("POST", "/api/payments", {
          policyId: policy.id,
          clientId: policy.clientId,
          amount: amt,
          currency,
          paymentMethod: method,
          status: "cleared",
          reference: reference || undefined,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || "Payment failed");
        return { type: "immediate" as const, result: data };
      }

      // PayNow: create intent then initiate
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: policy.id,
        clientId: policy.clientId,
        amount: amt,
        currency,
        purpose: "premium",
      });
      const intent = await intentRes.json();
      if (!intentRes.ok || intent.message) throw new Error(intent.message || "Could not create payment");

      const initRes = await apiRequest("POST", `/api/payment-intents/${intent.id}/initiate`, {
        method,
        payerPhone: phone || undefined,
      });
      const initData = await initRes.json();
      if (initData.message && !initData.pollUrl && !initData.innbucksCode) {
        throw new Error(initData.message);
      }
      queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
      return { type: "paynow" as const, intentId: intent.id };
    },
    onSuccess: (res) => {
      if (res.type === "immediate") {
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        onCashDone(res.result);
      } else {
        onPaynowStart(res.intentId, method);
      }
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      {/* Policy summary card */}
      <div className="rounded-lg border bg-muted/40 px-4 py-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono font-semibold text-sm">{policy.policyNumber}</span>
          <Badge variant="outline" className="capitalize text-xs">{policy.status}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{clientName}</p>
        {prefilled && (
          <p className="text-sm">
            Premium due:{" "}
            <span className="font-semibold text-foreground">{currency} {prefilled}</span>
          </p>
        )}
      </div>

      {/* Amount + currency */}
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <div>
          <Label htmlFor="rd-amount">Amount</Label>
          <Input
            id="rd-amount"
            type="number"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1"
            data-testid="input-receipt-amount"
          />
        </div>
        <div>
          <Label>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger className="mt-1 w-[5.5rem]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["USD", "ZAR", "ZIG"].map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Method */}
      <div>
        <Label>Payment method</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as PayMethod)}>
          <SelectTrigger className="mt-1" data-testid="select-receipt-method">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">Cash</SelectItem>
            <SelectItem value="bank">Bank transfer</SelectItem>
            <SelectItem value="ecocash">EcoCash</SelectItem>
            <SelectItem value="onemoney">OneMoney</SelectItem>
            <SelectItem value="innbucks">InnBucks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Phone (mobile methods) */}
      {isMobile && (
        <div>
          <Label htmlFor="rd-phone">Client phone number</Label>
          <div className="relative mt-1">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="rd-phone"
              className="pl-9"
              placeholder="07x xxx xxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              data-testid="input-receipt-phone"
            />
          </div>
        </div>
      )}

      {/* Reference (cash/bank) */}
      {!isMobile && (
        <div>
          <Label htmlFor="rd-ref">
            Reference{" "}
            <span className="text-muted-foreground text-xs font-normal">(optional)</span>
          </Label>
          <Input
            id="rd-ref"
            className="mt-1"
            placeholder={method === "bank" ? "Bank reference number" : "Memo / slip number"}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
          />
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" size="icon" onClick={onBack} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
          <span className="sr-only">Back</span>
        </Button>
        <Button
          className="flex-1 gap-2"
          onClick={() => mutation.mutate()}
          disabled={
            mutation.isPending ||
            !amount ||
            parseFloat(amount) <= 0 ||
            (isMobile && phone.replace(/\D/g, "").length < 9)
          }
          data-testid="button-receipt-submit"
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Receipt className="h-4 w-4" />
          )}
          {isMobile ? "Send payment request" : "Record & receipt"}
        </Button>
      </div>
    </div>
  );
}

// ── Step 3: Waiting for PayNow ────────────────────────────────────────────────

function PayingStep({
  intentId,
  method,
  onPaid,
  onFailed,
}: {
  intentId: string;
  method: PayMethod;
  onPaid: (result: any) => void;
  onFailed: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: poll } = useQuery({
    queryKey: ["receipt-drawer-poll", intentId],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/payment-intents/${intentId}/poll`, {});
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!intentId,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!poll) return;
    if (poll.paid || poll.status === "paid") {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
      onPaid(poll);
    } else if (poll.status === "failed") {
      toast({ title: "Payment declined", description: "The client did not approve the payment.", variant: "destructive" });
      onFailed();
    }
  }, [poll]);

  const labels: Record<PayMethod, string> = {
    ecocash: "EcoCash",
    onemoney: "OneMoney",
    innbucks: "InnBucks",
    cash: "Cash",
    bank: "Bank",
  };

  return (
    <div className="flex flex-col items-center gap-4 py-8 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <div>
        <p className="font-medium">Waiting for {labels[method]} approval…</p>
        <p className="text-sm text-muted-foreground mt-1">
          The client should receive a prompt on their phone. This will update automatically.
        </p>
      </div>
    </div>
  );
}

// ── Step 4: Success ───────────────────────────────────────────────────────────

const THERMAL_SIZES = [
  { label: "48mm", value: "48" },
  { label: "58mm", value: "58" },
  { label: "80mm", value: "80" },
] as const;

function DoneStep({
  result,
  policy,
  onNew,
}: {
  result: any;
  policy: PolicyDetail;
  onNew: () => void;
}) {
  const [thermalSize, setThermalSize] = useState<"48" | "58" | "80">("80");

  const receiptId = result?.receipt?.id ?? result?.receiptId;
  const receiptNum = result?.receipt?.receiptNumber ?? result?.receiptNumber ?? "—";
  const amount = result?.amount ?? "—";
  const currency = result?.currency ?? "";
  const method = (result?.paymentMethod ?? "—").replace(/_/g, " ");
  const clientName = [policy.clientFirstName, policy.clientLastName].filter(Boolean).join(" ") || "—";

  const base = getApiBase();
  const viewUrl = receiptId ? `${base}/api/receipts/${receiptId}/view` : null;
  const thermalUrl = receiptId ? `${base}/api/receipts/${receiptId}/view?format=thermal&size=${thermalSize}` : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-col items-center gap-2 pt-1 pb-2">
        <div className="rounded-full bg-emerald-100 dark:bg-emerald-900/30 p-3">
          <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
        </div>
        <h3 className="font-semibold text-lg">Payment recorded</h3>
        <p className="text-sm text-muted-foreground">{clientName} · {policy.policyNumber}</p>
      </div>

      <dl className="rounded-lg border divide-y text-sm">
        {[
          ["Receipt #", receiptNum],
          ["Amount", `${currency} ${typeof amount === "number" ? amount.toFixed(2) : amount}`],
          ["Method", method],
        ].map(([label, value]) => (
          <div key={String(label)} className="flex justify-between px-4 py-2.5">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-medium capitalize">{value}</dd>
          </div>
        ))}
      </dl>

      {/* Paper size selector + thermal button */}
      {thermalUrl && (
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground font-medium">Paper size</p>
          <div className="flex gap-1.5">
            {THERMAL_SIZES.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setThermalSize(s.value)}
                className={`flex-1 rounded border text-xs py-1 font-medium transition-colors ${
                  thermalSize === s.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-border text-muted-foreground hover:border-primary/60"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5"
            onClick={() => window.open(thermalUrl, "_blank")}
            data-testid="button-receipt-thermal"
          >
            <Printer className="h-3.5 w-3.5" />
            Print Thermal ({thermalSize}mm)
          </Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2">
        {viewUrl && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => window.open(viewUrl, "_blank")}
            data-testid="button-receipt-a4"
          >
            <Download className="h-3.5 w-3.5" />
            A4 PDF
          </Button>
        )}
        <Button
          size="sm"
          className="gap-1.5"
          onClick={onNew}
          style={{ gridColumn: viewUrl ? "auto" : "1 / -1" }}
          data-testid="button-receipt-new"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          New receipt
        </Button>
      </div>
    </div>
  );
}

// ── Dialog orchestrator ───────────────────────────────────────────────────────

function ReceiptDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState<Step>("search");
  const [hit, setHit] = useState<PolicyHit | null>(null);
  const [policyDetail, setPolicyDetail] = useState<PolicyDetail | null>(null);
  const [payResult, setPayResult] = useState<any>(null);
  const [paynowIntentId, setPaynowIntentId] = useState("");
  const [paynowMethod, setPaynowMethod] = useState<PayMethod>("ecocash");

  const { data: fetchedPolicy, isLoading: fetchingPolicy } = useQuery<PolicyDetail>({
    queryKey: ["/api/policies", hit?.id],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${hit!.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Policy not found");
      return res.json();
    },
    enabled: !!hit,
  });

  useEffect(() => {
    if (fetchedPolicy) { setPolicyDetail(fetchedPolicy); setStep("pay"); }
  }, [fetchedPolicy]);

  const reset = () => {
    setStep("search");
    setHit(null);
    setPolicyDetail(null);
    setPayResult(null);
    setPaynowIntentId("");
  };

  const handleClose = () => { reset(); onClose(); };

  const titles: Record<Step, string> = {
    search: "Receipt a payment",
    pay: "Record payment",
    paying: "Waiting for payment",
    done: "Payment recorded",
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary shrink-0" />
            {titles[step]}
          </DialogTitle>
        </DialogHeader>

        {step === "search" && (
          <PolicySearchStep onSelect={(p) => setHit(p)} />
        )}

        {step === "pay" && (
          fetchingPolicy ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : policyDetail ? (
            <PayStep
              policy={policyDetail}
              onBack={reset}
              onCashDone={(r) => { setPayResult(r); setStep("done"); }}
              onPaynowStart={(id, m) => { setPaynowIntentId(id); setPaynowMethod(m); setStep("paying"); }}
            />
          ) : (
            <p className="text-sm text-destructive py-4 text-center">Could not load policy details.</p>
          )
        )}

        {step === "paying" && (
          <PayingStep
            intentId={paynowIntentId}
            method={paynowMethod}
            onPaid={(r) => { setPayResult(r); setStep("done"); }}
            onFailed={() => setStep("pay")}
          />
        )}

        {step === "done" && policyDetail && (
          <DoneStep result={payResult} policy={policyDetail} onNew={reset} />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Provider (export) ─────────────────────────────────────────────────────────

export function ReceiptDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const openReceiptDrawer = useCallback(() => setOpen(true), []);

  return (
    <ReceiptDrawerCtx.Provider value={{ openReceiptDrawer }}>
      {children}
      <ReceiptDialog open={open} onClose={() => setOpen(false)} />
    </ReceiptDrawerCtx.Provider>
  );
}
