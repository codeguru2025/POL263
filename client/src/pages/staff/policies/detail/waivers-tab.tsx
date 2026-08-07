import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { CardSection } from "@/components/ds";
import { ShieldCheck, CheckCircle2, X, Loader2 } from "lucide-react";

interface WaiversTabProps {
  selectedPolicy: any;
  policyWaiver: any;
  refetchWaiver: () => void;
  canWritePolicy: boolean;
  canManageApprovals: boolean;
}

export function WaiversTab({ selectedPolicy, policyWaiver, refetchWaiver, canWritePolicy, canManageApprovals }: WaiversTabProps) {
  const { toast } = useToast();

  const [waiverReason, setWaiverReason] = useState("");
  const [waiverNotes, setWaiverNotes] = useState("");
  const [showWaiverDialog, setShowWaiverDialog] = useState(false);
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);

  async function submitWaiverRequest() {
    setWaiverSubmitting(true);
    try {
      await apiRequest("POST", `/api/policies/${selectedPolicy!.id}/waiver-request`, {
        reason: waiverReason,
        supportingNotes: waiverNotes,
      });
      refetchWaiver();
      setShowWaiverDialog(false);
      setWaiverReason("");
      setWaiverNotes("");
      toast({ title: "Waiver request submitted", description: "Admins and managers have been notified." });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setWaiverSubmitting(false);
    }
  }

  return (
    <>
      <CardSection title="Waiting Period Waiver" description="Request or view the status of a waiting period waiver for this policy. Upload supporting documents (previous policy, payment history) in the Documents tab." icon={ShieldCheck} contentClassName="space-y-3">
        {policyWaiver ? (
          <div className={`rounded-md border p-3 space-y-1 ${policyWaiver.status === "approved" ? "border-emerald-300 bg-emerald-50/50" : policyWaiver.status === "rejected" ? "border-red-300 bg-red-50/50" : "border-amber-300 bg-amber-50/50"}`}>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className={policyWaiver.status === "approved" ? "border-emerald-500 text-emerald-700" : policyWaiver.status === "rejected" ? "border-red-500 text-red-700" : "border-amber-500 text-amber-700"}>
                {policyWaiver.status.charAt(0).toUpperCase() + policyWaiver.status.slice(1)}
              </Badge>
              <span className="text-xs text-muted-foreground">{policyWaiver.createdAt ? new Date(policyWaiver.createdAt).toLocaleDateString() : ""}</span>
            </div>
            {policyWaiver.reason && <p className="text-sm"><span className="font-medium">Reason:</span> {policyWaiver.reason}</p>}
            {policyWaiver.supportingNotes && <p className="text-sm"><span className="font-medium">Notes:</span> {policyWaiver.supportingNotes}</p>}
            {policyWaiver.rejectionReason && <p className="text-sm text-destructive"><span className="font-medium">Rejection reason:</span> {policyWaiver.rejectionReason}</p>}
            {canManageApprovals && policyWaiver.status === "pending" && (
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="gap-1" onClick={async () => {
                  const res = await apiRequest("POST", `/api/waivers/${policyWaiver.id}/resolve`, { action: "approve" });
                  if (res.ok) { refetchWaiver(); toast({ title: "Waiver approved", description: "Policy waiting period waived and activated." }); }
                  else { const e = await res.json().catch(() => ({})); toast({ title: "Error", description: e.message, variant: "destructive" }); }
                }}><CheckCircle2 className="h-3.5 w-3.5" /> Approve</Button>
                <Button size="sm" variant="destructive" className="gap-1" onClick={async () => {
                  const reason = window.prompt("Rejection reason (optional):");
                  const res = await apiRequest("POST", `/api/waivers/${policyWaiver.id}/resolve`, { action: "reject", rejectionReason: reason || "" });
                  if (res.ok) { refetchWaiver(); toast({ title: "Waiver rejected" }); }
                  else { const e = await res.json().catch(() => ({})); toast({ title: "Error", description: e.message, variant: "destructive" }); }
                }}><X className="h-3.5 w-3.5" /> Reject</Button>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">No waiver request has been submitted for this policy.</p>
            {canWritePolicy && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => setShowWaiverDialog(true)}>
                <ShieldCheck className="h-4 w-4" /> Request waiver
              </Button>
            )}
          </div>
        )}
      </CardSection>

      <Dialog open={showWaiverDialog} onOpenChange={(open) => { setShowWaiverDialog(open); if (!open) { setWaiverReason(""); setWaiverNotes(""); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request Waiting Period Waiver</DialogTitle>
            <DialogDescription>Provide the reason for the waiver. Admins and managers will review your request before approving.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="waiver-reason">Reason for waiver <span className="text-destructive">*</span></Label>
              <Textarea id="waiver-reason" placeholder="e.g. Client had an active policy with another insurer for the past 2 years" value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} rows={3} />
            </div>
            <div>
              <Label htmlFor="waiver-notes">Supporting notes (optional)</Label>
              <Textarea id="waiver-notes" placeholder="Any additional context or document references" value={waiverNotes} onChange={(e) => setWaiverNotes(e.target.value)} rows={2} />
            </div>
            <p className="text-xs text-muted-foreground">Upload supporting documents (payment history, previous policy docs) in the Documents section of this policy.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowWaiverDialog(false)}>Cancel</Button>
            <Button disabled={!waiverReason.trim() || waiverSubmitting} onClick={submitWaiverRequest}>
              {waiverSubmitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null} Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
