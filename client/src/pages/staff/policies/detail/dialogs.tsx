import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { Download, Printer, Share2, Loader2 } from "lucide-react";

interface UpgradeFormState {
  selectedProductId: string;
  productVersionId: string;
}

interface UseDetailDialogsArgs {
  selectedPolicy: any;
  displayPolicy: any;
  clientPaymentMethods: any[] | undefined;
  products: any[];
  showUpgradeDialog: boolean;
  setShowUpgradeDialog: (open: boolean) => void;
  upgradeForm: UpgradeFormState;
  setUpgradeForm: (form: UpgradeFormState) => void;
  onPolicyUpdated: (updated: any) => void;
}

/**
 * Hook-plus-JSX bundle (mirrors finance/shared-dialogs.tsx's usePayDialog pattern) for the
 * detail-view-only dialogs that don't warrant their own file: E-Statement viewer, Policy
 * document viewer, Upgrade Product, Edit Contact Details, and the saved mobile wallet dialog.
 * Instantiated once in policy-detail-view.tsx; individual openers are threaded down to
 * whichever sub-tab needs to trigger one (e.g. overview-tab's "Edit contact details" button,
 * documents-tab's E-Statement "View" button).
 */
export function useDetailDialogs({
  selectedPolicy, displayPolicy, clientPaymentMethods, products,
  showUpgradeDialog, setShowUpgradeDialog, upgradeForm, setUpgradeForm, onPolicyUpdated,
}: UseDetailDialogsArgs) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // E-Statement viewer
  const [showEstatementViewer, setShowEstatementViewer] = useState(false);
  const [estatementViewerUrl, setEstatementViewerUrl] = useState("");
  const openEstatementViewer = (url: string) => { setEstatementViewerUrl(url); setShowEstatementViewer(true); };

  // Policy document viewer
  const [showPolicyDocViewer, setShowPolicyDocViewer] = useState(false);
  const [policyDocViewerUrl, setPolicyDocViewerUrl] = useState("");
  const openPolicyDocViewer = (url: string) => { setPolicyDocViewerUrl(url); setShowPolicyDocViewer(true); };

  // Edit contact details (policy holder client)
  const [showEditClientDialog, setShowEditClientDialog] = useState(false);
  const [editClientForm, setEditClientForm] = useState({ phone: "", email: "", physicalAddress: "", postalAddress: "" });
  const [editClientId, setEditClientId] = useState<string | null>(null);
  const openEditClientDialog = (policyHolderClient: any) => {
    if (!policyHolderClient) return;
    setEditClientId(policyHolderClient.id);
    setEditClientForm({
      phone: policyHolderClient.phone || "",
      email: policyHolderClient.email || "",
      physicalAddress: policyHolderClient.physicalAddress || "",
      postalAddress: policyHolderClient.postalAddress || "",
    });
    setShowEditClientDialog(true);
  };
  const updateClientDetailsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/clients/${editClientId}`, editClientForm);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", displayPolicy?.clientId, "policy-detail-holder"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowEditClientDialog(false);
      toast({ title: "Client details updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // Saved mobile wallet (payment method)
  const [showPaymentMethodDialog, setShowPaymentMethodDialog] = useState(false);
  const [paymentMethodForm, setPaymentMethodForm] = useState({ provider: "ecocash", mobileNumber: "" });
  const openPaymentMethodDialog = () => {
    const current = (clientPaymentMethods || []).find((m: any) => m.isDefault && m.isActive) || (clientPaymentMethods || [])[0];
    if (current?.methodType === "mobile") {
      setPaymentMethodForm({
        provider: current.provider || "ecocash",
        mobileNumber: current.mobileNumber || "",
      });
    } else {
      setPaymentMethodForm({ provider: "ecocash", mobileNumber: "" });
    }
    setShowPaymentMethodDialog(true);
  };
  const savePaymentMethodMutation = useMutation({
    mutationFn: async () => {
      if (!displayPolicy?.clientId) throw new Error("No client selected");
      const res = await apiRequest("PUT", `/api/clients/${displayPolicy.clientId}/payment-methods/default`, {
        methodType: "mobile",
        provider: paymentMethodForm.provider,
        mobileNumber: paymentMethodForm.mobileNumber,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", displayPolicy?.clientId, "payment-methods"] });
      setShowPaymentMethodDialog(false);
      toast({ title: "Payment method saved", description: "Default method updated for automation." });
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  // Upgrade product
  const { data: upgradeProductVersions } = useQuery<any[]>({
    queryKey: ["/api/products", upgradeForm.selectedProductId, "versions", "upgrade"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/products/${upgradeForm.selectedProductId}/versions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!upgradeForm.selectedProductId && showUpgradeDialog,
  });

  const todayISO = new Date().toISOString().split("T")[0];
  const [changeEffectiveDate, setChangeEffectiveDate] = useState(todayISO);
  const [changePreview, setChangePreview] = useState<{ oldPremium: string; newPremium: string; currency: string; periods: number; reconciliation: string; direction: string } | null>(null);

  // Fetch a live arrears/credit preview when the upgrade target version or effective date changes.
  useEffect(() => {
    if (!showUpgradeDialog || !selectedPolicy?.id || !upgradeForm.productVersionId) {
      setChangePreview(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("POST", `/api/policies/${selectedPolicy.id}/preview-change`, {
          productVersionId: upgradeForm.productVersionId,
          effectiveDate: changeEffectiveDate,
        });
        const data = await res.json();
        if (!cancelled) setChangePreview(data);
      } catch {
        if (!cancelled) setChangePreview(null);
      }
    })();
    return () => { cancelled = true; };
  }, [showUpgradeDialog, selectedPolicy?.id, upgradeForm.productVersionId, changeEffectiveDate]);

  const upgradePolicyMutation = useMutation({
    mutationFn: async ({ id, productVersionId, effectiveDate }: { id: string; productVersionId: string; effectiveDate?: string }) => {
      const res = await apiRequest("POST", `/api/policies/${id}/upgrade`, { productVersionId, effectiveDate });
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setShowUpgradeDialog(false);
      setUpgradeForm({ selectedProductId: "", productVersionId: "" });
      const recon = updated?.reconciliation;
      const reconNote = recon && recon.direction === "arrears"
        ? ` Arrears of ${updated.currency} ${Math.abs(Number(recon.reconciliation)).toFixed(2)} added to the account.`
        : recon && recon.direction === "credit"
        ? ` Credit of ${updated.currency} ${Math.abs(Number(recon.reconciliation)).toFixed(2)} added to the balance.`
        : "";
      onPolicyUpdated(updated);
      toast({ title: "Policy product changed", description: `Premium recalculated.${reconNote}` });
    },
    onError: (err: Error) => {
      toast({ title: "Change failed", description: err.message, variant: "destructive" });
    },
  });

  const node = (
    <>
      <Dialog open={showEstatementViewer} onOpenChange={(open) => { setShowEstatementViewer(open); if (!open) setEstatementViewerUrl(""); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col w-[min(100vw-2rem,56rem)] overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>E-Statement</DialogTitle>
            <DialogDescription>Review the statement below, then download or share if needed.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-3 min-w-0">
            {estatementViewerUrl && (
              <iframe
                title="E-Statement"
                src={estatementViewerUrl}
                className="w-full flex-1 min-h-[60vh] min-w-0 border rounded-md"
              />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(estatementViewerUrl, window.location.origin);
                  u.searchParams.set("download", "1");
                  window.open(u.toString(), "_blank", "noopener");
                }}
              >
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(estatementViewerUrl, window.location.origin);
                  u.searchParams.delete("download");
                  printDocument(u.toString());
                }}
              >
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(estatementViewerUrl, window.location.origin);
                  u.searchParams.delete("download");
                  shareDocument(u.toString(), `E-Statement-${displayPolicy?.policyNumber}`);
                }}
              >
                <Share2 className="h-4 w-4" /> Share
              </Button>
              <Button variant="outline" onClick={() => { setShowEstatementViewer(false); setEstatementViewerUrl(""); }}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showPolicyDocViewer} onOpenChange={(open) => { setShowPolicyDocViewer(open); if (!open) setPolicyDocViewerUrl(""); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col w-[min(100vw-2rem,56rem)] overflow-x-hidden">
          <DialogHeader>
            <DialogTitle>Policy document</DialogTitle>
            <DialogDescription>Review the certificate below, then download or print if needed.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 flex flex-col gap-3 min-w-0">
            {policyDocViewerUrl && (
              <iframe
                title="Policy document"
                src={policyDocViewerUrl}
                className="w-full flex-1 min-h-[60vh] min-w-0 border rounded-md"
              />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(policyDocViewerUrl, window.location.origin);
                  u.searchParams.set("download", "1");
                  window.open(u.toString(), "_blank", "noopener");
                }}
              >
                <Download className="h-4 w-4" /> Download
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(policyDocViewerUrl, window.location.origin);
                  u.searchParams.delete("download");
                  printDocument(u.toString());
                }}
              >
                <Printer className="h-4 w-4" /> Print
              </Button>
              <Button
                variant="outline"
                className="gap-2"
                onClick={() => {
                  const u = new URL(policyDocViewerUrl, window.location.origin);
                  u.searchParams.delete("download");
                  shareDocument(u.toString(), `Policy-${displayPolicy?.policyNumber}`);
                }}
              >
                <Share2 className="h-4 w-4" /> Share
              </Button>
              <Button variant="outline" onClick={() => { setShowPolicyDocViewer(false); setPolicyDocViewerUrl(""); }}>Close</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditClientDialog} onOpenChange={setShowEditClientDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Contact Details</DialogTitle>
            <DialogDescription>
              Update contact/address details. National ID, date of birth, and gender are edited from the Clients page.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="edit-client-form-phone">Phone</Label>
                <Input id="edit-client-form-phone" value={editClientForm.phone} onChange={(e) => setEditClientForm({ ...editClientForm, phone: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-client-form-email">Email</Label>
                <Input id="edit-client-form-email" type="email" value={editClientForm.email} onChange={(e) => setEditClientForm({ ...editClientForm, email: e.target.value })} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-client-form-physical-address">Physical Address</Label>
              <Textarea id="edit-client-form-physical-address" rows={2} value={editClientForm.physicalAddress} onChange={(e) => setEditClientForm({ ...editClientForm, physicalAddress: e.target.value })} placeholder="Street address, suburb, city" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Postal Address</Label>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={editClientForm.postalAddress === editClientForm.physicalAddress && !!editClientForm.physicalAddress}
                    onCheckedChange={(checked) => setEditClientForm({ ...editClientForm, postalAddress: checked ? editClientForm.physicalAddress : "" })}
                  />
                  Same as physical
                </label>
              </div>
              <Textarea rows={2} value={editClientForm.postalAddress} onChange={(e) => setEditClientForm({ ...editClientForm, postalAddress: e.target.value })} placeholder="P.O. Box or postal address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditClientDialog(false)}>Cancel</Button>
            <Button onClick={() => updateClientDetailsMutation.mutate()} disabled={updateClientDetailsMutation.isPending} data-testid="btn-save-policy-holder-contact">
              {updateClientDetailsMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showUpgradeDialog} onOpenChange={setShowUpgradeDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Upgrade Policy Product</DialogTitle>
            <DialogDescription>
              Move policy <strong>{displayPolicy?.policyNumber}</strong> to a new product version. Premium will be recalculated automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
              Current product: <strong>{displayPolicy?.productName || "Unknown"}</strong> ({displayPolicy?.productVersionLabel || `v${displayPolicy?.version || "?"}`})
            </div>
            <div className="space-y-2">
              <Label htmlFor="product">Product</Label>
              <Select
                value={upgradeForm.selectedProductId || undefined}
                onValueChange={(v) => setUpgradeForm({ selectedProductId: v, productVersionId: "" })}
              >
                <SelectTrigger id="product" data-testid="select-upgrade-product">
                  <SelectValue placeholder="Select product..." />
                </SelectTrigger>
                <SelectContent>
                  {(products || []).map((p: any) => (
                    <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Product Version</Label>
              <Select
                value={upgradeForm.productVersionId || undefined}
                onValueChange={(v) => setUpgradeForm({ ...upgradeForm, productVersionId: v })}
                disabled={!upgradeForm.selectedProductId}
              >
                <SelectTrigger data-testid="select-upgrade-version">
                  <SelectValue placeholder={upgradeForm.selectedProductId ? "Select version..." : "Select product first"} />
                </SelectTrigger>
                <SelectContent>
                  {(upgradeProductVersions || []).map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      v{v.version} · {[
                        v.premiumMonthlyUsd ? `USD ${Number(v.premiumMonthlyUsd).toFixed(2)}/mo` : null,
                        v.premiumMonthlyZar ? `ZAR ${Number(v.premiumMonthlyZar).toFixed(2)}/mo` : null,
                        v.premiumMonthlyZig ? `ZiG ${Number(v.premiumMonthlyZig).toFixed(2)}/mo` : null,
                      ].filter(Boolean).join(" · ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Effective from</Label>
              <Input type="date" value={changeEffectiveDate} onChange={(e) => setChangeEffectiveDate(e.target.value)} data-testid="input-upgrade-effective-date" />
              <p className="text-xs text-muted-foreground">A past date back-charges (or credits) the difference for the periods since then.</p>
            </div>
            {changePreview && (
              <div className={`rounded-md p-3 text-sm border ${changePreview.direction === "arrears" ? "bg-amber-500/10 border-amber-200 text-amber-800" : changePreview.direction === "credit" ? "bg-emerald-500/10 border-emerald-200 text-emerald-800" : "bg-muted/50 text-muted-foreground"}`} data-testid="upgrade-impact-preview">
                <p>New premium: <strong>{changePreview.currency} {Number(changePreview.newPremium).toFixed(2)}</strong> (was {changePreview.currency} {Number(changePreview.oldPremium).toFixed(2)})</p>
                {changePreview.direction === "arrears" && <p>Arrears to charge: <strong>{changePreview.currency} {Math.abs(Number(changePreview.reconciliation)).toFixed(2)}</strong> over {changePreview.periods} period(s) → added to the account.</p>}
                {changePreview.direction === "credit" && <p>Credit to balance: <strong>{changePreview.currency} {Math.abs(Number(changePreview.reconciliation)).toFixed(2)}</strong> over {changePreview.periods} period(s).</p>}
                {changePreview.direction === "none" && <p>No arrears or credit for the selected effective date.</p>}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUpgradeDialog(false)}>Cancel</Button>
            <Button
              onClick={() => selectedPolicy && upgradePolicyMutation.mutate({ id: selectedPolicy.id, productVersionId: upgradeForm.productVersionId, effectiveDate: changeEffectiveDate })}
              disabled={!selectedPolicy || !upgradeForm.productVersionId || upgradePolicyMutation.isPending}
              data-testid="btn-confirm-upgrade-policy"
            >
              {upgradePolicyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply Change
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showPaymentMethodDialog} onOpenChange={setShowPaymentMethodDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Saved mobile wallet</DialogTitle>
            <DialogDescription>
              Used when automation runs for overdue balances: we open the payment flow on this number and the client authorises on their phone (PIN). One-off card payments are still taken from Finance or the client portal.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="payment-method-form-provider">Provider</Label>
              <Select value={paymentMethodForm.provider} onValueChange={(v) => setPaymentMethodForm({ ...paymentMethodForm, provider: v })}>
                <SelectTrigger id="payment-method-form-provider"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="onemoney">OneMoney</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="omari">O'Mari</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="payment-method-form-mobile-number">Mobile Number</Label>
              <Input id="payment-method-form-mobile-number" value={paymentMethodForm.mobileNumber} onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, mobileNumber: e.target.value })} placeholder="e.g. 0771234567" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentMethodDialog(false)}>Cancel</Button>
            <Button
              onClick={() => savePaymentMethodMutation.mutate()}
              disabled={savePaymentMethodMutation.isPending || !paymentMethodForm.mobileNumber.trim()}
            >
              {savePaymentMethodMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save wallet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return { openEstatementViewer, openPolicyDocViewer, openEditClientDialog, openPaymentMethodDialog, node };
}
