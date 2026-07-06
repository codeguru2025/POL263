import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch, useLocation, Link } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge, FilterBar } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatReceiptNumber } from "@/lib/assetUrl";
import {
  buildStaffReportHref,
  parseReportSearchParams,
  reportContextLabel,
  SECTION_META,
  tabUsesDataset,
  tabsForSection,
  visibleReportSections,
  type ReportDatasetId,
  type ReportSectionId,
} from "@/lib/staff-reports-nav";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, FileText, Loader2, Download, Truck, DollarSign, Users, Percent, Building, RotateCcw, Calendar, UserCheck, AlertCircle, Clock, CheckCircle, Receipt, Eye, TrendingUp, FolderOpen, UserCircle, Wrench, Filter, Play, Plus, Trash2, Pencil } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

export type ReportFiltersState = {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  branchId?: string;
  productId?: string;
  agentId?: string;
  status?: string;
};

function buildQuery(f: ReportFiltersState) {
  const p = new URLSearchParams();
  if (f.fromDate) p.set("fromDate", f.fromDate);
  if (f.toDate) p.set("toDate", f.toDate);
  if (f.userId) p.set("userId", f.userId);
  if (f.branchId) p.set("branchId", f.branchId);
  if (f.productId) p.set("productId", f.productId);
  if (f.agentId) p.set("agentId", f.agentId);
  if (f.status) p.set("status", f.status);
  const q = p.toString();
  return q ? "?" + q : "";
}

function ExportButton({ reportType, filters }: { reportType: string; filters: ReportFiltersState }) {
  const handleExport = () => {
    const q = buildQuery(filters);
    const url = getApiBase() + `/api/reports/export/${reportType}` + q;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${reportType}-report.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" size="sm" onClick={handleExport} data-testid={`button-export-${reportType}`}>
        <Download className="h-4 w-4 mr-1" />
        Download CSV
      </Button>
    </div>
  );
}

