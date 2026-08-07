import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { isAgentScoped } from "@shared/roles";
import { useFlag } from "@/lib/flags";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import type { CountryFlagSettings } from "@/components/country-flag-fields";
import { STATUS_LABELS } from "@/lib/policy-status-transitions";

import { usePolicySelection } from "./use-policy-selection";
import { PolicyListView } from "./policy-list-view";
import { PolicyDetailView } from "./policy-detail-view";
import { CreatePolicyWizard } from "./create-policy-wizard";
import type { EditPolicyForm } from "./detail/edit-policy-dialog";

export default function StaffPolicies() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, roles, permissions, isPlatformOwner } = useAuth();
  const safeRoles = Array.isArray(roles) ? roles : [];
  const safePermissions = Array.isArray(permissions) ? permissions : [];
  const isAgent = isAgentScoped(safeRoles);
  const canWritePolicy = safePermissions.includes("write:policy");
  const canWriteFinance = safePermissions.includes("write:finance");
  const canEditPremium = isPlatformOwner || safePermissions.includes("edit:premium");
  const canDeletePolicy = safePermissions.includes("delete:policy");
  const canEditPayment = safePermissions.includes("edit:payment");
  const canDeletePayment = safePermissions.includes("delete:payment");
  const canEditReceipt = safePermissions.includes("edit:receipt");
  const canDeleteReceipt = safePermissions.includes("delete:receipt");
  const canManageApprovals = safePermissions.includes("approve:waivers");
  const policyWizardFlag = useFlag("policyWizard");

  const { data: languages } = useQuery<{ code: string; name: string }[]>({ queryKey: ["/api/languages"] });

  // limit=500 for the same reason as the policies list query — clients feed getClientName()'s
  // lookup map, and a truncated fetch here is exactly what made policies whose client fell
  // outside the default 100-row page render the client's raw id instead of their name.
  const { data: rawClients } = useQuery<any[]>({
    queryKey: ["/api/clients?limit=500"],
  });
  const clients = rawClients ?? [];
  const { data: rawAgents } = useQuery<any[]>({
    queryKey: ["/api/agents"],
  });
  const agents = rawAgents ?? [];
  const { data: rawBranches } = useQuery<any[]>({
    queryKey: ["/api/branches"],
  });
  const branches = rawBranches ?? [];
  const headOfficeBranchId = branches.find((b: any) => b.isHeadOffice && b.isActive)?.id ?? "";
  const { data: countryFlagSettings } = useQuery<CountryFlagSettings>({
    queryKey: ["/api/country-flag-settings"],
  });
  // Queried once here rather than in create-policy-wizard.tsx / detail/dialogs.tsx / edit-policy-
  // dialog.tsx individually — groups is needed by both the wizard (legacy-group detection) and the
  // Edit Policy dialog's Group select; products is needed by both the wizard (product picker) and
  // the Upgrade Product dialog's product picker. Sharing the query here avoids duplicating either
  // fetch across those files.
  const { data: rawGroups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });
  const groups = rawGroups ?? [];
  const { data: rawProducts } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });
  const products = rawProducts ?? [];
  const { data: rawAddOns } = useQuery<any[]>({
    queryKey: ["/api/add-ons"],
  });
  const addOns = rawAddOns ?? [];

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients?.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);
  const getClientName = (clientId: string) => {
    const c = clientMap[clientId];
    return c ? `${c.firstName} ${c.lastName}` : "Unknown client";
  };

  const selection = usePolicySelection();

  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // De-duplicated transition dialog — the original had two verbatim copies (one in the
  // detail-view early-return branch, one in the list-view branch), rendered once here since
  // index.tsx renders regardless of which view is active.
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
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
      if (selection.showDetailView) selection.setSelectedPolicy(updated);
      toast({ title: "Status updated", description: `Policy transitioned to ${STATUS_LABELS[updated.status] || updated.status}.` });
    },
    onError: (err: Error) => {
      toast({ title: "Transition failed", description: err.message, variant: "destructive" });
    },
  });
  const openTransition = (policy: any, target: string) => {
    selection.setSelectedPolicy(policy);
    setTransitionTarget(target);
    setTransitionReason("");
    setShowTransitionDialog(true);
  };

  // De-duplicated delete-confirm dialog — same rationale as the transition dialog above. The
  // original list-view copy also had a redundant `&& !showDetailView` guard on its `open` prop
  // that was always-true whenever reached (dropped here — collapsing to one render makes it moot).
  const [confirmDeletePolicy, setConfirmDeletePolicy] = useState(false);
  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/policies/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      selection.closeDetail();
      setConfirmDeletePolicy(false);
      toast({ title: "Policy deleted", description: "Policy and all related records have been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });
  const openDeleteConfirm = (policy: any) => {
    selection.setSelectedPolicy(policy);
    setConfirmDeletePolicy(true);
  };

  // Edit dialog opener — called from both list-view's row menu (which also calls openDetail
  // first) and detail-view's action bar, even though the dialog JSX itself only ever renders
  // while detail view is showing.
  const todayISO = new Date().toISOString().split("T")[0];
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editForm, setEditForm] = useState<EditPolicyForm>({
    currency: "",
    paymentSchedule: "",
    effectiveDate: "",
    inceptionDate: "",
    branchId: "",
    agentId: "",
    groupId: "",
    beneficiaryFirstName: "",
    beneficiaryLastName: "",
    beneficiaryRelationship: "",
    beneficiaryNationalId: "",
    beneficiaryPhone: "",
    premiumAmount: "",
    premiumEffectiveDate: "",
    premiumChangeReason: "",
    isLegacy: false,
    isSouthAfrica: false,
    externalReference: "",
  });
  const openEditDialog = (policy: any) => {
    setEditForm({
      currency: policy.currency || "USD",
      paymentSchedule: policy.paymentSchedule || "monthly",
      effectiveDate: policy.effectiveDate || "",
      inceptionDate: policy.inceptionDate || "",
      branchId: policy.branchId || "",
      agentId: policy.agentId || "",
      groupId: policy.groupId || "",
      beneficiaryFirstName: policy.beneficiaryFirstName || "",
      beneficiaryLastName: policy.beneficiaryLastName || "",
      beneficiaryRelationship: policy.beneficiaryRelationship || "",
      beneficiaryNationalId: policy.beneficiaryNationalId || "",
      beneficiaryPhone: policy.beneficiaryPhone || "",
      premiumAmount: policy.premiumAmount ? parseFloat(policy.premiumAmount).toFixed(2) : "",
      premiumEffectiveDate: todayISO,
      premiumChangeReason: "",
      isLegacy: !!policy.isLegacy,
      isSouthAfrica: !!policy.isSouthAfrica,
      externalReference: policy.externalReference || "",
    });
    setShowEditDialog(true);
  };

  // Upgrade dialog opener — same cross-view-opener pattern as the Edit dialog above.
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [upgradeForm, setUpgradeForm] = useState({ selectedProductId: "", productVersionId: "" });
  const openUpgradeDialog = (policy: any) => {
    selection.setSelectedPolicy(policy);
    setUpgradeForm({ selectedProductId: "", productVersionId: "" });
    setShowUpgradeDialog(true);
  };

  return (
    <StaffLayout>
      {selection.showDetailView && selection.selectedPolicy ? (
        <PolicyDetailView
          // Remount on policy change so local UI state (active sub-tab, doc language) resets
          // instead of carrying over when navigating directly between two policies' detail
          // views (e.g. browser back/forward across two ?policyId= links) without an
          // intervening list-view visit — the underlying data already re-keys correctly via
          // each query's selectedPolicy.id-keyed queryKey, this only resets local component state.
          key={selection.selectedPolicy.id}
          selectedPolicy={selection.selectedPolicy}
          setSelectedPolicy={selection.setSelectedPolicy}
          onBack={selection.closeDetail}
          getClientName={getClientName}
          countryFlagSettings={countryFlagSettings}
          languages={languages}
          branches={branches}
          agents={agents}
          groups={groups}
          products={products}
          addOns={addOns}
          canWritePolicy={canWritePolicy}
          canWriteFinance={canWriteFinance}
          canEditPremium={canEditPremium}
          canDeletePolicy={canDeletePolicy}
          canEditPayment={canEditPayment}
          canDeletePayment={canDeletePayment}
          canEditReceipt={canEditReceipt}
          canDeleteReceipt={canDeleteReceipt}
          canManageApprovals={canManageApprovals}
          isAgent={isAgent}
          showEditDialog={showEditDialog}
          setShowEditDialog={setShowEditDialog}
          editForm={editForm}
          setEditForm={setEditForm}
          openEditDialog={openEditDialog}
          showUpgradeDialog={showUpgradeDialog}
          setShowUpgradeDialog={setShowUpgradeDialog}
          upgradeForm={upgradeForm}
          setUpgradeForm={setUpgradeForm}
          openUpgradeDialog={openUpgradeDialog}
          onOpenTransition={openTransition}
          onOpenDelete={openDeleteConfirm}
          todayISO={todayISO}
        />
      ) : (
        <PolicyListView
          getClientName={getClientName}
          countryFlagSettings={countryFlagSettings}
          canWritePolicy={canWritePolicy}
          canDeletePolicy={canDeletePolicy}
          isAgent={isAgent}
          onOpenDetail={selection.openDetail}
          onOpenEditDialog={openEditDialog}
          onOpenUpgradeDialog={openUpgradeDialog}
          onOpenTransition={openTransition}
          onOpenDelete={openDeleteConfirm}
          onCreateClick={() => setShowCreateDialog(true)}
        />
      )}

      <CreatePolicyWizard
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        policyWizardFlag={policyWizardFlag}
        canEditPremium={canEditPremium}
        isAgent={isAgent}
        user={user}
        agents={agents}
        branches={branches}
        headOfficeBranchId={headOfficeBranchId}
        groups={groups}
        products={products}
        addOns={addOns}
        countryFlagSettings={countryFlagSettings}
      />

      <Dialog open={showTransitionDialog} onOpenChange={setShowTransitionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transition Policy Status</DialogTitle>
            <DialogDescription>
              Transition <strong>{selection.selectedPolicy?.policyNumber}</strong> from <strong>{STATUS_LABELS[selection.selectedPolicy?.status] || selection.selectedPolicy?.status}</strong> to <strong>{STATUS_LABELS[transitionTarget] || transitionTarget}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="transition-reason">Reason</Label>
              <Textarea id="transition-reason"
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
              onClick={() => selection.selectedPolicy && transitionMutation.mutate({ id: selection.selectedPolicy.id, toStatus: transitionTarget, reason: transitionReason })}
              disabled={transitionMutation.isPending}
              data-testid="btn-confirm-transition"
            >
              {transitionMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirm Transition
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDeletePolicy} onOpenChange={setConfirmDeletePolicy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete policy <strong>{selection.selectedPolicy?.policyNumber}</strong> and all related records
              including payments, receipts, members, claims, and commission entries. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selection.selectedPolicy && deletePolicyMutation.mutate(selection.selectedPolicy.id)}
              disabled={deletePolicyMutation.isPending}
            >
              {deletePolicyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaffLayout>
  );
}
