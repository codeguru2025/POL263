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
  platformFeeRatePercent: string;
  defaultMonthlyMinimumUsd: string; defaultOutstandingFeeCapUsd: string | null; deletionGraceDays: number;
}
type BillingModel = "flat" | "per_policy" | "revenue_share";
interface BillingPlanRow {
  id: string; key: string; name: string; description: string | null;
  priceMonthlyUsd: string; modules: string[]; isActive: boolean; sortOrder: number;
  billingModel: BillingModel; baseFeeUsd: string | null; includedPolicyUnits: number;
  perStatusRates: Record<string, string> | null; revenueSharePercent: string | null;
  monthlyMinimumUsd: string; setupFeeUsd: string | null;
}
interface BillingFeatureRow {
  id: string; key: string; name: string; description: string | null;
  baseFeeDeltaUsd: string; perPolicyRateDeltaUsd: string; revenueSharePercentDelta: string; isActive: boolean;
}

const BILLING_MODEL_LABELS: Record<BillingModel, string> = {
  flat: "Flat monthly fee",
  per_policy: "Per policy",
  revenue_share: "Share of revenue",
};
const POLICY_STATUS_KEYS = ["active", "lapsed", "inactive", "grace", "cancelled", "archived"] as const;

export default function PlatformBilling() {
  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Billing" description="Global trial/grace defaults and pricing packages for tenant subscriptions." />
        <div className="space-y-6">
          <SettingsCard />
          <PlansCard />
          <FeaturesCard />
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
  const [platformFeeRatePercent, setPlatformFeeRatePercent] = useState("2.50");
  const [defaultMonthlyMinimumUsd, setDefaultMonthlyMinimumUsd] = useState("250.00");
  const [defaultOutstandingFeeCapUsd, setDefaultOutstandingFeeCapUsd] = useState("");
  const [deletionGraceDays, setDeletionGraceDays] = useState("30");

  useEffect(() => {
    if (data) {
      setTrialDays(String(data.trialDays));
      setGraceDays(String(data.graceDays));
      setReminderLeadDays(String(data.reminderLeadDays));
      setModuleEnforcementEnabled(data.moduleEnforcementEnabled);
      setPlatformFeeRatePercent(String(data.platformFeeRatePercent));
      setDefaultMonthlyMinimumUsd(String(data.defaultMonthlyMinimumUsd ?? "250.00"));
      setDefaultOutstandingFeeCapUsd(data.defaultOutstandingFeeCapUsd ?? "");
      setDeletionGraceDays(String(data.deletionGraceDays ?? 30));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (body: Partial<BillingSettingsData>) => { await apiRequest("PUT", "/api/platform/billing/settings", body); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/platform/billing/settings"] }); toast({ title: "Billing settings saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const runSweepNowMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/platform/billing/sweep", {})).json(),
    onSuccess: (data: any) => {
      toast({
        title: "Billing sweep complete",
        description: `${data.invoicesGenerated} invoice(s) generated, ${data.pastDueTransitions} moved past-due, ${data.autoSuspensions} auto-suspended${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`,
      });
    },
    onError: (e: any) => toast({ title: "Run failed", description: e.message, variant: "destructive" }),
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
          <div className="space-y-2">
            <Label htmlFor="pb-fee-rate">Revenue-share rate (%)</Label>
            <Input id="pb-fee-rate" type="number" min={0} max={100} step="0.01" value={platformFeeRatePercent} onChange={(e) => setPlatformFeeRatePercent(e.target.value)} />
            <p className="text-xs text-muted-foreground">Default share of a tenant's receipted revenue, unless a plan or the tenant's subscription sets its own.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-min">Monthly minimum (USD)</Label>
            <Input id="pb-min" type="number" min={0} step="0.01" value={defaultMonthlyMinimumUsd} onChange={(e) => setDefaultMonthlyMinimumUsd(e.target.value)} />
            <p className="text-xs text-muted-foreground">Per-policy and revenue-share tenants pay at least this each month.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-cap">Unpaid-fee limit (USD)</Label>
            <Input id="pb-cap" type="number" min={0} step="0.01" value={defaultOutstandingFeeCapUsd} onChange={(e) => setDefaultOutstandingFeeCapUsd(e.target.value)} placeholder="No limit" />
            <p className="text-xs text-muted-foreground">When a revenue-share tenant's unpaid fees pass this, they're billed immediately and access is blocked. Blank = no limit. Can be set per tenant.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pb-deletion">View-only window after suspension (days)</Label>
            <Input id="pb-deletion" type="number" min={1} step="1" value={deletionGraceDays} onChange={(e) => setDeletionGraceDays(e.target.value)} />
            <p className="text-xs text-muted-foreground">A suspended tenant can still view (not edit) their data for this long before it's permanently deleted.</p>
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
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => saveMutation.mutate({
              trialDays: parseInt(trialDays, 10) || 0,
              graceDays: parseInt(graceDays, 10) || 0,
              reminderLeadDays: parseInt(reminderLeadDays, 10) || 0,
              moduleEnforcementEnabled,
              platformFeeRatePercent,
              defaultMonthlyMinimumUsd,
              defaultOutstandingFeeCapUsd: defaultOutstandingFeeCapUsd.trim() || null,
              deletionGraceDays: parseInt(deletionGraceDays, 10) || 30,
            } as any)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save settings
          </Button>
          <Button variant="outline" onClick={() => runSweepNowMutation.mutate()} disabled={runSweepNowMutation.isPending}>
            {runSweepNowMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Run billing sweep now
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          The billing sweep already runs automatically once a day (06:00 UTC) — generates invoice reminders, moves overdue subscriptions to past-due, and auto-suspends past their grace period. Use this to run it on demand.
        </p>
      </div>
    </CardSection>
  );
}

const MODULE_LABELS: Record<string, string> = {
  claims: "Claims", funeral_ops: "Funeral Operations", fleet: "Fleet Tracking",
  payroll: "Payroll & Attendance", whatsapp_notifications: "WhatsApp Notifications", mobile_payments: "Mobile Payments",
  email_notifications: "Email Notifications", email_inbound: "Inbound Email", sms_notifications: "SMS Notifications",
  legacy_records: "Legacy Records Import",
};

function emptyPlanForm() {
  return {
    id: "", key: "", name: "", description: "", priceMonthlyUsd: "", modules: [] as string[], sortOrder: 0,
    billingModel: "flat" as BillingModel, baseFeeUsd: "", includedPolicyUnits: "1000",
    perStatusRates: {} as Record<string, string>, revenueSharePercent: "", monthlyMinimumUsd: "250.00", setupFeeUsd: "",
  };
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
      const rates: Record<string, string> = {};
      for (const [k, v] of Object.entries(form.perStatusRates)) {
        if (String(v).trim() !== "") rates[k] = String(v).trim();
      }
      const body: Record<string, unknown> = {
        key: form.key.trim(), name: form.name.trim(), description: form.description.trim() || undefined,
        priceMonthlyUsd: form.priceMonthlyUsd, modules: form.modules, sortOrder: form.sortOrder,
        billingModel: form.billingModel,
        baseFeeUsd: form.baseFeeUsd.trim() || null,
        includedPolicyUnits: parseInt(form.includedPolicyUnits, 10) || 0,
        perStatusRates: Object.keys(rates).length ? rates : null,
        revenueSharePercent: form.revenueSharePercent.trim() || null,
        monthlyMinimumUsd: form.monthlyMinimumUsd.trim() || "0",
        setupFeeUsd: form.setupFeeUsd.trim() || null,
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
    setForm({
      id: plan.id, key: plan.key, name: plan.name, description: plan.description || "",
      priceMonthlyUsd: plan.priceMonthlyUsd, modules: plan.modules, sortOrder: plan.sortOrder,
      billingModel: plan.billingModel || "flat",
      baseFeeUsd: plan.baseFeeUsd ?? "",
      includedPolicyUnits: String(plan.includedPolicyUnits ?? 1000),
      perStatusRates: plan.perStatusRates ?? {},
      revenueSharePercent: plan.revenueSharePercent ?? "",
      monthlyMinimumUsd: plan.monthlyMinimumUsd ?? "250.00",
      setupFeeUsd: plan.setupFeeUsd ?? "",
    });
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
              <TableRow><TableHead>Plan</TableHead><TableHead>Billing</TableHead><TableHead>Modules</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <div className="font-medium">{plan.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{plan.key}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <div>{BILLING_MODEL_LABELS[plan.billingModel] ?? plan.billingModel}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {plan.billingModel === "flat" && `$${plan.priceMonthlyUsd}/mo`}
                      {plan.billingModel === "per_policy" && `$${plan.baseFeeUsd ?? plan.priceMonthlyUsd} base + per policy`}
                      {plan.billingModel === "revenue_share" && `${plan.revenueSharePercent ?? "—"}% of revenue`}
                    </div>
                  </TableCell>
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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

            <div className="space-y-2 rounded-lg border p-3">
              <Label htmlFor="pb-plan-model">How this plan is billed</Label>
              <select
                id="pb-plan-model"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                value={form.billingModel}
                onChange={(e) => setForm({ ...form, billingModel: e.target.value as BillingModel })}
              >
                <option value="flat">Flat monthly fee — same price every month</option>
                <option value="per_policy">Per policy — base fee + a rate per policy on file</option>
                <option value="revenue_share">Share of revenue — a % of what the tenant collects</option>
              </select>

              {form.billingModel === "flat" && (
                <p className="text-xs text-muted-foreground">Uses the monthly price above. Nothing else to set.</p>
              )}

              {form.billingModel === "per_policy" && (
                <div className="space-y-3 pt-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="pb-base" className="text-xs">Base fee (USD/mo)</Label>
                      <Input id="pb-base" type="number" min={0} step="0.01" placeholder={form.priceMonthlyUsd || "0.00"} value={form.baseFeeUsd} onChange={(e) => setForm({ ...form, baseFeeUsd: e.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pb-incl" className="text-xs">Policies included in base fee</Label>
                      <Input id="pb-incl" type="number" min={0} value={form.includedPolicyUnits} onChange={(e) => setForm({ ...form, includedPolicyUnits: e.target.value })} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Rate per policy beyond the included count (USD/mo)</Label>
                    <div className="grid grid-cols-3 gap-2">
                      {POLICY_STATUS_KEYS.map((st) => (
                        <div key={st} className="space-y-1">
                          <span className="text-[11px] text-muted-foreground capitalize">{st}</span>
                          <Input
                            type="number" min={0} step="0.01"
                            placeholder="default"
                            value={form.perStatusRates[st] ?? ""}
                            onChange={(e) => setForm({ ...form, perStatusRates: { ...form.perStatusRates, [st]: e.target.value } })}
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">Leave blank to use the platform default (active/lapsed $0.10, others $0.05, archived $0.01).</p>
                  </div>
                </div>
              )}

              {form.billingModel === "revenue_share" && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor="pb-rev" className="text-xs">Share of revenue (%)</Label>
                    <Input id="pb-rev" type="number" min={0} max={100} step="0.01" placeholder="2.50" value={form.revenueSharePercent} onChange={(e) => setForm({ ...form, revenueSharePercent: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pb-rev-base" className="text-xs">Base fee (USD/mo, optional)</Label>
                    <Input id="pb-rev-base" type="number" min={0} step="0.01" placeholder="0.00" value={form.baseFeeUsd} onChange={(e) => setForm({ ...form, baseFeeUsd: e.target.value })} />
                  </div>
                </div>
              )}

              {form.billingModel !== "flat" && (
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor="pb-monthly-min" className="text-xs">Monthly minimum (USD)</Label>
                    <Input id="pb-monthly-min" type="number" min={0} step="0.01" value={form.monthlyMinimumUsd} onChange={(e) => setForm({ ...form, monthlyMinimumUsd: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="pb-setup" className="text-xs">Setup fee (USD, optional)</Label>
                    <Input id="pb-setup" type="number" min={0} step="0.01" placeholder={form.priceMonthlyUsd || "same as monthly price"} value={form.setupFeeUsd} onChange={(e) => setForm({ ...form, setupFeeUsd: e.target.value })} />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>Modules included</Label>
              <p className="text-xs text-muted-foreground">Policies, clients, payments, and reports are always included in every plan.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
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

function FeaturesCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ features: BillingFeatureRow[] }>({ queryKey: ["/api/platform/billing/plans"] });
  const [drafts, setDrafts] = useState<Record<string, Partial<BillingFeatureRow>>>({});

  const saveMutation = useMutation({
    mutationFn: async (f: BillingFeatureRow) => {
      const d = drafts[f.id] ?? {};
      await apiRequest("PATCH", `/api/platform/billing/features/${f.id}`, {
        baseFeeDeltaUsd: d.baseFeeDeltaUsd ?? f.baseFeeDeltaUsd,
        perPolicyRateDeltaUsd: d.perPolicyRateDeltaUsd ?? f.perPolicyRateDeltaUsd,
        revenueSharePercentDelta: d.revenueSharePercentDelta ?? f.revenueSharePercentDelta,
        isActive: d.isActive ?? f.isActive,
      });
    },
    onSuccess: (_r, f) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/billing/plans"] });
      setDrafts((prev) => { const n = { ...prev }; delete n[f.id]; return n; });
      toast({ title: "Feature pricing saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const features = data?.features ?? [];
  const setDraft = (id: string, patch: Partial<BillingFeatureRow>) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const val = (f: BillingFeatureRow, k: keyof BillingFeatureRow) => (drafts[f.id]?.[k] ?? f[k]) as any;

  return (
    <CardSection
      title="Add-on feature pricing"
      description="What each module adds to a tenant's bill when it's switched on — stacked on top of the plan. Revenue-share tenants only pay for the features they actually use."
      icon={CreditCard}
    >
      {isLoading ? (
        <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Feature</TableHead>
                <TableHead>+ Base fee (USD/mo)</TableHead>
                <TableHead>+ Per policy (USD/mo)</TableHead>
                <TableHead>+ Revenue share (%)</TableHead>
                <TableHead>On</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {features.map((f) => {
                const dirty = !!drafts[f.id];
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="font-medium">{f.name}</div>
                      <div className="text-xs text-muted-foreground font-mono">{f.key}</div>
                    </TableCell>
                    <TableCell>
                      <Input className="w-28" type="number" min={0} step="0.01" value={val(f, "baseFeeDeltaUsd")} onChange={(e) => setDraft(f.id, { baseFeeDeltaUsd: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-28" type="number" min={0} step="0.01" value={val(f, "perPolicyRateDeltaUsd")} onChange={(e) => setDraft(f.id, { perPolicyRateDeltaUsd: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Input className="w-24" type="number" min={0} max={100} step="0.01" value={val(f, "revenueSharePercentDelta")} onChange={(e) => setDraft(f.id, { revenueSharePercentDelta: e.target.value })} />
                    </TableCell>
                    <TableCell>
                      <Switch checked={val(f, "isActive")} onCheckedChange={(v) => setDraft(f.id, { isActive: v === true })} />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant={dirty ? "default" : "ghost"} disabled={!dirty || saveMutation.isPending} onClick={() => saveMutation.mutate(f)}>
                        {saveMutation.isPending && saveMutation.variables?.id === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </CardSection>
  );
}
