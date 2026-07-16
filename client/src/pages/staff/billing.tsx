import { useState, useEffect } from "react";
import { useSearch } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Receipt, CheckCircle2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BillingSubscription {
  id: string; planId: string; status: string;
  trialEndsAt: string | null; currentPeriodStart: string; currentPeriodEnd: string;
}
interface BillingPlan { id: string; name: string; priceMonthlyUsd: string; modules: string[] }
interface BillingInvoice {
  id: string; amount: string; currency: string; status: string;
  periodStart: string; periodEnd: string; dueDate: string; paidAt: string | null;
}

const STATUS_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  trialing: "outline", active: "default", past_due: "secondary", suspended: "destructive", cancelled: "secondary",
};
const STATUS_LABEL: Record<string, string> = {
  trialing: "Trial", active: "Active", past_due: "Payment overdue", suspended: "Suspended", cancelled: "Cancelled",
};

export default function StaffBilling() {
  const search = useSearch();
  const justPaid = new URLSearchParams(search).get("paid") === "1";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [payInvoice, setPayInvoice] = useState<BillingInvoice | null>(null);
  const [method, setMethod] = useState("ecocash");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [polling, setPolling] = useState(false);

  const { data: subData, isLoading } = useQuery<{ subscription: BillingSubscription | null; plan: BillingPlan | null }>({ queryKey: ["/api/billing/subscription"] });
  const { data: invoices = [] } = useQuery<BillingInvoice[]>({ queryKey: ["/api/billing/invoices"] });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["/api/billing/subscription"] });
    queryClient.invalidateQueries({ queryKey: ["/api/billing/invoices"] });
  }

  const initiateMutation = useMutation({
    mutationFn: async () => {
      if (!payInvoice) return null;
      const mobileMethods = ["ecocash", "onemoney"];
      const res = await apiRequest("POST", `/api/billing/invoices/${payInvoice.id}/pay`, {
        method,
        payerPhone: mobileMethods.includes(method) ? payerPhone : undefined,
        payerEmail: method === "visa_mastercard" ? payerEmail : undefined,
      });
      return res.json() as Promise<{ redirectUrl?: string; message?: string }>;
    },
    onSuccess: (data) => {
      if (!data) return;
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setPolling(true);
      toast({ title: "Check your phone", description: "Approve the payment prompt. This page will update automatically." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const { data: pollData } = useQuery({
    queryKey: ["/api/billing/invoices", payInvoice?.id, "poll", polling],
    queryFn: async () => {
      if (!payInvoice) return null;
      const res = await apiRequest("POST", `/api/billing/invoices/${payInvoice.id}/poll`);
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!payInvoice && polling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (pollData?.paid && polling) {
      setPolling(false);
      setPayInvoice(null);
      invalidate();
      toast({ title: "Payment received", description: "Your subscription has been renewed." });
    }
  }, [pollData, polling]);

  const subscription = subData?.subscription;
  const plan = subData?.plan;
  const mobileMethods = ["ecocash", "onemoney"];
  const canInitiate = method === "visa_mastercard" ? payerEmail.trim().length > 3 : payerPhone.trim().length >= 9;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Billing" description="Your subscription plan, renewal status, and invoice history." />

        {justPaid && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 flex items-center gap-2 text-emerald-800">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span className="text-sm">If your payment completed, your subscription will update within moments — refresh if it doesn't appear yet.</span>
          </div>
        )}

        {isLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : !subscription ? (
          <EmptyState title="No subscription found" description="Contact your platform administrator." />
        ) : (
          <>
            <CardSection title="Current plan" icon={Receipt}>
              <div className="p-6 space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={STATUS_VARIANT[subscription.status] ?? "outline"}>{STATUS_LABEL[subscription.status] ?? subscription.status}</Badge>
                  <span className="text-sm font-medium">{plan?.name ?? "Unknown plan"}</span>
                  {plan && <span className="text-sm text-muted-foreground">${plan.priceMonthlyUsd}/month</span>}
                </div>
                {subscription.status === "trialing" && subscription.trialEndsAt && (
                  <p className="text-sm text-muted-foreground">Trial ends {new Date(subscription.trialEndsAt).toLocaleDateString()}.</p>
                )}
                {subscription.status === "active" && (
                  <p className="text-sm text-muted-foreground">Renews {new Date(subscription.currentPeriodEnd).toLocaleDateString()}.</p>
                )}
                {(subscription.status === "past_due" || subscription.status === "suspended") && (
                  <p className="text-sm text-destructive">
                    Payment is overdue. {subscription.status === "suspended" ? "Access has been suspended — pay below to restore it instantly." : "Pay below to avoid suspension."}
                  </p>
                )}
              </div>
            </CardSection>

            <CardSection title="Invoices" icon={Receipt}>
              {invoices.length === 0 ? (
                <p className="p-6 text-sm text-muted-foreground">No invoices yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow><TableHead>Period</TableHead><TableHead>Amount</TableHead><TableHead>Status</TableHead><TableHead>Due</TableHead><TableHead /></TableRow>
                    </TableHeader>
                    <TableBody>
                      {invoices.map((inv) => (
                        <TableRow key={inv.id}>
                          <TableCell className="text-sm">{new Date(inv.periodStart).toLocaleDateString()} – {new Date(inv.periodEnd).toLocaleDateString()}</TableCell>
                          <TableCell className="font-mono text-sm">{inv.currency} {inv.amount}</TableCell>
                          <TableCell><Badge variant={inv.status === "paid" ? "default" : "outline"} className="capitalize">{inv.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(inv.dueDate).toLocaleDateString()}</TableCell>
                          <TableCell>
                            {inv.status === "open" && (
                              <Button size="sm" onClick={() => { setPayInvoice(inv); setPolling(false); }}>Pay now</Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardSection>
          </>
        )}
      </PageShell>

      <Dialog open={!!payInvoice} onOpenChange={(open) => { if (!open) { setPayInvoice(null); setPolling(false); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay invoice — {payInvoice?.currency} {payInvoice?.amount}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Payment method</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mobileMethods.includes(method) && (
              <div className="space-y-2">
                <Label htmlFor="sb-phone">Phone number</Label>
                <Input id="sb-phone" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} placeholder="0771234567" />
              </div>
            )}
            {method === "visa_mastercard" && (
              <div className="space-y-2">
                <Label htmlFor="sb-email">Email</Label>
                <Input id="sb-email" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
              </div>
            )}
            {polling && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation…
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayInvoice(null)}>Cancel</Button>
            <Button disabled={!canInitiate || initiateMutation.isPending || polling} onClick={() => initiateMutation.mutate()}>
              {initiateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {method === "visa_mastercard" ? "Continue to PayNow" : "Send payment prompt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
