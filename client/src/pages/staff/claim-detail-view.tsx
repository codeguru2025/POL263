import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiFetch, getApiBase } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CardSection, StatusBadge } from "@/components/ds";
import { MemberClaimBadge } from "@/components/member-claim-badge";
import { useToast } from "@/hooks/use-toast";
import { formatAmountWithCode } from "@shared/validation";
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, Clock, FileText, Landmark, Loader2, Pencil, Search,
  ShieldQuestion, User, Users, XCircle, History, Link2,
} from "lucide-react";

/** Everything GET /api/claims/:id/detail returns. */
export interface ClaimDetail {
  claim: any;
  policy: { id: string; policyNumber: string; status: string; currency: string; groupId: string | null; isLegacy?: boolean } | null;
  client: { id: string; firstName: string; lastName: string; phone: string | null; nationalId: string | null } | null;
  member: any | null;
  funeralCase: { id: string; caseNumber: string; status: string } | null;
  quotation: { id: string; quotationNumber: string; currency: string; grandTotal: string | null; total: string | null; status: string } | null;
  group: {
    id: string; name: string; type: string; isLegacy: boolean; hasLedger: boolean;
    balance: Record<string, number>;
    pendingDebit: { amount: number; currency: string } | null;
    debitBlocker: string | null;
  } | null;
  history: { id: string; fromStatus: string | null; toStatus: string; reason: string | null; changedBy: string | null; createdAt: string }[];
  approval: { id: string; status: string; rejectionReason: string | null; resolvedAt: string | null } | null;
  userNames: Record<string, string>;
}

/** Statuses a claim can move to from each status — mirrors VALID_CLAIM_TRANSITIONS in
 *  shared/schema.ts (the server re-checks every transition). */
export const CLAIM_TRANSITIONS: Record<string, string[]> = {
  submitted: ["verified", "under_investigation", "approved", "rejected"],
  verified: ["approved", "under_investigation", "rejected"],
  under_investigation: ["verified", "rejected"],
  approved: ["scheduled", "payable"],
  scheduled: ["completed"],
  payable: ["paid"],
  completed: ["closed"],
  paid: ["closed"],
};

const UNDECIDED = ["submitted", "verified", "under_investigation"];

export const statusLabel = (s: string) =>
  s === "rejected" ? "Declined" : s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());


const money = (amount: number | string | null | undefined, currency: string) =>
  amount === null || amount === undefined || amount === "" ? "—" : formatAmountWithCode(amount as any, currency);

const formatDate = (d: string | null | undefined) => (d ? new Date(d).toLocaleDateString() : "—");
const formatDateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString() : "—");

function parseApprovalNotes(notes: string | null | undefined) {
  if (!notes) return { assessment: "", recommendation: "" };
  const assessmentMatch = notes.match(/^Assessment:\s*([\s\S]*?)(?=\n\nRecommendation:|$)/m);
  const recommendationMatch = notes.match(/Recommendation:\s*([\s\S]*)$/m);
  return {
    assessment: assessmentMatch?.[1]?.trim() || (!recommendationMatch ? notes : ""),
    recommendation: recommendationMatch?.[1]?.trim() || "",
  };
}

const DetailRow = ({ label, value }: { label: string; value?: React.ReactNode }) => (
  <div className="flex justify-between gap-3 py-1 border-b border-border/40 last:border-0">
    <span className="text-muted-foreground text-xs">{label}</span>
    <span className="text-sm font-medium text-right max-w-[60%] break-words">{value === null || value === undefined || value === "" ? "—" : value}</span>
  </div>
);

