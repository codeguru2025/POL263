import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard, EmptyState } from "@/components/ds";
import { ErrorBoundary } from "@/components/error-boundary";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { PeriodSelector, periodForPreset, type Period } from "@/components/period-selector";
import {
  Users,
  Building2,
  FileStack,
  FileText,
  Box,
  TrendingUp,
  DollarSign,
  Target,
  Loader2,
  Heart,
  AlertTriangle,
  Filter,
  Plus,
  BarChart3,
  MessageSquare,
  HelpCircle,
  LayoutDashboard,
  Banknote,
  TriangleAlert,
  ArrowUpRight,
  ShieldCheck,
  Database,
  RefreshCw,
  Globe,
  Clock,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo, lazy, Suspense } from "react";

// Split into their own lazy chunks so recharts (~400KB) doesn't block the initial render of
// this page — it's the staff landing page, loaded on nearly every login.
const RevenueAndPolicyCharts = lazy(() => import("./dashboard-revenue-chart"));
const LeadFunnelChart = lazy(() => import("./dashboard-lead-funnel-chart"));
const ChartSkeleton = () => <div className="h-[280px] animate-pulse rounded-lg bg-muted/50" />;
import { isAgentScoped } from "@shared/roles";
import { useFlag } from "@/lib/flags";
import { useTenantCapabilities, hasCapabilityModule } from "@/hooks/use-tenant-capabilities";
import { CommandCenter } from "@/components/command-center";

interface DashboardStats {
  totalPolicies: number;
  activePolicies: number;
  totalClients: number;
  totalClaims: number;
  openClaims: number;
  totalFuneralCases: number;
  totalLeads: number;
  totalTransactions: number;
}

interface CoveredLives {
  coveredLives: number;
  activePolicyCount: number;
}

interface LapseRetention {
  total: number;
  active: number;
  lapsed: number;
  grace: number;
  cancelled: number;
  retentionRate: string;
  lapseRate: string;
}

interface ControlPlaneTenantMetrics {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  logoUrl?: string | null;
  domainCommissioned: boolean;
  domainCommissionedAt: string | null;
  domainCommissionError: string | null;
  dbMigrationState: string | null;
  hasDedicatedDb: boolean;
  usersCount: number;
  policiesCount: number;
  activePoliciesCount: number;
  clientsCount: number;
  claimsCount: number;
  leadsCount: number;
  branchesCount: number;
  loadError: string | null;
}

interface ControlPlaneDashboard {
  summary: {
    tenants: number;
    users: number;
    policies: number;
    activePolicies: number;
    clients: number;
    claims: number;
    leads: number;
    branches: number;
  };
  tenants: ControlPlaneTenantMetrics[];
}

