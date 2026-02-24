import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Filter, MoreHorizontal, FileWarning, Loader2, ArrowRightLeft, Eye } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import type { Claim } from "@shared/schema";

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

export default function StaffClaims() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [showDetailDialog, setShowDetailDialog] = useState(false);
  const [selectedClaim, setSelectedClaim] = useState<Claim | null>(null);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");

  const [newClaim, setNewClaim] = useState({
    policyId: "",
    clientId: "",
    claimType: "",
    deceasedName: "",
    deceasedRelationship: "",
    dateOfDeath: "",
    causeOfDeath: "",
  });

  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ["/api/claims"],
  });

  const { data: policies = [] } = useQuery<any[]>({
    queryKey: ["/api/policies"],
  });

  const { data: clientsList = [] } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newClaim) => {
      const res = await apiRequest("POST", "/api/claims", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      setShowCreateDialog(false);
      setNewClaim({ policyId: "", clientId: "", claimType: "", deceasedName: "", deceasedRelationship: "", dateOfDeath: "", causeOfDeath: "" });
      toast({ title: "Claim created", description: "New claim has been submitted successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, toStatus, reason }: { id: string; toStatus: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/claims/${id}/transition`, { toStatus, reason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/claims"] });
      setShowTransitionDialog(false);
      setSelectedClaim(null);
      setTransitionTarget("");
      setTransitionReason("");
      toast({ title: "Status updated", description: "Claim status has been transitioned." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "approved":
      case "paid":
      case "closed":
        return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
      case "submitted":
        return "bg-blue-500/15 text-blue-700 border-blue-200";
      case "verified":
      case "scheduled":
      case "payable":
      case "completed":
        return "bg-amber-500/15 text-amber-700 border-amber-200";
      case "rejected":
        return "bg-destructive/15 text-destructive border-destructive/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const filteredClaims = claims.filter((claim) => {
    const matchesSearch =
      !search ||
      claim.claimNumber?.toLowerCase().includes(search.toLowerCase()) ||
      claim.deceasedName?.toLowerCase().includes(search.toLowerCase()) ||
      claim.claimType?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || claim.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const openTransition = (claim: Claim) => {
    setSelectedClaim(claim);
    const nextStates = CLAIM_TRANSITIONS[claim.status] || [];
    setTransitionTarget(nextStates[0] || "");
    setTransitionReason("");
    setShowTransitionDialog(true);
  };

  const openDetail = (claim: Claim) => {
    setSelectedClaim(claim);
    setShowDetailDialog(true);
  };

  const handleCreate = () => {
    if (!newClaim.policyId || !newClaim.clientId || !newClaim.claimType) {
      toast({ title: "Validation", description: "Policy, client, and claim type are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(newClaim);
  };

  const handleTransition = () => {
    if (!selectedClaim || !transitionTarget) return;
    transitionMutation.mutate({ id: selectedClaim.id, toStatus: transitionTarget, reason: transitionReason });
  };

  const formatDate = (d: string | null | undefined) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString();
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-claims-title">Claims</h1>
            <p className="text-muted-foreground mt-1">Manage claim submissions, document verification, and adjudication.</p>
          </div>
          <Button className="gap-2 shadow-sm" onClick={() => setShowCreateDialog(true)} data-testid="button-new-claim">
            <Plus className="h-4 w-4" /> Log New Claim
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Claims Register</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
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
                  <SelectTrigger className="w-40" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2" />
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredClaims.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="text-no-claims">
                <FileWarning className="h-10 w-10 mb-3 opacity-50" />
                <p className="text-sm font-medium">No claims found</p>
                <p className="text-xs mt-1">Create a new claim or adjust your filters.</p>
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Claim #</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Deceased</TableHead>
                    <TableHead>Date of Death</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Cash-in-Lieu</TableHead>
                    <TableHead>Filed</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClaims.map((claim) => (
                    <TableRow key={claim.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-claim-${claim.id}`}>
                      <TableCell className="font-medium pl-6">
                        <div className="flex items-center gap-2">
                          <FileWarning className="h-4 w-4 text-primary/70" />
                          {claim.claimNumber}
                        </div>
                      </TableCell>
                      <TableCell className="text-sm capitalize">{claim.claimType?.replace(/_/g, " ")}</TableCell>
                      <TableCell>{claim.deceasedName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(claim.dateOfDeath)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-medium text-[10px] uppercase ${getStatusColor(claim.status)}`} data-testid={`status-claim-${claim.id}`}>
                          {claim.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {claim.cashInLieuAmount ? `$${parseFloat(claim.cashInLieuAmount).toFixed(2)}` : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{formatDate(claim.createdAt as any)}</TableCell>
                      <TableCell className="text-right pr-6">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-actions-claim-${claim.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
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
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Log New Claim</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="claim-policy">Policy</Label>
              <Select value={newClaim.policyId} onValueChange={(v) => setNewClaim((p) => ({ ...p, policyId: v }))}>
                <SelectTrigger data-testid="select-claim-policy">
                  <SelectValue placeholder="Select policy..." />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((pol: any) => (
                    <SelectItem key={pol.id} value={pol.id}>
                      {pol.policyNumber} — {pol.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-client">Client</Label>
              <Select value={newClaim.clientId} onValueChange={(v) => setNewClaim((p) => ({ ...p, clientId: v }))}>
                <SelectTrigger data-testid="select-claim-client">
                  <SelectValue placeholder="Select client..." />
                </SelectTrigger>
                <SelectContent>
                  {clientsList.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="claim-type">Claim Type</Label>
              <Select value={newClaim.claimType} onValueChange={(v) => setNewClaim((p) => ({ ...p, claimType: v }))}>
                <SelectTrigger data-testid="select-claim-type">
                  <SelectValue placeholder="Select type..." />
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
              <Label htmlFor="claim-relationship">Relationship</Label>
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
                  placeholder="Cause of death"
                  data-testid="input-claim-cause"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="button-cancel-claim">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="button-submit-claim">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Submit Claim
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                    <SelectValue placeholder="Select new status..." />
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
                  placeholder="Reason for this transition..."
                  data-testid="input-transition-reason"
                />
              </div>
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

      <Dialog open={showDetailDialog} onOpenChange={setShowDetailDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Claim Details</DialogTitle>
          </DialogHeader>
          {selectedClaim && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-muted-foreground">Claim Number</p>
                  <p className="font-medium" data-testid="text-detail-claim-number">{selectedClaim.claimNumber}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Status</p>
                  <Badge variant="outline" className={`font-medium text-[10px] uppercase ${getStatusColor(selectedClaim.status)}`}>
                    {selectedClaim.status}
                  </Badge>
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
                    {selectedClaim.cashInLieuAmount ? `$${parseFloat(selectedClaim.cashInLieuAmount).toFixed(2)}` : "—"}
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
              {selectedClaim.approvalNotes && (
                <div>
                  <p className="text-muted-foreground text-sm">Approval Notes</p>
                  <p className="text-sm mt-1 p-2 bg-muted/50 rounded">{selectedClaim.approvalNotes}</p>
                </div>
              )}
            </div>
          )}
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
