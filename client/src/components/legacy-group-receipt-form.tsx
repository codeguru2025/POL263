import { useId, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface MemberRow {
  name: string;
  amount: string;
}

/**
 * Legacy group lump-sum receipt — for a group with no member policies yet, where a per-member
 * split isn't possible. Shared between groups.tsx's own receipt tab and finance.tsx's Group
 * Receipt tab (both previously had independent, byte-identical copies of this form hitting the
 * same POST /api/groups/legacy-receipts endpoint).
 */
export function LegacyGroupReceiptForm({ groupId, onSuccess }: { groupId: string; onSuccess: (receipt: any) => void }) {
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
      const memberBreakdown = showBreakdown
        ? members.filter((m) => m.name.trim()).map((m) => ({ name: m.name.trim(), amount: m.amount || "0" }))
        : undefined;
      const res = await apiRequest("POST", "/api/groups/legacy-receipts", {
        groupId, amount: parseFloat(amount), currency, paymentDate, notes: notes.trim() || undefined,
        memberBreakdown,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups/legacy-receipts"] });
      setAmount(""); setNotes(""); setPaymentDate(today); setMembers([{ name: "", amount: "" }]); setShowBreakdown(false);
      toast({ title: "Payment recorded", description: `Receipt ${data.receipt_number} issued` });
      onSuccess(data);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        This group has no member policies yet. Record the lump-sum payment here — it will appear in financials
        immediately. Once members are added and given policies, future payments use the member-selection form below.
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

      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-1 px-2" onClick={() => setShowBreakdown((v) => !v)}>
          {showBreakdown ? "Hide" : "Add"} member breakdown (optional)
        </Button>
      </div>
      {showBreakdown && (
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

      <Button onClick={() => mutation.mutate()} disabled={!amount || parseFloat(amount) <= 0 || mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Record Payment
      </Button>
      {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
    </div>
  );
}
