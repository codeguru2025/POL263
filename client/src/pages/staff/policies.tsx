import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useState, useMemo } from "react";
import { Plus, Search, Filter, MoreHorizontal, FileText, ArrowRightLeft, Users, CreditCard, Loader2, ChevronLeft, Eye } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  draft: ["pending"],
  pending: ["active"],
  active: ["grace", "cancelled"],
  grace: ["active", "lapsed"],
  lapsed: ["reinstatement_pending", "cancelled"],
  reinstatement_pending: ["active"],
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending: "Pending",
  active: "Active",
  grace: "Grace",
  lapsed: "Lapsed",
  reinstatement_pending: "Reinstatement Pending",
  cancelled: "Cancelled",
};

function getStatusColor(status: string) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    case "grace": return "bg-amber-500/15 text-amber-700 border-amber-200";
    case "lapsed": return "bg-destructive/15 text-destructive border-destructive/30";
    case "pending": return "bg-blue-500/15 text-blue-700 border-blue-200";
    case "draft": return "bg-muted text-muted-foreground border-border";
    case "reinstatement_pending": return "bg-purple-500/15 text-purple-700 border-purple-200";
    case "cancelled": return "bg-gray-500/15 text-gray-600 border-gray-200";
    default: return "bg-muted text-muted-foreground";
  }
}

