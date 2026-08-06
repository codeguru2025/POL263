import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Plus, Receipt, Wallet, TrendingUp, Loader2, CheckCircle2, FileDown, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { PolicyPremiumReceiptDialog } from "@/components/policy-premium-receipt-dialog";

import { useFinancePermissions, FINANCE_GROUP_META, FINANCE_GROUP_ORDER } from "./use-finance-permissions";
import { usePayDialog } from "./shared-dialogs";
import { QK_PAYMENTS, QK_FX_RATES, QK_EXPENDITURES } from "./query-keys";

import { PaymentsTab } from "./payments-tab";
import { ReceiptingByStaffPanel } from "./receipting-by-staff-panel";
import { PaynowTab } from "./paynow-tab";
import { CashupsTab } from "./cashups-tab";
import { CommissionsTab } from "./commissions-tab";
import { FxRatesTab } from "./fx-rates-tab";
import { MyPnlTab } from "./my-pnl-tab";
import { RequisitionsTab } from "./requisitions-tab";
import { ExpendituresTab } from "./expenditures-tab";
import { PlatformTab } from "./platform-tab";
import { MonthEndTab } from "./month-end-tab";
import { GroupReceiptTab } from "./group-receipt-tab";
import { ApprovalsTab } from "./approvals-tab";
import { BankingTab } from "./banking-tab";

