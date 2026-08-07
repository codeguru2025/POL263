import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CurrencySelect } from "@/components/currency-select";
import { CountryFlagFields, type CountryFlagSettings } from "@/components/country-flag-fields";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";

export interface EditPolicyForm {
  currency: string;
  paymentSchedule: string;
  effectiveDate: string;
  inceptionDate: string;
  branchId: string;
  agentId: string;
  groupId: string;
  beneficiaryFirstName: string;
  beneficiaryLastName: string;
  beneficiaryRelationship: string;
  beneficiaryNationalId: string;
  beneficiaryPhone: string;
  premiumAmount: string;
  premiumEffectiveDate: string;
  premiumChangeReason: string;
  isLegacy: boolean;
  isSouthAfrica: boolean;
  externalReference: string;
}

interface EditPolicyDialogProps {
  selectedPolicy: any;
  displayPolicy: any;
  showEditDialog: boolean;
  setShowEditDialog: (open: boolean) => void;
  editForm: EditPolicyForm;
  setEditForm: (form: EditPolicyForm) => void;
  canEditPremium: boolean;
  countryFlagSettings: CountryFlagSettings | undefined;
  branches: any[];
  agents: any[];
  groups: any[];
  todayISO: string;
  onUpdated: (updated: any) => void;
}

/**
 * MONEY-CRITICAL — relocated verbatim from policies.tsx. The manual-premium-override block in
 * handleEditSubmit below (and the Object.keys(data).length === 0 guard immediately after it) is
 * copied byte-for-byte from the original; do not "clean up" the logic here.
 */
