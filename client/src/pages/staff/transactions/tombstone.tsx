import { useState, useMemo } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Milestone, Plus, Loader2, DollarSign, PackageCheck, Wallet } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { formatAmount } from "@shared/validation";
import { ClientSearchInput } from "@/components/client-search-input";

const STATUSES = ["ordered", "in_production", "ready", "delivered", "installed", "cancelled"] as const;
const STATUS_LABELS: Record<string, string> = {
  ordered: "Ordered", in_production: "In Production", ready: "Ready", delivered: "Delivered", installed: "Installed", cancelled: "Cancelled",
};
const STATUS_BADGE: Record<string, string> = {
  ordered: "bg-slate-50 text-slate-700 border-slate-200",
  in_production: "bg-amber-50 text-amber-700 border-amber-200",
  ready: "bg-blue-50 text-blue-700 border-blue-200",
  delivered: "bg-indigo-50 text-indigo-700 border-indigo-200",
  installed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-red-50 text-red-700 border-red-200",
};

const today = () => new Date().toISOString().slice(0, 10);
const emptyOrderForm = {
  deceasedName: "", clientId: "", catalogItemId: "", itemDescription: "", material: "", engravingText: "",
  cemeteryId: "", plotReference: "", supplierName: "", amount: "", currency: "USD",
  orderedDate: today(), expectedDeliveryDate: "", notes: "",
};

