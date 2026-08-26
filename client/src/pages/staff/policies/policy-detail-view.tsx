import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageShell, StatusBadge } from "@/components/ds";
import { getApiBase } from "@/lib/queryClient";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { VALID_POLICY_TRANSITIONS, STATUS_LABELS } from "@/lib/policy-status-transitions";
import type { CountryFlagSettings } from "@/components/country-flag-fields";
import {
  ChevronLeft, ArrowRightLeft, ShieldCheck, Receipt, Send, Pencil, FileText, Printer, Share2, Trash2,
} from "lucide-react";

import { OverviewTab } from "./detail/overview-tab";
import { FinancialsTab } from "./detail/financials-tab";
import { MembersTab } from "./detail/members-tab";
import { PaymentsTab } from "./detail/payments-tab";
import { DocumentsTab } from "./detail/documents-tab";
import { WaiversTab } from "./detail/waivers-tab";
import { PolicyLogsTab } from "./detail/policy-logs-tab";
import { useDetailDialogs } from "./detail/dialogs";
import { useReceiptDialogs } from "./detail/receipt-dialogs";
import { EditPolicyDialog, type EditPolicyForm } from "./detail/edit-policy-dialog";

interface UpgradeFormState {
  selectedProductId: string;
  productVersionId: string;
}

interface PolicyDetailViewProps {
  selectedPolicy: any;
  setSelectedPolicy: (policy: any) => void;
  onBack: () => void;
  getClientName: (clientId: string) => string;
  countryFlagSettings: CountryFlagSettings | undefined;
  languages: { code: string; name: string }[] | undefined;
  branches: any[];
  agents: any[];
  groups: any[];
  products: any[];
  addOns: any[];
  canWritePolicy: boolean;
  canWriteFinance: boolean;
  canEditPremium: boolean;
  canDeletePolicy: boolean;
  canEditPayment: boolean;
  canDeletePayment: boolean;
  canEditReceipt: boolean;
  canDeleteReceipt: boolean;
  canManageApprovals: boolean;
  canReadAuditLog: boolean;
  isAgent: boolean;
  showEditDialog: boolean;
  setShowEditDialog: (open: boolean) => void;
  editForm: EditPolicyForm;
  setEditForm: (form: EditPolicyForm) => void;
  openEditDialog: (policy: any) => void;
  showUpgradeDialog: boolean;
  setShowUpgradeDialog: (open: boolean) => void;
  upgradeForm: UpgradeFormState;
  setUpgradeForm: (form: UpgradeFormState) => void;
  openUpgradeDialog: (policy: any) => void;
  onOpenTransition: (policy: any, target: string) => void;
  onOpenDelete: (policy: any) => void;
  todayISO: string;
}

const staffPolicyDocumentUrl = (policyId: string, lang: string, download?: boolean) => {
  const p = new URLSearchParams();
  p.set("lang", lang);
  if (download) p.set("download", "1");
  return `${getApiBase()}/api/policies/${policyId}/document?${p.toString()}`;
};

const staffEstatementUrl = (policyId: string, download?: boolean, dateFrom?: string, dateTo?: string) => {
  const p = new URLSearchParams();
  if (dateFrom) p.set("dateFrom", dateFrom);
  if (dateTo) p.set("dateTo", dateTo);
  if (download) p.set("download", "1");
  const qs = p.toString();
  return `${getApiBase()}/api/policies/${policyId}/estatement${qs ? `?${qs}` : ""}`;
};

