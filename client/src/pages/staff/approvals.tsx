import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard } from "@/components/ds";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CheckCircle2, XCircle, Clock, Loader2, Eye, ShieldCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export default function StaffApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("pending");
  const [selectedApproval, setSelectedApproval] = useState<any>(null);
  const [resolveAction, setResolveAction] = useState<"approve" | "reject" | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const { data: approvals, isLoading } = useQuery<any[]>({
    queryKey: ["/api/approvals"],
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
          <TabsList className="grid w-full grid-cols-2 max-w-sm">
            <TabsTrigger value="pending" data-testid="tab-pending">
              Pending {pendingApprovals.length > 0 && <Badge variant="secondary" className="ml-2 h-5 px-1.5">{pendingApprovals.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="resolved" data-testid="tab-resolved">Resolved</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>{activeTab === "pending" ? "Pending Approvals" : "Resolved Approvals"}</CardTitle>
                <CardDescription>
                  {activeTab === "pending"
                    ? "These requests require your review and action."
                    : "Previously approved or rejected requests."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : filteredApprovals.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <ShieldCheck className="h-12 w-12 mb-3 opacity-30" />
                    <p className="text-sm">No {activeTab} approval requests.</p>
                  </div>
                ) : (
                  <div className="border rounded-md overflow-hidden">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead>Type</TableHead>
                          <TableHead>Entity</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Created</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredApprovals.map((approval: any) => (
                          <TableRow key={approval.id} data-testid={`row-approval-${approval.id}`}>
                            <TableCell>
                              <span className="font-medium">{approval.requestType}</span>
                            </TableCell>
                            <TableCell>
                              <span className="text-xs text-muted-foreground">{approval.entityType}</span>
                              <br />
                              <span className="text-xs font-mono">{approval.entityId?.slice(0, 8)}...</span>
                            </TableCell>
                            <TableCell>{statusBadge(approval.status)}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">
                              {approval.createdAt ? new Date(approval.createdAt).toLocaleDateString() : "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() => setSelectedApproval(approval)}
                                  data-testid={`btn-view-${approval.id}`}
                                >
                                  <Eye className="h-4 w-4 mr-1" /> View
                                </Button>
                                {approval.status === "pending" && (
                                  <>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                                      onClick={() => {
                                        setSelectedApproval(approval);
                                        setResolveAction("approve");
                                      }}
                                      data-testid={`btn-approve-${approval.id}`}
                                    >
                                      <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-red-600 border-red-200 hover:bg-red-50"
                                      onClick={() => {
                                        setSelectedApproval(approval);
                                        setResolveAction("reject");
                                      }}
                                      data-testid={`btn-reject-${approval.id}`}
                                    >
                                      <XCircle className="h-4 w-4 mr-1" /> Reject
                                    </Button>
                                  </>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
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
    </StaffLayout>
  );
}