export default function StaffPolicies() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [showDetailView, setShowDetailView] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");

  const [createForm, setCreateForm] = useState({
    clientId: "",
    productVersionId: "",
    premiumAmount: "",
    currency: "USD",
    paymentSchedule: "monthly",
    effectiveDate: "",
  });

  const { data: policies, isLoading: policiesLoading } = useQuery<any[]>({
    queryKey: ["/api/policies"],
  });

  const { data: clients } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: policyMembers, isLoading: membersLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "members"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(`/api/policies/${selectedPolicy.id}/members`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load members");
      return res.json();
    },
  });

  const { data: policyPayments, isLoading: paymentsLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "payments"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(`/api/policies/${selectedPolicy.id}/payments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load payments");
      return res.json();
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      const res = await apiRequest("POST", "/api/policies", {
        clientId: data.clientId,
        productVersionId: data.productVersionId,
        premiumAmount: data.premiumAmount,
        currency: data.currency,
        paymentSchedule: data.paymentSchedule,
        effectiveDate: data.effectiveDate || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setShowCreateDialog(false);
      setCreateForm({ clientId: "", productVersionId: "", premiumAmount: "", currency: "USD", paymentSchedule: "monthly", effectiveDate: "" });
      toast({ title: "Policy created", description: "New policy has been created in draft status." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const transitionMutation = useMutation({
    mutationFn: async ({ id, toStatus, reason }: { id: string; toStatus: string; reason: string }) => {
      const res = await apiRequest("POST", `/api/policies/${id}/transition`, { toStatus, reason });
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setShowTransitionDialog(false);
      setTransitionTarget("");
      setTransitionReason("");
      if (showDetailView) setSelectedPolicy(updated);
      toast({ title: "Status updated", description: `Policy transitioned to ${STATUS_LABELS[updated.status] || updated.status}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Transition failed", description: err.message, variant: "destructive" });
    },
  });

  const filteredPolicies = useMemo(() => {
    if (!policies) return [];
    return policies.filter((p: any) => {
      const matchesSearch = !search ||
        p.policyNumber?.toLowerCase().includes(search.toLowerCase()) ||
        p.clientId?.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [policies, search, statusFilter]);

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients?.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const getClientName = (clientId: string) => {
    const c = clientMap[clientId];
    return c ? `${c.firstName} ${c.lastName}` : clientId?.slice(0, 8) + "...";
  };

  const openTransition = (policy: any) => {
    setSelectedPolicy(policy);
    setTransitionTarget("");
    setTransitionReason("");
    setShowTransitionDialog(true);
  };

  const openDetail = (policy: any) => {
    setSelectedPolicy(policy);
    setShowDetailView(true);
  };

  if (showDetailView && selectedPolicy) {
    const allowedTransitions = VALID_POLICY_TRANSITIONS[selectedPolicy.status] || [];
    return (
      <StaffLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => { setShowDetailView(false); setSelectedPolicy(null); }} data-testid="btn-back-policies">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-policy-number">{selectedPolicy.policyNumber}</h1>
              <p className="text-muted-foreground mt-1">Policy details, members, and payment history</p>
            </div>
            <Badge variant="outline" className={`font-medium text-sm px-3 py-1 ${getStatusColor(selectedPolicy.status)}`} data-testid="badge-policy-status">
              {STATUS_LABELS[selectedPolicy.status] || selectedPolicy.status}
            </Badge>
            {allowedTransitions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="btn-transition-policy">
                    <ArrowRightLeft className="h-4 w-4" /> Transition
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {allowedTransitions.map((t) => (
                    <DropdownMenuItem key={t} onClick={() => { setTransitionTarget(t); setTransitionReason(""); setShowTransitionDialog(true); }} data-testid={`menu-transition-${t}`}>
                      → {STATUS_LABELS[t] || t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Premium</CardTitle></CardHeader>
              <CardContent>
                <p className="text-2xl font-bold" data-testid="text-premium-amount">{selectedPolicy.currency} {Number(selectedPolicy.premiumAmount).toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">{selectedPolicy.paymentSchedule}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Client</CardTitle></CardHeader>
              <CardContent>
                <p className="text-lg font-semibold" data-testid="text-policy-client">{getClientName(selectedPolicy.clientId)}</p>
              </CardContent>
            </Card>
            <Card className="shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Effective Date</CardTitle></CardHeader>
              <CardContent>
                <p className="text-lg font-semibold" data-testid="text-effective-date">{selectedPolicy.effectiveDate || "Not set"}</p>
              </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Policy Members</CardTitle>
              <CardDescription>People covered under this policy</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {membersLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : policyMembers && policyMembers.length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Member</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyMembers.map((m: any) => (
                      <TableRow key={m.id} data-testid={`row-member-${m.id}`}>
                        <TableCell className="pl-6 font-medium">
                          {m.clientId ? getClientName(m.clientId) : m.dependentId?.slice(0, 8) + "..."}
                        </TableCell>
                        <TableCell>{m.role}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={m.isActive ? "bg-emerald-500/15 text-emerald-700" : "bg-gray-500/15 text-gray-600"}>
                            {m.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground" data-testid="text-no-members">No members found for this policy.</div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Payment History</CardTitle>
              <CardDescription>Transactions recorded against this policy</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {paymentsLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : policyPayments && policyPayments.length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyPayments.map((p: any) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell className="pl-6">{p.postedDate || new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="font-medium">{p.currency} {Number(p.amount).toFixed(2)}</TableCell>
                        <TableCell>{p.paymentMethod}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={p.status === "cleared" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                            {p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground" data-testid="text-no-payments">No payments recorded for this policy.</div>
              )}
            </CardContent>
          </Card>
        </div>

        <Dialog open={showTransitionDialog} onOpenChange={setShowTransitionDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transition Policy Status</DialogTitle>
              <DialogDescription>
                Transition from <strong>{STATUS_LABELS[selectedPolicy.status]}</strong> to <strong>{STATUS_LABELS[transitionTarget] || transitionTarget}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Reason</Label>
                <Textarea
                  value={transitionReason}
                  onChange={(e) => setTransitionReason(e.target.value)}
                  placeholder="Provide a reason for this status change..."
                  data-testid="input-transition-reason"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowTransitionDialog(false)}>Cancel</Button>
              <Button
                onClick={() => transitionMutation.mutate({ id: selectedPolicy.id, toStatus: transitionTarget, reason: transitionReason })}
                disabled={transitionMutation.isPending}
                data-testid="btn-confirm-transition"
              >
                {transitionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Transition
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Policies</h1>
            <p className="text-muted-foreground mt-1">Manage policy lifecycles, billing cycles, and status transitions.</p>
          </div>
          <Button className="gap-2 shadow-sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-policy">
            <Plus className="h-4 w-4" /> Issue New Policy
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Policy Directory</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by policy number..."
                    className="pl-9 bg-background"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-policies"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="All Statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="grace">Grace</SelectItem>
                    <SelectItem value="lapsed">Lapsed</SelectItem>
                    <SelectItem value="reinstatement_pending">Reinstatement Pending</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {policiesLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredPolicies.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground" data-testid="text-no-policies">
                {policies?.length === 0 ? "No policies found. Create your first policy to get started." : "No policies match your search criteria."}
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Policy Number</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Premium</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead>Effective Date</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredPolicies.map((policy: any) => (
                    <TableRow key={policy.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openDetail(policy)} data-testid={`row-policy-${policy.id}`}>
                      <TableCell className="font-medium pl-6">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary/70" />
                          {policy.policyNumber}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-client-${policy.id}`}>{getClientName(policy.clientId)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-medium ${getStatusColor(policy.status)}`} data-testid={`badge-status-${policy.id}`}>
                          {STATUS_LABELS[policy.status] || policy.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{policy.currency} {Number(policy.premiumAmount).toFixed(2)}</TableCell>
                      <TableCell className="text-muted-foreground capitalize">{policy.paymentSchedule}</TableCell>
                      <TableCell className="text-muted-foreground">{policy.effectiveDate || "—"}</TableCell>
                      <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`btn-actions-${policy.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(policy)} data-testid={`menu-view-${policy.id}`}>
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
                            {(VALID_POLICY_TRANSITIONS[policy.status] || []).length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                {VALID_POLICY_TRANSITIONS[policy.status]?.map((t) => (
                                  <DropdownMenuItem key={t} onClick={() => { setSelectedPolicy(policy); setTransitionTarget(t); setTransitionReason(""); setShowTransitionDialog(true); }} data-testid={`menu-transition-${policy.id}-${t}`}>
                                    <ArrowRightLeft className="h-4 w-4 mr-2" /> → {STATUS_LABELS[t] || t}
                                  </DropdownMenuItem>
                                ))}
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue New Policy</DialogTitle>
            <DialogDescription>Create a new policy in draft status. You can transition it later.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Client</Label>
              <Select value={createForm.clientId} onValueChange={(v) => setCreateForm({ ...createForm, clientId: v })}>
                <SelectTrigger data-testid="select-client">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  {clients?.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.firstName} {c.lastName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Product</Label>
              <Select value={createForm.productVersionId} onValueChange={(v) => setCreateForm({ ...createForm, productVersionId: v })}>
                <SelectTrigger data-testid="select-product-version">
                  <SelectValue placeholder="Select a product version..." />
                </SelectTrigger>
                <SelectContent>
                  {products?.map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Premium Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={createForm.premiumAmount}
                  onChange={(e) => setCreateForm({ ...createForm, premiumAmount: e.target.value })}
                  placeholder="0.00"
                  data-testid="input-premium-amount"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={createForm.currency} onValueChange={(v) => setCreateForm({ ...createForm, currency: v })}>
                  <SelectTrigger data-testid="select-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Payment Schedule</Label>
                <Select value={createForm.paymentSchedule} onValueChange={(v) => setCreateForm({ ...createForm, paymentSchedule: v })}>
                  <SelectTrigger data-testid="select-schedule">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Effective Date</Label>
                <Input
                  type="date"
                  value={createForm.effectiveDate}
                  onChange={(e) => setCreateForm({ ...createForm, effectiveDate: e.target.value })}
                  data-testid="input-effective-date"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
            <Button
              onClick={() => createMutation.mutate(createForm)}
              disabled={createMutation.isPending || !createForm.clientId || !createForm.productVersionId || !createForm.premiumAmount}
              data-testid="btn-submit-policy"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showTransitionDialog} onOpenChange={setShowTransitionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transition Policy Status</DialogTitle>
            <DialogDescription>
              Transition <strong>{selectedPolicy?.policyNumber}</strong> from <strong>{STATUS_LABELS[selectedPolicy?.status] || selectedPolicy?.status}</strong> to <strong>{STATUS_LABELS[transitionTarget] || transitionTarget}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Reason</Label>
              <Textarea
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
                placeholder="Provide a reason for this status change..."
                data-testid="input-transition-reason"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTransitionDialog(false)}>Cancel</Button>
            <Button
              onClick={() => selectedPolicy && transitionMutation.mutate({ id: selectedPolicy.id, toStatus: transitionTarget, reason: transitionReason })}
              disabled={transitionMutation.isPending}
              data-testid="btn-confirm-transition"
            >
              {transitionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
