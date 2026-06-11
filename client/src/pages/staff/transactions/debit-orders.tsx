import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CreditCard, Plus, Loader2, Pause, Play, XCircle } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatAmount } from "@shared/validation";

const FREQUENCIES = ["weekly", "biweekly", "monthly", "quarterly"];

export default function DebitOrders() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:finance");
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({
    accountName: "", bankName: "", accountNumber: "", branchCode: "",
    amount: "", currency: "USD", frequency: "monthly", dayOfMonth: "", startDate: "", notes: "",
  });

  const { data: orders = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/debit-orders"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/debit-orders", {
        accountName: form.accountName.trim(),
        bankName: form.bankName.trim(),
        accountNumber: form.accountNumber.trim(),
        branchCode: form.branchCode.trim() || undefined,
        amount: form.amount,
        currency: form.currency,
        frequency: form.frequency,
        dayOfMonth: form.dayOfMonth ? Number(form.dayOfMonth) : undefined,
        startDate: form.startDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/debit-orders"] });
      setShowDialog(false);
      setForm({ accountName: "", bankName: "", accountNumber: "", branchCode: "", amount: "", currency: "USD", frequency: "monthly", dayOfMonth: "", startDate: "", notes: "" });
      toast({ title: "Debit order created" });
    },
    onError: (err: Error) => toast({ title: "Could not create debit order", description: err.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/debit-orders/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/debit-orders"] });
      toast({ title: "Debit order updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const activeCount = orders.filter((o: any) => o.status === "active").length;
  const monthlyValue = orders
    .filter((o: any) => o.status === "active" && o.frequency === "monthly")
    .reduce((sum: number, o: any) => sum + (Number(o.amount) || 0), 0);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      active: "bg-emerald-50 text-emerald-700 border-emerald-200",
      paused: "bg-amber-50 text-amber-700 border-amber-200",
      cancelled: "bg-red-50 text-red-700 border-red-200",
    };
    return <Badge variant="outline" className={map[status] || ""}>{status}</Badge>;
  };

  const columns: EdtColumn<any>[] = [
    { id: "ref", header: "Reference", accessor: (o) => o.mandateReference, cell: (o) => <span className="font-mono text-xs">{o.mandateReference}</span> },
    { id: "account", header: "Account", accessor: (o) => `${o.accountName} ${o.bankName}`, cell: (o) => (<div><span className="font-medium">{o.accountName}</span><br /><span className="text-xs text-muted-foreground">{o.bankName}</span></div>) },
    { id: "number", header: "Account #", accessor: (o) => o.accountNumber, cell: (o) => <span className="font-mono text-xs">{o.accountNumber}</span> },
    { id: "amount", header: "Amount", align: "right", accessor: (o) => Number(o.amount) || 0, cell: (o) => <span className="tabular-nums">{formatAmount(Number(o.amount) || 0, o.currency)}</span> },
    { id: "frequency", header: "Frequency", accessor: (o) => o.frequency, cell: (o) => <span className="capitalize">{o.frequency}</span> },
    { id: "next", header: "Next Run", accessor: (o) => o.nextRunDate ?? "", cell: (o) => <span className="text-sm text-muted-foreground">{o.nextRunDate ? new Date(o.nextRunDate).toLocaleDateString() : "—"}</span> },
    { id: "status", header: "Status", accessor: (o) => o.status, cell: (o) => statusBadge(o.status) },
    {
      id: "actions", header: "Actions", align: "right", exportable: false,
      cell: (o) => (
        <div className="flex items-center justify-end gap-1">
          {canWrite && o.status === "active" && (
            <Button variant="ghost" size="sm" onClick={() => statusMutation.mutate({ id: o.id, status: "paused" })} title="Pause"><Pause className="h-4 w-4" /></Button>
          )}
          {canWrite && o.status === "paused" && (
            <Button variant="ghost" size="sm" onClick={() => statusMutation.mutate({ id: o.id, status: "active" })} title="Resume"><Play className="h-4 w-4" /></Button>
          )}
          {canWrite && o.status !== "cancelled" && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => statusMutation.mutate({ id: o.id, status: "cancelled" })} title="Cancel"><XCircle className="h-4 w-4" /></Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Debit Orders"
          description="Recurring bank-debit mandates used to collect policy premiums."
          actions={canWrite ? (
            <Button onClick={() => setShowDialog(true)} className="gap-1.5" data-testid="btn-new-debit-order">
              <Plus className="h-4 w-4" /> New Debit Order
            </Button>
          ) : undefined}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard label="Mandates" value={orders.length} icon={CreditCard} />
          <KpiStatCard label="Active" value={<span className="text-emerald-600">{activeCount}</span>} icon={Play} />
          <KpiStatCard label="Monthly Value (USD)" value={<span className="tabular-nums">{formatAmount(monthlyValue, "USD")}</span>} icon={CreditCard} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={orders}
            getRowKey={(o) => o.id}
            rowTestId={(o) => `row-debit-order-${o.id}`}
            searchPlaceholder="Search debit orders…"
            exportFilename="debit-orders"
            storageKey="debit-orders"
            emptyMessage="No debit orders yet."
          />
        )}
      </PageShell>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Debit Order</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="do-account-name">Account holder</Label>
              <Input id="do-account-name" value={form.accountName} onChange={(e) => setForm((f) => ({ ...f, accountName: e.target.value }))} data-testid="input-do-account-name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-bank">Bank</Label>
              <Input id="do-bank" value={form.bankName} onChange={(e) => setForm((f) => ({ ...f, bankName: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-account-number">Account number</Label>
              <Input id="do-account-number" value={form.accountNumber} onChange={(e) => setForm((f) => ({ ...f, accountNumber: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-branch-code">Branch code</Label>
              <Input id="do-branch-code" value={form.branchCode} onChange={(e) => setForm((f) => ({ ...f, branchCode: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-amount">Amount</Label>
              <Input id="do-amount" type="number" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="do-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{["USD", "ZAR", "ZIG"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-frequency">Frequency</Label>
              <Select value={form.frequency} onValueChange={(v) => setForm((f) => ({ ...f, frequency: v }))}>
                <SelectTrigger id="do-frequency"><SelectValue /></SelectTrigger>
                <SelectContent>{FREQUENCIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-day">Day of month</Label>
              <Input id="do-day" type="number" min="1" max="31" value={form.dayOfMonth} onChange={(e) => setForm((f) => ({ ...f, dayOfMonth: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="do-start">Start date</Label>
              <Input id="do-start" type="date" value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="do-notes">Notes</Label>
              <Input id="do-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.accountName.trim() || !form.bankName.trim() || !form.accountNumber.trim() || !form.amount || createMutation.isPending}
              data-testid="btn-save-debit-order"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
