import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, FileText, Loader2, ChevronLeft, Receipt, Users, CheckCircle2,
  Trash2, Download, Link2, Shield, UserCheck,
} from "lucide-react";

const STANDARD_ITEMS = [
  "Type of Coffin", "Admin Fees", "Removal Fee", "Undertakers Fees",
  "Storage", "Overnight Charge", "Diversion of Route", "Grave Fee",
  "Doctor's Fee", "Embalming", "Tent", "Lowering Device", "Home Tent",
  "Bus", "Handling Fee",
];

const CASKET_OPTIONS = [
  { value: "flat_lid", label: "Flat Lid" },
  { value: "dome", label: "Dome" },
  { value: "mini_dome", label: "Mini Dome" },
  { value: "executive_dome", label: "Executive Dome" },
  { value: "two_tier", label: "2-Tier" },
  { value: "three_tier", label: "3-Tier" },
  { value: "coffin_shaped", label: "Coffin Shaped" },
];

type LineItem = { description: string; qty: string; unitPrice: string };

type QuoteForm = {
  informantFullNames: string;
  informantPhone: string;
  informantAddress: string;
  deceasedName: string;
  deceasedAge: string;
  deceasedSex: string;
  casketType: string;
  quotationDate: string;
  currency: string;
  paymentType: string;
  vatRate: string;
  discountAmount: string;
  notes: string;
};

const BLANK_QUOTE: QuoteForm = {
  informantFullNames: "", informantPhone: "", informantAddress: "",
  deceasedName: "", deceasedAge: "", deceasedSex: "", casketType: "",
  quotationDate: new Date().toISOString().slice(0, 10),
  currency: "USD", paymentType: "full",
  vatRate: "0", discountAmount: "0", notes: "",
};

const BLANK_ITEMS: LineItem[] = STANDARD_ITEMS.map((d) => ({ description: d, qty: "1", unitPrice: "" }));

