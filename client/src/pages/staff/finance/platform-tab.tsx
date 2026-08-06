import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn, KpiStatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { Plus, Landmark, CalendarDays, TrendingUp, ArrowUpRight, CheckCircle2, Clock, FileText, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CurrencySelect } from "@/components/currency-select";
import { QK_SETTLEMENTS, QK_PLATFORM_SUMMARY, QK_PLATFORM_RECEIVABLES } from "./query-keys";

function formatCurrencyMap(m: Record<string, string | number> | undefined): string {
  if (!m) return "0.00";
  const entries = Object.entries(m).filter(([, v]) => Number(v) !== 0);
  if (entries.length === 0) return "0.00";
  return entries.map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join("  ·  ");
}

const settlementsColumns = (approveSettlementMutation: { mutate: (id: string) => void; isPending: boolean }): EdtColumn<any>[] => [
  { id: "date", header: "Date", accessor: (s) => new Date(s.createdAt), cell: (s) => <span className="text-sm">{new Date(s.createdAt).toLocaleDateString()}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (s) => parseFloat(s.amount), cell: (s) => <span className="font-semibold tabular-nums">{s.currency} {parseFloat(s.amount).toFixed(2)}</span> },
  { id: "method", header: "Method", accessor: (s) => s.method, cell: (s) => <Badge variant="outline">{s.method}</Badge> },
  { id: "reference", header: "Reference", accessor: (s) => s.reference || "", cell: (s) => <span className="font-mono text-xs text-muted-foreground">{s.reference || "—"}</span> },
  {
    id: "status",
    header: "Status",
    accessor: (s) => s.status,
    cell: (s) => <Badge variant={s.status === "approved" ? "default" : s.status === "rejected" ? "destructive" : "secondary"}>{s.status}</Badge>,
  },
  {
    id: "action",
    header: "Action",
    sortable: false,
    exportable: false,
    cell: (s) =>
      s.status === "pending" ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => approveSettlementMutation.mutate(s.id)}
          disabled={approveSettlementMutation.isPending}
          data-testid={`button-approve-settlement-${s.id}`}
        >
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Approve
        </Button>
      ) : null,
  },
];

const receivablesColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (r) => new Date(r.createdAt), cell: (r) => <span className="text-sm">{new Date(r.createdAt).toLocaleDateString()}</span> },
  { id: "description", header: "Description", accessor: (r) => r.description || "", cell: (r) => <span className="text-sm">{r.description || "—"}</span> },
  { id: "amount", header: "Amount", align: "right", accessor: (r) => parseFloat(r.amount), cell: (r) => <span className="font-semibold tabular-nums">{parseFloat(r.amount).toFixed(2)}</span> },
  { id: "currency", header: "Currency", accessor: (r) => r.currency },
  {
    id: "status",
    header: "Status",
    accessor: (r) => (r.isSettled ? "Settled" : "Outstanding"),
    cell: (r) => <Badge variant={r.isSettled ? "default" : "secondary"}>{r.isSettled ? "Settled" : "Outstanding"}</Badge>,
  },
];