export function PolicyDetailView({
  selectedPolicy, setSelectedPolicy, onBack, getClientName, countryFlagSettings, languages,
  branches, agents, groups, products, addOns,
  canWritePolicy, canWriteFinance, canEditPremium, canDeletePolicy, canEditPayment, canDeletePayment,
  canEditReceipt, canDeleteReceipt, canManageApprovals, canReadAuditLog, isAgent,
  showEditDialog, setShowEditDialog, editForm, setEditForm, openEditDialog,
  showUpgradeDialog, setShowUpgradeDialog, upgradeForm, setUpgradeForm, openUpgradeDialog,
  onOpenTransition, onOpenDelete, todayISO,
}: PolicyDetailViewProps) {
  const [docLang, setDocLang] = useState("en");

  const { data: policyDetail } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicy?.id, "detail"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load policy detail");
      return res.json();
    },
  });
  const displayPolicy = policyDetail || selectedPolicy;

  // Shared by the tab-badge dot below, the Overview tab's waiting-period block, and the
  // Waivers tab — queried once here and passed down so it isn't fetched three times.
  const { data: policyWaiver, refetch: refetchWaiver } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicy?.id, "waiver-request"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/waiver-request`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  // Shared by the Financials tab's "Automatic mobile payments" card and the Payments tab —
  // both need the client's saved mobile wallet, so it's queried once here.
  const { data: clientPaymentMethods } = useQuery<any[]>({
    queryKey: ["/api/clients", displayPolicy?.clientId, "payment-methods"],
    enabled: !!displayPolicy?.clientId,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${displayPolicy.clientId}/payment-methods`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  // Same queryKey as overview-tab.tsx's own policyHolderClient fetch — TanStack Query dedupes by
  // key, so this doesn't cost an extra network request, it just reads the client's phone for the
  // "Receipt payment" button's default reference and for the Members tab's policy-holder row.
  const { data: policyHolderClient } = useQuery<any>({
    queryKey: ["/api/clients", displayPolicy?.clientId, "policy-detail-holder"],
    enabled: !!displayPolicy?.clientId,
    queryFn: async () => {
      const cid = displayPolicy!.clientId as string;
      const res = await fetch(getApiBase() + `/api/clients/${cid}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const principalPhone = (() => {
    const fromDetail = String(policyHolderClient?.phone || "").trim();
    return fromDetail;
  })();

  const dialogs = useDetailDialogs({
    selectedPolicy, displayPolicy, clientPaymentMethods, products,
    showUpgradeDialog, setShowUpgradeDialog, upgradeForm, setUpgradeForm,
    onPolicyUpdated: (updated) => setSelectedPolicy(updated),
  });

  const receiptDialogs = useReceiptDialogs({
    selectedPolicy, displayPolicy, isAgent, canEditPremium, principalPhone,
  });

  if (!selectedPolicy) return null;

  const allowedTransitions = VALID_POLICY_TRANSITIONS[displayPolicy.status] || [];

  return (
    <PageShell>
      <section
        className="rounded-2xl border border-border/60 bg-card/90 shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.05))] px-4 py-5 sm:px-6 sm:py-6 space-y-5"
        aria-label="Policy summary"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between min-w-0">
          <div className="flex items-start gap-3 min-w-0">
            <Button variant="ghost" size="icon" aria-label="Back to policies list" className="shrink-0 mt-0.5" onClick={onBack} data-testid="btn-back-policies">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Policy</p>
              <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight break-words tabular-nums" data-testid="text-policy-number">{displayPolicy.policyNumber}</h1>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">Holder, cover, lifecycle, and ledger — structured for quick scanning.</p>
              {displayPolicy.isSouthAfrica && displayPolicy.externalReference && (
                <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-external-reference">{countryFlagSettings?.flagLabel || "South Africa"} reference: <span className="font-medium text-foreground">{displayPolicy.externalReference}</span></p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="badge-policy-status">
            <StatusBadge status={displayPolicy.status} />
            {displayPolicy.isSouthAfrica && (
              <Badge variant="outline" className="font-medium bg-blue-500/10 text-blue-700 border-blue-200" data-testid="badge-detail-south-africa">{countryFlagSettings?.flagLabel || "South Africa"}</Badge>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {(canWriteFinance || isAgent) && (
              <Button
                className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                onClick={receiptDialogs.openInPolicyReceipt}
                data-testid="btn-receipt-policy"
              >
                <Receipt className="h-4 w-4" /> Receipt payment
              </Button>
            )}
            {(canWriteFinance || isAgent) && (
              <Button
                variant="outline"
                className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                onClick={receiptDialogs.openPaymentLinkDialog}
                data-testid="btn-send-payment-link"
              >
                <Send className="h-4 w-4" /> Send Payment Link
              </Button>
            )}
            <Button variant="outline" className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => openEditDialog(displayPolicy)} data-testid="btn-edit-policy">
              <Pencil className="h-4 w-4" /> Edit
            </Button>
            <Button
              variant="outline"
              className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
              onClick={() => dialogs.openPolicyDocViewer(staffPolicyDocumentUrl(selectedPolicy.id, docLang))}
              data-testid="btn-view-policy-doc"
            >
              <FileText className="h-4 w-4" /> Policy document
            </Button>
            <Button
              variant="outline"
              className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
              onClick={() => dialogs.openEstatementViewer(staffEstatementUrl(selectedPolicy.id))}
              data-testid="btn-view-estatement-toolbar"
            >
              <FileText className="h-4 w-4" /> E-Statement
            </Button>
          </div>
          <div className="h-px bg-border/60" aria-hidden />
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            {!isAgent && allowedTransitions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-2" data-testid="btn-transition-policy">
                    <ArrowRightLeft className="h-4 w-4" /> Transition
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  {allowedTransitions.map((t) => (
                    <DropdownMenuItem key={t} onClick={() => onOpenTransition(displayPolicy, t)} data-testid={`menu-transition-${t}`}>
                      → {STATUS_LABELS[t] || t}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {canWritePolicy && (
              <Button variant="outline" size="sm" className="gap-2" onClick={() => openUpgradeDialog(displayPolicy)} data-testid="btn-upgrade-policy">
                <ArrowRightLeft className="h-4 w-4" /> Upgrade product
              </Button>
            )}
            <Select value={docLang} onValueChange={setDocLang}>
              <SelectTrigger className="w-[140px] h-9">
                <SelectValue placeholder="Language" />
              </SelectTrigger>
              <SelectContent>
                {(languages || [{ code: "en", name: "English" }]).map((l) => (
                  <SelectItem key={l.code} value={l.code}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Print policy document" aria-label="Print policy document" onClick={() => printDocument(staffPolicyDocumentUrl(selectedPolicy.id, docLang))} data-testid="btn-print-policy-doc">
              <Printer className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" title="Share policy document" aria-label="Share policy document" onClick={() => shareDocument(staffPolicyDocumentUrl(selectedPolicy.id, docLang), `Policy-${displayPolicy.policyNumber}`)}>
              <Share2 className="h-4 w-4" />
            </Button>
            {canDeletePolicy && (
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => onOpenDelete(displayPolicy)} data-testid="btn-delete-policy">
                <Trash2 className="h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        </div>
      </section>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-policy-overview">Overview</TabsTrigger>
          <TabsTrigger value="members" data-testid="tab-policy-members">Members</TabsTrigger>
          <TabsTrigger value="financials" data-testid="tab-policy-financials">Financials</TabsTrigger>
          <TabsTrigger value="payments" data-testid="tab-policy-payments">Payments</TabsTrigger>
          <TabsTrigger value="documents" data-testid="tab-policy-documents">Documents</TabsTrigger>
          <TabsTrigger value="waivers" data-testid="tab-policy-waivers">
            Waivers
            {policyWaiver?.status === "pending" && <span className="ml-1.5 inline-flex h-2 w-2 rounded-full bg-amber-500" />}
          </TabsTrigger>
          {canReadAuditLog && <TabsTrigger value="logs" data-testid="tab-policy-logs">Logs</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-4">
          <OverviewTab displayPolicy={displayPolicy} policyWaiver={policyWaiver} getClientName={getClientName} onOpenEditClientDialog={dialogs.openEditClientDialog} />
        </TabsContent>

        <TabsContent value="members" className="space-y-4 mt-4">
          {policyWaiver?.status === "approved" && (
            <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-800">
              <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 mr-1">WAIVER APPROVED</span>
              Waiting period has been formally waived — all members on this policy are immediately claimable.
            </div>
          )}
          <MembersTab
            selectedPolicy={selectedPolicy}
            displayPolicy={displayPolicy}
            canEditPremium={canEditPremium}
            addOns={addOns}
            getClientName={getClientName}
            policyHolderClient={policyHolderClient}
          />
        </TabsContent>

        <TabsContent value="financials" className="space-y-4 mt-4">
          <FinancialsTab displayPolicy={displayPolicy} clientPaymentMethods={clientPaymentMethods} onOpenPaymentMethodDialog={dialogs.openPaymentMethodDialog} />
        </TabsContent>

        <TabsContent value="payments" className="space-y-4 mt-4">
          <PaymentsTab
            selectedPolicy={selectedPolicy}
            canEditPayment={canEditPayment}
            canDeletePayment={canDeletePayment}
            canEditReceipt={canEditReceipt}
            canDeleteReceipt={canDeleteReceipt}
            onOpenReceiptView={receiptDialogs.openReceiptView}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4 mt-4">
          <DocumentsTab
            selectedPolicy={selectedPolicy}
            displayPolicy={displayPolicy}
            canWritePolicy={canWritePolicy}
            staffEstatementUrl={staffEstatementUrl}
            onOpenEstatementViewer={dialogs.openEstatementViewer}
          />
        </TabsContent>

        <TabsContent value="waivers" className="space-y-4 mt-4">
          <WaiversTab
            selectedPolicy={selectedPolicy}
            policyWaiver={policyWaiver}
            refetchWaiver={refetchWaiver}
            canWritePolicy={canWritePolicy}
            canManageApprovals={canManageApprovals}
          />
        </TabsContent>

        {canReadAuditLog && (
          <TabsContent value="logs" className="space-y-4 mt-4">
            <PolicyLogsTab selectedPolicy={selectedPolicy} />
          </TabsContent>
        )}
      </Tabs>

      {dialogs.node}
      {receiptDialogs.node}

      <EditPolicyDialog
        selectedPolicy={selectedPolicy}
        displayPolicy={displayPolicy}
        showEditDialog={showEditDialog}
        setShowEditDialog={setShowEditDialog}
        editForm={editForm}
        setEditForm={setEditForm}
        canEditPremium={canEditPremium}
        countryFlagSettings={countryFlagSettings}
        branches={branches}
        agents={agents}
        groups={groups}
        todayISO={todayISO}
        onUpdated={(updated) => setSelectedPolicy(updated)}
      />
    </PageShell>
  );
}
