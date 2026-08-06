import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CurrencySelect } from "@/components/currency-select";
import { QK_REQUISITIONS, QK_EXPENDITURES, QK_PAYMENT_DISBURSEMENTS } from "./query-keys";

/** The "Record Payment" dialog shared by the Requisitions and Expenditures tabs — both
 *  tabs call openPayDialog(type, item) (threaded down as a prop from index.tsx) to open
 *  it against their own row. fxRateMap is threaded in from wherever it's computed
 *  (index.tsx) rather than queried again here, so the fx-rates query isn't duplicated
 *  between this dialog and fx-rates-tab.tsx. */
export function usePayDialog(canWriteFinance: boolean, fxRateMap: Record<string, string>) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [payTarget, setPayTarget] = useState<{ type: "requisition" | "expenditure"; item: any } | null>(null);
  const [payForm, setPayForm] = useState({
    amount: "", paidDate: new Date().toISOString().slice(0, 10),
    paymentMethod: "cash", reference: "", receivedBy: "", receivedByUserId: "", notes: "",
    paidInDifferentCurrency: false, paidCurrency: "", fxRateApplied: "",
  });
  const { data: staffUsers = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: canWriteFinance });

  const openPayDialog = (type: "requisition" | "expenditure", item: any) => {
    const outstanding = Number(item.amount) - Number(item.amountPaid ?? 0);
    setPayTarget({ type, item });
    setPayForm({
      amount: outstanding.toFixed(2),
      paidDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "cash", reference: "", receivedBy: "", receivedByUserId: "", notes: "",
      paidInDifferentCurrency: false, paidCurrency: "", fxRateApplied: "",
    });
  };

  const payMutation = useMutation({
    mutationFn: async () => {
      if (!payTarget) throw new Error("No target");
      const endpoint = payTarget.type === "requisition"
        ? `/api/requisitions/${payTarget.item.id}/payments`
        : `/api/expenditures/${payTarget.item.id}/payments`;
      const res = await apiRequest("POST", endpoint, {
        amount: parseFloat(payForm.amount),
        paidDate: payForm.paidDate,
        paymentMethod: payForm.paymentMethod,
        reference: payForm.reference || undefined,
        receivedBy: payForm.receivedBy || undefined,
        receivedByUserId: payForm.receivedByUserId || undefined,
        notes: payForm.notes || undefined,
        paidCurrency: payForm.paidInDifferentCurrency ? payForm.paidCurrency || undefined : undefined,
        fxRateApplied: payForm.paidInDifferentCurrency ? payForm.fxRateApplied || undefined : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      queryClient.invalidateQueries({ queryKey: QK_EXPENDITURES });
      queryClient.invalidateQueries({ queryKey: QK_PAYMENT_DISBURSEMENTS });
      setPayTarget(null);
      toast({
        title: data.fullyPaid ? "Fully paid" : "Partial payment recorded",
        description: data.fullyPaid ? "Payment complete." : `${payTarget?.item.currency} ${parseFloat(payForm.amount).toFixed(2)} recorded. Outstanding balance remains.`,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const PayDialog = (
    <Dialog open={!!payTarget} onOpenChange={(open) => { if (!open) setPayTarget(null); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {payTarget?.type === "requisition"
              ? `Record Payment — ${payTarget.item.requisitionNumber}`
              : `Record Payment — Expenditure`}
          </DialogTitle>
        </DialogHeader>
        {payTarget && (() => {
          const outstanding = Number(payTarget.item.amount) - Number(payTarget.item.amountPaid ?? 0);
          const selectedUser = (staffUsers as any[]).find((u: any) => u.id === payForm.receivedByUserId);
          return (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-muted/30 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-semibold">{payTarget.item.currency} {Number(payTarget.item.amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Already paid</span>
                  <span>{payTarget.item.currency} {Number(payTarget.item.amountPaid ?? 0).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-1 mt-1">
                  <span>Outstanding</span>
                  <span className="text-destructive">{payTarget.item.currency} {outstanding.toFixed(2)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="pay-form-amount">Amount paying now *</Label>
                  <Input id="pay-form-amount" type="number" step="0.01" min="0.01" max={outstanding}
                    value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                    placeholder={outstanding.toFixed(2)} data-testid="input-pay-amount" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-form-paid-date">Payment date *</Label>
                  <Input id="pay-form-paid-date" type="date" value={payForm.paidDate} max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setPayForm({ ...payForm, paidDate: e.target.value })} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label htmlFor="pay-form-payment-method">Payment method *</Label>
                  <Select value={payForm.paymentMethod} onValueChange={(v) => setPayForm({ ...payForm, paymentMethod: v })}>
                    <SelectTrigger id="pay-form-payment-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cash">Cash</SelectItem>
                      <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                      <SelectItem value="mobile_money">Mobile Money</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="pay-form-reference">Reference / Cheque #</Label>
                  <Input id="pay-form-reference" value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Optional reference" />
                </div>
              </div>

              <div className="space-y-1">
                <Label htmlFor="pay-form-received-by">Received by (recipient) *</Label>
                <Input id="pay-form-received-by" value={payForm.receivedBy} onChange={(e) => setPayForm({ ...payForm, receivedBy: e.target.value, receivedByUserId: "" })}
                  placeholder="Supplier name, staff member, vendor…" data-testid="input-received-by" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground" htmlFor="pay-form-received-by-user-id">Or select a system user as recipient</Label>
                <Select value={payForm.receivedByUserId}
                  onValueChange={(v) => setPayForm({ ...payForm, receivedByUserId: v, receivedBy: v ? ((staffUsers as any[]).find((u: any) => u.id === v)?.displayName || "") : payForm.receivedBy })}>
                  <SelectTrigger id="pay-form-received-by-user-id" className="text-sm"><SelectValue placeholder="Choose system user (optional)…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None — use text above</SelectItem>
                    {(staffUsers as any[]).map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label>Notes</Label>
                <Textarea value={payForm.notes} onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })} rows={2} placeholder="Optional notes about this payment…" className="text-sm" />
              </div>

              <div className="rounded-md border p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox checked={payForm.paidInDifferentCurrency}
                    onCheckedChange={(v) => setPayForm({ ...payForm, paidInDifferentCurrency: !!v })}
                    data-testid="checkbox-paid-different-currency" />
                  <Label className="font-normal cursor-pointer" onClick={() => setPayForm({ ...payForm, paidInDifferentCurrency: !payForm.paidInDifferentCurrency })}>
                    Actually paid out in a different currency than {payTarget.item.currency}
                  </Label>
                </div>
                {payForm.paidInDifferentCurrency && (() => {
                  // Default the rate from the platform's configured fx_rates (Settings → FX
                  // Rates), same USD-cross convention used server-side — staff can still
                  // override for the actual cash-counter rate.
                  const entityCurrency = payTarget.item.currency;
                  const usdPer = (c: string) => (c === "USD" ? 1 : parseFloat(fxRateMap[c] || "0"));
                  const platformRateFor = (paidCurrency: string): string => {
                    if (!paidCurrency || paidCurrency === entityCurrency) return "";
                    const from = usdPer(entityCurrency);
                    const to = usdPer(paidCurrency);
                    if (!(from > 0) || !(to > 0)) return "";
                    return (from / to).toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
                  };
                  return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <Label>Currency actually paid</Label>
                      <CurrencySelect value={payForm.paidCurrency} onValueChange={(v) => {
                        const platformRate = platformRateFor(v);
                        setPayForm({ ...payForm, paidCurrency: v, fxRateApplied: platformRate || payForm.fxRateApplied });
                      }} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pay-form-fx-rate-applied">Rate ({payForm.paidCurrency || "?"} per 1 {payTarget.item.currency}) *</Label>
                      <Input id="pay-form-fx-rate-applied" type="number" step="0.0001" min="0.0001" value={payForm.fxRateApplied}
                        onChange={(e) => setPayForm({ ...payForm, fxRateApplied: e.target.value })}
                        placeholder="e.g. 20" data-testid="input-fx-rate-applied" />
                      {platformRateFor(payForm.paidCurrency) && (
                        <p className="text-xs text-muted-foreground">
                          Platform rate: {platformRateFor(payForm.paidCurrency)}. Edit if the actual cash-counter rate differs.
                        </p>
                      )}
                    </div>
                    {payForm.paidCurrency && payForm.fxRateApplied && parseFloat(payForm.fxRateApplied) > 0 && payForm.amount && (
                      <p className="col-span-2 text-xs text-muted-foreground">
                        Cash handed over: {payForm.paidCurrency} {(parseFloat(payForm.amount) * parseFloat(payForm.fxRateApplied)).toFixed(2)}
                        {" "}— settles {payTarget.item.currency} {parseFloat(payForm.amount || "0").toFixed(2)} of this {payTarget.type}.
                      </p>
                    )}
                  </div>
                  );
                })()}
              </div>
              {payMutation.isError && <p className="text-sm text-destructive">{(payMutation.error as Error).message}</p>}
            </div>
          );
        })()}
        <DialogFooter>
          <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
          <Button
            onClick={() => payMutation.mutate()}
            disabled={
              payMutation.isPending || !payForm.amount || parseFloat(payForm.amount) <= 0 ||
              (!payForm.receivedBy.trim() && !payForm.receivedByUserId) ||
              (payForm.paidInDifferentCurrency && (!payForm.paidCurrency || !payForm.fxRateApplied || parseFloat(payForm.fxRateApplied) <= 0))
            }
            data-testid="btn-confirm-disbursement"
          >
            {payMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Record Payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  return { payTarget, openPayDialog, payMutation, staffUsers, PayDialog };
}
