import { useEffect, useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface MemberRow {
  name: string;
  amount: string;
}

/** A member policy of the group, as returned by GET /api/groups/:id/policies. */
export interface LumpSumMember {
  id: string;
  policyNumber: string;
  status?: string | null;
  deletedAt?: unknown;
  clientFirstName?: string | null;
  clientLastName?: string | null;
}

/**
 * Lump-sum receipt for a society / legacy group — it pays in whatever it has saved, not one
 * premium per member. When the group has member policies, the admin ticks who this payment
 * covers (all ticked by default): those members are texted and listed on the receipt; the
 * group's agent earns 10% of the whole payment. A group with no policies yet can list members as free text.
 * Shared between groups.tsx's receipt tab and the finance Group Receipt tab.
 */
export function LegacyGroupReceiptForm({ groupId, onSuccess, intro, members: groupMembers = [] }: {
  groupId: string; onSuccess: (receipt: any) => void; intro?: string; members?: LumpSumMember[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // Defensive: guarantees unique ids even if this ever renders more than once on the same page
  // (matches the existing useId() convention already used by policy-search-input.tsx).
  const uid = useId();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [paymentDate, setPaymentDate] = useState(today);
  const [notes, setNotes] = useState("");
  // Optional member breakdown — this group has no policies yet, so members are free text (a
  // name), not a real client/policy lookup. Purely for the receipt to show who the lump sum
  // covers; not validated against the total.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([{ name: "", amount: "" }]);
  // Same filter as the server (receiptablePolicies): deleted and cancelled policies can't be ticked.
  const tickable = useMemo(
    () => groupMembers.filter((m) => !m.deletedAt && m.status !== "cancelled"),
    [groupMembers],
  );
  const tickableKey = tickable.map((m) => m.id).join(",");
  const [included, setIncluded] = useState<Set<string>>(new Set());
  // Everyone ticked by default; reset when the group or its member list changes.
  useEffect(() => { setIncluded(new Set(tickable.map((m) => m.id))); }, [groupId, tickableKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasMembers = tickable.length > 0;
  const toggleIncluded = (id: string) => setIncluded((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  const addMemberRow = () => setMembers((m) => [...m, { name: "", amount: "" }]);
  const removeMemberRow = (i: number) => setMembers((m) => m.filter((_, idx) => idx !== i));
  const updateMemberRow = (i: number, field: keyof MemberRow, value: string) =>
    setMembers((m) => m.map((row, idx) => (idx === i ? { ...row, [field]: value } : row)));
  const splitEvenly = () => {
    const named = members.filter((m) => m.name.trim());
    if (named.length === 0 || !amount) return;
    const each = (parseFloat(amount) / named.length).toFixed(2);
    setMembers(members.map((m) => (m.name.trim() ? { ...m, amount: each } : m)));
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const memberBreakdown = showBreakdown && !hasMembers
        ? members.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), amount: m.amount || "0" }))
        : undefined;
      const res = await apiRequest("POST", "/api/groups/legacy-receipts", {
        groupId, amount: parseFloat(amount), currency, paymentDate, notes: notes.trim() || undefined,
        memberBreakdown,
        ...(hasMembers ? { includedPolicyIds: Array.from(included) } : {}),
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups/legacy-receipts"] });
      setAmount(""); setNotes(""); setPaymentDate(today); setMembers([{ name: "", amount: "" }]); setShowBreakdown(false);
      setIncluded(new Set(tickable.map((m) => m.id)));
      toast({ title: "Payment recorded", description: `Receipt ${data.receipt_number} issued` });
      onSuccess(data);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {intro ?? "This group has no member policies yet. Record the lump-sum payment here — it will appear in financials immediately. Once members have policies, each payment also texts the members it covers. The group's agent earns 10% of every payment."}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-md">
        <div>
          <Label htmlFor={`${uid}-amount`}>Amount</Label>
          <Input id={`${uid}-amount`} type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label htmlFor={`${uid}-currency`}>Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id={`${uid}-currency`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="ZAR">ZAR</SelectItem>
              <SelectItem value="ZIG">ZIG</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor={`${uid}-date`}>Payment date</Label>
          <Input id={`${uid}-date`} type="date" value={paymentDate} max={today} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>
      </div>
      <div className="max-w-md">
        <Label htmlFor={`${uid}-notes`}>Notes (optional)</Label>
        <Input id={`${uid}-notes`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. July collection" />
      </div>

      {hasMembers && (
        <div className="border rounded-md max-w-md">
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
            <Label className="text-sm">
              Who does this payment cover? <span className="text-muted-foreground font-normal">({included.size} of {tickable.length})</span>
            </Label>
            <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-0.5"
              onClick={() => setIncluded(included.size === tickable.length ? new Set() : new Set(tickable.map((m) => m.id)))}>
              {included.size === tickable.length ? "Untick all" : "Tick all"}
            </Button>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y">
            {tickable.map((m) => (
              <label key={m.id} className="flex items-center gap-3 px-3 py-2 text-sm cursor-pointer hover:bg-muted/30">
                <Checkbox checked={included.has(m.id)} onCheckedChange={() => toggleIncluded(m.id)} />
                <span className="flex-1">{[m.clientFirstName, m.clientLastName].filter(Boolean).join(" ") || "—"}</span>
                <span className="font-mono text-xs text-muted-foreground">{m.policyNumber}</span>
              </label>
            ))}
          </div>
          <p className="px-3 py-2 border-t text-xs text-muted-foreground">
            Ticked members get an SMS and are listed on the receipt. The group's agent earns 10% of the whole payment, whoever is ticked.
          </p>
        </div>
      )}

      {!hasMembers && (
        <div className="flex items-center gap-2">
          <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-1 px-2" onClick={() => setShowBreakdown((v) => !v)}>
            {showBreakdown ? "Hide" : "Add"} member breakdown (optional)
          </Button>
        </div>
      )}
      {showBreakdown && !hasMembers && (
        <div className="border rounded-md p-3 space-y-2 max-w-md">
          <p className="text-xs text-muted-foreground">
            Who does this lump sum cover? Free text — this group has no member policies yet to look up.
          </p>
          {members.map((row, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="flex-1" placeholder="Member name" value={row.name} onChange={(e) => updateMemberRow(i, "name", e.target.value)} />
              <Input className="w-28" type="number" step="0.01" placeholder="Amount" value={row.amount} onChange={(e) => updateMemberRow(i, "amount", e.target.value)} />
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeMemberRow(i)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1 text-xs" onClick={addMemberRow}>
              <Plus className="h-3.5 w-3.5" /> Add member
            </Button>
            <Button type="button" variant="ghost" size="sm" className="text-xs" onClick={splitEvenly} disabled={!amount}>
              Split total evenly
            </Button>
          </div>
        </div>
      )}

      {hasMembers && included.size === 0 && <p className="text-sm text-destructive">Tick at least one member this payment covers.</p>}
      <Button onClick={() => mutation.mutate()} disabled={!amount || parseFloat(amount) <= 0 || (hasMembers && included.size === 0) || mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Record Payment
      </Button>
      {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
    </div>
  );
}
