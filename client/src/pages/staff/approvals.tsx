import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Clock, Loader2, Eye, ShieldCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { getApiBase } from "@/lib/queryClient";

export default function StaffApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedApproval, setSelectedApproval] = useState<any>(null);
  const [resolveAction, setResolveAction] = useState<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [waiverRejectionReason, setWaiverRejectionReason] = useState("");
  const [resolvingWaiverId, setResolvingWaiverId] = useState<string | null>(null);
  const [waiverAction, setWaiverAction] = useState<"approve" | "reject" | null>(null);

  const { data: approvals, isLoading } = useQuery<any[]>({
    queryKey: ["/api/approvals"],
  });

  const { data: waivers, isLoading: waiversLoading } = useQuery<any[]>({
    queryKey: ["/api/waivers"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/waivers", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async ({ id, action, rejectionReason }: { id: string; action: string; rejectionReason?: string }) => {
      const res = await apiRequest("POST", `/api/approvals/${id}/resolve`, { action, rejectionReason });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/approvals"] });
      toast({ title: "Success", description: `Request ${resolveAction === "approve" ? "approved" : "rejected"} successfully.` });
      setResolveAction(null);
      setSelectedApproval(null);
      setRejectionReason("");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const pendingApprovals = approvals?.filter((a) => a.status === "pending") || [];
  const resolvedApprovals = approvals?.filter((a) => a.status !== "pending") || [];

  const filteredApprovals = activeTab === "pending" ? pendingApprovals : resolvedApprovals;

  const handleResolve = () => {
    if (!selectedApproval || !resolveAction) return;
    resolveMutation.mutate({
      id: selectedApproval.id,
      action: resolveAction,
      rejectionReason: resolveAction === "reject" ? rejectionReason : undefined,
    });
  };

  const requestTypeLabel: Record<string, string> = {
    CLAIM_REVIEW: "Claim Review",
    delete_policy: "Delete Policy",
    delete_receipt: "Delete Receipt",
    delete_quote: "Delete Quotation",
    legacy_policy: "Legacy Policy Activation",
  };

  const approvalColumns: EdtColumn<any>[] = [
    {
      id: "type",
      header: "Type",
      accessor: (a) => a.requestType,
      cell: (a) => <span className="font-medium">{requestTypeLabel[a.requestType] ?? a.requestType}</span>,
    },
    {
      id: "entity",
      header: "Details",
      accessor: (a) => `${a.entityType ?? ""} ${(a.requestData as any)?.policyNumber ?? (a.requestData as any)?.receiptNumber ?? (a.requestData as any)?.quotationNumber ?? a.entityId ?? ""}`,
      cell: (a) => {
        const d = a.requestData as any;
        const label = d?.policyNumber ?? d?.receiptNumber ?? d?.quotationNumber ?? null;
        return (
          <div>
            <span className="text-xs text-muted-foreground">{a.entityType}</span>
            {label && <><br /><span className="text-xs font-medium">{label}</span></>}
            {d?.reason && <><br /><span className="text-xs text-muted-foreground italic">{d.reason}</span></>}
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      accessor: (a) => a.status,
      cell: (a) => statusBadge(a.status),
    },
    {
      id: "created",
      header: "Created",
      accessor: (a) => (a.createdAt ? new Date(a.createdAt).getTime() : 0),
      cell: (a) => (
        <span className="text-sm text-muted-foreground">
          {a.createdAt ? new Date(a.createdAt).toLocaleDateString() : "—"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      exportable: false,
      cell: (approval) => (
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setSelectedApproval(approval)} data-testid={`btn-view-${approval.id}`}>
            <Eye className="h-4 w-4 mr-1" /> View
          </Button>
          {approval.status === "pending" && (
            <>
              <Button
                variant="outline"
                size="sm"
                className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                onClick={() => { setSelectedApproval(approval); setResolveAction("approve"); }}
                data-testid={`btn-approve-${approval.id}`}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 border-red-200 hover:bg-red-50"
                onClick={() => { setSelectedApproval(approval); setResolveAction("reject"); }}
                data-testid={`btn-reject-${approval.id}`}
              >
                <XCircle className="h-4 w-4 mr-1" /> Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const waiverColumns: EdtColumn<any>[] = [
    {
      id: "policy",
      header: "Policy",
      accessor: (w) => w.policyId,
      cell: (w) => (
        <Button variant="link" size="sm" className="p-0 h-auto text-sm" onClick={() => navigate(`/staff/policies?openPolicy=${w.policyId}`)}>
          View policy
        </Button>
      ),
    },
    {
      id: "status",
      header: "Status",
      accessor: (w) => w.status,
      cell: (w) => statusBadge(w.status),
    },
    {
      id: "reason",
      header: "Reason",
      accessor: (w) => w.reason || "",
      cell: (w) => <span className="text-sm truncate max-w-[200px] block">{w.reason || "—"}</span>,
    },
    {
      id: "created",
      header: "Requested",
      accessor: (w) => (w.createdAt ? new Date(w.createdAt).getTime() : 0),
      cell: (w) => <span className="text-sm text-muted-foreground">{w.createdAt ? new Date(w.createdAt).toLocaleDateString() : "—"}</span>,
    },
    {
      id: "actions",
      header: "Actions",
      align: "right",
      exportable: false,
      cell: (waiver) => waiver.status === "pending" ? (
        <div className="flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" className="text-emerald-600 border-emerald-200 hover:bg-emerald-50" onClick={() => { setResolvingWaiverId(waiver.id); setWaiverAction("approve"); }}>
            <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => { setResolvingWaiverId(waiver.id); setWaiverAction("reject"); }}>
            <XCircle className="h-4 w-4 mr-1" /> Reject
          </Button>
        </div>
      ) : null,
    },
  ];

  const statusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200" data-testid={`badge-status-${status}`}><Clock className="h-3 w-3 mr-1" />Pending</Badge>;
      case "approved":
        return <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200" data-testid={`badge-status-${status}`}><CheckCircle2 className="h-3 w-3 mr-1" />Approved</Badge>;
      case "rejected":
        return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200" data-testid={`badge-status-${status}`}><XCircle className="h-3 w-3 mr-1" />Rejected</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Approvals"
          description="Review and manage maker-checker approval requests."
          titleDataTestId="text-page-title"
        />

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div data-testid="card-pending-count">
            <KpiStatCard
              label="Pending"
              value={<span className="text-amber-600">{pendingApprovals.length}</span>}
              icon={Clock}
            />
          </div>
          <div data-testid="card-approved-count">
            <KpiStatCard
              label="Approved"
              value={<span className="text-emerald-600">{approvals?.filter((a) => a.status === "approved").length || 0}</span>}
              icon={CheckCircle2}
            />
          </div>
          <div data-testid="card-rejected-count">
            <KpiStatCard
              label="Rejected"
              value={<span className="text-red-600">{approvals?.filter((a) => a.status === "rejected").length || 0}</span>}
              icon={XCircle}
            />
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList>
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending {pendingApprovals.length > 0 && <Badge variant="secondary" className="ml-2 h-5 px-1.5">{pendingApprovals.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="resolved" data-testid="tab-resolved">Resolved</TabsTrigger>
            <TabsTrigger value="waivers" data-testid="tab-waivers">
              Waivers {(waivers?.filter(w => w.status === "pending").length ?? 0) > 0 && <Badge variant="secondary" className="ml-2 h-5 px-1.5">{waivers!.filter(w => w.status === "pending").length}</Badge>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            <CardSection title="Pending Approvals" description="These requests require your review and action." icon={ShieldCheck}>
              {isLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
                <EnhancedDataTable columns={approvalColumns} rows={pendingApprovals} getRowKey={(a) => a.id} rowTestId={(a) => `row-approval-${a.id}`} searchPlaceholder="Search approvals…" exportFilename="approvals-pending" storageKey="approvals-pending" emptyMessage="No pending approval requests" />
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="resolved" className="mt-4">
            <CardSection title="Resolved Approvals" description="Previously approved or rejected requests." icon={ShieldCheck}>
              {isLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
                <EnhancedDataTable columns={approvalColumns} rows={resolvedApprovals} getRowKey={(a) => a.id} rowTestId={(a) => `row-approval-${a.id}`} searchPlaceholder="Search approvals…" exportFilename="approvals-resolved" storageKey="approvals-resolved" emptyMessage="No resolved approval requests" />
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="waivers" className="mt-4">
            <CardSection title="Waiting Period Waivers" description="Review and act on waiting period waiver requests submitted by agents." icon={ShieldCheck}>
              {waiversLoading ? <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div> : (
                <EnhancedDataTable columns={waiverColumns} rows={waivers || []} getRowKey={(w) => w.id} rowTestId={(w) => `row-waiver-${w.id}`} searchPlaceholder="Search waivers…" exportFilename="waivers" storageKey="waivers" emptyMessage="No waiver requests" />
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      <Dialog open={!!selectedApproval && !resolveAction} onOpenChange={(open) => { if (!open) setSelectedApproval(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Approval Request Details</DialogTitle>
            <DialogDescription>Review the details of this approval request.</DialogDescription>
          </DialogHeader>
          {selectedApproval && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Request Type</Label>
                  <p className="font-medium" data-testid="text-request-type">{selectedApproval.requestType}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Status</Label>
                  <div data-testid="text-detail-status">{statusBadge(selectedApproval.status)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Entity Type</Label>
                  <p className="text-sm" data-testid="text-entity-type">{selectedApproval.entityType}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Entity ID</Label>
                  <p className="text-sm font-mono" data-testid="text-entity-id">{selectedApproval.entityId}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Created</Label>
                  <p className="text-sm">{selectedApproval.createdAt ? new Date(selectedApproval.createdAt).toLocaleString() : "—"}</p>
                </div>
                {selectedApproval.resolvedAt && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Resolved</Label>
                    <p className="text-sm">{new Date(selectedApproval.resolvedAt).toLocaleString()}</p>
                  </div>
                )}
              </div>
              {selectedApproval.requestData && (
                <div>
                  <Label className="text-xs text-muted-foreground">Request Data</Label>
                  <pre className="mt-1 text-xs bg-muted/50 p-3 rounded-md overflow-auto max-h-40" data-testid="text-request-data">
                    {JSON.stringify(selectedApproval.requestData, null, 2)}
                  </pre>
                </div>
              )}
              {selectedApproval.rejectionReason && (
                <div>
                  <Label className="text-xs text-muted-foreground">Rejection Reason</Label>
                  <p className="text-sm text-red-600" data-testid="text-rejection-reason">{selectedApproval.rejectionReason}</p>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            {selectedApproval?.status === "pending" && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                  onClick={() => setResolveAction("approve")}
                  data-testid="btn-dialog-approve"
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                </Button>
                <Button
                  variant="outline"
                  className="text-red-600 border-red-200 hover:bg-red-50"
                  onClick={() => setResolveAction("reject")}
                  data-testid="btn-dialog-reject"
                >
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!resolveAction} onOpenChange={(open) => { if (!open) { setResolveAction(null); setRejectionReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{resolveAction === "approve" ? "Approve Request" : "Reject Request"}</DialogTitle>
            <DialogDescription>
              {resolveAction === "approve"
                ? "Are you sure you want to approve this request?"
                : "Please provide a reason for rejecting this request."}
            </DialogDescription>
          </DialogHeader>
          {resolveAction === "reject" && (
            <div className="space-y-2">
              <Label htmlFor="rejectionReason">Rejection Reason</Label>
              <Textarea
                id="rejectionReason"
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="Enter the reason for rejection..."
                data-testid="input-rejection-reason"
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setResolveAction(null); setRejectionReason(""); }} data-testid="btn-cancel-resolve">
              Cancel
            </Button>
            <Button
              onClick={handleResolve}
              disabled={resolveMutation.isPending || (resolveAction === "reject" && !rejectionReason.trim())}
              className={resolveAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
              data-testid="btn-confirm-resolve"
            >
              {resolveMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : resolveAction === "approve" ? (
                <CheckCircle2 className="h-4 w-4 mr-1" />
              ) : (
                <XCircle className="h-4 w-4 mr-1" />
              )}
              {resolveAction === "approve" ? "Confirm Approval" : "Confirm Rejection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!resolvingWaiverId && !!waiverAction} onOpenChange={(open) => { if (!open) { setResolvingWaiverId(null); setWaiverAction(null); setWaiverRejectionReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{waiverAction === "approve" ? "Approve Waiver" : "Reject Waiver"}</DialogTitle>
            <DialogDescription>
              {waiverAction === "approve"
                ? "The waiting period will be marked as complete and the policy will be auto-activated if inactive."
                : "Provide a reason for rejection."}
            </DialogDescription>
          </DialogHeader>
          {waiverAction === "reject" && (
            <div className="space-y-2">
              <Label>Rejection Reason</Label>
              <Textarea value={waiverRejectionReason} onChange={(e) => setWaiverRejectionReason(e.target.value)} placeholder="Why is this waiver being rejected?" />
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setResolvingWaiverId(null); setWaiverAction(null); setWaiverRejectionReason(""); }}>Cancel</Button>
            <Button
              disabled={waiverAction === "reject" && !waiverRejectionReason.trim()}
              className={waiverAction === "approve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"}
              onClick={async () => {
                if (!resolvingWaiverId || !waiverAction) return;
                const res = await apiRequest("POST", `/api/waivers/${resolvingWaiverId}/resolve`, { action: waiverAction, rejectionReason: waiverRejectionReason || undefined });
                if (res.ok) {
                  queryClient.invalidateQueries({ queryKey: ["/api/waivers"] });
                  toast({ title: waiverAction === "approve" ? "Waiver approved" : "Waiver rejected" });
                  setResolvingWaiverId(null); setWaiverAction(null); setWaiverRejectionReason("");
                } else {
                  const e = await res.json().catch(() => ({}));
                  toast({ title: "Error", description: e.message, variant: "destructive" });
                }
              }}
            >
              {waiverAction === "approve" ? <><CheckCircle2 className="h-4 w-4 mr-1" /> Approve</> : <><XCircle className="h-4 w-4 mr-1" /> Reject</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
