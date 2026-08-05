import { useState, useMemo } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Wallet, Plus, Loader2, MoreHorizontal, ArrowDownToLine, ArrowUpFromLine, Scale, ClipboardCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatAmount } from "@shared/validation";

type TxnType = "replenishment" | "disbursement" | "adjustment_in" | "adjustment_out" | "reconciliation";

const TXN_TYPE_LABELS: Record<TxnType, string> = {
  replenishment: "Replenishment",
  disbursement: "Disbursement",
  adjustment_in: "Adjustment (+)",
  adjustment_out: "Adjustment (−)",
  reconciliation: "Reconciliation",
};

const TXN_TYPE_BADGE: Record<string, string> = {
  opening: "bg-slate-50 text-slate-700 border-slate-200",
  replenishment: "bg-emerald-50 text-emerald-700 border-emerald-200",
  adjustment_in: "bg-emerald-50 text-emerald-700 border-emerald-200",
  disbursement: "bg-amber-50 text-amber-700 border-amber-200",
  adjustment_out: "bg-amber-50 text-amber-700 border-amber-200",
  reconciliation: "bg-blue-50 text-blue-700 border-blue-200",
};

const today = () => new Date().toISOString().slice(0, 10);

export default function PettyCash() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:finance");

  const { data: floats = [], isLoading: loadingFloats } = useQuery<any[]>({ queryKey: ["/api/petty-cash/floats"] });
  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    queryFn: async () => { const r = await fetch("/api/branches", { credentials: "include" }); return r.ok ? r.json() : []; },
  });
  const { data: staffUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
    queryFn: async () => { const r = await fetch("/api/users", { credentials: "include" }); return r.ok ? r.json() : []; },
    enabled: canWrite,
  });

  const [ledgerFloatId, setLedgerFloatId] = useState<string>("all");
  const { data: transactions = [], isLoading: loadingTxns } = useQuery<any[]>({
    queryKey: ["/api/petty-cash/transactions", ledgerFloatId],
    queryFn: async () => {
      const url = ledgerFloatId === "all" ? "/api/petty-cash/transactions" : `/api/petty-cash/transactions?floatId=${ledgerFloatId}`;
      const res = await apiRequest("GET", url);
      return res.json();
    },
  });

  // ── New float ──
  const [showFloatDialog, setShowFloatDialog] = useState(false);
  const [floatForm, setFloatForm] = useState({ name: "", branchId: "", currency: "USD", custodianUserId: "", openingBalance: "" });
  const resetFloatForm = () => setFloatForm({ name: "", branchId: "", currency: "USD", custodianUserId: "", openingBalance: "" });
  const createFloatMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/petty-cash/floats", {
        name: floatForm.name.trim(),
        branchId: floatForm.branchId || undefined,
        currency: floatForm.currency,
        custodianUserId: floatForm.custodianUserId || undefined,
        openingBalance: floatForm.openingBalance || undefined,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Failed to create float"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/petty-cash/floats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/petty-cash/transactions"] });
      setShowFloatDialog(false);
      resetFloatForm();
      toast({ title: "Float created" });
    },
    onError: (err: Error) => toast({ title: "Could not create float", description: err.message, variant: "destructive" }),
  });

  // ── Post transaction (replenish / disburse / adjust / reconcile) ──
  const [txnDialog, setTxnDialog] = useState<{ floatId: string; type: TxnType } | null>(null);
  const [txnForm, setTxnForm] = useState({ amount: "", countedAmount: "", category: "", description: "", receiptRef: "", transactionDate: today() });
  const resetTxnForm = () => setTxnForm({ amount: "", countedAmount: "", category: "", description: "", receiptRef: "", transactionDate: today() });
  const openTxnDialog = (floatId: string, type: TxnType) => { resetTxnForm(); setTxnDialog({ floatId, type }); };
  const postTxnMutation = useMutation({
    mutationFn: async () => {
      if (!txnDialog) return;
      const res = await apiRequest("POST", "/api/petty-cash/transactions", {
        floatId: txnDialog.floatId,
        type: txnDialog.type,
        amount: txnDialog.type === "reconciliation" ? undefined : txnForm.amount,
        countedAmount: txnDialog.type === "reconciliation" ? txnForm.countedAmount : undefined,
        category: txnForm.category.trim() || undefined,
        description: txnForm.description.trim(),
        receiptRef: txnForm.receiptRef.trim() || undefined,
        transactionDate: txnForm.transactionDate,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Failed to post transaction"); }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/petty-cash/floats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/petty-cash/transactions"] });
      setTxnDialog(null);
      resetTxnForm();
      toast({ title: "Transaction posted" });
    },
    onError: (err: Error) => toast({ title: "Could not post transaction", description: err.message, variant: "destructive" }),
  });

  const activeFloats = floats.filter((f: any) => f.isActive);
  const balanceByCurrency = useMemo(() => {
    const m: Record<string, number> = {};
    for (const f of activeFloats) m[f.currency] = (m[f.currency] || 0) + (Number(f.balance) || 0);
    return m;
  }, [activeFloats]);
  const disbursedThisMonth = useMemo(() => {
    const monthKey = today().slice(0, 7);
    return transactions
      .filter((t: any) => t.type === "disbursement" && String(t.transactionDate).slice(0, 7) === monthKey)
      .reduce((s: number, t: any) => s + (Number(t.amount) || 0), 0);
  }, [transactions]);

  const findBranch = (id: string | null | undefined) => branches.find((b: any) => b.id === id)?.name;

  const floatColumns: EdtColumn<any>[] = [
    { id: "name", header: "Float", accessor: (f) => f.name, cell: (f) => <span className="font-medium">{f.name}</span> },
    { id: "branch", header: "Branch", accessor: (f) => findBranch(f.branchId) || "", cell: (f) => <span className="text-sm text-muted-foreground">{findBranch(f.branchId) || "—"}</span> },
    { id: "custodian", header: "Custodian", accessor: (f) => f.custodianName || "", cell: (f) => <span className="text-sm">{f.custodianName || "—"}</span> },
    { id: "balance", header: "Balance", align: "right", accessor: (f) => Number(f.balance) || 0, cell: (f) => <span className="tabular-nums font-medium">{formatAmount(Number(f.balance) || 0, f.currency)}</span> },
    { id: "status", header: "Status", accessor: (f) => f.isActive ? "Active" : "Inactive", cell: (f) => <Badge variant="outline" className={f.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>{f.isActive ? "Active" : "Inactive"}</Badge> },
    {
      id: "actions", header: "Actions", align: "right", exportable: false,
      cell: (f) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => setLedgerFloatId(f.id)}>View Ledger</Button>
          {canWrite && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openTxnDialog(f.id, "replenishment")}><ArrowDownToLine className="h-4 w-4 mr-2" />Replenish</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTxnDialog(f.id, "disbursement")}><ArrowUpFromLine className="h-4 w-4 mr-2" />Disburse</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTxnDialog(f.id, "adjustment_in")}><Scale className="h-4 w-4 mr-2" />Adjustment (+)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTxnDialog(f.id, "adjustment_out")}><Scale className="h-4 w-4 mr-2" />Adjustment (−)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => openTxnDialog(f.id, "reconciliation")}><ClipboardCheck className="h-4 w-4 mr-2" />Reconcile</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ),
    },
  ];

  const txnColumns: EdtColumn<any>[] = [
    { id: "date", header: "Date", accessor: (t) => t.transactionDate, cell: (t) => <span className="text-sm">{t.transactionDate ? new Date(t.transactionDate).toLocaleDateString() : "—"}</span> },
    { id: "float", header: "Float", accessor: (t) => floats.find((f: any) => f.id === t.floatId)?.name || "", cell: (t) => <span className="text-sm">{floats.find((f: any) => f.id === t.floatId)?.name || "—"}</span> },
    { id: "type", header: "Type", accessor: (t) => t.type, cell: (t) => <Badge variant="outline" className={TXN_TYPE_BADGE[t.type] || ""}>{TXN_TYPE_LABELS[t.type as TxnType] || t.type}</Badge> },
    { id: "amount", header: "Amount", align: "right", accessor: (t) => Number(t.amount) || 0, cell: (t) => t.type === "reconciliation" ? <span className="text-muted-foreground text-sm">—</span> : <span className="tabular-nums">{formatAmount(Number(t.amount) || 0, floats.find((f: any) => f.id === t.floatId)?.currency || "USD")}</span> },
    { id: "balanceAfter", header: "Balance After", align: "right", accessor: (t) => Number(t.balanceAfter) || 0, cell: (t) => <span className="tabular-nums text-sm">{formatAmount(Number(t.balanceAfter) || 0, floats.find((f: any) => f.id === t.floatId)?.currency || "USD")}</span> },
    { id: "discrepancy", header: "Discrepancy", align: "right", accessor: (t) => t.discrepancyAmount ?? "", cell: (t) => t.discrepancyAmount != null ? <span className={`tabular-nums text-sm ${Number(t.discrepancyAmount) !== 0 ? "text-red-600 font-medium" : "text-muted-foreground"}`}>{formatAmount(Number(t.discrepancyAmount), floats.find((f: any) => f.id === t.floatId)?.currency || "USD")}</span> : <span className="text-muted-foreground text-sm">—</span> },
    { id: "category", header: "Category", accessor: (t) => t.category || "", cell: (t) => <span className="text-sm text-muted-foreground">{t.category || "—"}</span> },
    { id: "description", header: "Description", accessor: (t) => t.description, cell: (t) => <span className="text-sm">{t.description}</span> },
    { id: "by", header: "By", accessor: (t) => t.performedByName || "", cell: (t) => <span className="text-sm text-muted-foreground">{t.performedByName || "—"}</span> },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Petty Cash"
          description="Cash floats held for small operational spend — replenishments, disbursements, and periodic reconciliation."
          actions={canWrite ? (
            <Button onClick={() => setShowFloatDialog(true)} className="gap-1.5" data-testid="btn-new-float">
              <Plus className="h-4 w-4" /> New Float
            </Button>
          ) : undefined}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard label="Active Floats" value={activeFloats.length} icon={Wallet} />
          <KpiStatCard
            label="Total Balance"
            value={<span className="tabular-nums">{Object.entries(balanceByCurrency).map(([c, v]) => formatAmount(v, c)).join("  ·  ") || "—"}</span>}
            icon={Scale}
          />
          <KpiStatCard label="Disbursed This Month" value={<span className="tabular-nums">{formatAmount(disbursedThisMonth, "USD")}</span>} icon={ArrowUpFromLine} />
        </div>

        {loadingFloats ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={floatColumns}
            rows={floats}
            getRowKey={(f) => f.id}
            rowTestId={(f) => `row-petty-cash-float-${f.id}`}
            searchPlaceholder="Search floats…"
            exportFilename="petty-cash-floats"
            storageKey="petty-cash-floats"
            emptyMessage="No petty cash floats yet."
          />
        )}

        <div className="flex items-center justify-between mt-6 mb-2">
          <h3 className="text-sm font-semibold text-foreground">Transaction Ledger</h3>
          <Select value={ledgerFloatId} onValueChange={setLedgerFloatId}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Floats</SelectItem>
              {floats.map((f: any) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        {loadingTxns ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={txnColumns}
            rows={transactions}
            getRowKey={(t) => t.id}
            rowTestId={(t) => `row-petty-cash-txn-${t.id}`}
            searchPlaceholder="Search transactions…"
            exportFilename="petty-cash-transactions"
            storageKey="petty-cash-transactions"
            emptyMessage="No transactions yet."
          />
        )}
      </PageShell>

      {/* New Float */}
      <Dialog open={showFloatDialog} onOpenChange={(o) => { setShowFloatDialog(o); if (!o) resetFloatForm(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Petty Cash Float</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="pcf-name">Name</Label>
              <Input id="pcf-name" placeholder="e.g. Head Office Petty Cash" value={floatForm.name} onChange={(e) => setFloatForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pcf-branch">Branch</Label>
              <Select value={floatForm.branchId || "none"} onValueChange={(v) => setFloatForm((f) => ({ ...f, branchId: v === "none" ? "" : v }))}>
                <SelectTrigger id="pcf-branch"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pcf-currency">Currency</Label>
              <Select value={floatForm.currency} onValueChange={(v) => setFloatForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="pcf-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{["USD", "ZAR", "ZIG"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pcf-custodian">Custodian</Label>
              <Select value={floatForm.custodianUserId || "none"} onValueChange={(v) => setFloatForm((f) => ({ ...f, custodianUserId: v === "none" ? "" : v }))}>
                <SelectTrigger id="pcf-custodian"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unassigned</SelectItem>
                  {staffUsers.map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pcf-opening">Opening balance</Label>
              <Input id="pcf-opening" type="number" step="0.01" min="0" value={floatForm.openingBalance} onChange={(e) => setFloatForm((f) => ({ ...f, openingBalance: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowFloatDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createFloatMutation.mutate()}
              disabled={!floatForm.name.trim() || createFloatMutation.isPending}
              data-testid="btn-save-float"
            >
              {createFloatMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Post transaction */}
      <Dialog open={!!txnDialog} onOpenChange={(o) => { if (!o) { setTxnDialog(null); resetTxnForm(); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{txnDialog ? TXN_TYPE_LABELS[txnDialog.type] : ""}</DialogTitle>
            {txnDialog?.type === "reconciliation" && (
              <DialogDescription>
                Current system balance: {formatAmount(Number(floats.find((f: any) => f.id === txnDialog.floatId)?.balance) || 0, floats.find((f: any) => f.id === txnDialog.floatId)?.currency || "USD")}. This records a count only — it does not change the balance.
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            {txnDialog?.type === "reconciliation" ? (
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="pct-counted">Counted amount</Label>
                <Input id="pct-counted" type="number" step="0.01" min="0" value={txnForm.countedAmount} onChange={(e) => setTxnForm((f) => ({ ...f, countedAmount: e.target.value }))} />
              </div>
            ) : (
              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="pct-amount">Amount</Label>
                <Input id="pct-amount" type="number" step="0.01" min="0" value={txnForm.amount} onChange={(e) => setTxnForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
            )}
            {(txnDialog?.type === "disbursement" || txnDialog?.type === "adjustment_out" || txnDialog?.type === "adjustment_in") && (
              <div className="grid gap-2">
                <Label htmlFor="pct-category">Category</Label>
                <Input id="pct-category" placeholder="e.g. Stationery, Fuel" value={txnForm.category} onChange={(e) => setTxnForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="pct-date">Date</Label>
              <Input id="pct-date" type="date" value={txnForm.transactionDate} onChange={(e) => setTxnForm((f) => ({ ...f, transactionDate: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="pct-description">Description</Label>
              <Input id="pct-description" value={txnForm.description} onChange={(e) => setTxnForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="pct-receipt">Receipt reference</Label>
              <Input id="pct-receipt" value={txnForm.receiptRef} onChange={(e) => setTxnForm((f) => ({ ...f, receiptRef: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTxnDialog(null)}>Cancel</Button>
            <Button
              onClick={() => postTxnMutation.mutate()}
              disabled={
                postTxnMutation.isPending ||
                !txnForm.description.trim() ||
                !txnForm.transactionDate ||
                (txnDialog?.type === "reconciliation" ? !txnForm.countedAmount : !txnForm.amount)
              }
              data-testid="btn-save-txn"
            >
              {postTxnMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Post
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
