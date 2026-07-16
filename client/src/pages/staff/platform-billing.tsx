import { useState, useEffect } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Settings as SettingsIcon, CreditCard, Plus, Pencil, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BillingSettingsData {
  trialDays: number; graceDays: number; reminderLeadDays: number; moduleEnforcementEnabled: boolean;
}
interface BillingPlanRow {
  id: string; key: string; name: string; description: string | null;
  priceMonthlyUsd: string; modules: string[]; isActive: boolean; sortOrder: number;
}

export default function PlatformBilling() {
  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Billing" description="Global trial/grace defaults and pricing packages for tenant subscriptions." />
        <div className="space-y-6">
          <SettingsCard />
          <PlansCard />
        </div>
      </PageShell>
    </StaffLayout>
  );
}

function SettingsCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<BillingSettingsData>({ queryKey: ["/api/platform/billing/settings"] });
  const [trialDays, setTrialDays] = useState("14");
  const [graceDays, setGraceDays] = useState("7");
  const [reminderLeadDays, setReminderLeadDays] = useState("3");
  const [moduleEnforcementEnabled, setModuleEnforcementEnabled] = useState(false);

  useEffect(() => {
    if (data) {
      setTrialDays(String(data.trialDays));
      setGraceDays(String(data.graceDays));
      setReminderLeadDays(String(data.reminderLeadDays));
      setModuleEnforcementEnabled(data.moduleEnforcementEnabled);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (body: Partial<BillingSettingsData>) => { await apiRequest("PUT", "/api/platform/billing/settings", body); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/platform/billing/settings"] }); toast({ title: "Billing settings saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <CardSection title="Global settings" icon={SettingsIcon}><div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div></CardSection>;
  }

  return (
    <CardSection title="Global settings" description="Defaults applied to every tenant unless overridden individually." icon={SettingsIcon}>
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pb-trial">Trial length (days)</Label>
            <Input id="pb-trial" type="number" min={0} value={trialDays} onChange={(e) => setTrialDays(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-grace">Grace period (days)</Label>
            <Input id="pb-grace" type="number" min={0} value={graceDays} onChange={(e) => setGraceDays(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-reminder">Reminder lead time (days)</Label>
            <Input id="pb-reminder" type="number" min={0} value={reminderLeadDays} onChange={(e) => setReminderLeadDays(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border p-4">
          <div className="space-y-0.5">
            <Label className="font-medium">Module enforcement</Label>
            <p className="text-xs text-muted-foreground">
              Kill switch for plan-based feature gating (Claims, Funeral Ops, Fleet, Payroll). Off by
              default — no tenant is restricted from any module until this is turned on.
            </p>
          </div>
          <Switch checked={moduleEnforcementEnabled} onCheckedChange={(v) => setModuleEnforcementEnabled(v === true)} />
        </div>
        <Button
          onClick={() => saveMutation.mutate({
            trialDays: parseInt(trialDays, 10) || 0,
            graceDays: parseInt(graceDays, 10) || 0,
            reminderLeadDays: parseInt(reminderLeadDays, 10) || 0,
            moduleEnforcementEnabled,
          })}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save settings
        </Button>
      </div>
    </CardSection>
  );
}

const MODULE_LABELS: Record<string, string> = {
  claims: "Claims", funeral_ops: "Funeral Operations", fleet: "Fleet Tracking",
  payroll: "Payroll & Attendance", whatsapp_notifications: "WhatsApp Notifications", mobile_payments: "Mobile Payments",
};

function emptyPlanForm() {
  return { id: "", key: "", name: "", description: "", priceMonthlyUsd: "", modules: [] as string[], sortOrder: 0 };
}

function PlansCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ knownModules: string[]; plans: BillingPlanRow[] }>({ queryKey: ["/api/platform/billing/plans"] });
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyPlanForm());
  const [deleteTarget, setDeleteTarget] = useState<BillingPlanRow | null>(null);

  function invalidate() { queryClient.invalidateQueries({ queryKey: ["/api/platform/billing/plans"] }); }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        key: form.key.trim(), name: form.name.trim(), description: form.description.trim() || undefined,
        priceMonthlyUsd: form.priceMonthlyUsd, modules: form.modules, sortOrder: form.sortOrder,
      };
      if (form.id) await apiRequest("PATCH", `/api/platform/billing/plans/${form.id}`, body);
      else await apiRequest("POST", "/api/platform/billing/plans", body);
    },
    onSuccess: () => { invalidate(); setFormOpen(false); toast({ title: form.id ? "Plan updated" : "Plan created" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActiveMutation = useMutation({
    mutationFn: async (plan: BillingPlanRow) => { await apiRequest("PATCH", `/api/platform/billing/plans/${plan.id}`, { isActive: !plan.isActive }); },
    onSuccess: () => invalidate(),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!deleteTarget) return null;
      const res = await apiRequest("DELETE", `/api/platform/billing/plans/${deleteTarget.id}`);
      return res.status === 204 ? null : res.json();
    },
    onSuccess: (data: any) => {
      invalidate();
      setDeleteTarget(null);
      toast({ title: data?.retired ? "Plan retired (tenants are still subscribed to it)" : "Plan deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openCreate() { setForm(emptyPlanForm()); setFormOpen(true); }
  function openEdit(plan: BillingPlanRow) {
    setForm({ id: plan.id, key: plan.key, name: plan.name, description: plan.description || "", priceMonthlyUsd: plan.priceMonthlyUsd, modules: plan.modules, sortOrder: plan.sortOrder });
    setFormOpen(true);
  }
  function toggleModule(moduleKey: string) {
    setForm((f) => ({ ...f, modules: f.modules.includes(moduleKey) ? f.modules.filter((m) => m !== moduleKey) : [...f.modules, moduleKey] }));
  }

  const plans = [...(data?.plans ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const knownModules = data?.knownModules ?? Object.keys(MODULE_LABELS);

  return (
    <CardSection
      title="Plans"
      description="Pricing packages, each bundling a set of modules. Fully editable at any time."
      icon={CreditCard}
      headerRight={<Button size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> New plan</Button>}
    >
      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : plans.length === 0 ? (
        <EmptyState title="No plans yet" description="Create a plan to start assigning tenants to it." className="border-0 rounded-none bg-transparent py-10" />
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Plan</TableHead><TableHead>Price</TableHead><TableHead>Modules</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="font-medium">{plan.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{plan.key}</div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">${plan.priceMonthlyUsd}/mo</TableCell>
                  <TableCell className="max-w-xs">
                    <div className="flex flex-wrap gap-1">
                      {plan.modules.length === 0
                        ? <span className="text-xs text-muted-foreground">Core only</span>
                        : plan.modules.map((m) => <Badge key={m} variant="outline" className="text-xs">{MODULE_LABELS[m] ?? m}</Badge>)}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={plan.isActive}
                      disabled={toggleActiveMutation.isPending && toggleActiveMutation.variables?.id === plan.id}
                      onCheckedChange={() => toggleActiveMutation.mutate(plan)}
                    />
                  </TableCell>
                  <TableCell className="flex gap-1 justify-end">
                    <Button size="sm" variant="ghost" onClick={() => openEdit(plan)}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(plan)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{form.id ? "Edit plan" : "New plan"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="pb-plan-key">Key (stable, not shown to tenants)</Label>
                <Input id="pb-plan-key" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="starter" disabled={!!form.id} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pb-plan-price">Price (USD/month)</Label>
                <Input id="pb-plan-price" type="number" min={0} step="0.01" value={form.priceMonthlyUsd} onChange={(e) => setForm({ ...form, priceMonthlyUsd: e.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-plan-name">Name</Label>
              <Input id="pb-plan-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Starter" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-plan-desc">Description (optional)</Label>
              <Input id="pb-plan-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Modules included</Label>
              <p className="text-xs text-muted-foreground">Policies, clients, payments, and reports are always included in every plan.</p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {knownModules.map((m) => (
                  <label key={m} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.modules.includes(m)} onCheckedChange={() => toggleModule(m)} />
                    {MODULE_LABELS[m] ?? m}
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pb-plan-sort">Sort order</Label>
              <Input id="pb-plan-sort" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: parseInt(e.target.value, 10) || 0 })} className="max-w-[120px]" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!form.key.trim() || !form.name.trim() || !form.priceMonthlyUsd || saveMutation.isPending}
            >
              {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {form.id ? "Save changes" : "Create plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              If any tenant is currently subscribed to this plan, it will be retired (deactivated, kept
              for historical invoices) instead of deleted outright.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardSection>
  );
}
