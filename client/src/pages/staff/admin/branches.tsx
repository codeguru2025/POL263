import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Building, Plus, Loader2, MapPin, Star } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Branch Admin — a real screen built on the existing /api/branches endpoints
 * (GET list + POST create). Replaces the StaffComingSoon stub for
 * /staff/admin/branches. RBAC enforced server-side (read:branch / write:branch).
 */
export default function BranchAdmin() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", phone: "", isActive: true });

  const { data: branches = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/branches"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/branches", {
        name: form.name.trim(),
        address: form.address.trim() || undefined,
        phone: form.phone.trim() || undefined,
        isActive: form.isActive,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      setShowDialog(false);
      setForm({ name: "", address: "", phone: "", isActive: true });
      toast({ title: "Branch created" });
    },
    onError: (err: Error) => toast({ title: "Could not create branch", description: err.message, variant: "destructive" }),
  });

  const setHeadOfficeMutation = useMutation({
    mutationFn: async (branchId: string) => {
      const res = await apiRequest("PATCH", `/api/branches/${branchId}`, { isHeadOffice: true });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branches"] });
      toast({ title: "Head Office updated" });
    },
    onError: (err: Error) => toast({ title: "Could not update Head Office", description: err.message, variant: "destructive" }),
  });

  const activeCount = branches.filter((b: any) => b.isActive).length;

  const columns: EdtColumn<any>[] = [
    { id: "name", header: "Branch", accessor: (b) => b.name, cell: (b) => <span className="font-medium">{b.name}</span> },
    { id: "address", header: "Address", accessor: (b) => b.address ?? "" },
    { id: "phone", header: "Phone", accessor: (b) => b.phone ?? "" },
    {
      id: "status",
      header: "Status",
      accessor: (b) => (b.isActive ? "Active" : "Inactive"),
      cell: (b) =>
        b.isActive ? (
          <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
        ) : (
          <Badge variant="outline" className="text-muted-foreground">Inactive</Badge>
        ),
    },
    {
      id: "created",
      header: "Created",
      accessor: (b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0),
      cell: (b) => <span className="text-sm text-muted-foreground">{b.createdAt ? new Date(b.createdAt).toLocaleDateString() : "—"}</span>,
    },
    {
      id: "headOffice",
      header: "Head Office",
      accessor: (b) => (b.isHeadOffice ? 1 : 0),
      cell: (b) =>
        b.isHeadOffice ? (
          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 gap-1">
            <Star className="h-3 w-3 fill-current" /> Head Office
          </Badge>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            disabled={setHeadOfficeMutation.isPending}
            onClick={() => setHeadOfficeMutation.mutate(b.id)}
            data-testid={`btn-set-head-office-${b.id}`}
          >
            Set as Head Office
          </Button>
        ),
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Branch Admin"
          description="Create and manage the branches in your organization."
          actions={
            <Button onClick={() => setShowDialog(true)} className="gap-1.5" data-testid="btn-new-branch">
              <Plus className="h-4 w-4" /> New Branch
            </Button>
          }
        />

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <KpiStatCard label="Branches" value={branches.length} icon={Building} />
          <KpiStatCard label="Active" value={<span className="text-emerald-600">{activeCount}</span>} icon={MapPin} />
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        ) : (
          <EnhancedDataTable
            columns={columns}
            rows={branches}
            getRowKey={(b) => b.id}
            rowTestId={(b) => `row-branch-${b.id}`}
            searchPlaceholder="Search branches…"
            exportFilename="branches"
            storageKey="branches"
            emptyMessage="No branches yet. Create your first branch."
          />
        )}
      </PageShell>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Branch</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="branch-name">Name</Label>
              <Input id="branch-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Harare CBD" data-testid="input-branch-name" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-address">Address</Label>
              <Input id="branch-address" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} placeholder="Street address" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="branch-phone">Phone</Label>
              <Input id="branch-phone" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="Contact number" />
            </div>
            <div className="flex items-center justify-between">
              <Label htmlFor="branch-active">Active</Label>
              <Switch id="branch-active" checked={form.isActive} onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate()} disabled={!form.name.trim() || createMutation.isPending} data-testid="btn-save-branch">
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Branch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