export default function StaffFinance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const {
    authUser, isAgent,
    canReadFinance, canWriteFinance, canApproveFinance, canDeleteRequisition,
    canBackdatePayment, canEditPayment, canDeleteExpenditure, canReadCommission,
    commissionOnly, canManageSettings,
    pendingApprovalsCount,
    visibleTabDefs,
    activeTab, handleTabChange,
  } = useFinancePermissions();

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID());
  // Fed by PolicyPremiumReceiptDialog's onPolicyResolved — the dialog owns policy search/
  // enrichment internally now; the parent only needs the resolved policy number for the toast.
  const [paymentDialogPolicyNumber, setPaymentDialogPolicyNumber] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("USD");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [receiptResult, setReceiptResult] = useState<any>(null);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);

  // Paynow flow state for receipt dialog — intent id + whether the shared dialog's poll should
  // be active are still parent-owned since the parent owns the poll useQuery below.
  const [paynowIntentId, setPaynowIntentId] = useState<string | null>(null);
  const [paynowPolling, setPaynowPolling] = useState(false);

  const { data: rawPolicies } = useQuery<any[]>({ queryKey: ["/api/policies"] });
  const { data: rawClients } = useQuery<any[]>({ queryKey: ["/api/clients"] });
  const policies = Array.isArray(rawPolicies) ? rawPolicies : [];
  const clients = Array.isArray(rawClients) ? rawClients : [];

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  // FX rates (USD base) for consolidated statements — queried once here and threaded down
  // as a prop to both fx-rates-tab.tsx (display/edit) and shared-dialogs.tsx's payment
  // dialog (currency-conversion default), so the query isn't duplicated in two places.
  const { data: rawFxRates } = useQuery<any[]>({ queryKey: QK_FX_RATES, enabled: canReadFinance });
  const fxRateMap: Record<string, string> = {};
  for (const r of (Array.isArray(rawFxRates) ? rawFxRates : [])) fxRateMap[r.currency] = String(r.rateToUsd);

  const payDialog = usePayDialog(canWriteFinance, fxRateMap);

  // Light, cache-shared reads (same queryKey as the owning tab's own useQuery) purely to
  // feed the page-level KPI tiles below — TanStack Query dedupes by key, so this doesn't
  // cost an extra network request beyond what the tab itself already fetches.
  const { data: rawPaymentsForKpi } = useQuery<any[]>({ queryKey: QK_PAYMENTS });
  const payments = Array.isArray(rawPaymentsForKpi) ? rawPaymentsForKpi : [];
  const { data: rawExpendituresForKpi } = useQuery<any[]>({ queryKey: QK_EXPENDITURES });
  const expenditures = Array.isArray(rawExpendituresForKpi) ? rawExpendituresForKpi : [];
  const { data: rawProductsForKpi } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: rawProductVersionsForKpi } = useQuery<any[]>({ queryKey: ["/api/product-versions"] });
  const productsForKpi = Array.isArray(rawProductsForKpi) ? rawProductsForKpi : [];
  const productVersionsForKpi = Array.isArray(rawProductVersionsForKpi) ? rawProductVersionsForKpi : [];
  const commissionConfigs = productVersionsForKpi.filter((v: any) => v.commissionFirstMonthsRate || v.commissionRecurringRate);

  // True totals for the KPI tiles below — `payments` above is capped at the API's default
  // page size (100), so `.length` / a currency-blind sum over it silently under-reports once
  // an org has more than 100 payments, and mixes currencies together if it has more than one.
  const { data: paymentsSummary } = useQuery<{ totalCount: number; clearedByCurrency: { currency: string; count: number; total: string }[] }>({
    queryKey: ["/api/payments/summary"],
  });
  // "Total Receipted" specifically is period-filterable (today/yesterday/MTD/YTD/custom) —
  // a separate call from the all-time `paymentsSummary` above so "Total Payments" stays all-time.
  const [receiptedPeriod, setReceiptedPeriod] = useState<Period>(() => periodForPreset("mtd"));
  const { data: paymentsSummaryForPeriod, isLoading: loadingReceiptedPeriod } = useQuery<{ totalCount: number; clearedByCurrency: { currency: string; count: number; total: string }[] }>({
    queryKey: ["/api/payments/summary", receiptedPeriod.from, receiptedPeriod.to],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/payments/summary?fromDate=${receiptedPeriod.from}&toDate=${receiptedPeriod.to}`, { credentials: "include" });
      if (!res.ok) return { totalCount: 0, clearedByCurrency: [] };
      return res.json();
    },
  });
  const totalClearedLabel = useMemo(() => {
    const rows = paymentsSummaryForPeriod?.clearedByCurrency ?? [];
    if (rows.length === 0) return "0.00";
    return rows
      .slice()
      .sort((a, b) => a.currency.localeCompare(b.currency))
      .map((r) => `${r.currency} ${parseFloat(r.total).toFixed(2)}`)
      .join("  ·  ");
  }, [paymentsSummaryForPeriod]);

  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: QK_PAYMENTS });
      setShowPaymentDialog(false);
      resetPaymentForm();
      setReceiptResult(result);
      setShowReceiptDialog(true);
      toast({ title: "Payment recorded & receipt generated", description: `Receipt for ${paymentDialogPolicyNumber || "policy"}` });
    },
    onError: (err: any) => toast({
      title: "Payment failed",
      description: err.message?.includes("duplicate") || err.message?.includes("constraint")
        ? "A duplicate payment may have been submitted. Please check your payments list before trying again."
        : (err.message || "Please try again. If the problem persists, contact support."),
      variant: "destructive",
    }),
  });

  const resetPaymentForm = () => {
    setPaymentDialogPolicyNumber("");
    setPaymentCurrency("USD");
    setPaymentMethod(isAgent ? "ecocash" : "cash");
    setPaymentReference("");
    setPaymentNotes("");
    setPaynowIntentId(null);
    setPaynowPolling(false);
    // Fresh per attempt — collapses a double-click or retried request onto one payment
    // instead of posting it twice (server enforces this via a unique constraint).
    setPaymentIdempotencyKey(crypto.randomUUID());
  };

  const handleOpenPaymentDialog = () => {
    resetPaymentForm();
    setShowPaymentDialog(true);
  };

  const paynowMethods = ["ecocash", "onemoney", "innbucks", "omari", "visa_mastercard"];

  // Wrapped for PolicyPremiumReceiptDialog's onInitiatePaynow prop — same 2-step create-intent-
  // then-initiate flow as before, but takes its inputs as an argument instead of reading closure
  // state (the dialog now owns the resolved policy/amount/method/reference).
  const paynowInitiateMutation = useMutation({
    mutationFn: async (ctx: { policyId: string; clientId?: string; amount: string; currency: string; method: string; reference: string }) => {
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: ctx.policyId,
        clientId: ctx.clientId,
        amount: ctx.amount,
        currency: ctx.currency,
        purpose: "premium",
      });
      const intent = await intentRes.json();
      if (intent.message) throw new Error(intent.message);
      setPaynowIntentId(intent.id);
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
        toast({ title: "InnBucks code ready", description: "Give the client the authorization code shown." });
      } else if (ctx.method === "omari" && data.needsOtp) {
        toast({ title: "OTP sent", description: "Ask the client for the OTP sent to their phone." });
      } else if (data.redirectUrl) {
        window.open(data.redirectUrl, "_blank");
        toast({ title: "Redirect opened", description: "Card payment page opened in new tab." });
      } else {
        toast({ title: "USSD sent", description: "Client should receive a prompt on their phone to approve the payment." });
      }
      return data;
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const paynowOtpMutation = useMutation({
    mutationFn: async (otp: string) => {
      if (!paynowIntentId) throw new Error("No payment intent");
      const res = await apiRequest("POST", `/api/payment-intents/${paynowIntentId}/otp`, { otp });
      const data = await res.json() as { paid?: boolean; message?: string };
      if (data.message) {
        toast({ title: "OTP error", description: data.message, variant: "destructive" });
      } else if (data.paid) {
        queryClient.invalidateQueries({ queryKey: QK_PAYMENTS });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
        setShowPaymentDialog(false);
        resetPaymentForm();
        toast({ title: "Payment successful", description: "Payment has been completed and receipt generated." });
      } else {
        toast({ title: "OTP accepted", description: "Payment is being processed..." });
      }
      return data;
    },
    onError: (e: Error) => toast({ title: "OTP failed", description: e.message, variant: "destructive" }),
  });

  // Poll Paynow payment status
  const { data: paynowPollData } = useQuery({
    queryKey: ["paynow-poll", paynowIntentId],
    queryFn: async () => {
      if (!paynowIntentId) return null;
      const res = await apiRequest("POST", `/api/payment-intents/${paynowIntentId}/poll`, {});
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!paynowIntentId && paynowPolling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!paynowPollData) return;
    if (paynowPollData.paid || paynowPollData.status === "paid") {
      setPaynowPolling(false);
      queryClient.invalidateQueries({ queryKey: QK_PAYMENTS });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
      setShowPaymentDialog(false);
      resetPaymentForm();
      toast({ title: "Payment successful", description: "Paynow payment confirmed. Receipt generated." });
    }
    if (paynowPollData.status === "failed") {
      setPaynowPolling(false);
      toast({ title: "Payment failed", description: "The payment was declined or cancelled.", variant: "destructive" });
    }
  }, [paynowPollData]);

  const getClient = (clientId: string) => clientMap[clientId];
  const getPolicyNumber = (policyId: string) => {
    const pol = policies.find((p: any) => p.id === policyId);
    return pol?.policyNumber || policyId?.slice(0, 8);
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={commissionOnly ? "My Commissions" : "Finance"}
          description={commissionOnly ? "View your commission earnings and history" : "Payments, receipts, cashups, and commissions"}
          titleDataTestId="text-finance-title"
          actions={(
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5 shadow-sm">
                    <FileDown className="h-4 w-4" /> Blank Forms <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/payment-receipt"} target="_blank" rel="noopener noreferrer">Payment Receipt</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/cashup-sheet"} target="_blank" rel="noopener noreferrer">Daily Cashup Sheet</a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/requisition-form"} target="_blank" rel="noopener noreferrer">Requisition Form</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/expenditure-voucher"} target="_blank" rel="noopener noreferrer">Expenditure Voucher</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canWriteFinance && (
                <Button onClick={handleOpenPaymentDialog} data-testid="button-new-payment">
                  <Plus className="h-4 w-4 mr-2" />Receipt a Policy
                </Button>
              )}
            </div>
          )}
        />

        {!commissionOnly && (
        <>
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">Total Receipted period:</span>
          <PeriodSelector value={receiptedPeriod} onChange={setReceiptedPeriod} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiStatCard label="Total Payments" value={<span data-testid="text-payment-count">{paymentsSummary?.totalCount ?? payments.length}</span>} icon={DollarSign} />
          <KpiStatCard
            label="Total Receipted"
            value={<span data-testid="text-total-cleared" className="text-lg">{loadingReceiptedPeriod ? <Loader2 className="h-4 w-4 animate-spin" /> : totalClearedLabel}</span>}
            icon={CheckCircle2}
          />
          <KpiStatCard label="Commission Configs" value={commissionConfigs.length} icon={TrendingUp} />
          {!isAgent && <KpiStatCard label="Expenditures" value={expenditures.length} icon={Wallet} />}
        </div>
        </>
        )}

        {!isAgent && !commissionOnly && (
          <AiInsightsPanel surface="finance" title="AI Insights" description="Ask AI to summarize the financial position and flag anything unusual." />
        )}

        {(() => {
          // visibleTabDefs is computed once inside useFinancePermissions (see
          // resolveTab there) — reused here rather than recomputed, so deep-link
          // validation and this render can never disagree about which tabs are visible.
          const visibleGroups = FINANCE_GROUP_ORDER.filter((g) => visibleTabDefs.some((t) => t.group === g));
          const activeGroup = visibleTabDefs.find((t) => t.value === activeTab)?.group ?? visibleGroups[0];
          return (
            <div className="space-y-3">
              {visibleGroups.length > 1 && (
                <div className="flex flex-wrap gap-1.5 border-b pb-2" role="tablist" aria-label="Finance sections">
                  {visibleGroups.map((g) => {
                    const meta = FINANCE_GROUP_META[g];
                    const isActiveGroup = g === activeGroup;
                    return (
                      <button
                        key={g}
                        type="button"
                        role="tab"
                        aria-selected={isActiveGroup}
                        data-testid={`group-${g}`}
                        onClick={() => {
                          const firstTab = visibleTabDefs.find((t) => t.group === g);
                          if (firstTab) handleTabChange(firstTab.value);
                        }}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                          isActiveGroup ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        <meta.icon className="h-4 w-4" />
                        {meta.label}
                        {g === "approvals" && pendingApprovalsCount > 0 && (
                          <Badge variant={isActiveGroup ? "secondary" : "default"} className="ml-0.5 h-5 min-w-5 justify-center px-1.5 text-[11px]">
                            {pendingApprovalsCount}
                          </Badge>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              <Tabs value={activeTab} onValueChange={handleTabChange}>
                <TabsList>
                  {visibleTabDefs.filter((t) => t.group === activeGroup).map((t) => (
                    <TabsTrigger key={t.value} value={t.value} data-testid={`tab-${t.value}`} title={t.title}>
                      {t.label}
                    </TabsTrigger>
                  ))}
                </TabsList>

                <PaymentsTab policies={policies} clientMap={clientMap} getClient={getClient} getPolicyNumber={getPolicyNumber} onOpenPaymentDialog={handleOpenPaymentDialog} />

                <TabsContent value="receipting-by-staff">
                  <ReceiptingByStaffPanel />
                </TabsContent>

                <PaynowTab policies={policies} clientMap={clientMap} getClient={getClient} getPolicyNumber={getPolicyNumber} isAgent={isAgent} />

                <CashupsTab authUser={authUser} canWriteFinance={canWriteFinance} />

                <CommissionsTab />

                <FxRatesTab fxRateMap={fxRateMap} />

                <MyPnlTab commissionOnly={commissionOnly} />

                <RequisitionsTab
                  authUser={authUser}
                  canReadFinance={canReadFinance}
                  canWriteFinance={canWriteFinance}
                  canApproveFinance={canApproveFinance}
                  canDeleteRequisition={canDeleteRequisition}
                  canBackdatePayment={canBackdatePayment}
                  canEditPayment={canEditPayment}
                  staffUsers={payDialog.staffUsers}
                  openPayDialog={payDialog.openPayDialog}
                />

                <ExpendituresTab canWriteFinance={canWriteFinance} canDeleteExpenditure={canDeleteExpenditure} openPayDialog={payDialog.openPayDialog} />

                <PlatformTab />

                <MonthEndTab />

                <GroupReceiptTab />

                <ApprovalsTab />

                <BankingTab />
              </Tabs>
            </div>
          );
        })()}
      </PageShell>

      <PolicyPremiumReceiptDialog
        open={showPaymentDialog}
        onOpenChange={(open) => { setShowPaymentDialog(open); if (!open) resetPaymentForm(); }}
        policyMode="search"
        onPolicyResolved={(p) => setPaymentDialogPolicyNumber(p?.policyNumber || "")}
        getClientLabel={(clientId) => { const c = getClient(clientId); return c ? `${c.firstName} ${c.lastName}` : null; }}
        currency={paymentCurrency} onCurrencyChange={setPaymentCurrency}
        enablePaynow isAgent={isAgent}
        paymentMethod={paymentMethod} onPaymentMethodChange={setPaymentMethod}
        reference={paymentReference} onReferenceChange={setPaymentReference}
        notes={paymentNotes} onNotesChange={setPaymentNotes}
        onSubmitCash={(payload) => createPaymentMutation.mutate({
          policyId: payload.policyId,
          clientId: payload.clientId,
          amount: payload.amount,
          currency: payload.currency,
          paymentMethod: "cash",
          status: "cleared",
          reference: payload.reference,
          notes: payload.notes,
          idempotencyKey: paymentIdempotencyKey,
        })}
        isSubmittingCash={createPaymentMutation.isPending}
        onInitiatePaynow={(ctx) => paynowInitiateMutation.mutateAsync(ctx).catch((e: Error) => ({ message: e.message }))}
        isInitiatingPaynow={paynowInitiateMutation.isPending}
        onVerifyOtp={(otp) => paynowOtpMutation.mutateAsync(otp).catch((e: Error) => ({ message: e.message }))}
        isVerifyingOtp={paynowOtpMutation.isPending}
        pollStatus={paynowPollData ? { paid: paynowPollData.paid, status: paynowPollData.status } : null}
        isPolling={paynowPolling}
        onIsPollingChange={setPaynowPolling}
        onValidationError={(title, description) => toast({ title, description, variant: "destructive" })}
        title="Receipt a Policy Payment"
      />

      {payDialog.PayDialog}

      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Payment Receipted Successfully
            </DialogTitle>
          </DialogHeader>
          {receiptResult && (
            <div className="space-y-4">
              {receiptResult.receipt && (
                <div className="bg-green-100 dark:bg-green-950/40 border border-green-300 dark:border-green-800 rounded-lg px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-xs text-green-700 dark:text-green-400 font-medium uppercase tracking-wide">Receipt Number</p>
                    <p className="text-xl font-bold font-mono text-green-800 dark:text-green-300" data-testid="text-receipt-number">
                      {formatReceiptNumber(receiptResult.receipt.receiptNumber)}
                    </p>
                  </div>
                  <Receipt className="h-8 w-8 text-green-600/50" />
                </div>
              )}
              <div className="rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-900 p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Policy</span>
                  <span className="font-mono text-sm font-medium" data-testid="text-receipt-policy">
                    {receiptResult.policyId ? getPolicyNumber(receiptResult.policyId) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Amount</span>
                  <span className="font-semibold" data-testid="text-receipt-amount">
                    {receiptResult.currency} {parseFloat(receiptResult.amount).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Method</span>
                  <Badge variant="outline">{receiptResult.paymentMethod}</Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Status</span>
                  <Badge variant="default">Cleared</Badge>
                </div>
                {receiptResult.reference && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Reference</span>
                    <span className="font-mono text-xs">{receiptResult.reference}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-muted-foreground">Date</span>
                  <span className="text-sm">{new Date(receiptResult.receivedAt).toLocaleString()}</span>
                </div>
                {receiptResult.receipt && (
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Issued At</span>
                    <span className="text-sm">{new Date(receiptResult.receipt.issuedAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                An immutable receipt has been generated automatically. This entry cannot be edited — corrections must be made via reversal entries.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowReceiptDialog(false)} data-testid="button-close-receipt">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
