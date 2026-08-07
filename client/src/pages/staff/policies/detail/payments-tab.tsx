import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { StatusBadge, CardSection } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { CreditCard, Receipt, Pencil, Trash2, Eye, ScrollText, Download, Printer, Share2, Loader2 } from "lucide-react";

interface PaymentsTabProps {
  selectedPolicy: any;
  canEditPayment: boolean;
  canDeletePayment: boolean;
  canEditReceipt: boolean;
  canDeleteReceipt: boolean;
  onOpenReceiptView: (data: { viewOnly: true; receiptId: string; receiptNumber: string }, format: "a4" | "thermal80") => void;
}

export function PaymentsTab({ selectedPolicy, canEditPayment, canDeletePayment, canEditReceipt, canDeleteReceipt, onOpenReceiptView }: PaymentsTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: policyPayments, isLoading: paymentsLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "payments"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/payments`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: policyReceipts } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "receipts"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/receipts`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState({ amount: "", status: "", reference: "", notes: "" });
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string | null>(null);
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  const [editReceiptForm, setEditReceiptForm] = useState({ amount: "", status: "", paymentChannel: "" });
  const [confirmDeleteReceipt, setConfirmDeleteReceipt] = useState<string | null>(null);

  const editPaymentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/payments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditPaymentId(null);
      toast({ title: "Payment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/payments/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setConfirmDeletePayment(null);
      toast({ title: "Payment deleted", description: "Payment transaction permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const editReceiptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setEditReceiptId(null);
      toast({ title: "Receipt updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/receipts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setConfirmDeleteReceipt(null);
      // The backend never deletes immediately — it always queues an approval request
      // (maker-checker) — so the toast must reflect that, not claim the receipt is gone.
      toast({ title: "Deletion request submitted", description: "The receipt is not removed yet — it needs approval from another staff member on the Approvals page." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete request failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <>
      <CardSection title="Payment history" description="Transactions recorded against this policy." icon={CreditCard} flush>
          {paymentsLoading ? (
            <div className="p-6 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (policyPayments ?? []).length > 0 ? (
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                <TableRow>
                  <TableHead className="pl-6">Date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Reference</TableHead>
                  {(canEditPayment || canDeletePayment) && <TableHead className="text-right pr-6">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(policyPayments ?? []).map((p: any) => (
                  <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                    <TableCell className="pl-6 tabular-nums">{p.postedDate || new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                    <TableCell className="font-medium tabular-nums text-right">{p.currency} {Number(p.amount).toFixed(2)}</TableCell>
                    <TableCell>{p.paymentMethod}</TableCell>
                    <TableCell>
                      <StatusBadge
                        status={p.status}
                        variant="payment"
                        label={p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : undefined}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground tabular-nums text-xs">
                      {p.periodFrom && p.periodTo ? (() => {
                        const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
                        const from = fmt(p.periodFrom);
                        const to = fmt(p.periodTo);
                        return from === to ? from : `${from} – ${to}`;
                      })() : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                    {(canEditPayment || canDeletePayment) && (
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1">
                          {canEditPayment && (
                            <Button variant="ghost" size="icon" title="Edit payment" aria-label="Edit payment" data-testid={`btn-edit-payment-${p.id}`} onClick={() => {
                              setEditPaymentId(p.id);
                              setEditPaymentForm({ amount: String(p.amount), status: p.status, reference: p.reference || "", notes: p.notes || "" });
                            }}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDeletePayment && (
                            <Button variant="ghost" size="icon" title="Delete payment" aria-label="Delete payment" data-testid={`btn-delete-payment-${p.id}`} className="text-destructive hover:text-destructive" onClick={() => setConfirmDeletePayment(p.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-center text-muted-foreground" data-testid="text-no-payments">No payments recorded for this policy.</div>
          )}
      </CardSection>

      <CardSection title="Receipts" description="Payment receipts issued for this policy." icon={Receipt} flush>
          {(policyReceipts ?? []).length > 0 ? (
            <Table>
              <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                <TableRow>
                  <TableHead className="pl-6">Receipt #</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Channel</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Issued</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(policyReceipts ?? []).map((r: any) => {
                  const receiptViewUrl = getApiBase() + `/api/receipts/${r.id}/view`;
                  const receiptDownloadUrl = getApiBase() + `/api/receipts/${r.id}/download`;
                  const displayNum = /^\d+$/.test(String(r.receiptNumber).trim())
                    ? `RCP-${String(r.receiptNumber).padStart(5, "0")}`
                    : r.receiptNumber;
                  return (
                    <TableRow key={r.id} data-testid={`row-receipt-${r.id}`}>
                      <TableCell className="pl-6 font-mono font-medium">{displayNum}</TableCell>
                      <TableCell>{r.currency} {Number(r.amount).toFixed(2)}</TableCell>
                      <TableCell className="capitalize">{r.paymentChannel}</TableCell>
                      <TableCell className="text-muted-foreground tabular-nums text-xs">
                        {r.periodFrom && r.periodTo ? (() => {
                          const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
                          const from = fmt(r.periodFrom);
                          const to = fmt(r.periodTo);
                          return from === to ? from : `${from} – ${to}`;
                        })() : "—"}
                      </TableCell>
                      <TableCell>{new Date(r.issuedAt).toLocaleDateString("en-GB")}</TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" title="View receipt" aria-label="View receipt" onClick={() => onOpenReceiptView({ viewOnly: true, receiptId: r.id, receiptNumber: displayNum }, "a4")}><Eye className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" title="Thermal receipt" aria-label="Print thermal receipt" onClick={() => onOpenReceiptView({ viewOnly: true, receiptId: r.id, receiptNumber: displayNum }, "thermal80")}><ScrollText className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" title="Download" aria-label="Download receipt" onClick={() => window.open(receiptDownloadUrl, "_blank", "noopener")}><Download className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" title="Print" aria-label="Print receipt" onClick={() => printDocument(receiptViewUrl)}><Printer className="h-4 w-4" aria-hidden="true" /></Button>
                          <Button variant="ghost" size="icon" title="Share" aria-label="Share receipt" onClick={() => shareDocument(receiptDownloadUrl, `Receipt-${displayNum}`)}><Share2 className="h-4 w-4" aria-hidden="true" /></Button>
                          {canEditReceipt && (
                            <Button variant="ghost" size="icon" title="Edit receipt" aria-label="Edit receipt" data-testid={`btn-edit-receipt-${r.id}`} onClick={() => {
                              setEditReceiptId(r.id);
                              setEditReceiptForm({ amount: String(r.amount), status: r.status || "issued", paymentChannel: r.paymentChannel || "" });
                            }}><Pencil className="h-4 w-4" /></Button>
                          )}
                          {canDeleteReceipt && (
                            <Button variant="ghost" size="icon" title="Delete receipt" aria-label="Delete receipt" data-testid={`btn-delete-receipt-${r.id}`} className="text-destructive hover:text-destructive" onClick={() => setConfirmDeleteReceipt(r.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="p-6 text-center text-muted-foreground">No receipts issued for this policy.</div>
          )}
      </CardSection>

      {/* Superuser: edit payment dialog */}
      <Dialog open={!!editPaymentId} onOpenChange={(open) => { if (!open) setEditPaymentId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Payment Transaction</DialogTitle>
            <DialogDescription>Modify payment details. Changes are audit-logged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs" htmlFor="edit-payment-form-amount">Amount</Label>
              <Input id="edit-payment-form-amount" type="number" step="0.01" value={editPaymentForm.amount} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, amount: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-payment-form-status">Status</Label>
              <Select value={editPaymentForm.status} onValueChange={(v) => setEditPaymentForm({ ...editPaymentForm, status: v })}>
                <SelectTrigger id="edit-payment-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="cleared">Cleared</SelectItem>
                  <SelectItem value="reversed">Reversed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-payment-form-reference">Reference</Label>
              <Input id="edit-payment-form-reference" value={editPaymentForm.reference} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, reference: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-payment-form-notes">Notes</Label>
              <Textarea id="edit-payment-form-notes" value={editPaymentForm.notes} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, notes: e.target.value })} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditPaymentId(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!editPaymentId) return;
              editPaymentMutation.mutate({ id: editPaymentId, data: { amount: editPaymentForm.amount, status: editPaymentForm.status, reference: editPaymentForm.reference || null, notes: editPaymentForm.notes || null } });
            }} disabled={editPaymentMutation.isPending}>
              {editPaymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Superuser: confirm delete payment */}
      <AlertDialog open={!!confirmDeletePayment} onOpenChange={(open) => { if (!open) setConfirmDeletePayment(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Payment Transaction?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this payment transaction and any linked receipts. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDeletePayment) deletePaymentMutation.mutate(confirmDeletePayment); }}
              disabled={deletePaymentMutation.isPending}
            >
              {deletePaymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Superuser: edit receipt dialog */}
      <Dialog open={!!editReceiptId} onOpenChange={(open) => { if (!open) setEditReceiptId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Receipt</DialogTitle>
            <DialogDescription>Modify receipt details. Changes are audit-logged.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label className="text-xs" htmlFor="edit-receipt-form-amount">Amount</Label>
              <Input id="edit-receipt-form-amount" type="number" step="0.01" value={editReceiptForm.amount} onChange={(e) => setEditReceiptForm({ ...editReceiptForm, amount: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-receipt-form-status">Status</Label>
              <Select value={editReceiptForm.status} onValueChange={(v) => setEditReceiptForm({ ...editReceiptForm, status: v })}>
                <SelectTrigger id="edit-receipt-form-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="voided">Voided</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-receipt-form-payment-channel">Payment Channel</Label>
              <Select value={editReceiptForm.paymentChannel} onValueChange={(v) => setEditReceiptForm({ ...editReceiptForm, paymentChannel: v })}>
                <SelectTrigger id="edit-receipt-form-payment-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="paynow_ecocash">EcoCash</SelectItem>
                  <SelectItem value="paynow_card">Card</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditReceiptId(null)}>Cancel</Button>
            <Button onClick={() => {
              if (!editReceiptId) return;
              editReceiptMutation.mutate({ id: editReceiptId, data: { amount: editReceiptForm.amount, status: editReceiptForm.status, paymentChannel: editReceiptForm.paymentChannel } });
            }} disabled={editReceiptMutation.isPending}>
              {editReceiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Superuser: confirm delete receipt */}
      <AlertDialog open={!!confirmDeleteReceipt} onOpenChange={(open) => { if (!open) setConfirmDeleteReceipt(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Request Receipt Deletion?</AlertDialogTitle>
            <AlertDialogDescription>
              This submits a deletion request — it does not delete the receipt immediately. A
              different staff member with approval rights must approve it (you can't approve
              your own request) before the receipt and its linked payment are actually removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (confirmDeleteReceipt) deleteReceiptMutation.mutate(confirmDeleteReceipt); }}
              disabled={deleteReceiptMutation.isPending}
            >
              {deleteReceiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit for Approval
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
