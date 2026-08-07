import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, DollarSign, Pencil, Trash2, Plus } from "lucide-react";

/** Only consumer is the "balance-sheet" tab in finance-section.tsx — kept in its own file
 *  since it owns real editing state/mutations (add/edit/delete entries), unlike the other
 *  finance tabs which are pure display. */
export function BalanceSheetPanel({ balanceSheet, loading, asOf, onEntryChanged }: { balanceSheet: any; loading: boolean; asOf: string; onEntryChanged: () => void }) {
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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="form-section">Section</Label>
                  <Select value={form.section} onValueChange={v => setForm(f => ({ ...f, section: v, subsection: v === "equity" ? "" : "current" }))}>
                    <SelectTrigger id="form-section"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="asset">Asset</SelectItem>
                      <SelectItem value="liability">Liability</SelectItem>
                      <SelectItem value="equity">Equity</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {form.section !== "equity" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="form-subsection">Subsection</Label>
                    <Select value={form.subsection} onValueChange={v => setForm(f => ({ ...f, subsection: v }))}>
                      <SelectTrigger id="form-subsection"><SelectValue /></SelectTrigger>
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
              <Label htmlFor="form-label">Label</Label>
              <Input id="form-label" placeholder="e.g. Motor vehicle, Bank loan, Share capital" value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="form-amount">Amount</Label>
                <Input id="form-amount" type="number" min="0" step="0.01" placeholder="0.00" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="form-currency">Currency</Label>
                <Select value={form.currency} onValueChange={v => setForm(f => ({ ...f, currency: v }))}>
                  <SelectTrigger id="form-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZIG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="form-notes">Notes (optional)</Label>
              <Textarea id="form-notes" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
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
