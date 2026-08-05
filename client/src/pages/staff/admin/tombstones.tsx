import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Milestone, Plus, Loader2, Package } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatAmount } from "@shared/validation";

const emptyForm = { name: "", material: "", size: "", color: "", description: "", price: "", currency: "USD", defaultSupplierName: "" };

export default function TombstonesAdmin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editItem, setEditItem] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: items = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/tombstones/catalog"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/tombstones/catalog", {
        name: form.name.trim(),
        material: form.material.trim() || undefined,
        size: form.size.trim() || undefined,
        color: form.color.trim() || undefined,
        description: form.description.trim() || undefined,
        price: form.price,
        currency: form.currency,
        defaultSupplierName: form.defaultSupplierName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/catalog"] });
      setShowDialog(false);
      setForm(emptyForm);
      toast({ title: "Catalogue item added" });
    },
    onError: (err: Error) => toast({ title: "Could not add item", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/tombstones/catalog/${editItem.id}`, {
        name: form.name.trim(),
        material: form.material.trim() || undefined,
        size: form.size.trim() || undefined,
        color: form.color.trim() || undefined,
        description: form.description.trim() || undefined,
        price: form.price,
        currency: form.currency,
        defaultSupplierName: form.defaultSupplierName.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/catalog"] });
      setEditItem(null);
      setForm(emptyForm);
      toast({ title: "Catalogue item updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update item", description: err.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PATCH", `/api/tombstones/catalog/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tombstones/catalog"] });
      toast({ title: "Updated" });
    },
    onError: (err: Error) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const openEdit = (item: any) => {
    setEditItem(item);
    setForm({
      name: item.name || "", material: item.material || "", size: item.size || "", color: item.color || "",
      description: item.description || "", price: String(item.price ?? ""), currency: item.currency || "USD",
      defaultSupplierName: item.defaultSupplierName || "",
    });
  };

  const activeCount = items.filter((i: any) => i.isActive).length;

  const columns: EdtColumn<any>[] = [
    { id: "name", header: "Name", accessor: (i) => i.name, cell: (i) => <span className="font-medium">{i.name}</span> },
    { id: "material", header: "Material", accessor: (i) => i.material || "", cell: (i) => <span className="text-sm">{i.material || "—"}</span> },
    { id: "size", header: "Size", accessor: (i) => i.size || "", cell: (i) => <span className="text-sm">{i.size || "—"}</span> },
    { id: "color", header: "Color", accessor: (i) => i.color || "", cell: (i) => <span className="text-sm">{i.color || "—"}</span> },
    { id: "price", header: "Price", align: "right", accessor: (i) => Number(i.price) || 0, cell: (i) => <span className="tabular-nums font-medium">{formatAmount(Number(i.price) || 0, i.currency)}</span> },
    { id: "supplier", header: "Default Supplier", accessor: (i) => i.defaultSupplierName || "", cell: (i) => <span className="text-sm text-muted-foreground">{i.defaultSupplierName || "—"}</span> },
    { id: "status", header: "Status", accessor: (i) => i.isActive ? "Active" : "Inactive", cell: (i) => <Badge variant="outline" className={i.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-50 text-slate-600 border-slate-200"}>{i.isActive ? "Active" : "Inactive"}</Badge> },
    {
      id: "actions", header: "Actions", align: "right", exportable: false,
      cell: (i) => (
        <div className="flex items-center justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(i)}>Edit</Button>
          <Button variant="ghost" size="sm" onClick={() => toggleActiveMutation.mutate({ id: i.id, isActive: !i.isActive })}>
            {i.isActive ? "Deactivate" : "Activate"}
          </Button>
        </div>
      ),
    },
  ];

  const dialogOpen = showDialog || !!editItem;
  const closeDialog = () => { setShowDialog(false); setEditItem(null); setForm(emptyForm); };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Tombstones Admin"
          description="Manage the tombstone product catalogue used when capturing tombstone orders."
          actions={
            <Button onClick={() => setShowDialog(true)} className="gap-1.5" data-testid="btn-new-tombstone-item">
              <Plus className="h-4 w-4" /> New Catalogue Item
            </Button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard label="Catalogue Items" value={items.length} icon={Package} />
          <KpiStatCard label="Active" value={<span className="text-emerald-600">{activeCount}</span>} icon={Milestone} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={items}
            getRowKey={(i) => i.id}
            rowTestId={(i) => `row-tombstone-item-${i.id}`}
            searchPlaceholder="Search catalogue…"
            exportFilename="tombstone-catalogue"
            storageKey="tombstone-catalogue"
            emptyMessage="No tombstone catalogue items yet."
          />
        )}
      </PageShell>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editItem ? "Edit Catalogue Item" : "New Catalogue Item"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ti-name">Name</Label>
              <Input id="ti-name" placeholder="e.g. Standard Granite Headstone" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-material">Material</Label>
              <Input id="ti-material" placeholder="e.g. Granite, Marble" value={form.material} onChange={(e) => setForm((f) => ({ ...f, material: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-size">Size</Label>
              <Input id="ti-size" placeholder="e.g. 24 x 12 x 3 in" value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-color">Color</Label>
              <Input id="ti-color" value={form.color} onChange={(e) => setForm((f) => ({ ...f, color: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-supplier">Default supplier</Label>
              <Input id="ti-supplier" value={form.defaultSupplierName} onChange={(e) => setForm((f) => ({ ...f, defaultSupplierName: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-price">Price</Label>
              <Input id="ti-price" type="number" step="0.01" min="0" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ti-currency">Currency</Label>
              <Select value={form.currency} onValueChange={(v) => setForm((f) => ({ ...f, currency: v }))}>
                <SelectTrigger id="ti-currency"><SelectValue /></SelectTrigger>
                <SelectContent>{["USD", "ZAR", "ZIG"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <Label htmlFor="ti-description">Description</Label>
              <Textarea id="ti-description" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={closeDialog}>Cancel</Button>
            <Button
              onClick={() => editItem ? updateMutation.mutate() : createMutation.mutate()}
              disabled={!form.name.trim() || !form.price || createMutation.isPending || updateMutation.isPending}
              data-testid="btn-save-tombstone-item"
            >
              {(createMutation.isPending || updateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editItem ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
