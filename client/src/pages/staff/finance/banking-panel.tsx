import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Loader2, CheckCircle2, Building2, ArrowDownToLine, Banknote, TriangleAlert, Printer, ShieldCheck, FileText } from "lucide-react";
import { getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { QK_BANK_ACCOUNTS, QK_SAFES, QK_BANK_DEPOSITS, QK_CASH_POSITION, QK_BANK_STATEMENT_BALANCES } from "./query-keys";

function daysSince(dateStr: string | null) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

const cashPositionColumns: EdtColumn<any>[] = [
  {
    id: "admin",
    header: "Admin",
    accessor: (p) => p.displayName,
    cell: (p) => (
      <div>
        <div className="font-medium text-sm">{p.displayName}</div>
        <div className="text-xs text-muted-foreground">{p.email}</div>
      </div>
    ),
  },
  { id: "collected", header: "Collected (cashups)", align: "right", accessor: (p) => parseFloat(p.totalCollected), cell: (p) => <span className="tabular-nums font-medium">{p.currency} {parseFloat(p.totalCollected).toFixed(2)}</span> },
  { id: "deposited", header: "Deposited to bank", align: "right", accessor: (p) => parseFloat(p.totalDeposited), cell: (p) => <span className="tabular-nums">{p.currency} {parseFloat(p.totalDeposited).toFixed(2)}</span> },
  {
    id: "onHand",
    header: "On hand (unbanked)",
    align: "right",
    accessor: (p) => parseFloat(p.onHand),
    cell: (p) => <span className={`tabular-nums font-semibold ${p.onHand > 0 ? "text-amber-600" : "text-green-600"}`}>{p.currency} {parseFloat(p.onHand).toFixed(2)}</span>,
  },
  { id: "lastDeposit", header: "Last deposit", accessor: (p) => p.lastDepositDate ? new Date(p.lastDepositDate) : "", cell: (p) => <span className="text-sm text-muted-foreground">{p.lastDepositDate ? new Date(p.lastDepositDate).toLocaleDateString() : "—"}</span> },
  {
    id: "status",
    header: "Status",
    sortable: false,
    cell: (p) => {
      const days = daysSince(p.lastDepositDate);
      const stale = p.onHand > 0 && (days === null || days > 2);
      return p.onHand <= 0 ? (
        <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30">Banked</Badge>
      ) : stale ? (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 gap-1">
          <TriangleAlert className="h-3 w-3" />
          {days === null ? "Never banked" : `${days}d unbanked`}
        </Badge>
      ) : (
        <Badge variant="secondary">Pending bank</Badge>
      );
    },
  },
];

function bankAccountsColumns(opts: {
  statementBalances: any[];
  onEnterBalance: (a: any) => void;
  onEdit: (a: any) => void;
}): EdtColumn<any>[] {
  const { statementBalances, onEnterBalance, onEdit } = opts;
  return [
    {
      id: "accountName",
      header: "Account name",
      accessor: (a) => a.accountName,
      cell: (a) => (
        <span className="font-medium">
          {a.accountName}
          {a.isActive === false && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
        </span>
      ),
    },
    { id: "bank", header: "Bank", accessor: (a) => a.bankName },
    { id: "accountNumber", header: "Account #", accessor: (a) => a.accountNumber, cell: (a) => <span className="font-mono text-sm">{a.accountNumber}</span> },
    { id: "currency", header: "Currency", accessor: (a) => a.currency },
    {
      id: "balance",
      header: "Status",
      sortable: false,
      accessor: (a) => {
        const latestBal = statementBalances.find((b: any) => b.bankAccountId === a.id);
        return latestBal ? parseFloat(latestBal.closingBalance) : "";
      },
      cell: (a) => {
        const latestBal = statementBalances.find((b: any) => b.bankAccountId === a.id);
        return latestBal ? (
          <div>
            <span className="font-semibold tabular-nums">{a.currency} {parseFloat(latestBal.closingBalance).toFixed(2)}</span>
            <p className="text-xs text-muted-foreground">as at {new Date(latestBal.statementDate).toLocaleDateString()}</p>
          </div>
        ) : (
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEnterBalance(a)}>
            + Enter balance
          </Button>
        );
      },
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      exportable: false,
      cell: (a) => (
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onEdit(a)}>
          Edit
        </Button>
      ),
    },
  ];
}

