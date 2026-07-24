import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Legacy group lump-sum receipt — for a group with no member policies yet, where a per-member
 * split isn't possible. Shared between groups.tsx's own receipt tab and finance.tsx's Group
 * Receipt tab (both previously had independent, byte-identical copies of this form hitting the
 * same POST /api/groups/legacy-receipts endpoint).
 */
export function LegacyGroupReceiptForm({ groupId, onSuccess }: { groupId: string; onSuccess: (receipt: any) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [paymentDate, setPaymentDate] = useState(today);
  const [notes, setNotes] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/groups/legacy-receipts", {
        groupId, amount: parseFloat(amount), currency, paymentDate, notes: notes.trim() || undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups/legacy-receipts"] });
      setAmount(""); setNotes(""); setPaymentDate(today);
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
      <div className="grid grid-cols-3 gap-4 max-w-md">
        <div>
          <Label htmlFor="legacy-group-receipt-amount">Amount</Label>
          <Input id="legacy-group-receipt-amount" type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
        </div>
        <div>
          <Label htmlFor="legacy-group-receipt-currency">Currency</Label>
          <Select value={currency} onValueChange={setCurrency}>
            <SelectTrigger id="legacy-group-receipt-currency"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD</SelectItem>
              <SelectItem value="ZAR">ZAR</SelectItem>
              <SelectItem value="ZIG">ZIG</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="legacy-group-receipt-date">Payment date</Label>
          <Input id="legacy-group-receipt-date" type="date" value={paymentDate} max={today} onChange={(e) => setPaymentDate(e.target.value)} />
        </div>
      </div>
      <div className="max-w-md">
        <Label htmlFor="legacy-group-receipt-notes">Notes (optional)</Label>
        <Input id="legacy-group-receipt-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. July collection" />
      </div>
      <Button onClick={() => mutation.mutate()} disabled={!amount || parseFloat(amount) <= 0 || mutation.isPending}>
        {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
        Record Payment
      </Button>
      {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
    </div>
  );
}
