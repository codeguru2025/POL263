import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { LegacyGroupReceiptForm } from "@/components/legacy-group-receipt-form";

export function GroupReceiptForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [groupId, setGroupId] = useState("");
  const [policyIds, setPolicyIds] = useState<Set<string>>(new Set());
  const [totalAmount, setTotalAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [submitterNote, setSubmitterNote] = useState("");
  const [paynowIntentId, setPaynowIntentId] = useState<string | null>(null);
  const [polling, setPolling] = useState(false);
  // Stable per submission attempt — collapses a double-click or retried submit onto one batch
  // instead of posting a duplicate transaction for every selected policy.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const { data: groups = [] } = useQuery<any[]>({ queryKey: ["/api/groups"] });
  const { data: paynowConfig } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/paynow-config"], retry: false });
  const { data: groupPolicies = [] } = useQuery<any[]>({
    queryKey: ["/api/groups", groupId, "policies"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/groups/${groupId}/policies`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!groupId,
  });
  const today = new Date().toISOString().slice(0, 10);
  const isBackdated = receiptDate < today;
  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/group-receipt", {
        groupId,
        policyIds: Array.from(policyIds),
        totalAmount: parseFloat(totalAmount),
        currency: "USD",
        receiptDate,
        notes: notes.trim() || undefined,
        submitterNote: submitterNote.trim() || undefined,
        idempotencyKey,
      });
      return res.json() as Promise<{ receipted: number; pendingApproval?: boolean }>;
    },
    onSuccess: (data) => {
      setPolicyIds(new Set());
      setTotalAmount("");
      setReceiptDate(today);
      setNotes("");
      setSubmitterNote("");
      setIdempotencyKey(crypto.randomUUID());
      if (data.pendingApproval) {
        toast({ title: "Receipt submitted for approval", description: "A backdated receipt has been queued for manager approval before being applied." });
      } else {
        onSuccess();
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const paynowMutation = useMutation({
    mutationFn: async () => {
      const createRes = await apiRequest("POST", "/api/group-payment-intents", {
        groupId,
        policyIds: Array.from(policyIds),
        totalAmount: parseFloat(totalAmount),
        currency: "USD",
      });
      const createJson = await createRes.json() as { id: string };
      const intentId = createJson.id;
      const initRes = await apiRequest("POST", `/api/group-payment-intents/${intentId}/initiate`, { method: "visa_mastercard" });
      const initJson = await initRes.json() as { redirectUrl?: string; pollUrl?: string };
      return { intentId, redirectUrl: initJson.redirectUrl, pollUrl: initJson.pollUrl };
    },
    onSuccess: (data) => {
      setPaynowIntentId(data.intentId);
      if (data.redirectUrl) window.open(data.redirectUrl, "_blank");
      setPolling(true);
    },
    onError: (e: Error) => toast({ title: "PayNow error", description: e.message, variant: "destructive" }),
  });
  const pollQuery = useQuery<{ status: string; paid?: boolean } | null>({
    queryKey: ["/api/group-payment-intents", paynowIntentId, "poll"],
    queryFn: async () => {
      if (!paynowIntentId) return null;
      const pollHeaders: Record<string, string> = {};
      const pollCsrf = getCsrfToken();
      if (pollCsrf) pollHeaders["X-XSRF-TOKEN"] = pollCsrf;
      const res = await fetch(getApiBase() + `/api/group-payment-intents/${paynowIntentId}/poll`, { method: "POST", headers: pollHeaders, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!paynowIntentId && polling,
    refetchInterval: (q) => (q.state.data?.paid === true || q.state.data?.status === "failed" ? false : 3000),
    refetchIntervalInBackground: true,
  });
  useEffect(() => {
    if (!polling || !pollQuery.data) return;
    if (pollQuery.data.paid) {
      setPolling(false);
      setPaynowIntentId(null);
      setPolicyIds(new Set());
      setTotalAmount("");
      toast({ title: "Group PayNow payment received" });
      onSuccess();
    } else if (pollQuery.data.status === "failed") {
      setPolling(false);
      toast({ title: "Payment failed", variant: "destructive" });
    }
  }, [polling, pollQuery.data, onSuccess, toast]);
  const togglePolicy = (id: string) => {
    setPolicyIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const selectedGroup = groups.find((g: any) => g.id === groupId);
  // Legacy groups with no member policies yet are receipted as one lump sum against the
  // group itself (no per-member allocation possible), same as the per-group panel in Groups.
  const isLegacyLumpSum = !!selectedGroup?.isLegacy && groupPolicies.length === 0;

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="group-id">Group</Label>
        <Select value={groupId} onValueChange={(g) => { setGroupId(g); setPolicyIds(new Set()); setPaynowIntentId(null); setPolling(false); }}>
          <SelectTrigger id="group-id" className="max-w-xs"><SelectValue placeholder="Select group" /></SelectTrigger>
          <SelectContent>
            {groups.map((g: any) => <SelectItem key={g.id} value={g.id}>{g.name}{(g as any).isLegacy ? " (Legacy)" : ""}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {groupId && isLegacyLumpSum ? (
        <LegacyGroupReceiptForm groupId={groupId} onSuccess={onSuccess} />
      ) : groupId && (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Members (select who paid)</Label>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-0.5" onClick={() => {
                if (policyIds.size === groupPolicies.length) {
                  setPolicyIds(new Set());
                } else {
                  setPolicyIds(new Set(groupPolicies.map((p: any) => p.id)));
                }
              }}>
                {policyIds.size === groupPolicies.length ? "Deselect all" : "Select all"}
              </Button>
            </div>
            <div className="border rounded-md p-2 max-h-56 overflow-auto space-y-1">
              {groupPolicies.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No policies in this group.</p>
              ) : (
                groupPolicies.map((p: any) => (
                  <label key={p.id} className="flex items-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors">
                    <input type="checkbox" checked={policyIds.has(p.id)} onChange={() => togglePolicy(p.id)} className="mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">{p.clientFirstName || "—"} {p.clientLastName || ""}</span>
                        {!p.clientPhone && !p.clientNationalId && (
                          <Badge variant="secondary" className="text-xs">Legacy</Badge>
                        )}
                        <Badge variant="outline" className="text-xs">{p.status}</Badge>
                        <span className="text-sm font-semibold ml-auto">{p.currency} {parseFloat(p.premiumAmount || 0).toFixed(2)}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-xs text-muted-foreground">{p.policyNumber}</span>
                        {p.clientPhone && <span className="text-xs text-muted-foreground">{p.clientPhone}</span>}
                        {p.clientNationalId && <span className="font-mono text-xs text-muted-foreground">ID: {p.clientNationalId}</span>}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label>Total amount</Label>
              <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="Total to split" />
            </div>
            <div>
              <Label htmlFor="receipt-date-2">Receipt date</Label>
              <Input id="receipt-date-2" type="date" value={receiptDate} max={today} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="notes-2">Receipt notes (optional)</Label>
            <Textarea id="notes-2"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this receipt session — appear on individual member receipts..."
              rows={2}
              className="text-sm"
              data-testid="textarea-group-receipt-notes"
            />
          </div>
          {isBackdated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Backdated receipt — approval required</p>
              <p className="text-xs text-amber-700 dark:text-amber-500">This receipt will be queued for manager approval before being applied to financial statements.</p>
              <div className="space-y-1">
                <Label className="text-xs" htmlFor="submitter-note">Notes for approver *</Label>
                <Textarea id="submitter-note"
                  value={submitterNote}
                  onChange={(e) => setSubmitterNote(e.target.value)}
                  placeholder="Explain why this receipt is being backdated..."
                  rows={2}
                  className="text-sm"
                  data-testid="textarea-submitter-note"
                />
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => mutation.mutate()}
              disabled={policyIds.size === 0 || !totalAmount || mutation.isPending || (isBackdated && !submitterNote.trim())}
              data-testid="button-submit-group-receipt"
            >
              {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {isBackdated ? `Submit for approval (${policyIds.size} policies)` : `Receipt selected (${policyIds.size} policies)`}
            </Button>
            {!isBackdated && paynowConfig?.enabled && (
              <Button variant="outline" onClick={() => paynowMutation.mutate()} disabled={policyIds.size === 0 || !totalAmount || paynowMutation.isPending || polling}>
                {paynowMutation.isPending || polling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {polling ? "Waiting for PayNow…" : "Pay with PayNow"}
              </Button>
            )}
          </div>
          {polling && paynowIntentId && (
            <p className="text-sm text-muted-foreground">Complete payment in the opened window. This page will update when payment is received.</p>
          )}
          {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
        </>
      )}
    </div>
  );
}