function safesColumns(opts: { bankDeposits: any[] }): EdtColumn<any>[] {
  const { bankDeposits } = opts;
  return [
    {
      id: "name",
      header: "Safe",
      accessor: (s) => s.name,
      cell: (s) => (
        <span className="font-medium">
          {s.name}
          {s.isActive === false && <Badge variant="secondary" className="ml-2 text-[10px]">Inactive</Badge>}
        </span>
      ),
    },
    { id: "currency", header: "Currency", accessor: (s) => s.currency },
    {
      id: "totalMovedIn",
      header: "Total moved in",
      align: "right",
      accessor: (s) => bankDeposits.filter((d: any) => d.safeId === s.id).reduce((sum: number, d: any) => sum + parseFloat(d.amount), 0),
      cell: (s) => {
        const total = bankDeposits.filter((d: any) => d.safeId === s.id).reduce((sum: number, d: any) => sum + parseFloat(d.amount), 0);
        return <span className="tabular-nums font-semibold">{s.currency} {total.toFixed(2)}</span>;
      },
    },
    {
      id: "status",
      header: "Status",
      sortable: false,
      cell: (s) =>
        s.isActive === false ? (
          <Badge variant="secondary">Inactive</Badge>
        ) : (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30">Active</Badge>
        ),
    },
  ];
}

function depositsColumns(opts: { verifyDepositMutation: { mutate: (id: string) => void; isPending: boolean } }): EdtColumn<any>[] {
  const { verifyDepositMutation } = opts;
  return [
    { id: "date", header: "Date", accessor: (d) => new Date(d.depositDate), cell: (d) => <span className="tabular-nums text-sm">{new Date(d.depositDate).toLocaleDateString()}</span> },
    { id: "admin", header: "Admin (deposited by)", accessor: (d) => d.depositedByName || d.depositedByUserId, cell: (d) => <span className="text-sm">{d.depositedByName || d.depositedByUserId}</span> },
    {
      id: "destination",
      header: "Destination",
      accessor: (d) => d.safeId ? (d.safeName || "Safe") : (d.bankAccountName || ""),
      cell: (d) => (
        <span className="text-sm text-muted-foreground">
          {d.safeId ? (
            <span className="inline-flex items-center gap-1"><ShieldCheck className="h-3.5 w-3.5" /> {d.safeName || "Safe"}</span>
          ) : (
            d.bankAccountName || "—"
          )}
        </span>
      ),
    },
    { id: "amount", header: "Amount", align: "right", accessor: (d) => parseFloat(d.amount), cell: (d) => <span className="text-right tabular-nums font-semibold">{d.currency} {parseFloat(d.amount).toFixed(2)}</span> },
    { id: "reference", header: "Reference", accessor: (d) => d.reference || "", cell: (d) => <span className="font-mono text-xs text-muted-foreground">{d.reference || "—"}</span> },
    {
      id: "verified",
      header: "Verified",
      accessor: (d) => (d.verifiedAt ? "Verified" : "Unverified"),
      cell: (d) =>
        d.verifiedAt ? (
          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 gap-1">
            <CheckCircle2 className="h-3 w-3" /> {d.verifiedByName || "verified"}
          </Badge>
        ) : (
          <Badge variant="secondary">Unverified</Badge>
        ),
    },
    {
      id: "actions",
      header: "",
      sortable: false,
      exportable: false,
      cell: (d) =>
        !d.verifiedAt ? (
          <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={verifyDepositMutation.isPending} onClick={() => verifyDepositMutation.mutate(d.id)}>
            Verify
          </Button>
        ) : null,
    },
  ];
}

