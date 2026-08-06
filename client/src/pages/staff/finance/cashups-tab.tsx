import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { Plus, CalendarDays, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { CurrencySelect } from "@/components/currency-select";
import { formatAmount } from "@shared/validation";
import { QK_CASHUPS } from "./query-keys";

interface CashupsTabProps {
  authUser: any;
  canWriteFinance: boolean;
}

export function CashupsTab({ authUser, canWriteFinance }: CashupsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [cashupStatusFilter, setCashupStatusFilter] = useState<string>("");
  const [showCreateCashupDialog, setShowCreateCashupDialog] = useState(false);
  const [createCashupDate, setCreateCashupDate] = useState(new Date().toISOString().slice(0, 10));
  const [createCashupBranchId, setCreateCashupBranchId] = useState("");
  const [createCashupAmounts, setCreateCashupAmounts] = useState<Record<string, string>>({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" });
  const [createCashupCurrency, setCreateCashupCurrency] = useState("USD");
  const [createCashupTransactionCount, setCreateCashupTransactionCount] = useState("");
  const [createCashupNotes, setCreateCashupNotes] = useState("");
  const [showConfirmCashupDialog, setShowConfirmCashupDialog] = useState(false);
  const [confirmCashup, setConfirmCashup] = useState<any>(null);
  const [confirmCountedTotal, setConfirmCountedTotal] = useState("");
  const [confirmDiscrepancyNotes, setConfirmDiscrepancyNotes] = useState("");

  const { data: rawCashups } = useQuery<any[]>({
    queryKey: ["/api/cashups", cashupStatusFilter],
    queryFn: async () => {
      const url = getApiBase() + "/api/cashups" + (cashupStatusFilter ? `?status=${encodeURIComponent(cashupStatusFilter)}` : "");
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });
  const cashups = Array.isArray(rawCashups) ? rawCashups : [];
  const { data: branchesList = [] } = useQuery<any[]>({ queryKey: ["/api/branches"] });
  const branchesArr = Array.isArray(branchesList) ? branchesList : [];

  const createCashupMutation = useMutation({
    mutationFn: async (data: { cashupDate: string; branchId?: string; currency: string; amountsByMethod: Record<string, string>; transactionCount: number; notes?: string }) => {
      const res = await apiRequest("POST", "/api/cashups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_CASHUPS });
      setShowCreateCashupDialog(false);
      setCreateCashupAmounts({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" });
      setCreateCashupCurrency("USD");
      setCreateCashupTransactionCount("");
      setCreateCashupNotes("");
      toast({ title: "Cashup draft created", description: "Submit to finance when ready." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const submitCashupMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("PATCH", `/api/cashups/${id}`, { action: "submit" });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_CASHUPS });
      toast({ title: "Cashup submitted", description: "Finance will count and confirm." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmCashupMutation = useMutation({
    mutationFn: async ({ id, countedTotal, discrepancyNotes }: { id: string; countedTotal?: string; discrepancyNotes?: string }) => {
      const res = await apiRequest("PATCH", `/api/cashups/${id}`, {
        action: "confirm",
        countedTotal: countedTotal ? parseFloat(countedTotal) : undefined,
        discrepancyNotes: discrepancyNotes || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_CASHUPS });
      setShowConfirmCashupDialog(false);
      setConfirmCashup(null);
      setConfirmCountedTotal("");
      setConfirmDiscrepancyNotes("");
      toast({ title: "Cashup confirmed", description: "Reconciliation recorded." });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <TabsContent value="cashups">
      <CardSection
        title="Daily cashups"
        description="Submit your receipted totals by payment method for finance to count and confirm. Cashups include cash and mobile/card payments you have receipted."
        icon={CalendarDays}
        headerRight={(
            <div className="flex flex-wrap items-center gap-2">
              <Select value={cashupStatusFilter || "all"} onValueChange={(v) => setCashupStatusFilter(v === "all" ? "" : v)}>
                <SelectTrigger className="w-[140px]" data-testid="select-cashup-status">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="discrepancy">Discrepancy</SelectItem>
                </SelectContent>
              </Select>
              <Button size="sm" onClick={() => { setShowCreateCashupDialog(true); setCreateCashupDate(new Date().toISOString().slice(0, 10)); setCreateCashupAmounts({ cash: "", paynow_ecocash: "", paynow_card: "", other: "" }); setCreateCashupCurrency("USD"); setCreateCashupTransactionCount(""); setCreateCashupNotes(""); }} data-testid="button-new-cashup">
                <Plus className="h-4 w-4 mr-1" /> New cashup
              </Button>
            </div>
        )}
        flush
      >
          {cashups.length === 0 ? (
            <EmptyState title="No cashups yet" description="Create a draft, enter amounts by method (or load from your receipts), then submit to finance." className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Ccy</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>By method</TableHead>
                  <TableHead>Txns</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Prepared by</TableHead>
                  <TableHead className="w-[140px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cashups.map((c: any) => {
                  const am = c.amountsByMethod || {};
                  const methodSummary = ["cash", "paynow_ecocash", "paynow_card", "other"]
                    .filter((k) => parseFloat(am[k] || "0") > 0)
                    .map((k) => `${k === "cash" ? "Cash" : k === "paynow_ecocash" ? "Mobile" : k === "paynow_card" ? "Card" : "Other"}: ${parseFloat(am[k] || "0").toFixed(2)}`)
                    .join("; ") || "—";
                  const isMine = authUser?.id && c.preparedBy === authUser.id;
                  return (
                    <TableRow key={c.id} data-testid={`row-cashup-${c.id}`}>
                      <TableCell className="font-mono text-sm">{c.cashupDate}</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{c.currency || "USD"}</Badge></TableCell>
                      <TableCell className="font-semibold">{formatAmount(c.totalAmount, c.currency || "USD")}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={methodSummary}>{methodSummary}</TableCell>
                      <TableCell>{c.transactionCount}</TableCell>
                      <TableCell>
                        <Badge variant={c.status === "confirmed" ? "default" : c.status === "discrepancy" ? "secondary" : c.status === "submitted" ? "outline" : "secondary"}>
                          {c.status === "draft" ? "Draft" : c.status === "submitted" ? "Submitted" : c.status === "confirmed" ? "Confirmed" : c.status === "discrepancy" ? "Discrepancy" : c.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{isMine ? "You" : (c.preparedBy || "").slice(0, 8) + "…"}</TableCell>
                      <TableCell>
                        {c.status === "draft" && isMine && (
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => submitCashupMutation.mutate(c.id)} disabled={submitCashupMutation.isPending} data-testid={`btn-submit-cashup-${c.id}`}>Submit</Button>
                          </div>
                        )}
                        {c.status === "submitted" && canWriteFinance && (
                          <Button size="sm" variant="outline" onClick={() => { setConfirmCashup(c); setConfirmCountedTotal(c.totalAmount || ""); setConfirmDiscrepancyNotes(""); setShowConfirmCashupDialog(true); }} data-testid={`btn-confirm-cashup-${c.id}`}>Confirm</Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </DataTable>
          )}
      </CardSection>

      <Dialog open={showCreateCashupDialog} onOpenChange={setShowCreateCashupDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>New cashup</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Enter amounts you received by payment method for this date. Use &quot;Load from my receipts&quot; to prefill from your issued receipts.</p>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="create-cashup-date">Date *</Label>
                <Input id="create-cashup-date" type="date" value={createCashupDate} onChange={(e) => setCreateCashupDate(e.target.value)} data-testid="input-cashup-date" />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencySelect value={createCashupCurrency} onValueChange={setCreateCashupCurrency} />
              </div>
              <div>
                <Label htmlFor="branch">Branch</Label>
                <Select value={createCashupBranchId || "none"} onValueChange={(v) => setCreateCashupBranchId(v === "none" ? "" : v)}>
                  <SelectTrigger id="branch"><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {branchesArr.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Amounts by method</Label>
                <Button type="button" variant="ghost" size="sm" onClick={async () => {
                  const res = await fetch(getApiBase() + `/api/cashups/my-receipt-totals?date=${encodeURIComponent(createCashupDate)}`, { credentials: "include" });
                  if (!res.ok) return;
                  const data = await res.json();
                  setCreateCashupAmounts(data.amountsByMethod || { cash: "0", paynow_ecocash: "0", paynow_card: "0", other: "0" });
                  setCreateCashupTransactionCount(String(data.transactionCount ?? 0));
                  if (data.currency) setCreateCashupCurrency(data.currency);
                }} data-testid="button-load-from-receipts">Load from my receipts</Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div><Label className="text-xs">Cash</Label><Input type="number" step="0.01" value={createCashupAmounts.cash || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, cash: e.target.value })} placeholder="0" /></div>
                <div><Label className="text-xs">Mobile (EcoCash/OneMoney)</Label><Input type="number" step="0.01" value={createCashupAmounts.paynow_ecocash || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, paynow_ecocash: e.target.value })} placeholder="0" /></div>
                <div><Label className="text-xs">Card</Label><Input type="number" step="0.01" value={createCashupAmounts.paynow_card || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, paynow_card: e.target.value })} placeholder="0" /></div>
                <div><Label className="text-xs">Other</Label><Input type="number" step="0.01" value={createCashupAmounts.other || ""} onChange={(e) => setCreateCashupAmounts({ ...createCashupAmounts, other: e.target.value })} placeholder="0" /></div>
              </div>
            </div>
            <div>
              <Label>Transaction count</Label>
              <Input type="number" min={0} value={createCashupTransactionCount} onChange={(e) => setCreateCashupTransactionCount(e.target.value)} data-testid="input-cashup-txn-count" />
            </div>
            <div>
              <Label htmlFor="create-cashup-notes">Notes</Label>
              <Input id="create-cashup-notes" value={createCashupNotes} onChange={(e) => setCreateCashupNotes(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateCashupDialog(false)}>Cancel</Button>
            <Button onClick={() => {
              const total = Object.values(createCashupAmounts).reduce((s, v) => s + (parseFloat(v || "0") || 0), 0);
              if (total <= 0) { toast({ title: "Enter at least one amount", variant: "destructive" }); return; }
              createCashupMutation.mutate({
                cashupDate: createCashupDate,
                branchId: createCashupBranchId || undefined,
                currency: createCashupCurrency,
                amountsByMethod: createCashupAmounts,
                transactionCount: parseInt(createCashupTransactionCount, 10) || 0,
                notes: createCashupNotes || undefined,
              });
            }} disabled={createCashupMutation.isPending} data-testid="button-create-cashup">
              {createCashupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create draft
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showConfirmCashupDialog} onOpenChange={(open) => { if (!open) { setShowConfirmCashupDialog(false); setConfirmCashup(null); } setShowConfirmCashupDialog(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Confirm cashup</DialogTitle></DialogHeader>
          {confirmCashup && (
            <>
              <p className="text-sm text-muted-foreground">Expected total: <strong>{formatAmount(confirmCashup.totalAmount, confirmCashup.currency || "USD")}</strong> {confirmCashup.currency && confirmCashup.currency !== "USD" ? <Badge variant="outline" className="ml-1 text-xs">{confirmCashup.currency}</Badge> : null} ({confirmCashup.transactionCount} transactions). Enter counted total and any discrepancy notes.</p>
              <div className="space-y-4 pt-2">
                <div>
                  <Label htmlFor="confirm-counted-total">Counted total</Label>
                  <Input id="confirm-counted-total" type="number" step="0.01" value={confirmCountedTotal} onChange={(e) => setConfirmCountedTotal(e.target.value)} placeholder={confirmCashup.totalAmount} data-testid="input-confirm-counted-total" />
                </div>
                <div>
                  <Label htmlFor="confirm-discrepancy-notes">Discrepancy notes (if any)</Label>
                  <Input id="confirm-discrepancy-notes" value={confirmDiscrepancyNotes} onChange={(e) => setConfirmDiscrepancyNotes(e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowConfirmCashupDialog(false)}>Cancel</Button>
                <Button onClick={() => confirmCashupMutation.mutate({ id: confirmCashup.id, countedTotal: confirmCountedTotal || undefined, discrepancyNotes: confirmDiscrepancyNotes || undefined })} disabled={confirmCashupMutation.isPending} data-testid="button-confirm-cashup">
                  {confirmCashupMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Confirm
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </TabsContent>
  );
}