// MONEY-CRITICAL: this tab drives the platform revenue-share reconciliation.
// See approveSettlementMutation below for the partial-allocation description calc —
// keep that logic byte-for-byte identical to what shipped, not "cleaned up".
export function PlatformTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showSettlementDialog, setShowSettlementDialog] = useState(false);
  const [settlementAmount, setSettlementAmount] = useState("");
  const [settlementCurrency, setSettlementCurrency] = useState("USD");
  const [settlementMethod, setSettlementMethod] = useState("bank");
  const [settlementReference, setSettlementReference] = useState("");

  const { data: rawPlatformReceivables } = useQuery<any[]>({ queryKey: QK_PLATFORM_RECEIVABLES });
  const { data: platformSummary } = useQuery<{ totalDue: Record<string, string>; totalSettled: Record<string, string>; outstanding: Record<string, string> }>({ queryKey: QK_PLATFORM_SUMMARY });
  const { data: rawSettlements } = useQuery<any[]>({ queryKey: QK_SETTLEMENTS });
  const platformReceivables = Array.isArray(rawPlatformReceivables) ? rawPlatformReceivables : [];
  const settlements = Array.isArray(rawSettlements) ? rawSettlements : [];

  // All of these are keyed by currency — platform_receivables holds USD, ZAR, and ZIG
  // amounts, and summing across currencies would silently blend them into one meaningless number.
  const platformDailyDue = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const map: Record<string, number> = {};
    platformReceivables
      .filter((r: any) => !r.isSettled && r.createdAt?.startsWith(today))
      .forEach((r: any) => { map[r.currency] = (map[r.currency] || 0) + parseFloat(r.amount || "0"); });
    return map;
  }, [platformReceivables]);

  const platformMTD = useMemo(() => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const map: Record<string, number> = {};
    platformReceivables
      .filter((r: any) => r.createdAt >= monthStart)
      .forEach((r: any) => { map[r.currency] = (map[r.currency] || 0) + parseFloat(r.amount || "0"); });
    return map;
  }, [platformReceivables]);

  const platformAging = useMemo(() => {
    const now = Date.now();
    const unsettled = platformReceivables.filter((r: any) => !r.isSettled);
    const buckets: Record<"current" | "days30" | "days60" | "days90plus", Record<string, number>> = {
      current: {}, days30: {}, days60: {}, days90plus: {},
    };
    unsettled.forEach((r: any) => {
      const age = (now - new Date(r.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const amt = parseFloat(r.amount || "0");
      const bucket = age <= 30 ? buckets.current : age <= 60 ? buckets.days30 : age <= 90 ? buckets.days60 : buckets.days90plus;
      bucket[r.currency] = (bucket[r.currency] || 0) + amt;
    });
    return buckets;
  }, [platformReceivables]);

  const createSettlementMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/settlements", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_SETTLEMENTS });
      queryClient.invalidateQueries({ queryKey: QK_PLATFORM_SUMMARY });
      setShowSettlementDialog(false);
      setSettlementAmount("");
      setSettlementReference("");
      toast({ title: "Settlement recorded", description: "Pending approval from a second user." });
    },
    onError: (err: any) => toast({ title: "Settlement failed", description: err.message, variant: "destructive" }),
  });

  const approveSettlementMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/settlements/${id}/approve`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: QK_SETTLEMENTS });
      queryClient.invalidateQueries({ queryKey: QK_PLATFORM_SUMMARY });
      queryClient.invalidateQueries({ queryKey: QK_PLATFORM_RECEIVABLES });
      const allocated = parseFloat(data?.allocated ?? "0");
      const settlementAmount = parseFloat(data?.amount ?? "0");
      const description = allocated < settlementAmount - 0.01
        ? `Applied ${data.currency} ${allocated.toFixed(2)} of ${data.currency} ${settlementAmount.toFixed(2)} to ${data.receivablesSettled} fee(s) — no more unsettled fees to cover the rest yet.`
        : `Applied to ${data.receivablesSettled} outstanding fee(s).`;
      toast({ title: "Settlement approved", description });
    },
    onError: (err: any) => toast({ title: "Approval failed", description: err.message, variant: "destructive" }),
  });

  return (
    <>
    <TabsContent value="platform">
      <div className="space-y-6">
        <CardSection
          title="POL263 Revenue Share (2.5%)"
          description="Auto-calculated on every cleared payment — policy premiums and funeral service receipts"
          icon={Landmark}
          headerRight={(
            <Button onClick={() => setShowSettlementDialog(true)} data-testid="button-new-settlement">
              <Plus className="h-4 w-4 mr-2" />Record Settlement
            </Button>
          )}
        >
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiStatCard
              label="Daily Due"
              value={<span data-testid="text-platform-daily">{formatCurrencyMap(platformDailyDue)}</span>}
              icon={CalendarDays}
            />
            <KpiStatCard
              label="MTD Accrued"
              value={<span data-testid="text-platform-mtd">{formatCurrencyMap(platformMTD)}</span>}
              icon={TrendingUp}
            />
            <KpiStatCard
              label="Outstanding"
              value={
                <span data-testid="text-platform-outstanding">
                  {formatCurrencyMap(platformSummary?.outstanding)}
                </span>
              }
              icon={ArrowUpRight}
            />
            <KpiStatCard
              label="Total Settled"
              value={
                <span data-testid="text-platform-settled">
                  {formatCurrencyMap(platformSummary?.totalSettled)}
                </span>
              }
              icon={CheckCircle2}
            />
          </div>
        </CardSection>

        <CardSection title="Aging buckets" description="Outstanding platform fee by age." icon={Clock}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-4 rounded-lg bg-green-50 dark:bg-green-950/20">
              <p className="text-xs text-muted-foreground mb-1">0–30 Days</p>
              <p className="text-xl font-bold text-green-700 dark:text-green-400 tabular-nums" data-testid="text-aging-current">{formatCurrencyMap(platformAging.current)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-yellow-50 dark:bg-yellow-950/20">
              <p className="text-xs text-muted-foreground mb-1">31–60 Days</p>
              <p className="text-xl font-bold text-yellow-700 dark:text-yellow-400 tabular-nums" data-testid="text-aging-30">{formatCurrencyMap(platformAging.days30)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20">
              <p className="text-xs text-muted-foreground mb-1">61–90 Days</p>
              <p className="text-xl font-bold text-orange-700 dark:text-orange-400 tabular-nums" data-testid="text-aging-60">{formatCurrencyMap(platformAging.days60)}</p>
            </div>
            <div className="text-center p-4 rounded-lg bg-red-50 dark:bg-red-950/20">
              <p className="text-xs text-muted-foreground mb-1">90+ Days</p>
              <p className="text-xl font-bold text-red-700 dark:text-red-400 tabular-nums" data-testid="text-aging-90plus">{formatCurrencyMap(platformAging.days90plus)}</p>
            </div>
          </div>
        </CardSection>

        <CardSection title="Settlements" description="Recorded settlements against platform revenue." icon={FileText}>
          <EnhancedDataTable
            columns={settlementsColumns(approveSettlementMutation)}
            rows={settlements}
            getRowKey={(s: any) => s.id}
            rowTestId={(s: any) => `row-settlement-${s.id}`}
            exportFilename="platform-settlements"
            storageKey="finance-platform-settlements"
            emptyMessage="No settlements yet."
          />
        </CardSection>

        <CardSection title="Receivables" description="Auto-created when payments are cleared." icon={FileText}>
          <EnhancedDataTable
            columns={receivablesColumns}
            rows={platformReceivables}
            getRowKey={(r: any) => r.id}
            rowTestId={(r: any) => `row-receivable-${r.id}`}
            exportFilename="platform-receivables"
            storageKey="finance-platform-receivables"
            emptyMessage="No receivables yet. They are created automatically when payments are cleared."
          />
        </CardSection>
      </div>
    </TabsContent>

      <Dialog open={showSettlementDialog} onOpenChange={setShowSettlementDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Record POL263 Settlement</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="settlement-amount">Amount</Label>
              <Input id="settlement-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={settlementAmount}
                onChange={(e) => setSettlementAmount(e.target.value)}
                data-testid="input-settlement-amount"
              />
            </div>
            <div>
              <Label>Currency</Label>
              <CurrencySelect value={settlementCurrency} onValueChange={setSettlementCurrency} />
            </div>
            <div>
              <Label htmlFor="settlement-method">Payment Method</Label>
              <Select value={settlementMethod} onValueChange={setSettlementMethod}>
                <SelectTrigger id="settlement-method" data-testid="select-settlement-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="omari">O'Mari</SelectItem>
                  <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="settlement-reference">Reference</Label>
              <Input id="settlement-reference"
                placeholder="Payment reference..."
                value={settlementReference}
                onChange={(e) => setSettlementReference(e.target.value)}
                data-testid="input-settlement-reference"
              />
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" />
              Settlement requires approval from a second user (maker-checker)
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowSettlementDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!settlementAmount || parseFloat(settlementAmount) <= 0) {
                  toast({ title: "Enter amount", variant: "destructive" });
                  return;
                }
                createSettlementMutation.mutate({
                  amount: settlementAmount,
                  currency: settlementCurrency,
                  method: settlementMethod,
                  reference: settlementReference || undefined,
                });
              }}
              disabled={!settlementAmount || createSettlementMutation.isPending}
              data-testid="button-submit-settlement"
            >
              {createSettlementMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Record Settlement
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