// ─── Banking & Cash Panel ──────────────────────────────────────────────────
export function BankingPanel() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  // queries
  const { data: cashPosition = [], isLoading: loadingPos } = useQuery<any[]>({
    queryKey: QK_CASH_POSITION,
    queryFn: async () => {
      const res = await fetch("/api/cash-position", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: bankAccounts = [] } = useQuery<any[]>({
    queryKey: QK_BANK_ACCOUNTS,
    queryFn: async () => {
      const res = await fetch("/api/bank-accounts", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: safes = [] } = useQuery<any[]>({
    queryKey: QK_SAFES,
    queryFn: async () => {
      const res = await fetch("/api/safes", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: bankDeposits = [], isLoading: loadingDeposits } = useQuery<any[]>({
    queryKey: QK_BANK_DEPOSITS,
    queryFn: async () => {
      const res = await fetch("/api/bank-deposits", { credentials: "include" });
      return res.ok ? res.json() : [];
    },
  });
  const { data: statementBalances = [] } = useQuery<any[]>({
    queryKey: QK_BANK_STATEMENT_BALANCES,
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
      queryClient.invalidateQueries({ queryKey: QK_BANK_ACCOUNTS });
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
      queryClient.invalidateQueries({ queryKey: QK_BANK_ACCOUNTS });
      setEditAccount(null);
      toast({ title: "Bank account updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Safe form
  const [showSafeDialog, setShowSafeDialog] = useState(false);
  const [safeForm, setSafeForm] = useState({ name: "", currency: "USD", notes: "" });
  const createSafeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/safes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify(safeForm),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_SAFES });
      setShowSafeDialog(false);
      setSafeForm({ name: "", currency: "USD", notes: "" });
      toast({ title: "Safe added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Deposit form
  const [showDepositDialog, setShowDepositDialog] = useState(false);
  const [depositForm, setDepositForm] = useState({ destinationType: "bank" as "bank" | "safe", bankAccountId: "", safeId: "", amount: "", currency: "USD", depositDate: new Date().toISOString().slice(0, 10), reference: "", notes: "" });
  const resetDepositForm = () => setDepositForm({ destinationType: "bank", bankAccountId: "", safeId: "", amount: "", currency: "USD", depositDate: new Date().toISOString().slice(0, 10), reference: "", notes: "" });
  const createDepositMutation = useMutation({
    mutationFn: async () => {
      const { destinationType, ...body } = depositForm;
      const res = await fetch("/api/bank-deposits", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify({
          ...body,
          bankAccountId: destinationType === "bank" ? body.bankAccountId || undefined : undefined,
          safeId: destinationType === "safe" ? body.safeId || undefined : undefined,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_BANK_DEPOSITS });
      queryClient.invalidateQueries({ queryKey: QK_CASH_POSITION });
      setShowDepositDialog(false);
      resetDepositForm();
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
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: QK_BANK_DEPOSITS }); toast({ title: "Deposit verified" }); },
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
      queryClient.invalidateQueries({ queryKey: QK_BANK_STATEMENT_BALANCES });
      setShowBalanceDialog(false);
      setBalForm({ bankAccountId: "", statementDate: new Date().toISOString().slice(0, 10), closingBalance: "", currency: "USD", notes: "" });
      toast({ title: "Statement balance saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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
        ) : (
          <EnhancedDataTable
            columns={cashPositionColumns}
            rows={cashPosition}
            getRowKey={(p: any) => p.userId}
            exportFilename="cash-position"
            storageKey="finance-banking-cash-position"
            emptyMessage="No cash activity yet. Cash positions appear once admins submit cashups."
          />
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
        <EnhancedDataTable
          columns={bankAccountsColumns({
            statementBalances,
            onEnterBalance: (a: any) => { setBalForm(f => ({ ...f, bankAccountId: a.id, currency: a.currency })); setShowBalanceDialog(true); },
            onEdit: (a: any) => {
              setEditAccount(a);
              setEditAccountForm({
                accountName: a.accountName, bankName: a.bankName, accountNumber: a.accountNumber,
                currency: a.currency, notes: a.notes || "", isActive: a.isActive !== false,
              });
            },
          })}
          rows={bankAccounts}
          getRowKey={(a: any) => a.id}
          exportFilename="bank-accounts"
          storageKey="finance-banking-accounts"
          emptyMessage="No bank accounts. Add a bank account to start recording deposits."
        />
      </CardSection>

      {/* ── Safes (cash not always banked — sometimes secured on-site instead) ── */}
      <CardSection
        title="Safes"
        description="Physical safes cash gets moved into instead of a bank — still counts as accounted-for cash on hand."
        icon={ShieldCheck}
        headerRight={
          <Button size="sm" variant="outline" onClick={() => setShowSafeDialog(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add Safe
          </Button>
        }
      >
        <EnhancedDataTable
          columns={safesColumns({ bankDeposits })}
          rows={safes}
          getRowKey={(s: any) => s.id}
          exportFilename="safes"
          storageKey="finance-banking-safes"
          emptyMessage="No safes. Add a safe to record cash moved there instead of a bank."
        />
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
        ) : (
          <EnhancedDataTable
            columns={depositsColumns({ verifyDepositMutation })}
            rows={bankDeposits}
            getRowKey={(d: any) => d.id}
            exportFilename="bank-deposits"
            storageKey="finance-banking-deposits"
            emptyMessage="No deposits yet. Record a deposit when an admin banks collected premiums."
          />
        )}
      </CardSection>

      {/* ── Add Bank Account Dialog ─────────────────────────── */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add bank account</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="account-form-account-name">Account name</Label>
              <Input id="account-form-account-name" placeholder="e.g. FBC Main USD Account" value={accountForm.accountName} onChange={e => setAccountForm(f => ({ ...f, accountName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-form-bank-name">Bank</Label>
              <Input id="account-form-bank-name" placeholder="e.g. FBC Bank" value={accountForm.bankName} onChange={e => setAccountForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-form-account-number">Account number</Label>
              <Input id="account-form-account-number" placeholder="Account number" value={accountForm.accountNumber} onChange={e => setAccountForm(f => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-form-currency">Currency</Label>
              <Select value={accountForm.currency} onValueChange={v => setAccountForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger id="account-form-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-form-notes">Notes (optional)</Label>
              <Textarea id="account-form-notes" rows={2} value={accountForm.notes} onChange={e => setAccountForm(f => ({ ...f, notes: e.target.value }))} />
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
              <Label htmlFor="edit-account-form-account-name">Account name</Label>
              <Input id="edit-account-form-account-name" value={editAccountForm.accountName} onChange={e => setEditAccountForm(f => ({ ...f, accountName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-account-form-bank-name">Bank</Label>
              <Input id="edit-account-form-bank-name" value={editAccountForm.bankName} onChange={e => setEditAccountForm(f => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-account-form-account-number">Account number</Label>
              <Input id="edit-account-form-account-number" value={editAccountForm.accountNumber} onChange={e => setEditAccountForm(f => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-account-form-currency">Currency</Label>
              <Select value={editAccountForm.currency} onValueChange={v => setEditAccountForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger id="edit-account-form-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-account-form-notes">Notes (optional)</Label>
              <Textarea id="edit-account-form-notes" rows={2} value={editAccountForm.notes} onChange={e => setEditAccountForm(f => ({ ...f, notes: e.target.value }))} />
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

      {/* ── Add Safe Dialog ──────────────────────────────────── */}
      <Dialog open={showSafeDialog} onOpenChange={setShowSafeDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Add safe</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="safe-form-name">Safe name</Label>
              <Input id="safe-form-name" placeholder="e.g. Head Office Safe" value={safeForm.name} onChange={e => setSafeForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="safe-form-currency">Currency</Label>
              <Select value={safeForm.currency} onValueChange={v => setSafeForm(f => ({ ...f, currency: v }))}>
                <SelectTrigger id="safe-form-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZIG">ZIG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="safe-form-notes">Notes (optional)</Label>
              <Textarea id="safe-form-notes" rows={2} value={safeForm.notes} onChange={e => setSafeForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSafeDialog(false)}>Cancel</Button>
            <Button disabled={!safeForm.name || createSafeMutation.isPending} onClick={() => createSafeMutation.mutate()}>
              {createSafeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Record Deposit Dialog ───────────────────────────── */}
      <Dialog open={showDepositDialog} onOpenChange={setShowDepositDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Record cash movement</DialogTitle></DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Destination</Label>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={depositForm.destinationType === "bank" ? "default" : "outline"}
                  onClick={() => setDepositForm(f => ({ ...f, destinationType: "bank" }))} className="flex-1">
                  <Building2 className="h-3.5 w-3.5 mr-1.5" /> Bank
                </Button>
                <Button type="button" size="sm" variant={depositForm.destinationType === "safe" ? "default" : "outline"}
                  onClick={() => setDepositForm(f => ({ ...f, destinationType: "safe" }))} className="flex-1">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Safe
                </Button>
              </div>
            </div>
            {depositForm.destinationType === "bank" ? (
              <div className="space-y-1.5">
                <Label htmlFor="deposit-form-bank-account-id">Bank account</Label>
                <Select value={depositForm.bankAccountId} onValueChange={v => setDepositForm(f => ({ ...f, bankAccountId: v }))}>
                  <SelectTrigger id="deposit-form-bank-account-id"><SelectValue placeholder="Select account…" /></SelectTrigger>
                  <SelectContent>
                    {bankAccounts.filter((a: any) => a.isActive !== false).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.accountName} ({a.currency})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Safe</Label>
                <Select value={depositForm.safeId} onValueChange={v => setDepositForm(f => ({ ...f, safeId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select safe…" /></SelectTrigger>
                  <SelectContent>
                    {safes.filter((s: any) => s.isActive !== false).map((s: any) => <SelectItem key={s.id} value={s.id}>{s.name} ({s.currency})</SelectItem>)}
                  </SelectContent>
                </Select>
                {safes.length === 0 && <p className="text-xs text-muted-foreground">No safes yet — add one below first.</p>}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <Label htmlFor="deposit-form-reference">Deposit slip / reference (optional)</Label>
              <Input id="deposit-form-reference" placeholder="Slip number or EFT reference" value={depositForm.reference} onChange={e => setDepositForm(f => ({ ...f, reference: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-form-notes">Notes (optional)</Label>
              <Textarea id="deposit-form-notes" rows={2} value={depositForm.notes} onChange={e => setDepositForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDepositDialog(false)}>Cancel</Button>
            <Button
              disabled={
                !depositForm.amount || parseFloat(depositForm.amount) <= 0 || !depositForm.depositDate || createDepositMutation.isPending ||
                (depositForm.destinationType === "bank" ? !depositForm.bankAccountId : !depositForm.safeId)
              }
              onClick={() => createDepositMutation.mutate()}
            >
              {createDepositMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Record {depositForm.destinationType === "safe" ? "Safe Deposit" : "Bank Deposit"}
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
              <Label htmlFor="bal-form-bank-account-id">Bank account</Label>
              <Select value={balForm.bankAccountId} onValueChange={v => setBalForm(f => ({ ...f, bankAccountId: v }))}>
                <SelectTrigger id="bal-form-bank-account-id"><SelectValue placeholder="Select account…" /></SelectTrigger>
                <SelectContent>
                  {bankAccounts.filter((a: any) => a.isActive !== false).map((a: any) => <SelectItem key={a.id} value={a.id}>{a.accountName} ({a.currency})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Statement date</Label>
              <Input type="date" value={balForm.statementDate} onChange={e => setBalForm(f => ({ ...f, statementDate: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              <Label htmlFor="bal-form-notes">Notes (optional)</Label>
              <Textarea id="bal-form-notes" rows={2} value={balForm.notes} onChange={e => setBalForm(f => ({ ...f, notes: e.target.value }))} />
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
