import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Plus, FileText, Loader2, ChevronDown, ChevronRight, Printer, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CurrencySelect } from "@/components/currency-select";
import { SearchableSelect, type SearchableOption } from "@/components/searchable-select";
import { RequisitionPaymentHistory } from "./payment-history-table";
import { QK_REQUISITIONS, QK_APPROVALS, QK_PAYMENT_DISBURSEMENTS } from "./query-keys";

type ReqItem = { description: string; category: string; qty: string; unitPrice: string };
const blankItem = (): ReqItem => ({ description: "", category: "", qty: "1", unitPrice: "" });

interface RequisitionsTabProps {
  authUser: any;
  canReadFinance: boolean;
  canWriteFinance: boolean;
  canApproveFinance: boolean;
  canDeleteRequisition: boolean;
  canBackdatePayment: boolean;
  canEditPayment: boolean;
  staffUsers: any[];
  openPayDialog: (type: "requisition" | "expenditure", item: any) => void;
}

export function RequisitionsTab({
  authUser, canReadFinance, canWriteFinance, canApproveFinance, canDeleteRequisition,
  canBackdatePayment, canEditPayment, staffUsers, openPayDialog,
}: RequisitionsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rawRequisitions } = useQuery<any[]>({ queryKey: QK_REQUISITIONS, enabled: canReadFinance || canWriteFinance || canApproveFinance });
  const requisitions = Array.isArray(rawRequisitions) ? rawRequisitions : [];

  const [showRequisitionDialog, setShowRequisitionDialog] = useState(false);
  const [reqHeader, setReqHeader] = useState({ payee: "", currency: "USD", notes: "", neededByDate: "", raisedDate: new Date().toISOString().slice(0, 10), requestedByUserId: authUser?.id || "", funeralCaseId: "" });
  const [reqItems, setReqItems] = useState<ReqItem[]>([blankItem()]);
  // Approve/reject dialog
  const [approveTarget, setApproveTarget] = useState<any>(null);
  const [approveAction, setApproveAction] = useState<"approve" | "reject">("approve");
  const [approveNotes, setApproveNotes] = useState("");
  const [adjustedAmount, setAdjustedAmount] = useState("");
  const reqTotal = reqItems.reduce((s, it) => s + (Number(it.qty) || 0) * (Number(it.unitPrice) || 0), 0);
  const reqItemsValid = reqItems.every(it => it.description.trim() && it.category.trim() && Number(it.unitPrice) > 0);
  const updateReqItem = (idx: number, field: keyof ReqItem, val: string) =>
    setReqItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  const addReqItem = () => setReqItems(prev => [...prev, blankItem()]);
  const removeReqItem = (idx: number) => setReqItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev);
  const resetRequisitionForm = () => { setReqHeader({ payee: "", currency: "USD", notes: "", neededByDate: "", raisedDate: new Date().toISOString().slice(0, 10), requestedByUserId: authUser?.id || "", funeralCaseId: "" }); setReqItems([blankItem()]); };
  const openApproveDialog = (r: any, action: "approve" | "reject") => {
    setApproveTarget(r);
    setApproveAction(action);
    setApproveNotes("");
    setAdjustedAmount(String(Number(r.amount).toFixed(2)));
  };

  const createRequisitionMutation = useMutation({
    mutationFn: async (submit: boolean) => {
      const items = reqItems.map(it => ({
        description: it.description.trim(),
        category: it.category.trim(),
        qty: Number(it.qty) || 1,
        unitPrice: Number(it.unitPrice) || 0,
      }));
      const res = await apiRequest("POST", "/api/requisitions", {
        ...reqHeader,
        raisedDate: reqHeader.raisedDate || new Date().toISOString().slice(0, 10),
        neededByDate: reqHeader.neededByDate || null,
        // Legacy fields derived from first item as fallback
        category: items[0]?.category || "",
        description: items.length === 1 ? items[0].description : `${items.length} items`,
        amount: reqTotal.toFixed(2),
        items,
        submit,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      setShowRequisitionDialog(false);
      resetRequisitionForm();
      toast({ title: "Requisition created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const requisitionActionMutation = useMutation({
    mutationFn: async ({ id, action, extra }: { id: string; action: string; extra?: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/requisitions/${id}`, { action, ...(extra || {}) });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      toast({ title: "Requisition updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [correctPaidDateTarget, setCorrectPaidDateTarget] = useState<any | null>(null);
  const [correctPaidDateValue, setCorrectPaidDateValue] = useState("");
  const [correctPaidDateReason, setCorrectPaidDateReason] = useState("");
  const correctPaidDateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/requisitions/${correctPaidDateTarget.id}`, { action: "correct-paid-date", paidDate: correctPaidDateValue, reason: correctPaidDateReason.trim() || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      queryClient.invalidateQueries({ queryKey: QK_APPROVALS });
      setCorrectPaidDateTarget(null);
      setCorrectPaidDateReason("");
      toast({ title: "Submitted for approval", description: "A manager needs to approve this before it applies." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [correctPaidCurrencyTarget, setCorrectPaidCurrencyTarget] = useState<any | null>(null);
  const [correctPaidCurrencyValue, setCorrectPaidCurrencyValue] = useState("USD");
  const [correctPaidCurrencyReason, setCorrectPaidCurrencyReason] = useState("");
  const correctPaidCurrencyMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/requisitions/${correctPaidCurrencyTarget.id}`, { action: "correct-paid-currency", currency: correctPaidCurrencyValue, reason: correctPaidCurrencyReason.trim() || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      queryClient.invalidateQueries({ queryKey: QK_APPROVALS });
      setCorrectPaidCurrencyTarget(null);
      setCorrectPaidCurrencyReason("");
      toast({ title: "Submitted for approval", description: "A manager needs to approve this before it applies." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const [confirmDeleteRequisition, setConfirmDeleteRequisition] = useState<any | null>(null);
  const deleteRequisitionMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/requisitions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_REQUISITIONS });
      queryClient.invalidateQueries({ queryKey: QK_PAYMENT_DISBURSEMENTS });
      setConfirmDeleteRequisition(null);
      toast({ title: "Requisition deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const [expandedReqId, setExpandedReqId] = useState<string | null>(null);
  const { data: funeralCasesForLinking = [] } = useQuery<any[]>({ queryKey: ["/api/funeral-cases"], enabled: canWriteFinance });
  const funeralCaseOptions: SearchableOption[] = (funeralCasesForLinking as any[])
    .map((c: any) => ({ value: c.id, label: `${c.caseNumber} — ${c.deceasedName}`, hint: c.status || undefined }));

  return (
    <>
    <TabsContent value="requisitions">
      <CardSection
        title="Requisitions"
        description="Raise an expenditure request, route it for approval, then mark it paid. Paid requisitions appear as expenses on the income statement."
        icon={FileText}
        flush
        headerRight={canWriteFinance ? (
          <Button size="sm" onClick={() => setShowRequisitionDialog(true)} data-testid="button-new-requisition">
            <Plus className="h-4 w-4 mr-2" />New Requisition
          </Button>
        ) : undefined}
      >
        {requisitions.length === 0 ? (
          <EmptyState title="No requisitions yet" className="border-0 rounded-none bg-transparent py-8" />
        ) : (
          <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
            <TableHeader className={dataTableStickyHeaderClass}>
              <TableRow>
                <TableHead className="w-[110px]">Number</TableHead>
                <TableHead className="w-[130px]">Requester</TableHead>
                <TableHead>Items</TableHead>
                <TableHead className="w-[90px]">Raised</TableHead>
                <TableHead className="w-[90px]">Needed By</TableHead>
                <TableHead className="text-right w-[100px]">Total</TableHead>
                <TableHead className="w-[90px]">Status</TableHead>
                <TableHead className="text-right w-[140px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {requisitions.map((r: any) => {
                const items: any[] = Array.isArray(r.items) ? r.items : [];
                const amountPaid = Number(r.amountPaid ?? 0);
                const outstanding = Number(r.amount) - amountPaid;
                const isExpanded = expandedReqId === r.id;
                return (
                <>
                <TableRow key={r.id} className={`hover:bg-muted/40 align-top cursor-pointer ${isExpanded ? "bg-muted/20" : ""}`} onClick={() => setExpandedReqId(isExpanded ? null : r.id)}>
                  <TableCell className="font-mono text-xs pt-3">
                    <div className="flex items-center gap-1">
                      {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      {r.requisitionNumber}
                    </div>
                  </TableCell>
                  <TableCell className="pt-3">
                    <div className="text-xs font-medium leading-tight">{r.requesterName || "—"}</div>
                    {r.requesterDepartment && <div className="text-[10px] text-muted-foreground">{r.requesterDepartment}</div>}
                    {r.payee && <div className="text-[10px] text-muted-foreground">To: {r.payee}</div>}
                    {r.funeralCaseId && (
                      <div className="text-[10px] text-muted-foreground">
                        Case: {(funeralCasesForLinking as any[]).find((c: any) => c.id === r.funeralCaseId)?.caseNumber || r.funeralCaseId}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    {items.length > 0 ? (
                      <div className="space-y-0.5">
                        {items.map((it: any, idx: number) => (
                          <div key={idx} className="text-xs flex gap-2 items-baseline">
                            <Badge variant="outline" className="text-[10px] shrink-0">{it.category}</Badge>
                            <span className="text-muted-foreground truncate max-w-[160px]" title={it.description}>{it.description}</span>
                            <span className="tabular-nums shrink-0 ml-auto text-muted-foreground">{Number(it.qty)}× {Number(it.unitPrice).toFixed(2)}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs flex gap-2 items-baseline">
                        <Badge variant="outline" className="text-[10px]">{r.category}</Badge>
                        <span className="text-muted-foreground truncate max-w-[200px]" title={r.description}>{r.description}</span>
                      </div>
                    )}
                    {r.approverNotes && <p className="text-[10px] text-muted-foreground mt-0.5 italic">Approver: {r.approverNotes}</p>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground pt-3">{(r.raisedDate || r.createdAt) ? new Date(r.raisedDate || r.createdAt).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs pt-3">
                    {r.neededByDate
                      ? <span className={new Date(r.neededByDate) < new Date() && r.status !== "paid" ? "text-destructive font-medium" : ""}>{new Date(r.neededByDate).toLocaleDateString()}</span>
                      : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="pt-3 text-right">
                    <div className="tabular-nums font-semibold text-xs">{r.currency} {Number(r.amount).toFixed(2)}</div>
                    {r.status === "partial" && (
                      <div className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                        Paid: {r.currency} {amountPaid.toFixed(2)}<br />
                        <span className="text-destructive">Due: {r.currency} {outstanding.toFixed(2)}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="pt-3"><StatusBadge status={r.status} /></TableCell>
                  <TableCell className="text-right pt-3" onClick={(e) => e.stopPropagation()}>
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {r.status === "draft" && canWriteFinance && (
                        <Button size="sm" variant="outline" onClick={() => requisitionActionMutation.mutate({ id: r.id, action: "submit" })} data-testid={`btn-submit-req-${r.id}`}>Submit</Button>
                      )}
                      {r.status === "submitted" && canApproveFinance && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => openApproveDialog(r, "approve")} data-testid={`btn-approve-req-${r.id}`}>Approve</Button>
                          <Button size="sm" variant="ghost" className="text-destructive" onClick={() => openApproveDialog(r, "reject")}>Reject</Button>
                        </>
                      )}
                      {(r.status === "approved" || r.status === "partial") && canWriteFinance && (
                        <Button size="sm" onClick={() => openPayDialog("requisition", r)} data-testid={`btn-pay-req-${r.id}`}>
                          {r.status === "partial" ? "Pay Balance" : "Record Payment"}
                        </Button>
                      )}
                      {r.status === "paid" && <span className="text-xs text-muted-foreground">Paid ✓</span>}
                      {(r.status === "paid" || r.status === "partial") && canBackdatePayment && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          title="Correct the paid date used for financial statements (e.g. it was actually paid on an earlier day)"
                          onClick={() => { setCorrectPaidDateTarget(r); setCorrectPaidDateValue(r.paidDate ? String(r.paidDate).slice(0, 10) : ""); }}
                          data-testid={`btn-correct-paid-date-${r.id}`}
                        >
                          Correct date
                        </Button>
                      )}
                      {(r.status === "paid" || r.status === "partial") && canEditPayment && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          title="Correct the currency it was actually paid in"
                          onClick={() => { setCorrectPaidCurrencyTarget(r); setCorrectPaidCurrencyValue(r.currency || "USD"); }}
                          data-testid={`btn-correct-paid-currency-${r.id}`}
                        >
                          Correct currency
                        </Button>
                      )}
                      {r.status === "rejected" && <span className="text-xs text-muted-foreground">Rejected</span>}
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Print requisition" onClick={(e) => { e.stopPropagation(); window.open(`/api/requisitions/${r.id}/pdf`, "_blank"); }}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      {canDeleteRequisition && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete requisition" onClick={(e) => { e.stopPropagation(); setConfirmDeleteRequisition(r); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
                {isExpanded && (
                  <TableRow key={`${r.id}-detail`} className="hover:bg-transparent">
                    <TableCell colSpan={8} className="px-4 pb-4 pt-0 bg-muted/10">
                      <RequisitionPaymentHistory requisitionId={r.id} currency={r.currency} />
                    </TableCell>
                  </TableRow>
                )}
                </>
              )})}
            </TableBody>
          </DataTable>
        )}
      </CardSection>
    </TabsContent>

      <Dialog open={showRequisitionDialog} onOpenChange={(open) => { setShowRequisitionDialog(open); if (!open) resetRequisitionForm(); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Requisition</DialogTitle>
          </DialogHeader>

          {/* Header fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs" htmlFor="requested-by">Requested By</Label>
              <Select value={reqHeader.requestedByUserId || (authUser?.id ?? "")}
                onValueChange={(v) => setReqHeader({ ...reqHeader, requestedByUserId: v })}>
                <SelectTrigger id="requested-by" className="text-sm"><SelectValue placeholder="Who is requesting?" /></SelectTrigger>
                <SelectContent>
                  {(staffUsers as any[]).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}{u.id === authUser?.id ? " (you)" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Payee</Label>
              <Input value={reqHeader.payee} onChange={(e) => setReqHeader({ ...reqHeader, payee: e.target.value })} placeholder="Who will be paid? (if not a system user, type their name)" />
            </div>
            <div>
              <Label className="text-xs">Funeral Case (optional)</Label>
              <SearchableSelect
                options={funeralCaseOptions}
                value={reqHeader.funeralCaseId}
                onChange={(v) => setReqHeader({ ...reqHeader, funeralCaseId: v === "__none__" ? "" : v })}
                placeholder="Search by case number or deceased name…"
                searchPlaceholder="Search…"
              />
            </div>
            <div>
              <Label className="text-xs">Currency</Label>
              <CurrencySelect value={reqHeader.currency} onValueChange={(v) => setReqHeader({ ...reqHeader, currency: v })} />
            </div>
            <div>
              <Label className="text-xs">Date Raised *</Label>
              <Input type="date" value={reqHeader.raisedDate} onChange={(e) => setReqHeader({ ...reqHeader, raisedDate: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="req-header-needed-by-date">Date Funds Needed *</Label>
              <Input id="req-header-needed-by-date" type="date" value={reqHeader.neededByDate} onChange={(e) => setReqHeader({ ...reqHeader, neededByDate: e.target.value })} />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Line Items *</Label>
              <Button type="button" size="sm" variant="outline" onClick={addReqItem}>
                <Plus className="h-3 w-3 mr-1" />Add Item
              </Button>
            </div>
            <div className="border rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-1.5 font-medium w-[28%]">Description *</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[22%]">Category *</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[12%]">Qty</th>
                    <th className="text-left px-2 py-1.5 font-medium w-[20%]">Unit Price *</th>
                    <th className="text-right px-2 py-1.5 font-medium w-[14%]">Subtotal</th>
                    <th className="w-[4%]" />
                  </tr>
                </thead>
                <tbody>
                  {reqItems.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder="What is this?"
                          value={item.description}
                          onChange={(e) => updateReqItem(idx, "description", e.target.value)}
                          data-testid={idx === 0 ? "input-req-description" : undefined}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          placeholder="e.g. Fuel"
                          value={item.category}
                          onChange={(e) => updateReqItem(idx, "category", e.target.value)}
                          data-testid={idx === 0 ? "input-req-category" : undefined}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={item.qty}
                          onChange={(e) => updateReqItem(idx, "qty", e.target.value)}
                        />
                      </td>
                      <td className="px-1 py-1">
                        <Input
                          className="h-7 text-xs"
                          type="number"
                          min="0"
                          step="0.01"
                          placeholder="0.00"
                          value={item.unitPrice}
                          onChange={(e) => updateReqItem(idx, "unitPrice", e.target.value)}
                          data-testid={idx === 0 ? "input-req-amount" : undefined}
                        />
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">
                        {((Number(item.qty) || 0) * (Number(item.unitPrice) || 0)).toFixed(2)}
                      </td>
                      <td className="px-1 py-1 text-center">
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          onClick={() => removeReqItem(idx)}
                          disabled={reqItems.length === 1}
                          title="Remove item"
                          aria-label="Remove item"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t bg-muted/30">
                    <td colSpan={4} className="px-2 py-1.5 text-right text-xs font-medium">Total</td>
                    <td className="px-2 py-1.5 text-right tabular-nums font-bold text-sm">{reqHeader.currency} {reqTotal.toFixed(2)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div>
            <Label className="text-xs" htmlFor="req-header-notes">Notes</Label>
            <Input id="req-header-notes" value={reqHeader.notes} onChange={(e) => setReqHeader({ ...reqHeader, notes: e.target.value })} placeholder="Any additional notes…" />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => createRequisitionMutation.mutate(false)} disabled={createRequisitionMutation.isPending || !reqItemsValid || reqTotal <= 0}>Save Draft</Button>
            <Button onClick={() => createRequisitionMutation.mutate(true)} disabled={createRequisitionMutation.isPending || !reqItemsValid || reqTotal <= 0 || !reqHeader.neededByDate} data-testid="button-submit-requisition">
              {createRequisitionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Submit for Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve / Reject dialog */}
      <Dialog open={!!approveTarget} onOpenChange={(open) => { if (!open) setApproveTarget(null); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{approveAction === "approve" ? "Approve Requisition" : "Reject Requisition"}</DialogTitle>
          </DialogHeader>
          {approveTarget && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 space-y-2 bg-muted/30 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ref</span>
                  <span className="font-mono font-medium">{approveTarget.requisitionNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requested by</span>
                  <span>{approveTarget.requesterName}{approveTarget.requesterDepartment ? ` · ${approveTarget.requesterDepartment}` : ""}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Date raised</span>
                  <span>{approveTarget.createdAt ? new Date(approveTarget.createdAt).toLocaleDateString() : "—"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Funds needed by</span>
                  <span className={approveTarget.neededByDate && new Date(approveTarget.neededByDate) < new Date() ? "text-destructive font-medium" : ""}>
                    {approveTarget.neededByDate ? new Date(approveTarget.neededByDate).toLocaleDateString() : "—"}
                  </span>
                </div>
                {approveTarget.payee && <div className="flex justify-between"><span className="text-muted-foreground">Payee</span><span>{approveTarget.payee}</span></div>}
                <div className="border-t pt-2">
                  {(Array.isArray(approveTarget.items) && approveTarget.items.length > 0
                    ? approveTarget.items
                    : [{ category: approveTarget.category, description: approveTarget.description, qty: 1, unitPrice: approveTarget.amount, total: approveTarget.amount }]
                  ).map((it: any, idx: number) => (
                    <div key={idx} className="flex gap-2 text-xs py-0.5">
                      <Badge variant="outline" className="text-[10px]">{it.category}</Badge>
                      <span className="flex-1 truncate">{it.description}</span>
                      <span className="tabular-nums shrink-0">{Number(it.qty)}× {Number(it.unitPrice).toFixed(2)} = {Number(it.total ?? (Number(it.qty) * Number(it.unitPrice))).toFixed(2)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold text-sm pt-1 border-t mt-1">
                    <span>Requested total</span>
                    <span>{approveTarget.currency} {Number(approveTarget.amount).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {approveAction === "approve" && (
                <div>
                  <Label className="text-xs">Adjusted Amount (leave unchanged to approve as-is)</Label>
                  <Input type="number" step="0.01" min="0" value={adjustedAmount} onChange={(e) => setAdjustedAmount(e.target.value)} />
                </div>
              )}

              <div>
                <Label className="text-xs">{approveAction === "approve" ? "Notes (optional)" : "Reason for rejection *"}</Label>
                <Input
                  value={approveNotes}
                  onChange={(e) => setApproveNotes(e.target.value)}
                  placeholder={approveAction === "approve" ? "Any notes for the requester…" : "Why is this being rejected?"}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setApproveTarget(null)}>Cancel</Button>
            <Button
              variant={approveAction === "reject" ? "destructive" : "default"}
              disabled={requisitionActionMutation.isPending || (approveAction === "reject" && !approveNotes.trim())}
              onClick={() => {
                if (!approveTarget) return;
                const extra: any = {};
                if (approveAction === "approve") {
                  const adj = Number(adjustedAmount);
                  if (!isNaN(adj) && adj > 0 && adj !== Number(approveTarget.amount)) extra.adjustedAmount = adj;
                  if (approveNotes.trim()) extra.approverNotes = approveNotes.trim();
                } else {
                  extra.rejectionReason = approveNotes.trim() || "Rejected";
                }
                requisitionActionMutation.mutate({ id: approveTarget.id, action: approveAction, extra });
                setApproveTarget(null);
              }}
            >
              {requisitionActionMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {approveAction === "approve" ? "Approve" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDeleteRequisition} onOpenChange={(v) => !v && setConfirmDeleteRequisition(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete requisition?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete requisition <strong>{confirmDeleteRequisition?.requisitionNumber}</strong> and any
              disbursement recorded against it (currently {confirmDeleteRequisition?.currency}{" "}
              {Number(confirmDeleteRequisition?.amount ?? 0).toFixed(2)}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteRequisitionMutation.mutate(confirmDeleteRequisition.id)}
              disabled={deleteRequisitionMutation.isPending}
            >
              {deleteRequisitionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!correctPaidDateTarget} onOpenChange={(v) => !v && setCorrectPaidDateTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Correct Paid Date</DialogTitle>
            <DialogDescription>
              Requests a correction to the value date used for financial statements for requisition{" "}
              <strong>{correctPaidDateTarget?.requisitionNumber}</strong> — use this when the cash actually left on a
              different day than the system recorded it (e.g. paid yesterday, only entered/approved today). This does
              not change who paid it or when the approval happened. A manager must approve this before it applies.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs" htmlFor="correct-paid-date-value">Actual paid date</Label>
            <Input id="correct-paid-date-value" type="date" value={correctPaidDateValue} onChange={(e) => setCorrectPaidDateValue(e.target.value)} data-testid="input-correct-paid-date" />
          </div>
          <div>
            <Label className="text-xs" htmlFor="correct-paid-date-reason">Reason (optional)</Label>
            <Textarea id="correct-paid-date-reason" value={correctPaidDateReason} onChange={(e) => setCorrectPaidDateReason(e.target.value)} rows={2} placeholder="Why this needs correcting…" data-testid="input-correct-paid-date-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectPaidDateTarget(null)}>Cancel</Button>
            <Button
              onClick={() => correctPaidDateMutation.mutate()}
              disabled={!correctPaidDateValue || correctPaidDateMutation.isPending}
              data-testid="button-confirm-correct-paid-date"
            >
              {correctPaidDateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!correctPaidCurrencyTarget} onOpenChange={(v) => !v && setCorrectPaidCurrencyTarget(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Correct Paid Currency</DialogTitle>
            <DialogDescription>
              Flags that requisition <strong>{correctPaidCurrencyTarget?.requisitionNumber}</strong> was actually paid
              in a different currency than entered — e.g. requisitioned in USD but settled with Rand cash on hand.
              The requisition itself stays in its original currency; only what actually left the till changes. The
              equivalent amount is calculated automatically from the currently configured exchange rate. A manager
              must approve this before it applies.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label className="text-xs">Actual currency paid</Label>
            <CurrencySelect value={correctPaidCurrencyValue} onValueChange={setCorrectPaidCurrencyValue} />
          </div>
          <div>
            <Label className="text-xs" htmlFor="correct-paid-currency-reason">Reason (optional)</Label>
            <Textarea id="correct-paid-currency-reason" value={correctPaidCurrencyReason} onChange={(e) => setCorrectPaidCurrencyReason(e.target.value)} rows={2} placeholder="Why this needs correcting…" data-testid="input-correct-paid-currency-reason" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCorrectPaidCurrencyTarget(null)}>Cancel</Button>
            <Button
              onClick={() => correctPaidCurrencyMutation.mutate()}
              disabled={!correctPaidCurrencyValue || correctPaidCurrencyMutation.isPending}
              data-testid="button-confirm-correct-paid-currency"
            >
              {correctPaidCurrencyMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Submit for approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
