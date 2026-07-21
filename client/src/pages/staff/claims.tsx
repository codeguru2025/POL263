import { useState, useEffect } from "react";
import { useSearch, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { PageHeader, PageShell, CardSection, FilterBar, EmptyState, StatusBadge, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { AiInsightsPanel } from "@/components/ai-insights-panel";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PolicySearchInput } from "@/components/policy-search-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Filter, MoreHorizontal, FileWarning, Loader2, ArrowRightLeft, Eye, FileDown, AlertTriangle } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { formatAmountWithCode } from "@shared/validation";
import type { Claim } from "@shared/schema";

/** The claims list is left-joined server-side with any linked funeral case — see
 *  storage.getClaimsByOrg — so the Claims<->Funerals cross-link needs no extra fetch. */
type ClaimWithFuneralCase = Claim & { funeralCaseId: string | null; funeralCaseNumber: string | null };

const CLAIM_TRANSITIONS: Record<string, string[]> = {
  submitted: ["verified", "rejected"],
  verified: ["approved", "rejected"],
  approved: ["scheduled", "payable"],
  scheduled: ["completed"],
  payable: ["paid"],
  completed: ["closed"],
  paid: ["closed"],
};

const CLAIM_TYPES = ["death", "accidental_death", "disability", "repatriation", "cash_in_lieu"];

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
};

