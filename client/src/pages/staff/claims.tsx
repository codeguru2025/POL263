import { useState, useEffect } from "react";
import { useSearch, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, CardSection, FilterBar, EmptyState, StatusBadge, EnhancedDataTable, KpiStatCard, type EdtColumn } from "@/components/ds";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PolicySearchInput } from "@/components/policy-search-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Search, Filter, FileWarning, Loader2, FileDown, AlertTriangle, ShieldQuestion, Clock, CheckCircle2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatAmountWithCode } from "@shared/validation";
import type { Claim } from "@shared/schema";
import { ClaimDetailView } from "./claim-detail-view";
import { MemberClaimBadge } from "@/components/member-claim-badge";

/** The claims list is left-joined server-side with any linked funeral case — see
 *  storage.getClaimsByOrg — so the Claims<->Funerals cross-link needs no extra fetch. */
type ClaimWithFuneralCase = Claim & {
  funeralCaseId: string | null; funeralCaseNumber: string | null;
  /** Server-computed (server/claims-sla.ts) — days since filed, and whether that exceeds the
   *  claims SLA window for a still-open claim. Never set for rejected/closed claims. */
  ageDays: number; isOverdue: boolean;
};

/** Must match server/claims-sla.ts's CLAIM_SLA_DAYS — display-only here, the server already
 *  computes isOverdue itself, this is just for the tooltip copy. */
const CLAIM_SLA_DAYS = 5;

const CLAIM_TYPES = ["death", "accidental_death", "disability", "repatriation", "cash_in_lieu", "group_service"];

const BLANK_CLAIM = {
  policyId: "",
  clientId: "",
  claimType: "",
  deceasedName: "",
  deceasedRelationship: "",
  dateOfDeath: "",
  causeOfDeath: "",
  cashInLieuAmount: "",
  currency: "USD",
  assessmentNotes: "",
  recommendation: "",
  investigationReason: "",
  investigationNextSteps: "",
  // Set when arriving from a group-service quotation's "Submit as Group Claim" button
  // (quotations.tsx) — see the deep-link useEffect below.
  quotationId: "",
  groupId: "",
};

