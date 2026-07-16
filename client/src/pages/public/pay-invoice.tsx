import { useState, useEffect } from "react";
import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, XCircle, Receipt } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";

interface PublicInvoice {
  tenantName: string; planName: string; amount: string; currency: string; dueDate: string; status: string;
}

export default function PayInvoice() {
  const [, params] = useRoute("/pay/:token");
  const token = params?.token as string;
  const [method, setMethod] = useState("ecocash");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [polling, setPolling] = useState(false);
  const [manuallyConfirmedPaid, setManuallyConfirmedPaid] = useState(false);
  const mobileMethods = ["ecocash", "onemoney"];

  const { data: invoice, isLoading, isError, refetch } = useQuery<PublicInvoice>({
    queryKey: [`/api/public/billing/invoice/${token}`],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/public/billing/invoice/${token}`);
      if (!res.ok) throw new Error("Invoice not found");
      return res.json();
    },
    enabled: !!token,
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/public/billing/invoice/${token}/initiate`, {
        method,
        payerPhone: mobileMethods.includes(method) ? payerPhone : undefined,
        payerEmail: method === "visa_mastercard" ? payerEmail : undefined,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Payment failed"); }
      return res.json() as Promise<{ redirectUrl?: string }>;
    },
    onSuccess: (data) => {
      if (data.redirectUrl) {
        window.location.href = data.redirectUrl;
        return;
      }
      setPolling(true);
    },
  });

  const { data: pollData } = useQuery({
    queryKey: [`/api/public/billing/invoice/${token}/poll`, polling],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/public/billing/invoice/${token}/poll`);
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!token && polling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (pollData?.paid) {
      setPolling(false);
      setManuallyConfirmedPaid(true);
      refetch();
    }
  }, [pollData, refetch]);

  const canInitiate = method === "visa_mastercard" ? payerEmail.trim().length > 3 : payerPhone.trim().length >= 9;
  const alreadyPaid = invoice?.status === "paid" || manuallyConfirmedPaid;

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-teal-700 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Subscription Payment</p>
          <p className="text-lg font-bold mt-0.5">{invoice?.tenantName || "POL263"}</p>
        </div>

        <div className="px-6 py-8">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-gray-500 py-6">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
              <p className="text-sm">Loading invoice…</p>
            </div>
          ) : isError || !invoice ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <XCircle className="w-10 h-10 text-destructive" />
              <p className="font-semibold">Invoice not found</p>
              <p className="text-sm text-gray-500">This payment link is invalid or has expired. Contact your platform administrator for a new link.</p>
            </div>
          ) : alreadyPaid ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              <p className="font-semibold">Payment received</p>
              <p className="text-sm text-gray-500">Access has been restored. You can close this page.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Plan</span><span className="font-medium">{invoice.planName}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Amount due</span><span className="font-mono font-semibold">{invoice.currency} {invoice.amount}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Due date</span><span>{new Date(invoice.dueDate).toLocaleDateString()}</span></div>
              </div>

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
                  <Label htmlFor="pi-phone">Phone number</Label>
                  <Input id="pi-phone" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} placeholder="0771234567" />
                </div>
              )}
              {method === "visa_mastercard" && (
                <div className="space-y-2">
                  <Label htmlFor="pi-email">Email</Label>
                  <Input id="pi-email" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
                </div>
              )}

              {initiateMutation.isError && (
                <p className="text-sm text-destructive">{(initiateMutation.error as Error).message}</p>
              )}

              {polling ? (
                <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation…
                </div>
              ) : (
                <Button className="w-full" disabled={!canInitiate || initiateMutation.isPending} onClick={() => initiateMutation.mutate()}>
                  {initiateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Receipt className="h-4 w-4 mr-2" />}
                  {method === "visa_mastercard" ? "Continue to PayNow" : "Send payment prompt"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