export default function StaffClaims() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("create") === "1",
  );
  const createSearch = useSearch();
  useEffect(() => {
    if (new URLSearchParams(createSearch).get("create") === "1") setShowCreateDialog(true);
  }, [createSearch]);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<ClaimWithFuneralCase | null>(null);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [waitingPeriodOverrideReason, setWaitingPeriodOverrideReason] = useState("");

  const [newClaim, setNewClaim] = useState({ ...BLANK_CLAIM });

  // Policy + member state for the create form
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [policyMembers, setPolicyMembers] = useState<any[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");

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

  const handlePolicySelect = (id: string, policy: any) => {
    setNewClaim((p) => ({ ...p, policyId: id, clientId: policy?.clientId || "" }));
    setSelectedPolicy(policy || null);
    setSelectedMemberId("");
    setPolicyMembers([]);
    if (id) {
      setLoadingMembers(true);
      fetch(getApiBase() + `/api/policies/${id}/members`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : []))
        .then((data) => setPolicyMembers(Array.isArray(data) ? data : []))
        .catch(() => setPolicyMembers([]))
        .finally(() => setLoadingMembers(false));
    }
  };

  const resetCreateForm = () => {
    setNewClaim({ ...BLANK_CLAIM });
    setSelectedPolicy(null);
    setPolicyMembers([]);
    setSelectedMemberId("");
    setCaseSearch("");
    setFoundCase(null);
    setCaseLookupError("");
  };

  const { data: claims = [], isLoading, isError: claimsError, error: claimsErrorObj, refetch: refetchClaims } = useQuery<ClaimWithFuneralCase[]>({
    queryKey: ["/api/claims"],
  });

  // Deep-link support for the Funerals<->Claims cross-link (funerals.tsx links here via
  // ?openClaim=), matching the ?openPolicy= pattern already used on the Policies page.
  useEffect(() => {
    const id = new URLSearchParams(createSearch).get("openClaim");
    if (!id || claims.length === 0) return;
    const claim = claims.find((c) => c.id === id);
    if (claim) {
      setSelectedClaim(claim);
      setShowDetailDialog(true);
    }
  }, [createSearch, claims]);

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/claims", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      setShowCreateDialog(false);
      resetCreateForm();
      toast({ title: "Claim submitted", description: "Claim has been submitted to the approvals queue." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, toStatus, reason, waitingPeriodOverrideReason }: { id: string; toStatus: string; reason: string; waitingPeriodOverrideReason?: string }) => {
      const res = await apiRequest("POST", `/api/claims/${id}/transition`, { toStatus, reason, waitingPeriodOverrideReason: waitingPeriodOverrideReason || undefined });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      setShowTransitionDialog(false);
      setSelectedClaim(null);
      setTransitionTarget("");
      setTransitionReason("");
      setWaitingPeriodOverrideReason("");
      toast({ title: "Status updated", description: "Claim status has been transitioned." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredClaims = claims.filter((claim) => {
    const matchesSearch =
      !search ||
      claim.claimNumber?.toLowerCase().includes(search.toLowerCase()) ||
      claim.deceasedName?.toLowerCase().includes(search.toLowerCase()) ||
      claim.claimType?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openTransition = (claim: ClaimWithFuneralCase) => {
    setSelectedClaim(claim);
    const nextStates = CLAIM_TRANSITIONS[claim.status] || [];
    setTransitionTarget(nextStates[0] || "");
    setTransitionReason("");
    setWaitingPeriodOverrideReason("");
    setShowTransitionDialog(true);
  };

  const openDetail = (claim: ClaimWithFuneralCase) => {
    setSelectedClaim(claim);
    setShowDetailDialog(true);
  };

  const handleCreate = () => {
    if (!newClaim.policyId || !newClaim.claimType) {
      toast({ title: "Validation", description: "Policy and claim type are required.", variant: "destructive" });
      return;
    }
    const approvalNotes = [
      newClaim.assessmentNotes ? `Assessment: ${newClaim.assessmentNotes}` : "",
      newClaim.recommendation ? `Recommendation: ${newClaim.recommendation.replace(/_/g, " ")}` : "",
    ].filter(Boolean).join("\n\n") || undefined;

    createMutation.mutate({
      policyId: newClaim.policyId,
      clientId: newClaim.clientId || undefined,
      funeralCaseId: foundCase?.id || undefined,
      claimType: newClaim.claimType,
      deceasedName: newClaim.deceasedName || undefined,
      deceasedRelationship: newClaim.deceasedRelationship || undefined,
      dateOfDeath: newClaim.dateOfDeath || undefined,
      causeOfDeath: newClaim.causeOfDeath || undefined,
      cashInLieuAmount: newClaim.cashInLieuAmount || undefined,
      currency: newClaim.currency,
      approvalNotes,
    });
  };

  const handleTransition = () => {
    if (!selectedClaim || !transitionTarget) return;
    transitionMutation.mutate({ id: selectedClaim.id, toStatus: transitionTarget, reason: transitionReason, waitingPeriodOverrideReason });
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  };

  // Parse structured approvalNotes back into sections for display
  const parseApprovalNotes = (notes: string | null | undefined) => {
    if (!notes) return { assessment: "", recommendation: "", raw: "" };
    const assessmentMatch = notes.match(/^Assessment:\s*([\s\S]*?)(?=\n\nRecommendation:|$)/m);
    const recommendationMatch = notes.match(/Recommendation:\s*([\s\S]*)$/m);
    return {
      assessment: assessmentMatch?.[1]?.trim() || "",
      recommendation: recommendationMatch?.[1]?.trim() || "",
      raw: notes,
    };
  };

  const claimColumns: EdtColumn<ClaimWithFuneralCase>[] = [
    {
      id: "claimNumber",
      header: "Claim #",
      accessor: (c) => c.claimNumber,
      cell: (c) => (
        <div className="flex items-center gap-2">
          <FileWarning className="h-4 w-4 text-primary/70 shrink-0" />
          {c.claimNumber}
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
      header: "Cash-in-Lieu",
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
      id: "actions",
      header: "Actions",
      align: "right",
      sortable: false,
      exportable: false,
      headClassName: "text-right pr-6",
      cellClassName: "text-right pr-6",
      cell: (claim) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-actions-claim-${claim.id}`} aria-label="Claim actions">
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => openDetail(claim)} data-testid={`button-view-claim-${claim.id}`}>
              <Eye className="h-4 w-4 mr-2" /> View Details
            </DropdownMenuItem>
            {CLAIM_TRANSITIONS[claim.status] && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openTransition(claim)} data-testid={`button-transition-claim-${claim.id}`}>
                  <ArrowRightLeft className="h-4 w-4 mr-2" /> Transition Status
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Claims"
          description="Manage claim submissions, document verification, and adjudication."
          titleDataTestId="text-claims-title"
          actions={(
            <div className="flex gap-2 flex-wrap">
              <Button variant="outline" className="gap-1.5 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" asChild>
                <a href={getApiBase() + "/api/forms/blank/claim-submission"} target="_blank" rel="noopener noreferrer">
                  <FileDown className="h-4 w-4" /> Blank Claim Form
                </a>
              </Button>
              <Button className="gap-2 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => setShowCreateDialog(true)} data-testid="button-new-claim">
                <Plus className="h-4 w-4" /> Log New Claim
              </Button>
            </div>
          )}
        />

        <AiInsightsPanel surface="claims" title="AI Insights" description="Ask AI to summarize claims activity and flag anything unusual." />

        <CardSection title="Claims register" description="Search and filter the live claims ledger." flush>
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
                  <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="submitted">Submitted</SelectItem>
                    <SelectItem value="verified">Verified</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="payable">Payable</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="closed">Closed</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
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
      </PageShell>

      {/* ── Create claim dialog ── */}
      <Dialog open={showCreateDialog} onOpenChange={(v) => { if (!v) resetCreateForm(); setShowCreateDialog(v); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Log New Claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">

            {/* Step 1: Find the policy */}
            <div className="space-y-2">
              <Label htmlFor="claim-policy">Policy <span className="text-destructive">*</span></Label>
              <PolicySearchInput
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
                    <Label className="text-xs font-medium">Deceased Covered Member</Label>
                    <Select
                      value={selectedMemberId || "__none__"}
                      onValueChange={(v) => {
                        if (v === "__none__") { setSelectedMemberId(""); return; }
                        setSelectedMemberId(v);
                        const m = policyMembers.find((x: any) => String(x.id) === v);
                        if (m) {
                          setNewClaim((p) => ({
                            ...p,
                            deceasedName: m.memberName || p.deceasedName,
                            deceasedRelationship: m.relationship && m.relationship !== "Policy Holder" ? m.relationship : p.deceasedRelationship,
                          }));
                        }
                      }}
                    >
                      <SelectTrigger data-testid="select-deceased-member">
                        <SelectValue placeholder="Select covered member…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Select member —</SelectItem>
                        {policyMembers.map((m: any) => (
                          <SelectItem key={m.id} value={String(m.id)}>
                            {m.memberName || "Member"} · {(m.role || m.relationship || "member").replace(/_/g, " ")}
                            {m.age != null ? ` · ${m.age}y` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-[10px] text-muted-foreground">Selecting a member auto-fills the deceased name and relationship below.</p>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No covered members found on this policy — fill in deceased details manually.</p>
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
                <SelectTrigger data-testid="select-claim-type">
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
            <div className="grid grid-cols-2 gap-4">
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
              <Label>Cash-in-Lieu Amount <span className="text-muted-foreground text-xs">(optional)</span></Label>
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
                  onChange={(e) => setNewClaim((p) => ({ ...p, cashInLieuAmount: e.target.value }))}
                  data-testid="input-claim-cash-in-lieu"
                />
              </div>
            </div>

            {/* Assessment */}
            <div className="space-y-2">
              <Label>Assessment Notes</Label>
              <Textarea
                placeholder="Document your assessment of this claim — supporting documents received, waiting period status, fraud indicators, etc."
                value={newClaim.assessmentNotes}
                onChange={(e) => setNewClaim((p) => ({ ...p, assessmentNotes: e.target.value }))}
                rows={3}
                data-testid="input-claim-assessment"
              />
            </div>

            {/* Recommendation */}
            <div className="space-y-2">
              <Label>Recommendation</Label>
              <Select
                value={newClaim.recommendation || "__none__"}
                onValueChange={(v) => setNewClaim((p) => ({ ...p, recommendation: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger data-testid="select-claim-recommendation">
                  <SelectValue placeholder="Select recommendation…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— No recommendation yet —</SelectItem>
                  <SelectItem value="approve">Recommend Approval</SelectItem>
                  <SelectItem value="reject">Recommend Rejection</SelectItem>
                  <SelectItem value="investigate">Further Investigation Required</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Your recommendation is submitted to the approvals queue for a senior officer to act on.</p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetCreateForm(); setShowCreateDialog(false); }} data-testid="button-cancel-claim">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-claim">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit to Approvals
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Transition dialog ── */}
      <Dialog open={showTransitionDialog} onOpenChange={setShowTransitionDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Transition Claim Status</DialogTitle>
          </DialogHeader>
          {selectedClaim && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm font-medium">{selectedClaim.claimNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    Current status: <span className="font-semibold uppercase">{selectedClaim.status}</span>
                  </p>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Transition To</Label>
                <Select value={transitionTarget} onValueChange={setTransitionTarget}>
                  <SelectTrigger data-testid="select-transition-target">
                    <SelectValue placeholder="Select new status…" />
                  </SelectTrigger>
                  <SelectContent>
                    {(CLAIM_TRANSITIONS[selectedClaim.status] || []).map((s) => (
                      <SelectItem key={s} value={s}>
                        {s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Reason / Notes</Label>
                <Textarea
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="Reason for this transition…"
                  data-testid="input-transition-reason"
                />
              </div>
              {transitionTarget === "approved" && (
                <div className="space-y-2">
                  <Label>Waiting Period Override (only if this death occurred before the policy's waiting period ended)</Label>
                  <Textarea
                    value={waitingPeriodOverrideReason}
                    onChange={(e) => setWaitingPeriodOverrideReason(e.target.value)}
                    placeholder="Leave blank unless approval is rejected for a waiting-period violation — then explain why it should be approved anyway…"
                    data-testid="input-waiting-period-override"
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransitionDialog(false)} data-testid="button-cancel-transition">
              Cancel
            </Button>
            <Button onClick={handleTransition} disabled={transitionMutation.isPending || !transitionTarget} data-testid="button-confirm-transition">
              {transitionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Detail dialog ── */}
      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Claim Details</DialogTitle>
          </DialogHeader>
          {selectedClaim && (() => {
            const { assessment, recommendation } = parseApprovalNotes(selectedClaim.approvalNotes);
            return (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Claim Number</p>
                    <p className="font-medium" data-testid="text-detail-claim-number">{selectedClaim.claimNumber}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Status</p>
                    <StatusBadge variant="claim" status={selectedClaim.status} />
                  </div>
                  <div>
                    <p className="text-muted-foreground">Claim Type</p>
                    <p className="font-medium capitalize">{selectedClaim.claimType?.replace(/_/g, " ")}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Date of Death</p>
                    <p className="font-medium">{formatDate(selectedClaim.dateOfDeath)}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Deceased Name</p>
                    <p className="font-medium">{selectedClaim.deceasedName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Relationship</p>
                    <p className="font-medium">{selectedClaim.deceasedRelationship || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cause of Death</p>
                    <p className="font-medium">{selectedClaim.causeOfDeath || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Cash-in-Lieu</p>
                    <p className="font-medium">
                      {selectedClaim.cashInLieuAmount ? formatAmountWithCode(selectedClaim.cashInLieuAmount, selectedClaim.currency) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Waiting Period Waived</p>
                    <p className="font-medium">{selectedClaim.isWaitingPeriodWaived ? "Yes" : "No"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Filed</p>
                    <p className="font-medium">{formatDate(selectedClaim.createdAt as any)}</p>
                  </div>
                </div>
                {selectedClaim.funeralCaseId && (
                  <Link
                    href={`/staff/funerals?openCase=${selectedClaim.funeralCaseId}`}
                    className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
                    data-testid="link-view-funeral-case"
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                    View funeral case {selectedClaim.funeralCaseNumber ? `(${selectedClaim.funeralCaseNumber})` : ""}
                  </Link>
                )}
                {assessment && (
                  <div>
                    <p className="text-muted-foreground text-sm font-medium">Assessment</p>
                    <p className="text-sm mt-1 p-2 bg-muted/50 rounded whitespace-pre-wrap">{assessment}</p>
                  </div>
                )}
                {recommendation && (
                  <div>
                    <p className="text-muted-foreground text-sm font-medium">Recommendation</p>
                    <p className="text-sm mt-1 p-2 bg-muted/50 rounded capitalize">{recommendation}</p>
                  </div>
                )}
                {selectedClaim.approvalNotes && !assessment && !recommendation && (
                  <div>
                    <p className="text-muted-foreground text-sm">Notes</p>
                    <p className="text-sm mt-1 p-2 bg-muted/50 rounded">{selectedClaim.approvalNotes}</p>
                  </div>
                )}
              </div>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailDialog(false)} data-testid="button-close-detail">
              Close
            </Button>
            {selectedClaim && CLAIM_TRANSITIONS[selectedClaim.status] && (
              <Button
                onClick={() => {
                  setShowDetailDialog(false);
                  openTransition(selectedClaim);
                }}
                data-testid="button-detail-transition"
              >
                <ArrowRightLeft className="h-4 w-4 mr-2" /> Transition Status
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
