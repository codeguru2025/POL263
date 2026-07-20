import { useRoute } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, XCircle, Clock, Receipt } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { usePaynowPolling } from "@/hooks/use-paynow-polling";

interface PublicPaymentLink {
  status: "active" | "paid" | "expired" | "cancelled" | "not_found";
  policyNumber?: string | null;
  amount?: string;
  currency?: string;
  method?: string;
  payerPhone?: string | null;
  expiresAt?: string;
}

const METHOD_LABELS: Record<string, string> = {
  ecocash: "EcoCash",
  onemoney: "OneMoney",
  innbucks: "InnBucks",
  omari: "O'Mari",
  visa_mastercard: "Visa / Mastercard",
};

export default function PayPolicyLink() {
  const [, params] = useRoute("/pay/policy/:token");
  const token = params?.token as string;

  const { data: link, isLoading, refetch } = useQuery<PublicPaymentLink>({
    queryKey: [`/api/pay/${token}`],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/pay/${token}`);
      return res.json();
    },
    enabled: !!token,
  });

  const pn = usePaynowPolling({
    initiate: async () => {
      const res = await apiRequest("POST", `/api/pay/${token}/initiate`, {});
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Payment failed"); }
      return res.json();
    },
    poll: async () => {
      const res = await apiRequest("POST", `/api/pay/${token}/poll`, {});
      return res.json();
    },
    submitOtp: async (otp) => {
      const res = await apiRequest("POST", `/api/pay/${token}/otp`, { otp });
      return res.json();
    },
    onPaid: () => refetch(),
  });

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-teal-700 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Policy Payment</p>
          <p className="text-lg font-bold mt-0.5">{link?.policyNumber ? `Policy ${link.policyNumber}` : "Payment Link"}</p>
        </div>

        <div className="px-6 py-8">
          {isLoading ? (
            <div className="flex flex-col items-center gap-3 text-gray-500 py-6">
              <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
              <p className="text-sm">Loading…</p>
            </div>
          ) : !link || link.status === "not_found" ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <XCircle className="w-10 h-10 text-destructive" />
              <p className="font-semibold">Link not found</p>
              <p className="text-sm text-gray-500">This payment link is invalid. Ask for a new one.</p>
            </div>
          ) : link.status === "paid" ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <CheckCircle2 className="w-10 h-10 text-emerald-600" />
              <p className="font-semibold">Payment received</p>
              <p className="text-sm text-gray-500">Thank you — your payment has been recorded. You can close this page.</p>
            </div>
          ) : link.status === "expired" ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <Clock className="w-10 h-10 text-gray-400" />
              <p className="font-semibold">This link has expired</p>
              <p className="text-sm text-gray-500">Ask your agent or the office for a new payment link.</p>
            </div>
          ) : link.status === "cancelled" ? (
            <div className="flex flex-col items-center gap-3 text-center py-6">
              <XCircle className="w-10 h-10 text-gray-400" />
              <p className="font-semibold">This link is no longer usable</p>
              <p className="text-sm text-gray-500">Ask your agent or the office for a new payment link.</p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-500">Amount due</span><span className="font-mono font-semibold">{link.currency} {link.amount}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Method</span><span className="font-medium">{METHOD_LABELS[link.method || ""] || link.method}</span></div>
                {link.payerPhone && (
                  <div className="flex justify-between"><span className="text-gray-500">Phone</span><span className="font-mono">{link.payerPhone}</span></div>
                )}
              </div>

              {pn.failed && <p className="text-sm text-destructive">{pn.failed}</p>}

              {pn.phase === "idle" && (
                <Button className="w-full" size="lg" disabled={pn.initiating} onClick={() => pn.initiate()} data-testid="btn-pay-now">
                  {pn.initiating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Receipt className="h-4 w-4 mr-2" />}
                  Pay Now
                </Button>
              )}

              {pn.phase === "waiting" && (
                <div className="space-y-3">
                  {pn.innbucksCode && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-center space-y-1">
                      <p className="text-xs text-blue-700">Enter this code in your InnBucks app</p>
                      <p className="text-3xl font-mono font-bold tracking-widest text-blue-800">{pn.innbucksCode}</p>
                      {pn.innbucksExpiry && <p className="text-xs text-blue-700">Expires {new Date(pn.innbucksExpiry).toLocaleTimeString()}</p>}
                    </div>
                  )}
                  {pn.needsOtp && (
                    <div className="space-y-2">
                      <Label htmlFor="pp-otp">Enter the OTP sent to your phone</Label>
                      {pn.otpRef && <p className="text-xs text-amber-700">Reference: {pn.otpRef}</p>}
                      <Input id="pp-otp" placeholder="OTP" value={pn.otp} onChange={(e) => pn.setOtp(e.target.value)} maxLength={10} className="text-center text-lg font-mono tracking-widest" />
                      <Button className="w-full" disabled={!pn.otp || pn.otp.trim().length < 4 || pn.submittingOtp} onClick={() => pn.submitOtp()}>
                        {pn.submittingOtp && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Verify OTP
                      </Button>
                    </div>
                  )}
                  {!pn.innbucksCode && !pn.needsOtp && pn.polling && (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation…
                    </div>
                  )}
                  {pn.pollError && <p className="text-xs text-amber-700 text-center">{pn.pollError}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
