import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge, KpiStatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Plus, Receipt, Wallet, TrendingUp, Loader2, Search, CheckCircle2, AlertCircle, FileText, Landmark, Clock, CalendarDays, ArrowUpRight, RefreshCw } from "lucide-react";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { PolicySearchInput } from "@/components/policy-search-input";
import { useAuth } from "@/hooks/use-auth";
import { CurrencySelect } from "@/components/currency-select";
import { formatAmount } from "@shared/validation";

function MonthEndRunUpload({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const mutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Select a file");
      const form = new FormData();
      form.set("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/month-end-run", { method: "POST", headers, body: form, credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => { setFile(null); onSuccess(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const creditApplyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/apply-credit-balances");
      const data = await res.json() as { applied: number; errors: string[] };
      return data;
    },
    onSuccess: (data) => {
      const applied = data?.applied ?? 0;
      const errCount = data?.errors?.length ?? 0;
      toast({ title: "Credit balance run complete", description: `Applied to ${applied} policies.${errCount ? ` ${errCount} errors.` : ""}` });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
      <div>
        <Label>CSV file</Label>
        <Input type="file" accept=".csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
      </div>
      <Button onClick={() => mutation.mutate()} disabled={!file || mutation.isPending} data-testid="button-run-month-end">
        {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
        Run
      </Button>
      {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => creditApplyMutation.mutate()} disabled={creditApplyMutation.isPending} data-testid="button-apply-credit-balances">
          {creditApplyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Apply credit balances (due premiums)
        </Button>
        <span className="text-xs text-muted-foreground">Runs auto-apply of credit balance to policies with due premium.</span>
      </div>
    </div>
  );
}

function GroupReceiptForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [groupId, setGroupId] = useState("");
  const [policyIds, setPolicyIds] = useState<Set<string>>(new Set());
  const [totalAmount, setTotalAmount] = useState("");
  const [paynowIntentId, setPaynowIntentId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  const { data: groups = [] } = useQuery<any[]>({ queryKey: ["/api/groups"] });
  const { data: paynowConfig } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/paynow-config"], retry: false });
  const { data: groupPolicies = [] } = useQuery<any[]>({
    queryKey: ["/api/groups", groupId, "policies"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/groups/${groupId}/policies`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!groupId,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/group-receipt", { groupId, policyIds: Array.from(policyIds), totalAmount: parseFloat(totalAmount), currency: "USD" });
    },
    onSuccess: () => { setPolicyIds(new Set()); setTotalAmount(""); onSuccess(); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const paynowMutation = useMutation({
    mutationFn: async () => {
      const createRes = await apiRequest("POST", "/api/group-payment-intents", {
        groupId,
        policyIds: Array.from(policyIds),
        totalAmount: parseFloat(totalAmount),
        currency: "USD",
      });
      const createJson = await createRes.json() as { id: string };
      const intentId = createJson.id;
      const initRes = await apiRequest("POST", `/api/group-payment-intents/${intentId}/initiate`, { method: "visa_mastercard" });
      const initJson = await initRes.json() as { redirectUrl?: string; pollUrl?: string };
      return { intentId, redirectUrl: initJson.redirectUrl, pollUrl: initJson.pollUrl };
    },
    onSuccess: (data) => {
      setPaynowIntentId(data.intentId);
      if (data.redirectUrl) window.open(data.redirectUrl, "_blank");
      setPolling(true);
    },
    onError: (e: Error) => toast({ title: "PayNow error", description: e.message, variant: "destructive" }),
  });
  const pollQuery = useQuery<{ status: string; paid?: boolean } | null>({
    queryKey: ["/api/group-payment-intents", paynowIntentId, "poll"],
    queryFn: async () => {
      if (!paynowIntentId) return null;
      const pollHeaders: Record<string, string> = {};
      const pollCsrf = getCsrfToken();
      if (pollCsrf) pollHeaders["X-XSRF-TOKEN"] = pollCsrf;
      const res = await fetch(getApiBase() + `/api/group-payment-intents/${paynowIntentId}/poll`, { method: "POST", headers: pollHeaders, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!paynowIntentId && polling,
    refetchInterval: (q) => (q.state.data?.paid === true || q.state.data?.status === "failed" ? false : 3000),
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!polling || !pollQuery.data) return;
    if (pollQuery.data.paid) {
      setPolling(false);
      setPaynowIntentId(null);
      setPolicyIds(new Set());
      setTotalAmount("");
      toast({ title: "Group PayNow payment received" });
      onSuccess();
    } else if (pollQuery.data.status === "failed") {
      setPolling(false);
      toast({ title: "Payment failed", variant: "destructive" });
    }
  }, [polling, pollQuery.data, onSuccess, toast]);
  const togglePolicy = (id: string) => {
    setPolicyIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  return (
    <div className="space-y-4">
      <div>
        <Label>Group</Label>
        <Select value={groupId} onValueChange={(g) => { setGroupId(g); setPolicyIds(new Set()); setPaynowIntentId(null); setPolling(false); }}>
          <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select group" /></SelectTrigger>
          <SelectContent>
            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {groupId && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Policies (select to include)</Label>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-0.5" onClick={() => {
                if (policyIds.size === groupPolicies.length) {
                  setPolicyIds(new Set());
                } else {
                  setPolicyIds(new Set(groupPolicies.map((p: any) => p.id)));
                }
              }}>
                {policyIds.size === groupPolicies.length ? "Deselect all" : "Select all"}
              </Button>
            </div>
            <div className="border rounded-md p-2 max-h-48 overflow-auto space-y-1">
              {groupPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No policies in this group.</p>
              ) : (
                groupPolicies.map((p: any) => (
                  <label key={p.id} className="flex items-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors">
                    <input type="checkbox" checked={policyIds.has(p.id)} onChange={() => togglePolicy(p.id)} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm font-medium">{p.policyNumber}</span>
                        <Badge variant="outline" className="text-xs">{p.status}</Badge>
                        <span className="text-sm font-semibold ml-auto">{p.currency} {p.premiumAmount}</span>
                      </div>
                      {(p.clientFirstName || p.clientLastName) && (
                        <p className="text-sm text-muted-foreground mt-0.5">
                          {p.clientFirstName} {p.clientLastName}
                          {p.clientPhone && <span className="ml-2">{p.clientPhone}</span>}
                          {p.clientNationalId && <span className="ml-2 font-mono text-xs">ID: {p.clientNationalId}</span>}
                        </p>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
          <div>
            <Label>Total amount</Label>
            <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="Total to split" className="max-w-xs" />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => mutation.mutate()} disabled={policyIds.size === 0 || !totalAmount || mutation.isPending} data-testid="button-submit-group-receipt">
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Receipt selected ({policyIds.size} policies)
            </Button>
            {paynowConfig?.enabled && (
              <Button variant="outline" onClick={() => paynowMutation.mutate()} disabled={policyIds.size === 0 || !totalAmount || paynowMutation.isPending || polling}>
                {paynowMutation.isPending || polling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {polling ? "Waiting for PayNow…" : "Pay with PayNow"}
              </Button>
            )}
          </div>
          {polling && paynowIntentId && (
            <p className="text-sm text-muted-foreground">Complete payment in the opened window. This page will update when payment is received.</p>
          )}
          {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
        </>
      )}
    </div>
  );
}

export default function StaffFinance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { roles, permissions, user: authUser } = useAuth();
  const isAgent = roles.some((r) => r.name === "agent");
  const canReadFinance = permissions.includes("read:finance");
  const canWriteFinance = permissions.includes("write:finance");
  const canReadCommission = permissions.includes("read:commission");
  const commissionOnly = canReadCommission && !canReadFinance;
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [policySearch, setPolicySearch] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("USD");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [receiptResult, setReceiptResult] = useState<any>(null);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [showSettlementDialog, setShowSettlementDialog] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementCurrency, setSettlementCurrency] = useState("USD");
  const [settlementMethod, setSettlementMethod] = useState("bank");
  const [settlementReference, setSettlementReference] = useState("");

  const [showCashReceiptDialog, setShowCashReceiptDialog] = useState(false);
  const [cashReceiptSelectedPolicyId, setCashReceiptSelectedPolicyId] = useState<string>("");
  const [cashReceiptPolicySearch, setCashReceiptPolicySearch] = useState("");
  const [cashReceiptSelectedPolicy, setCashReceiptSelectedPolicy] = useState<any>(null);
  const [cashReceiptAmount, setCashReceiptAmount] = useState("");
  const [cashReceiptCurrency, setCashReceiptCurrency] = useState("USD");
  const [cashReceiptNotes, setCashReceiptNotes] = useState("");
  const [cashReceiptReceivedAt, setCashReceiptReceivedAt] = useState(new Date().toISOString().slice(0, 16));
  const [reprintReceiptId, setReprintReceiptId] = useState("");
  const [pollingIntentId, setPollingIntentId] = useState<string | null>(null);

  // Paynow flow state for receipt dialog
  const [paynowIntentId, setPaynowIntentId] = useState<string | null>(null);
  const [paynowPolling, setPaynowPolling] = useState(false);
  const [paynowInnbucksCode, setPaynowInnbucksCode] = useState("");
  const [paynowInnbucksExpiry, setPaynowInnbucksExpiry] = useState("");
  const [paynowNeedsOtp, setPaynowNeedsOtp] = useState(false);
  const [paynowOtpRef, setPaynowOtpRef] = useState("");
  const [paynowOtp, setPaynowOtp] = useState("");
  const [paynowPhase, setPaynowPhase] = useState<"select" | "waiting">("select");

  const [cashupStatusFilter, setCashupStatusFilter] = useState<string>("");
  const [showCreateCashupDialog, setShowCreateCashupDialog] = useState(false);
  const [createCashupDate, setCreateCashupDate] = useState(new Date().toISOString().slice(0, 10));
  const [createCashupBranchId, setCreateCashupBranchId] = useState("");
  const [createCashupAmounts, setCreateCashupAmounts] = useState<Record<string, string>>({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" });
  const [createCashupCurrency, setCreateCashupCurrency] = useState("USD");
  const [createCashupTransactionCount, setCreateCashupTransactionCount] = useState("");
  const [createCashupNotes, setCreateCashupNotes] = useState("");
  const [showConfirmCashupDialog, setShowConfirmCashupDialog] = useState(false);
  const [confirmCashup, setConfirmCashup] = useState<any>(null);
  const [confirmCountedTotal, setConfirmCountedTotal] = useState("");
  const [confirmDiscrepancyNotes, setConfirmDiscrepancyNotes] = useState("");

  const { data: rawPayments, isLoading: loadingPayments } = useQuery<any[]>({ queryKey: ["/api/payments"] });
  const { data: rawCashups } = useQuery<any[]>({
    queryKey: ["/api/cashups", cashupStatusFilter],
    queryFn: async () => {
      const url = getApiBase() + "/api/cashups" + (cashupStatusFilter ? `?status=${encodeURIComponent(cashupStatusFilter)}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });
  const { data: branchesList = [] } = useQuery<any[]>({ queryKey: ["/api/branches"] });
  const branchesArr = Array.isArray(branchesList) ? branchesList : [];
  const { data: rawProducts } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: rawCommissionLedger } = useQuery<any[]>({ queryKey: ["/api/commission-ledger"] });
  const { data: rawExpenditures } = useQuery<any[]>({ queryKey: ["/api/expenditures"] });
  const { data: rawPolicies } = useQuery<any[]>({ queryKey: ["/api/policies"] });
  const { data: rawClients } = useQuery<any[]>({ queryKey: ["/api/clients"] });
  const payments = Array.isArray(rawPayments) ? rawPayments : [];
  const cashups = Array.isArray(rawCashups) ? rawCashups : [];
  const products = Array.isArray(rawProducts) ? rawProducts : [];
  const { data: rawProductVersions } = useQuery<any[]>({ queryKey: ["/api/product-versions"] });
  const productVersions = Array.isArray(rawProductVersions) ? rawProductVersions : [];
  const commissionConfigs = productVersions
    .filter((v: any) => v.commissionFirstMonthsRate || v.commissionRecurringRate)
    .map((v: any) => {
      const product = products.find((p: any) => p.id === v.productId);
      return { ...v, productName: product?.name || "Unknown" };
    });
  const commissionLedger = Array.isArray(rawCommissionLedger) ? rawCommissionLedger : [];
  const expenditures = Array.isArray(rawExpenditures) ? rawExpenditures : [];
  const policies = Array.isArray(rawPolicies) ? rawPolicies : [];
  const clients = Array.isArray(rawClients) ? rawClients : [];
  const { data: selectedPolicyData } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicyId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!selectedPolicyId,
  });
  const { data: cashReceiptPolicyData } = useQuery<any>({
    queryKey: ["/api/policies", cashReceiptSelectedPolicyId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${cashReceiptSelectedPolicyId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!cashReceiptSelectedPolicyId,
  });
  const { data: rawPlatformReceivables } = useQuery<any[]>({ queryKey: ["/api/platform/receivables"] });
  const { data: platformSummary } = useQuery<{ totalDue: string; totalSettled: string; outstanding: string }>({ queryKey: ["/api/platform/summary"] });
  const { data: rawSettlements } = useQuery<any[]>({ queryKey: ["/api/settlements"] });
  const { data: rawPaymentIntents, isLoading: loadingIntents, refetch: refetchIntents } = useQuery<any[]>({ queryKey: ["/api/payment-intents"] });
  const platformReceivables = Array.isArray(rawPlatformReceivables) ? rawPlatformReceivables : [];
  const settlements = Array.isArray(rawSettlements) ? rawSettlements : [];
  const paymentIntents = Array.isArray(rawPaymentIntents) ? rawPaymentIntents : [];

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const filteredPolicies = useMemo(() => {
    if (!policySearch.trim()) return [];
    const q = policySearch.toLowerCase();
    return policies.filter((p: any) => {
      const client = clientMap[p.clientId];
      const clientName = client ? `${client.firstName} ${client.lastName}`.toLowerCase() : "";
      return (
        (p.policyNumber || "").toLowerCase().includes(q) ||
        clientName.includes(q)
      );
    }).slice(0, 8);
  }, [policySearch, policies, clientMap]);

  const receiptDialogPolicy = selectedPolicyData ?? selectedPolicy;
  const cashReceiptDialogPolicy = cashReceiptPolicyData ?? cashReceiptSelectedPolicy;

  const filteredPoliciesForCash = useMemo(() => {
    if (!cashReceiptPolicySearch.trim()) return [];
    const q = cashReceiptPolicySearch.toLowerCase();
    return policies.filter((p: any) => {
      const client = clientMap[p.clientId];
      const clientName = client ? `${client.firstName} ${client.lastName}`.toLowerCase() : "";
      return (
        (p.policyNumber || "").toLowerCase().includes(q) ||
        clientName.includes(q)
      );
    }).slice(0, 8);
  }, [cashReceiptPolicySearch, policies, clientMap]);

  const totalCleared = useMemo(() => {
    return payments
      .filter((p: any) => p.status === "cleared")
      .reduce((sum: number, p: any) => sum + parseFloat(p.amount || "0"), 0);
  }, [payments]);

  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setShowPaymentDialog(false);
      resetPaymentForm();
      setReceiptResult(result);
      setShowReceiptDialog(true);
      toast({ title: "Payment recorded & receipt generated", description: `Receipt for ${receiptDialogPolicy?.policyNumber || "policy"}` });
    },
    onError: (err: any) => toast({
      title: "Payment failed",
      description: err.message?.includes("duplicate") || err.message?.includes("constraint")
        ? "A duplicate payment may have been submitted. Please check your payments list before trying again."
        : (err.message || "Please try again. If the problem persists, contact support."),
      variant: "destructive",
    }),
  });

  const cashReceiptMutation = useMutation({
    mutationFn: async () => {
      const autoAmount = cashReceiptDialogPolicy?.premiumAmount ? parseFloat(cashReceiptDialogPolicy.premiumAmount).toFixed(2) : cashReceiptAmount;
      const res = await apiRequest("POST", "/api/admin/receipts/cash", {
        policyId: cashReceiptDialogPolicy?.id,
        amount: autoAmount,
        currency: cashReceiptCurrency,
        notes: cashReceiptNotes || undefined,
        receivedAt: cashReceiptReceivedAt ? new Date(cashReceiptReceivedAt).toISOString() : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
      setShowCashReceiptDialog(false);
      setCashReceiptSelectedPolicyId("");
      setCashReceiptSelectedPolicy(null);
      setCashReceiptAmount("");
      setCashReceiptNotes("");
      setCashReceiptReceivedAt(new Date().toISOString().slice(0, 16));
      toast({ title: "Cash receipt recorded", description: "Receipt generated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const reprintMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/receipts/reprint", { receiptId: reprintReceiptId });
      return res.json();
    },
    onSuccess: () => {
      setReprintReceiptId("");
      toast({ title: "Reprint logged", description: "Audit log updated." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createCashupMutation = useMutation({
    mutationFn: async (data: { cashupDate: string; branchId?: string; currency: string; amountsByMethod: Record<string, string>; transactionCount: number; notes?: string }) => {
      const res = await apiRequest("POST", "/api/cashups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashups"] });
      setShowCreateCashupDialog(false);
      setCreateCashupAmounts({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" });
      setCreateCashupCurrency("USD");
      setCreateCashupTransactionCount("");
      setCreateCashupNotes("");
      toast({ title: "Cashup draft created", description: "Submit to finance when ready." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const submitCashupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/cashups/${id}`, { action: "submit" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashups"] });
      toast({ title: "Cashup submitted", description: "Finance will count and confirm." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmCashupMutation = useMutation({
    mutationFn: async ({ id, countedTotal, discrepancyNotes }: { id: string; countedTotal?: string; discrepancyNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/cashups/${id}`, {
        action: "confirm",
        countedTotal: countedTotal ? parseFloat(countedTotal) : undefined,
        discrepancyNotes: discrepancyNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cashups"] });
      setShowConfirmCashupDialog(false);
      setConfirmCashup(null);
      setConfirmCountedTotal("");
      setConfirmDiscrepancyNotes("");
      toast({ title: "Cashup confirmed", description: "Reconciliation recorded." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const pollIntentMutation = useMutation({
    mutationFn: async (intentId: string) => {
      const res = await apiRequest("POST", `/api/payment-intents/${intentId}/poll`);
      return res.json();
    },
    onMutate: (intentId) => setPollingIntentId(intentId),
    onSettled: () => setPollingIntentId(null),
    onSuccess: (_, intentId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({ title: "Status updated", description: "Payment intent status refreshed." });
    },
    onError: (e: any) => toast({ title: "Poll failed", description: e.message, variant: "destructive" }),
  });

  const resetPaymentForm = () => {
    setSelectedPolicyId("");
    setPolicySearch("");
    setSelectedPolicy(null);
    setPaymentAmount("");
    setPaymentCurrency("USD");
    setPaymentMethod(isAgent ? "ecocash" : "cash");
    setPaymentReference("");
    setPaymentNotes("");
    setPaynowIntentId(null);
    setPaynowPolling(false);
    setPaynowInnbucksCode("");
    setPaynowInnbucksExpiry("");
    setPaynowNeedsOtp(false);
    setPaynowOtpRef("");
    setPaynowOtp("");
    setPaynowPhase("select");
  };

  const platformDailyDue = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    return platformReceivables
      .filter((r: any) => !r.isSettled && r.createdAt?.startsWith(today))
      .reduce((sum: number, r: any) => sum + parseFloat(r.amount || "0"), 0);
  }, [platformReceivables]);

  const platformMTD = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    return platformReceivables
      .filter((r: any) => r.createdAt >= monthStart)
      .reduce((sum: number, r: any) => sum + parseFloat(r.amount || "0"), 0);
  }, [platformReceivables]);

  const platformAging = useMemo(() => {
    const now = Date.now();
    const unsettled = platformReceivables.filter((r: any) => !r.isSettled);
    const buckets = { current: 0, days30: 0, days60: 0, days90plus: 0 };
    unsettled.forEach((r: any) => {
      const age = (now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const amt = parseFloat(r.amount || "0");
      if (age <= 30) buckets.current += amt;
      else if (age <= 60) buckets.days30 += amt;
      else if (age <= 90) buckets.days60 += amt;
      else buckets.days90plus += amt;
    });
    return buckets;
  }, [platformReceivables]);

  const createSettlementMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/settlements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/summary"] });
      setShowSettlementDialog(false);
      setSettlementAmount("");
      setSettlementReference("");
      toast({ title: "Settlement recorded", description: "Pending approval from a second user." });
    },
    onError: (err: any) => toast({ title: "Settlement failed", description: err.message, variant: "destructive" }),
  });

  const approveSettlementMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/settlements/${id}/approve`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settlements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/receivables"] });
      toast({ title: "Settlement approved" });
    },
    onError: (err: any) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
  });

  const handleOpenPaymentDialog = () => {
    resetPaymentForm();
    setShowPaymentDialog(true);
  };

  const paynowMethods = ["ecocash", "onemoney", "innbucks", "omari", "visa_mastercard"];

  const paynowInitiateMutation = useMutation({
    mutationFn: async () => {
      if (!receiptDialogPolicy) throw new Error("No policy selected");
      const autoAmount = receiptDialogPolicy.premiumAmount ? parseFloat(receiptDialogPolicy.premiumAmount).toFixed(2) : paymentAmount;
      // Step 1: Create intent
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: receiptDialogPolicy.id,
        clientId: receiptDialogPolicy.clientId,
        amount: autoAmount,
        currency: paymentCurrency,
        purpose: "premium",
      });
      const intent = await intentRes.json();
      if (intent.message) throw new Error(intent.message);
      setPaynowIntentId(intent.id);
      // Step 2: Initiate Paynow
      const initRes = await apiRequest("POST", `/api/payment-intents/${intent.id}/initiate`, {
        method: paymentMethod,
        payerPhone: ["ecocash", "onemoney", "innbucks", "omari"].includes(paymentMethod) ? paymentReference : undefined,
        payerEmail: paymentMethod === "visa_mastercard" ? paymentReference : undefined,
      });
      return initRes.json() as Promise<{
        redirectUrl?: string; pollUrl?: string; message?: string;
        innbucksCode?: string; innbucksExpiry?: string;
        omariOtpReference?: string; needsOtp?: boolean;
      }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "Error", description: data.message, variant: "destructive" });
        return;
      }
      setPaynowPhase("waiting");

      if (paymentMethod === "innbucks" && data.innbucksCode) {
        setPaynowInnbucksCode(data.innbucksCode);
        setPaynowInnbucksExpiry(data.innbucksExpiry || "");
        setPaynowPolling(true);
        toast({ title: "InnBucks code ready", description: "Give the client the authorization code shown." });
        return;
      }
      if (paymentMethod === "omari" && data.needsOtp) {
        setPaynowNeedsOtp(true);
        setPaynowOtpRef(data.omariOtpReference || "");
        toast({ title: "OTP sent", description: "Ask the client for the OTP sent to their phone." });
        return;
      }
      if (data.redirectUrl) {
        window.open(data.redirectUrl, "_blank");
        setPaynowPolling(true);
        toast({ title: "Redirect opened", description: "Card payment page opened in new tab." });
        return;
      }
      setPaynowPolling(true);
      toast({ title: "USSD sent", description: "Client should receive a prompt on their phone to approve the payment." });
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const paynowOtpMutation = useMutation({
    mutationFn: async () => {
      if (!paynowIntentId) throw new Error("No payment intent");
      const res = await apiRequest("POST", `/api/payment-intents/${paynowIntentId}/otp`, { otp: paynowOtp });
      return res.json() as Promise<{ paid?: boolean; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.message) {
        toast({ title: "OTP error", description: data.message, variant: "destructive" });
        return;
      }
      if (data.paid) {
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payment-intents"] });
        setShowPaymentDialog(false);
        resetPaymentForm();
        toast({ title: "Payment successful", description: "Payment has been completed and receipt generated." });
      } else {
        setPaynowPolling(true);
        setPaynowNeedsOtp(false);
        toast({ title: "OTP accepted", description: "Payment is being processed..." });
      }
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
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
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

  const handleSubmitPayment = () => {
    if (!receiptDialogPolicy) {
      toast({ title: "Select a policy", description: "Search and select the policy you're receipting.", variant: "destructive" });
      return;
    }
    const autoAmount = receiptDialogPolicy.premiumAmount ? parseFloat(receiptDialogPolicy.premiumAmount).toFixed(2) : paymentAmount;
    if (!autoAmount || parseFloat(autoAmount) <= 0) {
      toast({ title: "No premium", description: "Policy has no premium set.", variant: "destructive" });
      return;
    }

    if (paymentMethod === "cash") {
      createPaymentMutation.mutate({
        policyId: receiptDialogPolicy.id,
        clientId: receiptDialogPolicy.clientId,
        amount: autoAmount,
        currency: paymentCurrency,
        paymentMethod: paymentMethod,
        status: "cleared",
        reference: paymentReference || undefined,
        notes: paymentNotes || undefined,
      });
    } else {
      if (!paymentReference || paymentReference.trim().length < 5) {
        const label = paymentMethod === "visa_mastercard" ? "email address" : "mobile number";
        toast({ title: `Enter ${label}`, description: `Required for ${paymentMethod === "visa_mastercard" ? "card" : "mobile"} payment.`, variant: "destructive" });
        return;
      }
      paynowInitiateMutation.mutate();
    }
  };

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
          actions={canWriteFinance ? (
            <Button onClick={handleOpenPaymentDialog} data-testid="button-new-payment">
              <Plus className="h-4 w-4 mr-2" />Receipt a Policy
            </Button>
          ) : undefined}
        />

        {!commissionOnly && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiStatCard label="Total Payments" value={<span data-testid="text-payment-count">{payments.length}</span>} icon={DollarSign} />
          <KpiStatCard label="Total Receipted" value={<span data-testid="text-total-cleared">{paymentCurrency} {totalCleared.toFixed(2)}</span>} icon={CheckCircle2} />
          <KpiStatCard label="Commission Configs" value={commissionConfigs.length} icon={TrendingUp} />
          <KpiStatCard label="Expenditures" value={expenditures.length} icon={Wallet} />
        </div>
        )}

        <Tabs defaultValue={commissionOnly ? "commissions" : "payments"}>
          <TabsList>
            {!commissionOnly && <TabsTrigger value="payments" data-testid="tab-payments">Payments & Receipts</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="paynow" data-testid="tab-paynow">Paynow & Cash</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="cashups" data-testid="tab-cashups">Cashups</TabsTrigger>}
            {canReadCommission && <TabsTrigger value="commissions" data-testid="tab-commissions">Commissions</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="expenditures" data-testid="tab-expenditures">Expenditures</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="platform" data-testid="tab-platform">POL263</TabsTrigger>}
            {canWriteFinance && <TabsTrigger value="month-end" data-testid="tab-month-end">Month-end run</TabsTrigger>}
            {canWriteFinance && <TabsTrigger value="group-receipt" data-testid="tab-group-receipt">Group receipt</TabsTrigger>}
          </TabsList>

          <TabsContent value="payments">
            <CardSection title="Payment transactions" description="Receipted movements linked to policies and clients." icon={Receipt} flush>
                {loadingPayments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payments.length === 0 ? (
                  <EmptyState
                    icon={Receipt}
                    title="No payments recorded yet"
                    description='Click "Receipt a Policy" above to record the first payment.'
                    className="border-0 rounded-none bg-transparent py-10"
                    action={<Button variant="outline" size="sm" onClick={handleOpenPaymentDialog}><Plus className="h-4 w-4 mr-2" />Record first payment</Button>}
                  />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p: any) => {
                        const client = p.clientId ? getClient(p.clientId) : null;
                        return (
                          <TableRow key={p.id} className="hover:bg-muted/40" data-testid={`row-payment-${p.id}`}>
                            <TableCell className="font-mono text-sm tabular-nums">{p.policyId ? getPolicyNumber(p.policyId) : "—"}</TableCell>
                            <TableCell>{client ? `${client.firstName} ${client.lastName}` : "—"}</TableCell>
                            <TableCell className="font-semibold text-right tabular-nums">{p.currency} {parseFloat(p.amount || "0").toFixed(2)}</TableCell>
                            <TableCell><Badge variant="outline">{p.paymentMethod}</Badge></TableCell>
                            <TableCell>
                              <StatusBadge
                                variant="payment"
                                status={p.status}
                                label={p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : undefined}
                              />
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{p.reference || "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground tabular-nums">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="paynow">
            <CardSection
              title="Payment intents (Paynow)"
              description="Online collection attempts and manual cash receipt logging."
              icon={Landmark}
              headerRight={!isAgent ? (
                  <Button variant="outline" size="sm" onClick={() => { setShowCashReceiptDialog(true); setCashReceiptPolicySearch(""); setCashReceiptSelectedPolicy(null); setCashReceiptAmount(""); setCashReceiptCurrency("USD"); setCashReceiptNotes(""); }}>
                    Record cash receipt
                  </Button>
              ) : undefined}
              contentClassName="space-y-4"
            >
                {loadingIntents ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : paymentIntents.length === 0 ? (
                  <EmptyState title="No payment intents yet" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <DataTable>
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Created</TableHead>
                        <TableHead className="w-[100px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paymentIntents.map((pi: any) => (
                        <TableRow key={pi.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm tabular-nums">{getPolicyNumber(pi.policyId)}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{pi.currency} {parseFloat(pi.amount || "0").toFixed(2)}</TableCell>
                          <TableCell>
                            <Badge variant={pi.status === "paid" ? "default" : pi.status === "failed" ? "destructive" : "secondary"}>{pi.status}</Badge>
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{pi.merchantReference || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground tabular-nums">{new Date(pi.createdAt).toLocaleString()}</TableCell>
                          <TableCell>
                            {pi.status === "pending_paynow" && (
                              <Button variant="ghost" size="sm" disabled={pollIntentMutation.isPending && pollingIntentId === pi.id} onClick={() => pollIntentMutation.mutate(pi.id)}>
                                {pollingIntentId === pi.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
                <Separator />
                <div className="flex flex-wrap items-center gap-4">
                  <Label className="text-sm">Reprint receipt</Label>
                  <Input placeholder="Receipt ID" className="max-w-[200px]" value={reprintReceiptId} onChange={(e) => setReprintReceiptId(e.target.value)} />
                  <Button variant="outline" size="sm" disabled={!reprintReceiptId || reprintMutation.isPending} onClick={() => reprintMutation.mutate()}>
                    {reprintMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Log reprint
                  </Button>
                </div>
            </CardSection>
          </TabsContent>

          <TabsContent value="cashups">
            <CardSection
              title="Daily cashups"
              description="Submit your receipted totals by payment method for finance to count and confirm. Cashups include cash and mobile/card payments you have receipted."
              icon={CalendarDays}
              headerRight={(
                  <div className="flex flex-wrap items-center gap-2">
                    <Select value={cashupStatusFilter || "all"} onValueChange={(v) => setCashupStatusFilter(v === "all" ? "" : v)}>
                      <SelectTrigger className="w-[140px]" data-testid="select-cashup-status">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="confirmed">Confirmed</SelectItem>
                        <SelectItem value="discrepancy">Discrepancy</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button size="sm" onClick={() => { setShowCreateCashupDialog(true); setCreateCashupDate(new Date().toISOString().slice(0, 10)); setCreateCashupAmounts({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" }); setCreateCashupCurrency("USD"); setCreateCashupTransactionCount(""); setCreateCashupNotes(""); }} data-testid="button-new-cashup">
                      <Plus className="h-4 w-4 mr-1" /> New cashup
                    </Button>
                  </div>
              )}
              flush
            >
                {cashups.length === 0 ? (
                  <EmptyState title="No cashups yet" description="Create a draft, enter amounts by method (or load from your receipts), then submit to finance." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Ccy</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>By method</TableHead>
                        <TableHead>Txns</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Prepared by</TableHead>
                        <TableHead className="w-[140px]">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashups.map((c: any) => {
                        const am = c.amountsByMethod || {};
                        const methodSummary = ["cash", "paynow_ecocash", "paynow_card", "other"]
                          .filter((k) => parseFloat(am[k] || "0") > 0)
                          .map((k) => `${k === "cash" ? "Cash" : k === "paynow_ecocash" ? "Mobile" : k === "paynow_card" ? "Card" : "Other"}: ${parseFloat(am[k] || "0").toFixed(2)}`)
                          .join("; ") || "—";
                        const isMine = authUser?.id && c.preparedBy === authUser.id;
                        return (
                          <TableRow key={c.id} data-testid={`row-cashup-${c.id}`}>
                            <TableCell className="font-mono text-sm">{c.cashupDate}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{c.currency || "USD"}</Badge></TableCell>
                            <TableCell className="font-semibold">{formatAmount(c.totalAmount, c.currency || "USD")}</TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={methodSummary}>{methodSummary}</TableCell>
                            <TableCell>{c.transactionCount}</TableCell>
                            <TableCell>
                              <Badge variant={c.status === "confirmed" ? "default" : c.status === "discrepancy" ? "secondary" : c.status === "submitted" ? "outline" : "secondary"}>
                                {c.status === "draft" ? "Draft" : c.status === "submitted" ? "Submitted" : c.status === "confirmed" ? "Confirmed" : c.status === "discrepancy" ? "Discrepancy" : c.status || "—"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground">{isMine ? "You" : (c.preparedBy || "").slice(0, 8) + "…"}</TableCell>
                            <TableCell>
                              {c.status === "draft" && isMine && (
                                <div className="flex gap-1">
                                  <Button size="sm" variant="outline" onClick={() => submitCashupMutation.mutate(c.id)} disabled={submitCashupMutation.isPending} data-testid={`btn-submit-cashup-${c.id}`}>Submit</Button>
                                </div>
                              )}
                              {c.status === "submitted" && canWriteFinance && (
                                <Button size="sm" variant="outline" onClick={() => { setConfirmCashup(c); setConfirmCountedTotal(c.totalAmount || ""); setConfirmDiscrepancyNotes(""); setShowConfirmCashupDialog(true); }} data-testid={`btn-confirm-cashup-${c.id}`}>Confirm</Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>

            <Dialog open={showCreateCashupDialog} onOpenChange={setShowCreateCashupDialog}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>New cashup</DialogTitle></DialogHeader>
                <p className="text-sm text-muted-foreground">Enter amounts you received by payment method for this date. Use &quot;Load from my receipts&quot; to prefill from your issued receipts.</p>
                <div className="space-y-4 pt-2">
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <Label>Date *</Label>
                      <Input type="date" value={createCashupDate} onChange={(e) => setCreateCashupDate(e.target.value)} data-testid="input-cashup-date" />
                    </div>
                    <div>
                      <Label>Currency</Label>
                      <CurrencySelect value={createCashupCurrency} onValueChange={setCreateCashupCurrency} />
                    </div>
                    <div>
                      <Label>Branch</Label>
                      <Select value={createCashupBranchId || "none"} onValueChange={(v) => setCreateCashupBranchId(v === "none" ? "" : v)}>
                        <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          {branchesArr.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Amounts by method</Label>
                      <Button type="button" variant="ghost" size="sm" onClick={async () => {
                        const res = await fetch(getApiBase() + `/api/cashups/my-receipt-totals?date=${encodeURIComponent(createCashupDate)}`, { credentials: "include" });
                        if (!res.ok) return;
                        const data = await res.json();
                        setCreateCashupAmounts(data.amountsByMethod || { cash: "0", paynow_ecocash: "0", paynow_card: "0", other: "0" });
                        setCreateCashupTransactionCount(String(data.transactionCount ?? 0));
                        if (data.currency) setCreateCashupCurrency(data.currency);
                      }} data-testid="button-load-from-receipts">Load from my receipts</Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><Label className="text-xs">Cash</Label><Input type="number" step="0.01" value={createCashupAmounts.cash || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, cash: e.target.value })} placeholder="0" /></div>
                      <div><Label className="text-xs">Mobile (EcoCash/OneMoney)</Label><Input type="number" step="0.01" value={createCashupAmounts.paynow_ecocash || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, paynow_ecocash: e.target.value })} placeholder="0" /></div>
                      <div><Label className="text-xs">Card</Label><Input type="number" step="0.01" value={createCashupAmounts.paynow_card || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, paynow_card: e.target.value })} placeholder="0" /></div>
                      <div><Label className="text-xs">Other</Label><Input type="number" step="0.01" value={createCashupAmounts.other || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, other: e.target.value })} placeholder="0" /></div>
                    </div>
                  </div>
                  <div>
                    <Label>Transaction count</Label>
                    <Input type="number" min={0} value={createCashupTransactionCount} onChange={(e) => setCreateCashupTransactionCount(e.target.value)} data-testid="input-cashup-txn-count" />
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input value={createCashupNotes} onChange={(e) => setCreateCashupNotes(e.target.value)} placeholder="Optional" />
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setShowCreateCashupDialog(false)}>Cancel</Button>
                  <Button onClick={() => {
                    const total = Object.values(createCashupAmounts).reduce((s, v) => s + (parseFloat(v || "0") || 0), 0);
                    if (total <= 0) { toast({ title: "Enter at least one amount", variant: "destructive" }); return; }
                    createCashupMutation.mutate({
                      cashupDate: createCashupDate,
                      branchId: createCashupBranchId || undefined,
                      currency: createCashupCurrency,
                      amountsByMethod: createCashupAmounts,
                      transactionCount: parseInt(createCashupTransactionCount, 10) || 0,
                      notes: createCashupNotes || undefined,
                    });
                  }} disabled={createCashupMutation.isPending} data-testid="button-create-cashup">
                    {createCashupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Create draft
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={showConfirmCashupDialog} onOpenChange={(open) => { if (!open) { setShowConfirmCashupDialog(false); setConfirmCashup(null); } setShowConfirmCashupDialog(open); }}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader><DialogTitle>Confirm cashup</DialogTitle></DialogHeader>
                {confirmCashup && (
                  <>
                    <p className="text-sm text-muted-foreground">Expected total: <strong>{formatAmount(confirmCashup.totalAmount, confirmCashup.currency || "USD")}</strong> {confirmCashup.currency && confirmCashup.currency !== "USD" ? <Badge variant="outline" className="ml-1 text-xs">{confirmCashup.currency}</Badge> : null} ({confirmCashup.transactionCount} transactions). Enter counted total and any discrepancy notes.</p>
                    <div className="space-y-4 pt-2">
                      <div>
                        <Label>Counted total</Label>
                        <Input type="number" step="0.01" value={confirmCountedTotal} onChange={(e) => setConfirmCountedTotal(e.target.value)} placeholder={confirmCashup.totalAmount} data-testid="input-confirm-counted-total" />
                      </div>
                      <div>
                        <Label>Discrepancy notes (if any)</Label>
                        <Input value={confirmDiscrepancyNotes} onChange={(e) => setConfirmDiscrepancyNotes(e.target.value)} placeholder="Optional" />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setShowConfirmCashupDialog(false)}>Cancel</Button>
                      <Button onClick={() => confirmCashupMutation.mutate({ id: confirmCashup.id, countedTotal: confirmCountedTotal || undefined, discrepancyNotes: confirmDiscrepancyNotes || undefined })} disabled={confirmCashupMutation.isPending} data-testid="button-confirm-cashup">
                        {confirmCashupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                        Confirm
                      </Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          <TabsContent value="commissions">
            <div className="space-y-6">
              {(() => {
                const newBusiness = commissionLedger.filter((e: any) => e.entryType === "first_months");
                const existingBusiness = commissionLedger.filter((e: any) => e.entryType === "recurring");
                const clawbacks = commissionLedger.filter((e: any) => e.entryType === "clawback");
                const rollbacks = commissionLedger.filter((e: any) => e.entryType === "rollback");
                const sumOf = (arr: any[]) => arr.reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
                const newBizTotal = sumOf(newBusiness);
                const existBizTotal = sumOf(existingBusiness);
                const clawbackTotal = sumOf(clawbacks);
                const rollbackTotal = sumOf(rollbacks);
                const netTotal = newBizTotal + existBizTotal + clawbackTotal + rollbackTotal;
                const defaultCurrency = commissionLedger[0]?.currency || "USD";
                const fmt = (v: number) => `${defaultCurrency} ${Math.abs(v).toFixed(2)}`;

                return (
                  <>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                      <KpiStatCard label="New Business" value={<span className="text-blue-700" data-testid="stat-comm-new-biz">{fmt(newBizTotal)}</span>} hint={`${newBusiness.length} entries`} className="bg-blue-50 dark:bg-blue-950/20 border-blue-200" />
                      <KpiStatCard label="Existing Business" value={<span className="text-emerald-700" data-testid="stat-comm-existing-biz">{fmt(existBizTotal)}</span>} hint={`${existingBusiness.length} entries`} className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200" />
                      <KpiStatCard label="Clawbacks" value={<span className="text-red-700" data-testid="stat-comm-clawbacks">{clawbackTotal !== 0 ? `−${fmt(clawbackTotal)}` : fmt(0)}</span>} hint={`${clawbacks.length} entries`} className="bg-red-50 dark:bg-red-950/20 border-red-200" />
                      <KpiStatCard label="Rollbacks" value={<span className="text-amber-700" data-testid="stat-comm-rollbacks">{fmt(rollbackTotal)}</span>} hint={`${rollbacks.length} entries`} className="bg-amber-50 dark:bg-amber-950/20 border-amber-200" />
                      <KpiStatCard label="Total Commissions" value={<span className={netTotal < 0 ? "text-red-600" : "text-indigo-700"} data-testid="stat-comm-total">{netTotal < 0 ? `−${fmt(netTotal)}` : fmt(netTotal)}</span>} hint={`${commissionLedger.length} entries`} className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
                    </div>
                  </>
                );
              })()}

              <CardSection
                title="Commission rates (from product versions)"
                description="Commission rates are configured when creating product versions in the Products section."
                icon={FileText}
                flush
              >
                  {commissionConfigs.length === 0 ? (
                    <EmptyState title="No commission rates yet" description="Go to Products to set commission rates on a product version." className="border-0 rounded-none bg-transparent py-8" />
                  ) : (
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead>Product</TableHead>
                          <TableHead>Version</TableHead>
                          <TableHead>New Business Rate</TableHead>
                          <TableHead>Recurring Rate</TableHead>
                          <TableHead>Clawback Threshold</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {commissionConfigs.map((v: any) => (
                          <TableRow key={v.id} className="hover:bg-muted/40">
                            <TableCell className="font-medium">{v.productName}</TableCell>
                            <TableCell>v{v.version}</TableCell>
                            <TableCell>{v.commissionFirstMonthsRate}% for {v.commissionFirstMonthsCount ?? "—"} months</TableCell>
                            <TableCell>{v.commissionRecurringRate}% from month {v.commissionRecurringStartMonth ?? "—"}</TableCell>
                            <TableCell>{v.commissionClawbackThreshold ?? "—"} payments</TableCell>
                            <TableCell><Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  )}
              </CardSection>

              <CardSection title="Commission ledger" description="Auto-calculated when payments are receipted for policies with agents." icon={TrendingUp} flush>
                  {commissionLedger.length === 0 ? (
                    <EmptyState title="No commission entries yet" description="Commissions appear here after receipted payments on agent-linked policies." className="border-0 rounded-none bg-transparent py-8" />
                  ) : (
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead>Policy</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Payment Date</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Description</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {commissionLedger.map((entry: any) => {
                          const typeLabel =
                            entry.entryType === "first_months" ? "New Business" :
                            entry.entryType === "recurring" ? "Existing Business" :
                            entry.entryType === "clawback" ? "Clawback" :
                            entry.entryType === "rollback" ? "Rollback" :
                            entry.entryType;
                          const typeBadgeVariant =
                            entry.entryType === "clawback" ? "destructive" as const :
                            entry.entryType === "rollback" ? "secondary" as const :
                            "outline" as const;
                          const amountVal = parseFloat(entry.amount || "0");
                          const isNegative = amountVal < 0;
                          return (
                            <TableRow key={entry.id} className="hover:bg-muted/40">
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString()}</TableCell>
                              <TableCell>
                                {entry.clientFirstName ? (
                                  <div>
                                    <p className="text-sm font-medium">{entry.clientFirstName} {entry.clientLastName}</p>
                                    {entry.clientPhone && <p className="text-[10px] text-muted-foreground">{entry.clientPhone}</p>}
                                  </div>
                                ) : "—"}
                              </TableCell>
                              <TableCell className="font-mono text-sm">{entry.policyNumber || (entry.policyId ? entry.policyId.slice(0, 8) : "—")}</TableCell>
                              <TableCell className="text-sm">{entry.agentDisplayName || entry.agentEmail || "—"}</TableCell>
                              <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                {entry.paymentDate ? new Date(entry.paymentDate).toLocaleDateString() : "—"}
                              </TableCell>
                              <TableCell>
                                <Badge variant={typeBadgeVariant}>{typeLabel}</Badge>
                              </TableCell>
                              <TableCell className={`font-semibold tabular-nums text-right ${isNegative ? "text-red-600" : ""}`}>
                                {isNegative ? "−" : ""}{entry.currency} {Math.abs(amountVal).toFixed(2)}
                              </TableCell>
                              <TableCell className="text-sm max-w-[200px] truncate">{entry.description || "—"}</TableCell>
                              <TableCell>
                                <Badge variant={entry.status === "earned" ? "default" : entry.status === "paid" ? "default" : "secondary"}>
                                  {entry.status}
                                </Badge>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </DataTable>
                  )}
              </CardSection>
            </div>
          </TabsContent>

          <TabsContent value="expenditures">
            <CardSection title="Expenditures" description="Operational spend recorded against the organization." icon={Wallet} flush>
                {expenditures.length === 0 ? (
                  <EmptyState title="No expenditures yet" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenditures.map((e: any) => (
                        <TableRow key={e.id} className="hover:bg-muted/40">
                          <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                          <TableCell>{e.description}</TableCell>
                          <TableCell className="font-semibold text-right tabular-nums">{e.currency} {e.amount}</TableCell>
                          <TableCell className="text-sm text-muted-foreground tabular-nums">{e.spentAt || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="platform">
            <div className="space-y-6">
              <CardSection
                title="POL263 Revenue Share (2.5%)"
                description="Auto-calculated on every cleared payment"
                icon={Landmark}
                headerRight={(
                  <Button onClick={() => setShowSettlementDialog(true)} data-testid="button-new-settlement">
                    <Plus className="h-4 w-4 mr-2" />Record Settlement
                  </Button>
                )}
              >
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <KpiStatCard
                    label="Daily Due"
                    value={<span data-testid="text-platform-daily">{platformDailyDue.toFixed(2)}</span>}
                    icon={CalendarDays}
                  />
                  <KpiStatCard
                    label="MTD Accrued"
                    value={<span data-testid="text-platform-mtd">{platformMTD.toFixed(2)}</span>}
                    icon={TrendingUp}
                  />
                  <KpiStatCard
                    label="Outstanding"
                    value={
                      <span data-testid="text-platform-outstanding">
                        {platformSummary ? parseFloat(platformSummary.outstanding).toFixed(2) : "0.00"}
                      </span>
                    }
                    icon={ArrowUpRight}
                  />
                  <KpiStatCard
                    label="Total Settled"
                    value={
                      <span data-testid="text-platform-settled">
                        {platformSummary ? parseFloat(platformSummary.totalSettled).toFixed(2) : "0.00"}
                      </span>
                    }
                    icon={CheckCircle2}
                  />
                </div>
              </CardSection>

              <CardSection title="Aging buckets" description="Outstanding platform fee by age." icon={Clock}>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-950/20">
                    <p className="text-xs text-muted-foreground mb-1">0–30 Days</p>
                    <p className="text-xl font-bold text-green-700 dark:text-green-400 tabular-nums" data-testid="text-aging-current">{platformAging.current.toFixed(2)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                    <p className="text-xs text-muted-foreground mb-1">31–60 Days</p>
                    <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400 tabular-nums" data-testid="text-aging-30">{platformAging.days30.toFixed(2)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20">
                    <p className="text-xs text-muted-foreground mb-1">61–90 Days</p>
                    <p className="text-xl font-bold text-orange-700 dark:text-orange-400 tabular-nums" data-testid="text-aging-60">{platformAging.days60.toFixed(2)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
                    <p className="text-xs text-muted-foreground mb-1">90+ Days</p>
                    <p className="text-xl font-bold text-red-700 dark:text-red-400 tabular-nums" data-testid="text-aging-90plus">{platformAging.days90plus.toFixed(2)}</p>
                  </div>
                </div>
              </CardSection>

              <CardSection title="Settlements" description="Recorded settlements against platform revenue." icon={Receipt} flush>
                {settlements.length === 0 ? (
                  <EmptyState title="No settlements yet" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.map((s: any) => (
                        <TableRow key={s.id} className="hover:bg-muted/40" data-testid={`row-settlement-${s.id}`}>
                          <TableCell className="text-sm">{new Date(s.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="font-semibold text-right tabular-nums">{s.currency} {parseFloat(s.amount).toFixed(2)}</TableCell>
                          <TableCell><Badge variant="outline">{s.method}</Badge></TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">{s.reference || "—"}</TableCell>
                          <TableCell>
                            <Badge variant={s.status === "approved" ? "default" : s.status === "rejected" ? "destructive" : "secondary"}>
                              {s.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {s.status === "pending" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => approveSettlementMutation.mutate(s.id)}
                                disabled={approveSettlementMutation.isPending}
                                data-testid={`button-approve-settlement-${s.id}`}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
              </CardSection>

              <CardSection title="Receivables" description="Auto-created when payments are cleared." icon={FileText} flush>
                {platformReceivables.length === 0 ? (
                  <EmptyState
                    title="No receivables yet"
                    description="They are created automatically when payments are cleared."
                    className="border-0 rounded-none bg-transparent py-8"
                  />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {platformReceivables.map((r: any) => (
                        <TableRow key={r.id} className="hover:bg-muted/40" data-testid={`row-receivable-${r.id}`}>
                          <TableCell className="text-sm">{new Date(r.createdAt).toLocaleDateString()}</TableCell>
                          <TableCell className="text-sm">{r.description || "—"}</TableCell>
                          <TableCell className="font-semibold text-right tabular-nums">{parseFloat(r.amount).toFixed(2)}</TableCell>
                          <TableCell>{r.currency}</TableCell>
                          <TableCell>
                            <Badge variant={r.isSettled ? "default" : "secondary"}>
                              {r.isSettled ? "Settled" : "Outstanding"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
              </CardSection>
            </div>
          </TabsContent>

          <TabsContent value="month-end">
            <CardSection
              title="Month-end run"
              description="Upload a CSV with policy_number, amount, currency. Policies with sufficient amount are receipted; underpayments go to policy credit balance and a credit note is issued."
              icon={FileText}
            >
              <div className="flex items-center gap-4">
                <Button variant="outline" asChild>
                  <a href={getApiBase() + "/api/month-end-run/template"} download="month-end-run-template.csv" data-testid="button-download-month-end-template">
                    Download template
                  </a>
                </Button>
              </div>
              <MonthEndRunUpload onSuccess={() => { toast({ title: "Month-end run completed" }); queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); }} />
            </CardSection>
          </TabsContent>

          <TabsContent value="group-receipt">
            <CardSection
              title="Group receipt"
              description="Select a group and policies to receipt at once. Total amount is split by premium proportion."
              icon={Receipt}
            >
              <GroupReceiptForm onSuccess={() => { toast({ title: "Group receipted" }); queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); }} />
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipt a Policy Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <Label className="text-sm font-medium">Search Policy</Label>
              <PolicySearchInput
                value={selectedPolicyId}
                onChange={(id, p) => {
                  setSelectedPolicyId(id);
                  setSelectedPolicy(p ? { id: p.id, policyNumber: p.policyNumber, clientId: p.clientId, status: p.status } : null);
                }}
                placeholder="Type policy number or client name..."
                data-testid="input-policy-search"
              />
            </div>

            {receiptDialogPolicy && (
              <div className="rounded-lg bg-muted/40 border border-dashed p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono font-semibold text-sm" data-testid="text-selected-policy">{receiptDialogPolicy.policyNumber}</p>
                    {getClient(receiptDialogPolicy.clientId) && (
                      <p className="text-sm text-muted-foreground">
                        {getClient(receiptDialogPolicy.clientId).firstName} {getClient(receiptDialogPolicy.clientId).lastName}
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <Badge variant={receiptDialogPolicy.status === "active" ? "default" : "secondary"}>{receiptDialogPolicy.status}</Badge>
                    {receiptDialogPolicy.premiumAmount && (
                      <p className="text-xs text-muted-foreground mt-1">
                        Premium: {formatAmount(receiptDialogPolicy.premiumAmount, receiptDialogPolicy.premiumCurrency)}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount (auto from policy premium)</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={receiptDialogPolicy?.premiumAmount ? parseFloat(receiptDialogPolicy.premiumAmount).toFixed(2) : paymentAmount}
                  readOnly
                  className="bg-muted cursor-not-allowed"
                  data-testid="input-payment-amount"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencySelect value={paymentCurrency} onValueChange={setPaymentCurrency} />
              </div>
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
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

            {paynowPhase === "select" && (
              <>
                {(paymentMethod === "ecocash" || paymentMethod === "onemoney") && (
                  <div>
                    <Label>Client's Mobile Number (EcoCash/OneMoney)</Label>
                    <Input placeholder="e.g. 0771234567" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
                    <p className="text-xs text-muted-foreground mt-1">EcoCash/OneMoney use USSD — a prompt is sent to this number. The client enters their PIN on their phone (no app push). Use the number registered with EcoCash/OneMoney.</p>
                  </div>
                )}
                {paymentMethod === "innbucks" && (
                  <div>
                    <Label>Client's Mobile Number</Label>
                    <Input placeholder="e.g. 0771234567" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
                    <p className="text-xs text-muted-foreground mt-1">An authorization code will be generated. The client enters it in their InnBucks app.</p>
                  </div>
                )}
                {paymentMethod === "omari" && (
                  <div>
                    <Label>Client's Mobile Number</Label>
                    <Input placeholder="e.g. 0771234567" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
                    <p className="text-xs text-muted-foreground mt-1">An OTP will be sent via SMS. You will need to enter the OTP the client receives.</p>
                  </div>
                )}
                {paymentMethod === "visa_mastercard" && (
                  <div>
                    <Label>Client's Email Address</Label>
                    <Input type="email" placeholder="client@example.com" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
                    <p className="text-xs text-muted-foreground mt-1">A secure payment page will open where the client enters card details.</p>
                  </div>
                )}
                {paymentMethod === "cash" && (
                  <div>
                    <Label>Notes (optional)</Label>
                    <Input placeholder="e.g. Walk-in payment" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} data-testid="input-payment-reference" />
                    <p className="text-xs text-muted-foreground mt-1">Receipt number is auto-generated by the system.</p>
                  </div>
                )}

                <div>
                  <Label>Notes (optional)</Label>
                  <Input placeholder="Additional notes..." value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} data-testid="input-payment-notes" />
                </div>
              </>
            )}

            {paynowPhase === "waiting" && (
              <>
                {paynowInnbucksCode && (
                  <div className="p-4 rounded-lg border-2 border-blue-300 bg-blue-50 space-y-3">
                    <p className="font-semibold text-blue-900">InnBucks Authorization Code</p>
                    <p className="text-3xl font-mono font-bold text-center tracking-widest text-blue-800">{paynowInnbucksCode}</p>
                    {paynowInnbucksExpiry && <p className="text-xs text-blue-700 text-center">Expires: {paynowInnbucksExpiry}</p>}
                    <div className="text-sm text-blue-800">
                      <p className="font-medium">Give this code to the client:</p>
                      <ol className="list-decimal list-inside space-y-1 mt-1">
                        <li>Open the <strong>InnBucks</strong> app</li>
                        <li>Go to <strong>Payments</strong></li>
                        <li>Enter the code above</li>
                        <li>Confirm the payment</li>
                      </ol>
                    </div>
                    {paynowPolling && (
                      <div className="flex items-center justify-center gap-2 text-sm text-blue-700">
                        <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation...
                      </div>
                    )}
                  </div>
                )}

                {paynowNeedsOtp && (
                  <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3">
                    <p className="font-semibold text-amber-900">Enter O'Mari OTP</p>
                    <p className="text-sm text-amber-800">Ask the client for the OTP sent to their phone via SMS.</p>
                    {paynowOtpRef && <p className="text-xs text-amber-700">Reference: {paynowOtpRef}</p>}
                    <Input
                      placeholder="Enter OTP"
                      value={paynowOtp}
                      onChange={(e) => setPaynowOtp(e.target.value)}
                      maxLength={10}
                      className="text-center text-lg font-mono tracking-widest"
                    />
                    <Button
                      className="w-full"
                      disabled={!paynowOtp || paynowOtp.trim().length < 4 || paynowOtpMutation.isPending}
                      onClick={() => paynowOtpMutation.mutate()}
                    >
                      {paynowOtpMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Verify OTP
                    </Button>
                  </div>
                )}

                {!paynowInnbucksCode && !paynowNeedsOtp && paynowPolling && (
                  <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50 space-y-3 text-center">
                    <Loader2 className="h-8 w-8 animate-spin mx-auto text-green-700" />
                    <p className="font-semibold text-green-900">
                      {paymentMethod === "visa_mastercard" ? "Waiting for card payment..." : "Waiting for client to approve on their phone..."}
                    </p>
                    <p className="text-sm text-green-800">
                      {paymentMethod === "visa_mastercard"
                        ? "The client should complete payment in the card payment page that was opened."
                        : "EcoCash/OneMoney use USSD — the client should see a prompt on their phone to enter their PIN. If nothing appears within 30 seconds, check the mobile number is correct (e.g. 0771234567) and try again."}
                    </p>
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => { setShowPaymentDialog(false); resetPaymentForm(); }}>Cancel</Button>
            {paynowPhase === "select" && (
              <Button
                onClick={handleSubmitPayment}
                disabled={
                  !receiptDialogPolicy ||
                  (!receiptDialogPolicy?.premiumAmount && !paymentAmount) ||
                  createPaymentMutation.isPending ||
                  paynowInitiateMutation.isPending ||
                  (["ecocash", "onemoney"].includes(paymentMethod) && (!paymentReference || paymentReference.trim().replace(/\D/g, "").length < 9))
                }
                data-testid="button-submit-payment"
              >
                {(createPaymentMutation.isPending || paynowInitiateMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                <Receipt className="h-4 w-4 mr-2" />
                {paymentMethod === "cash" ? "Record Payment & Generate Receipt" : "Send Payment Request"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCashReceiptDialog} onOpenChange={setShowCashReceiptDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record cash receipt</DialogTitle>
            <p className="text-sm text-muted-foreground">Record a manual cash payment and generate a receipt (no Paynow).</p>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Policy</Label>
              <PolicySearchInput
                value={cashReceiptSelectedPolicyId}
                onChange={(id) => {
                  setCashReceiptSelectedPolicyId(id);
                  setCashReceiptSelectedPolicy(id ? { id } : null);
                }}
                placeholder="Search by policy number or client..."
              />
              {cashReceiptDialogPolicy && <p className="text-xs text-muted-foreground mt-1">Selected: {cashReceiptDialogPolicy.policyNumber}</p>}
            </div>
            <div>
              <Label>Amount (auto from policy premium)</Label>
              <Input type="number" step="0.01" placeholder="0.00" value={cashReceiptDialogPolicy?.premiumAmount ? parseFloat(cashReceiptDialogPolicy.premiumAmount).toFixed(2) : cashReceiptAmount} readOnly className="bg-muted cursor-not-allowed" />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={cashReceiptCurrency} onValueChange={setCashReceiptCurrency} />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input placeholder="e.g. Cash at branch" value={cashReceiptNotes} onChange={(e) => setCashReceiptNotes(e.target.value)} />
            </div>
            <div>
              <Label>Received at</Label>
              <Input type="datetime-local" value={cashReceiptReceivedAt} onChange={(e) => setCashReceiptReceivedAt(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCashReceiptDialog(false)}>Cancel</Button>
            <Button
              disabled={!cashReceiptDialogPolicy || (!cashReceiptDialogPolicy.premiumAmount && (!cashReceiptAmount || parseFloat(cashReceiptAmount) <= 0)) || cashReceiptMutation.isPending}
              onClick={() => cashReceiptMutation.mutate()}
            >
              {cashReceiptMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record & generate receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showSettlementDialog} onOpenChange={setShowSettlementDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record POL263 Settlement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={settlementAmount}
                onChange={(e) => setSettlementAmount(e.target.value)}
                data-testid="input-settlement-amount"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={settlementCurrency} onValueChange={setSettlementCurrency} />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select value={settlementMethod} onValueChange={setSettlementMethod}>
                <SelectTrigger data-testid="select-settlement-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="omari">O'Mari</SelectItem>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference</Label>
              <Input
                placeholder="Payment reference..."
                value={settlementReference}
                onChange={(e) => setSettlementReference(e.target.value)}
                data-testid="input-settlement-reference"
              />
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Settlement requires approval from a second user (maker-checker)
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettlementDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!settlementAmount || parseFloat(settlementAmount) <= 0) {
                  toast({ title: "Enter amount", variant: "destructive" });
                  return;
                }
                createSettlementMutation.mutate({
                  amount: settlementAmount,
                  currency: settlementCurrency,
                  method: settlementMethod,
                  reference: settlementReference || undefined,
                });
              }}
              disabled={!settlementAmount || createSettlementMutation.isPending}
              data-testid="button-submit-settlement"
            >
              {createSettlementMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record Settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