// ─── Executive Finance Summary ────────────────────────────────────────────
function ExecutiveSummarySection({ execSummary, execLoading, branchesList, period, onPeriodChange }: {
  execSummary: any; execLoading: boolean; branchesList: any[];
  period: Period; onPeriodChange: (p: Period) => void;
}) {
  if (execLoading) {
    return (
      <CardSection title="Executive finance summary" icon={BarChart3} headerRight={<PeriodSelector value={period} onChange={onPeriodChange} />}>
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
      </CardSection>
    );
  }
  if (!execSummary) return (
    <CardSection title="Executive finance summary" icon={BarChart3} headerRight={<PeriodSelector value={period} onChange={onPeriodChange} />}>
      <p className="text-sm text-muted-foreground text-center py-8">No data for this period.</p>
    </CardSection>
  );

  const ex = execSummary;
  const cu = ex.consolidatedUsd || {};
  const fmt = (n: number) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtCur = (map: Record<string, number>) =>
    Object.entries(map || {}).map(([c, v]) => `${c} ${fmt(v)}`).join("  ") || "—";

  // Aggregate branch breakdown by branchId
  const branchMap: Record<string, { name: string; income: Record<string, number>; policyCount: number }> = {};
  for (const r of ex.branchBreakdown || []) {
    if (!branchMap[r.branchId || "none"]) {
      branchMap[r.branchId || "none"] = { name: r.branchName, income: {}, policyCount: 0 };
    }
    branchMap[r.branchId || "none"].income[r.currency] = (branchMap[r.branchId || "none"].income[r.currency] || 0) + r.income;
    branchMap[r.branchId || "none"].policyCount += r.policyCount;
  }

  // Claim stats summary
  const claimsByStatus: Record<string, { count: number; value: number; currency: string }> = {};
  for (const r of ex.claimStats || []) {
    claimsByStatus[r.status] = (claimsByStatus[r.status] || { count: 0, value: 0, currency: r.currency });
    claimsByStatus[r.status].count += r.count;
    claimsByStatus[r.status].value += r.totalValue;
  }

  const daysSince = (d: string | null) => d ? Math.floor((Date.now() - new Date(d).getTime()) / 86400000) : null;

  return (
    <div className="space-y-6">
      {/* ── Financial KPIs ── */}
      <CardSection
        title={`Executive summary — ${ex.period?.from} to ${ex.period?.to}`}
        description="Cash-basis P&L for the selected period, derived from issued receipts and paid disbursements."
        icon={BarChart3}
        headerRight={<PeriodSelector value={period} onChange={onPeriodChange} />}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><ArrowUpRight className="h-3 w-3 text-emerald-500" />Total income (USD)</p>
            <p className="text-xl font-bold tabular-nums text-emerald-600">{fmt(cu.income || 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{fmtCur(ex.income?.total)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Total expenses (USD)</p>
            <p className="text-xl font-bold tabular-nums text-destructive">{fmt(cu.expenses || 0)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{fmtCur(ex.expenses?.total)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Net surplus (USD)</p>
            <p className={`text-xl font-bold tabular-nums ${(cu.net || 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(cu.net || 0)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Banknote className="h-3 w-3 text-amber-500" />Unbanked cash</p>
            <p className="text-xl font-bold tabular-nums text-amber-600">{fmtCur(ex.cashPosition?.totalOnHand)}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">Banked: {fmtCur(ex.cashPosition?.totalDeposited)}</p>
          </div>
        </div>

        {/* Additional KPI row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 pb-4">
          <div className="rounded-md bg-muted/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">New policies</p>
            <p className="text-2xl font-bold tabular-nums">{ex.newPoliciesCount || 0}</p>
          </div>
          <div className="rounded-md bg-muted/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">Claims submitted</p>
            <p className="text-2xl font-bold tabular-nums">{Object.values(claimsByStatus).reduce((s: number, v: any) => s + v.count, 0)}</p>
          </div>
          <div className="rounded-md bg-muted/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">Claims approved</p>
            <p className="text-2xl font-bold tabular-nums text-amber-600">{claimsByStatus["approved"]?.count || 0}</p>
          </div>
          <div className="rounded-md bg-muted/30 p-3 text-center">
            <p className="text-xs text-muted-foreground">Income — individual premiums</p>
            <p className="text-lg font-bold tabular-nums">{fmtCur(ex.income?.premiumIndividual)}</p>
          </div>
        </div>
      </CardSection>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Branch breakdown ── */}
        <CardSection title="Income by branch" icon={Building2}>
          {Object.keys(branchMap).length === 0 ? (
            <p className="text-sm text-muted-foreground p-4">No branch data for this period.</p>
          ) : (
            <div className="divide-y">
              {Object.entries(branchMap)
                .sort(([, a], [, b]) => Object.values(b.income).reduce((s, v) => s + v, 0) - Object.values(a.income).reduce((s, v) => s + v, 0))
                .map(([id, br]) => (
                  <div key={id} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="font-medium text-sm">{br.name}</p>
                      <p className="text-[11px] text-muted-foreground">{br.policyCount} policies receipted</p>
                    </div>
                    <p className="font-semibold tabular-nums text-sm text-emerald-700">{fmtCur(br.income)}</p>
                  </div>
                ))}
            </div>
          )}
        </CardSection>

        {/* ── Admin cash accountability ── */}
        <CardSection title="Admin cash positions" icon={Banknote} description="Unbanked cash each admin currently holds.">
          {!ex.cashPosition?.admins?.length ? (
            <p className="text-sm text-muted-foreground p-4">No cash activity yet.</p>
          ) : (
            <div className="divide-y">
              {ex.cashPosition.admins
                .filter((a: any) => a.totalCollected > 0 || a.totalDeposited > 0)
                .sort((a: any, b: any) => b.onHand - a.onHand)
                .map((a: any) => {
                  const days = daysSince(a.lastDepositDate);
                  const stale = a.onHand > 0 && (days === null || days > 2);
                  return (
                    // Keyed by userId+currency, not userId alone: the backend returns one row
                    // per admin *per currency* they've handled cash in (server/storage.ts
                    // getAdminCashPosition groups by user+currency) — an admin with both USD
                    // and ZAR cash produces two rows here, which collided on a userId-only key.
                    <div key={`${a.userId}-${a.currency}`} className={`flex items-center justify-between px-4 py-2.5 ${stale ? "bg-amber-50/60 dark:bg-amber-900/10" : ""}`}>
                      <div>
                        <p className="font-medium text-sm">{a.displayName}</p>
                        <p className="text-[11px] text-muted-foreground">Collected: {a.currency} {fmt(a.totalCollected)} · Banked: {a.currency} {fmt(a.totalDeposited)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`font-semibold tabular-nums text-sm ${a.onHand > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                          {a.currency} {fmt(a.onHand)}
                        </p>
                        {stale && <p className="text-[10px] text-amber-600 flex items-center gap-0.5 justify-end"><TriangleAlert className="h-3 w-3" />{days === null ? "Never banked" : `${days}d`}</p>}
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </CardSection>

        {/* ── Cross-border breakdown (tenant-configurable — hidden unless enabled) ── */}
        {ex.countryFlag && (
          <CardSection
            title={`${ex.countryFlag.flagLabel} vs ${ex.countryFlag.homeLabel}`}
            icon={Globe}
            description="Revenue, services, and cost spend split by the country flag."
            className="lg:col-span-2"
          >
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {[true, false].map((flagged) => {
                  const rows = (ex.countryFlag.revenueByCountry || []).filter((r: any) => r.flagged === flagged);
                  const label = flagged ? ex.countryFlag.flagLabel : ex.countryFlag.homeLabel;
                  const incomeMap: Record<string, number> = {};
                  let policyCount = 0;
                  for (const r of rows) {
                    incomeMap[r.currency] = (incomeMap[r.currency] || 0) + r.income;
                    policyCount += r.policyCount;
                  }
                  return (
                    <div key={String(flagged)} className="rounded-md border p-3">
                      <p className="text-xs text-muted-foreground">{label} revenue</p>
                      <p className="font-semibold tabular-nums text-sm text-emerald-700">{fmtCur(incomeMap)}</p>
                      <p className="text-[11px] text-muted-foreground">{policyCount} policies receipted</p>
                    </div>
                  );
                })}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-md bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ex.countryFlag.flagLabel} services done</p>
                  <p className="text-2xl font-bold tabular-nums">{ex.countryFlag.serviceCount}</p>
                </div>
                <div className="rounded-md bg-muted/30 p-3 text-center">
                  <p className="text-xs text-muted-foreground">{ex.countryFlag.flagLabel} cost spend</p>
                  <p className="text-lg font-bold tabular-nums text-destructive">
                    {fmtCur(Object.fromEntries((ex.countryFlag.costByCurrency || []).map((c: any) => [c.currency, c.cost])))}
                  </p>
                </div>
              </div>
            </div>
          </CardSection>
        )}
      </div>
    </div>
  );
}

// ─── Backup Sync Health (platform owner) ──────────────────────────────────
function BackupHealthSection() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery<{ runs: any[] }>({ queryKey: ["/api/platform/backup-status"] });
  const triggerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/platform/backup-sync", {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Backup sync triggered", description: "Check back in a minute for the new run to appear." });
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ["/api/platform/backup-status"] }), 5000);
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const runs = data?.runs ?? [];

  const statusBadge = (status: string) => {
    if (status === "success") return <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30">Success</Badge>;
    if (status === "partial") return <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/30">Partial</Badge>;
    if (status === "failed") return <Badge variant="destructive">Failed</Badge>;
    return <Badge variant="secondary">Running</Badge>;
  };

  return (
    <CardSection
      title="Backup sync health"
      description="Nightly mirror of every tenant database into the Supabase backup — recent run history."
      icon={Database}
      headerRight={(
        <Button size="sm" variant="outline" onClick={() => triggerMutation.mutate()} disabled={triggerMutation.isPending}>
          {triggerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : <RefreshCw className="h-4 w-4 mr-1.5" />}
          Run Backup Now
        </Button>
      )}
    >
      {isLoading ? (
        <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : runs.length === 0 ? (
        <EmptyState title="No backup runs yet" description="Runs appear here after the nightly scheduler fires, or after triggering one manually." className="border-0 rounded-none bg-transparent py-10" />
      ) : (
        <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Rows</TableHead>
              <TableHead className="text-right">Tables</TableHead>
              <TableHead>Triggered by</TableHead>
              <TableHead>Errors</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r: any) => {
              const durationSec = r.completedAt
                ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)
                : null;
              return (
                <TableRow key={r.id}>
                  <TableCell className="text-sm">{new Date(r.startedAt).toLocaleString()}</TableCell>
                  <TableCell className="text-sm tabular-nums">{durationSec !== null ? `${durationSec}s` : "—"}</TableCell>
                  <TableCell>{statusBadge(r.status)}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.totalRows ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.tableCount ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground capitalize">{r.triggeredBy || "—"}</TableCell>
                  <TableCell
                    className="text-xs text-destructive max-w-xs truncate"
                    title={Array.isArray(r.errors) ? r.errors.join("; ") : ""}
                  >
                    {r.errorCount && parseInt(r.errorCount) > 0 ? `${r.errorCount} error(s)` : "—"}
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

// ─── Pending Domain Commissioning (platform owner) ─────────────────────────
function PendingDomainCommissioningSection({ tenants }: { tenants: ControlPlaneTenantMetrics[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [confirmTarget, setConfirmTarget] = useState<ControlPlaneTenantMetrics | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const commissionMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", `/api/platform/tenants/${tenantId}/commission-domain`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Domain commissioned", description: "DNS record created/verified and added to DigitalOcean's Domains list." });
      setConfirmTarget(null);
      queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
    },
    onError: (err: Error) => {
      toast({ title: "Commissioning failed", description: err.message, variant: "destructive" });
      // The failure reason is persisted server-side (tenants.domainCommissionError) even on
      // failure — refresh so it shows under the tenant instead of only flashing in the toast.
      queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
    },
  });

  if (tenants.length === 0) return null;

  const subdomainFor = (t: ControlPlaneTenantMetrics) => `${t.slug}.${window.location.hostname}`;

  function copySubdomain(t: ControlPlaneTenantMetrics) {
    navigator.clipboard.writeText(subdomainFor(t));
    setCopiedId(t.id);
    setTimeout(() => setCopiedId((cur) => (cur === t.id ? null : cur)), 2000);
  }

  return (
    <>
      <CardSection
        title="Pending domain commissioning"
        description="New tenants whose subdomain still needs to be added to DigitalOcean's Domains list before it resolves."
        icon={Clock}
      >
        <div className="space-y-3">
          {tenants.map((t) => (
            <div key={t.id} className="border border-amber-300 bg-amber-50 dark:bg-amber-900/10 rounded-lg p-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium truncate">{t.name}</p>
                <div className="flex items-center gap-1 mt-1.5">
                  <span className="text-xs font-mono bg-white dark:bg-background border rounded px-2 py-0.5 truncate" data-testid={`text-pending-subdomain-${t.id}`}>
                    {subdomainFor(t)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 shrink-0"
                    onClick={() => copySubdomain(t)}
                    aria-label={copiedId === t.id ? "Copied to clipboard" : "Copy subdomain"}
                    data-testid={`button-copy-pending-subdomain-${t.id}`}
                  >
                    {copiedId === t.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {t.domainCommissionError ? (
                  <p className="text-xs text-destructive mt-1.5" data-testid={`text-commission-error-${t.id}`}>
                    Last attempt failed: {t.domainCommissionError}
                  </p>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => setConfirmTarget(t)}
                data-testid={`button-commission-domain-${t.id}`}
              >
                {t.domainCommissionError ? "Retry commissioning" : "Commission domain"}
              </Button>
            </div>
          ))}
        </div>
      </CardSection>

      <AlertDialog open={!!confirmTarget} onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Commission this tenant's domain?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create/verify the DNS record for <span className="font-mono">{confirmTarget ? subdomainFor(confirmTarget) : ""}</span> and
              add it to DigitalOcean App Platform's Domains list. DigitalOcean still needs a few minutes afterward to
              issue a certificate and route traffic — this confirms the setup step succeeded, not that the site is
              live yet.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmTarget && commissionMutation.mutate(confirmTarget.id)}
              disabled={commissionMutation.isPending}
            >
              {commissionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Commission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Pending Database Provisioning (platform owner) ────────────────────────
function PendingDatabaseProvisioningSection({ tenants }: { tenants: ControlPlaneTenantMetrics[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const provisionMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", `/api/platform/tenants/${tenantId}/commission-database`, {});
      const j = await res.json();
      if (!res.ok || j?.ok === false) throw new Error(j.reason || j.message || "Failed to provision dedicated database");
      return j;
    },
    onSuccess: () => {
      toast({ title: "Database provisioning", description: "Started — this tenant's dashboard entry will update once it completes." });
      queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  if (tenants.length === 0) return null;

  return (
    <CardSection
      title="Pending dedicated database provisioning"
      description="Tenants whose subscription is active but haven't been moved onto a dedicated database yet."
      icon={Database}
    >
      <div className="space-y-3">
        {tenants.map((t) => {
          const isFailed = t.dbMigrationState === "failed";
          const isRunning = t.dbMigrationState === "running";
          return (
            <div
              key={t.id}
              className={`border rounded-lg p-4 flex items-center justify-between gap-4 ${
                isFailed ? "border-destructive/40 bg-destructive/5" : "border-amber-300 bg-amber-50 dark:bg-amber-900/10"
              }`}
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{t.name}</p>
                <p className="text-xs text-muted-foreground mt-1 capitalize">
                  {isRunning ? "Provisioning in progress…" : isFailed ? "Provisioning failed" : "Not yet provisioned"}
                </p>
              </div>
              <Button
                size="sm"
                variant={isFailed ? "destructive" : "outline"}
                className="shrink-0"
                onClick={() => provisionMutation.mutate(t.id)}
                disabled={provisionMutation.isPending || isRunning}
                data-testid={`button-commission-database-${t.id}`}
              >
                {provisionMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                {isFailed ? "Retry" : "Provision now"}
              </Button>
            </div>
          );
        })}
      </div>
    </CardSection>
  );
}

const FUNNEL_COLORS = ["#6366f1", "#8b5cf6", "#a78bfa", "#c4b5fd", "#ddd6fe", "#ede9fe"];
const STATUS_COLORS: Record<string, string> = {
  inactive: "#3b82f6",
  active: "#10b981",
  grace: "#f97316",
  lapsed: "#ef4444",
  cancelled: "#94a3b8",
};

export default function StaffDashboard() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { user, roles, permissions, isPlatformOwner } = useAuth();
  const { toast } = useToast();
  const effectiveOrgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const isControlPlaneMode = isPlatformOwner && !effectiveOrgId;
  const isAgent = isAgentScoped(roles);
  const commandCenters = useFlag("commandCenters");
  const canReadFinance = permissions.includes("read:finance");
  const canReadClaims = permissions.includes("read:claim");
  const canReadFuneralOps = permissions.includes("read:funeral_ops");
  const canReadLead = permissions.includes("read:lead");
  const { data: tenantCapabilities } = useTenantCapabilities(!isControlPlaneMode);
  const hasClaimsCapability = hasCapabilityModule(tenantCapabilities, "claims");
  const hasFuneralOpsCapability = hasCapabilityModule(tenantCapabilities, "funeral_ops");

  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [branchFilter, setBranchFilter] = useState("all");
  // Revenue/activity figures (executive summary, revenue trend) default to "today" and are
  // period-selectable independently of the portfolio filters above, which stay unfiltered
  // (current-state) by default — see period-selector.tsx.
  const [execPeriod, setExecPeriod] = useState<Period>(() => periodForPreset("today"));
  const { data: controlPlaneData, isLoading: cpLoading } = useQuery<ControlPlaneDashboard>({
    queryKey: ["/api/platform/dashboard"],
    enabled: isControlPlaneMode,
  });

  const switchTenantMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", "/api/platform/switch-tenant", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      window.location.href = "/staff";
    },
    onError: (err: any) => {
      toast({ title: "Switch failed", description: err.message || "Could not switch tenant", variant: "destructive" });
    },
  });

  const [tenantAddOpen, setTenantAddOpen] = useState(false);
  const [newTenant, setNewTenant] = useState({
    name: "", adminEmail: "", adminPassword: "", adminDisplayName: "",
    phone: "", email: "", isWhitelabeled: false, databaseUrl: "",
  });
  const createTenantMutation = useMutation({
    mutationFn: async (data: typeof newTenant) => {
      const res = await apiRequest("POST", "/api/organizations", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
      setTenantAddOpen(false);
      setNewTenant({ name: "", adminEmail: "", adminPassword: "", adminDisplayName: "", phone: "", email: "", isWhitelabeled: false, databaseUrl: "" });
      toast({ title: "Tenant created", description: `${data?.name ?? "New tenant"} is ready.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create tenant", variant: "destructive" });
    },
  });
  const handleCreateTenant = () => {
    if (!newTenant.name.trim()) return;
    if (newTenant.adminPassword && newTenant.adminPassword.length < 8) {
      toast({ title: "Validation error", description: "Admin password must be at least 8 characters", variant: "destructive" });
      return;
    }
    createTenantMutation.mutate(newTenant);
  };

  const filterParams = useMemo(() => {
    const p = new URLSearchParams();
    if (dateFrom) p.set("dateFrom", dateFrom);
    if (dateTo) p.set("dateTo", dateTo);
    if (statusFilter && statusFilter !== "all") p.set("status", statusFilter);
    if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
    return p.toString();
  }, [dateFrom, dateTo, statusFilter, branchFilter]);

  const filterKey = { dateFrom, dateTo, statusFilter, branchFilter };

  const base = getApiBase();
  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats", filterKey],
    queryFn: async () => {
      const url = base + "/api/dashboard/stats" + (filterParams ? `?${filterParams}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load stats");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const { data: coveredLives } = useQuery<CoveredLives>({
    queryKey: ["/api/dashboard/covered-lives"],
    enabled: !isControlPlaneMode,
  });

  const { data: revenueTrend } = useQuery<{ date: string; total: number }[]>({
    queryKey: ["/api/dashboard/revenue-trend", execPeriod.from, execPeriod.to],
    queryFn: async () => {
      const p = new URLSearchParams();
      p.set("dateFrom", execPeriod.from);
      p.set("dateTo", execPeriod.to);
      const url = base + "/api/dashboard/revenue-trend" + `?${p}`;
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to load revenue trend");
      return res.json();
    },
    enabled: !isControlPlaneMode && canReadFinance,
  });

  const { data: policyBreakdown } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/policy-status-breakdown", filterKey],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
      const url = base + "/api/dashboard/policy-status-breakdown" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return {};
      if (!res.ok) throw new Error("Failed to load breakdown");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const { data: leadFunnel } = useQuery<Record<string, number>>({
    queryKey: ["/api/dashboard/lead-funnel"],
    enabled: !isControlPlaneMode && canReadLead,
  });

  const { data: lapseRetention } = useQuery<LapseRetention>({
    queryKey: ["/api/dashboard/lapse-retention", filterKey],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo) p.set("dateTo", dateTo);
      if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
      const url = base + "/api/dashboard/lapse-retention" + (p.toString() ? `?${p}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load lapse retention");
      return res.json();
    },
    enabled: !isControlPlaneMode,
  });

  const canApproveFinance = permissions.includes("approve:finance");
  const execParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set("fromDate", execPeriod.from);
    p.set("toDate", execPeriod.to);
    if (branchFilter && branchFilter !== "all") p.set("branchId", branchFilter);
    return `?${p}`;
  }, [execPeriod, branchFilter]);

  const { data: execSummary, isLoading: execLoading } = useQuery<any>({
    queryKey: ["/api/dashboard/executive-summary", execPeriod.from, execPeriod.to, branchFilter],
    queryFn: async () => {
      const res = await fetch(base + "/api/dashboard/executive-summary" + execParams, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !isControlPlaneMode && canReadFinance,
  });

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
    enabled: !isControlPlaneMode,
  });

  const { data: branchesList } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    enabled: !isControlPlaneMode && !isAgent,
  });

  const currentOrg = isPlatformOwner && effectiveOrgId
    ? (Array.isArray(orgs) ? orgs.find((o: any) => o.id === effectiveOrgId) ?? orgs[0] : undefined)
    : orgs?.[0];
  const filteredRevenueTrend = revenueTrend || [];

  const policyStatusData = useMemo(() => {
    if (!policyBreakdown) return [];
    return Object.entries(policyBreakdown)
      .filter(([status]) => statusFilter === "all" || status === statusFilter)
      .map(([status, count]) => ({
        name: status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, " "),
        value: count,
        color: STATUS_COLORS[status] || "#6b7280",
      }));
  }, [policyBreakdown, statusFilter]);

  const leadFunnelData = useMemo(() => {
    if (!leadFunnel) return [];
    const order = ["lead", "captured", "contacted", "quote_generated", "application_started", "submitted", "approved", "agreed_to_pay", "activated", "lost"];
    return order
      .filter((stage) => leadFunnel[stage] !== undefined)
      .map((stage, i) => ({
        name: stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        value: leadFunnel[stage],
        fill: FUNNEL_COLORS[i % FUNNEL_COLORS.length],
      }));
  }, [leadFunnel]);

  const allStatCards = [
    {
      title: "Total Policies",
      value: stats?.totalPolicies ?? 0,
      subtitle: `${stats?.activePolicies ?? 0} active`,
      icon: FileStack,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      show: true,
    },
    {
      title: "Covered Lives",
      value: coveredLives?.coveredLives ?? 0,
      subtitle: `${coveredLives?.activePolicyCount ?? 0} active policies`,
      icon: Heart,
      color: "text-rose-600",
      bgColor: "bg-rose-50",
      show: true,
    },
    {
      title: isAgent ? "My Clients" : "Leads & Clients",
      value: stats?.totalClients ?? 0,
      subtitle: `${stats?.totalPolicies ? Math.min(stats.totalPolicies, stats.totalClients) : 0} converted`,
      icon: Users,
      color: "text-emerald-600",
      bgColor: "bg-emerald-50",
      show: true,
    },
    {
      title: "Claims",
      value: stats?.totalClaims ?? 0,
      subtitle: `${stats?.openClaims ?? 0} open`,
      icon: FileText,
      color: "text-amber-600",
      bgColor: "bg-amber-50",
      show: canReadClaims && hasClaimsCapability,
    },
    {
      title: "Funeral Cases",
      value: stats?.totalFuneralCases ?? 0,
      subtitle: "Active cases",
      icon: Box,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      show: canReadFuneralOps && hasFuneralOpsCapability,
    },
    {
      title: "Lead Conversion",
      value: stats?.totalClients
        ? `${((Math.min(stats.totalPolicies ?? 0, stats.totalClients) / stats.totalClients) * 100).toFixed(0)}%`
        : "0%",
      subtitle: `${stats?.totalLeads ?? 0} pipeline leads`,
      icon: Target,
      color: "text-pink-600",
      bgColor: "bg-pink-50",
      show: canReadLead,
    },
    {
      title: "Transactions",
      value: stats?.totalTransactions ?? 0,
      subtitle: "Payment records",
      icon: DollarSign,
      color: "text-teal-600",
      bgColor: "bg-teal-50",
      show: canReadFinance,
    },
    {
      title: "Retention Rate",
      value: `${lapseRetention?.retentionRate ?? 0}%`,
      subtitle: `${lapseRetention?.lapseRate ?? 0}% lapse rate`,
      icon: TrendingUp,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      show: true,
    },
  ];

  const statCards = allStatCards.filter((c) => c.show);

  if (isControlPlaneMode) {
    const summary = controlPlaneData?.summary;
    const tenants = controlPlaneData?.tenants ?? [];
    const pendingCommission = tenants.filter((t) => !t.domainCommissioned);
    const pendingDbProvisioning = tenants.filter((t) => !t.hasDedicatedDb && (t.dbMigrationState === "pending" || t.dbMigrationState === "failed" || t.dbMigrationState === "running"));
    return (
      <StaffLayout>
        <PageShell>
          <PageHeader
            title="Control Plane Dashboard"
            description="Platform-wide overview across all active tenants."
            titleDataTestId="text-dashboard-title"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiStatCard label="Tenants" value={summary?.tenants ?? 0} icon={Building2} />
            <KpiStatCard label="Users" value={summary?.users ?? 0} icon={Users} />
            <KpiStatCard
              label="Policies"
              value={summary?.policies ?? 0}
              hint={<span className="tabular-nums">{summary?.activePolicies ?? 0} active</span>}
              icon={FileStack}
            />
            <KpiStatCard label="Clients" value={summary?.clients ?? 0} icon={Heart} />
          </div>

          <CardSection
            title="Tenants"
            description="Switch into a tenant workspace, or configure branding, payments, and routing from here."
            icon={Building2}
            headerRight={
              <Button size="sm" onClick={() => setTenantAddOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                New Tenant
              </Button>
            }
          >
              {cpLoading ? (
                <div className="py-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
              ) : tenants.length === 0 ? (
                <EmptyState
                  title="No tenants yet"
                  description="Create your first tenant to get started."
                  action={(
                    <Button size="sm" onClick={() => setTenantAddOpen(true)}>
                      <Plus className="h-4 w-4 mr-2" />
                      Create first tenant
                    </Button>
                  )}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <div className="space-y-3">
                  {tenants.map((t) => (
                    <div key={t.id} className="border rounded-lg p-4 flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="font-medium truncate">{t.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline">{t.slug}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {t.usersCount} users • {t.policiesCount} policies • {t.clientsCount} clients
                          </span>
                        </div>
                        {t.loadError && <p className="text-xs text-destructive mt-1">Metrics unavailable: {t.loadError}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button size="sm" variant="outline" onClick={() => setLocation(`/staff/platform/tenants/${t.id}`)}>
                          Configure
                        </Button>
                        <button
                          className="inline-flex items-center justify-center h-9 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
                          onClick={() => switchTenantMutation.mutate(t.id)}
                          disabled={switchTenantMutation.isPending}
                        >
                          Enter Tenant
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
          </CardSection>

          <PendingDomainCommissioningSection tenants={pendingCommission} />

          <PendingDatabaseProvisioningSection tenants={pendingDbProvisioning} />

          <BackupHealthSection />

          <Dialog open={tenantAddOpen} onOpenChange={setTenantAddOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Create new tenant</DialogTitle>
                <DialogDescription>Create a new tenant. You can optionally set up an admin account now, or add one later. Branding, payments, and routing are configured afterwards via Configure.</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="tenant-org-name">Tenant name *</Label>
                  <Input
                    id="tenant-org-name"
                    value={newTenant.name}
                    onChange={(e) => setNewTenant((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. Acme Insurance"
                    data-testid="input-tenant-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-org-email">Tenant email</Label>
                  <Input
                    id="tenant-org-email"
                    type="email"
                    value={newTenant.email}
                    onChange={(e) => setNewTenant((p) => ({ ...p, email: e.target.value }))}
                    placeholder="info@acme.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tenant-org-phone">Tenant phone</Label>
                  <Input
                    id="tenant-org-phone"
                    value={newTenant.phone}
                    onChange={(e) => setNewTenant((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+1 555 0100"
                  />
                </div>
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="new-tenant-whitelabel" className="font-medium">White-Label Mode</Label>
                    <p className="text-xs text-muted-foreground">
                      When enabled, the app will show this tenant&apos;s name and logo instead of POL263.
                    </p>
                  </div>
                  <Switch
                    id="new-tenant-whitelabel"
                    checked={newTenant.isWhitelabeled}
                    onCheckedChange={(v) => setNewTenant((p) => ({ ...p, isWhitelabeled: v === true }))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-tenant-databaseUrl">Dedicated Database URL (optional)</Label>
                  <Input
                    id="new-tenant-databaseUrl"
                    type="password"
                    autoComplete="off"
                    value={newTenant.databaseUrl}
                    onChange={(e) => setNewTenant((p) => ({ ...p, databaseUrl: e.target.value }))}
                    placeholder="postgresql://... (leave empty for shared database)"
                  />
                  <p className="text-xs text-muted-foreground">
                    When set, this tenant&apos;s data is stored in a separate database.
                  </p>
                </div>
                <div className="border-t pt-4 space-y-4">
                  <p className="text-sm font-medium flex items-center gap-2">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    Tenant administrator account
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-admin-name">Display name</Label>
                    <Input
                      id="tenant-admin-name"
                      value={newTenant.adminDisplayName}
                      onChange={(e) => setNewTenant((p) => ({ ...p, adminDisplayName: e.target.value }))}
                      placeholder="John Doe"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-admin-email">Email</Label>
                    <Input
                      id="tenant-admin-email"
                      type="email"
                      value={newTenant.adminEmail}
                      onChange={(e) => setNewTenant((p) => ({ ...p, adminEmail: e.target.value }))}
                      placeholder="admin@acme.com"
                      data-testid="input-admin-email"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="tenant-admin-password">Password (min 8 chars)</Label>
                    <Input
                      id="tenant-admin-password"
                      type="password"
                      value={newTenant.adminPassword}
                      onChange={(e) => setNewTenant((p) => ({ ...p, adminPassword: e.target.value }))}
                      placeholder="Minimum 8 characters"
                      data-testid="input-admin-password"
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setTenantAddOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateTenant}
                  disabled={!newTenant.name.trim() || createTenantMutation.isPending}
                  data-testid="btn-confirm-add-tenant"
                >
                  {createTenantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create tenant
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </PageShell>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <ErrorBoundary>
      <PageShell>
        <PageHeader
          title="Dashboard"
          description={`Welcome back, ${user?.displayName || user?.email}. Here is your overview.`}
          titleDataTestId="text-dashboard-title"
        />

        {!isAgent && <AiInsightsPanel surface="dashboard" title="AI Insights" description="Ask AI to summarize the business at a glance and flag anything worth attention." />}

        {commandCenters && <CommandCenter />}

        {!isAgent && !commandCenters && (
        <CardSection title="Quick access" icon={LayoutDashboard}>
            <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
              <Link href="/staff/notifications" className="rounded-lg border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3">
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <MessageSquare className="h-5 w-5" />
                </span>
                <span className="font-medium text-sm">Notifications</span>
              </Link>
              <Link href="/staff/help" className="rounded-lg border bg-card px-4 py-3 shadow-sm hover:shadow-md transition-shadow flex items-center gap-3">
                <span className="rounded-lg bg-primary/10 p-2 text-primary shrink-0">
                  <HelpCircle className="h-5 w-5" />
                </span>
                <span className="font-medium text-sm">Help</span>
              </Link>
              <div className="rounded-lg border bg-card px-4 py-3 flex flex-wrap gap-x-4 gap-y-2 items-center text-sm">
                <Link href="/staff/order-services" className="text-primary hover:underline font-medium">Order services</Link>
                <Link href="/staff/reminders" className="text-primary hover:underline font-medium">Reminders</Link>
                <Link href="/staff/finance" className="text-primary hover:underline font-medium">Finance</Link>
              </div>
            </div>
        </CardSection>
        )}

        {!isAgent && (
        <CardSection title="Filters" icon={Filter}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="date-from">Date From</Label>
                <Input id="date-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  data-testid="filter-date-from"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="date-to">Date To</Label>
                <Input id="date-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  data-testid="filter-date-to"
                  className="h-9"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="status-filter">Policy Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger id="status-filter" className="h-9" data-testid="filter-status">
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="grace">Grace</SelectItem>
                    <SelectItem value="lapsed">Lapsed</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground" htmlFor="branch-filter">Branch</Label>
                <Select value={branchFilter} onValueChange={setBranchFilter}>
                  <SelectTrigger id="branch-filter" className="h-9" data-testid="filter-branch">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Branches</SelectItem>
                    {branchesList?.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
        </CardSection>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {statCards.map((card) => (
            <KpiStatCard
              key={card.title}
              className="shadow-sm hover:shadow-md transition-shadow"
              label={card.title}
              icon={card.icon}
              hint={card.subtitle}
              value={
                statsLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <span className="font-display" data-testid={`stat-${card.title.toLowerCase().replace(/\s+/g, "-")}`}>
                    {card.value}
                  </span>
                )
              }
            />
          ))}
        </div>

        {canReadFinance && (
          <Suspense fallback={
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartSkeleton /><ChartSkeleton />
            </div>
          }>
            <RevenueAndPolicyCharts
              revenueTrend={filteredRevenueTrend}
              execPeriod={execPeriod}
              onExecPeriodChange={setExecPeriod}
              policyStatusData={policyStatusData}
            />
          </Suspense>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {!isAgent && canReadLead && (
          <Suspense fallback={<ChartSkeleton />}>
            <LeadFunnelChart leadFunnelData={leadFunnelData} />
          </Suspense>
          )}

          <CardSection title="Lapse & retention metrics" icon={AlertTriangle} contentClassName="pt-2">
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-emerald-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Retention Rate</p>
                    <p className="text-3xl font-bold text-emerald-600 tabular-nums" data-testid="stat-retention-rate">
                      {lapseRetention?.retentionRate ?? "0"}%
                    </p>
                  </div>
                  <div className="bg-red-50 rounded-lg p-4 text-center">
                    <p className="text-xs text-muted-foreground mb-1">Lapse Rate</p>
                    <p className="text-3xl font-bold text-red-600 tabular-nums" data-testid="stat-lapse-rate">
                      {lapseRetention?.lapseRate ?? "0"}%
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-active-count">{lapseRetention?.active ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Active</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-grace-count">{lapseRetention?.grace ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Grace</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-lapsed-count">{lapseRetention?.lapsed ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Lapsed</p>
                  </div>
                  <div className="bg-muted/50 rounded p-2">
                    <p className="text-lg font-bold tabular-nums" data-testid="stat-cancelled-count">{lapseRetention?.cancelled ?? 0}</p>
                    <p className="text-[10px] text-muted-foreground">Cancelled</p>
                  </div>
                </div>
              </div>
          </CardSection>
        </div>

        {/* ── Executive Finance Dashboard ──────────────────── */}
        {canReadFinance && !isAgent && (
          <ExecutiveSummarySection execSummary={execSummary} execLoading={execLoading} branchesList={branchesList || []} period={execPeriod} onPeriodChange={setExecPeriod} />
        )}

      </PageShell>
      </ErrorBoundary>
    </StaffLayout>
  );
}