/** Plain-language "where is this claim and what happens next". */
function nextStep(d: ClaimDetail): { tone: "info" | "warn" | "good" | "bad"; title: string; body: React.ReactNode } {
  const c = d.claim;
  const ledgerNote = d.group?.hasLedger || d.group
    ? ` Approving it deducts the amount from ${d.group!.name}'s ledger.`
    : "";
  switch (c.status) {
    case "submitted":
      return { tone: "info", title: "Waiting for a decision", body: `This claim is in the Approvals queue. An approver can approve it, decline it, or send it for further investigation.${ledgerNote}` };
    case "verified":
      return c.investigationFindings
        ? { tone: "info", title: "Investigation concluded — back for approval", body: <>Findings: <span className="font-medium">{c.investigationFindings}</span>. An approver now needs to approve or decline it.{ledgerNote}</> }
        : { tone: "info", title: "Verified — waiting for approval", body: `The documents have been checked. An approver now needs to approve or decline it.${ledgerNote}` };
    case "under_investigation":
      return {
        tone: "warn", title: "Under investigation",
        body: (
          <div className="space-y-1">
            <p><span className="text-muted-foreground">Being investigated:</span> <span className="font-medium">{c.investigationReason || "—"}</span></p>
            <p><span className="text-muted-foreground">Next steps:</span> <span className="font-medium">{c.investigationNextSteps || "—"}</span></p>
            <p className="text-muted-foreground text-xs">When the investigation is done, record the findings — the claim then goes back to the approvers.</p>
          </div>
        ),
      };
    case "approved":
      return { tone: "good", title: "Approved", body: d.claim.ledgerAmount
        ? `Approved and ${money(d.claim.ledgerAmount, d.group ? Object.keys(d.group.balance)[0] || c.currency : c.currency)} was deducted from ${d.group?.name ?? "the group"}'s ledger. Next: schedule the service or mark it payable.`
        : "Approved. Next: schedule the funeral service, or mark the cash payout as payable." };
    case "scheduled": return { tone: "good", title: "Service scheduled", body: "Mark it completed once the service has been delivered." };
    case "payable": return { tone: "good", title: "Payable", body: "Mark it paid once the payout has been made." };
    case "completed": case "paid": return { tone: "good", title: statusLabel(c.status), body: "Close the claim to finish it." };
    case "closed": return { tone: "good", title: "Closed", body: "This claim is finished." };
    case "rejected": return { tone: "bad", title: "Declined", body: c.decisionReason ? `Reason: ${c.decisionReason}` : "This claim was declined." };
    default: return { tone: "info", title: statusLabel(c.status), body: "" };
  }
}

const STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "review", label: "Review" },
  { key: "decision", label: "Decision" },
  { key: "settlement", label: "Settlement" },
  { key: "closed", label: "Closed" },
];
function stepIndex(status: string) {
  if (status === "submitted") return 0;
  if (["verified", "under_investigation"].includes(status)) return 1;
  if (["approved", "rejected"].includes(status)) return 2;
  if (["scheduled", "payable", "completed", "paid"].includes(status)) return 3;
  return 4;
}

type ActionMode = "approve" | "decline" | "investigate" | "conclude" | "verify" | "status";