export default function TombstoneTransactions() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:funeral_ops");
  const canReceipt = permissions.includes("receipt:cash") || permissions.includes("write:finance");

  const { data: orders = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/tombstones/orders"] });
  const { data: catalog = [] } = useQuery<any[]>({ queryKey: ["/api/tombstones/catalog"] });
  const { data: cemeteries = [] } = useQuery<any[]>({
    queryKey: ["/api/cemeteries"],
    queryFn: async () => { const r = await fetch("/api/cemeteries", { credentials: "include" }); return r.ok ? r.json() : []; },
  });

  // ── New order ──
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState(emptyOrderForm);
  const resetForm = () => setForm(emptyOrderForm);
  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tombstones/orders", {
        deceasedName: form.deceasedName.trim(),
        clientId: form.clientId || undefined,
        catalogItemId: form.catalogItemId || undefined,
        itemDescription: form.itemDescription.trim(),
        material: form.material.trim() || undefined,
        engravingText: form.engravingText.trim() || undefined,
        cemeteryId: form.cemeteryId || undefined,
        plotReference: form.plotReference.trim() || undefined,
        supplierName: form.supplierName.trim() || undefined,
        amount: form.amount,
        currency: form.currency,
        orderedDate: form.orderedDate,
        expectedDeliveryDate: form.expectedDeliveryDate || undefined,
        notes: form.notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/orders"] });
      setShowDialog(false);
      resetForm();
      toast({ title: "Tombstone order created" });
    },
    onError: (err: Error) => toast({ title: "Could not create order", description: err.message, variant: "destructive" }),
  });

  const applyCatalogItem = (catalogItemId: string) => {
    const item = catalog.find((c: any) => c.id === catalogItemId);
    setForm((f) => ({
      ...f,
      catalogItemId,
      itemDescription: item ? item.name : f.itemDescription,
      material: item?.material || f.material,
      amount: item ? String(item.price) : f.amount,
      currency: item?.currency || f.currency,
      supplierName: item?.defaultSupplierName || f.supplierName,
    }));
  };

  // ── Status update ──
  const statusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const res = await apiRequest("PATCH", `/api/tombstones/orders/${id}`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/orders"] });
      toast({ title: "Order updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update order", description: err.message, variant: "destructive" }),
  });

  // ── Record payment ──
  const [paymentOrder, setPaymentOrder] = useState<any | null>(null);
  const [paymentForm, setPaymentForm] = useState({ amount: "", paymentChannel: "cash", notes: "" });
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/tombstones/orders/${paymentOrder.id}/payments`, {
        amount: paymentForm.amount,
        paymentChannel: paymentForm.paymentChannel,
        notes: paymentForm.notes.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/orders"] });
      setPaymentOrder(null);
      setPaymentForm({ amount: "", paymentChannel: "cash", notes: "" });
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => toast({ title: "Could not record payment", description: err.message, variant: "destructive" }),
  });

  const activeOrders = orders.filter((o: any) => o.status !== "installed" && o.status !== "cancelled");
  const outstandingBalance = useMemo(() => orders
    .filter((o: any) => o.status !== "cancelled")
    .reduce((s: number, o: any) => s + Math.max(0, (Number(o.amount) || 0) - (Number(o.amountPaid) || 0)), 0), [orders]);
  const thisMonthValue = useMemo(() => {
    const monthKey = today().slice(0, 7);
    return orders.filter((o: any) => String(o.orderedDate).slice(0, 7) === monthKey).reduce((s: number, o: any) => s + (Number(o.amount) || 0), 0);
  }, [orders]);

  const columns: EdtColumn<any>[] = [
    { id: "orderNumber", header: "Order #", accessor: (o) => o.orderNumber, cell: (o) => <span className="font-mono text-xs">{o.orderNumber}</span> },
    { id: "deceased", header: "Deceased", accessor: (o) => o.deceasedName, cell: (o) => <span className="font-medium">{o.deceasedName}</span> },
    { id: "item", header: "Item", accessor: (o) => o.itemDescription, cell: (o) => <span className="text-sm">{o.itemDescription}</span> },
    { id: "amount", header: "Amount", align: "right", accessor: (o) => Number(o.amount) || 0, cell: (o) => <span className="tabular-nums">{formatAmount(Number(o.amount) || 0, o.currency)}</span> },
    { id: "paid", header: "Paid", align: "right", accessor: (o) => Number(o.amountPaid) || 0, cell: (o) => <span className="tabular-nums text-emerald-700">{formatAmount(Number(o.amountPaid) || 0, o.currency)}</span> },
    { id: "balance", header: "Balance", align: "right", accessor: (o) => (Number(o.amount) || 0) - (Number(o.amountPaid) || 0), cell: (o) => { const bal = (Number(o.amount) || 0) - (Number(o.amountPaid) || 0); return <span className={`tabular-nums ${bal > 0 ? "text-amber-700 font-medium" : "text-muted-foreground"}`}>{formatAmount(bal, o.currency)}</span>; } },
    {
      id: "status", header: "Status", accessor: (o) => o.status,
      cell: (o) => canWrite ? (
        <Select value={o.status} onValueChange={(v) => statusMutation.mutate({ id: o.id, status: v })}>
          <SelectTrigger className="h-7 w-36 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>)}</SelectContent>
        </Select>
      ) : <Badge variant="outline" className={STATUS_BADGE[o.status] || ""}>{STATUS_LABELS[o.status] || o.status}</Badge>,
    },
    { id: "orderedDate", header: "Ordered", accessor: (o) => o.orderedDate, cell: (o) => <span className="text-sm text-muted-foreground">{o.orderedDate ? new Date(o.orderedDate).toLocaleDateString() : "—"}</span> },
    {
      id: "actions", header: "Actions", align: "right", exportable: false,
      cell: (o) => canReceipt && o.status !== "cancelled" && (Number(o.amount) || 0) > (Number(o.amountPaid) || 0) ? (
        <Button variant="ghost" size="sm" onClick={() => { setPaymentOrder(o); setPaymentForm({ amount: "", paymentChannel: "cash", notes: "" }); }}>
          <DollarSign className="h-4 w-4 mr-1" />Record Payment
        </Button>
      ) : null,
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Tombstone Transactions"
          description="Capture tombstone orders and track them through production, delivery, and installation."
          actions={canWrite ? (
            <Button onClick={() => setShowDialog(true)} className="gap-1.5" data-testid="btn-new-tombstone-order">
              <Plus className="h-4 w-4" /> New Order
            </Button>
          ) : undefined}
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard label="Active Orders" value={activeOrders.length} icon={Milestone} />
          <KpiStatCard label="Outstanding Balance" value={<span className="tabular-nums">{formatAmount(outstandingBalance, "USD")}</span>} icon={Wallet} />
          <KpiStatCard label="This Month's Orders" value={<span className="tabular-nums">{formatAmount(thisMonthValue, "USD")}</span>} icon={PackageCheck} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={orders}
            getRowKey={(o) => o.id}
            rowTestId={(o) => `row-tombstone-order-${o.id}`}
            searchPlaceholder="Search orders…"
            exportFilename="tombstone-orders"
            storageKey="tombstone-orders"
            emptyMessage="No tombstone orders yet."
          />
        )}
      </PageShell>

      {/* New order */}
      <Dialog open={showDialog} onOpenChange={(o) => { setShowDialog(o); if (!o) resetForm(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>New Tombstone Order</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="to-deceased">Deceased name</Label>
              <Input id="to-deceased" value={form.deceasedName} onChange={(e) => setForm((f) => ({ ...f, deceasedName: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-client">Client (optional)</Label>
              <ClientSearchInput value={form.clientId} onChange={(id) => setForm((f) => ({ ...f, clientId: id }))} data-testid="to-client" />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="to-catalog">Catalogue item (optional — fills in defaults)</Label>
              <Select value={form.catalogItemId || "none"} onValueChange={(v) => applyCatalogItem(v === "none" ? "" : v)}>
                <SelectTrigger id="to-catalog"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Custom (no catalogue item)</SelectItem>
                  {catalog.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name} — {formatAmount(Number(c.price) || 0, c.currency)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="to-item">Item description</Label>
              <Input id="to-item" value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-material">Material</Label>
              <Input id="to-material" value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-supplier">Supplier</Label>
              <Input id="to-supplier" value={form.supplierName} onChange={(e) => setForm((f) => ({ ...f, supplierName: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="to-engraving">Engraving text</Label>
              <Textarea id="to-engraving" value={form.engravingText} onChange={(e) => setForm((f) => ({ ...f, engravingText: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-cemetery">Cemetery</Label>
              <Select value={form.cemeteryId || "none"} onValueChange={(v) => setForm((f) => ({ ...f, cemeteryId: v === "none" ? "" : v }))}>
                <SelectTrigger id="to-cemetery"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Unspecified</SelectItem>
                  {cemeteries.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-plot">Plot reference</Label>
              <Input id="to-plot" value={form.plotReference} onChange={(e) => setForm((f) => ({ ...f, plotReference: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-amount">Amount</Label>
              <Input id="to-amount" type="number" step="0.01" min="0" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="to-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{["USD", "ZAR", "ZIG"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-ordered">Ordered date</Label>
              <Input id="to-ordered" type="date" value={form.orderedDate} onChange={(e) => setForm((f) => ({ ...f, orderedDate: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="to-expected">Expected delivery</Label>
              <Input id="to-expected" type="date" value={form.expectedDeliveryDate} onChange={(e) => setForm((f) => ({ ...f, expectedDeliveryDate: e.target.value }))} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="to-notes">Notes</Label>
              <Textarea id="to-notes" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!form.deceasedName.trim() || !form.itemDescription.trim() || !form.amount || !form.orderedDate || createMutation.isPending}
              data-testid="btn-save-tombstone-order"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Record payment */}
      <Dialog open={!!paymentOrder} onOpenChange={(o) => { if (!o) setPaymentOrder(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Payment — {paymentOrder?.orderNumber}</DialogTitle></DialogHeader>
          {paymentOrder && (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                Balance due: {formatAmount((Number(paymentOrder.amount) || 0) - (Number(paymentOrder.amountPaid) || 0), paymentOrder.currency)}
              </p>
              <div className="grid gap-2">
                <Label htmlFor="pay-amount">Amount</Label>
                <Input id="pay-amount" type="number" step="0.01" min="0" value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pay-channel">Payment method</Label>
                <Select value={paymentForm.paymentChannel} onValueChange={(v) => setPaymentForm((f) => ({ ...f, paymentChannel: v }))}>
                  <SelectTrigger id="pay-channel"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="paynow_ecocash">Ecocash</SelectItem>
                    <SelectItem value="paynow_card">Card</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="pay-notes">Notes</Label>
                <Input id="pay-notes" value={paymentForm.notes} onChange={(e) => setPaymentForm((f) => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPaymentOrder(null)}>Cancel</Button>
            <Button
              onClick={() => paymentMutation.mutate()}
              disabled={!paymentForm.amount || paymentMutation.isPending}
              data-testid="btn-save-tombstone-payment"
            >
              {paymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