export function EditPolicyDialog({
  selectedPolicy, displayPolicy, showEditDialog, setShowEditDialog, editForm, setEditForm,
  canEditPremium, countryFlagSettings, branches, agents, groups, todayISO, onUpdated,
}: EditPolicyDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const editPolicyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/policies/${id}`, data);
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setShowEditDialog(false);
      onUpdated(updated);
      toast({ title: "Policy updated", description: "Policy details have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const handleEditSubmit = () => {
    if (!selectedPolicy) return;
    const data: Record<string, any> = {};
    if (editForm.currency !== (displayPolicy.currency || "USD")) data.currency = editForm.currency;
    if (editForm.paymentSchedule !== (displayPolicy.paymentSchedule || "monthly")) data.paymentSchedule = editForm.paymentSchedule;
    if (editForm.effectiveDate !== (displayPolicy.effectiveDate || "")) data.effectiveDate = editForm.effectiveDate || null;
    if (canEditPremium && editForm.inceptionDate !== (displayPolicy.inceptionDate || "")) data.inceptionDate = editForm.inceptionDate || null;
    if (editForm.branchId !== (displayPolicy.branchId || "")) data.branchId = editForm.branchId || null;
    if (canEditPremium && editForm.agentId !== (displayPolicy.agentId || "")) data.agentId = editForm.agentId || null;
    if (canEditPremium && editForm.groupId !== (displayPolicy.groupId || "")) data.groupId = editForm.groupId || null;
    if (editForm.beneficiaryFirstName !== (displayPolicy.beneficiaryFirstName || "")) data.beneficiaryFirstName = editForm.beneficiaryFirstName || null;
    if (editForm.beneficiaryLastName !== (displayPolicy.beneficiaryLastName || "")) data.beneficiaryLastName = editForm.beneficiaryLastName || null;
    if (editForm.beneficiaryRelationship !== (displayPolicy.beneficiaryRelationship || "")) data.beneficiaryRelationship = editForm.beneficiaryRelationship || null;
    if (editForm.beneficiaryNationalId !== (displayPolicy.beneficiaryNationalId || "")) data.beneficiaryNationalId = editForm.beneficiaryNationalId || null;
    if (editForm.beneficiaryPhone !== (displayPolicy.beneficiaryPhone || "")) data.beneficiaryPhone = editForm.beneficiaryPhone || null;
    // Manual premium override (gated to edit:premium roles). Sends the reconciliation effective date.
    if (canEditPremium && editForm.premiumAmount !== "") {
      const current = parseFloat(String(displayPolicy.premiumAmount ?? "0"));
      const next = parseFloat(editForm.premiumAmount);
      if (Number.isFinite(next) && next >= 0 && Math.abs(next - current) >= 0.01) {
        data.premiumAmount = next.toFixed(2);
        data.premiumEffectiveDate = editForm.premiumEffectiveDate || todayISO;
        if (editForm.premiumChangeReason) data.premiumChangeReason = editForm.premiumChangeReason;
      }
    }
    if (canEditPremium && editForm.isLegacy !== !!displayPolicy.isLegacy) data.isLegacy = editForm.isLegacy;
    if (editForm.isSouthAfrica !== !!displayPolicy.isSouthAfrica) data.isSouthAfrica = editForm.isSouthAfrica;
    if (editForm.externalReference !== (displayPolicy.externalReference || "")) data.externalReference = editForm.externalReference.trim() || null;
    if (Object.keys(data).length === 0) {
      setShowEditDialog(false);
      return;
    }
    editPolicyMutation.mutate({ id: selectedPolicy.id, data });
  };

  return (
    <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Policy Details</DialogTitle>
          <DialogDescription>
            Update details for policy <strong>{displayPolicy?.policyNumber}</strong>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">Currency</Label>
              <CurrencySelect value={editForm.currency} onValueChange={(v) => setEditForm({ ...editForm, currency: v })} />
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-form-payment-schedule">Payment Schedule</Label>
              <Select value={editForm.paymentSchedule} onValueChange={(v) => setEditForm({ ...editForm, paymentSchedule: v })}>
                <SelectTrigger id="edit-form-payment-schedule"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-weekly</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="annually">Annually</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs" htmlFor="edit-form-effective-date">Effective Date</Label>
              <Input id="edit-form-effective-date" type="date" value={editForm.effectiveDate} onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })} />
            </div>
            {canEditPremium && (
              <div>
                <Label className="text-xs" htmlFor="edit-form-inception-date">Inception Date</Label>
                <Input id="edit-form-inception-date" type="date" value={editForm.inceptionDate} onChange={(e) => setEditForm({ ...editForm, inceptionDate: e.target.value })} />
              </div>
            )}
            <div>
              <Label className="text-xs" htmlFor="branch">Branch</Label>
              <Select value={editForm.branchId || "none"} onValueChange={(v) => setEditForm({ ...editForm, branchId: v === "none" ? "" : v })}>
                <SelectTrigger id="branch"><SelectValue placeholder="No branch" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No branch</SelectItem>
                  {branches.map((b: any) => (
                    <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {canEditPremium && (
              <>
                <div>
                  <Label className="text-xs">Agent</Label>
                  <Select value={editForm.agentId || "walk-in"} onValueChange={(v) => setEditForm({ ...editForm, agentId: v === "walk-in" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Walk-in" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk-in">Walk-in (no agent)</SelectItem>
                      {agents.map((a: any) => (
                        <SelectItem key={a.id} value={a.id}>{a.displayName || a.email}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Group</Label>
                  <Select value={editForm.groupId || "none"} onValueChange={(v) => setEditForm({ ...editForm, groupId: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="No group" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No group</SelectItem>
                      {groups.map((g: any) => (
                        <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold mb-3">Beneficiary</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">First Name</Label>
                <Input value={editForm.beneficiaryFirstName} onChange={(e) => setEditForm({ ...editForm, beneficiaryFirstName: e.target.value })} placeholder="First name" />
              </div>
              <div>
                <Label className="text-xs">Last Name</Label>
                <Input value={editForm.beneficiaryLastName} onChange={(e) => setEditForm({ ...editForm, beneficiaryLastName: e.target.value })} placeholder="Last name" />
              </div>
              <div>
                <Label className="text-xs">Relationship</Label>
                <Select value={editForm.beneficiaryRelationship || "none"} onValueChange={(v) => setEditForm({ ...editForm, beneficiaryRelationship: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">National ID</Label>
                <Input value={editForm.beneficiaryNationalId} onChange={(e) => setEditForm({ ...editForm, beneficiaryNationalId: e.target.value })} placeholder="ID number" />
              </div>
              <div className="col-span-2">
                <Label className="text-xs">Phone</Label>
                <Input value={editForm.beneficiaryPhone} onChange={(e) => setEditForm({ ...editForm, beneficiaryPhone: e.target.value })} placeholder="Phone number" />
              </div>
            </div>
          </div>

          {canEditPremium && (
            <div>
              <h4 className="text-sm font-semibold mb-3">Premium override</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Premium amount ({editForm.currency || displayPolicy?.currency || "USD"})</Label>
                  <Input
                    type="number" step="0.01" min="0"
                    value={editForm.premiumAmount}
                    onChange={(e) => setEditForm({ ...editForm, premiumAmount: e.target.value })}
                    data-testid="input-edit-premium"
                  />
                  <p className="text-[11px] text-muted-foreground mt-1">Auto-calculated; override only if needed.</p>
                </div>
                <div>
                  <Label className="text-xs" htmlFor="edit-form-premium-effective-date">Effective from</Label>
                  <Input id="edit-form-premium-effective-date" type="date" value={editForm.premiumEffectiveDate} onChange={(e) => setEditForm({ ...editForm, premiumEffectiveDate: e.target.value })} data-testid="input-edit-premium-date" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs" htmlFor="edit-form-premium-change-reason">Reason (optional)</Label>
                  <Input id="edit-form-premium-change-reason" value={editForm.premiumChangeReason} onChange={(e) => setEditForm({ ...editForm, premiumChangeReason: e.target.value })} placeholder="e.g. Correction, negotiated rate" />
                </div>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">A past effective date back-charges (arrears) or credits the difference for the elapsed periods.</p>
            </div>
          )}

          {canEditPremium && (
            <div className="flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/30 p-3">
              <Checkbox
                id="edit-is-legacy"
                checked={editForm.isLegacy}
                onCheckedChange={(v) => setEditForm({ ...editForm, isLegacy: !!v })}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <label htmlFor="edit-is-legacy" className="text-sm font-medium cursor-pointer">Legacy / backfilled policy</label>
                <p className="text-xs text-muted-foreground">This was an existing policy not previously in the system. Enabling this will immediately activate the policy and mark all waiting periods as completed.</p>
              </div>
            </div>
          )}

          <CountryFlagFields
            settings={countryFlagSettings}
            idPrefix="edit-policy"
            checked={editForm.isSouthAfrica}
            reference={editForm.externalReference}
            onCheckedChange={(v) => setEditForm({ ...editForm, isSouthAfrica: v })}
            onReferenceChange={(v) => setEditForm({ ...editForm, externalReference: v })}
          />

          <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
            <strong>Note:</strong> {canEditPremium
              ? "Policy number and client cannot be changed. Premium can be overridden above; it otherwise auto-calculates from the product, add-ons, and members. Agent can be reassigned."
              : "Premium amount, agent assignment, policy number, and client cannot be changed without manager or administrator access."
            }
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button>
          <Button
            onClick={handleEditSubmit}
            disabled={editPolicyMutation.isPending}
            data-testid="btn-save-policy-edit"
          >
            {editPolicyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
