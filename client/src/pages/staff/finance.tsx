import { useState, useMemo, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Plus, Receipt, Wallet, TrendingUp, Loader2, Search, CheckCircle2, AlertCircle, FileText, Landmark, Clock, CalendarDays, ArrowUpRight, RefreshCw, FileDown, ChevronDown, ChevronRight, ShieldCheck, ShieldX, Building2, ArrowDownToLine, Banknote, TriangleAlert, Printer, Users } from "lucide-react";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { formatReceiptNumber } from "@/lib/assetUrl";
import { PolicySearchInput } from "@/components/policy-search-input";
import { useAuth } from "@/hooks/use-auth";
import { CurrencySelect } from "@/components/currency-select";
import { formatAmount } from "@shared/validation";
import { isAgentScoped } from "@shared/roles";

function formatCurrencyMap(m: Record<string, string | number> | undefined): string {
  if (!m) return "0.00";
  const entries = Object.entries(m).filter(([, v]) => Number(v) !== 0);
  if (entries.length === 0) return "0.00";
  return entries.map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join("  ·  ");
}

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

function ReceiptingByStaffPanel() {
  const [period, setPeriod] = useState<Period>(() => periodForPreset("today"));

  const { data, isLoading } = useQuery<{
    byUser: Array<{ userId: string | null; displayName: string; currency: string; total: string; count: number }>;
    byBranch: Array<{ branchId: string | null; branchName: string; currency: string; total: string; count: number }>;
    legacyUnattributed: Array<{ currency: string; total: string; count: number }>;
  }>({
    queryKey: ["/api/reports/receipting-by-user", period.from, period.to],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/reports/receipting-by-user?fromDate=${period.from}&toDate=${period.to}`, { credentials: "include" });
      if (!res.ok) return { byUser: [], byBranch: [], legacyUnattributed: [] };
      return res.json();
    },
  });

  return (
    <div className="space-y-6">
      <CardSection
        title="Receipting by staff & branch"
        description="How much each staff member and branch has receipted for the selected period."
        icon={Users}
        headerRight={<PeriodSelector value={period} onChange={setPeriod} />}
      >
        {isLoading ? (
          <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">By staff member</h4>
              {!data?.byUser.length ? (
                <EmptyState title="No receipts in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Staff</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byUser.map((u, i) => (
                      <TableRow key={`${u.userId}-${u.currency}-${i}`}>
                        <TableCell className={!u.userId ? "text-muted-foreground italic" : ""}>{u.displayName}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.currency} {parseFloat(u.total).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{u.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">By branch</h4>
              {!data?.byBranch.length ? (
                <EmptyState title="No receipts in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Branch</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Receipts</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byBranch.map((b, i) => (
                      <TableRow key={`${b.branchId}-${b.currency}-${i}`}>
                        <TableCell className={!b.branchId ? "text-muted-foreground italic" : ""}>{b.branchName}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.currency} {parseFloat(b.total).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.count}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </div>
        )}
        {!!data?.legacyUnattributed.length && (
          <p className="text-xs text-muted-foreground mt-4 pt-4 border-t border-border">
            Plus legacy group receipts in this period ({data.legacyUnattributed.map(l => `${l.currency} ${parseFloat(l.total).toFixed(2)}`).join(", ")}) —
            these can't be attributed to a specific staff member or branch since legacy receipts don't record who entered them.
          </p>
        )}
      </CardSection>
    </div>
  );
}

function PendingApprovalsPanel({ onApproved }: { onApproved: () => void }) {
  const { toast } = useToast();
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const { data: pending = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: ["/api/payment-receipts/pending-approvals"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payment-receipts/pending-approvals", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const actionMutation = useMutation({
    mutationFn: async ({ id, type, note }: { id: string; type: "approve" | "reject"; note: string }) => {
      const res = await apiRequest("POST", `/api/payment-receipts/${id}/${type}`, { approvalNote: note });
      if (!res.ok) { const j = await res.json(); throw new Error(j.message || res.statusText); }
      return res.json();
    },
    onSuccess: (_, vars) => {
      setActionId(null);
      setActionType(null);
      setApprovalNote("");
      refetch();
      onApproved();
      toast({ title: vars.type === "approve" ? "Receipt approved and applied" : "Receipt rejected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openAction = (id: string, type: "approve" | "reject") => {
    setActionId(id);
    setActionType(type);
    setApprovalNote("");
  };

  return (
    <CardSection title="Pending receipt approvals" description="Backdated receipts and premium overrides awaiting approval. Approving applies the payment to the policy and financial statements." icon={Clock}>
      {isLoading ? (
        <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : pending.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="No pending approvals" description="All pending receipts have been reviewed." className="border-0 rounded-none bg-transparent py-10" />
      ) : (
        <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
          <TableHeader className={dataTableStickyHeaderClass}>
            <TableRow>
              <TableHead className="pl-6">Receipt #</TableHead>
              <TableHead>Policy</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Submitter Note</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.map((r: any) => {
              const isOverride = !!r.metadataJson?.premiumOverride;
              return (
              <TableRow key={r.id} data-testid={`row-pending-approval-${r.id}`}>
                <TableCell className="pl-6 font-mono text-sm">{r.receiptNumber}</TableCell>
                <TableCell className="text-sm">{r.policyNumber || r.policyId?.slice(0, 8)}</TableCell>
                <TableCell className="text-sm">{r.clientName || "—"}</TableCell>
                <TableCell className="text-sm">
                  {isOverride
                    ? <span className="text-amber-700">Premium override <span className="text-muted-foreground">(system: {r.currency} {parseFloat(r.metadataJson?.systemPremium ?? 0).toFixed(2)})</span></span>
                    : <span>Backdated to {r.backdatedDate || "—"}</span>}
                </TableCell>
                <TableCell className="text-sm font-medium">{r.currency} {parseFloat(r.amount).toFixed(2)}</TableCell>
                <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate" title={r.submitterNote}>{r.submitterNote || "—"}</TableCell>
                <TableCell className="text-right pr-6">
                  <div className="flex items-center justify-end gap-1">
                    <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50" onClick={() => openAction(r.id, "approve")} data-testid={`btn-approve-${r.id}`}>
                      <ShieldCheck className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => openAction(r.id, "reject")} data-testid={`btn-reject-${r.id}`}>
                      <ShieldX className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
          </TableBody>
        </DataTable>
      )}

      <Dialog open={!!actionId} onOpenChange={(open) => { if (!open) { setActionId(null); setActionType(null); setApprovalNote(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionType === "approve" ? "Approve Receipt" : "Reject Receipt"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionType === "approve" ? (
              <p className="text-sm text-muted-foreground">Approving will apply this backdated payment to the policy and update financial statements. This cannot be undone.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Rejecting will leave the policy unchanged. The submitter should be notified separately.</p>
            )}
            <div className="space-y-1">
              <Label>{actionType === "approve" ? "Approval note *" : "Rejection note *"}</Label>
              <Textarea
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder={actionType === "approve" ? "Note confirming the basis for approval..." : "Reason for rejection..."}
                rows={3}
                data-testid="textarea-approval-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionId(null); setActionType(null); setApprovalNote(""); }}>Cancel</Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              disabled={!approvalNote.trim() || actionMutation.isPending}
              onClick={() => actionMutation.mutate({ id: actionId!, type: actionType!, note: approvalNote })}
              data-testid="btn-confirm-action"
            >
              {actionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionType === "approve" ? "Approve & Apply" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardSection>
  );
}

function GroupReceiptForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [groupId, setGroupId] = useState("");
  const [policyIds, setPolicyIds] = useState<Set<string>>(new Set());
  const [totalAmount, setTotalAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [submitterNote, setSubmitterNote] = useState("");
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
  const today = new Date().toISOString().slice(0, 10);
  const isBackdated = receiptDate < today;
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/group-receipt", {
        groupId,
        policyIds: Array.from(policyIds),
        totalAmount: parseFloat(totalAmount),
        currency: "USD",
        receiptDate,
        notes: notes.trim() || undefined,
        submitterNote: submitterNote.trim() || undefined,
      });
      return res.json() as Promise<{ receipted: number; pendingApproval?: boolean }>;
    },
    onSuccess: (data) => {
      setPolicyIds(new Set());
      setTotalAmount("");
      setReceiptDate(today);
      setNotes("");
      setSubmitterNote("");
      if (data.pendingApproval) {
        toast({ title: "Receipt submitted for approval", description: "A backdated receipt has been queued for manager approval before being applied." });
      } else {
        onSuccess();
      }
    },
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

  const selectedGroup = groups.find((g: any) => g.id === groupId);
  // Legacy groups with no member policies yet are receipted as one lump sum against the
  // group itself (no per-member allocation possible), same as the per-group panel in Groups.
  const isLegacyLumpSum = !!selectedGroup?.isLegacy && groupPolicies.length === 0;
  const [legacyCurrency, setLegacyCurrency] = useState("USD");
  const legacyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/groups/legacy-receipts", {
        groupId, amount: parseFloat(totalAmount), currency: legacyCurrency, paymentDate: receiptDate, notes: notes.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      setTotalAmount(""); setNotes(""); setReceiptDate(today);
      toast({ title: `Receipt ${data.receipt_number} recorded` });
      onSuccess();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div>
        <Label>Group</Label>
        <Select value={groupId} onValueChange={(g) => { setGroupId(g); setPolicyIds(new Set()); setPaynowIntentId(null); setPolling(false); }}>
          <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select group" /></SelectTrigger>
          <SelectContent>
            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}{(g as any).isLegacy ? " (Legacy)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {groupId && isLegacyLumpSum ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            This legacy group has no member policies yet. Record the lump-sum payment here — it will appear in
            financials immediately. Once members are added and given policies, use the member-selection form instead.
          </p>
          <div className="grid grid-cols-3 gap-4 max-w-md">
            <div>
              <Label>Amount</Label>
              <Input type="number" step="0.01" min="0" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Currency</Label>
              <Select value={legacyCurrency} onValueChange={setLegacyCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Receipt date</Label>
              <Input type="date" value={receiptDate} max={today} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
          </div>
          <div className="max-w-md">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. July collection" />
          </div>
          <Button onClick={() => legacyMutation.mutate()} disabled={!totalAmount || parseFloat(totalAmount) <= 0 || legacyMutation.isPending}>
            {legacyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Record Payment
          </Button>
          {legacyMutation.isError && <p className="text-sm text-destructive">{(legacyMutation.error as Error).message}</p>}
        </div>
      ) : groupId && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Members (select who paid)</Label>
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
            <div className="border rounded-md p-2 max-h-56 overflow-auto space-y-1">
              {groupPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No policies in this group.</p>
              ) : (
                groupPolicies.map((p: any) => (
                  <label key={p.id} className="flex items-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors">
                    <input type="checkbox" checked={policyIds.has(p.id)} onChange={() => togglePolicy(p.id)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.clientFirstName || "—"} {p.clientLastName || ""}</span>
                        {!p.clientPhone && !p.clientNationalId && (
                          <Badge variant="secondary" className="text-xs">Legacy</Badge>
                        )}
                        <Badge variant="outline" className="text-xs">{p.status}</Badge>
                        <span className="text-sm font-semibold ml-auto">{p.currency} {parseFloat(p.premiumAmount || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-xs text-muted-foreground">{p.policyNumber}</span>
                        {p.clientPhone && <span className="text-xs text-muted-foreground">{p.clientPhone}</span>}
                        {p.clientNationalId && <span className="font-mono text-xs text-muted-foreground">ID: {p.clientNationalId}</span>}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label>Total amount</Label>
              <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="Total to split" />
            </div>
            <div>
              <Label>Receipt date</Label>
              <Input type="date" value={receiptDate} max={today} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>Receipt notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this receipt session — appear on individual member receipts..."
              rows={2}
              className="text-sm"
              data-testid="textarea-group-receipt-notes"
            />
          </div>
          {isBackdated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Backdated receipt — approval required</p>
              <p className="text-xs text-amber-700 dark:text-amber-500">This receipt will be queued for manager approval before being applied to financial statements.</p>
              <div className="space-y-1">
                <Label className="text-xs">Notes for approver *</Label>
                <Textarea
                  value={submitterNote}
                  onChange={(e) => setSubmitterNote(e.target.value)}
                  placeholder="Explain why this receipt is being backdated..."
                  rows={2}
                  className="text-sm"
                  data-testid="textarea-submitter-note"
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => mutation.mutate()}
              disabled={policyIds.size === 0 || !totalAmount || mutation.isPending || (isBackdated && !submitterNote.trim())}
              data-testid="button-submit-group-receipt"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isBackdated ? `Submit for approval (${policyIds.size} policies)` : `Receipt selected (${policyIds.size} policies)`}
            </Button>
            {!isBackdated && paynowConfig?.enabled && (
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

function PaymentHistoryTable({ disbursements, currency }: { disbursements: any[]; currency: string }) {
  if (disbursements.length === 0) return <p className="text-sm text-muted-foreground py-3">No payments recorded yet.</p>;
  const total = disbursements.reduce((s, d) => s + parseFloat(d.amount || 0), 0);
  return (
    <div className="space-y-2 mt-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Payment History</p>
      <div className="border rounded-md overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4 text-xs">Date</TableHead>
              <TableHead className="text-xs">Amount</TableHead>
              <TableHead className="text-xs">Method</TableHead>
              <TableHead className="text-xs">Paid by</TableHead>
              <TableHead className="text-xs">Received by</TableHead>
              <TableHead className="text-xs">Reference</TableHead>
              <TableHead className="text-xs pr-4 text-right">Voucher</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {disbursements.map((d: any) => (
              <TableRow key={d.id} className="text-xs">
                <TableCell className="pl-4">{d.paidDate}</TableCell>
                <TableCell className="font-semibold tabular-nums">{currency} {parseFloat(d.amount).toFixed(2)}</TableCell>
                <TableCell className="capitalize">{(d.paymentMethod || "cash").replace(/_/g, " ")}</TableCell>
                <TableCell>{d.paidByName || "—"}</TableCell>
                <TableCell>{d.receivedByName || d.receivedBy || "—"}</TableCell>
                <TableCell className="font-mono">{d.reference || "—"}</TableCell>
                <TableCell className="pr-4 text-right">
                  <a href={getApiBase() + `/api/payment-disbursements/${d.id}/pdf`} target="_blank" rel="noopener noreferrer" title="Print payment voucher">
                    <Button size="icon" variant="ghost" className="h-6 w-6" type="button">
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </a>
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/30 font-semibold text-xs">
              <TableCell className="pl-4">Total paid</TableCell>
              <TableCell className="tabular-nums">{currency} {total.toFixed(2)}</TableCell>
              <TableCell colSpan={5} />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function RequisitionPaymentHistory({ requisitionId, currency }: { requisitionId: string; currency: string }) {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/payment-disbursements", { entityType: "requisition", entityId: requisitionId }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/payment-disbursements?entityType=requisition&entityId=${requisitionId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  return <PaymentHistoryTable disbursements={data} currency={currency} />;
}

function ExpenditurePaymentHistory({ expenditureId, currency }: { expenditureId: string; currency: string }) {
  const { data = [] } = useQuery<any[]>({
    queryKey: ["/api/payment-disbursements", { entityType: "expenditure", entityId: expenditureId }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/payment-disbursements?entityType=expenditure&entityId=${expenditureId}`, { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  return <PaymentHistoryTable disbursements={data} currency={currency} />;
}

// ─── Banking & Cash Panel ──────────────────────────────────────────────────
function BankingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // queries
  const { data: cashPosition = [], isLoading: loadingPos } = useQuery<any[]>({
    queryKey: ["/api/cash-position"],
    queryFn: async () => {
      const res = await fetch("/api/cash-position", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-accounts"],
    queryFn: async () => {
      const res = await fetch("/api/bank-accounts", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: bankDeposits = [], isLoading: loadingDeposits } = useQuery<any[]>({
    queryKey: ["/api/bank-deposits"],
    queryFn: async () => {
      const res = await fetch("/api/bank-deposits", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: statementBalances = [] } = useQuery<any[]>({
    queryKey: ["/api/bank-statement-balances"],
    queryFn: async () => {
      const res = await fetch("/api/bank-statement-balances", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });

  // Bank account form
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [accountForm, setAccountForm] = useState({ accountName: "", bankName: "", accountNumber: "", currency: "USD", notes: "" });
  const createAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/bank-accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify(accountForm),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      setShowAccountDialog(false);
      setAccountForm({ accountName: "", bankName: "", accountNumber: "", currency: "USD", notes: "" });
      toast({ title: "Bank account added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Edit bank account
  const [editAccount, setEditAccount] = useState<any | null>(null);
  const [editAccountForm, setEditAccountForm] = useState({ accountName: "", bankName: "", accountNumber: "", currency: "USD", notes: "", isActive: true });
  const updateAccountMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/bank-accounts/${editAccount.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify(editAccountForm),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-accounts"] });
      setEditAccount(null);
      toast({ title: "Bank account updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Deposit form
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [depositForm, setDepositForm] = useState({ bankAccountId: "", amount: "", currency: "USD", depositDate: new Date().toISOString().slice(0, 10), reference: "", notes: "" });
  const createDepositMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/bank-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify(depositForm),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-deposits"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cash-position"] });
      setShowDepositDialog(false);
      setDepositForm({ bankAccountId: "", amount: "", currency: "USD", depositDate: new Date().toISOString().slice(0, 10), reference: "", notes: "" });
      toast({ title: "Deposit recorded" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Verify deposit
  const verifyDepositMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/bank-deposits/${id}/verify`, {
        method: "POST",
        headers: { "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/bank-deposits"] }); toast({ title: "Deposit verified" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Statement balance form
  const [showBalanceDialog, setShowBalanceDialog] = useState(false);
  const [balForm, setBalForm] = useState({ bankAccountId: "", statementDate: new Date().toISOString().slice(0, 10), closingBalance: "", currency: "USD", notes: "" });
  const createBalanceMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/bank-statement-balances", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify(balForm),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bank-statement-balances"] });
      setShowBalanceDialog(false);
      setBalForm({ bankAccountId: "", statementDate: new Date().toISOString().slice(0, 10), closingBalance: "", currency: "USD", notes: "" });
      toast({ title: "Statement balance saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Helper: days since last deposit
  function daysSince(dateStr: string | null) {
    if (!dateStr) return null;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  }

  return (
    <div className="space-y-6">
      {/* ── Per-Admin Cash Position ─────────────────────────── */}
      <CardSection
        title="Admin cash accountability"
        description="Unbanked cash each admin holds, derived from confirmed cashups minus recorded bank deposits."
        icon={Banknote}
        headerRight={
          <Button size="sm" onClick={() => setShowDepositDialog(true)}>
            <ArrowDownToLine className="h-4 w-4 mr-1.5" />
            Record Deposit
          </Button>
        }
      >
        {loadingPos ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : cashPosition.length === 0 ? (
          <EmptyState icon={Banknote} title="No cash activity yet" description="Cash positions appear once admins submit cashups." />
        ) : (
          <DataTable>
            <TableHeader>
              <TableRow>
                <TableHead>Admin</TableHead>
                <TableHead className="text-right">Collected (cashups)</TableHead>
                <TableHead className="text-right">Deposited to bank</TableHead>
                <TableHead className="text-right">On hand (unbanked)</TableHead>
                <TableHead>Last deposit</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cashPosition.map((p: any) => {
                const days = daysSince(p.lastDepositDate);
                const stale = p.onHand > 0 && (days === null || days > 2);
                return (
                  <TableRow key={p.userId} className={stale ? "bg-amber-50/60 dark:bg-amber-900/10" : ""}>
                    <TableCell>
                      <div className="font-medium text-sm">{p.displayName}</div>
                      <div className="text-xs text-muted-foreground">{p.email}</div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-medium">{p.currency} {parseFloat(p.totalCollected).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.currency} {parseFloat(p.totalDeposited).toFixed(2)}</TableCell>
                    <TableCell className="text-right tabular-nums font-semibold">
                      <span className={p.onHand > 0 ? "text-amber-600" : "text-green-600"}>{p.currency} {parseFloat(p.onHand).toFixed(2)}</span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {p.lastDepositDate ? new Date(p.lastDepositDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell>
                      {p.onHand <= 0 ? (
                        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30">Banked</Badge>
                      ) : stale ? (
                        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 gap-1">
                          <TriangleAlert className="h-3 w-3" />
                          {days === null ? "Never banked" : `${days}d unbanked`}
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Pending bank</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        )}
      </CardSection>

      {/* ── Bank Accounts ───────────────────────────────────── */}
      <CardSection
        title="Bank accounts"
        description="Organisation's registered bank accounts for depositing collected premiums."
        icon={Building2}
        headerRight={
          <Button size="sm" variant="outline" onClick={() => setShowAccountDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Account
          </Button>
        }
      >
        {bankAccounts.length === 0 ? (
          <EmptyState icon={Building2} title="No bank accounts" description="Add a bank account to start recording deposits." />
        ) : (
          <DataTable>
            <TableHeader>
              <TableRow>
                <TableHead>Account name</TableHead>
                <TableHead>Bank</TableHead>
                <TableHead>Account #</TableHead>
                <TableHead>Currency</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankAccounts.map((a: any) => {
                const latestBal = statementBalances.find((b: any) => b.bankAccountId === a.id);
                return (
                  <TableRow key={a.id} className={a.isActive === false ? "opacity-60" : ""}>
                    <TableCell className="font-medium">
                      {a.accountName}
                      {a.isActive === false && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
                    </TableCell>
                    <TableCell>{a.bankName}</TableCell>
                    <TableCell className="font-mono text-sm">{a.accountNumber}</TableCell>
                    <TableCell>{a.currency}</TableCell>
                    <TableCell>
                      {latestBal ? (
                        <div>
                          <span className="font-semibold tabular-nums">{a.currency} {parseFloat(latestBal.closingBalance).toFixed(2)}</span>
                          <p className="text-xs text-muted-foreground">as at {new Date(latestBal.statementDate).toLocaleDateString()}</p>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setBalForm(f => ({ ...f, bankAccountId: a.id, currency: a.currency })); setShowBalanceDialog(true); }}>
                          + Enter balance
                        </Button>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditAccount(a);
                          setEditAccountForm({
                            accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber,
                            currency: a.currency, notes: a.notes || "", isActive: a.isActive !== false,
                          });
                        }}
                      >
                        Edit
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </DataTable>
        )}
      </CardSection>

      {/* ── Deposit History ─────────────────────────────────── */}
      <CardSection
        title="Deposit history"
        description="All cash deposits made to bank accounts, with verification status."
        icon={ArrowDownToLine}
        headerRight={
          <Button size="sm" variant="outline" onClick={() => setShowBalanceDialog(true)}>
            <FileText className="h-4 w-4 mr-1.5" />
            Record Statement Balance
          </Button>
        }
      >
        {loadingDeposits ? (
          <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : bankDeposits.length === 0 ? (
          <EmptyState icon={ArrowDownToLine} title="No deposits yet" description="Record a deposit when an admin banks collected premiums." />
        ) : (
          <DataTable>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Admin (deposited by)</TableHead>
                <TableHead>Bank account</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Verified</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankDeposits.map((d: any) => (
                <TableRow key={d.id}>
                  <TableCell className="tabular-nums text-sm">{new Date(d.depositDate).toLocaleDateString()}</TableCell>
                  <TableCell className="text-sm">{d.depositedByName || d.depositedByUserId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{d.bankAccountName || "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{d.currency} {parseFloat(d.amount).toFixed(2)}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{d.reference || "—"}</TableCell>
                  <TableCell>
                    {d.verifiedAt ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {d.verifiedByName || "verified"}
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Unverified</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    {!d.verifiedAt && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={verifyDepositMutation.isPending} onClick={() => verifyDepositMutation.mutate(d.id)}>
                        Verify
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </DataTable>
        )}
      </CardSection>

      {/* ── Add Bank Account Dialog ─────────────────────────── */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add bank account</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input placeholder="e.g. FBC Main USD Account" value={accountForm.accountName} onChange={e => setAccountForm(f => ({ ...f, accountName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Bank</Label>
              <Input placeholder="e.g. FBC Bank" value={accountForm.bankName} onChange={e => setAccountForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Account number</Label>
              <Input placeholder="Account number" value={accountForm.accountNumber} onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={accountForm.currency} onValueChange={v => setAccountForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={accountForm.notes} onChange={e => setAccountForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowAccountDialog(false)}>Cancel</Button>
            <Button disabled={!accountForm.accountName || !accountForm.bankName || !accountForm.accountNumber || createAccountMutation.isPending} onClick={() => createAccountMutation.mutate()}>
              {createAccountMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit Bank Account Dialog ────────────────────────── */}
      <Dialog open={!!editAccount} onOpenChange={(v) => !v && setEditAccount(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Edit bank account</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Account name</Label>
              <Input value={editAccountForm.accountName} onChange={e => setEditAccountForm(f => ({ ...f, accountName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Bank</Label>
              <Input value={editAccountForm.bankName} onChange={e => setEditAccountForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Account number</Label>
              <Input value={editAccountForm.accountNumber} onChange={e => setEditAccountForm(f => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Currency</Label>
              <Select value={editAccountForm.currency} onValueChange={v => setEditAccountForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={editAccountForm.notes} onChange={e => setEditAccountForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={editAccountForm.isActive} onCheckedChange={(v) => setEditAccountForm(f => ({ ...f, isActive: !!v }))} />
              Active (available for new deposits)
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditAccount(null)}>Cancel</Button>
            <Button disabled={!editAccountForm.accountName || !editAccountForm.bankName || !editAccountForm.accountNumber || updateAccountMutation.isPending} onClick={() => updateAccountMutation.mutate()}>
              {updateAccountMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Deposit Dialog ───────────────────────────── */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Record bank deposit</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Bank account</Label>
              <Select value={depositForm.bankAccountId} onValueChange={v => setDepositForm(f => ({ ...f, bankAccountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.filter((a: any) => a.isActive !== false).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.accountName} ({a.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0.01" step="0.01" placeholder="0.00" value={depositForm.amount} onChange={e => setDepositForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={depositForm.currency} onValueChange={v => setDepositForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZIG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Deposit date</Label>
              <Input type="date" value={depositForm.depositDate} onChange={e => setDepositForm(f => ({ ...f, depositDate: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Deposit slip / reference (optional)</Label>
              <Input placeholder="Slip number or EFT reference" value={depositForm.reference} onChange={e => setDepositForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={depositForm.notes} onChange={e => setDepositForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDepositDialog(false)}>Cancel</Button>
            <Button disabled={!depositForm.amount || parseFloat(depositForm.amount) <= 0 || !depositForm.depositDate || createDepositMutation.isPending} onClick={() => createDepositMutation.mutate()}>
              {createDepositMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Record Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Statement Balance Dialog ────────────────────────── */}
      <Dialog open={showBalanceDialog} onOpenChange={setShowBalanceDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Enter statement closing balance</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Bank account</Label>
              <Select value={balForm.bankAccountId} onValueChange={v => setBalForm(f => ({ ...f, bankAccountId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.filter((a: any) => a.isActive !== false).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.accountName} ({a.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Statement date</Label>
              <Input type="date" value={balForm.statementDate} onChange={e => setBalForm(f => ({ ...f, statementDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Closing balance</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={balForm.closingBalance} onChange={e => setBalForm(f => ({ ...f, closingBalance: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={balForm.currency} onValueChange={v => setBalForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZIG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={balForm.notes} onChange={e => setBalForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBalanceDialog(false)}>Cancel</Button>
            <Button disabled={!balForm.bankAccountId || !balForm.closingBalance || !balForm.statementDate || createBalanceMutation.isPending} onClick={() => createBalanceMutation.mutate()}>
              {createBalanceMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save Balance
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function StaffFinance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { roles, permissions, user: authUser } = useAuth();
  const isAgent = isAgentScoped(roles);
  const canReadFinance = permissions.includes("read:finance");
  const canWriteFinance = permissions.includes("write:finance");
  const canApproveFinance = permissions.includes("approve:finance") || (authUser as any)?.isPlatformOwner;
  const canReadCommission = permissions.includes("read:commission");
  const commissionOnly = canReadCommission && !canReadFinance;

  // Deep-linkable tabs: keep nav links like /staff/finance?tab=requisitions in sync
  // with the active tab so Finance sub-sections are reachable from the menu.
  const FINANCE_TABS = [
    "payments", "paynow", "cashups", "commissions", "requisitions",
    "fx-rates", "expenditures", "platform", "month-end", "group-receipt", "approvals",
  ];
  const search = useSearch();
  const [, setLocation] = useLocation();
  const resolveTab = (raw: string | null) => {
    if (commissionOnly) return "commissions";
    return raw && FINANCE_TABS.includes(raw) ? raw : "payments";
  };
  const [activeTab, setActiveTab] = useState(() =>
    resolveTab(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null),
  );
  useEffect(() => {
    setActiveTab(resolveTab(new URLSearchParams(search).get("tab")));
  }, [search, commissionOnly]);
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLocation(value === (commissionOnly ? "commissions" : "payments") ? "/staff/finance" : `/staff/finance?tab=${value}`);
  };
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
  const [pnlFrom, setPnlFrom] = useState(() => new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10));
  const [pnlTo, setPnlTo] = useState(() => new Date().toISOString().slice(0, 10));
  const { data: agentPnl, isLoading: pnlLoading, refetch: refetchPnl } = useQuery<any>({
    queryKey: ["/api/agent/pnl", pnlFrom, pnlTo],
    queryFn: () => fetch(`/api/agent/pnl?fromDate=${pnlFrom}&toDate=${pnlTo}`, { credentials: "include" }).then(r => r.json()),
    enabled: commissionOnly,
  });
  const { data: rawExpenditures } = useQuery<any[]>({ queryKey: ["/api/expenditures"] });
  const { data: rawRequisitions } = useQuery<any[]>({ queryKey: ["/api/requisitions"], enabled: canReadFinance || canWriteFinance || canApproveFinance });
  const requisitions = Array.isArray(rawRequisitions) ? rawRequisitions : [];
  type ReqItem = { description: string; category: string; qty: string; unitPrice: string };
  const blankItem = (): ReqItem => ({ description: "", category: "", qty: "1", unitPrice: "" });
  const [showRequisitionDialog, setShowRequisitionDialog] = useState(false);
  const [reqHeader, setReqHeader] = useState({ payee: "", currency: "USD", notes: "", neededByDate: "", raisedDate: new Date().toISOString().slice(0, 10) });
  const [reqItems, setReqItems] = useState<ReqItem[]>([blankItem()]);
  // Approve/reject dialog
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [approveAction, setApproveAction] = useState<"approve" | "reject">("approve");
  const [approveNotes, setApproveNotes] = useState("");
  const [adjustedAmount, setAdjustedAmount] = useState("");
  const reqTotal = reqItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const reqItemsValid = reqItems.every(it => it.description.trim() && it.category.trim() && Number(it.unitPrice) > 0);
  const updateReqItem = (idx: number, field: keyof ReqItem, val: string) =>
    setReqItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addReqItem = () => setReqItems(prev => [...prev, blankItem()]);
  const removeReqItem = (idx: number) => setReqItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  const resetRequisitionForm = () => { setReqHeader({ payee: "", currency: "USD", notes: "", neededByDate: "", raisedDate: new Date().toISOString().slice(0, 10) }); setReqItems([blankItem()]); };
  const openApproveDialog = (r: any, action: "approve" | "reject") => {
    setApproveTarget(r);
    setApproveAction(action);
    setApproveNotes("");
    setAdjustedAmount(String(Number(r.amount).toFixed(2)));
  };

  const createRequisitionMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const items = reqItems.map(it => ({
        description: it.description.trim(),
        category: it.category.trim(),
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      }));
      const res = await apiRequest("POST", "/api/requisitions", {
        ...reqHeader,
        raisedDate: reqHeader.raisedDate || new Date().toISOString().slice(0, 10),
        neededByDate: reqHeader.neededByDate || null,
        // Legacy fields derived from first item as fallback
        category: items[0]?.category || "",
        description: items.length === 1 ? items[0].description : `${items.length} items`,
        amount: reqTotal.toFixed(2),
        items,
        submit,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requisitions"] });
      setShowRequisitionDialog(false);
      resetRequisitionForm();
      toast({ title: "Requisition created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const requisitionActionMutation = useMutation({
    mutationFn: async ({ id, action, extra }: { id: string; action: string; extra?: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/requisitions/${id}`, { action, ...(extra || {}) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/requisitions"] });
      toast({ title: "Requisition updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Payment dialog (shared for requisitions + expenditures) ──
  const [payTarget, setPayTarget] = useState<{ type: "requisition" | "expenditure"; item: any } | null>(null);
  const [payForm, setPayForm] = useState({
    amount: "", paidDate: new Date().toISOString().slice(0, 10),
    paymentMethod: "cash", reference: "", receivedBy: "", receivedByUserId: "", notes: "",
  });
  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const [expandedExpId, setExpandedExpId] = useState<string | null>(null);
  const { data: staffUsers = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: canWriteFinance });

  const openPayDialog = (type: "requisition" | "expenditure", item: any) => {
    const outstanding = Number(item.amount) - Number(item.amountPaid ?? 0);
    setPayTarget({ type, item });
    setPayForm({
      amount: outstanding.toFixed(2),
      paidDate: new Date().toISOString().slice(0, 10),
      paymentMethod: "cash", reference: "", receivedBy: "", receivedByUserId: "", notes: "",
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
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Payment failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/requisitions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/expenditures"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payment-disbursements"] });
      setPayTarget(null);
      toast({
        title: data.fullyPaid ? "Fully paid" : "Partial payment recorded",
        description: data.fullyPaid ? "Payment complete." : `${payTarget?.item.currency} ${parseFloat(payForm.amount).toFixed(2)} recorded. Outstanding balance remains.`,
      });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // FX rates (USD base) for consolidated statements.
  const canManageSettings = permissions.includes("manage:settings") || (authUser as any)?.isPlatformOwner;
  const { data: rawFxRates } = useQuery<any[]>({ queryKey: ["/api/fx-rates"], enabled: canReadFinance });
  const fxRateMap: Record<string, string> = {};
  for (const r of (Array.isArray(rawFxRates) ? rawFxRates : [])) fxRateMap[r.currency] = String(r.rateToUsd);
  const [fxEdits, setFxEdits] = useState<Record<string, string>>({});
  const saveFxRateMutation = useMutation({
    mutationFn: async ({ currency, rateToUsd }: { currency: string; rateToUsd: string }) => {
      const res = await apiRequest("PUT", `/api/fx-rates/${currency}`, { rateToUsd });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fx-rates"] });
      toast({ title: "Exchange rate saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
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
  const { data: platformSummary } = useQuery<{ totalDue: Record<string, string>; totalSettled: Record<string, string>; outstanding: Record<string, string> }>({ queryKey: ["/api/platform/summary"] });
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

  // All of these are keyed by currency — platform_receivables holds USD, ZAR, and ZIG
  // amounts, and summing across currencies would silently blend them into one meaningless number.
  const platformDailyDue = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const map: Record<string, number> = {};
    platformReceivables
      .filter((r: any) => !r.isSettled && r.createdAt?.startsWith(today))
      .forEach((r: any) => { map[r.currency] = (map[r.currency] || 0) + parseFloat(r.amount || "0"); });
    return map;
  }, [platformReceivables]);

  const platformMTD = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const map: Record<string, number> = {};
    platformReceivables
      .filter((r: any) => r.createdAt >= monthStart)
      .forEach((r: any) => { map[r.currency] = (map[r.currency] || 0) + parseFloat(r.amount || "0"); });
    return map;
  }, [platformReceivables]);

  const platformAging = useMemo(() => {
    const now = Date.now();
    const unsettled = platformReceivables.filter((r: any) => !r.isSettled);
    const buckets: Record<"current" | "days30" | "days60" | "days90plus", Record<string, number>> = {
      current: {}, days30: {}, days60: {}, days90plus: {},
    };
    unsettled.forEach((r: any) => {
      const age = (now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const amt = parseFloat(r.amount || "0");
      const bucket = age <= 30 ? buckets.current : age <= 60 ? buckets.days30 : age <= 90 ? buckets.days60 : buckets.days90plus;
      bucket[r.currency] = (bucket[r.currency] || 0) + amt;
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
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <KpiStatCard label="Total Payments" value={<span data-testid="text-payment-count">{payments.length}</span>} icon={DollarSign} />
          <KpiStatCard label="Total Receipted" value={<span data-testid="text-total-cleared">{paymentCurrency} {totalCleared.toFixed(2)}</span>} icon={CheckCircle2} />
          <KpiStatCard label="Commission Configs" value={commissionConfigs.length} icon={TrendingUp} />
          {!isAgent && <KpiStatCard label="Expenditures" value={expenditures.length} icon={Wallet} />}
        </div>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <TabsList>
            {!commissionOnly && <TabsTrigger value="payments" data-testid="tab-payments" title="All receipted payments linked to policies and clients">Payments &amp; Receipts</TabsTrigger>}
            {!commissionOnly && !isAgent && <TabsTrigger value="receipting-by-staff" data-testid="tab-receipting-by-staff" title="How much each staff member and branch has receipted, by period">Receipting by Staff</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="paynow" data-testid="tab-paynow" title="Mobile money (Paynow) and cash payment collection">Mobile &amp; Cash</TabsTrigger>}
            {!commissionOnly && <TabsTrigger value="cashups" data-testid="tab-cashups" title="Daily cash reconciliation — count cash collected against receipts issued">Cash-up Reconciliation</TabsTrigger>}
            {canReadCommission && <TabsTrigger value="commissions" data-testid="tab-commissions" title="Agent commission earnings and payout status">Commissions</TabsTrigger>}
            {commissionOnly && <TabsTrigger value="my-pnl" data-testid="tab-my-pnl" title="Your collections vs commissions P&L for the period">My P&amp;L</TabsTrigger>}
            {!commissionOnly && !isAgent && <TabsTrigger value="requisitions" data-testid="tab-requisitions" title="Expenditure requests: raise, approve, and mark paid">Requisitions</TabsTrigger>}
            {canManageSettings && !isAgent && <TabsTrigger value="fx-rates" data-testid="tab-fx-rates" title="USD-base exchange rates for consolidated financial statements">FX Rates</TabsTrigger>}
            {!commissionOnly && !isAgent && <TabsTrigger value="expenditures" data-testid="tab-expenditures" title="Operating expenses and outgoing payments">Expenditures</TabsTrigger>}
            {!commissionOnly && !isAgent && <TabsTrigger value="platform" data-testid="tab-platform" title="Platform revenue owed to POL263 (2.5% on all cleared receipts — policy premiums and funeral service payments)">Platform Fees</TabsTrigger>}
            {canWriteFinance && !isAgent && <TabsTrigger value="month-end" data-testid="tab-month-end" title="Run the month-end close: batch premium collection for overdue policies">Month-End Close</TabsTrigger>}
            {canWriteFinance && !isAgent && <TabsTrigger value="group-receipt" data-testid="tab-group-receipt" title="Receipt a single payment across multiple policies in a group">Group Receipt</TabsTrigger>}
            {canApproveFinance && !isAgent && <TabsTrigger value="approvals" data-testid="tab-approvals" title="Review and approve backdated group receipts before they are applied">Pending Approvals</TabsTrigger>}
            {!commissionOnly && !isAgent && <TabsTrigger value="banking" data-testid="tab-banking" title="Bank accounts, cash deposits, and per-admin cash accountability">Banking &amp; Cash</TabsTrigger>}
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
                            <TableCell className="font-mono text-sm tabular-nums">{p.policyNumber || (p.policyId ? getPolicyNumber(p.policyId) : "—")}</TableCell>
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

          <TabsContent value="receipting-by-staff">
            <ReceiptingByStaffPanel />
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
                          <TableCell className="font-mono text-sm tabular-nums">{pi.policyNumber || getPolicyNumber(pi.policyId)}</TableCell>
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

          <TabsContent value="fx-rates">
            <CardSection
              title="Exchange Rates (USD base)"
              description="Set how many USD one unit of each currency is worth. Used to compute the consolidated USD total on the Income Statement and Cash Flow. USD is fixed at 1.00."
              icon={DollarSign}
              flush
            >
              <div className="p-4 space-y-3 max-w-md">
                <div className="flex items-center gap-3">
                  <span className="w-16 font-mono font-semibold">USD</span>
                  <Input value="1.00000000" disabled className="flex-1" />
                  <span className="text-xs text-muted-foreground w-20">base</span>
                </div>
                {["ZAR", "ZIG"].map((cur) => (
                  <div key={cur} className="flex items-center gap-3">
                    <span className="w-16 font-mono font-semibold">{cur}</span>
                    <Input
                      type="number" step="0.00000001" min="0"
                      placeholder={`USD per 1 ${cur}`}
                      value={fxEdits[cur] ?? fxRateMap[cur] ?? ""}
                      onChange={(e) => setFxEdits({ ...fxEdits, [cur]: e.target.value })}
                      className="flex-1"
                      data-testid={`input-fx-${cur}`}
                    />
                    <Button
                      size="sm"
                      onClick={() => saveFxRateMutation.mutate({ currency: cur, rateToUsd: fxEdits[cur] ?? fxRateMap[cur] ?? "0" })}
                      disabled={saveFxRateMutation.isPending || !(fxEdits[cur] ?? fxRateMap[cur])}
                      data-testid={`btn-save-fx-${cur}`}
                    >Save</Button>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">Example: if 1 USD = 28 ZiG, then 1 ZiG = 0.0357 USD — enter 0.0357 for ZIG.</p>
              </div>
            </CardSection>
          </TabsContent>

          {/* ── Agent P&L ── */}
          <TabsContent value="my-pnl">
            <div className="space-y-6">
              {/* Date range filters */}
              <CardSection title="My P&L — collections vs commissions" icon={TrendingUp}
                description="Shows your premium collections and commission earnings for the selected period.">
                <div className="flex flex-wrap gap-3 p-4 border-b">
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">From</label>
                    <Input type="date" value={pnlFrom} onChange={e => setPnlFrom(e.target.value)} className="h-8 w-36 text-sm" />
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground">To</label>
                    <Input type="date" value={pnlTo} onChange={e => setPnlTo(e.target.value)} className="h-8 w-36 text-sm" />
                  </div>
                  <Button size="sm" variant="outline" onClick={() => refetchPnl()} className="h-8">Apply</Button>
                </div>

                {pnlLoading ? (
                  <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : agentPnl ? (() => {
                  const fmtMap = (m: Record<string, number>) =>
                    Object.entries(m || {}).map(([c, v]) => `${c} ${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("  ") || "—";
                  const p = agentPnl;
                  const port = p.portfolio || {};
                  const coll = p.collections || {};
                  const comm = p.commissions || {};
                  return (
                    <>
                      {/* Portfolio KPIs */}
                      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-4">
                        <KpiStatCard label="Total Policies" value={port.totalPolicies ?? 0} className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
                        <KpiStatCard label="Active" value={<span className="text-emerald-700">{port.activePolicies ?? 0}</span>} className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200" />
                        <KpiStatCard label="Grace" value={<span className="text-amber-700">{port.gracePolicies ?? 0}</span>} className="bg-amber-50 dark:bg-amber-950/20 border-amber-200" />
                        <KpiStatCard label="Lapsed" value={<span className="text-red-700">{port.lapsedPolicies ?? 0}</span>} className="bg-red-50 dark:bg-red-950/20 border-red-200" />
                        <KpiStatCard label="New in period" value={<span className="text-blue-700">{port.newInPeriod ?? 0}</span>} className="bg-blue-50 dark:bg-blue-950/20 border-blue-200" />
                        <KpiStatCard label="Retention rate" value={<span className="text-indigo-700">{port.retentionRate ?? "—"}%</span>} hint="active ÷ total" className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
                      </div>

                      {/* Collections vs Commissions side-by-side */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 border-t">
                        <div className="p-4 border-r">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Collections (premiums paid in period)</p>
                          <p className="text-2xl font-bold tabular-nums text-emerald-700">{fmtMap(coll.total)}</p>
                          {(coll.byMonth || []).length > 0 && (
                            <div className="mt-3 space-y-1">
                              {(coll.byMonth as any[]).map((m: any) => (
                                <div key={m.month} className="flex justify-between text-sm">
                                  <span className="text-muted-foreground">{m.month}</span>
                                  <span className="tabular-nums font-medium">{fmtMap(m.amounts)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="p-4">
                          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Commissions (period)</p>
                          <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                              <span>Earned</span>
                              <span className="tabular-nums font-semibold text-emerald-700">{fmtMap(comm.earned)}</span>
                            </div>
                            <div className="flex justify-between text-sm">
                              <span>Paid out</span>
                              <span className="tabular-nums font-semibold text-blue-700">{fmtMap(comm.paid)}</span>
                            </div>
                            {Object.keys(comm.clawbacks || {}).length > 0 && (
                              <div className="flex justify-between text-sm">
                                <span>Clawbacks</span>
                                <span className="tabular-nums font-semibold text-red-700">−{fmtMap(comm.clawbacks)}</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm border-t pt-2 mt-2">
                              <span className="font-medium">Outstanding (period)</span>
                              <span className="tabular-nums font-bold text-amber-700">{fmtMap(comm.outstanding)}</span>
                            </div>
                          </div>
                          <div className="mt-4 pt-4 border-t">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium">Total outstanding (all time)</span>
                              <span className="tabular-nums font-bold text-indigo-700">{fmtMap(p.lifetimeOutstanding || {})}</span>
                            </div>
                            <p className="text-[10px] text-muted-foreground mt-1">Commissions earned but not yet paid out, across all periods.</p>
                          </div>
                        </div>
                      </div>
                    </>
                  );
                })() : (
                  <p className="p-4 text-sm text-muted-foreground">No data available.</p>
                )}
              </CardSection>
            </div>
          </TabsContent>

          <TabsContent value="requisitions">
            <CardSection
              title="Requisitions"
              description="Raise an expenditure request, route it for approval, then mark it paid. Paid requisitions appear as expenses on the income statement."
              icon={FileText}
              flush
              headerRight={canWriteFinance ? (
                <Button size="sm" onClick={() => setShowRequisitionDialog(true)} data-testid="button-new-requisition">
                  <Plus className="h-4 w-4 mr-2" />New Requisition
                </Button>
              ) : undefined}
            >
              {requisitions.length === 0 ? (
                <EmptyState title="No requisitions yet" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                  <TableHeader className={dataTableStickyHeaderClass}>
                    <TableRow>
                      <TableHead className="w-[110px]">Number</TableHead>
                      <TableHead className="w-[130px]">Requester</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead className="w-[90px]">Raised</TableHead>
                      <TableHead className="w-[90px]">Needed By</TableHead>
                      <TableHead className="text-right w-[100px]">Total</TableHead>
                      <TableHead className="w-[90px]">Status</TableHead>
                      <TableHead className="text-right w-[140px]">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requisitions.map((r: any) => {
                      const items: any[] = Array.isArray(r.items) ? r.items : [];
                      const amountPaid = Number(r.amountPaid ?? 0);
                      const outstanding = Number(r.amount) - amountPaid;
                      const isExpanded = expandedReqId === r.id;
                      return (
                      <>
                      <TableRow key={r.id} className={`hover:bg-muted/40 align-top cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`} onClick={() => setExpandedReqId(isExpanded ? null : r.id)}>
                        <TableCell className="font-mono text-xs pt-3">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                            {r.requisitionNumber}
                          </div>
                        </TableCell>
                        <TableCell className="pt-3">
                          <div className="text-xs font-medium leading-tight">{r.requesterName || "—"}</div>
                          {r.requesterDepartment && <div className="text-[10px] text-muted-foreground">{r.requesterDepartment}</div>}
                          {r.payee && <div className="text-[10px] text-muted-foreground">To: {r.payee}</div>}
                        </TableCell>
                        <TableCell>
                          {items.length > 0 ? (
                            <div className="space-y-0.5">
                              {items.map((it: any, idx: number) => (
                                <div key={idx} className="text-xs flex gap-2 items-baseline">
                                  <Badge variant="outline" className="text-[10px] shrink-0">{it.category}</Badge>
                                  <span className="text-muted-foreground truncate max-w-[160px]" title={it.description}>{it.description}</span>
                                  <span className="tabular-nums shrink-0 ml-auto text-muted-foreground">{Number(it.qty)}× {Number(it.unitPrice).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <div className="text-xs flex gap-2 items-baseline">
                              <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                              <span className="text-muted-foreground truncate max-w-[200px]" title={r.description}>{r.description}</span>
                            </div>
                          )}
                          {r.approverNotes && <p className="text-[10px] text-muted-foreground mt-0.5 italic">Approver: {r.approverNotes}</p>}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground pt-3">{(r.raisedDate || r.createdAt) ? new Date(r.raisedDate || r.createdAt).toLocaleDateString() : "—"}</TableCell>
                        <TableCell className="text-xs pt-3">
                          {r.neededByDate
                            ? <span className={new Date(r.neededByDate) < new Date() && r.status !== "paid" ? "text-destructive font-medium" : ""}>{new Date(r.neededByDate).toLocaleDateString()}</span>
                            : <span className="text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell className="pt-3 text-right">
                          <div className="tabular-nums font-semibold text-xs">{r.currency} {Number(r.amount).toFixed(2)}</div>
                          {r.status === "partial" && (
                            <div className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                              Paid: {r.currency} {amountPaid.toFixed(2)}<br />
                              <span className="text-destructive">Due: {r.currency} {outstanding.toFixed(2)}</span>
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="pt-3"><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-right pt-3" onClick={(e) => e.stopPropagation()}>
                          <div className="flex justify-end gap-1.5 flex-wrap">
                            {r.status === "draft" && canWriteFinance && (
                              <Button size="sm" variant="outline" onClick={() => requisitionActionMutation.mutate({ id: r.id, action: "submit" })} data-testid={`btn-submit-req-${r.id}`}>Submit</Button>
                            )}
                            {r.status === "submitted" && canApproveFinance && (
                              <>
                                <Button size="sm" variant="outline" onClick={() => openApproveDialog(r, "approve")} data-testid={`btn-approve-req-${r.id}`}>Approve</Button>
                                <Button size="sm" variant="ghost" className="text-destructive" onClick={() => openApproveDialog(r, "reject")}>Reject</Button>
                              </>
                            )}
                            {(r.status === "approved" || r.status === "partial") && canWriteFinance && (
                              <Button size="sm" onClick={() => openPayDialog("requisition", r)} data-testid={`btn-pay-req-${r.id}`}>
                                {r.status === "partial" ? "Pay Balance" : "Record Payment"}
                              </Button>
                            )}
                            {r.status === "paid" && <span className="text-xs text-muted-foreground">Paid ✓</span>}
                            {r.status === "rejected" && <span className="text-xs text-muted-foreground">Rejected</span>}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Print requisition" onClick={(e) => { e.stopPropagation(); window.open(`/api/requisitions/${r.id}/pdf`, "_blank"); }}>
                              <Printer className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${r.id}-detail`} className="hover:bg-transparent">
                          <TableCell colSpan={8} className="px-4 pb-4 pt-0 bg-muted/10">
                            <RequisitionPaymentHistory requisitionId={r.id} currency={r.currency} />
                          </TableCell>
                        </TableRow>
                      )}
                      </>
                    )})}
                  </TableBody>
                </DataTable>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="expenditures">
            <CardSection title="Expenditures" description="Direct operational spend. Click a row to view payment history. Record payments to move items from pending to paid." icon={Wallet} flush>
                {expenditures.length === 0 ? (
                  <EmptyState title="No expenditures yet" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right pr-6">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenditures.map((e: any) => {
                        const amountPaid = Number(e.amountPaid ?? 0);
                        const outstanding = Number(e.amount) - amountPaid;
                        const isExpExp = expandedExpId === e.id;
                        return (
                          <>
                          <TableRow key={e.id} className={`hover:bg-muted/40 cursor-pointer ${isExpExp ? "bg-muted/20" : ""}`} onClick={() => setExpandedExpId(isExpExp ? null : e.id)}>
                            <TableCell className="pl-6">
                              <div className="flex items-center gap-1">
                                {isExpExp ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                <Badge variant="outline">{e.category}</Badge>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">{e.description}</TableCell>
                            <TableCell className="text-right">
                              <div className="tabular-nums font-semibold text-sm">{e.currency} {Number(e.amount).toFixed(2)}</div>
                              {e.status === "partial" && (
                                <div className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                                  Paid: {e.currency} {amountPaid.toFixed(2)} · Due: {outstanding.toFixed(2)}
                                </div>
                              )}
                            </TableCell>
                            <TableCell className="text-sm text-muted-foreground tabular-nums">{e.spentAt || e.paidDate || "—"}</TableCell>
                            <TableCell><StatusBadge status={e.status || "pending"} /></TableCell>
                            <TableCell className="text-right pr-6" onClick={(ev) => ev.stopPropagation()}>
                              {(e.status === "pending" || e.status === "partial") && canWriteFinance && (
                                <Button size="sm" variant="outline" onClick={() => openPayDialog("expenditure", e)} data-testid={`btn-pay-exp-${e.id}`}>
                                  {e.status === "partial" ? "Pay Balance" : "Record Payment"}
                                </Button>
                              )}
                              {e.status === "paid" && <span className="text-xs text-muted-foreground">Paid ✓</span>}
                            </TableCell>
                          </TableRow>
                          {isExpExp && (
                            <TableRow key={`${e.id}-detail`} className="hover:bg-transparent">
                              <TableCell colSpan={6} className="px-4 pb-4 pt-0 bg-muted/10">
                                <ExpenditurePaymentHistory expenditureId={e.id} currency={e.currency} />
                              </TableCell>
                            </TableRow>
                          )}
                          </>
                        );
                      })}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="platform">
            <div className="space-y-6">
              <CardSection
                title="POL263 Revenue Share (2.5%)"
                description="Auto-calculated on every cleared payment — policy premiums and funeral service receipts"
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
                    value={<span data-testid="text-platform-daily">{formatCurrencyMap(platformDailyDue)}</span>}
                    icon={CalendarDays}
                  />
                  <KpiStatCard
                    label="MTD Accrued"
                    value={<span data-testid="text-platform-mtd">{formatCurrencyMap(platformMTD)}</span>}
                    icon={TrendingUp}
                  />
                  <KpiStatCard
                    label="Outstanding"
                    value={
                      <span data-testid="text-platform-outstanding">
                        {formatCurrencyMap(platformSummary?.outstanding)}
                      </span>
                    }
                    icon={ArrowUpRight}
                  />
                  <KpiStatCard
                    label="Total Settled"
                    value={
                      <span data-testid="text-platform-settled">
                        {formatCurrencyMap(platformSummary?.totalSettled)}
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
                    <p className="text-xl font-bold text-green-700 dark:text-green-400 tabular-nums" data-testid="text-aging-current">{formatCurrencyMap(platformAging.current)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
                    <p className="text-xs text-muted-foreground mb-1">31–60 Days</p>
                    <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400 tabular-nums" data-testid="text-aging-30">{formatCurrencyMap(platformAging.days30)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20">
                    <p className="text-xs text-muted-foreground mb-1">61–90 Days</p>
                    <p className="text-xl font-bold text-orange-700 dark:text-orange-400 tabular-nums" data-testid="text-aging-60">{formatCurrencyMap(platformAging.days60)}</p>
                  </div>
                  <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
                    <p className="text-xs text-muted-foreground mb-1">90+ Days</p>
                    <p className="text-xl font-bold text-red-700 dark:text-red-400 tabular-nums" data-testid="text-aging-90plus">{formatCurrencyMap(platformAging.days90plus)}</p>
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
              description="Select a group and policies to receipt at once. Total amount is split by premium proportion. Backdated receipts require manager approval."
              icon={Receipt}
            >
              <GroupReceiptForm onSuccess={() => { toast({ title: "Group receipted" }); queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); }} />
            </CardSection>
          </TabsContent>

          <TabsContent value="approvals">
            <PendingApprovalsPanel onApproved={() => { queryClient.invalidateQueries({ queryKey: ["/api/payments"] }); queryClient.invalidateQueries({ queryKey: ["/api/payment-receipts/pending-approvals"] }); }} />
          </TabsContent>

          <TabsContent value="banking">
            <BankingPanel />
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

      <Dialog open={showRequisitionDialog} onOpenChange={(open) => { setShowRequisitionDialog(open); if (!open) resetRequisitionForm(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Requisition</DialogTitle>
          </DialogHeader>

          {/* Header fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Payee</Label>
              <Input value={reqHeader.payee} onChange={(e) => setReqHeader({ ...reqHeader, payee: e.target.value })} placeholder="Who will be paid?" />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <CurrencySelect value={reqHeader.currency} onValueChange={(v) => setReqHeader({ ...reqHeader, currency: v })} />
            </div>
            <div>
              <Label className="text-xs">Date Raised *</Label>
              <Input type="date" value={reqHeader.raisedDate} onChange={(e) => setReqHeader({ ...reqHeader, raisedDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Date Funds Needed *</Label>
              <Input type="date" value={reqHeader.neededByDate} onChange={(e) => setReqHeader({ ...reqHeader, neededByDate: e.target.value })} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Line Items *</Label>
              <Button type="button" size="sm" variant="outline" onClick={addReqItem}>
                <Plus className="h-3 w-3 mr-1" />Add Item
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium w-[28%]">Description *</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[22%]">Category *</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[12%]">Qty</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[20%]">Unit Price *</th>
                    <th className="text-right px-2 py-1.5 font-medium w-[14%]">Subtotal</th>
                    <th className="w-[4%]" />
                  </tr>
                </thead>
                <tbody>
                  {reqItems.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder="What is this?"
                          value={item.description}
                          onChange={(e) => updateReqItem(idx, "description", e.target.value)}
                          data-testid={idx === 0 ? "input-req-description" : undefined}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder="e.g. Fuel"
                          value={item.category}
                          onChange={(e) => updateReqItem(idx, "category", e.target.value)}
                          data-testid={idx === 0 ? "input-req-category" : undefined}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.qty}
                          onChange={(e) => updateReqItem(idx, "qty", e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={item.unitPrice}
                          onChange={(e) => updateReqItem(idx, "unitPrice", e.target.value)}
                          data-testid={idx === 0 ? "input-req-amount" : undefined}
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">
                        {((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)).toFixed(2)}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => removeReqItem(idx)}
                          disabled={reqItems.length === 1}
                          title="Remove item"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={4} className="px-2 py-1.5 text-right text-xs font-medium">Total</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold text-sm">{reqHeader.currency} {reqTotal.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <Label className="text-xs">Notes</Label>
            <Input value={reqHeader.notes} onChange={(e) => setReqHeader({ ...reqHeader, notes: e.target.value })} placeholder="Any additional notes…" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => createRequisitionMutation.mutate(false)} disabled={createRequisitionMutation.isPending || !reqItemsValid || reqTotal <= 0}>Save Draft</Button>
            <Button onClick={() => createRequisitionMutation.mutate(true)} disabled={createRequisitionMutation.isPending || !reqItemsValid || reqTotal <= 0 || !reqHeader.neededByDate} data-testid="button-submit-requisition">
              {createRequisitionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve / Reject dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{approveAction === "approve" ? "Approve Requisition" : "Reject Requisition"}</DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2 bg-muted/30 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ref</span>
                  <span className="font-mono font-medium">{approveTarget.requisitionNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requested by</span>
                  <span>{approveTarget.requesterName}{approveTarget.requesterDepartment ? ` · ${approveTarget.requesterDepartment}` : ""}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date raised</span>
                  <span>{approveTarget.createdAt ? new Date(approveTarget.createdAt).toLocaleDateString() : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Funds needed by</span>
                  <span className={approveTarget.neededByDate && new Date(approveTarget.neededByDate) < new Date() ? "text-destructive font-medium" : ""}>
                    {approveTarget.neededByDate ? new Date(approveTarget.neededByDate).toLocaleDateString() : "—"}
                  </span>
                </div>
                {approveTarget.payee && <div className="flex justify-between"><span className="text-muted-foreground">Payee</span><span>{approveTarget.payee}</span></div>}
                <div className="border-t pt-2">
                  {(Array.isArray(approveTarget.items) && approveTarget.items.length > 0
                    ? approveTarget.items
                    : [{ category: approveTarget.category, description: approveTarget.description, qty: 1, unitPrice: approveTarget.amount, total: approveTarget.amount }]
                  ).map((it: any, idx: number) => (
                    <div key={idx} className="flex gap-2 text-xs py-0.5">
                      <Badge variant="outline" className="text-[10px]">{it.category}</Badge>
                      <span className="flex-1 truncate">{it.description}</span>
                      <span className="tabular-nums shrink-0">{Number(it.qty)}× {Number(it.unitPrice).toFixed(2)} = {Number(it.total ?? (Number(it.qty) * Number(it.unitPrice))).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm pt-1 border-t mt-1">
                    <span>Requested total</span>
                    <span>{approveTarget.currency} {Number(approveTarget.amount).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {approveAction === "approve" && (
                <div>
                  <Label className="text-xs">Adjusted Amount (leave unchanged to approve as-is)</Label>
                  <Input type="number" step="0.01" min="0" value={adjustedAmount} onChange={(e) => setAdjustedAmount(e.target.value)} />
                </div>
              )}

              <div>
                <Label className="text-xs">{approveAction === "approve" ? "Notes (optional)" : "Reason for rejection *"}</Label>
                <Input
                  value={approveNotes}
                  onChange={(e) => setApproveNotes(e.target.value)}
                  placeholder={approveAction === "approve" ? "Any notes for the requester…" : "Why is this being rejected?"}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button
              variant={approveAction === "reject" ? "destructive" : "default"}
              disabled={requisitionActionMutation.isPending || (approveAction === "reject" && !approveNotes.trim())}
              onClick={() => {
                if (!approveTarget) return;
                const extra: any = {};
                if (approveAction === "approve") {
                  const adj = Number(adjustedAmount);
                  if (!isNaN(adj) && adj > 0 && adj !== Number(approveTarget.amount)) extra.adjustedAmount = adj;
                  if (approveNotes.trim()) extra.approverNotes = approveNotes.trim();
                } else {
                  extra.rejectionReason = approveNotes.trim() || "Rejected";
                }
                requisitionActionMutation.mutate({ id: approveTarget.id, action: approveAction, extra });
                setApproveTarget(null);
              }}
            >
              {requisitionActionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {approveAction === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Payment dialog (requisitions + expenditures) ── */}
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

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Amount paying now *</Label>
                    <Input type="number" step="0.01" min="0.01" max={outstanding}
                      value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })}
                      placeholder={outstanding.toFixed(2)} data-testid="input-pay-amount" />
                  </div>
                  <div className="space-y-1">
                    <Label>Payment date *</Label>
                    <Input type="date" value={payForm.paidDate} max={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setPayForm({ ...payForm, paidDate: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Payment method *</Label>
                    <Select value={payForm.paymentMethod} onValueChange={(v) => setPayForm({ ...payForm, paymentMethod: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
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
                    <Label>Reference / Cheque #</Label>
                    <Input value={payForm.reference} onChange={(e) => setPayForm({ ...payForm, reference: e.target.value })} placeholder="Optional reference" />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Received by (recipient) *</Label>
                  <Input value={payForm.receivedBy} onChange={(e) => setPayForm({ ...payForm, receivedBy: e.target.value, receivedByUserId: "" })}
                    placeholder="Supplier name, staff member, vendor…" data-testid="input-received-by" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Or select a system user as recipient</Label>
                  <Select value={payForm.receivedByUserId}
                    onValueChange={(v) => setPayForm({ ...payForm, receivedByUserId: v, receivedBy: v ? ((staffUsers as any[]).find((u: any) => u.id === v)?.displayName || "") : payForm.receivedBy })}>
                    <SelectTrigger className="text-sm"><SelectValue placeholder="Choose system user (optional)…" /></SelectTrigger>
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
                {payMutation.isError && <p className="text-sm text-destructive">{(payMutation.error as Error).message}</p>}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayTarget(null)}>Cancel</Button>
            <Button
              onClick={() => payMutation.mutate()}
              disabled={payMutation.isPending || !payForm.amount || parseFloat(payForm.amount) <= 0 || (!payForm.receivedBy.trim() && !payForm.receivedByUserId)}
              data-testid="btn-confirm-disbursement"
            >
              {payMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Record Payment
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
