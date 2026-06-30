import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import {
  Plus, Search, Pencil, Layers, FileStack, Loader2, LinkIcon, UserPlus,
  Receipt, Printer, ArrowRight, ChevronDown, ChevronRight, Clock,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────

interface Group {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  description: string | null;
  chairpersonName: string | null;
  chairpersonPhone: string | null;
  chairpersonEmail: string | null;
  secretaryName: string | null;
  secretaryPhone: string | null;
  secretaryEmail: string | null;
  treasurerName: string | null;
  treasurerPhone: string | null;
  treasurerEmail: string | null;
  companyName: string | null;
  hrManagerName: string | null;
  hrManagerPhone: string | null;
  hrManagerEmail: string | null;
  contactPersonName: string | null;
  contactPersonPhone: string | null;
  contactPersonEmail: string | null;
  capacity: number | null;
  isActive: boolean;
  isLegacy: boolean;
  createdAt: string;
}

interface GroupFormData {
  name: string;
  type: string;
  description: string;
  isLegacy: boolean;
  chairpersonName: string;
  chairpersonPhone: string;
  chairpersonEmail: string;
  secretaryName: string;
  secretaryPhone: string;
  secretaryEmail: string;
  treasurerName: string;
  treasurerPhone: string;
  treasurerEmail: string;
  companyName: string;
  hrManagerName: string;
  hrManagerPhone: string;
  hrManagerEmail: string;
  contactPersonName: string;
  contactPersonPhone: string;
  contactPersonEmail: string;
  capacity: string;
}

const emptyForm: GroupFormData = {
  name: "", type: "community", description: "", isLegacy: false,
  chairpersonName: "", chairpersonPhone: "", chairpersonEmail: "",
  secretaryName: "", secretaryPhone: "", secretaryEmail: "",
  treasurerName: "", treasurerPhone: "", treasurerEmail: "",
  companyName: "", hrManagerName: "", hrManagerPhone: "", hrManagerEmail: "",
  contactPersonName: "", contactPersonPhone: "", contactPersonEmail: "",
  capacity: "",
};

const GROUP_TYPES = [
  { value: "community", label: "Community" },
  { value: "corporate", label: "Corporate" },
  { value: "church", label: "Church" },
  { value: "cooperative", label: "Cooperative" },
  { value: "other", label: "Other" },
];

// ─── Combined Group Receipt Print ───────────────────────────

function GroupReceiptPrintView({ receipts, group, onClose }: { receipts: any[]; group: Group; onClose: () => void }) {
  const printRef = useRef<HTMLDivElement>(null);
  const grouped = receipts.reduce<Record<string, any[]>>((acc, r) => {
    const ref = (r.metadata_json as any)?.groupRef || "session";
    acc[ref] = acc[ref] || [];
    acc[ref].push(r);
    return acc;
  }, {});
  const sessions = Object.entries(grouped).sort((a, b) => {
    const da = new Date((a[1][0] as any).created_at).getTime();
    const db = new Date((b[1][0] as any).created_at).getTime();
    return db - da;
  });

  const handlePrint = () => window.print();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="font-semibold text-lg">{group.name} — Group Receipt Summary</p>
          <p className="text-sm text-muted-foreground">All receipt sessions for this group</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handlePrint} className="gap-2 print:hidden">
            <Printer className="h-4 w-4" /> Print
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose} className="print:hidden">Close</Button>
        </div>
      </div>

      <div ref={printRef} className="space-y-6">
        {sessions.map(([ref, rows]) => {
          const sessionTotal = rows.reduce((s: number, r: any) => s + parseFloat(r.amount || 0), 0);
          const sessionDate = new Date((rows[0] as any).created_at).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
          const note = (rows[0] as any).submitter_note;
          return (
            <div key={ref} className="border rounded-lg overflow-hidden">
              <div className="bg-primary/10 px-4 py-2 flex items-center justify-between">
                <div>
                  <p className="font-semibold text-sm">{sessionDate}</p>
                  <p className="text-xs text-muted-foreground font-mono">{ref}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{rows[0]?.currency} {sessionTotal.toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground">{rows.length} member{rows.length !== 1 ? "s" : ""}</p>
                </div>
              </div>
              {note && (
                <div className="px-4 py-2 bg-muted/30 text-xs text-muted-foreground border-b">
                  Note: {note}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Member</TableHead>
                    <TableHead>Policy #</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Receipt #</TableHead>
                    <TableHead className="pr-4">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4 text-sm">{r.first_name} {r.last_name}</TableCell>
                      <TableCell className="font-mono text-sm">{r.policy_number}</TableCell>
                      <TableCell className="text-sm font-medium">{r.currency} {parseFloat(r.amount).toFixed(2)}</TableCell>
                      <TableCell className="font-mono text-sm">{r.receipt_number}</TableCell>
                      <TableCell className="pr-4">
                        <Badge variant={r.approval_status === "pending" ? "outline" : r.approval_status === "rejected" ? "destructive" : "default"} className="text-xs">
                          {r.approval_status || "issued"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })}
        {sessions.length === 0 && (
          <p className="text-sm text-muted-foreground py-4 text-center">No receipts recorded for this group yet.</p>
        )}
      </div>
    </div>
  );
}

// ─── Inline Group Receipt Form ──────────────────────────────

function InlineGroupReceiptForm({ group, onSuccess }: { group: Group; onSuccess: (receipts: any[]) => void }) {
  const { toast } = useToast();
  const [policyIds, setPolicyIds] = useState<Set<string>>(new Set());
  const [totalAmount, setTotalAmount] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [submitterNote, setSubmitterNote] = useState("");
  const [polling, setPolling] = useState(false);
  const [paynowIntentId, setPaynowIntentId] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);
  const isBackdated = receiptDate < today;

  const { data: paynowConfig } = useQuery<{ enabled: boolean }>({ queryKey: ["/api/paynow-config"], retry: false });
  const { data: groupPolicies = [], isLoading: loadingPolicies } = useQuery<any[]>({
    queryKey: ["/api/groups", group.id, "policies"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/groups/${group.id}/policies`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const togglePolicy = (id: string) =>
    setPolicyIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/group-receipt", {
        groupId: group.id,
        policyIds: Array.from(policyIds),
        totalAmount: parseFloat(totalAmount),
        currency: "USD",
        receiptDate,
        notes: notes.trim() || undefined,
        submitterNote: isBackdated ? submitterNote.trim() : undefined,
      });
      return res.json() as Promise<{ receipted: number; results: any[]; pendingApproval?: boolean }>;
    },
    onSuccess: (data) => {
      setPolicyIds(new Set());
      setTotalAmount("");
      setReceiptDate(today);
      setNotes("");
      setSubmitterNote("");
      if (data.pendingApproval) {
        toast({ title: "Submitted for approval", description: "Backdated receipt queued for manager review." });
      } else {
        toast({ title: `${data.receipted} policy receipts issued` });
        onSuccess(data.results || []);
      }
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const paynowMutation = useMutation({
    mutationFn: async () => {
      const createRes = await apiRequest("POST", "/api/group-payment-intents", {
        groupId: group.id, policyIds: Array.from(policyIds), totalAmount: parseFloat(totalAmount), currency: "USD",
      });
      const { id: intentId } = await createRes.json() as { id: string };
      const initRes = await apiRequest("POST", `/api/group-payment-intents/${intentId}/initiate`, { method: "visa_mastercard" });
      const initJson = await initRes.json() as { redirectUrl?: string };
      return { intentId, redirectUrl: initJson.redirectUrl };
    },
    onSuccess: ({ intentId, redirectUrl }) => {
      setPaynowIntentId(intentId);
      if (redirectUrl) window.open(redirectUrl, "_blank");
      setPolling(true);
    },
    onError: (e: Error) => toast({ title: "PayNow error", description: e.message, variant: "destructive" }),
  });

  const pollQuery = useQuery<{ status: string; paid?: boolean } | null>({
    queryKey: ["/api/group-payment-intents", paynowIntentId, "poll"],
    queryFn: async () => {
      if (!paynowIntentId) return null;
      const h: Record<string, string> = {};
      const c = getCsrfToken();
      if (c) h["X-XSRF-TOKEN"] = c;
      const res = await fetch(getApiBase() + `/api/group-payment-intents/${paynowIntentId}/poll`, { method: "POST", headers: h, credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!paynowIntentId && polling,
    refetchInterval: (q) => (q.state.data?.paid || q.state.data?.status === "failed" ? false : 3000),
    refetchIntervalInBackground: true,
  });

  useEffect(() => {
    if (!polling || !pollQuery.data) return;
    if (pollQuery.data.paid) {
      setPolling(false); setPaynowIntentId(null); setPolicyIds(new Set()); setTotalAmount("");
      toast({ title: "Group PayNow payment received" });
      onSuccess([]);
    } else if (pollQuery.data.status === "failed") {
      setPolling(false);
      toast({ title: "Payment failed", variant: "destructive" });
    }
  }, [polling, pollQuery.data, onSuccess, toast]);

  return (
    <div className="space-y-4">
      {loadingPolicies ? (
        <div className="py-4 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : groupPolicies.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No policies in this group yet. Issue a policy first.</p>
      ) : (
        <>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Select members who paid</Label>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-auto py-0.5"
                onClick={() => setPolicyIds(policyIds.size === groupPolicies.length ? new Set() : new Set(groupPolicies.map((p: any) => p.id)))}>
                {policyIds.size === groupPolicies.length ? "Deselect all" : "Select all"}
              </Button>
            </div>
            <div className="border rounded-md p-2 max-h-56 overflow-auto space-y-1">
              {groupPolicies.map((p: any) => (
                <label key={p.id} className="flex items-start gap-3 cursor-pointer p-2 rounded-md hover:bg-muted/50 transition-colors">
                  <input type="checkbox" checked={policyIds.has(p.id)} onChange={() => togglePolicy(p.id)} className="mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{p.clientFirstName} {p.clientLastName}</span>
                      <span className="font-mono text-xs text-muted-foreground">{p.policyNumber}</span>
                      <Badge variant="outline" className="text-xs">{p.status}</Badge>
                      <span className="text-sm font-semibold ml-auto">{p.currency} {parseFloat(p.premiumAmount).toFixed(2)}</span>
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-sm">
            <div>
              <Label>Total amount</Label>
              <Input type="number" step="0.01" value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)} placeholder="Total collected" />
            </div>
            <div>
              <Label>Receipt date</Label>
              <Input type="date" value={receiptDate} max={today} onChange={(e) => setReceiptDate(e.target.value)} />
            </div>
          </div>

          <div>
            <Label>Notes (optional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any notes about this receipt session..." rows={2} className="text-sm" data-testid="textarea-group-receipt-notes" />
          </div>

          {isBackdated && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-400">Backdated — approval required</p>
              <div className="space-y-1">
                <Label className="text-xs">Notes for approver *</Label>
                <Textarea value={submitterNote} onChange={(e) => setSubmitterNote(e.target.value)}
                  placeholder="Explain why this receipt is backdated..." rows={2} className="text-sm" data-testid="textarea-submitter-note-inline" />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => mutation.mutate()}
              disabled={policyIds.size === 0 || !totalAmount || mutation.isPending || (isBackdated && !submitterNote.trim())}
              data-testid="button-submit-group-receipt-inline"
            >
              {mutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {isBackdated ? `Submit for approval (${policyIds.size})` : `Issue receipts (${policyIds.size} selected)`}
            </Button>
            {!isBackdated && paynowConfig?.enabled && (
              <Button variant="outline" onClick={() => paynowMutation.mutate()}
                disabled={policyIds.size === 0 || !totalAmount || paynowMutation.isPending || polling}>
                {(paynowMutation.isPending || polling) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {polling ? "Waiting for PayNow…" : "Pay via PayNow"}
              </Button>
            )}
          </div>
          {mutation.isError && <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>}
          {polling && <p className="text-sm text-muted-foreground">Complete payment in the opened window.</p>}
        </>
      )}
    </div>
  );
}

// ─── Group Detail Panel ──────────────────────────────────────

function GroupDetailPanel({ group }: { group: Group }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [activeSection, setActiveSection] = useState<"members" | "receipt" | "history">("members");
  const [showLegacyDialog, setShowLegacyDialog] = useState(false);
  const [legacyFirst, setLegacyFirst] = useState("");
  const [legacyLast, setLegacyLast] = useState("");
  const [showReceiptHistory, setShowReceiptHistory] = useState(false);
  const [showPrintView, setShowPrintView] = useState(false);
  const [lastSessionReceipts, setLastSessionReceipts] = useState<any[]>([]);
  const [showCombinedReceipt, setShowCombinedReceipt] = useState(false);
  const [assignPolicyId, setAssignPolicyId] = useState("");
  const [showAssignDialog, setShowAssignDialog] = useState(false);

  const { data: groupPolicies = [], isLoading: loadingPolicies, refetch: refetchPolicies } = useQuery<any[]>({
    queryKey: ["/api/groups", group.id, "policies"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/groups/${group.id}/policies`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: allPolicies = [] } = useQuery<any[]>({ queryKey: ["/api/policies"] });
  const unassigned = (allPolicies as any[]).filter((p: any) => !p.groupId);

  const { data: receiptHistory = [] } = useQuery<any[]>({
    queryKey: ["/api/groups", group.id, "receipts"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/groups/${group.id}/receipts`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: activeSection === "history" || showPrintView,
  });

  const legacyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/clients", { firstName: legacyFirst.trim(), lastName: legacyLast.trim(), legacyGroupId: group.id });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed");
      return data;
    },
    onSuccess: (data) => {
      setShowLegacyDialog(false);
      setLegacyFirst(""); setLegacyLast("");
      toast({ title: "Member captured", description: `${data.firstName} ${data.lastName} created. Redirecting to issue policy…` });
      setTimeout(() => setLocation(`/staff/policies?create=1&clientId=${data.id}&groupId=${group.id}`), 800);
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}`, { groupId: group.id });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", group.id, "policies"] });
      setAssignPolicyId(""); setShowAssignDialog(false);
      toast({ title: "Policy assigned to group" });
      refetchPolicies();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const unassignMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}`, { groupId: null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/groups", group.id, "policies"] });
      refetchPolicies();
      toast({ title: "Policy removed from group" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const handleIssuePolicyClick = () => {
    if (group.isLegacy) {
      setShowLegacyDialog(true);
    } else {
      setLocation(`/staff/policies?create=1&groupId=${group.id}`);
    }
  };

  const handleReceiptSuccess = (results: any[]) => {
    queryClient.invalidateQueries({ queryKey: ["/api/groups", group.id, "receipts"] });
    queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
    if (results.length > 0) {
      setLastSessionReceipts(results);
      setShowCombinedReceipt(true);
    }
  };

  return (
    <div className="border rounded-xl bg-card shadow-sm mt-3">
      {/* Panel header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30 rounded-t-xl">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="h-7 w-7 rounded-md bg-primary/10 flex items-center justify-center">
            <Layers className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold">{group.name}</span>
          <Badge variant="outline" className="capitalize text-xs">{group.type}</Badge>
          {group.isLegacy && <Badge variant="secondary" className="text-xs">Legacy</Badge>}
          {!group.isActive && <Badge variant="destructive" className="text-xs">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={handleIssuePolicyClick}>
            <ArrowRight className="h-3.5 w-3.5" /> Issue Policy
          </Button>
          <Button size="sm" variant="ghost" className="gap-1.5 text-xs" onClick={() => setShowAssignDialog(true)}>
            <LinkIcon className="h-3.5 w-3.5" /> Assign Existing
          </Button>
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex border-b px-4 gap-1">
        {(["members", "receipt", "history"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setActiveSection(s)}
            className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${activeSection === s ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {s === "members" ? `Members (${groupPolicies.length})` : s === "receipt" ? "Issue Receipt" : "Receipt History"}
          </button>
        ))}
      </div>

      {/* Members section */}
      {activeSection === "members" && (
        <div className="p-4">
          {loadingPolicies ? (
            <div className="py-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : groupPolicies.length === 0 ? (
            <EmptyState icon={FileStack} title="No members yet" description={group.isLegacy ? "Use 'Issue Policy' to capture a legacy member and issue their policy." : "Assign or issue a policy to add members to this group."} className="border-0 bg-transparent py-8" />
          ) : (
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead className="pl-0">Member</TableHead>
                  <TableHead>Policy #</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groupPolicies.map((p: any) => (
                  <TableRow key={p.id} data-testid={`row-group-member-${p.id}`}>
                    <TableCell className="pl-0">
                      <div>
                        <p className="font-medium text-sm">{p.clientFirstName || "—"} {p.clientLastName || ""}</p>
                        {p.clientPhone && <p className="text-xs text-muted-foreground">{p.clientPhone}</p>}
                        {p.clientNationalId && <p className="text-xs text-muted-foreground font-mono">ID: {p.clientNationalId}</p>}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-sm">{p.policyNumber}</TableCell>
                    <TableCell className="text-sm">{p.currency} {parseFloat(p.premiumAmount).toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs">{p.status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" className="gap-1.5 text-xs h-7"
                          onClick={() => window.open(getApiBase() + `/api/receipts/${p.id}/view?format=a4`, "_blank")}
                          title="Print latest receipt"
                          data-testid={`btn-print-receipt-${p.id}`}>
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="sm" variant="ghost" className="text-xs h-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => unassignMutation.mutate(p.id)}
                          disabled={unassignMutation.isPending}>
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </DataTable>
          )}
        </div>
      )}

      {/* Receipt section */}
      {activeSection === "receipt" && (
        <div className="p-4">
          {showCombinedReceipt && lastSessionReceipts.length > 0 ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">Receipts issued successfully.</p>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setShowCombinedReceipt(false); setActiveSection("history"); }}>
                  <Printer className="h-3.5 w-3.5" /> View & Print Combined Receipt
                </Button>
              </div>
              <div className="border rounded-lg overflow-hidden">
                <div className="bg-muted/30 px-4 py-2 text-sm font-medium">Receipt Summary</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-4">Member</TableHead>
                      <TableHead>Policy #</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead className="pr-4">Receipt #</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lastSessionReceipts.map((r: any) => {
                      const policy = groupPolicies.find((p: any) => p.id === r.policyId);
                      return (
                        <TableRow key={r.policyId}>
                          <TableCell className="pl-4 text-sm">{policy?.clientFirstName} {policy?.clientLastName}</TableCell>
                          <TableCell className="font-mono text-sm">{r.policyNumber}</TableCell>
                          <TableCell className="text-sm font-medium">{r.currency} {parseFloat(r.amount).toFixed(2)}</TableCell>
                          <TableCell className="pr-4">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm">{r.receiptNumber}</span>
                              <Button size="sm" variant="ghost" className="h-6 w-6 p-0"
                                onClick={() => window.open(getApiBase() + `/api/receipts/${r.receiptNumber}/view`, "_blank")}>
                                <Printer className="h-3 w-3" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setShowCombinedReceipt(false)}>Issue another receipt</Button>
            </div>
          ) : (
            <InlineGroupReceiptForm group={group} onSuccess={handleReceiptSuccess} />
          )}
        </div>
      )}

      {/* Receipt history section */}
      {activeSection === "history" && (
        <div className="p-4">
          <GroupReceiptPrintView receipts={receiptHistory as any[]} group={group} onClose={() => setActiveSection("members")} />
        </div>
      )}

      {/* Legacy member capture dialog */}
      <Dialog open={showLegacyDialog} onOpenChange={setShowLegacyDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Capture Legacy Member — {group.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">Enter the member's name. After capture you'll be taken to issue their policy (already linked to this group).</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>First Name *</Label>
                <Input value={legacyFirst} onChange={(e) => setLegacyFirst(e.target.value)} placeholder="First name" autoFocus data-testid="input-legacy-first" />
              </div>
              <div className="space-y-2">
                <Label>Last Name *</Label>
                <Input value={legacyLast} onChange={(e) => setLegacyLast(e.target.value)} placeholder="Last name" data-testid="input-legacy-last" />
              </div>
            </div>
            {legacyMutation.isError && <p className="text-sm text-destructive">{(legacyMutation.error as Error).message}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLegacyDialog(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!legacyFirst.trim() || !legacyLast.trim()) {
                  toast({ title: "Both names required", variant: "destructive" }); return;
                }
                legacyMutation.mutate();
              }}
              disabled={legacyMutation.isPending}
              data-testid="btn-capture-legacy-member"
            >
              {legacyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Capture & Issue Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign existing policy dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Existing Policy — {group.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>Select Policy</Label>
            <Select value={assignPolicyId} onValueChange={setAssignPolicyId}>
              <SelectTrigger><SelectValue placeholder="Choose a policy…" /></SelectTrigger>
              <SelectContent>
                {unassigned.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.policyNumber} — {p.status} ({p.currency} {parseFloat(p.premiumAmount).toFixed(2)})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unassigned.length === 0 && <p className="text-sm text-muted-foreground">No unassigned policies available.</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)}>Cancel</Button>
            <Button onClick={() => { if (assignPolicyId) assignMutation.mutate(assignPolicyId); }} disabled={!assignPolicyId || assignMutation.isPending}>
              {assignMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────

export default function StaffGroups() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [formData, setFormData] = useState<GroupFormData>(emptyForm);

  const { data: groupsList, isLoading } = useQuery<Group[]>({ queryKey: ["/api/groups"] });

  const createMutation = useMutation({
    mutationFn: async (data: GroupFormData) => {
      const res = await apiRequest("POST", "/api/groups", { ...data, capacity: data.capacity ? parseInt(data.capacity, 10) || null : null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowCreateDialog(false);
      setFormData(emptyForm);
      toast({ title: "Group created" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/groups/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowEditDialog(false);
      toast({ title: "Group updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const filteredGroups = (groupsList || []).filter((g) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return g.name.toLowerCase().includes(q) || g.type.toLowerCase().includes(q) || (g.description || "").toLowerCase().includes(q);
  });

  const openEdit = (group: Group) => {
    setSelectedGroupId(group.id);
    setFormData({
      name: group.name, type: group.type, description: group.description || "",
      isLegacy: group.isLegacy ?? false,
      chairpersonName: group.chairpersonName || "", chairpersonPhone: group.chairpersonPhone || "", chairpersonEmail: group.chairpersonEmail || "",
      secretaryName: group.secretaryName || "", secretaryPhone: group.secretaryPhone || "", secretaryEmail: group.secretaryEmail || "",
      treasurerName: group.treasurerName || "", treasurerPhone: group.treasurerPhone || "", treasurerEmail: group.treasurerEmail || "",
      companyName: group.companyName || "", hrManagerName: group.hrManagerName || "", hrManagerPhone: group.hrManagerPhone || "", hrManagerEmail: group.hrManagerEmail || "",
      contactPersonName: group.contactPersonName || "", contactPersonPhone: group.contactPersonPhone || "", contactPersonEmail: group.contactPersonEmail || "",
      capacity: group.capacity != null ? String(group.capacity) : "",
    });
    setShowEditDialog(true);
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Groups"
          description="Manage group policies. Click a group to view members, issue policies, and process receipts."
          titleDataTestId="text-groups-title"
          actions={(
            <Button className="gap-2 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => { setFormData(emptyForm); setShowCreateDialog(true); }} data-testid="btn-add-group">
              <Plus className="h-4 w-4" /> New Group
            </Button>
          )}
        />

        <CardSection
          title="Group registry"
          description="Click a row to expand and manage that group."
          icon={Layers}
          headerRight={(
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search groups…" className="pl-9 bg-background" value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)} data-testid="input-search-groups" />
            </div>
          )}
          flush
        >
          {isLoading ? (
            <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState dataTestId="text-no-groups" icon={Layers} title={searchQuery ? "No groups match your search" : "No groups yet"}
              description={searchQuery ? "Try a different search term." : "Create your first group to get started."} className="border-0 rounded-none bg-transparent py-10" />
          ) : (
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead className="pl-6 w-8"></TableHead>
                  <TableHead>Group</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Members</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGroups.map((group) => (
                  <>
                    <TableRow
                      key={group.id}
                      className={`hover:bg-muted/30 transition-colors cursor-pointer ${expandedGroupId === group.id ? "bg-muted/20" : ""}`}
                      onClick={() => setExpandedGroupId(expandedGroupId === group.id ? null : group.id)}
                      data-testid={`row-group-${group.id}`}
                    >
                      <TableCell className="pl-6 pr-0 w-8">
                        {expandedGroupId === group.id
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium" data-testid={`text-group-name-${group.id}`}>{group.name}</p>
                          {group.chairpersonName && <p className="text-xs text-muted-foreground">Chair: {group.chairpersonName}</p>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="capitalize text-xs" data-testid={`badge-group-type-${group.id}`}>{group.type}</Badge>
                          {group.isLegacy && <Badge variant="secondary" className="text-xs" data-testid={`badge-group-legacy-${group.id}`}>Legacy</Badge>}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <FileStack className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-sm font-medium" data-testid={`text-group-members-${group.id}`}>—</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={group.isActive ? "default" : "secondary"} data-testid={`badge-group-status-${group.id}`}>
                          {group.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(group)} data-testid={`btn-edit-group-${group.id}`} aria-label="Edit group">
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {expandedGroupId === group.id && (
                      <TableRow key={`${group.id}-detail`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="px-4 pb-4 pt-0">
                          <GroupDetailPanel group={group} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
              </TableBody>
            </DataTable>
          )}
        </CardSection>

        {/* Create dialog */}
        <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Create New Group</DialogTitle></DialogHeader>
            <GroupFormFields formData={formData} setFormData={setFormData} prefix="create" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="btn-cancel-create-group">Cancel</Button>
              <Button onClick={() => createMutation.mutate(formData)} disabled={!formData.name || createMutation.isPending} data-testid="btn-submit-group">
                {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Create Group
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit dialog */}
        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit Group</DialogTitle></DialogHeader>
            <GroupFormFields formData={formData} setFormData={setFormData} prefix="edit" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="btn-cancel-edit-group">Cancel</Button>
              <Button onClick={() => {
                if (!selectedGroupId) return;
                const payload = { ...formData, capacity: formData.capacity ? parseInt(formData.capacity, 10) || null : null };
                updateMutation.mutate({ id: selectedGroupId, data: payload });
              }} disabled={updateMutation.isPending} data-testid="btn-update-group">
                {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageShell>
    </StaffLayout>
  );
}

// ─── Group form fields (shared between create + edit) ────────

function GroupFormFields({ formData, setFormData, prefix }: { formData: GroupFormData; setFormData: (d: GroupFormData) => void; prefix: string }) {
  const update = (field: keyof GroupFormData, value: string) => setFormData({ ...formData, [field]: value });

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Group Details</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Group Name *</Label>
            <Input value={formData.name} onChange={(e) => update("name", e.target.value)} placeholder="e.g. Sunrise Community Group" data-testid={`input-${prefix}-group-name`} />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={formData.type} onValueChange={(val) => update("type", val)}>
              <SelectTrigger data-testid={`select-${prefix}-group-type`}><SelectValue /></SelectTrigger>
              <SelectContent>
                {GROUP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={(e) => update("description", e.target.value)} placeholder="Optional description…" rows={2} data-testid={`input-${prefix}-group-description`} />
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-lg border p-3 bg-muted/30">
          <Switch id={`${prefix}-is-legacy`} checked={formData.isLegacy} onCheckedChange={(c) => setFormData({ ...formData, isLegacy: c })} data-testid={`switch-${prefix}-is-legacy`} />
          <div>
            <Label htmlFor={`${prefix}-is-legacy`} className="font-medium cursor-pointer">Legacy Group</Label>
            <p className="text-xs text-muted-foreground">Members can be captured with name only — no national ID, date of birth, or phone required.</p>
          </div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Chairperson</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Full Name</Label><Input value={formData.chairpersonName} onChange={(e) => update("chairpersonName", e.target.value)} placeholder="Full name" data-testid={`input-${prefix}-chairperson-name`} /></div>
          <div className="space-y-2"><Label>Phone</Label><Input value={formData.chairpersonPhone} onChange={(e) => update("chairpersonPhone", e.target.value)} placeholder="+263 77 123 4567" data-testid={`input-${prefix}-chairperson-phone`} /></div>
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.chairpersonEmail} onChange={(e) => update("chairpersonEmail", e.target.value)} placeholder="email@example.com" data-testid={`input-${prefix}-chairperson-email`} /></div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Secretary</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Full Name</Label><Input value={formData.secretaryName} onChange={(e) => update("secretaryName", e.target.value)} placeholder="Full name" data-testid={`input-${prefix}-secretary-name`} /></div>
          <div className="space-y-2"><Label>Phone</Label><Input value={formData.secretaryPhone} onChange={(e) => update("secretaryPhone", e.target.value)} placeholder="+263 77 123 4567" data-testid={`input-${prefix}-secretary-phone`} /></div>
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.secretaryEmail} onChange={(e) => update("secretaryEmail", e.target.value)} placeholder="email@example.com" data-testid={`input-${prefix}-secretary-email`} /></div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Treasurer</h3>
        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2"><Label>Full Name</Label><Input value={formData.treasurerName} onChange={(e) => update("treasurerName", e.target.value)} placeholder="Full name" data-testid={`input-${prefix}-treasurer-name`} /></div>
          <div className="space-y-2"><Label>Phone</Label><Input value={formData.treasurerPhone} onChange={(e) => update("treasurerPhone", e.target.value)} placeholder="+263 77 123 4567" data-testid={`input-${prefix}-treasurer-phone`} /></div>
          <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.treasurerEmail} onChange={(e) => update("treasurerEmail", e.target.value)} placeholder="email@example.com" data-testid={`input-${prefix}-treasurer-email`} /></div>
        </div>
      </div>

      {formData.type === "corporate" && (
        <div className="border-t pt-4 space-y-4">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Company Details</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Company Name</Label><Input value={formData.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Company name" data-testid={`input-${prefix}-company-name`} /></div>
            <div className="space-y-2"><Label>Capacity</Label><Input type="number" value={formData.capacity} onChange={(e) => update("capacity", e.target.value)} placeholder="Number of members" data-testid={`input-${prefix}-capacity`} /></div>
          </div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">HR Manager</h4>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Full Name</Label><Input value={formData.hrManagerName} onChange={(e) => update("hrManagerName", e.target.value)} placeholder="Full name" data-testid={`input-${prefix}-hr-manager-name`} /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={formData.hrManagerPhone} onChange={(e) => update("hrManagerPhone", e.target.value)} placeholder="+263 77 123 4567" data-testid={`input-${prefix}-hr-manager-phone`} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.hrManagerEmail} onChange={(e) => update("hrManagerEmail", e.target.value)} placeholder="email@example.com" data-testid={`input-${prefix}-hr-manager-email`} /></div>
          </div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider pt-2">Contact Person</h4>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Full Name</Label><Input value={formData.contactPersonName} onChange={(e) => update("contactPersonName", e.target.value)} placeholder="Full name" data-testid={`input-${prefix}-contact-person-name`} /></div>
            <div className="space-y-2"><Label>Phone</Label><Input value={formData.contactPersonPhone} onChange={(e) => update("contactPersonPhone", e.target.value)} placeholder="+263 77 123 4567" data-testid={`input-${prefix}-contact-person-phone`} /></div>
            <div className="space-y-2"><Label>Email</Label><Input type="email" value={formData.contactPersonEmail} onChange={(e) => update("contactPersonEmail", e.target.value)} placeholder="email@example.com" data-testid={`input-${prefix}-contact-person-email`} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