function computeTotals(items: LineItem[], vatRate: string, discount: string) {
  const subtotal = items.reduce((sum, i) => {
    const qty = parseFloat(i.qty) || 0;
    const price = parseFloat(i.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
  const vat = subtotal * (parseFloat(vatRate) || 0) / 100;
  const disc = parseFloat(discount) || 0;
  const grand = Math.max(0, subtotal + vat - disc);
  return { subtotal, vat, grand };
}

function fmtMoney(n: number, currency = "USD") {
  return `${currency} ${n.toFixed(2)}`;
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); } catch { return v; }
}

function conversionBadge(status: string | undefined) {
  if (status === "converted") return <Badge className="bg-emerald-500/15 text-emerald-700 border-emerald-200">Converted</Badge>;
  if (status === "partial") return <Badge className="bg-blue-500/15 text-blue-700 border-blue-200">Partial Payment</Badge>;
  return <Badge className="bg-amber-500/15 text-amber-700 border-amber-200">Pending</Badge>;
}

function casketLabel(v: string | undefined) {
  const opt = CASKET_OPTIONS.find((o) => o.value === v);
  return opt ? opt.label : v || "—";
}

/* ─── QuoteDialog (new + edit) ─────────────────────────────────── */
export function QuoteDialog({
  open, onClose, initialData, initialItems, quoteId, onSuccess: onSuccessCallback,
}: {
  open: boolean;
  onClose: () => void;
  initialData?: Partial<QuoteForm>;
  initialItems?: LineItem[];
  quoteId?: string;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!quoteId;

  const [form, setForm] = useState<QuoteForm>({ ...BLANK_QUOTE, ...initialData });
  const [items, setItems] = useState<LineItem[]>(initialItems ?? BLANK_ITEMS);

  const set = (k: keyof QuoteForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const totals = computeTotals(items, form.vatRate, form.discountAmount);

  const mutation = useMutation({
    mutationFn: async () => {
      const payload = {
        ...form,
        items: items.filter((i) => i.description).map((i) => ({
          description: i.description,
          quantity: i.qty || "1",
          unitPrice: i.unitPrice || "0",
        })),
      };
      const res = isEdit
        ? await apiRequest("PATCH", `/api/quotations/${quoteId}`, payload)
        : await apiRequest("POST", "/api/quotations", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotations"] });
      if (quoteId) queryClient.invalidateQueries({ queryKey: ["/api/quotations", quoteId] });
      onSuccessCallback?.();
      onClose();
      toast({ title: isEdit ? "Quotation updated" : "Quotation created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addRow = () => setItems((prev) => [...prev, { description: "", qty: "1", unitPrice: "" }]);
  const removeRow = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));
  const updateRow = (i: number, field: keyof LineItem, val: string) =>
    setItems((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Quotation" : "New Quotation"}</DialogTitle>
          <DialogDescription>Fill in client, deceased details, and line items.</DialogDescription>
        </DialogHeader>

        <Accordion type="multiple" defaultValue={["client", "deceased", "items", "payment"]} className="space-y-1">
          {/* ── Client Details ── */}
          <AccordionItem value="client" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-semibold">Client / Informant Details</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <div>
                <Label>Full Names <span className="text-destructive">*</span></Label>
                <Input value={form.informantFullNames} onChange={(e) => set("informantFullNames", e.target.value)} placeholder="First and last name" />
              </div>
              <div>
                <Label>Phone</Label>
                <Input value={form.informantPhone} onChange={(e) => set("informantPhone", e.target.value)} placeholder="+263…" />
              </div>
              <div>
                <Label>Address</Label>
                <Textarea value={form.informantAddress} onChange={(e) => set("informantAddress", e.target.value)} rows={2} />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ── Deceased Details ── */}
          <AccordionItem value="deceased" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-semibold">Deceased Details</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <div>
                <Label>Deceased Name <span className="text-destructive">*</span></Label>
                <Input value={form.deceasedName} onChange={(e) => set("deceasedName", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Age</Label>
                  <Input type="number" min="0" value={form.deceasedAge} onChange={(e) => set("deceasedAge", e.target.value)} />
                </div>
                <div>
                  <Label>Sex</Label>
                  <Select value={form.deceasedSex} onValueChange={(v) => set("deceasedSex", v)}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Casket Type</Label>
                  <Select value={form.casketType} onValueChange={(v) => set("casketType", v)}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      {CASKET_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quotation Date</Label>
                  <Input type="date" value={form.quotationDate} onChange={(e) => set("quotationDate", e.target.value)} />
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ── Line Items ── */}
          <AccordionItem value="items" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-semibold">Line Items</AccordionTrigger>
            <AccordionContent className="pt-2">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-1 pr-2 font-medium text-muted-foreground w-1/2">Description</th>
                      <th className="text-right py-1 pr-2 font-medium text-muted-foreground w-16">Qty</th>
                      <th className="text-right py-1 pr-2 font-medium text-muted-foreground w-28">Unit Price</th>
                      <th className="text-right py-1 pr-2 font-medium text-muted-foreground w-28">Total</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((row, i) => {
                      const lineTotal = (parseFloat(row.qty) || 0) * (parseFloat(row.unitPrice) || 0);
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="py-1 pr-2">
                            <Input className="h-7 text-xs" value={row.description} onChange={(e) => updateRow(i, "description", e.target.value)} />
                          </td>
                          <td className="py-1 pr-2">
                            <Input className="h-7 text-xs text-right w-16" type="number" min="0" value={row.qty} onChange={(e) => updateRow(i, "qty", e.target.value)} />
                          </td>
                          <td className="py-1 pr-2">
                            <Input className="h-7 text-xs text-right" type="number" min="0" step="0.01" value={row.unitPrice} onChange={(e) => updateRow(i, "unitPrice", e.target.value)} />
                          </td>
                          <td className="py-1 pr-2 text-right text-xs text-muted-foreground tabular-nums">
                            {lineTotal.toFixed(2)}
                          </td>
                          <td className="py-1">
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Remove row" onClick={() => removeRow(i)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <Button type="button" variant="outline" size="sm" className="mt-2 gap-1" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add Row
              </Button>

              <div className="mt-4 space-y-2 max-w-xs ml-auto text-sm">
                <div className="flex items-center gap-2">
                  <Label className="w-32 shrink-0">VAT Rate (%)</Label>
                  <Input className="h-7 text-right" type="number" min="0" value={form.vatRate} onChange={(e) => set("vatRate", e.target.value)} />
                </div>
                <div className="flex items-center gap-2">
                  <Label className="w-32 shrink-0">Discount</Label>
                  <Input className="h-7 text-right" type="number" min="0" step="0.01" value={form.discountAmount} onChange={(e) => set("discountAmount", e.target.value)} />
                </div>
                <div className="border-t pt-2 space-y-1">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{fmtMoney(totals.subtotal, form.currency)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>VAT ({form.vatRate}%)</span>
                    <span>{fmtMoney(totals.vat, form.currency)}</span>
                  </div>
                  {parseFloat(form.discountAmount) > 0 && (
                    <div className="flex justify-between text-muted-foreground">
                      <span>Discount</span>
                      <span>- {fmtMoney(parseFloat(form.discountAmount), form.currency)}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-semibold border-t pt-1">
                    <span>Grand Total</span>
                    <span>{fmtMoney(totals.grand, form.currency)}</span>
                  </div>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ── Payment & Terms ── */}
          <AccordionItem value="payment" className="border rounded-lg px-4">
            <AccordionTrigger className="text-sm font-semibold">Payment &amp; Terms</AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Currency</Label>
                  <Select value={form.currency} onValueChange={(v) => set("currency", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="ZAR">ZAR</SelectItem>
                      <SelectItem value="ZiG">ZiG</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Payment Type</Label>
                  <Select value={form.paymentType} onValueChange={(v) => set("paymentType", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="full">Full Payment</SelectItem>
                      <SelectItem value="part">Part Payment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.informantFullNames || !form.deceasedName}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {isEdit ? "Save Changes" : "Create Quotation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── GuarantorDialog ──────────────────────────────────────────── */
function GuarantorDialog({ open, onClose, quoteId }: { open: boolean; onClose: () => void; quoteId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ guarantorName: "", guarantorPhone: "", guarantorAddress: "", guarantorIdNumber: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/quotations/${quoteId}/guarantor`, form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotations", quoteId] });
      onClose();
      toast({ title: "Guarantor saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add / Update Guarantor</DialogTitle>
          <DialogDescription>Guarantor details for part payment arrangement.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div><Label>Full Name</Label><Input value={form.guarantorName} onChange={(e) => set("guarantorName", e.target.value)} /></div>
          <div><Label>Phone</Label><Input value={form.guarantorPhone} onChange={(e) => set("guarantorPhone", e.target.value)} /></div>
          <div><Label>Address</Label><Textarea value={form.guarantorAddress} onChange={(e) => set("guarantorAddress", e.target.value)} rows={2} /></div>
          <div><Label>ID Number</Label><Input value={form.guarantorIdNumber} onChange={(e) => set("guarantorIdNumber", e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Save Guarantor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── CollateralDialog ─────────────────────────────────────────── */
function CollateralDialog({ open, onClose, quoteId }: { open: boolean; onClose: () => void; quoteId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ itemDescription: "", condition: "good", value: "", dueDate: "", forfeitureDate: "" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/quotations/${quoteId}/collateral`, form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotations", quoteId] });
      setForm({ itemDescription: "", condition: "good", value: "", dueDate: "", forfeitureDate: "" });
      onClose();
      toast({ title: "Collateral item added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Collateral Item</DialogTitle>
          <DialogDescription>Item held as security for part payment. Requires authorisation.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Item Description <span className="text-destructive">*</span></Label>
            <Input value={form.itemDescription} onChange={(e) => set("itemDescription", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Condition</Label>
              <Select value={form.condition} onValueChange={(v) => set("condition", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="good">Good</SelectItem>
                  <SelectItem value="fair">Fair</SelectItem>
                  <SelectItem value="poor">Poor</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Value</Label>
              <Input type="number" min="0" step="0.01" value={form.value} onChange={(e) => set("value", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Due Date</Label>
              <Input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} />
            </div>
            <div>
              <Label>Forfeiture Date</Label>
              <Input type="date" value={form.forfeitureDate} onChange={(e) => set("forfeitureDate", e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.itemDescription}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Add Collateral
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── LinkCaseDialog ────────────────────────────────────────────── */
function LinkCaseDialog({ open, onClose, quoteId }: { open: boolean; onClose: () => void; quoteId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [funeralCaseId, setFuneralCaseId] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/quotations/${quoteId}/link-case`, { funeralCaseId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quotations", quoteId] });
      setFuneralCaseId("");
      onClose();
      toast({ title: "Quotation linked to funeral case" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Link to Funeral Case</DialogTitle>
          <DialogDescription>Enter the Funeral Case ID to link this quotation to an existing case.</DialogDescription>
        </DialogHeader>
        <div>
          <Label>Funeral Case ID</Label>
          <Input value={funeralCaseId} onChange={(e) => setFuneralCaseId(e.target.value)} placeholder="UUID or case number" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !funeralCaseId.trim()}>
            {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Link
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── QuotationDetailPanel ─────────────────────────────────────── */
function QuotationDetailPanel({
  quote,
  onBack,
  onEdit,
  onAddGuarantor,
  onAddCollateral,
  onLinkCase,
  onSendAuth,
}: {
  quote: any;
  onBack: () => void;
  onEdit: () => void;
  onAddGuarantor: () => void;
  onAddCollateral: () => void;
  onLinkCase: () => void;
  onSendAuth: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const currency = quote.currency || "USD";

  const deleteCollateralMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/quotations/collateral/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/quotations", quote.id] });
      toast({ title: "Collateral item removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sendAuthMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/quotations/${quote.id}/send-for-authorization`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Sent for authorisation" });
      onSendAuth();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const hasCollateralOrGuarantor = (quote.collateral?.length > 0) || !!quote.guarantor;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <Button variant="ghost" size="sm" className="gap-1" onClick={onBack}>
          <ChevronLeft className="h-4 w-4" /> Back to list
        </Button>
        <div className="flex items-center gap-2 flex-wrap">
          {conversionBadge(quote.conversionStatus)}
          <Button variant="outline" size="sm" className="gap-1" onClick={onEdit}>
            <FileText className="h-4 w-4" /> Edit
          </Button>
          <Button variant="outline" size="sm" className="gap-1" onClick={() => window.open(`/api/quotations/${quote.id}/pdf?download=1`, "_blank")}>
            <Download className="h-4 w-4" /> Download PDF
          </Button>
          {!quote.funeralCaseId && (
            <Button variant="outline" size="sm" className="gap-1" onClick={onLinkCase}>
              <Link2 className="h-4 w-4" /> Link to Case
            </Button>
          )}
          {hasCollateralOrGuarantor && (
            <Button variant="outline" size="sm" className="gap-1" onClick={() => sendAuthMutation.mutate()} disabled={sendAuthMutation.isPending}>
              {sendAuthMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Shield className="h-4 w-4" />}
              Send for Authorisation
            </Button>
          )}
        </div>
      </div>

      {/* Quote number + date */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground">
        <span className="font-semibold text-foreground text-lg">{quote.quotationNumber}</span>
        <span>Date: {fmtDate(quote.quotationDate)}</span>
        {quote.funeralCaseId && (
          <Badge variant="outline" className="gap-1"><Link2 className="h-3 w-3" /> Linked to case</Badge>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Client / Informant */}
        <CardSection title="Client / Informant" icon={Users}>
          <dl className="text-sm space-y-1">
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Name:</dt><dd>{quote.informantFullNames || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Phone:</dt><dd>{quote.informantPhone || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Address:</dt><dd className="whitespace-pre-wrap">{quote.informantAddress || "—"}</dd></div>
          </dl>
        </CardSection>

        {/* Deceased */}
        <CardSection title="Deceased Details" icon={FileText}>
          <dl className="text-sm space-y-1">
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Name:</dt><dd>{quote.deceasedName || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Age:</dt><dd>{quote.deceasedAge ?? "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Sex:</dt><dd className="capitalize">{quote.deceasedSex || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-24 shrink-0">Casket:</dt><dd>{casketLabel(quote.casketType)}</dd></div>
          </dl>
        </CardSection>
      </div>

      {/* Line items */}
      <CardSection title="Quotation Items" icon={Receipt} flush>
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6">Description</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right pr-6">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(quote.items ?? []).length === 0 ? (
              <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No items</TableCell></TableRow>
            ) : (quote.items ?? []).map((item: any, i: number) => (
              <TableRow key={i}>
                <TableCell className="pl-6">{item.description}</TableCell>
                <TableCell className="text-right">{item.quantity}</TableCell>
                <TableCell className="text-right">{fmtMoney(parseFloat(item.unitPrice || "0"), currency)}</TableCell>
                <TableCell className="text-right pr-6">{fmtMoney(parseFloat(item.lineTotal || "0"), currency)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {/* Totals */}
        <div className="flex justify-end border-t p-4">
          <div className="w-64 space-y-1 text-sm">
            <div className="flex justify-between text-muted-foreground">
              <span>Subtotal</span>
              <span>{fmtMoney(parseFloat(quote.subtotal || "0"), currency)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>VAT ({quote.vatRate ?? 0}%)</span>
              <span>{fmtMoney(parseFloat(quote.vatAmount || "0"), currency)}</span>
            </div>
            {parseFloat(quote.discountAmount || "0") > 0 && (
              <div className="flex justify-between text-muted-foreground">
                <span>Discount</span>
                <span>- {fmtMoney(parseFloat(quote.discountAmount), currency)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold border-t pt-1">
              <span>Grand Total</span>
              <span>{fmtMoney(parseFloat(quote.grandTotal || quote.total || "0"), currency)}</span>
            </div>
          </div>
        </div>
      </CardSection>

      {/* Guarantor section */}
      <CardSection
        title="Guarantor"
        icon={UserCheck}
        headerRight={
          <Button variant="outline" size="sm" className="gap-1" onClick={onAddGuarantor}>
            <Plus className="h-3.5 w-3.5" /> {quote.guarantor ? "Update" : "Add"} Guarantor
          </Button>
        }
      >
        {quote.guarantor ? (
          <dl className="text-sm space-y-1 p-4">
            <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Name:</dt><dd>{quote.guarantor.guarantorName || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Phone:</dt><dd>{quote.guarantor.guarantorPhone || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">Address:</dt><dd>{quote.guarantor.guarantorAddress || "—"}</dd></div>
            <div className="flex gap-2"><dt className="text-muted-foreground w-28 shrink-0">ID Number:</dt><dd>{quote.guarantor.guarantorIdNumber || "—"}</dd></div>
          </dl>
        ) : (
          <EmptyState title="No guarantor on record" description='Add a guarantor if this is a part payment arrangement.' className="border-0 bg-transparent py-6" />
        )}
      </CardSection>

      {/* Collateral section */}
      <CardSection
        title="Collateral"
        icon={Shield}
        headerRight={
          <Button variant="outline" size="sm" className="gap-1" onClick={onAddCollateral}>
            <Plus className="h-3.5 w-3.5" /> Add Item
          </Button>
        }
        flush
      >
        {(quote.collateral ?? []).length === 0 ? (
          <EmptyState title="No collateral items" description="Add collateral items that require authorisation." className="border-0 bg-transparent py-6" />
        ) : (
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6">Item</TableHead>
                <TableHead>Condition</TableHead>
                <TableHead className="text-right">Value</TableHead>
                <TableHead>Due Date</TableHead>
                <TableHead>Forfeiture</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {quote.collateral.map((c: any) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-6">{c.itemDescription}</TableCell>
                  <TableCell className="capitalize">{c.condition || "—"}</TableCell>
                  <TableCell className="text-right">{c.value ? fmtMoney(parseFloat(c.value), currency) : "—"}</TableCell>
                  <TableCell>{fmtDate(c.dueDate)}</TableCell>
                  <TableCell>{fmtDate(c.forfeitureDate)}</TableCell>
                  <TableCell>
                    <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Delete collateral" onClick={() => deleteCollateralMutation.mutate(c.id)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardSection>
    </div>
  );
}

/* ─── Main page ─────────────────────────────────────────────────── */
export default function StaffQuotations() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedQuoteId, setSelectedQuoteId] = useState<string | null>(null);
  const [showNewQuote, setShowNewQuote] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [showGuarantor, setShowGuarantor] = useState(false);
  const [showCollateral, setShowCollateral] = useState(false);
  const [showLinkCase, setShowLinkCase] = useState(false);

  const { data: quotes = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/quotations"],
  });

  const { data: selectedQuote } = useQuery<any>({
    queryKey: ["/api/quotations", selectedQuoteId],
    enabled: !!selectedQuoteId,
  });

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const totalCount = quotes.length;
  const pendingCount = quotes.filter((q) => q.conversionStatus === "pending" || !q.conversionStatus).length;
  const convertedThisMonth = quotes.filter((q) => {
    if (q.conversionStatus !== "converted") return false;
    const d = q.convertedAt ? q.convertedAt.slice(0, 7) : "";
    return d === thisMonth;
  }).length;

  const filtered = quotes.filter((q) => {
    const query = search.toLowerCase();
    const matchSearch = !search
      || (q.quotationNumber || "").toLowerCase().includes(query)
      || (q.deceasedName || "").toLowerCase().includes(query)
      || (q.informantFullNames || "").toLowerCase().includes(query);
    const status = q.conversionStatus || "pending";
    const matchStatus = statusFilter === "all" || status === statusFilter;
    return matchSearch && matchStatus;
  });

  const selectedQuoteData = selectedQuote ?? quotes.find((q) => q.id === selectedQuoteId);

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Quotations"
          description="Manage cash service quotations for walk-in clients."
          actions={(
            <Button className="gap-2 shadow-sm" onClick={() => setShowNewQuote(true)}>
              <Plus className="h-4 w-4" /> New Quotation
            </Button>
          )}
        />

        {/* KPI cards */}
        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <KpiStatCard className="bg-primary/5 border-primary/20" label="Total quotations" value={totalCount} hint="All time" icon={FileText} />
          <KpiStatCard label="Pending" value={pendingCount} hint="Awaiting conversion" icon={Receipt} />
          <KpiStatCard label="Converted this month" value={convertedThisMonth} hint="Fully paid" icon={CheckCircle2} />
        </div>

        {selectedQuoteId && selectedQuoteData ? (
          <QuotationDetailPanel
            quote={selectedQuoteData}
            onBack={() => setSelectedQuoteId(null)}
            onEdit={() => setShowEdit(true)}
            onAddGuarantor={() => setShowGuarantor(true)}
            onAddCollateral={() => setShowCollateral(true)}
            onLinkCase={() => setShowLinkCase(true)}
            onSendAuth={() => queryClient.invalidateQueries({ queryKey: ["/api/quotations", selectedQuoteId] })}
          />
        ) : (
          <CardSection
            title="All Quotations"
            icon={FileText}
            flush
            headerRight={(
              <div className="flex items-center gap-2">
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search quotations…"
                    className="pl-9 bg-background"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="partial">Partial</SelectItem>
                    <SelectItem value="converted">Converted</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title="No quotations found"
                description={search || statusFilter !== "all" ? "No quotations match the current filter." : "Create your first quotation using the button above."}
                className="border-0 rounded-none bg-transparent py-10"
              />
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Quote No</TableHead>
                    <TableHead>Deceased</TableHead>
                    <TableHead>Casket</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((q) => (
                    <TableRow
                      key={q.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => setSelectedQuoteId(q.id)}
                    >
                      <TableCell className="pl-6 font-mono text-xs">{q.quotationNumber || "—"}</TableCell>
                      <TableCell>{q.deceasedName || "—"}</TableCell>
                      <TableCell>{casketLabel(q.casketType)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {q.grandTotal ? fmtMoney(parseFloat(q.grandTotal), q.currency || "USD") : "—"}
                      </TableCell>
                      <TableCell>{conversionBadge(q.conversionStatus)}</TableCell>
                      <TableCell className="text-muted-foreground text-xs">{fmtDate(q.quotationDate || q.createdAt)}</TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={(e) => { e.stopPropagation(); setSelectedQuoteId(q.id); }}>
                          View <ChevronLeft className="h-3 w-3 rotate-180" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardSection>
        )}
      </PageShell>

      {/* New quotation dialog */}
      {showNewQuote && (
        <QuoteDialog open={showNewQuote} onClose={() => setShowNewQuote(false)} />
      )}

      {/* Edit quotation dialog */}
      {showEdit && selectedQuoteData && (
        <QuoteDialog
          open={showEdit}
          onClose={() => setShowEdit(false)}
          quoteId={selectedQuoteData.id}
          initialData={{
            informantFullNames: selectedQuoteData.informantFullNames || "",
            informantPhone: selectedQuoteData.informantPhone || "",
            informantAddress: selectedQuoteData.informantAddress || "",
            deceasedName: selectedQuoteData.deceasedName || "",
            deceasedAge: selectedQuoteData.deceasedAge != null ? String(selectedQuoteData.deceasedAge) : "",
            deceasedSex: selectedQuoteData.deceasedSex || "",
            casketType: selectedQuoteData.casketType || "",
            quotationDate: selectedQuoteData.quotationDate ? selectedQuoteData.quotationDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
            currency: selectedQuoteData.currency || "USD",
            paymentType: selectedQuoteData.paymentType || "full",
            vatRate: selectedQuoteData.vatRate != null ? String(selectedQuoteData.vatRate) : "15",
            discountAmount: selectedQuoteData.discountAmount != null ? String(selectedQuoteData.discountAmount) : "0",
            notes: selectedQuoteData.notes || "",
          }}
          initialItems={
            selectedQuoteData.items?.length
              ? selectedQuoteData.items.map((i: any) => ({ description: i.description, qty: String(i.quantity ?? "1"), unitPrice: String(i.unitPrice ?? "") }))
              : BLANK_ITEMS
          }
        />
      )}

      {/* Guarantor dialog */}
      {showGuarantor && selectedQuoteId && (
        <GuarantorDialog open={showGuarantor} onClose={() => setShowGuarantor(false)} quoteId={selectedQuoteId} />
      )}

      {/* Collateral dialog */}
      {showCollateral && selectedQuoteId && (
        <CollateralDialog open={showCollateral} onClose={() => setShowCollateral(false)} quoteId={selectedQuoteId} />
      )}

      {/* Link to case dialog */}
      {showLinkCase && selectedQuoteId && (
        <LinkCaseDialog open={showLinkCase} onClose={() => setShowLinkCase(false)} quoteId={selectedQuoteId} />
      )}
    </StaffLayout>
  );
}
