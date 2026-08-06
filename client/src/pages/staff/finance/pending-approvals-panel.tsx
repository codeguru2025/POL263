import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Clock, ShieldCheck, ShieldX } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { QK_PENDING_APPROVALS } from "./query-keys";

function pendingApprovalsColumns(opts: { onAction: (id: string, type: "approve" | "reject") => void }): EdtColumn<any>[] {
  const { onAction } = opts;
  return [
    { id: "receiptNumber", header: "Receipt #", accessor: (r) => r.receiptNumber, cell: (r) => <span className="font-mono text-sm">{r.receiptNumber}</span> },
    { id: "policy", header: "Policy", accessor: (r) => r.policyNumber || r.policyId || "", cell: (r) => <span className="text-sm">{r.policyNumber || r.policyId?.slice(0, 8)}</span> },
    { id: "client", header: "Client", accessor: (r) => r.clientName || "", cell: (r) => <span className="text-sm">{r.clientName || "—"}</span> },
    {
      id: "reason",
      header: "Reason",
      accessor: (r) => (r.metadataJson?.premiumOverride ? "Premium override" : `Backdated to ${r.backdatedDate || "—"}`),
      cell: (r) => {
        const isOverride = !!r.metadataJson?.premiumOverride;
        return (
          <span className="text-sm">
            {isOverride
              ? <span className="text-amber-700">Premium override <span className="text-muted-foreground">(system: {r.currency} {parseFloat(r.metadataJson?.systemPremium ?? 0).toFixed(2)})</span></span>
              : <span>Backdated to {r.backdatedDate || "—"}</span>}
          </span>
        );
      },
    },
    { id: "amount", header: "Amount", accessor: (r) => parseFloat(r.amount), cell: (r) => <span className="text-sm font-medium">{r.currency} {parseFloat(r.amount).toFixed(2)}</span> },
    { id: "submitterNote", header: "Submitter Note", accessor: (r) => r.submitterNote || "", cell: (r) => <span className="text-sm text-muted-foreground max-w-[200px] truncate block" title={r.submitterNote}>{r.submitterNote || "—"}</span> },
    {
      id: "actions",
      header: "Actions",
      sortable: false,
      exportable: false,
      cell: (r) => (
        <div className="flex items-center justify-end gap-1">
          <Button size="sm" variant="outline" className="gap-1.5 text-green-700 border-green-200 hover:bg-green-50" onClick={() => onAction(r.id, "approve")} data-testid={`btn-approve-${r.id}`}>
            <ShieldCheck className="h-3.5 w-3.5" /> Approve
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => onAction(r.id, "reject")} data-testid={`btn-reject-${r.id}`}>
            <ShieldX className="h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      ),
    },
  ];
}

export function PendingApprovalsPanel({ onApproved }: { onApproved: () => void }) {
  const { toast } = useToast();
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"approve" | "reject" | null>(null);
  const [approvalNote, setApprovalNote] = useState("");
  const { data: pending = [], isLoading, refetch } = useQuery<any[]>({
    queryKey: QK_PENDING_APPROVALS,
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/payment-receipts/pending-approvals", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const actionMutation = useMutation({
    mutationFn: async ({ id, type, note }: { id: string; type: "approve" | "reject"; note: string }) => {
      const res = await apiRequest("POST", `/api/payment-receipts/${id}/${type}`, { approvalNote: note });
      return res.json();
    },
    onSuccess: (_, vars) => {
      setActionId(null);
      setActionType(null);
      setApprovalNote("");
      refetch();
      onApproved();
      toast({ title: vars.type === "approve" ? "Receipt approved and applied" : "Receipt rejected" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openAction = (id: string, type: "approve" | "reject") => {
    setActionId(id);
    setActionType(type);
    setApprovalNote("");
  };

  return (
    <CardSection title="Pending receipt approvals" description="Backdated receipts and premium overrides awaiting approval. Approving applies the payment to the policy and financial statements." icon={Clock}>
      {isLoading ? (
        <div className="p-8 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <EnhancedDataTable
          columns={pendingApprovalsColumns({ onAction: openAction })}
          rows={pending}
          getRowKey={(r: any) => r.id}
          rowTestId={(r: any) => `row-pending-approval-${r.id}`}
          exportFilename="pending-approvals"
          storageKey="finance-pending-approvals"
          emptyMessage="No pending approvals. All pending receipts have been reviewed."
        />
      )}

      <Dialog open={!!actionId} onOpenChange={(open) => { if (!open) { setActionId(null); setActionType(null); setApprovalNote(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionType === "approve" ? "Approve Receipt" : "Reject Receipt"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {actionType === "approve" ? (
              <p className="text-sm text-muted-foreground">Approving will apply this backdated payment to the policy and update financial statements. This cannot be undone.</p>
            ) : (
              <p className="text-sm text-muted-foreground">Rejecting will leave the policy unchanged. The submitter should be notified separately.</p>
            )}
            <div className="space-y-1">
              <Label htmlFor="approval-note">{actionType === "approve" ? "Approval note *" : "Rejection note *"}</Label>
              <Textarea id="approval-note"
                value={approvalNote}
                onChange={(e) => setApprovalNote(e.target.value)}
                placeholder={actionType === "approve" ? "Note confirming the basis for approval..." : "Reason for rejection..."}
                rows={3}
                data-testid="textarea-approval-note"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setActionId(null); setActionType(null); setApprovalNote(""); }}>Cancel</Button>
            <Button
              variant={actionType === "approve" ? "default" : "destructive"}
              disabled={!approvalNote.trim() || actionMutation.isPending}
              onClick={() => actionMutation.mutate({ id: actionId!, type: actionType!, note: approvalNote })}
              data-testid="btn-confirm-action"
            >
              {actionMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {actionType === "approve" ? "Approve & Apply" : "Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardSection>
  );
}