export function ClaimDetailView({ claimId, onBack, canApprove, canWrite }: {
  claimId: string;
  onBack: () => void;
  canApprove: boolean;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: d, isLoading, isError, error, refetch } = useQuery<ClaimDetail>({
    queryKey: ["/api/claims", claimId, "detail"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/claims/${claimId}/detail`, { credentials: "include" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message || "Could not load claim");
      return res.json();
    },
  });

  const [mode, setMode] = useState<ActionMode | null>(null);
  const [reason, setReason] = useState("");
  const [targetStatus, setTargetStatus] = useState("");
  const [investigationReason, setInvestigationReason] = useState("");
  const [investigationNextSteps, setInvestigationNextSteps] = useState("");
  const [investigationFindings, setInvestigationFindings] = useState("");
  const [waitingPeriodOverrideReason, setWaitingPeriodOverrideReason] = useState("");
  const [isExGratia, setIsExGratia] = useState(false);
  const [exGratiaReason, setExGratiaReason] = useState("");
  const [needsWaitingOverride, setNeedsWaitingOverride] = useState(false);

  const [showEdit, setShowEdit] = useState(false);
  const [editAmount, setEditAmount] = useState("");
  const [editCurrency, setEditCurrency] = useState("USD");
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteResults, setQuoteResults] = useState<any[] | null>(null);
  const [quoteSearching, setQuoteSearching] = useState(false);
  const [pickedQuote, setPickedQuote] = useState<any>(null);
  const [editMemberId, setEditMemberId] = useState("");
  const [editMembers, setEditMembers] = useState<any[]>([]);

  const openAction = (m: ActionMode, status?: string) => {
    setMode(m);
    setReason("");
    setTargetStatus(status ?? "");
    setInvestigationReason("");
    setInvestigationNextSteps("");
    setInvestigationFindings("");
    setWaitingPeriodOverrideReason("");
    setIsExGratia(false);
    setExGratiaReason("");
    setNeedsWaitingOverride(false);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
    queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
  };

  const transition = useMutation({
    mutationFn: async (body: Record<string, any>) => {
      // apiFetch (not apiRequest) so the error keeps its `code` — waiting_period_violation
      // reveals the override field.
      const res = await apiFetch(`/api/claims/${claimId}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(json.message || "Could not update the claim"), { code: json.code });
      return json;
    },
    onSuccess: (row: any) => {
      invalidate();
      setMode(null);
      const ledger = row?.ledger;
      toast({
        title: `Claim ${statusLabel(row.status).toLowerCase()}`,
        description: ledger
          ? `${formatAmountWithCode(ledger.amount, ledger.currency)} deducted from ${ledger.groupName}'s ledger. New balance: ${formatAmountWithCode(ledger.balanceAfter, ledger.currency)}.`
          : row.status === "verified" && row.investigationFindings ? "Sent back to the approvers." : undefined,
      });
    },
    onError: (err: any) => {
      if (err?.code === "waiting_period_violation") setNeedsWaitingOverride(true);
      toast({ title: "Couldn't update the claim", description: err.message, variant: "destructive" });
    },
  });

  const edit = useMutation({
    mutationFn: async (body: Record<string, any>) => (await apiRequest("PATCH", `/api/claims/${claimId}`, body)).json(),
    onSuccess: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["/api/claims", claimId, "detail"] });
      setShowEdit(false);
      toast({ title: "Claim updated" });
    },
    onError: (err: Error) => toast({ title: "Couldn't update the claim", description: err.message, variant: "destructive" }),
  });

  const searchQuotes = async () => {
    if (!quoteSearch.trim()) return;
    setQuoteSearching(true);
    try {
      const res = await fetch(getApiBase() + `/api/quotations?q=${encodeURIComponent(quoteSearch.trim())}&limit=10`, { credentials: "include" });
      const rows = res.ok ? await res.json() : [];
      setQuoteResults(Array.isArray(rows) ? rows : []);
    } finally {
      setQuoteSearching(false);
    }
  };

  if (isLoading) {
    return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  if (isError || !d) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" onClick={onBack}>← Back</Button>
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          {error instanceof Error ? error.message : "Could not load this claim."}{" "}
          <button className="underline" onClick={() => refetch()}>Try again</button>
        </div>
      </div>
    );
  }

  const c = d.claim;
  const undecided = UNDECIDED.includes(c.status);
  const next = nextStep(d);
  const { assessment, recommendation } = parseApprovalNotes(c.approvalNotes);
  const name = (id: string | null | undefined) => (id ? d.userNames[id] || "Staff member" : "—");
  const settlementTransitions = (CLAIM_TRANSITIONS[c.status] || []).filter((s) => !["approved", "rejected", "under_investigation", "verified"].includes(s));
  const toneClass = {
    info: "border-sky-200 bg-sky-500/5",
    warn: "border-violet-200 bg-violet-500/5",
    good: "border-emerald-200 bg-emerald-500/5",
    bad: "border-rose-200 bg-rose-500/5",
  }[next.tone];
  const ledgerCurrency = d.group?.pendingDebit?.currency || d.quotation?.currency || c.currency;
  const ledgerBalance = d.group ? (d.group.balance[ledgerCurrency] ?? 0) : 0;

  const submitAction = () => {
    if (!mode) return;
    if (mode === "approve") {
      if (isExGratia && !exGratiaReason.trim()) return toast({ title: "Give the ex gratia reason", variant: "destructive" });
      transition.mutate({ toStatus: "approved", reason, isExGratia, exGratiaReason, waitingPeriodOverrideReason: waitingPeriodOverrideReason || undefined });
    } else if (mode === "decline") {
      if (!reason.trim()) return toast({ title: "Give a reason for declining", variant: "destructive" });
      transition.mutate({ toStatus: "rejected", reason });
    } else if (mode === "investigate") {
      if (!investigationReason.trim() || !investigationNextSteps.trim()) return toast({ title: "Fill in what's being investigated and the next steps", variant: "destructive" });
      transition.mutate({ toStatus: "under_investigation", reason, investigationReason, investigationNextSteps });
    } else if (mode === "conclude") {
      if (!investigationFindings.trim()) return toast({ title: "Record the investigation findings", variant: "destructive" });
      transition.mutate({ toStatus: "verified", reason, investigationFindings });
    } else if (mode === "verify") {
      transition.mutate({ toStatus: "verified", reason });
    } else if (mode === "status") {
      if (!targetStatus) return;
      transition.mutate({ toStatus: targetStatus, reason });
    }
  };

  const actionTitle: Record<ActionMode, string> = {
    approve: "Approve claim",
    decline: "Decline claim",
    investigate: "Send for further investigation",
    conclude: "Conclude investigation",
    verify: "Mark as verified",
    status: "Update claim status",
  };

  return (
    <div className="space-y-4" data-testid="claim-detail-view">
      {/* Header — same shape as the funeral case / policy detail views */}
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-claims">← Back</Button>
        <h2 className="text-xl font-bold" data-testid="text-detail-claim-number">{c.claimNumber}</h2>
        <StatusBadge variant="claim" status={c.status} />
        <Badge variant="outline" className="text-[10px] capitalize">{c.claimType?.replace(/_/g, " ")}</Badge>
        {c.isExGratia && <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-700 border-amber-200" data-testid="badge-ex-gratia">Ex Gratia</Badge>}
        {d.group && <Badge variant="outline" className="text-[10px] bg-indigo-500/10 text-indigo-700 border-indigo-200">Paid from {d.group.name} ledger</Badge>}
        {c.isOverdue && (
          <Badge variant="destructive" className="text-[10px] gap-1"><AlertTriangle className="h-3 w-3" /> Open {c.ageDays} days</Badge>
        )}
        <div className="ml-auto flex gap-2 flex-wrap">
          {canWrite && undecided && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
              setEditAmount(c.cashInLieuAmount ?? "");
              setEditCurrency(c.currency || "USD");
              setQuoteSearch(""); setQuoteResults(null); setPickedQuote(null);
              setEditMemberId(c.policyMemberId ?? "");
              setEditMembers([]);
              if (d.policy) {
                fetch(getApiBase() + `/api/policies/${d.policy.id}/members`, { credentials: "include" })
                  .then((r) => (r.ok ? r.json() : []))
                  .then((rows) => setEditMembers(Array.isArray(rows) ? rows : []))
                  .catch(() => setEditMembers([]));
              }
              setShowEdit(true);
            }} data-testid="button-edit-claim">
              <Pencil className="h-3.5 w-3.5" /> Edit claim
            </Button>
          )}
          {canWrite && c.status === "submitted" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAction("verify")} data-testid="button-verify-claim">
              <CheckCircle2 className="h-3.5 w-3.5" /> Mark verified
            </Button>
          )}
          {canApprove && ["submitted", "verified"].includes(c.status) && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openAction("investigate")} data-testid="button-investigate-claim">
              <ShieldQuestion className="h-3.5 w-3.5" /> Investigate
            </Button>
          )}
          {canWrite && c.status === "under_investigation" && (
            <Button size="sm" className="gap-1.5" onClick={() => openAction("conclude")} data-testid="button-conclude-investigation">
              <CheckCircle2 className="h-3.5 w-3.5" /> Conclude investigation
            </Button>
          )}
          {canApprove && undecided && (
            <Button size="sm" variant="outline" className="gap-1.5 text-rose-700 border-rose-200 hover:bg-rose-50" onClick={() => openAction("decline")} data-testid="button-decline-claim">
              <XCircle className="h-3.5 w-3.5" /> Decline
            </Button>
          )}
          {canApprove && ["submitted", "verified"].includes(c.status) && (
            <Button size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => openAction("approve")} disabled={!!d.group?.debitBlocker} title={d.group?.debitBlocker ?? undefined} data-testid="button-approve-claim">
              <CheckCircle2 className="h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {canWrite && settlementTransitions.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => openAction("status", settlementTransitions[0])} data-testid="button-detail-transition">
              <ArrowRightLeft className="h-3.5 w-3.5" /> Update status
            </Button>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-1 overflow-x-auto">
        {STEPS.map((s, i) => {
          const current = stepIndex(c.status);
          const done = i < current || (i === current && ["closed"].includes(c.status));
          const active = i === current && c.status !== "closed";
          const declined = c.status === "rejected" && i === 2;
          return (
            <div key={s.key} className="flex items-center gap-1 shrink-0">
              <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                declined ? "border-rose-300 bg-rose-500/10 text-rose-800"
                  : active ? "border-primary bg-primary/10 text-primary font-medium"
                  : done ? "border-emerald-300 bg-emerald-500/10 text-emerald-800"
                  : "border-border text-muted-foreground"}`}>
                {done && !declined ? <CheckCircle2 className="h-3 w-3" /> : declined ? <XCircle className="h-3 w-3" /> : active ? <Clock className="h-3 w-3" /> : null}
                {declined ? "Declined" : s.key === "review" && c.status === "under_investigation" ? "Investigation" : s.label}
              </div>
              {i < STEPS.length - 1 && <div className="h-px w-4 bg-border" />}
            </div>
          );
        })}
      </div>

      {/* What happens next */}
      <div className={`rounded-xl border p-4 ${toneClass}`} data-testid="claim-next-step">
        <p className="text-sm font-semibold mb-1">{next.title}</p>
        <div className="text-sm">{next.body}</div>
        {d.group?.debitBlocker && undecided && (
          <p className="text-sm text-rose-700 mt-2 flex items-start gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {d.group.debitBlocker}</p>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <CardSection title="Deceased" icon={User}>
          <div className="space-y-0.5">
            <DetailRow label="Full name" value={c.deceasedName} />
            <DetailRow label="Relationship to policyholder" value={c.deceasedRelationship} />
            <DetailRow label="Date of death" value={formatDate(c.dateOfDeath)} />
            <DetailRow label="Cause of death" value={c.causeOfDeath} />
          </div>
        </CardSection>

        <CardSection title="Policy & Member" icon={FileText}>
          <div className="space-y-0.5">
            <DetailRow label="Policy" value={d.policy ? (
              <Link href={`/staff/policies?policyId=${d.policy.id}`} className="text-primary hover:underline font-mono" data-testid="link-claim-policy">{d.policy.policyNumber}</Link>
            ) : "—"} />
            <DetailRow label="Policy status" value={d.policy ? <StatusBadge variant="policy" status={d.policy.status} /> : "—"} />
            <DetailRow label="Policyholder" value={d.client ? `${d.client.firstName} ${d.client.lastName}` : "—"} />
            <DetailRow label="Claimed member" value={d.member ? `${d.member.memberName || "Member"} · ${d.member.relationship || d.member.role}` : "Not linked to a member"} />
            <DetailRow label="Member's claim status" value={d.member ? (<span className="inline-flex flex-col items-end gap-0.5"><MemberClaimBadge status={d.member.claimStatus} />{d.member.claimVerdictNote && <span className="text-[11px] text-muted-foreground font-normal">{d.member.claimVerdictNote}</span>}</span>) : "—"} />
          </div>
        </CardSection>

        <CardSection title="Claim & Amount" icon={Landmark}>
          <div className="space-y-0.5">
            <DetailRow label="Claim amount (cash-in-lieu)" value={money(c.cashInLieuAmount, c.currency)} />
            {c.ledgerAmount && <DetailRow label="Deducted from group ledger" value={money(c.ledgerAmount, ledgerCurrency)} />}
            <DetailRow label="Waiting period" value={c.fraudFlags?.waitingPeriod?.overrideReason ? `Overridden: ${c.fraudFlags.waitingPeriod.overrideReason}` : c.fraudFlags?.waitingPeriod?.violated ? `Not yet served (ends ${c.fraudFlags.waitingPeriod.waitingPeriodEndDate})` : c.isWaitingPeriodWaived ? "Waived" : "OK"} />
            <DetailRow label="Filed" value={`${formatDate(c.createdAt)} by ${name(c.submittedBy)}`} />
            <DetailRow label="Open for" value={`${c.ageDays} ${c.ageDays === 1 ? "day" : "days"}`} />
          </div>
        </CardSection>

        <CardSection title="Decision" icon={CheckCircle2}>
          <div className="space-y-0.5">
            <DetailRow label="Verdict" value={c.status === "rejected" ? "Declined" : c.decidedAt || c.approvedBy ? "Approved" : "Not decided yet"} />
            <DetailRow label="Decided by" value={c.decidedBy ? name(c.decidedBy) : c.approvedBy ? name(c.approvedBy) : "—"} />
            <DetailRow label="Decided on" value={formatDateTime(c.decidedAt)} />
            <DetailRow label="Reason" value={c.decisionReason} />
            {c.isExGratia && <DetailRow label="Ex gratia reason" value={c.exGratiaReason} />}
            <DetailRow label="Approvals queue" value={d.approval ? (d.approval.status === "on_hold" ? "On hold — under investigation" : statusLabel(d.approval.status)) : "—"} />
          </div>
        </CardSection>

        {(c.investigationReason || c.status === "under_investigation") && (
          <CardSection title="Investigation" icon={ShieldQuestion}>
            <div className="space-y-0.5">
              <DetailRow label="What's being investigated" value={c.investigationReason} />
              <DetailRow label="Next steps" value={c.investigationNextSteps} />
              <DetailRow label="Opened" value={`${formatDateTime(c.investigationOpenedAt)}${c.investigationOpenedBy ? ` by ${name(c.investigationOpenedBy)}` : ""}`} />
              <DetailRow label="Findings" value={c.investigationFindings || (c.status === "under_investigation" ? "Still investigating" : "—")} />
              <DetailRow label="Concluded" value={formatDateTime(c.investigationClosedAt)} />
            </div>
          </CardSection>
        )}

        {d.group && (
          <CardSection title="Group Ledger" icon={Users}>
            <div className="space-y-0.5">
              <DetailRow label="Group" value={`${d.group.name} · ${d.group.type === "burial_society" ? "Burial society" : d.group.isLegacy ? "Legacy group" : "Group"}`} />
              <DetailRow label="Current balance" value={money(ledgerBalance, ledgerCurrency)} />
              {d.group.pendingDebit && (
                <>
                  <DetailRow label="Will be deducted on approval" value={money(d.group.pendingDebit.amount, d.group.pendingDebit.currency)} />
                  <DetailRow label="Balance after approval" value={
                    <span className={ledgerBalance - d.group.pendingDebit.amount < 0 ? "text-rose-700" : ""}>
                      {money(ledgerBalance - d.group.pendingDebit.amount, d.group.pendingDebit.currency)}
                    </span>
                  } />
                </>
              )}
              {c.ledgerAmount && <DetailRow label="Deducted on approval" value={money(c.ledgerAmount, ledgerCurrency)} />}
              <DetailRow label="Cash-service quote" value={d.quotation ? `${d.quotation.quotationNumber} · ${money(d.quotation.grandTotal && parseFloat(d.quotation.grandTotal) > 0 ? d.quotation.grandTotal : d.quotation.total, d.quotation.currency)}` : d.group.type === "burial_society" ? <span className="text-rose-700">Required — none attached</span> : "None"} />
            </div>
            <p className="text-[11px] text-muted-foreground mt-2">
              A ledger deduction moves the group's own money — it isn't income and doesn't appear in the daily financials.
            </p>
          </CardSection>
        )}

        <CardSection title="Linked Records" icon={Link2}>
          <div className="space-y-0.5">
            <DetailRow label="Funeral case" value={d.funeralCase ? (
              <Link href={`/staff/funerals?openCase=${d.funeralCase.id}`} className="text-primary hover:underline" data-testid="link-view-funeral-case">{d.funeralCase.caseNumber}</Link>
            ) : "None"} />
            <DetailRow label="Cash-service quote" value={d.quotation ? (
              <a href={`${getApiBase()}/api/quotations/${d.quotation.id}/pdf`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{d.quotation.quotationNumber}</a>
            ) : "None"} />
          </div>
        </CardSection>

        {(assessment || recommendation) && (
          <CardSection title="Assessment" icon={FileText}>
            {assessment && <p className="text-sm whitespace-pre-wrap">{assessment}</p>}
            {recommendation && <p className="text-sm mt-2"><span className="text-muted-foreground">Recommendation:</span> <span className="capitalize font-medium">{recommendation}</span></p>}
          </CardSection>
        )}
      </div>

      <CardSection title="Status History" icon={History}>
        {d.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ol className="relative border-l border-border ml-2 space-y-3">
            {[...d.history].reverse().map((h) => (
              <li key={h.id} className="ml-4">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-background bg-primary/60" />
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <StatusBadge variant="claim" status={h.toStatus} />
                  <span className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)} · {name(h.changedBy)}</span>
                </div>
                {h.reason && <p className="text-sm mt-1 text-muted-foreground whitespace-pre-wrap">{h.reason}</p>}
              </li>
            ))}
          </ol>
        )}
      </CardSection>

      {/* Decision / status dialog */}
      <Dialog open={!!mode} onOpenChange={(v) => { if (!v) setMode(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{mode ? actionTitle[mode] : ""}</DialogTitle>
            <DialogDescription>{c.claimNumber}{c.deceasedName ? ` · ${c.deceasedName}` : ""}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {mode === "approve" && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                <p>The claimed member{d.member ? ` (${d.member.memberName})` : ""} will be marked <strong>claimed — approved</strong> on the policy.</p>
                {d.group?.pendingDebit && (
                  <p>
                    <strong>{money(d.group.pendingDebit.amount, d.group.pendingDebit.currency)}</strong> will be deducted from {d.group.name}'s ledger.
                    Balance {money(ledgerBalance, ledgerCurrency)} → <strong className={ledgerBalance - d.group.pendingDebit.amount < 0 ? "text-rose-700" : ""}>{money(ledgerBalance - d.group.pendingDebit.amount, ledgerCurrency)}</strong>.
                  </p>
                )}
              </div>
            )}
            {mode === "decline" && (
              <p className="rounded-md border bg-muted/30 p-3 text-sm">The claimed member{d.member ? ` (${d.member.memberName})` : ""} will be marked <strong>claim declined</strong> on the policy, with your reason.</p>
            )}
            {mode === "investigate" && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="inv-reason">What needs investigating? <span className="text-destructive">*</span></Label>
                  <Textarea id="inv-reason" value={investigationReason} onChange={(e) => setInvestigationReason(e.target.value)} placeholder="e.g. Cause of death on the death certificate doesn't match the burial order" data-testid="input-investigation-reason" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-steps">Next steps <span className="text-destructive">*</span></Label>
                  <Textarea id="inv-steps" value={investigationNextSteps} onChange={(e) => setInvestigationNextSteps(e.target.value)} placeholder="e.g. Get a copy of the police report and call the hospital" data-testid="input-investigation-next-steps" />
                </div>
                <p className="text-xs text-muted-foreground">The claim leaves the approvals queue while it's investigated, and goes back once the findings are recorded.</p>
              </>
            )}
            {mode === "conclude" && (
              <>
                <div className="rounded-md border bg-muted/30 p-3 text-sm space-y-1">
                  <p><span className="text-muted-foreground">Investigated:</span> {c.investigationReason}</p>
                  <p><span className="text-muted-foreground">Next steps were:</span> {c.investigationNextSteps}</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="inv-findings">Findings <span className="text-destructive">*</span></Label>
                  <Textarea id="inv-findings" value={investigationFindings} onChange={(e) => setInvestigationFindings(e.target.value)} placeholder="What the investigation found" data-testid="input-investigation-findings" />
                </div>
                <p className="text-xs text-muted-foreground">The claim goes back to the approvers with these findings.</p>
              </>
            )}
            {mode === "status" && (
              <div className="space-y-2">
                <Label htmlFor="transition-target">Move to</Label>
                <Select value={targetStatus} onValueChange={setTargetStatus}>
                  <SelectTrigger id="transition-target" data-testid="select-transition-target"><SelectValue placeholder="Select status…" /></SelectTrigger>
                  <SelectContent>
                    {settlementTransitions.map((s) => <SelectItem key={s} value={s}>{statusLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="transition-reason">{mode === "decline" ? <>Reason for declining <span className="text-destructive">*</span></> : "Notes (optional)"}</Label>
              <Textarea id="transition-reason" value={reason} onChange={(e) => setReason(e.target.value)} data-testid="input-transition-reason" />
            </div>
            {mode === "approve" && (needsWaitingOverride || c.fraudFlags?.waitingPeriod?.violated) && (
              <div className="space-y-2">
                <Label>Waiting period override</Label>
                <Textarea value={waitingPeriodOverrideReason} onChange={(e) => setWaitingPeriodOverrideReason(e.target.value)}
                  placeholder="The death was before the waiting period ended — explain why it should be approved anyway…" data-testid="input-waiting-period-override" />
              </div>
            )}
            {mode === "approve" && (
              <div className="space-y-2 rounded-md border border-amber-200 bg-amber-500/5 p-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="claim-ex-gratia" checked={isExGratia} onCheckedChange={(v) => setIsExGratia(v === true)} data-testid="checkbox-ex-gratia" />
                  <Label htmlFor="claim-ex-gratia" className="cursor-pointer">Approve as ex gratia (a goodwill payment — it doesn't strictly qualify)</Label>
                </div>
                {isExGratia && (
                  <Textarea value={exGratiaReason} onChange={(e) => setExGratiaReason(e.target.value)} placeholder="Why is this being approved anyway?" data-testid="input-ex-gratia-reason" />
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMode(null)} data-testid="button-cancel-transition">Cancel</Button>
            <Button onClick={submitAction} disabled={transition.isPending || (mode === "status" && !targetStatus)}
              className={mode === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : mode === "decline" ? "bg-rose-600 hover:bg-rose-700" : ""}
              data-testid="button-confirm-transition">
              {transition.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "approve" ? "Approve" : mode === "decline" ? "Decline" : mode === "investigate" ? "Send for investigation" : mode === "conclude" ? "Send back for approval" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Amount / quote dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Claim amount, member & quote</DialogTitle>
            <DialogDescription>Can only be changed before the claim is decided.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Claim is for</Label>
              <Select value={editMemberId || "__none__"} onValueChange={(v) => setEditMemberId(v === "__none__" ? "" : v)}>
                <SelectTrigger data-testid="select-edit-claim-member"><SelectValue placeholder="Select covered member…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not linked —</SelectItem>
                  {editMembers.map((m: any) => {
                    const blocked = !!m.claimId && m.claimId !== c.id && m.claimCurrentStatus !== "rejected";
                    return (
                      <SelectItem key={m.id} value={m.id} disabled={blocked}>
                        {m.memberName || "Member"} · {(m.relationship || m.role || "member").replace(/_/g, " ")}{blocked ? ` · already on ${m.claimNumber}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">The verdict is recorded against this person on the policy.</p>
            </div>
            <div className="space-y-2">
              <Label>Claim amount (cash-in-lieu)</Label>
              <div className="flex gap-2">
                <Select value={editCurrency} onValueChange={setEditCurrency}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZIG</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min="0" step="0.01" value={editAmount} onChange={(e) => setEditAmount(e.target.value)} data-testid="input-edit-claim-amount" />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Cash-service quote {d.group?.type === "burial_society" && <span className="text-destructive">*</span>}</Label>
              {d.quotation && !pickedQuote && <p className="text-xs text-muted-foreground">Attached: {d.quotation.quotationNumber}. Pick another to replace it.</p>}
              <div className="flex gap-2">
                <Input value={quoteSearch} onChange={(e) => setQuoteSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchQuotes(); } }} placeholder="Quote number or deceased name" />
                <Button type="button" variant="outline" size="sm" onClick={searchQuotes} disabled={quoteSearching}>
                  {quoteSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                </Button>
              </div>
              {quoteResults && (
                <div className="max-h-40 overflow-y-auto rounded border divide-y">
                  {quoteResults.length === 0 && <p className="p-2 text-xs text-muted-foreground">No quotes found.</p>}
                  {quoteResults.map((q) => (
                    <button key={q.id} type="button" disabled={!!q.claimId && q.claimId !== c.id}
                      className={`w-full text-left p-2 text-sm hover:bg-muted/50 disabled:opacity-50 ${pickedQuote?.id === q.id ? "bg-primary/10" : ""}`}
                      onClick={() => setPickedQuote(q)}>
                      <span className="font-mono">{q.quotationNumber}</span>
                      {q.deceasedName ? ` · ${q.deceasedName}` : ""} · {money(parseFloat(q.grandTotal || "0") > 0 ? q.grandTotal : q.total, q.currency)}
                      {q.claimId && q.claimId !== c.id ? " · already on another claim" : ""}
                    </button>
                  ))}
                </div>
              )}
              {pickedQuote && <p className="text-xs">Will attach <strong>{pickedQuote.quotationNumber}</strong>.</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={() => edit.mutate({ cashInLieuAmount: editAmount, currency: editCurrency, quotationId: pickedQuote?.id, policyMemberId: editMemberId || undefined })} disabled={edit.isPending} data-testid="button-save-claim-edit">
              {edit.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