// ─── Balance Sheet Panel ──────────────────────────────────────────────────
function BalanceSheetPanel({ balanceSheet, loading, asOf, onEntryChanged }: { balanceSheet: any; loading: boolean; asOf: string; onEntryChanged: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:finance");

  const [showDialog, setShowDialog] = useState(false);
  const [editEntry, setEditEntry] = useState<any>(null);
  const [form, setForm] = useState({ section: "asset", subsection: "current", label: "", amount: "", currency: "USD", notes: "" });

  function openAdd(section = "asset", subsection = "current") {
    setEditEntry(null);
    setForm({ section, subsection, label: "", amount: "", currency: "USD", notes: "" });
    setShowDialog(true);
  }
  function openEdit(entry: any) {
    setEditEntry(entry);
    setForm({ section: entry.section, subsection: entry.subsection || "current", label: entry.label, amount: String(Object.values(entry.amounts)[0] || ""), currency: Object.keys(entry.amounts)[0] || "USD", notes: entry.notes || "" });
    setShowDialog(true);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const url = editEntry ? `/api/balance-sheet-entries/${editEntry.id}` : "/api/balance-sheet-entries";
      const method = editEntry ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
        body: JSON.stringify({ ...form, asOfDate: asOf }),
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", "balance-sheet"] });
      setShowDialog(false);
      toast({ title: editEntry ? "Entry updated" : "Entry added" });
      onEntryChanged();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/balance-sheet-entries/${id}`, {
        method: "DELETE",
        headers: { "X-CSRF-Token": await getCsrfToken() ?? "" },
        credentials: "include",
      });
      if (!res.ok) throw new Error((await res.json()).message);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reports", "balance-sheet"] });
      toast({ title: "Entry removed" });
      onEntryChanged();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const money = (amounts: Record<string, number>, currencies: string[]) =>
    currencies.map(c => `${c} ${Number(amounts?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join("  ");

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>;
  if (!balanceSheet) return <EmptyState title="No data" description="Select a date to generate the balance sheet." className="py-12" />;

  const bs = balanceSheet;
  const curs: string[] = bs.currencies?.length ? bs.currencies : ["USD"];
  const cu = bs.consolidatedUsd || {};
  const fmt = (n: number) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const isBalanced = Math.abs(cu.totalAssets - cu.totalLiabilities - cu.totalEquity) < 0.02;

  const renderLines = (lines: any[], sectionKey: string, subsectionKey: string) => (
    <>
      {lines.map((l: any, i: number) => (
        <TableRow key={i} className={l.source === "derived" ? "text-muted-foreground" : ""}>
          <TableCell className="pl-6 text-sm">
            {l.label}
            {l.source === "derived" && <span className="ml-1.5 text-[10px] bg-muted rounded px-1">auto</span>}
          </TableCell>
          {curs.map((c: string) => (
            <TableCell key={c} className="text-right tabular-nums text-sm">
              {Number(l.amounts?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </TableCell>
          ))}
          <TableCell className="w-16 text-right">
            {canWrite && l.source === "manual" && (
              <div className="flex gap-1 justify-end">
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => openEdit(l)}><Pencil className="h-3 w-3" /></Button>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" disabled={deleteMutation.isPending} onClick={() => l.id && deleteMutation.mutate(l.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            )}
          </TableCell>
        </TableRow>
      ))}
      {canWrite && (
        <TableRow>
          <TableCell colSpan={curs.length + 2} className="pl-4 py-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => openAdd(sectionKey, subsectionKey)}>
              <Plus className="h-3 w-3 mr-1" /> Add line
            </Button>
          </TableCell>
        </TableRow>
      )}
    </>
  );

  return (
    <CardSection
      title={`Balance Sheet — as at ${new Date(asOf).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}`}
      description="Assets = Liabilities + Equity. Auto lines are derived from live data; manual lines are recorded entries."
      icon={DollarSign}
      flush
    >
      <div className="space-y-4 p-4">
        {/* KPI summary */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Total assets (USD)</p>
            <p className="text-lg font-bold tabular-nums text-emerald-600">{fmt(cu.totalAssets || 0)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Liabilities (USD)</p>
            <p className="text-lg font-bold tabular-nums text-destructive">{fmt(cu.totalLiabilities || 0)}</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Equity (USD)</p>
            <p className={`text-lg font-bold tabular-nums ${cu.totalEquity >= 0 ? "text-emerald-600" : "text-destructive"}`}>{fmt(cu.totalEquity || 0)}</p>
          </div>
        </div>
        {!isBalanced && (
          <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">
            Balance sheet is out of balance by USD {fmt(Math.abs((cu.totalAssets || 0) - (cu.totalLiabilities || 0) - (cu.totalEquity || 0)))}. Add manual equity entries (capital contributions) to balance it.
          </p>
        )}
        {cu.unconvertible?.length > 0 && (
          <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate for {cu.unconvertible.join(", ")} — excluded from USD consolidated total.</p>
        )}

        <div className="overflow-x-auto">
          <DataTable containerClassName="border rounded-md min-w-[540px]">
            <TableHeader className={dataTableStickyHeaderClass}>
              <TableRow>
                <TableHead>Line item</TableHead>
                {curs.map((c: string) => <TableHead key={c} className="text-right">{c}</TableHead>)}
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {/* ASSETS */}
              <TableRow className="bg-muted/40"><TableCell className="font-bold text-sm" colSpan={curs.length + 2}>ASSETS</TableCell></TableRow>
              <TableRow className="bg-muted/20"><TableCell className="font-semibold text-xs uppercase tracking-wide pl-3" colSpan={curs.length + 2}>Current assets</TableCell></TableRow>
              {renderLines(bs.assets?.current || [], "asset", "current")}
              <TableRow className="font-semibold border-t">
                <TableCell className="pl-3 text-sm">Total current assets</TableCell>
                {curs.map((c: string) => {
                  const tot = (bs.assets?.current || []).reduce((s: number, l: any) => s + (l.amounts?.[c] || 0), 0);
                  return <TableCell key={c} className="text-right tabular-nums">{tot.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>;
                })}
                <TableCell />
              </TableRow>
              <TableRow className="bg-muted/20"><TableCell className="font-semibold text-xs uppercase tracking-wide pl-3" colSpan={curs.length + 2}>Non-current assets</TableCell></TableRow>
              {renderLines(bs.assets?.nonCurrent || [], "asset", "non_current")}
              <TableRow className="font-bold border-t-2">
                <TableCell className="pl-3">Total assets</TableCell>
                {curs.map((c: string) => <TableCell key={c} className="text-right tabular-nums">{Number(bs.assets?.total?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>)}
                <TableCell />
              </TableRow>

              {/* LIABILITIES */}
              <TableRow className="bg-muted/40"><TableCell className="font-bold text-sm" colSpan={curs.length + 2}>LIABILITIES</TableCell></TableRow>
              <TableRow className="bg-muted/20"><TableCell className="font-semibold text-xs uppercase tracking-wide pl-3" colSpan={curs.length + 2}>Current liabilities</TableCell></TableRow>
              {renderLines(bs.liabilities?.current || [], "liability", "current")}
              <TableRow className="bg-muted/20"><TableCell className="font-semibold text-xs uppercase tracking-wide pl-3" colSpan={curs.length + 2}>Non-current liabilities</TableCell></TableRow>
              {renderLines(bs.liabilities?.nonCurrent || [], "liability", "non_current")}
              <TableRow className="font-bold border-t-2">
                <TableCell className="pl-3">Total liabilities</TableCell>
                {curs.map((c: string) => <TableCell key={c} className="text-right tabular-nums">{Number(bs.liabilities?.total?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>)}
                <TableCell />
              </TableRow>

              {/* EQUITY */}
              <TableRow className="bg-muted/40"><TableCell className="font-bold text-sm" colSpan={curs.length + 2}>EQUITY</TableCell></TableRow>
              {renderLines(bs.equity?.lines || [], "equity", "")}
              <TableRow className="font-bold border-t-2">
                <TableCell className="pl-3">Total equity</TableCell>
                {curs.map((c: string) => <TableCell key={c} className={`text-right tabular-nums ${Number(bs.equity?.total?.[c] || 0) >= 0 ? "" : "text-destructive"}`}>{Number(bs.equity?.total?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>)}
                <TableCell />
              </TableRow>

              {/* CHECK */}
              <TableRow className="font-bold border-t-2 bg-muted/30">
                <TableCell className="pl-3">Total liabilities + equity</TableCell>
                {curs.map((c: string) => <TableCell key={c} className="text-right tabular-nums">{Number(bs.liabilitiesAndEquity?.[c] || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>)}
                <TableCell />
              </TableRow>
            </TableBody>
          </DataTable>
        </div>
      </div>

      {/* Add / Edit entry dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit entry" : "Add balance sheet entry"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editEntry && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Section</Label>
                  <Select value={form.section} onValueChange={v => setForm(f => ({ ...f, section: v, subsection: v === "equity" ? "" : "current" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asset">Asset</SelectItem>
                      <SelectItem value="liability">Liability</SelectItem>
                      <SelectItem value="equity">Equity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.section !== "equity" && (
                  <div className="space-y-1.5">
                    <Label>Subsection</Label>
                    <Select value={form.subsection} onValueChange={v => setForm(f => ({ ...f, subsection: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="current">Current</SelectItem>
                        <SelectItem value="non_current">Non-current</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Label</Label>
              <Input placeholder="e.g. Motor vehicle, Bank loan, Share capital" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Amount</Label>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
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
              <Textarea rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancel</Button>
            <Button disabled={!form.label || !form.amount || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardSection>
  );
}

export default function StaffReports() {
  const { permissions, isLoading: authLoading } = useAuth();
  const canReadFinance = permissions.includes("read:finance");
  const canReadClaim = permissions.includes("read:claim");
  const canReadFuneralOps = permissions.includes("read:funeral_ops");
  const canReadFleet = permissions.includes("read:fleet");
  const canReadPayroll = permissions.includes("read:payroll");
  const canReadCommission = permissions.includes("read:commission");

  const sectionOpts = useMemo(
    () => ({ canReadCommission, canReadFuneralOps, canReadFleet }),
    [canReadCommission, canReadFuneralOps, canReadFleet],
  );

  const visibleSections = useMemo(
    () =>
      visibleReportSections({
        canReadFinance,
        canReadClaim,
        canReadFuneralOps,
        canReadFleet,
        canReadPayroll,
      }),
    [canReadFinance, canReadClaim, canReadFuneralOps, canReadFleet, canReadPayroll],
  );

  const searchString = useSearch();
  const [, setLocation] = useLocation();

  const { reportSection, activeReport } = useMemo(() => {
    const parsed = parseReportSearchParams(searchString);
    let section: ReportSectionId = parsed.section;
    // While permissions are still loading, visibleSections is a placeholder (empty perms ⇒
    // only "policies"/"agents" look visible) — trust the URL's section as-is rather than
    // falling back, otherwise every fresh/full page load of e.g. ?section=finance briefly
    // (but deterministically, since the effect below fires before permissions resolve)
    // bounces the user to a default section before permissions are known.
    if (!authLoading && !visibleSections.includes(section)) section = visibleSections[0]!;
    const tabs = tabsForSection(section, sectionOpts);
    let tab = parsed.tab;
    if (!tabs.some((x) => x.value === tab)) tab = tabs[0]!.value;
    return { reportSection: section, activeReport: tab };
  }, [searchString, visibleSections, sectionOpts, authLoading]);

  useEffect(() => {
    if (authLoading) return;
    const parsed = parseReportSearchParams(searchString);
    if (parsed.section === reportSection && parsed.tab === activeReport) return;
    setLocation(buildStaffReportHref(reportSection, activeReport));
  }, [searchString, reportSection, activeReport, setLocation, authLoading]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [userId, setUserId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    setRunKey(0);
  }, [reportSection, activeReport]);

  const filters = useMemo<ReportFiltersState>(() => ({
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    userId: userId || undefined,
    branchId: branchId || undefined,
    productId: productId || undefined,
    agentId: agentId || undefined,
    status: statusFilter || undefined,
  }), [fromDate, toDate, userId, branchId, productId, agentId, statusFilter]);
  const q = buildQuery(filters);
  const qAppend = q ? q.replace("?", "&") : "";
  const fk = [fromDate, toDate, userId, branchId, productId, agentId, statusFilter];

  const load = runKey > 0;
  const need = (d: ReportDatasetId) => load && tabUsesDataset(activeReport, d);
  const needFilters = load;

  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["reports", "policies", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/policies?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("policies"),
  });
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({
    queryKey: ["reports", "payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payments?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payments"),
  });
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["reports", "funerals", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/funeral-cases?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("funeralCases"),
  });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({
    queryKey: ["reports", "fleet", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/fleet", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("fleet"),
  });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({
    queryKey: ["reports", "expenditures", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/expenditures?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("expenditures"),
  });
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({
    queryKey: ["reports", "payroll-employees", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payroll/employees", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("payrollEmployees"),
  });
  const { data: commissionPlans = [], isLoading: loadingCommissionPlans } = useQuery<any[]>({
    queryKey: ["reports", "commission-plans", runKey],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/commission-plans", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionPlans") && canReadCommission,
  });
  const { data: commissionSummary = [], isLoading: loadingCommissionSummary } = useQuery<any[]>({
    queryKey: ["reports", "commissions-summary", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commissions-summary" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionSummary") && canReadCommission,
  });
  const { data: commissionPayments = [], isLoading: loadingCommissionPayments } = useQuery<any[]>({
    queryKey: ["reports", "commission-payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/commission-payments?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("commissionPayments") && canReadCommission,
  });
  const { data: platformReceivables = [], isLoading: loadingPlatform } = useQuery<any[]>({
    queryKey: ["reports", "platform", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/platform/receivables?limit=200" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("platformReceivables"),
  });
  const { data: reinstatements = [], isLoading: loadingReinstatements } = useQuery<any[]>({
    queryKey: ["reports", "reinstatements", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/reinstatements" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("reinstatements"),
  });
  const { data: activations = [], isLoading: loadingActivations } = useQuery<any[]>({
    queryKey: ["reports", "activations", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/activations" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("activations"),
  });
  const { data: conversions = [], isLoading: loadingConversions } = useQuery<any[]>({
    queryKey: ["reports", "conversions", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/conversions" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("conversions"),
  });
  const { data: activePolicies = [], isLoading: loadingActivePolicies } = useQuery<any[]>({
    queryKey: ["reports", "active-policies", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/active-policies" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("activePolicies"),
  });
  const { data: awaitingPayments = [], isLoading: loadingAwaitingPayments } = useQuery<any[]>({
    queryKey: ["reports", "awaiting-payments", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/awaiting-payments" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("awaitingPayments"),
  });
  const { data: overduePolicies = [], isLoading: loadingOverdue } = useQuery<any[]>({
    queryKey: ["reports", "overdue", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/overdue" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("overduePolicies"),
  });
  const { data: preLapsePolicies = [], isLoading: loadingPreLapse } = useQuery<any[]>({
    queryKey: ["reports", "pre-lapse", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/pre-lapse" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("preLapsePolicies"),
  });
  const { data: lapsedPolicies = [], isLoading: loadingLapsed } = useQuery<any[]>({
    queryKey: ["reports", "lapsed", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/lapsed" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("lapsedPolicies"),
  });
  const { data: newJoinings = [], isLoading: loadingNewJoinings } = useQuery<any[]>({
    queryKey: ["reports", "new-joinings", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/new-joinings?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("newJoinings"),
  });
  const { data: agentPortfolio = [], isLoading: loadingAgentPortfolio } = useQuery<any[]>({
    queryKey: ["reports", "agent-portfolio", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-portfolio?limit=2000" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("agentPortfolio"),
  });
  const { data: agentProductivity = [], isLoading: loadingAgentProductivity } = useQuery<any[]>({
    queryKey: ["reports", "agent-productivity", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/agent-productivity?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("agentProductivity"),
  });
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-users"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/users", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-branches"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/branches", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["reports", "filter-products"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/products", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const { data: policyDetails = [], isLoading: loadingPolicyDetails } = useQuery<any[]>({
    queryKey: ["reports", "policy-details", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/policy-details?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("policyDetails"),
  });
  const { data: financeReport = [], isLoading: loadingFinance } = useQuery<any[]>({
    queryKey: ["reports", "finance", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/finance?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("financeReport"),
  });
  const { data: incomeStatement, isLoading: loadingIncomeStatement } = useQuery<any>({
    queryKey: ["reports", "income-statement", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/income-statement" + q, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("incomeStatement"),
  });
  const { data: cashFlow, isLoading: loadingCashFlow } = useQuery<any>({
    queryKey: ["reports", "cash-flow", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cash-flow" + q, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("cashFlow"),
  });
  const { data: ledger, isLoading: loadingLedger } = useQuery<any>({
    queryKey: ["reports", "ledger", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/transaction-ledger?limit=1000" + qAppend, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("transactionLedger"),
  });
  const asOfParam = filters.toDate ? `?asOf=${filters.toDate}${filters.branchId ? `&branchId=${filters.branchId}` : ""}` : `?asOf=${new Date().toISOString().slice(0, 10)}${filters.branchId ? `&branchId=${filters.branchId}` : ""}`;
  const { data: balanceSheet, isLoading: loadingBalanceSheet } = useQuery<any>({
    queryKey: ["reports", "balance-sheet", runKey, filters.toDate, filters.branchId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/balance-sheet" + asOfParam, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: need("balanceSheet"),
  });
  const { data: underwriterPayableResult, isLoading: loadingUnderwriterPayable } = useQuery<{ rows: any[]; summary: { totalMonthlyPayable: number; totalPayableIncludingAdvance: number; policyCount: number } }>({
    queryKey: ["reports", "underwriter-payable", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/underwriter-payable?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return { rows: [], summary: { totalMonthlyPayable: 0, totalPayableIncludingAdvance: 0, policyCount: 0 } };
      return res.json();
    },
    enabled: need("underwriterPayable"),
  });
  const { data: cashups = [], isLoading: loadingCashups } = useQuery<any[]>({
    queryKey: ["reports", "cashups", runKey, ...fk, userId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/cashups" + q, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("cashups"),
  });
  const { data: receiptReport = [], isLoading: loadingReceipts } = useQuery<any[]>({
    queryKey: ["reports", "receipts", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/receipts?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("receiptReport"),
  });
  const { data: claimsReport = [], isLoading: loadingClaimsReport } = useQuery<any[]>({
    queryKey: ["reports", "claims-report", runKey, ...fk],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/reports/claims?limit=500" + qAppend, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: need("claimsReport"),
  });

  const policySummary = {
    inactive: policies.filter((p: any) => p.status === "inactive").length,
    active: policies.filter((p: any) => p.status === "active").length,
    grace: policies.filter((p: any) => p.status === "grace").length,
    lapsed: policies.filter((p: any) => p.status === "lapsed").length,
    cancelled: policies.filter((p: any) => p.status === "cancelled").length,
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Reports"
          description={reportContextLabel(reportSection, activeReport)}
          titleDataTestId="text-reports-title"
          actions={
            <Button onClick={() => setRunKey((k) => k + 1)} data-testid="button-run-report" className="gap-2 shadow-sm">
              <Play className="h-4 w-4" /> Run report
            </Button>
          }
        />

        {/* Section navigation */}
        <div className="flex flex-wrap gap-1.5">
          {visibleSections.map((s) => {
            const meta = SECTION_META[s];
            const Icon = meta.icon;
            const isActive = s === reportSection;
            const firstTab = tabsForSection(s, sectionOpts)[0]?.value ?? "";
            return (
              <Link
                key={s}
                href={buildStaffReportHref(s, firstTab)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors border ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent shadow-sm"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {meta.label}
              </Link>
            );
          })}
        </div>

        {/* Filters + tab nav in one card */}
        <CardSection title="" flush>
          <FilterBar className="border-b border-border/60 bg-muted/10 px-4 py-3 sm:px-6">
            <div className="space-y-1.5">
              <Label htmlFor="fromDate" className="text-xs text-muted-foreground">From</Label>
              <Input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-36 h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="toDate" className="text-xs text-muted-foreground">To</Label>
              <Input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-36 h-9" />
            </div>
            <Select value={branchId || "__all__"} onValueChange={(v) => setBranchId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {(branches as any[]).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={productId || "__all__"} onValueChange={(v) => setProductId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All products</SelectItem>
                {(products as any[]).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={agentId || "__all__"} onValueChange={(v) => setAgentId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All agents</SelectItem>
                {(users as any[]).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeReport === "claims" ? (
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            ) : !["fleet", "expenditures", "cashups", "payroll", "commissions", "commission-payments", "platform", "income-statement", "cash-flow", "ledger", "balance-sheet", "funerals", "payments"].includes(activeReport) ? (
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="grace">Grace</SelectItem>
                  <SelectItem value="lapsed">Lapsed</SelectItem>
                  <SelectItem value="reinstatement_pending">Reinstatement pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {activeReport === "cashups" && (
              <Select value={userId || "__all__"} onValueChange={(v) => setUserId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All users" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All users</SelectItem>
                  {(users as any[]).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </FilterBar>

          {/* Tab nav */}
          <div className="flex overflow-x-auto px-4 sm:px-6 scrollbar-hide">
            {tabsForSection(reportSection, sectionOpts).map((t) => {
              const isActive = t.value === activeReport;
              return (
                <Link
                  key={t.value}
                  href={buildStaffReportHref(reportSection, t.value)}
                  data-testid={t.testId}
                  className={`shrink-0 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </CardSection>

        <div className="min-w-0 space-y-4">
            <Tabs value={activeReport}>
              <TabsList className="sr-only absolute h-px w-px overflow-hidden whitespace-nowrap p-0 -m-px border-0">
                {tabsForSection(reportSection, sectionOpts).map((t) => (
                  <TabsTrigger key={t.value} value={t.value} data-testid={t.testId}>
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>

          <TabsContent value="policies">
            <CardSection
              title="Policy overview"
              description="Quick counts and a short policy list. From/to limit policies by capture date, same as CSV exports."
              icon={BarChart3}
              headerRight={<ExportButton reportType="policies" filters={filters} />}
            >
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
                  {Object.entries(policySummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold tabular-nums">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
                {loadingPolicies ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <DataTable>
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.slice(0, 20).map((p: any) => (
                        <TableRow key={p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm">{p.policyNumber}</TableCell>
                          <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                          <TableCell className="tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell>{p.paymentSchedule}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="policy-details">
            <CardSection
              title="Policy report (full details)"
              description="Comprehensive policy report with client, product, beneficiary and dependent details. Use filters above to narrow results."
              icon={FileText}
              headerRight={<ExportButton reportType="policy-details" filters={filters} />}
              flush
            >
                {loadingPolicyDetails ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : policyDetails.length === 0 ? (
                  <EmptyState
                    title="No policies match the filters"
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-policy-details"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead>Branch</TableHead>
                          <TableHead>Member No</TableHead>
                          <TableHead>Policy #</TableHead>
                          <TableHead>National ID</TableHead>
                          <TableHead>First Name</TableHead>
                          <TableHead>Surname</TableHead>
                          <TableHead>Address</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>DOB</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Product Code</TableHead>
                          <TableHead>Inception Date</TableHead>
                          <TableHead>Premium</TableHead>
                          <TableHead>Cover Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Date Added</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead>Agent</TableHead>
                          <TableHead>Beneficiary</TableHead>
                          <TableHead>Beneficiary ID</TableHead>
                          <TableHead>Beneficiary Phone</TableHead>
                          <TableHead>Beneficiary Rel.</TableHead>
                          <TableHead>Dependents</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {policyDetails.map((r: any) => (
                          <TableRow key={r.policyId} data-testid={`row-policy-detail-${r.policyId}`}>
                            <TableCell>{r.branchName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.memberNumber || "—"}</TableCell>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                            <TableCell className="font-mono text-sm">{r.clientNationalId || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.clientFirstName}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.clientLastName}</TableCell>
                            <TableCell className="text-sm max-w-[200px] truncate" title={r.clientAddress || ""}>{r.clientAddress || "—"}</TableCell>
                            <TableCell className="text-sm">{r.clientPhone || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.clientDateOfBirth ? new Date(r.clientDateOfBirth).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.currency} {r.premiumAmount}</TableCell>
                            <TableCell className="whitespace-nowrap">{r.coverAmount ? `${r.coverCurrency || r.currency} ${r.coverAmount}` : "—"}</TableCell>
                            <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell>{r.groupName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">{[r.beneficiaryFirstName, r.beneficiaryLastName].filter(Boolean).join(" ") || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.beneficiaryNationalId || "—"}</TableCell>
                            <TableCell className="text-sm">{r.beneficiaryPhone || "—"}</TableCell>
                            <TableCell>{r.beneficiaryRelationship || "—"}</TableCell>
                            <TableCell className="text-sm max-w-[300px]">
                              {r.dependents?.length > 0
                                ? r.dependents.map((d: any, i: number) => (
                                    <div key={i} className="whitespace-nowrap">{d.firstName} {d.lastName} ({d.relationship})</div>
                                  ))
                                : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="income-statement">
            <CardSection
              title="Income Statement"
              description="Cash basis — income from issued receipts (premium individual/group + cash services) less paid requisitions and expenditures, for the selected period. Per-currency, with a consolidated USD total."
              icon={DollarSign}
              flush
            >
              {loadingIncomeStatement ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !incomeStatement ? (
                <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (() => {
                const is = incomeStatement;
                const curs: string[] = is.currencies?.length ? is.currencies : ["USD"];
                const money = (m: any, c: string) => Number((m?.[c]) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const cu = is.consolidatedUsd || { income: 0, expenses: 0, net: 0, unconvertible: [] };
                return (
                  <div className="space-y-4 p-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total income (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.income).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Total expenses (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.expenses).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net surplus (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.net >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.net).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    </div>
                    {cu.unconvertible?.length > 0 && (
                      <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total. Set rates in Settings → FX Rates.</p>
                    )}
                    <div className="overflow-x-auto">
                      <DataTable containerClassName="border rounded-md min-w-[520px]">
                        <TableHeader className={dataTableStickyHeaderClass}>
                          <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Income</TableCell></TableRow>
                          <TableRow><TableCell>Premium — Individual</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.premiumIndividual, c)}</TableCell>)}</TableRow>
                          <TableRow><TableCell>Premium — Group</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.premiumGroup, c)}</TableCell>)}</TableRow>
                          <TableRow><TableCell>Cash services</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.cashServices, c)}</TableCell>)}</TableRow>
                          {Object.keys(is.income.legacyGroupIncome ?? {}).some((c) => (is.income.legacyGroupIncome[c] || 0) !== 0) && (
                            <TableRow><TableCell>Legacy group receipts</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.legacyGroupIncome, c)}</TableCell>)}</TableRow>
                          )}
                          <TableRow className="font-semibold border-t"><TableCell>Total income</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.income.total, c)}</TableCell>)}</TableRow>
                          <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Expenses</TableCell></TableRow>
                          {is.expenses.lines.length === 0 && <TableRow><TableCell className="text-muted-foreground text-sm" colSpan={curs.length + 1}>No expenses in period</TableCell></TableRow>}
                          {is.expenses.lines.map((l: any, i: number) => (
                            <TableRow key={i}><TableCell>{l.label} <span className="text-[10px] text-muted-foreground">({l.source})</span></TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(l.amounts, c)}</TableCell>)}</TableRow>
                          ))}
                          <TableRow className="font-semibold border-t"><TableCell>Total expenses</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(is.expenses.total, c)}</TableCell>)}</TableRow>
                          <TableRow className="font-bold border-t-2"><TableCell>Net surplus / (deficit)</TableCell>{curs.map((c) => <TableCell key={c} className={`text-right tabular-nums ${Number(is.net?.[c] || 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{money(is.net, c)}</TableCell>)}</TableRow>
                        </TableBody>
                      </DataTable>
                    </div>
                  </div>
                );
              })()}
            </CardSection>
          </TabsContent>

          <TabsContent value="cash-flow">
            <CardSection
              title="Cash Flow Statement"
              description="Cash basis — cash received (by method) less cash paid out, for the selected period, reconciled against confirmed daily cash-ups."
              icon={DollarSign}
              flush
            >
              {loadingCashFlow ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !cashFlow ? (
                <EmptyState title="No data for the selected period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (() => {
                const cf = cashFlow;
                const curs: string[] = cf.currencies?.length ? cf.currencies : ["USD"];
                const money = (m: any, c: string) => Number((m?.[c]) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                const cu = cf.consolidatedUsd || { cashIn: 0, cashOut: 0, netCash: 0, unconvertible: [] };
                const channels = Object.keys(cf.inflowsByChannel || {});
                return (
                  <div className="space-y-4 p-4">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash in (USD)</p><p className="text-lg font-bold tabular-nums text-emerald-600">{Number(cu.cashIn).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash out (USD)</p><p className="text-lg font-bold tabular-nums text-destructive">{Number(cu.cashOut).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                      <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net cash (USD)</p><p className={`text-lg font-bold tabular-nums ${cu.netCash >= 0 ? "text-emerald-600" : "text-destructive"}`}>{Number(cu.netCash).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</p></div>
                    </div>
                    {cu.unconvertible?.length > 0 && (
                      <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded px-2 py-1">No FX rate set for {cu.unconvertible.join(", ")} — excluded from the consolidated USD total.</p>
                    )}
                    <div className="overflow-x-auto">
                      <DataTable containerClassName="border rounded-md min-w-[520px]">
                        <TableHeader className={dataTableStickyHeaderClass}>
                          <TableRow><TableHead>Line</TableHead>{curs.map((c) => <TableHead key={c} className="text-right">{c}</TableHead>)}</TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash in (by method)</TableCell></TableRow>
                          {channels.map((ch) => (
                            <TableRow key={ch}><TableCell className="capitalize">{ch.replace(/_/g, " ")}</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.inflowsByChannel[ch], c)}</TableCell>)}</TableRow>
                          ))}
                          <TableRow className="font-semibold border-t"><TableCell>Total cash in</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.cashIn, c)}</TableCell>)}</TableRow>
                          <TableRow className="bg-muted/30"><TableCell className="font-semibold" colSpan={curs.length + 1}>Cash out</TableCell></TableRow>
                          <TableRow><TableCell>Requisitions paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.requisitions, c)}</TableCell>)}</TableRow>
                          <TableRow><TableCell>Expenditures paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.expenditures, c)}</TableCell>)}</TableRow>
                          <TableRow><TableCell>Agent commissions paid</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.commissions, c)}</TableCell>)}</TableRow>
                          <TableRow className="font-semibold border-t"><TableCell>Total cash out</TableCell>{curs.map((c) => <TableCell key={c} className="text-right tabular-nums">{money(cf.outflows.total, c)}</TableCell>)}</TableRow>
                          <TableRow className="font-bold border-t-2"><TableCell>Net cash movement</TableCell>{curs.map((c) => <TableCell key={c} className={`text-right tabular-nums ${Number(cf.netCash?.[c] || 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>{money(cf.netCash, c)}</TableCell>)}</TableRow>
                        </TableBody>
                      </DataTable>
                    </div>
                    {cf.bankDeposits && cf.bankDeposits.count > 0 && (
                      <div className="rounded-md border bg-muted/20 p-3">
                        <p className="text-sm font-semibold mb-1">Bank deposits in period</p>
                        <p className="text-xs text-muted-foreground">{cf.bankDeposits.count} deposit(s): {Object.entries(cf.bankDeposits.total || {}).map(([c, v]: any) => `${c} ${Number(v).toFixed(2)}`).join(", ")}</p>
                      </div>
                    )}
                    <div>
                      <p className="text-sm font-semibold mb-2">Daily cash-up reconciliation</p>
                      {(!cf.cashups || cf.cashups.length === 0) ? (
                        <p className="text-sm text-muted-foreground">No cash-ups recorded in this period.</p>
                      ) : (
                        <DataTable containerClassName="border rounded-md">
                          <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Currency</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Expected</TableHead><TableHead className="text-right">Counted</TableHead><TableHead className="text-right">Discrepancy</TableHead></TableRow></TableHeader>
                          <TableBody>
                            {cf.cashups.map((cu2: any) => (
                              <TableRow key={cu2.id}>
                                <TableCell>{cu2.cashupDate}</TableCell>
                                <TableCell>{cu2.currency}</TableCell>
                                <TableCell className="capitalize">{cu2.status}</TableCell>
                                <TableCell className="text-right tabular-nums">{Number(cu2.totalAmount || 0).toFixed(2)}</TableCell>
                                <TableCell className="text-right tabular-nums">{cu2.countedTotal != null ? Number(cu2.countedTotal).toFixed(2) : "—"}</TableCell>
                                <TableCell className="text-right tabular-nums">{cu2.discrepancyAmount != null ? Number(cu2.discrepancyAmount).toFixed(2) : "—"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </DataTable>
                      )}
                    </div>
                  </div>
                );
              })()}
            </CardSection>
          </TabsContent>

          <TabsContent value="ledger">
            <CardSection
              title="Transaction Ledger"
              description="Every income and expense transaction in the selected period, in the order they occurred, with who recorded it and which department / cost-centre it belongs to."
              icon={DollarSign}
              flush
            >
              {loadingLedger ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : !ledger || ledger.entries.length === 0 ? (
                <EmptyState title="No transactions for the selected period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  {ledger.total > ledger.entries.length && (
                    <p className="text-xs text-muted-foreground px-4 pt-3">
                      Showing {ledger.entries.length} of {ledger.total} transactions — narrow the date range to see the rest.
                    </p>
                  )}
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[900px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Person</TableHead>
                        <TableHead>Department / Cost centre</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.entries.map((e: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className="whitespace-nowrap">{e.date}</TableCell>
                          <TableCell>
                            <span className={e.type === "income" ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>
                              {e.type === "income" ? "Income" : "Expense"}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[280px] truncate" title={e.description}>{e.description}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.reference || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.person || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.department || "—"}</TableCell>
                          <TableCell className={`text-right tabular-nums whitespace-nowrap ${e.type === "income" ? "text-emerald-600" : "text-destructive"}`}>
                            {e.type === "expense" ? "-" : ""}{e.currency} {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="balance-sheet">
            <BalanceSheetPanel
              balanceSheet={balanceSheet}
              loading={loadingBalanceSheet}
              asOf={filters.toDate || new Date().toISOString().slice(0, 10)}
              onEntryChanged={() => {}}
            />
          </TabsContent>

          <TabsContent value="finance">
            <CardSection
              title="Finance report"
              description="Policies are narrowed by capture date when you set from/to. Receipt count, months paid, and totals use issued receipts in that same window when dates are set; otherwise receipts are lifetime-to-date."
              icon={DollarSign}
              headerRight={<ExportButton reportType="finance" filters={filters} />}
              flush
            >
                {loadingFinance ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : financeReport.length === 0 ? (
                  <EmptyState
                    title="No policies match the filters"
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-finance-report"
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead>Policy #</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Premium</TableHead>
                          <TableHead>Capture date</TableHead>
                          <TableHead>Inception date</TableHead>
                          <TableHead>Cover date</TableHead>
                          <TableHead>Due date</TableHead>
                          <TableHead>Date paid</TableHead>
                          <TableHead>Receipt count</TableHead>
                          <TableHead>Months paid</TableHead>
                          <TableHead>Grace used</TableHead>
                          <TableHead>Grace remaining</TableHead>
                          <TableHead>Outstanding</TableHead>
                          <TableHead>Advance</TableHead>
                          <TableHead>Client</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>Product code</TableHead>
                          <TableHead>Branch</TableHead>
                          <TableHead>Group</TableHead>
                          <TableHead>Agent</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {financeReport.map((r: any) => (
                          <TableRow key={r.policyId} data-testid={`row-finance-${r.policyId}`}>
                            <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                            <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                            <TableCell className="whitespace-nowrap tabular-nums">{r.currency} {r.premiumAmount}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.policyCreatedAt ? new Date(r.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.inceptionDate ? new Date(r.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.waitingPeriodEndDate ? new Date(r.waitingPeriodEndDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.dueDate ? new Date(r.dueDate).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="text-sm whitespace-nowrap">{r.datePaid ? new Date(r.datePaid).toLocaleDateString() : "—"}</TableCell>
                            <TableCell className="tabular-nums">{r.receiptCount}</TableCell>
                            <TableCell className="tabular-nums">{r.monthsPaid}</TableCell>
                            <TableCell className="tabular-nums">{r.graceDaysUsed}</TableCell>
                            <TableCell className="tabular-nums">{r.graceDaysRemaining != null ? r.graceDaysRemaining : "—"}</TableCell>
                            <TableCell className="font-medium tabular-nums">{r.currency} {r.outstandingPremium}</TableCell>
                            <TableCell className="text-green-700 tabular-nums">{r.currency} {r.advancePremium}</TableCell>
                            <TableCell className="whitespace-nowrap">{[r.clientTitle, r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                            <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                            <TableCell className="font-mono text-sm">{r.productCode || "—"}</TableCell>
                            <TableCell>{r.branchName || "—"}</TableCell>
                            <TableCell>{r.groupName || "—"}</TableCell>
                            <TableCell className="text-sm">{r.agentDisplayName || r.agentEmail || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="underwriter-payable">
            <CardSection
              title="Underwriter payable"
              description="Monthly amount the tenant pays to the underwriter per policy (per adult/child). Includes advance months where applicable. Use filters to narrow by branch, product or status."
              icon={Truck}
              headerRight={<ExportButton reportType="underwriter-payable" filters={filters} />}
            >
                {loadingUnderwriterPayable ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : !underwriterPayableResult?.rows?.length ? (
                  <EmptyState
                    title="No matching policies"
                    description="No policies with underwriter configuration match the filters."
                    className="border-0 rounded-none bg-transparent py-8"
                    dataTestId="text-no-underwriter-report"
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                      <KpiStatCard
                        label="Policies"
                        value={<span data-testid="text-underwriter-policy-count">{underwriterPayableResult.summary.policyCount}</span>}
                        icon={FolderOpen}
                      />
                      <KpiStatCard
                        label="Total monthly payable"
                        value={
                          <span className="tabular-nums" data-testid="text-underwriter-monthly">
                            {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalMonthlyPayable.toFixed(2)}
                          </span>
                        }
                        icon={DollarSign}
                      />
                      <KpiStatCard
                        label="Total (incl. advance months)"
                        value={
                          <span className="tabular-nums" data-testid="text-underwriter-total">
                            {underwriterPayableResult.rows[0]?.currency ?? ""} {underwriterPayableResult.summary.totalPayableIncludingAdvance.toFixed(2)}
                          </span>
                        }
                        icon={TrendingUp}
                      />
                    </div>
                    <div className="overflow-x-auto">
                      <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[900px]">
                        <TableHeader className={dataTableStickyHeaderClass}>
                          <TableRow>
                            <TableHead>Policy #</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Client</TableHead>
                            <TableHead>Phone</TableHead>
                            <TableHead>Product</TableHead>
                            <TableHead>Branch</TableHead>
                            <TableHead>Adults</TableHead>
                            <TableHead>Children</TableHead>
                            <TableHead>Rate (A/C)</TableHead>
                            <TableHead>Advance (mo)</TableHead>
                            <TableHead>Monthly</TableHead>
                            <TableHead>Total payable</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {underwriterPayableResult.rows.map((r: any) => (
                            <TableRow key={r.policyId} className="hover:bg-muted/40" data-testid={`row-underwriter-${r.policyId}`}>
                              <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                              <TableCell><StatusBadge status={r.status} variant="policy" /></TableCell>
                              <TableCell className="whitespace-nowrap">{[r.clientFirstName, r.clientLastName].filter(Boolean).join(" ")}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.clientPhone || "—"}</TableCell>
                              <TableCell className="text-sm">{r.productName || "—"}</TableCell>
                              <TableCell>{r.branchName || "—"}</TableCell>
                              <TableCell>{r.adults}</TableCell>
                              <TableCell>{r.children}</TableCell>
                              <TableCell className="text-sm whitespace-nowrap">{r.underwriterAmountAdult ?? "—"} / {r.underwriterAmountChild ?? "—"}</TableCell>
                              <TableCell>{r.underwriterAdvanceMonths}</TableCell>
                              <TableCell className="font-medium tabular-nums">{r.currency} {r.monthlyPayable.toFixed(2)}</TableCell>
                              <TableCell className="font-medium tabular-nums">{r.currency} {r.totalPayable.toFixed(2)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </DataTable>
                    </div>
                  </>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="active-policies">
            <CardSection title="Active policies" icon={CheckCircle} description="Policies with status active. When from/to are set, results are limited to policies captured in that window." headerRight={<ExportButton reportType="active-policies" filters={filters} />} flush>
              {loadingActivePolicies ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activePolicies.length === 0 ? (
                <EmptyState title="No active policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Inception Date</TableHead>
                        <TableHead>Capture Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activePolicies.slice(0, 100).map((p: any) => (
                        <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                          <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                          <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                          <TableCell>{p.branchName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.inceptionDate ? new Date(p.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="awaiting-payments">
            <CardSection title="Policies Awaiting Payments" icon={Clock} description="Active and grace policies — awaiting premium payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="awaiting-payments" filters={filters} />} flush>
              {loadingAwaitingPayments ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : awaitingPayments.length === 0 ? (
                <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Grace End</TableHead>
                        <TableHead>Capture Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {awaitingPayments.slice(0, 100).map((p: any) => (
                        <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                          <TableCell><StatusBadge status={p.status} variant="policy" /></TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                          <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                          <TableCell>{p.branchName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="overdue">
            <CardSection title="Overdue Payments (Grace)" icon={AlertCircle} description="Policies currently in grace period — payment overdue. Filter by branch, product, or agent." headerRight={<ExportButton reportType="overdue" filters={filters} />} flush>
              {loadingOverdue ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : overduePolicies.length === 0 ? (
                <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Grace End</TableHead>
                        <TableHead>Capture Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overduePolicies.slice(0, 100).map((p: any) => (
                        <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                          <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                          <TableCell>{p.branchName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="pre-lapse">
            <CardSection title="Pre-lapse (Grace period)" icon={AlertCircle} description="Policies in grace period at risk of lapsing. Filter by branch, product, or agent." headerRight={<ExportButton reportType="pre-lapse" filters={filters} />} flush>
              {loadingPreLapse ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : preLapsePolicies.length === 0 ? (
                <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Grace End</TableHead>
                        <TableHead>Capture Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {preLapsePolicies.slice(0, 100).map((p: any) => (
                        <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                          <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                          <TableCell>{p.branchName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.graceEndDate ? new Date(p.graceEndDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="lapsed">
            <CardSection title="Lapsed Policies" icon={AlertCircle} description="Policies that have lapsed due to non-payment. Filter by branch, product, or agent." headerRight={<ExportButton reportType="lapsed" filters={filters} />} flush>
              {loadingLapsed ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : lapsedPolicies.length === 0 ? (
                <EmptyState title="No policies match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1100px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Inception Date</TableHead>
                        <TableHead>Capture Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lapsedPolicies.slice(0, 100).map((p: any) => (
                        <TableRow key={p.policyId || p.id} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.policyNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{p.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{p.clientPhone || "—"}</TableCell>
                          <TableCell className="text-sm">{p.productName || "—"}</TableCell>
                          <TableCell>{p.branchName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.agentDisplayName || p.agentEmail || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.inceptionDate ? new Date(p.inceptionDate).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{p.policyCreatedAt ? new Date(p.policyCreatedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="new-joinings">
            <CardSection title="New joinings report" icon={FileText} description="All policies captured in the date range (inactive through cancelled), paid or unpaid. Filter by branch, product, or agent above; status filter does not apply to this report." headerRight={<ExportButton reportType="new-joinings" filters={filters} />} flush>
                {loadingNewJoinings ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : newJoinings.length === 0 ? (
                  <EmptyState title="No policies in range" description="Set from/to dates or widen filters." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">Franchise_Branch_ID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Franchise_BranchName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Marketing_Member_ID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Policy_num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ID_Number</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">First_Name</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Surname</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PolicyHolder</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Title</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Initials</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">UsualPrem</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Cell_Num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PhysicalAdd</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PostalAdd</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">EasyPayNo</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Payment_M</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">StopOrder</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Waiting_Pe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalRe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentNam</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MaturityTe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">GroupName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Idate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Status</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Captured</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {newJoinings.slice(0, 100).map((r: any) => (
                          <TableRow key={r._policyId || `${r.Policy_num}-${r._policyCreatedAt}`}>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Franchise_Branch_ID || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate" title={r.Franchise_BranchName}>{r.Franchise_BranchName || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Marketing_Member_ID || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Policy_num}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.ID_Number || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.First_Name}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Surname}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.PolicyHolder}>{r.PolicyHolder || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Title || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Initials || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.UsualPrem || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Cell_Num || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.PhysicalAdd}>{r.PhysicalAdd || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.PostalAdd}>{r.PostalAdd || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.EasyPayNo || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Payment_M || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.StopOrder || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Waiting_Pe || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[120px] truncate" title={r.InternalRe}>{r.InternalRe || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.AgentNam}>{r.AgentNam || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[160px] truncate" title={r.MaturityTe}>{r.MaturityTe || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.GroupName}>{r.GroupName || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Idate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate || "—"}</TableCell>
                            <TableCell><Badge variant="outline" className="text-xs">{r._status || "—"}</Badge></TableCell>
                            <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                              {r._policyCreatedAt ? new Date(r._policyCreatedAt).toLocaleDateString() : "—"}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="agent-portfolio">
            <CardSection
              title="Agent portfolio"
              description="All policies assigned to each agent. Filter by agent or status. Export as PDF for printing or CSV for Excel — both include Call Outcome and Next Engagement Date columns for client follow-up."
              icon={UserCircle}
              headerRight={
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={() => {
                      const a = document.createElement("a");
                      a.href = getApiBase() + "/api/reports/agent-portfolio/pdf?download=1" + qAppend;
                      a.download = "agent-portfolio.pdf";
                      document.body.appendChild(a);
                      a.click();
                      document.body.removeChild(a);
                    }}
                  >
                    <FileText className="h-4 w-4" /> PDF
                  </button>
                  <ExportButton reportType="agent-portfolio" filters={filters} />
                </div>
              }
              flush
            >
              {loadingAgentPortfolio ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : agentPortfolio.length === 0 ? (
                <EmptyState title="No policies found" description="Adjust filters and click Run report." className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Agent</TableHead>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Last Name</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Effective Date</TableHead>
                        <TableHead className="text-muted-foreground italic">Call Outcome</TableHead>
                        <TableHead className="text-muted-foreground italic">Next Engagement</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {agentPortfolio.map((p: any, idx: number) => (
                        <TableRow key={p.Policy_Number ?? idx} className="hover:bg-muted/40">
                          <TableCell className="text-sm whitespace-nowrap">{p.AgentsName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm whitespace-nowrap">{p.Policy_Number || "—"}</TableCell>
                          <TableCell><StatusBadge status={p.currstatus} variant="policy" /></TableCell>
                          <TableCell className="whitespace-nowrap">{(p.fullname ?? "").split(" ")[0] || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{(p.fullname ?? "").split(" ").slice(1).join(" ") || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{p.ID_Number || "—"}</TableCell>
                          <TableCell className="text-sm">{p.Cell_Number || "—"}</TableCell>
                          <TableCell className="text-sm">{p.ProductName || "—"}</TableCell>
                          <TableCell className="text-sm">{p.BranchName || "—"}</TableCell>
                          <TableCell className="tabular-nums whitespace-nowrap">{p.UsualPremium || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{p.Inception_Date ? new Date(p.Inception_Date).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-xs italic border-l">____________</TableCell>
                          <TableCell className="text-muted-foreground text-xs italic border-l">____________</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="agent-productivity">
            <CardSection title="Agent productivity" icon={TrendingUp} description="Policies captured and issued at least one receipt in the same from/to window. Set both dates; branch, product, and agent filters apply." headerRight={<ExportButton reportType="agent-productivity" filters={filters} />} flush>
              {!fromDate || !toDate ? (
                <EmptyState title="Set date range" description="Choose a from date and to date to run this report." className="border-0 rounded-none bg-transparent py-8" />
              ) : loadingAgentProductivity ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : agentProductivity.length === 0 ? (
                <EmptyState title="No policies match" description="No policies registered and receipt-issued in range." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap">agent_id</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentsName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Policy_Number</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">FullName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_Name</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">UsualPremium</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">StatusDesc</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptsCollected</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Colour</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MembersBranch</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AgentsBranch</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Active</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {agentProductivity.slice(0, 100).map((r: any) => (
                          <TableRow key={r.policyId}>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.agent_id || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[120px] truncate" title={r.AgentsName}>{r.AgentsName || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.Policy_Number}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.FullName}>{r.FullName || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[140px] truncate" title={r.Product_Name}>{r.Product_Name || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.UsualPremium || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.StatusDesc}</TableCell>
                            <TableCell className="text-xs">{r.ReceiptsCollected}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Colour || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.MembersBranch}>{r.MembersBranch || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap max-w-[100px] truncate" title={r.AgentsBranch}>{r.AgentsBranch || "—"}</TableCell>
                            <TableCell className="text-xs">{r.Active}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fdate}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="activations">
            <CardSection title="Policy activations" icon={UserCheck} description="Rows when a policy moved to active (status history). From/to filter that event time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="activations" filters={filters} />} flush>
              {loadingActivations ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : activations.length === 0 ? (
                <EmptyState title="No activations in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Previous status</TableHead>
                      <TableHead>Activated at</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Current status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activations.map((r: any) => (
                      <TableRow key={`${r.policyId}-${r.activatedAt}`}>
                        <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                        <TableCell>{r.clientName}</TableCell>
                        <TableCell><Badge variant="outline">{r.fromStatus || "—"}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(r.activatedAt).toLocaleString()}</TableCell>
                        <TableCell>{r.reason || "—"}</TableCell>
                        <TableCell><Badge variant={r.currentStatus === "active" ? "default" : "secondary"}>{r.currentStatus}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="claims">
            <CardSection title="Claims report" icon={FileText} description="Claims with policyholder details. Filter by date range, branch, or claim status." headerRight={<ExportButton reportType="claims" filters={filters} />} flush>
              {loadingClaimsReport ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : claimsReport.length === 0 ? (
                <EmptyState title="No claims match the filters" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1200px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Claim #</TableHead>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Branch</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Date of Death</TableHead>
                        <TableHead>Approved Amount</TableHead>
                        <TableHead>Submitted</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claimsReport.slice(0, 100).map((c: any) => (
                        <TableRow key={c.claimId} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{c.claimNumber}</TableCell>
                          <TableCell className="font-mono text-sm whitespace-nowrap">{c.policyNumber || "—"}</TableCell>
                          <TableCell><Badge variant="outline">{c.claimType}</Badge></TableCell>
                          <TableCell><StatusBadge status={c.status} variant="claim" /></TableCell>
                          <TableCell className="whitespace-nowrap">{c.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{c.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{c.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{c.clientPhone || "—"}</TableCell>
                          <TableCell>{c.branchName || "—"}</TableCell>
                          <TableCell>{c.deceasedName || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{c.dateOfDeath ? new Date(c.dateOfDeath).toLocaleDateString() : "—"}</TableCell>
                          <TableCell className="font-semibold tabular-nums">{c.approvedAmount ? `${c.currency || "USD"} ${c.approvedAmount}` : "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{c.createdAt ? new Date(c.createdAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="receipts">
            <CardSection title="Daily receipts report" icon={Receipt} description={<>{receiptReport.length} receipts{filters.fromDate ? ` from ${filters.fromDate}` : ""}{filters.toDate ? ` to ${filters.toDate}` : ""}. Includes UTC <span className="font-mono">DTSTAMP</span> (YYYYMMDDTHHmmssZ) per receipt and policy-receipt detail columns for export.</>} headerRight={<ExportButton reportType="receipts" filters={filters} />} flush>
                {loadingReceipts ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : receiptReport.length === 0 ? (
                  <EmptyState title="No receipts found" description="Use the date filters above to select a reporting period." className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <div className="overflow-x-auto min-w-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs whitespace-nowrap font-mono">DTSTAMP</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">agentsName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthsPaidInAdvance</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">policy_number</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">surname</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalReferenceNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_Name</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_Date</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">YearNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptCount</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">tdate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PaymentBy</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptNumber</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ManualUser</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DatePaid</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Transaction</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PremiumDue</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Currency</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">AmountCollected</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MonthsPaid</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Remarks</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PaymentMethod</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DefaultPay</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">DebitMethod</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptMonth</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptYear</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">policy_num</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">PolicyBranch</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Inception_</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Sstatus</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InternalRe</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">Product_N</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">CollectedBy</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">fromDate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">toDate</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">GroupName</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">InceptionD</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">MemberID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ActualPen</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">ReceiptID</TableHead>
                          <TableHead className="text-xs whitespace-nowrap">CapturedBy</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {receiptReport.map((r: any, idx: number) => (
                          <TableRow key={r.receiptId || idx}>
                            <TableCell className="text-xs font-mono whitespace-nowrap" title={r.DTSTAMP}>{r.DTSTAMP || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.agentsName}>{r.agentsName || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthsPaidInAdvance ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_number || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.surname || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.InternalReferenceNumber}>{r.InternalReferenceNumber || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.Product_Name}>{r.Product_Name || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_Date || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthNumber ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.YearNumber ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptCount ?? "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fdate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.tdate || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.PaymentBy}>{r.PaymentBy || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{formatReceiptNumber(r.ReceiptNumber || r.receiptNumber)}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.ManualUser}>{r.ManualUser || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DatePaid || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[160px] truncate" title={r.Transaction}>{r.Transaction || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.PremiumDue || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Currency || "—"}</TableCell>
                            <TableCell className="text-xs font-semibold whitespace-nowrap">{parseFloat(String(r.AmountCollected ?? r.amount ?? "0")).toFixed(2)}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.MonthsPaid ?? "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.Remarks}>{r.Remarks || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap"><Badge variant="outline" className="text-[10px]">{r.PaymentMethod || "—"}</Badge></TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DefaultPay || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.DebitMethod || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptMonth ?? "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ReceiptYear ?? "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.policy_num || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.PolicyBranch}>{r.PolicyBranch || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.Inception_ || "—"}</TableCell>
                            <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.Sstatus || "—"}</Badge></TableCell>
                            <TableCell className="text-xs font-mono max-w-[100px] truncate" title={r.InternalRe}>{r.InternalRe || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[120px] truncate" title={r.Product_N}>{r.Product_N || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.CollectedBy}>{r.CollectedBy || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.fromDate || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.toDate || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.GroupName}>{r.GroupName || "—"}</TableCell>
                            <TableCell className="text-xs whitespace-nowrap">{r.InceptionD || "—"}</TableCell>
                            <TableCell className="text-xs font-mono whitespace-nowrap">{r.MemberID || "—"}</TableCell>
                            <TableCell className="text-xs tabular-nums">{r.ActualPen || "—"}</TableCell>
                            <TableCell className="text-xs font-mono max-w-[90px] truncate" title={r.ReceiptID}>{r.ReceiptID || "—"}</TableCell>
                            <TableCell className="text-xs max-w-[100px] truncate" title={r.CapturedBy}>{r.CapturedBy || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="payments">
            <CardSection title="Payment Transactions" icon={Receipt} headerRight={<ExportButton reportType="payments" filters={filters} />} flush>
              {loadingPayments ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : payments.length === 0 ? (
                <EmptyState title="No payments recorded" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Reference</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Received</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.slice(0, 20).map((p: any) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-sm">{p.reference || "—"}</TableCell>
                        <TableCell className="font-semibold">{p.currency} {p.amount}</TableCell>
                        <TableCell>{p.paymentMethod}</TableCell>
                        <TableCell><Badge variant={p.status === "cleared" ? "default" : p.status === "reversed" ? "destructive" : "secondary"}>{p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : p.status}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{p.receivedAt ? new Date(p.receivedAt).toLocaleDateString() : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="funerals">
            <CardSection title="Funeral Cases" icon={FolderOpen} headerRight={<ExportButton reportType="funerals" filters={filters} />} flush>
              {funeralCases.length === 0 ? (
                <EmptyState title="No funeral cases recorded" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case #</TableHead>
                      <TableHead>Deceased</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Funeral Date</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {funeralCases.slice(0, 20).map((fc: any) => (
                      <TableRow key={fc.id}>
                        <TableCell className="font-mono text-sm">{fc.caseNumber}</TableCell>
                        <TableCell>{fc.deceasedName}</TableCell>
                        <TableCell><Badge>{fc.status}</Badge></TableCell>
                        <TableCell>{fc.funeralDate || "TBD"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="fleet">
            <CardSection title="Fleet Vehicles" icon={Truck} headerRight={<ExportButton reportType="fleet" filters={filters} />} flush>
              {loadingFleet ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : fleet.length === 0 ? (
                <EmptyState title="No fleet vehicles recorded" data-testid="text-no-fleet" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Registration</TableHead>
                      <TableHead>Make</TableHead>
                      <TableHead>Model</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Mileage</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fleet.slice(0, 20).map((v: any) => (
                      <TableRow key={v.id} data-testid={`row-fleet-${v.id}`}>
                        <TableCell className="font-mono text-sm">{v.registration}</TableCell>
                        <TableCell>{v.make}</TableCell>
                        <TableCell>{v.model}</TableCell>
                        <TableCell>{v.year}</TableCell>
                        <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                        <TableCell>{v.currentMileage || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="expenditures">
            <CardSection title="Expenditure Report" icon={DollarSign} headerRight={<ExportButton reportType="expenditures" filters={filters} />} flush>
              {loadingExpenditures ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : expenditures.length === 0 ? (
                <EmptyState title="No expenditures recorded" data-testid="text-no-expenditures" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Receipt ref</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {expenditures.slice(0, 20).map((e: any) => (
                      <TableRow key={e.id} data-testid={`row-expenditure-${e.id}`}>
                        <TableCell>{e.description}</TableCell>
                        <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                        <TableCell className="font-semibold">{e.currency} {e.amount}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{e.spentAt || (e.createdAt ? new Date(e.createdAt).toLocaleDateString() : "—")}</TableCell>
                        <TableCell>{e.receiptRef || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="cashups">
            <CardSection title="Daily Cashups by User" icon={Calendar} description="Use the Report filters above to set date range and optional user." headerRight={<ExportButton reportType="cashups" filters={filters} />} flush>
              {loadingCashups ? <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div> : cashups.length === 0 ? (
                <EmptyState title="No cashups in range" data-testid="text-no-cashups" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cashup date</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Total amount</TableHead>
                      <TableHead>Transaction count</TableHead>
                      <TableHead>Locked</TableHead>
                      <TableHead>Prepared by</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cashups.map((c: any) => (
                      <TableRow key={c.id} data-testid={`row-cashup-${c.id}`}>
                        <TableCell className="font-mono text-sm">{c.cashupDate}</TableCell>
                        <TableCell>{c.currency || "USD"}</TableCell>
                        <TableCell className="font-semibold">{c.currency || "USD"} {c.totalAmount}</TableCell>
                        <TableCell>{c.transactionCount}</TableCell>
                        <TableCell><Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge></TableCell>
                        <TableCell>{(users as any[])?.find((u: any) => u.id === c.preparedBy)?.displayName || c.preparedBy || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="payroll">
            <CardSection title="Payroll Report" icon={Users} headerRight={<ExportButton reportType="payroll" filters={filters} />} flush>
              {loadingPayroll ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : payrollEmployees.length === 0 ? (
                <EmptyState title="No payroll employees recorded" data-testid="text-no-payroll" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee Name</TableHead>
                      <TableHead>ID Number</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Basic Salary</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollEmployees.slice(0, 20).map((emp: any) => (
                      <TableRow key={emp.id} data-testid={`row-payroll-${emp.id}`}>
                        <TableCell className="font-medium">{emp.employeeName}</TableCell>
                        <TableCell className="font-mono text-sm">{emp.idNumber}</TableCell>
                        <TableCell>{emp.position}</TableCell>
                        <TableCell>{emp.department}</TableCell>
                        <TableCell className="font-semibold">{emp.currency || "USD"} {emp.basicSalary}</TableCell>
                        <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="commissions" className="space-y-6">
            <CardSection
              title="Commissions report"
              icon={Percent}
              description={<>Per-agent totals from the commission ledger for the selected date range and filters. Payroll columns without a system source (PAYE, advances, etc.) are left blank.{!agentId ? <span className="block mt-1">Select an agent above to download that agent&apos;s detailed ledger lines (optional).</span> : null}</>}
              headerRight={
                <div className="flex flex-wrap items-center gap-2">
                  <ExportButton reportType="commissions" filters={filters} />
                  {agentId && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const suffix = q ? `${q}&` : "?";
                        const url = getApiBase() + `/api/reports/export/commissions${suffix}mode=ledger`;
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = "commissions-ledger.csv";
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                      }}
                      data-testid="button-export-commission-ledger"
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Agent ledger CSV
                    </Button>
                  )}
                </div>
              }
              contentClassName="overflow-x-auto"
              flush>
                {loadingCommissionSummary ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : commissionSummary.length === 0 ? (
                  <EmptyState title="No commission ledger activity in this period" data-testid="text-no-commissions" className="border-0 rounded-none bg-transparent py-8" />
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="whitespace-nowrap">AGENT NAME</TableHead>
                        <TableHead className="w-6 p-1" aria-label="Spacer" />
                        <TableHead className="whitespace-nowrap">NUMBER OF POLICIES</TableHead>
                        <TableHead className="whitespace-nowrap">Groups</TableHead>
                        <TableHead className="whitespace-nowrap">Groups</TableHead>
                        <TableHead className="whitespace-nowrap">individ</TableHead>
                        <TableHead className="whitespace-nowrap">Individ</TableHead>
                        <TableHead className="whitespace-nowrap">Investm</TableHead>
                        <TableHead className="whitespace-nowrap">Clawb</TableHead>
                        <TableHead className="whitespace-nowrap">Call Cen</TableHead>
                        <TableHead className="whitespace-nowrap">Trips</TableHead>
                        <TableHead className="whitespace-nowrap">Cash se</TableHead>
                        <TableHead className="whitespace-nowrap">Basic</TableHead>
                        <TableHead className="whitespace-nowrap">Overtim</TableHead>
                        <TableHead className="whitespace-nowrap">TOTAL</TableHead>
                        <TableHead className="whitespace-nowrap">PA</TableHead>
                        <TableHead className="whitespace-nowrap">TAX LE</TableHead>
                        <TableHead className="whitespace-nowrap">CRED</TableHead>
                        <TableHead className="whitespace-nowrap">ADVAN</TableHead>
                        <TableHead className="whitespace-nowrap">POLICY DEDUCTI</TableHead>
                        <TableHead className="whitespace-nowrap">MEDICAL AID DEDUCTI</TableHead>
                        <TableHead className="whitespace-nowrap">UNPAID M</TableHead>
                        <TableHead className="whitespace-nowrap">NET P</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionSummary.map((row: any) => (
                        <TableRow key={row.agentId} data-testid={`row-commission-summary-${row.agentId}`}>
                          <TableCell className="font-medium whitespace-nowrap">{row.agentName}</TableCell>
                          <TableCell className="w-6 p-1" />
                          <TableCell>{row.numberOfPolicies}</TableCell>
                          <TableCell>{row.groupsCount}</TableCell>
                          <TableCell className="font-mono text-xs">{row.groupsCommission}</TableCell>
                          <TableCell>{row.individualsCount}</TableCell>
                          <TableCell className="font-mono text-xs">{row.individualsCommission}</TableCell>
                          <TableCell className="font-mono text-xs">{row.investment}</TableCell>
                          <TableCell className="font-mono text-xs">{row.clawback}</TableCell>
                          <TableCell className="font-mono text-xs">{row.callCenter}</TableCell>
                          <TableCell className="font-mono text-xs">{row.trips}</TableCell>
                          <TableCell className="font-mono text-xs">{row.cashSettlement}</TableCell>
                          <TableCell className="font-mono text-xs">{row.basic}</TableCell>
                          <TableCell className="font-mono text-xs">{row.overtime}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{row.total}</TableCell>
                          <TableCell className="text-xs">{row.paye}</TableCell>
                          <TableCell className="text-xs">{row.taxLevy}</TableCell>
                          <TableCell className="text-xs">{row.credit}</TableCell>
                          <TableCell className="text-xs">{row.advance}</TableCell>
                          <TableCell className="text-xs">{row.policyDeduction}</TableCell>
                          <TableCell className="text-xs">{row.medicalAidDeduction}</TableCell>
                          <TableCell className="text-xs">{row.unpaidMonths}</TableCell>
                          <TableCell className="font-mono text-xs font-semibold">{row.netPay}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
            </CardSection>

            <CardSection title="Commission plans" icon={Percent} description="Configured commission rules for products (reference)." flush>
              {loadingCommissionPlans ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : commissionPlans.length === 0 ? (
                <EmptyState title="No commission plans recorded" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Plan Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Rate (%)</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {commissionPlans.slice(0, 20).map((cp: any) => (
                      <TableRow key={cp.id} data-testid={`row-commission-plan-${cp.id}`}>
                        <TableCell className="font-medium">{cp.name}</TableCell>
                        <TableCell><Badge variant="outline">{cp.commissionType}</Badge></TableCell>
                        <TableCell>{cp.ratePercent}%</TableCell>
                        <TableCell><Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="commission-payments">
            <CardSection
              title="Commission by payment"
              description="One row per receipt. Shows client, policy premium, amount paid, commission earned by the agent, and branch info. Filter by date range, agent, or branch."
              icon={Percent}
              headerRight={<ExportButton reportType="commission-payments" filters={filters} />}
              flush
            >
              {loadingCommissionPayments ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : commissionPayments.length === 0 ? (
                <EmptyState title="No payment receipts match the filters" description="Set a date range and click Run report." className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[1400px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Receipt #</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Surname</TableHead>
                        <TableHead>National ID</TableHead>
                        <TableHead>Phone</TableHead>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Policy Status</TableHead>
                        <TableHead>Policy Premium</TableHead>
                        <TableHead>Amount Due</TableHead>
                        <TableHead>Amount Paid</TableHead>
                        <TableHead>Commission Payable</TableHead>
                        <TableHead>Comm. Type</TableHead>
                        <TableHead>Agent</TableHead>
                        <TableHead>Months Paid</TableHead>
                        <TableHead>Receipt Count</TableHead>
                        <TableHead>Policy Branch</TableHead>
                        <TableHead>Payment Branch</TableHead>
                        <TableHead>Period From</TableHead>
                        <TableHead>Period To</TableHead>
                        <TableHead>Channel</TableHead>
                        <TableHead>Issued At</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionPayments.slice(0, 200).map((r: any) => (
                        <TableRow key={r.receiptId} className="hover:bg-muted/40">
                          <TableCell className="font-mono text-sm whitespace-nowrap">{r.receiptNumber}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.clientFirstName || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{r.clientLastName || "—"}</TableCell>
                          <TableCell className="font-mono text-sm">{r.clientNationalId || "—"}</TableCell>
                          <TableCell className="text-sm">{r.clientPhone || "—"}</TableCell>
                          <TableCell className="font-mono text-sm whitespace-nowrap">{r.policyNumber}</TableCell>
                          <TableCell><StatusBadge status={r.policyStatus} variant="policy" /></TableCell>
                          <TableCell className="tabular-nums whitespace-nowrap">{r.currency} {r.policyPremium}</TableCell>
                          <TableCell className="tabular-nums whitespace-nowrap">{r.currency} {r.amountDue}</TableCell>
                          <TableCell className="font-medium tabular-nums whitespace-nowrap">{r.currency} {parseFloat(String(r.amountPaid ?? 0)).toFixed(2)}</TableCell>
                          <TableCell className="tabular-nums whitespace-nowrap text-emerald-700 font-medium">
                            {r.commissionPayable != null ? `${r.currency} ${parseFloat(String(r.commissionPayable)).toFixed(2)}` : "—"}
                          </TableCell>
                          <TableCell className="text-xs">{r.commissionType ? <Badge variant="outline" className="text-xs">{r.commissionType}</Badge> : "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{r.agentName || "—"}</TableCell>
                          <TableCell className="tabular-nums text-center">{r.monthsPaidFor}</TableCell>
                          <TableCell className="tabular-nums text-center">{r.receiptCount}</TableCell>
                          <TableCell>{r.policyBranch || "—"}</TableCell>
                          <TableCell>{r.paymentBranch || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{r.periodFrom || "—"}</TableCell>
                          <TableCell className="text-sm whitespace-nowrap">{r.periodTo || "—"}</TableCell>
                          <TableCell className="text-xs"><Badge variant="outline" className="text-[10px]">{r.paymentChannel || "—"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="platform">
            <CardSection title="POL263 Platform Revenue Share" icon={Building} headerRight={<ExportButton reportType="platform" filters={filters} />} flush>
              {loadingPlatform ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : platformReceivables.length === 0 ? (
                <EmptyState title="No POL263 Platform receivables recorded" data-testid="text-no-platform-receivables" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Description</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Currency</TableHead>
                      <TableHead>Settled</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {platformReceivables.slice(0, 20).map((cr: any) => (
                      <TableRow key={cr.id} data-testid={`row-platform-receivable-${cr.id}`}>
                        <TableCell>{cr.description}</TableCell>
                        <TableCell className="font-semibold">{cr.currency || "USD"} {cr.amount}</TableCell>
                        <TableCell>{cr.currency}</TableCell>
                        <TableCell><Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="conversions">
            <CardSection title="Policy conversions" icon={RotateCcw} description="Inactive to active conversions. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="conversions" filters={filters} />} flush>
              {loadingConversions ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : conversions.length === 0 ? (
                <EmptyState title="No conversions in this period" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Converted at</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Current status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {conversions.map((r: any) => (
                      <TableRow key={`${r.policyId}-${r.convertedAt}`}>
                        <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                        <TableCell>{r.clientName}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(r.convertedAt).toLocaleString()}</TableCell>
                        <TableCell>{r.reason || "—"}</TableCell>
                        <TableCell><Badge variant="outline">{r.currentStatus}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="reinstatements">
            <CardSection title="Reinstated policies" icon={RotateCcw} description="Lapsed to active reinstatements. From/to filter the status-change time; branch, product, and agent filter the policy." headerRight={<ExportButton reportType="reinstatements" filters={filters} />} flush>
              {loadingReinstatements ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : reinstatements.length === 0 ? (
                <EmptyState title="No reinstatements in this period" data-testid="text-no-reinstatements" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Policy #</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Previous status</TableHead>
                      <TableHead>Reinstated date</TableHead>
                      <TableHead>Reason</TableHead>
                      <TableHead>Current status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {reinstatements.map((r: any) => (
                      <TableRow key={`${r.policyId}-${r.reinstatedAt}`} data-testid={`row-reinstatement-${r.policyId}`}>
                        <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                        <TableCell>{r.clientName}</TableCell>
                        <TableCell><Badge variant="outline">{r.fromStatus || "—"}</Badge></TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(r.reinstatedAt).toLocaleString()}</TableCell>
                        <TableCell>{r.reason || "—"}</TableCell>
                        <TableCell><Badge variant={r.currentStatus === "active" ? "default" : "secondary"}>{r.currentStatus}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>
            </Tabs>
        </div>
      </PageShell>
    </StaffLayout>
  );
}