export default function StaffClaims() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions, isPlatformOwner } = useAuth();
  const canApprove = isPlatformOwner || permissions.includes("approve:claim");
  const canWrite = isPlatformOwner || permissions.includes("write:claim");
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("create") === "1",
  );
  const urlSearch = useSearch();
  const [selectedClaimId, setSelectedClaimId] = useState<string | null>(
    () => (typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("openClaim") : null),
  );
  useEffect(() => {
    const params = new URLSearchParams(urlSearch);
    // Deep-link support for the Funerals<->Claims cross-link (funerals.tsx links here via
    // ?openClaim=), matching the ?openCase= / ?policyId= pattern on the other detail pages.
    const openClaim = params.get("openClaim");
    if (openClaim) setSelectedClaimId(openClaim);
    if (params.get("create") !== "1") return;
    setShowCreateDialog(true);
    // Arrived from a group-service quotation's "Submit as Group Claim" button
    // (quotations.tsx) — pre-fill everything except policyId, which staff must still pick
    // (the relevant member's own policy within the group).
    const quotationId = params.get("quotationId");
    const groupId = params.get("groupId");
    if (quotationId && groupId) {
      setNewClaim((p) => ({
        ...p,
        quotationId,
        groupId,
        claimType: "group_service",
        deceasedName: params.get("deceasedName") || p.deceasedName,
        cashInLieuAmount: params.get("cashInLieuAmount") || p.cashInLieuAmount,
        currency: params.get("currency") || p.currency,
      }));
      setQuoteLabel(params.get("quotationNumber") || "the linked quote");
    }
  }, [urlSearch]);

  const [newClaim, setNewClaim] = useState({ ...BLANK_CLAIM });

  // Policy + member state for the create form
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [policyMembers, setPolicyMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  // Cash-in-lieu auto-suggestion — resolved from the policy's product version once selected;
  // staff can still freely overwrite the suggested amount.
  const [selectedProductVersion, setSelectedProductVersion] = useState<any>(null);
  const [cashInLieuTouched, setCashInLieuTouched] = useState(false);
  // The policy's group, if it's a ledger group (legacy group / burial society) — the claim is
  // then paid from that group's ledger, and a burial society needs a cash-service quote.
  const [policyGroup, setPolicyGroup] = useState<any>(null);
  const [quoteSearch, setQuoteSearch] = useState("");
  const [quoteResults, setQuoteResults] = useState<any[] | null>(null);
  const [quoteSearching, setQuoteSearching] = useState(false);
  const [quoteLabel, setQuoteLabel] = useState("");

  // Optional funeral-case link — if a case already exists for the same death, blank-fill
  // deceased details from it instead of asking again (mirrors funerals.tsx's quotation lookup).
  const [caseSearch, setCaseSearch] = useState("");
  const [caseLookupLoading, setCaseLookupLoading] = useState(false);
  const [foundCase, setFoundCase] = useState<any>(null);
  const [caseLookupError, setCaseLookupError] = useState("");

  const lookupFuneralCase = async (search: string) => {
    if (!search.trim()) return;
    setCaseLookupLoading(true);
    setCaseLookupError("");
    setFoundCase(null);
    try {
      const res = await fetch(getApiBase() + `/api/funeral-cases?q=${encodeURIComponent(search.trim())}&limit=5`, { credentials: "include" });
      const data = await res.json();
      const cases: any[] = Array.isArray(data) ? data : [];
      const exact = cases.find((c: any) => c.caseNumber?.toLowerCase() === search.trim().toLowerCase()) || cases[0];
      if (!exact) { setCaseLookupError("No funeral case found with that number."); return; }
      if (exact.claimId) { setCaseLookupError("This funeral case already has a claim linked."); return; }
      setFoundCase(exact);
      const isBlank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      setNewClaim((p) => ({
        ...p,
        deceasedName: isBlank(p.deceasedName) && !isBlank(exact.deceasedName) ? exact.deceasedName : p.deceasedName,
        deceasedRelationship: isBlank(p.deceasedRelationship) && !isBlank(exact.deceasedRelationship) ? exact.deceasedRelationship : p.deceasedRelationship,
        dateOfDeath: isBlank(p.dateOfDeath) && !isBlank(exact.dateOfDeath) ? exact.dateOfDeath : p.dateOfDeath,
        causeOfDeath: isBlank(p.causeOfDeath) && !isBlank(exact.causeOfDeath) ? exact.causeOfDeath : p.causeOfDeath,
      }));
    } catch {
      setCaseLookupError("Failed to look up funeral case.");
    } finally {
      setCaseLookupLoading(false);
    }
  };

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

  const handlePolicySelect = (id: string, policy: any) => {
    setNewClaim((p) => ({ ...p, policyId: id, clientId: policy?.clientId || "" }));
    setSelectedPolicy(policy || null);
    setSelectedMemberId("");
    setPolicyMembers([]);
    setSelectedProductVersion(null);
    setCashInLieuTouched(false);
    setPolicyGroup(null);
    if (id) {
      setLoadingMembers(true);
      fetch(getApiBase() + `/api/policies/${id}/members`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setPolicyMembers(Array.isArray(data) ? data : []))
        .catch(() => setPolicyMembers([]))
        .finally(() => setLoadingMembers(false));
    }
    if (policy?.groupId) {
      fetch(getApiBase() + "/api/groups", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((groups) => {
          const g = Array.isArray(groups) ? groups.find((x: any) => x.id === policy.groupId) : null;
          setPolicyGroup(g?.hasLedger ? g : null);
        })
        .catch(() => setPolicyGroup(null));
    }
    // Best-effort cash-in-lieu suggestion — silently no-ops if the caller's role lacks
    // read:product or the policy has no product version; staff can always enter it manually.
    if (policy?.productVersionId) {
      fetch(getApiBase() + "/api/product-versions", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((versions) => {
          const pv = Array.isArray(versions) ? versions.find((v: any) => v.id === policy.productVersionId) : null;
          setSelectedProductVersion(pv || null);
          if (pv?.cashInLieuAdult && !cashInLieuTouched) {
            setNewClaim((p) => (p.cashInLieuAmount ? p : { ...p, cashInLieuAmount: pv.cashInLieuAdult }));
          }
        })
        .catch(() => setSelectedProductVersion(null));
    }
  };

  const resetCreateForm = () => {
    setNewClaim({ ...BLANK_CLAIM });
    setSelectedPolicy(null);
    setPolicyMembers([]);
    setSelectedMemberId("");
    setSelectedProductVersion(null);
    setCashInLieuTouched(false);
    setPolicyGroup(null);
    setQuoteSearch("");
    setQuoteResults(null);
    setQuoteLabel("");
    setCaseSearch("");
    setFoundCase(null);
    setCaseLookupError("");
  };

  const { data: claims = [], isLoading, isError: claimsError, error: claimsErrorObj, refetch: refetchClaims } = useQuery<ClaimWithFuneralCase[]>({
    queryKey: ["/api/claims"],
  });
  const overdueCount = claims.filter((c) => c.isOverdue).length;
  const awaitingDecision = claims.filter((c) => c.status === "submitted" || c.status === "verified").length;
  const investigating = claims.filter((c) => c.status === "under_investigation").length;
  const approvedCount = claims.filter((c) => ["approved", "scheduled", "payable", "completed", "paid", "closed"].includes(c.status)).length;

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/claims", data);
      return res.json();
    },
    onSuccess: (created: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      setShowCreateDialog(false);
      resetCreateForm();
      toast({
        title: "Claim logged",
        description: created?.status === "under_investigation"
          ? "It's under investigation — it goes to the approvers once the findings are recorded."
          : "It's in the Approvals queue waiting for a decision.",
      });
      if (created?.id) setSelectedClaimId(created.id);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't log the claim", description: err.message, variant: "destructive" });
    },
  });

  const filteredClaims = claims.filter((claim) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !search ||
      claim.claimNumber?.toLowerCase().includes(q) ||
      claim.deceasedName?.toLowerCase().includes(q) ||
      claim.claimType?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openDetail = (claim: ClaimWithFuneralCase) => {
    setSelectedClaimId(claim.id);
    window.scrollTo({ top: 0 });
  };
  const closeDetail = () => {
    setSelectedClaimId(null);
    if (new URLSearchParams(urlSearch).get("openClaim")) setLocation("/staff/claims");
  };

  const isBurialSociety = policyGroup?.type === "burial_society";
  const hasQuote = !!newClaim.quotationId;

  const handleCreate = () => {
    if (!newClaim.policyId || !newClaim.claimType) {
      toast({ title: "Missing details", description: "Pick the policy and the claim type.", variant: "destructive" });
      return;
    }
    if (policyMembers.length > 0 && !selectedMemberId) {
      toast({ title: "Missing details", description: "Pick which covered member this claim is for — the verdict is recorded against them.", variant: "destructive" });
      return;
    }
    if (isBurialSociety && !hasQuote) {
      toast({ title: "Quote required", description: `${policyGroup.name} is a burial society — attach the cash-service quote. That's the amount deducted from their ledger.`, variant: "destructive" });
      return;
    }
    if (newClaim.recommendation === "investigate" && (!newClaim.investigationReason.trim() || !newClaim.investigationNextSteps.trim())) {
      toast({ title: "Missing details", description: "Say what needs investigating and what the next steps are.", variant: "destructive" });
      return;
    }
    const approvalNotes = [
      newClaim.assessmentNotes ? `Assessment: ${newClaim.assessmentNotes}` : "",
      newClaim.recommendation ? `Recommendation: ${newClaim.recommendation.replace(/_/g, " ")}` : "",
    ].filter(Boolean).join("\n\n") || undefined;

    createMutation.mutate({
      policyId: newClaim.policyId,
      clientId: newClaim.clientId || undefined,
      policyMemberId: selectedMemberId || undefined,
      funeralCaseId: foundCase?.id || undefined,
      quotationId: newClaim.quotationId || undefined,
      groupId: newClaim.groupId || undefined,
      claimType: newClaim.claimType,
      deceasedName: newClaim.deceasedName || undefined,
      deceasedRelationship: newClaim.deceasedRelationship || undefined,
      dateOfDeath: newClaim.dateOfDeath || undefined,
      causeOfDeath: newClaim.causeOfDeath || undefined,
      cashInLieuAmount: newClaim.cashInLieuAmount || undefined,
      currency: newClaim.currency,
      approvalNotes,
      recommendation: newClaim.recommendation || undefined,
      investigationReason: newClaim.recommendation === "investigate" ? newClaim.investigationReason : undefined,
      investigationNextSteps: newClaim.recommendation === "investigate" ? newClaim.investigationNextSteps : undefined,
    });
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  };

  const claimColumns: EdtColumn<ClaimWithFuneralCase>[] = [
    {
      id: "claimNumber",
      header: "Claim #",
      accessor: (c) => c.claimNumber,
      cell: (c) => (
        <div className="flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-primary/70 shrink-0" />
          <span className="text-primary">{c.claimNumber}</span>
          {c.isExGratia && (
            <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200 text-[10px]">Ex Gratia</Badge>
          )}
          {c.groupId && (
            <Badge variant="outline" className="bg-indigo-500/10 text-indigo-700 border-indigo-200 text-[10px]">Ledger</Badge>
          )}
        </div>
      ),
      headClassName: "pl-6",
      cellClassName: "font-medium pl-6",
    },
    {
      id: "claimType",
      header: "Type",
      accessor: (c) => c.claimType,
      cell: (c) => <span className="text-sm capitalize">{c.claimType?.replace(/_/g, " ")}</span>,
    },
    {
      id: "deceasedName",
      header: "Deceased",
      accessor: (c) => c.deceasedName,
      cell: (c) => c.deceasedName || "—",
    },
    {
      id: "dateOfDeath",
      header: "Date of Death",
      accessor: (c) => c.dateOfDeath,
      cell: (c) => <span className="text-muted-foreground text-sm tabular-nums">{formatDate(c.dateOfDeath)}</span>,
    },
    {
      id: "status",
      header: "Status",
      accessor: (c) => c.status,
      cell: (c) => <span data-testid={`status-claim-${c.id}`}><StatusBadge variant="claim" status={c.status} /></span>,
    },
    {
      id: "cashInLieuAmount",
      header: "Amount",
      accessor: (c) => c.cashInLieuAmount ?? 0,
      cell: (c) => <span className="font-medium tabular-nums">{c.cashInLieuAmount ? formatAmountWithCode(c.cashInLieuAmount, c.currency) : "—"}</span>,
    },
    {
      id: "createdAt",
      header: "Filed",
      accessor: (c) => c.createdAt,
      cell: (c) => <span className="text-muted-foreground text-sm tabular-nums">{formatDate(c.createdAt as any)}</span>,
    },
    {
      id: "ageDays",
      header: "Age",
      accessor: (c) => c.ageDays ?? 0,
      cell: (c) => (
        <span
          className={`text-sm tabular-nums flex items-center gap-1 ${c.isOverdue ? "text-destructive font-medium" : "text-muted-foreground"}`}
          data-testid={`age-claim-${c.id}`}
          title={c.isOverdue ? `Open ${c.ageDays} days — past the ${CLAIM_SLA_DAYS}-day claims SLA` : undefined}
        >
          {c.isOverdue && <AlertTriangle className="h-3.5 w-3.5" />}
          {c.ageDays} {c.ageDays === 1 ? "day" : "days"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      align: "right",
      sortable: false,
      exportable: false,
      headClassName: "text-right pr-6",
      cellClassName: "text-right pr-6",
      cell: (claim) => (
        <Button variant="outline" size="sm" className="h-8" onClick={(e) => { e.stopPropagation(); openDetail(claim); }} data-testid={`button-view-claim-${claim.id}`}>
          Open
        </Button>
      ),
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        {selectedClaimId ? (
          <ClaimDetailView key={selectedClaimId} claimId={selectedClaimId} onBack={closeDetail} canApprove={canApprove} canWrite={canWrite} />
        ) : (
        <>
        <PageHeader
          title="Claims"
          description="Log claims, investigate them, and record the verdict against the member on the policy."
          titleDataTestId="text-claims-title"
          actions={(
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" className="gap-1.5 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" asChild>
                <a href={getApiBase() + "/api/forms/blank/claim-submission"} target="_blank" rel="noopener noreferrer">
                  <FileDown className="h-4 w-4" /> Blank Claim Form
                </a>
              </Button>
              {canWrite && (
                <Button className="gap-2 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => setShowCreateDialog(true)} data-testid="button-new-claim">
                  <Plus className="h-4 w-4" /> Log New Claim
                </Button>
              )}
            </div>
          )}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiStatCard label="Awaiting decision" value={awaitingDecision} hint="In the approvals queue" icon={Clock} />
          <KpiStatCard label="Under investigation" value={investigating} hint="Back to approvals when concluded" icon={ShieldQuestion} />
          <KpiStatCard label="Approved" value={approvedCount} hint="Including settled" icon={CheckCircle2} />
          <KpiStatCard label={`Open past ${CLAIM_SLA_DAYS} days`} value={<span className={overdueCount ? "text-destructive" : ""} data-testid="badge-claims-overdue">{overdueCount}</span>} hint="Claims SLA" icon={AlertTriangle} />
        </div>

        <AiInsightsPanel surface="claims" title="AI Insights" description="Ask AI to summarize claims activity and flag anything unusual." />

        <CardSection title="Claims register" description="Click a claim to open it." flush>
            <FilterBar className="border-b border-border/60 bg-muted/10 px-4 py-3 sm:px-6">
                <div className="relative w-full min-w-[200px] sm:max-w-xs">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search claims..."
                    className="pl-9 bg-background"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-claims"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-48" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="under_investigation">Under Investigation</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="payable">Payable</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="rejected">Declined</SelectItem>
                  </SelectContent>
                </Select>
            </FilterBar>
            {claimsError ? (
              <EmptyState
                icon={AlertTriangle}
                title="Could not load claims"
                description={claimsErrorObj instanceof Error ? claimsErrorObj.message : "Something went wrong fetching the claims list."}
                action={<Button variant="outline" onClick={() => refetchClaims()}>Try again</Button>}
                className="border-0 rounded-none bg-transparent py-12"
              />
            ) : isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="px-4 pb-4 pt-2 sm:px-6">
                <EnhancedDataTable<ClaimWithFuneralCase>
                  columns={claimColumns}
                  rows={filteredClaims}
                  getRowKey={(c) => c.id}
                  onRowClick={openDetail}
                  searchable={false}
                  exportable
                  exportFilename="claims"
                  storageKey="claims"
                  emptyMessage="No claims found. Create a new claim or adjust your filters."
                  rowTestId={(c) => `row-claim-${c.id}`}
                />
              </div>
            )}
        </CardSection>
        </>
        )}
      </PageShell>

      {/* ── Create claim dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={(v) => { if (!v) resetCreateForm(); setShowCreateDialog(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log New Claim</DialogTitle>
            <DialogDescription>It goes to the Approvals queue — or straight into investigation if that's your recommendation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">

            {/* Step 1: Find the policy */}
            <div className="space-y-2">
              <Label htmlFor="claim-policy">Policy <span className="text-destructive">*</span></Label>
              <PolicySearchInput
                id="claim-policy"
                value={newClaim.policyId}
                onChange={handlePolicySelect}
                placeholder="Search by policy number or client name…"
                data-testid="select-claim-policy"
              />
            </div>

            {/* Policy summary + member picker */}
            {selectedPolicy && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-3 text-sm">
                <div>
                  <p className="font-medium font-mono">{selectedPolicy.policyNumber}</p>
                  <p className="text-xs text-muted-foreground capitalize">
                    {selectedPolicy.status} · {selectedPolicy.currency} {Number(selectedPolicy.premiumAmount || 0).toFixed(2)}/mo
                  </p>
                </div>
                {loadingMembers ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Loading covered members…
                  </div>
                ) : policyMembers.length > 0 ? (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Claim is for <span className="text-destructive">*</span></Label>
                    <Select
                      value={selectedMemberId || "__none__"}
                      onValueChange={(v) => {
                        if (v === "__none__") { setSelectedMemberId(""); return; }
                        setSelectedMemberId(v);
                        const m = policyMembers.find((x: any) => String(x.id) === v);
                        if (m) {
                          const isChildMember = m.age != null && m.age < 18;
                          const suggested = isChildMember
                            ? selectedProductVersion?.cashInLieuChild
                            : selectedProductVersion?.cashInLieuAdult;
                          setNewClaim((p) => ({
                            ...p,
                            deceasedName: m.memberName || p.deceasedName,
                            deceasedRelationship: m.relationship && m.relationship !== "Policy Holder" ? m.relationship : (m.relationship === "Policy Holder" ? "Self (policyholder)" : p.deceasedRelationship),
                            cashInLieuAmount: !cashInLieuTouched && suggested ? suggested : p.cashInLieuAmount,
                          }));
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-deceased-member">
                        <SelectValue placeholder="Select covered member…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Select member —</SelectItem>
                        {policyMembers.map((m: any) => {
                          const blocked = !!m.claimNumber && m.claimCurrentStatus !== "rejected";
                          return (
                            <SelectItem key={m.id} value={String(m.id)} disabled={blocked}>
                              {m.memberName || "Member"} · {(m.relationship || m.role || "member").replace(/_/g, " ")}
                              {m.age != null ? ` · ${m.age}y` : ""}
                              {blocked ? ` · already on ${m.claimNumber}` : ""}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    {(() => {
                      const m = policyMembers.find((x: any) => String(x.id) === selectedMemberId);
                      if (!m) return <p className="text-[10px] text-muted-foreground">The approved or declined verdict is recorded against this person on the policy.</p>;
                      return (
                        <div className="flex items-center gap-2 flex-wrap text-[11px]">
                          <MemberClaimBadge status={m.claimStatus} />
                          <span className={m.claimable ? "text-emerald-700" : "text-amber-700"}>{m.claimableReason}</span>
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No covered members found on this policy — fill in deceased details manually.</p>
                )}
              </div>
            )}

            {/* Ledger group: paid from the group's ledger; burial society needs a quote */}
            {(policyGroup || newClaim.groupId) && (
              <div className="rounded-md border border-indigo-200 bg-indigo-500/5 p-3 space-y-2 text-sm" data-testid="claim-ledger-group-notice">
                <p className="flex items-center gap-1.5 font-medium"><Users className="h-4 w-4" /> Paid from {policyGroup?.name ?? "the group"}'s ledger</p>
                <p className="text-xs text-muted-foreground">
                  When this claim is approved, the amount is deducted from the group's ledger and the new balance is shown. It isn't income, so it doesn't touch the daily financials.
                </p>
                {(isBurialSociety || hasQuote) && (
                  <div className="space-y-1.5">
                    <Label className="text-xs font-medium">Cash-service quote {isBurialSociety && <span className="text-destructive">*</span>}</Label>
                    {hasQuote ? (
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline">{quoteLabel || "Quote attached"}</Badge>
                        <button type="button" className="text-primary underline" onClick={() => { setNewClaim((p) => ({ ...p, quotationId: "" })); setQuoteLabel(""); }}>Change</button>
                      </div>
                    ) : (
                      <>
                        <div className="flex gap-2">
                          <Input value={quoteSearch} onChange={(e) => setQuoteSearch(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); searchQuotes(); } }} placeholder="Quote number or deceased name" className="h-8" data-testid="input-claim-quote-search" />
                          <Button type="button" size="sm" variant="outline" onClick={searchQuotes} disabled={quoteSearching}>
                            {quoteSearching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
                          </Button>
                        </div>
                        {quoteResults && (
                          <div className="max-h-36 overflow-y-auto rounded border bg-background divide-y">
                            {quoteResults.length === 0 && <p className="p-2 text-xs text-muted-foreground">No quotes found. Create one on the Quotations page first.</p>}
                            {quoteResults.map((q) => (
                              <button key={q.id} type="button" disabled={!!q.claimId}
                                className="w-full text-left p-2 text-xs hover:bg-muted/50 disabled:opacity-50"
                                onClick={() => {
                                  const amt = parseFloat(q.grandTotal || "0") > 0 ? q.grandTotal : q.total;
                                  setNewClaim((p) => ({ ...p, quotationId: q.id, cashInLieuAmount: cashInLieuTouched ? p.cashInLieuAmount : String(amt ?? ""), currency: q.currency || p.currency }));
                                  setQuoteLabel(`${q.quotationNumber} · ${formatAmountWithCode(amt, q.currency)}`);
                                }}>
                                <span className="font-mono">{q.quotationNumber}</span>{q.deceasedName ? ` · ${q.deceasedName}` : ""} · {formatAmountWithCode(parseFloat(q.grandTotal || "0") > 0 ? q.grandTotal : q.total, q.currency)}
                                {q.claimId ? " · already on a claim" : ""}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                    {isBurialSociety && <p className="text-[10px] text-muted-foreground">Every burial society claim needs a cash-service quote — the quoted amount is what's deducted from their ledger.</p>}
                  </div>
                )}
              </div>
            )}

            {/* Optional: link an existing funeral case handling the same death */}
            <div className="space-y-2">
              <Label htmlFor="claim-case-search">Link Funeral Case (optional)</Label>
              <div className="flex gap-2">
                <Input
                  id="claim-case-search"
                  placeholder="Case number, e.g. FNC-000048"
                  value={caseSearch}
                  onChange={(e) => setCaseSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupFuneralCase(caseSearch); } }}
                  className="flex-1"
                  data-testid="input-claim-case-search"
                />
                <Button type="button" size="sm" variant="outline" onClick={() => lookupFuneralCase(caseSearch)} disabled={caseLookupLoading || !caseSearch.trim()}>
                  {caseLookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
                </Button>
              </div>
              {caseLookupError && <p className="text-xs text-destructive">{caseLookupError}</p>}
              {foundCase && (
                <p className="text-xs text-muted-foreground">
                  Linked: <strong className="text-foreground">{foundCase.caseNumber}</strong>
                  {foundCase.deceasedName ? ` · ${foundCase.deceasedName}` : ""} — deceased/date/cause of death filled in below.
                </p>
              )}
            </div>

            {/* Claim type */}
            <div className="space-y-2">
              <Label htmlFor="claim-type">Claim Type <span className="text-destructive">*</span></Label>
              <Select value={newClaim.claimType} onValueChange={(v) => setNewClaim((p) => ({ ...p, claimType: v }))}>
                <SelectTrigger id="claim-type" data-testid="select-claim-type">
                  <SelectValue placeholder="Select type…" />
                </SelectTrigger>
                <SelectContent>
                  {CLAIM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Deceased details */}
            <div className="space-y-2">
              <Label htmlFor="claim-deceased">Deceased Name</Label>
              <Input
                id="claim-deceased"
                value={newClaim.deceasedName}
                onChange={(e) => setNewClaim((p) => ({ ...p, deceasedName: e.target.value }))}
                placeholder="Full name of deceased"
                data-testid="input-claim-deceased"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-relationship">Relationship to Policyholder</Label>
              <Input
                id="claim-relationship"
                value={newClaim.deceasedRelationship}
                onChange={(e) => setNewClaim((p) => ({ ...p, deceasedRelationship: e.target.value }))}
                placeholder="e.g. Spouse, Parent, Child"
                data-testid="input-claim-relationship"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="claim-dod">Date of Death</Label>
                <Input
                  id="claim-dod"
                  type="date"
                  value={newClaim.dateOfDeath}
                  onChange={(e) => setNewClaim((p) => ({ ...p, dateOfDeath: e.target.value }))}
                  data-testid="input-claim-dod"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="claim-cause">Cause of Death</Label>
                <Input
                  id="claim-cause"
                  value={newClaim.causeOfDeath}
                  onChange={(e) => setNewClaim((p) => ({ ...p, causeOfDeath: e.target.value }))}
                  placeholder="e.g. Natural causes"
                  data-testid="input-claim-cause"
                />
              </div>
            </div>

            {/* Cash-in-lieu */}
            <div className="space-y-2">
              <Label>Claim Amount (cash-in-lieu) <span className="text-muted-foreground text-xs">({policyGroup && !isBurialSociety ? "deducted from the group ledger on approval" : "optional"}{selectedProductVersion?.cashInLieuAdult || selectedProductVersion?.cashInLieuChild ? " — suggested from the product, editable" : ""})</span></Label>
              <div className="flex gap-2">
                <Select value={newClaim.currency} onValueChange={(v) => setNewClaim((p) => ({ ...p, currency: v }))}>
                  <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZIG</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={newClaim.cashInLieuAmount}
                  onChange={(e) => { setCashInLieuTouched(true); setNewClaim((p) => ({ ...p, cashInLieuAmount: e.target.value })); }}
                  data-testid="input-claim-cash-in-lieu"
                />
              </div>
            </div>

            {/* Assessment */}
            <div className="space-y-2">
              <Label htmlFor="new-claim-assessment-notes">Assessment Notes</Label>
              <Textarea id="new-claim-assessment-notes"
                placeholder="Document your assessment of this claim — supporting documents received, waiting period status, fraud indicators, etc."
                value={newClaim.assessmentNotes}
                onChange={(e) => setNewClaim((p) => ({ ...p, assessmentNotes: e.target.value }))}
                rows={3}
                data-testid="input-claim-assessment"
              />
            </div>

            {/* Recommendation */}
            <div className="space-y-2">
              <Label htmlFor="recommendation">Recommendation</Label>
              <Select
                value={newClaim.recommendation || "__none__"}
                onValueChange={(v) => setNewClaim((p) => ({ ...p, recommendation: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="recommendation" data-testid="select-claim-recommendation">
                  <SelectValue placeholder="Select recommendation…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No recommendation yet —</SelectItem>
                  <SelectItem value="approve">Recommend Approval</SelectItem>
                  <SelectItem value="reject">Recommend Rejection</SelectItem>
                  <SelectItem value="investigate">Further Investigation Required</SelectItem>
                </SelectContent>
              </Select>
              {newClaim.recommendation === "investigate" ? (
                <div className="space-y-3 rounded-md border border-violet-200 bg-violet-500/5 p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="new-claim-inv-reason" className="text-xs">What needs investigating? <span className="text-destructive">*</span></Label>
                    <Textarea id="new-claim-inv-reason" rows={2} value={newClaim.investigationReason}
                      onChange={(e) => setNewClaim((p) => ({ ...p, investigationReason: e.target.value }))}
                      placeholder="e.g. Date of death is two weeks after the policy started" data-testid="input-claim-investigation-reason" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="new-claim-inv-steps" className="text-xs">Next steps <span className="text-destructive">*</span></Label>
                    <Textarea id="new-claim-inv-steps" rows={2} value={newClaim.investigationNextSteps}
                      onChange={(e) => setNewClaim((p) => ({ ...p, investigationNextSteps: e.target.value }))}
                      placeholder="e.g. Get the medical records from the clinic" data-testid="input-claim-investigation-next-steps" />
                  </div>
                  <p className="text-[11px] text-muted-foreground">The claim starts under investigation and goes to the approvers once the findings are recorded.</p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Your recommendation goes to the approvals queue for a senior officer to act on.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetCreateForm(); setShowCreateDialog(false); }} data-testid="button-cancel-claim">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-claim">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {newClaim.recommendation === "investigate" ? "Log & Start Investigation" : "Submit to Approvals"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
