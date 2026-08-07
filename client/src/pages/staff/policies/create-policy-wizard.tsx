import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ClientSearchInput } from "@/components/client-search-input";
import { CurrencySelect } from "@/components/currency-select";
import { CountryFlagFields, type CountryFlagSettings } from "@/components/country-flag-fields";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { resolveDobForQuote } from "@/lib/estimated-dob";
import { useSearch } from "wouter";
import { FileText, Plus, UserPlus, X, Share2, Loader2 } from "lucide-react";
import { calculatePremiumPreview } from "@/lib/policy-premium-preview";

const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;
function toUpper(value: string) { return value.trim().toUpperCase(); }
function isValidNationalId(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  const n = value.trim().toUpperCase();
  return NATIONAL_ID_REGEX.test(n);
}

interface CreatePolicyWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policyWizardFlag: boolean;
  canEditPremium: boolean;
  isAgent: boolean;
  user: any;
  agents: any[];
  branches: any[];
  headOfficeBranchId: string;
  groups: any[];
  products: any[];
  addOns: any[];
  countryFlagSettings: CountryFlagSettings | undefined;
}

/** The 4-step "Issue New Policy" wizard — relocated verbatim out of the (formerly) 4891-line
 *  policies.tsx. `products`, `groups`, and `addOns` are queried once in index.tsx and threaded
 *  down as props (products/groups are also needed by the Upgrade dialog and Edit Policy dialog
 *  respectively; addOns is also needed by the Members tab's add-ons dialog) — so those queries
 *  aren't duplicated across files. `showCreateDialog` similarly lives in index.tsx (not here)
 *  because the trigger button lives in policy-list-view.tsx, a different file from this wizard. */
export function CreatePolicyWizard({
  open, onOpenChange, policyWizardFlag, canEditPremium, isAgent, user,
  agents, branches, headOfficeBranchId, groups, products, addOns, countryFlagSettings,
}: CreatePolicyWizardProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [createForm, setCreateForm] = useState({
    clientId: "",
    agentId: "",
    beneficiaryDependentIds: [] as string[],
    beneficiaryId: "" as string,
    beneficiaryManual: { firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" },
    selectedProductId: "",
    productVersionId: "",
    premiumAmount: "",
    currency: "USD",
    paymentSchedule: "monthly",
    effectiveDate: "",
    paymentMethod: {
      methodType: "mobile" as const,
      provider: "ecocash",
      mobileNumber: "",
    },
    memberAddOns: {} as Record<string, string[]>,
    newClient: { firstName: "", lastName: "", phone: "", email: "", nationalId: "", dateOfBirth: "", gender: "", physicalAddress: "", postalAddress: "" },
    isLegacy: false,
    isSouthAfrica: false,
    externalReference: "",
    branchId: "",
  });
  const [createStep, setCreateStep] = useState(1);
  const [clientMode, setClientMode] = useState<"search" | "new">("search");
  // Mandatory quote-and-recommend (server/quote-engine.ts) — every non-legacy policy issuance
  // must have gone through this. Kept separate from createForm rather than merged into it: the
  // token is only valid for the exact productVersionId it was issued for, so tracking them as a
  // pair here means changing the product manually in Step 2 naturally invalidates a stale token
  // (it just won't match createForm.productVersionId at submit time) instead of needing an effect
  // to actively clear it.
  const [quoteResult, setQuoteResult] = useState<{
    recommended: { productId: string; productVersionId: string; productName: string; premium: string; currency: string; paymentSchedule: string; quoteToken: string } | null;
    alternatives: { productId: string; productVersionId: string; productName: string; premium: string; currency: string; paymentSchedule: string; quoteToken: string }[];
    quoteId?: string | null;
  } | null>(null);
  const [quoteLinkCopied, setQuoteLinkCopied] = useState(false);
  const [quoting, setQuoting] = useState(false);
  const [quoteApiError, setQuoteApiError] = useState<string | null>(null);
  // A brand-new client has no on-file dependents yet (unlike an existing client, whose real
  // dependents already feed the recommendation via the `dependents` query below) — this captures
  // just enough to price accurately: name + either an exact DOB or an estimated age. Not wired
  // into Step 3's actual "add dependent" form; staff still enters the real record there, with a
  // real DOB required as it already is today.
  const [quoteDependents, setQuoteDependents] = useState<{ firstName: string; lastName: string; dateOfBirth: string; estimatedAge: string }[]>([]);

  const searchString = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("create") === "1") {
      const clientId = params.get("clientId") || "";
      const groupId = params.get("groupId") || "";
      onOpenChange(true);
      setCreateForm((f) => ({ ...f, clientId, groupId }));
      if (clientId) setClientMode("search");
    }
  }, [searchString]);

  // "Convert to policy" from a vCard-captured lead (client/src/pages/staff/my-vcard.tsx) —
  // pre-fills the new-client fields and, if a quote was persisted for this lead, the
  // recommended product + comparison too, so staff don't re-enter or re-run anything.
  const leadIdConsumed = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const leadId = params.get("leadId");
    if (!leadId || leadIdConsumed.current === leadId) return;
    leadIdConsumed.current = leadId;
    (async () => {
      try {
        const leadRes = await apiRequest("GET", `/api/leads/${leadId}`);
        const lead = await leadRes.json();
        setClientMode("new");
        setCreateForm((f) => ({
          ...f,
          newClient: { ...f.newClient, firstName: lead.firstName || "", lastName: lead.lastName || "", phone: lead.phone || "", email: lead.email || "" },
        }));
        const quoteRes = await apiRequest("GET", `/api/leads/${leadId}/quote`).catch(() => null);
        if (quoteRes?.ok) {
          const quote = await quoteRes.json();
          setCreateForm((f) => ({
            ...f,
            newClient: { ...f.newClient, dateOfBirth: quote.policyholderDateOfBirth || f.newClient.dateOfBirth },
            selectedProductId: quote.recommendedProductId || f.selectedProductId,
            productVersionId: quote.recommendedProductVersionId || f.productVersionId,
          }));
          setQuoteDependents((quote.dependentsJson || []).map((d: any) => ({ firstName: d.firstName || "", lastName: d.lastName || "", dateOfBirth: d.dateOfBirth || "", estimatedAge: "" })));
          if (quote.recommendedProductVersionId) {
            setQuoteResult({
              recommended: {
                productId: quote.recommendedProductId || "",
                productVersionId: quote.recommendedProductVersionId,
                productName: quote.recommendedProductName || "",
                premium: quote.recommendedPremium || "0",
                currency: quote.currency,
                paymentSchedule: quote.paymentSchedule,
                quoteToken: "", // stale/not re-verifiable from a converted lead — staff re-runs "Get recommendation" to submit
              },
              alternatives: quote.alternativesJson || [],
            });
          }
        }
        onOpenChange(true);
      } catch {
        toast({ title: "Couldn't load this lead", variant: "destructive" });
      }
    })();
  }, [searchString]);

  useEffect(() => {
    if (isAgent && user?.id) {
      setCreateForm((f) => ({ ...f, agentId: user.id }));
    }
  }, [isAgent, user?.id]);

  useEffect(() => {
    if (headOfficeBranchId) {
      setCreateForm((f) => (f.branchId ? f : { ...f, branchId: headOfficeBranchId }));
    }
  }, [headOfficeBranchId]);

  // Legacy groups are backfilled from paper records — full beneficiary details (national ID,
  // phone, relationship) are frequently unknown, so the beneficiary section is optional here.
  const isLegacyGroupIssuance = !!groups.find((g: any) => g.id === (createForm as any).groupId)?.isLegacy;

  const { data: selectedClient } = useQuery<any>({
    queryKey: ["/api/clients", createForm.clientId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${createForm.clientId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!createForm.clientId,
  });

  // Legacy Individual/Legacy Group products are for quickly capturing historical clients —
  // same relaxation as a legacy group, since full details are frequently unknown up front.
  const selectedProductForCreate = products.find((p: any) => p.id === createForm.selectedProductId);
  const isLegacyProductIssuance = selectedProductForCreate?.code === "LEGIND" || selectedProductForCreate?.code === "LEGGRP";
  const isLegacyIssuance = isLegacyGroupIssuance || isLegacyProductIssuance;

  const { data: dependents } = useQuery<any[]>({
    queryKey: ["/api/clients", createForm.clientId, "dependents"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${createForm.clientId}/dependents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!createForm.clientId,
  });

  useEffect(() => {
    if (!createForm.clientId) return;
    if (dependents && dependents.length > 0 && createForm.beneficiaryDependentIds.length === 0) {
      setCreateForm((f) => ({ ...f, beneficiaryDependentIds: dependents.map((d: any) => d.id) }));
    }
  }, [createForm.clientId, dependents]);

  const [showAddDep, setShowAddDep] = useState(false);
  const [newDep, setNewDep] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });

  const addDepMutation = useMutation({
    mutationFn: async (data: typeof newDep) => {
      const res = await apiRequest("POST", `/api/clients/${createForm.clientId}/dependents`, {
        ...data,
        legacyGroupId: isLegacyGroupIssuance ? (createForm as any).groupId : undefined,
        legacyProductVersionId: isLegacyProductIssuance ? createForm.productVersionId : undefined,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", createForm.clientId, "dependents"] });
      setShowAddDep(false);
      setNewDep({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
      toast({ title: data.code === "EXISTING_DEPENDENT" ? "Matching dependent already on file — reused it" : "Dependent added" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const { data: productVersions } = useQuery<any[]>({
    queryKey: ["/api/products", createForm.selectedProductId, "versions"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/products/${createForm.selectedProductId}/versions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!createForm.selectedProductId,
  });

  useEffect(() => {
    if (createStep !== 2 || createForm.productVersionId) return;
    const activeVersion = productVersions?.find((v: any) => v.isActive);
    if (activeVersion) {
      setCreateForm((f) => ({ ...f, productVersionId: activeVersion.id }));
    }
  }, [createStep, productVersions, createForm.productVersionId]);

  const activeProductVersion = productVersions?.find((v: any) => v.isActive);

  const clientAge = useMemo(() => {
    if (!selectedClient?.dateOfBirth) return null;
    const dob = new Date(selectedClient.dateOfBirth);
    const today = new Date();
    let age = today.getFullYear() - dob.getFullYear();
    const m = today.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
    return age;
  }, [selectedClient]);

  const selectedVersion = useMemo(() => {
    if (!createForm.productVersionId || !productVersions) return null;
    return productVersions.find((v: any) => v.id === createForm.productVersionId);
  }, [createForm.productVersionId, productVersions]);

  const selectedProduct = useMemo(() => {
    if (!createForm.selectedProductId || !products) return null;
    return products.find((p: any) => p.id === createForm.selectedProductId) || null;
  }, [createForm.selectedProductId, products]);

  const calculatedPremium = useMemo(
    () => calculatePremiumPreview({
      selectedVersion,
      selectedProduct,
      currency: createForm.currency,
      paymentSchedule: createForm.paymentSchedule,
      memberAddOns: createForm.memberAddOns,
      beneficiaryDependentIds: createForm.beneficiaryDependentIds,
      dependents,
      addOns,
    }),
    [selectedVersion, selectedProduct, createForm.currency, createForm.paymentSchedule, createForm.memberAddOns, createForm.beneficiaryDependentIds, dependents, addOns],
  );

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      let clientId = data.clientId;
      let clientSavedThisAttempt = false;

      if (clientMode === "new" && !clientId) {
        if (!data.newClient.firstName || !data.newClient.lastName) {
          throw new Error("First name and last name are required to create a new client.");
        }
        if (!isLegacyIssuance) {
          if (!data.newClient.nationalId?.trim()) throw new Error("National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38).");
          if (!isValidNationalId(data.newClient.nationalId)) throw new Error("National ID must be digits, one letter, then two digits (e.g. 08833089H38).");
          if (!data.newClient.phone?.trim()) throw new Error("Phone is required.");
          if (!data.newClient.dateOfBirth) throw new Error("Date of birth is required.");
          if (!data.newClient.gender) throw new Error("Gender is required.");
        } else if (data.newClient.nationalId?.trim() && !isValidNationalId(data.newClient.nationalId)) {
          throw new Error("National ID must be digits, one letter, then two digits (e.g. 08833089H38).");
        }
        const clientRes = await apiRequest("POST", "/api/clients", {
          firstName: toUpper(data.newClient.firstName),
          lastName: toUpper(data.newClient.lastName),
          phone: data.newClient.phone ? toUpper(data.newClient.phone) : undefined,
          email: data.newClient.email?.trim() || undefined,
          nationalId: data.newClient.nationalId ? toUpper(data.newClient.nationalId) : undefined,
          dateOfBirth: data.newClient.dateOfBirth || undefined,
          gender: data.newClient.gender ? toUpper(data.newClient.gender) : undefined,
          physicalAddress: data.newClient.physicalAddress?.trim() || undefined,
          postalAddress: data.newClient.postalAddress?.trim() || undefined,
          legacyProductVersionId: isLegacyProductIssuance ? data.productVersionId : undefined,
        });
        const clientData = await clientRes.json();
        // Handle existing client returned instead of new creation
        if (clientData.code === "EXISTING_CLIENT" && clientData.existingClient) {
          const ec = clientData.existingClient;
          clientId = ec.id;
          toast({
            title: "Existing client found",
            description: `Using ${ec.firstName} ${ec.lastName} (${ec.nationalId || "—"}, ${ec.phone || "—"})`,
          });
        } else {
          clientId = clientData.id;
          clientSavedThisAttempt = true;
        }
      }

      if (!clientId) {
        throw new Error("No client selected. Choose an existing lead or complete the new client details.");
      }

      const members = (data.beneficiaryDependentIds || []).map((dependentId: string) => ({ dependentId, role: "dependent" }));

      const memberAddOns: { memberRef: string; addOnId: string }[] = [];
      const validMemberRefs = new Set(["holder", ...(data.beneficiaryDependentIds || [])]);
      for (const [memberRef, aoIds] of Object.entries(data.memberAddOns || {})) {
        if (!validMemberRefs.has(memberRef)) continue;
        for (const addOnId of aoIds) {
          memberAddOns.push({ memberRef, addOnId });
        }
      }

      let beneficiary: any = undefined;
      if (data.beneficiaryId) {
        const dep = (dependents || []).find((d: any) => d.id === data.beneficiaryId);
        if (!dep) throw new Error("The selected beneficiary was not found. Please re-select a beneficiary or enter one manually.");
        beneficiary = {
          dependentId: dep.id,
          firstName: dep.firstName,
          lastName: dep.lastName,
          relationship: dep.relationship,
          nationalId: dep.nationalId || "",
          phone: dep.phone || "",
        };
      } else if (data.beneficiaryManual.firstName && data.beneficiaryManual.lastName) {
        if (!isLegacyIssuance && (!data.beneficiaryManual.relationship?.trim() || !data.beneficiaryManual.nationalId?.trim() || !data.beneficiaryManual.phone?.trim())) {
          throw new Error("Beneficiary: all fields are required (first name, last name, relationship, national ID, phone).");
        }
        if (data.beneficiaryManual.nationalId?.trim() && !isValidNationalId(data.beneficiaryManual.nationalId)) {
          throw new Error("Beneficiary national ID must be digits, one letter, then two digits (e.g. 08833089H38).");
        }
        beneficiary = {
          firstName: toUpper(data.beneficiaryManual.firstName),
          lastName: toUpper(data.beneficiaryManual.lastName),
          relationship: toUpper(data.beneficiaryManual.relationship),
          nationalId: data.beneficiaryManual.nationalId ? toUpper(data.beneficiaryManual.nationalId) : "",
          phone: data.beneficiaryManual.phone ? toUpper(data.beneficiaryManual.phone) : "",
        };
      }

      try {
        // Only sent when it matches the product actually being submitted — if the product was
        // changed manually after a recommendation was fetched for a different one, the token is
        // simply omitted rather than sent stale (see quoteResult's comment above).
        const quoteToken = quoteResult?.recommended?.productVersionId === data.productVersionId
          ? quoteResult.recommended.quoteToken
          : quoteResult?.alternatives.find((a) => a.productVersionId === data.productVersionId)?.quoteToken;
        const res = await apiRequest("POST", "/api/policies", {
          clientId,
          agentId: data.agentId || undefined,
          groupId: (data as any).groupId || undefined,
          productVersionId: data.productVersionId,
          premiumAmount: data.premiumAmount,
          currency: data.currency,
          paymentSchedule: data.paymentSchedule,
          effectiveDate: data.effectiveDate || undefined,
          paymentMethod: data.paymentMethod,
          members,
          memberAddOns,
          beneficiary,
          isLegacy: data.isLegacy || undefined,
          isSouthAfrica: (data as any).isSouthAfrica || undefined,
          externalReference: (data as any).externalReference?.trim() || undefined,
          branchId: (data as any).branchId || undefined,
          quoteToken,
        });
        return res.json();
      } catch (err) {
        if (clientSavedThisAttempt && clientId) {
          const e = err instanceof Error ? err : new Error(String(err));
          (e as Error & { clientSavedId?: string }).clientSavedId = clientId;
          throw e;
        }
        throw err;
      }
    },
    onSuccess: (policy: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      onOpenChange(false);
      setCreateStep(1);
      setClientMode("search");
      setQuoteResult(null);
      setQuoteApiError(null);
      setQuoteDependents([]);
      setCreateForm({
        clientId: "",
        agentId: isAgent && user?.id ? user.id : "",
        beneficiaryDependentIds: [],
        beneficiaryId: "",
        beneficiaryManual: { firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" },
        selectedProductId: "",
        productVersionId: "",
        premiumAmount: "",
        currency: "USD",
        paymentSchedule: "monthly",
        effectiveDate: "",
        paymentMethod: {
          methodType: "mobile" as const,
          provider: "ecocash",
          mobileNumber: "",
        },
        memberAddOns: {},
        newClient: { firstName: "", lastName: "", phone: "", email: "", nationalId: "", dateOfBirth: "", gender: "", physicalAddress: "", postalAddress: "" },
        isLegacy: false,
        isSouthAfrica: false,
        externalReference: "",
        branchId: headOfficeBranchId,
      });
      toast({ title: "Policy created", description: policy.isLegacy ? `Policy ${policy.policyNumber} has been created and auto-activated as a legacy policy.` : `Policy ${policy.policyNumber} has been created in inactive status.` });
    },
    onError: (err: Error & { clientSavedId?: string }) => {
      if (err.clientSavedId) {
        setCreateForm((f) => ({ ...f, clientId: err.clientSavedId! }));
        setClientMode("search");
        toast({
          title: "Client saved — policy not created",
          description: `${err.message} The client is selected under "Existing lead". Complete the remaining steps and submit again.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setCreateStep(1); }}>
      <DialogContent className={policyWizardFlag ? "sm:max-w-2xl max-h-[92vh] flex flex-col" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary shrink-0" />
            Issue New Policy
          </DialogTitle>

          {policyWizardFlag ? (
            /* Step progress bar */
            <div className="flex items-center gap-0 mt-3 pb-1">
              {[
                { step: 1, label: "Policy Holder" },
                { step: 2, label: "Product" },
                { step: 3, label: "Add-ons" },
                { step: 4, label: "Review" },
              ].map((s, i) => (
                <div key={s.step} className="flex items-center flex-1 min-w-0">
                  <div className={"flex items-center gap-1.5 text-xs font-medium " + (createStep === s.step ? "text-primary" : createStep > s.step ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
                    <span className={"inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold shrink-0 " + (createStep === s.step ? "bg-primary text-primary-foreground" : createStep > s.step ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400" : "bg-muted text-muted-foreground")}>
                      {createStep > s.step ? "✓" : s.step}
                    </span>
                    <span className="hidden sm:inline truncate">{s.label}</span>
                  </div>
                  {i < 3 && <div className={"h-px flex-1 mx-1 " + (createStep > s.step ? "bg-emerald-300 dark:bg-emerald-700" : "bg-border")} />}
                </div>
              ))}
            </div>
          ) : (
            <DialogDescription>
              {createStep === 1 && "Select an existing lead or create a new client. A client record is auto-created if needed."}
              {createStep === 2 && "Select product and version for this tenant."}
              {createStep === 3 && "Select add-ons (optional)."}
              {createStep === 4 && "Review premium and save. A unique policy number will be generated."}
            </DialogDescription>
          )}
        </DialogHeader>
        {policyWizardFlag && (
          <p className="text-sm text-muted-foreground -mt-1 pb-1 border-b">
            {createStep === 1 && "Select an existing lead or create a new client."}
            {createStep === 2 && "Choose the product and version to cover this policy."}
            {createStep === 3 && "Add optional extras for each member. You can skip this step."}
            {createStep === 4 && "Confirm the premium, billing schedule, and payment method, then submit."}
          </p>
        )}
        <div className={"space-y-4 " + (policyWizardFlag ? "overflow-y-auto flex-1 pr-1" : "")}>
          {createStep === 1 && (
            <>
              {canEditPremium && (
                <div className="flex items-start gap-3 border rounded-md p-3 bg-amber-50/50 dark:bg-amber-950/20">
                  <Checkbox
                    id="create-legacy-flag"
                    checked={createForm.isLegacy}
                    onCheckedChange={(v) => setCreateForm({ ...createForm, isLegacy: !!v })}
                    data-testid="checkbox-is-legacy"
                  />
                  <div className="space-y-1 leading-none">
                    <label htmlFor="create-legacy-flag" className="text-sm font-medium cursor-pointer">Mark as legacy / pre-existing policy</label>
                    <p className="text-xs text-muted-foreground">This policy was captured from a prior system. It will be automatically activated with no waiting period, and skips the quote/recommendation step below.</p>
                  </div>
                </div>
              )}
              <CountryFlagFields
                settings={countryFlagSettings}
                idPrefix="create-policy"
                checked={createForm.isSouthAfrica}
                reference={createForm.externalReference}
                onCheckedChange={(v) => setCreateForm({ ...createForm, isSouthAfrica: v })}
                onReferenceChange={(v) => setCreateForm({ ...createForm, externalReference: v })}
              />
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label>Policy holder</Label>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      variant={clientMode === "search" ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => setClientMode("search")}
                    >
                      Existing Lead
                    </Button>
                    <Button
                      type="button"
                      variant={clientMode === "new" ? "default" : "outline"}
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => { setClientMode("new"); setCreateForm((f) => ({ ...f, clientId: "", beneficiaryDependentIds: [], beneficiaryId: "" })); }}
                    >
                      New Client
                    </Button>
                  </div>
                </div>
                {clientMode === "search" ? (
                  <>
                    <ClientSearchInput
                      value={createForm.clientId}
                      onChange={(id) => setCreateForm({ ...createForm, clientId: id, beneficiaryDependentIds: [], beneficiaryId: "" })}
                      placeholder="Search lead by name, email, or phone..."
                      data-testid="select-client"
                    />
                    {selectedClient && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {selectedClient.firstName} {selectedClient.lastName}
                        {clientAge != null && ` · Age: ${clientAge}`}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                    <p className="text-xs text-muted-foreground">A client record will be auto-created when the policy is saved. All fields required except email. Text is stored in uppercase. National ID: digits + check letter + 2 digits (e.g. 08833089H38).</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-first-name">First Name *</Label>
                        <Input id="create-form-new-client-first-name"
                          value={createForm.newClient.firstName}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, firstName: e.target.value } })}
                          onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, firstName: toUpper(e.target.value) } })}
                          placeholder="First name"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-last-name">Last Name *</Label>
                        <Input id="create-form-new-client-last-name"
                          value={createForm.newClient.lastName}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, lastName: e.target.value } })}
                          onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, lastName: toUpper(e.target.value) } })}
                          placeholder="Last name"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-phone">Phone *</Label>
                        <Input id="create-form-new-client-phone"
                          value={createForm.newClient.phone}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, phone: e.target.value } })}
                          onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, phone: toUpper(e.target.value) } })}
                          placeholder="Phone number"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-email">Email</Label>
                        <Input id="create-form-new-client-email"
                          type="email"
                          value={createForm.newClient.email}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, email: e.target.value } })}
                          placeholder="Email address"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-national-id">National ID *</Label>
                        <Input id="create-form-new-client-national-id"
                          value={createForm.newClient.nationalId}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, nationalId: e.target.value } })}
                          onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, nationalId: toUpper(e.target.value) } })}
                          placeholder="e.g. 08833089H38"
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-date-of-birth">Date of Birth *</Label>
                        <Input id="create-form-new-client-date-of-birth"
                          type="date"
                          value={createForm.newClient.dateOfBirth}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, dateOfBirth: e.target.value } })}
                        />
                      </div>
                      <div>
                        <Label className="text-xs" htmlFor="create-form-new-client-gender">Gender *</Label>
                        <Select
                          value={createForm.newClient.gender}
                          onValueChange={(v) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, gender: v } })}
                        >
                          <SelectTrigger id="create-form-new-client-gender"><SelectValue placeholder="Select..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="male">Male</SelectItem>
                            <SelectItem value="female">Female</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="col-span-2">
                        <Label className="text-xs" htmlFor="create-form-new-client-physical-address">Physical Address</Label>
                        <Input id="create-form-new-client-physical-address"
                          value={createForm.newClient.physicalAddress}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, physicalAddress: e.target.value } })}
                          placeholder="Street address, suburb, city"
                        />
                      </div>
                      <div className="col-span-2">
                        <div className="flex items-center justify-between mb-1">
                          <Label className="text-xs">Postal Address</Label>
                          <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none">
                            <Checkbox
                              checked={createForm.newClient.postalAddress === createForm.newClient.physicalAddress && !!createForm.newClient.physicalAddress}
                              onCheckedChange={(checked) =>
                                setCreateForm({ ...createForm, newClient: { ...createForm.newClient, postalAddress: checked ? createForm.newClient.physicalAddress : "" } })
                              }
                            />
                            Same as physical
                          </label>
                        </div>
                        <Input
                          value={createForm.newClient.postalAddress}
                          onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, postalAddress: e.target.value } })}
                          placeholder="P.O. Box or postal address"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div>
                <Label>Agent</Label>
                {isAgent ? (
                  <>
                    <Input
                      value={user?.displayName || user?.email || ""}
                      readOnly
                      disabled
                      className="bg-muted"
                      data-testid="select-agent"
                    />
                    <p className="text-xs text-muted-foreground mt-1">Auto-assigned to you as the issuing agent.</p>
                  </>
                ) : (
                  <>
                    <Select
                      value={createForm.agentId || "walk-in"}
                      onValueChange={(v) => setCreateForm({ ...createForm, agentId: v === "walk-in" ? "" : v })}
                    >
                      <SelectTrigger data-testid="select-agent">
                        <SelectValue placeholder="Walk-in" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="walk-in">Walk-in (no agent)</SelectItem>
                        {agents.map((a: any) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.displayName || a.email} {a.referralCode ? `(${a.referralCode})` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">Default: Walk-in. Select an agent to attribute this policy.</p>
                  </>
                )}
              </div>
              {createForm.clientId && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label>Dependents</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1 h-7 text-xs"
                      onClick={() => setShowAddDep(true)}
                    >
                      <UserPlus className="h-3 w-3" /> Add Dependent
                    </Button>
                  </div>
                  {dependents && dependents.length > 0 ? (
                    <div className="border rounded-md p-3 space-y-2 max-h-40 overflow-y-auto">
                      {dependents.map((d: any) => {
                        const depAge = d.dateOfBirth ? (() => {
                          const dob = new Date(d.dateOfBirth);
                          const today = new Date();
                          let age = today.getFullYear() - dob.getFullYear();
                          const m = today.getMonth() - dob.getMonth();
                          if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
                          return age;
                        })() : null;
                        return (
                        <div key={d.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`dep-${d.id}`}
                            checked={createForm.beneficiaryDependentIds.includes(d.id)}
                            onCheckedChange={(checked) => {
                              const next = checked
                                ? [...createForm.beneficiaryDependentIds, d.id]
                                : createForm.beneficiaryDependentIds.filter((id) => id !== d.id);
                              setCreateForm({ ...createForm, beneficiaryDependentIds: next });
                            }}
                          />
                          <label htmlFor={`dep-${d.id}`} className="text-sm cursor-pointer">
                            {d.firstName} {d.lastName}
                            {d.relationship ? ` (${d.relationship})` : ""}
                            {depAge != null && ` · Age: ${depAge}`}
                          </label>
                        </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No dependents yet. Add dependents to include them on the policy.</p>
                  )}
                  {showAddDep && (
                    <div className="border rounded-md p-3 mt-2 space-y-3 bg-muted/20">
                      <p className="text-xs text-muted-foreground">
                        {isLegacyIssuance
                          ? "Name and relationship required. National ID, date of birth and gender are optional for Legacy Individual/Group policies."
                          : "All fields required except National ID."} Text stored in uppercase.
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs" htmlFor="new-dep-first-name">First Name *</Label>
                          <Input id="new-dep-first-name" value={newDep.firstName} onChange={(e) => setNewDep({ ...newDep, firstName: e.target.value })} onBlur={(e) => setNewDep({ ...newDep, firstName: toUpper(e.target.value) })} placeholder="First name" />
                        </div>
                        <div>
                          <Label className="text-xs" htmlFor="new-dep-last-name">Last Name *</Label>
                          <Input id="new-dep-last-name" value={newDep.lastName} onChange={(e) => setNewDep({ ...newDep, lastName: e.target.value })} onBlur={(e) => setNewDep({ ...newDep, lastName: toUpper(e.target.value) })} placeholder="Last name" />
                        </div>
                        <div>
                          <Label className="text-xs" htmlFor="new-dep-relationship">Relationship *</Label>
                          <Select value={newDep.relationship} onValueChange={(v) => setNewDep({ ...newDep, relationship: v })}>
                            <SelectTrigger id="new-dep-relationship"><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">National ID</Label>
                          <Input value={newDep.nationalId} onChange={(e) => setNewDep({ ...newDep, nationalId: e.target.value })} onBlur={(e) => setNewDep({ ...newDep, nationalId: toUpper(e.target.value) })} placeholder="e.g. 08833089H38" />
                        </div>
                        <div>
                          <Label className="text-xs">Date of Birth {isLegacyIssuance ? "" : "*"}</Label>
                          <Input type="date" value={newDep.dateOfBirth} onChange={(e) => setNewDep({ ...newDep, dateOfBirth: e.target.value })} />
                        </div>
                        <div>
                          <Label className="text-xs">Gender {isLegacyIssuance ? "" : "*"}</Label>
                          <Select value={newDep.gender} onValueChange={(v) => setNewDep({ ...newDep, gender: v })}>
                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => addDepMutation.mutate(newDep)}
                          disabled={!newDep.firstName?.trim() || !newDep.lastName?.trim() || !newDep.relationship || (!isLegacyIssuance && (!newDep.dateOfBirth || !newDep.gender)) || addDepMutation.isPending}
                        >
                          {addDepMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                          Save Dependent
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setShowAddDep(false); setNewDep({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" }); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {(createForm.clientId || clientMode === "new") && (
                <div>
                  <Label>Beneficiary (required — max 1)</Label>
                  {clientMode === "search" && createForm.clientId ? (
                    <Select
                      value={createForm.beneficiaryId || "__manual__"}
                      onValueChange={(v) => {
                        if (v === "__manual__") {
                          setCreateForm({ ...createForm, beneficiaryId: "" });
                        } else {
                          setCreateForm({ ...createForm, beneficiaryId: v, beneficiaryManual: { firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" } });
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select beneficiary..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__manual__">Enter manually</SelectItem>
                        {dependents?.map((d: any) => (
                          <SelectItem key={d.id} value={d.id}>
                            {d.firstName} {d.lastName} ({d.relationship})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">Enter beneficiary details below.</p>
                  )}
                  {!createForm.beneficiaryId && (
                    <div className="border rounded-md p-3 mt-2 space-y-3 bg-muted/20">
                      <p className="text-xs text-muted-foreground">All beneficiary fields required. National ID: digits + check letter + 2 digits (e.g. 08833089H38).</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">First Name *</Label>
                          <Input value={createForm.beneficiaryManual.firstName} onChange={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, firstName: e.target.value } })} onBlur={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, firstName: toUpper(e.target.value) } })} placeholder="First name" />
                        </div>
                        <div>
                          <Label className="text-xs">Last Name *</Label>
                          <Input value={createForm.beneficiaryManual.lastName} onChange={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, lastName: e.target.value } })} onBlur={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, lastName: toUpper(e.target.value) } })} placeholder="Last name" />
                        </div>
                        <div>
                          <Label className="text-xs">Relationship *</Label>
                          <Select value={createForm.beneficiaryManual.relationship} onValueChange={(v) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, relationship: v } })}>
                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                                <SelectItem key={r} value={r}>{r}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label className="text-xs">National ID *</Label>
                          <Input value={createForm.beneficiaryManual.nationalId} onChange={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, nationalId: e.target.value } })} onBlur={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, nationalId: toUpper(e.target.value) } })} placeholder="e.g. 08833089H38" />
                        </div>
                        <div>
                          <Label className="text-xs">Phone *</Label>
                          <Input value={createForm.beneficiaryManual.phone} onChange={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, phone: e.target.value } })} onBlur={(e) => setCreateForm({ ...createForm, beneficiaryManual: { ...createForm.beneficiaryManual, phone: toUpper(e.target.value) } })} placeholder="Phone number" />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {!createForm.isLegacy && (() => {
                const policyholderDob = clientMode === "search" ? selectedClient?.dateOfBirth : createForm.newClient.dateOfBirth;
                // Existing client: their on-file dependents (already fetched above for the
                // beneficiary picker) already have real DOBs. A brand-new client has no
                // dependent records yet — quoteDependents captures just enough to price
                // accurately (name + exact DOB or an estimated age) without duplicating Step 3's
                // real "add dependent" form; the real record with a real DOB is still required
                // there, same as today.
                const dependentDobsForQuote = clientMode === "search"
                  ? (dependents || []).map((d: any) => d.dateOfBirth)
                  : quoteDependents.map((d) => resolveDobForQuote(d.dateOfBirth, d.estimatedAge)).filter((d): d is string => !!d);
                const dependentsForQuote = clientMode === "search"
                  ? (dependents || []).map((d: any) => ({ firstName: d.firstName, lastName: d.lastName, dateOfBirth: d.dateOfBirth }))
                  : quoteDependents.map((d) => ({ firstName: d.firstName, lastName: d.lastName, dateOfBirth: resolveDobForQuote(d.dateOfBirth, d.estimatedAge) || "" }));
                const policyholderName = clientMode === "search"
                  ? (selectedClient ? `${selectedClient.firstName} ${selectedClient.lastName}` : "")
                  : `${createForm.newClient.firstName} ${createForm.newClient.lastName}`.trim();
                const usedEstimatedAge = clientMode === "new" && quoteDependents.some((d) => !d.dateOfBirth && d.estimatedAge);
                const addQuoteDependent = () => setQuoteDependents((d) => [...d, { firstName: "", lastName: "", dateOfBirth: "", estimatedAge: "" }]);
                const removeQuoteDependent = (i: number) => setQuoteDependents((d) => d.filter((_, idx) => idx !== i));
                const updateQuoteDependent = (i: number, field: "firstName" | "lastName" | "dateOfBirth" | "estimatedAge", value: string) =>
                  setQuoteDependents((d) => d.map((dep, idx) => (idx === i ? { ...dep, [field]: value } : dep)));
                const getRecommendation = async () => {
                  if (!policyholderDob) return;
                  setQuoting(true);
                  setQuoteApiError(null);
                  try {
                    const res = await apiRequest("POST", "/api/quote", {
                      policyholderName,
                      policyholderDateOfBirth: policyholderDob,
                      dependents: dependentsForQuote,
                      dependentDateOfBirths: dependentDobsForQuote,
                    });
                    const data = await res.json();
                    setQuoteResult(data);
                    if (data.recommended) {
                      setCreateForm((f) => ({ ...f, selectedProductId: data.recommended.productId, productVersionId: data.recommended.productVersionId }));
                    }
                  } catch {
                    setQuoteApiError("Couldn't get a recommendation right now — you can still pick a product manually on the next step.");
                  } finally {
                    setQuoting(false);
                  }
                };
                const useCandidate = (c: { productId: string; productVersionId: string }) =>
                  setCreateForm((f) => ({ ...f, selectedProductId: c.productId, productVersionId: c.productVersionId }));
                return (
                  <div className="border rounded-md p-3 space-y-3 bg-muted/20">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">Product recommendation</p>
                      <Button type="button" size="sm" variant="outline" disabled={!policyholderDob || quoting} onClick={getRecommendation} data-testid="button-get-recommendation">
                        {quoting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                        Get recommendation
                      </Button>
                    </div>
                    {!policyholderDob && (
                      <p className="text-xs text-muted-foreground">Enter the policy holder's date of birth above to get a suggested product and premium.</p>
                    )}
                    {clientMode === "new" && (
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground">Dependants to cover, for an accurate quote (their full details are still captured properly in a later step):</p>
                        {quoteDependents.map((dep, i) => (
                          <div key={i} className="rounded-md border p-2 space-y-1.5 relative bg-background">
                            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 absolute top-1.5 right-1.5" onClick={() => removeQuoteDependent(i)}>
                              <X className="h-3 w-3" />
                            </Button>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pr-6">
                              <Input className="h-8 text-xs" placeholder="First name" value={dep.firstName} onChange={(e) => updateQuoteDependent(i, "firstName", e.target.value)} />
                              <Input className="h-8 text-xs" placeholder="Last name" value={dep.lastName} onChange={(e) => updateQuoteDependent(i, "lastName", e.target.value)} />
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                              <Input className="h-8 text-xs" type="date" value={dep.dateOfBirth} onChange={(e) => updateQuoteDependent(i, "dateOfBirth", e.target.value)} />
                              {!dep.dateOfBirth && (
                                <Input className="h-8 text-xs" type="number" min="0" max="120" placeholder="Est. age if DOB unknown" value={dep.estimatedAge} onChange={(e) => updateQuoteDependent(i, "estimatedAge", e.target.value)} />
                              )}
                            </div>
                          </div>
                        ))}
                        <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addQuoteDependent}>
                          <Plus className="h-3 w-3" /> Add a dependant
                        </Button>
                      </div>
                    )}
                    {quoteApiError && <p className="text-xs text-destructive">{quoteApiError}</p>}
                    {usedEstimatedAge && (
                      <p className="text-xs text-muted-foreground">Using estimated ages for one or more dependants — this will be re-priced exactly once their real dates of birth are captured.</p>
                    )}
                    {quoteResult?.recommended && (
                      <div className="space-y-2">
                        <div className={"flex items-center justify-between rounded-md border p-2 " + (createForm.productVersionId === quoteResult.recommended.productVersionId ? "border-primary bg-primary/5" : "")}>
                          <div>
                            <p className="text-sm font-medium">{quoteResult.recommended.productName} <Badge variant="outline" className="ml-1 text-[10px]">Recommended</Badge></p>
                            <p className="text-xs text-muted-foreground tabular-nums">{quoteResult.recommended.currency} {parseFloat(quoteResult.recommended.premium).toFixed(2)} / {quoteResult.recommended.paymentSchedule}</p>
                          </div>
                          {createForm.productVersionId !== quoteResult.recommended.productVersionId && (
                            <Button type="button" size="sm" variant="ghost" onClick={() => useCandidate(quoteResult.recommended!)}>Use this</Button>
                          )}
                        </div>
                        {quoteResult.alternatives.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <p className="text-xs text-muted-foreground">Compared to other plans:</p>
                            {quoteResult.alternatives.map((alt) => (
                              <div key={alt.productVersionId} className={"flex items-center justify-between rounded-md border p-2 " + (createForm.productVersionId === alt.productVersionId ? "border-primary bg-primary/5" : "")}>
                                <div>
                                  <p className="text-xs font-medium">{alt.productName}</p>
                                  <p className="text-xs text-muted-foreground tabular-nums">{alt.currency} {parseFloat(alt.premium).toFixed(2)} / {alt.paymentSchedule}</p>
                                </div>
                                {createForm.productVersionId !== alt.productVersionId && (
                                  <Button type="button" size="sm" variant="ghost" onClick={() => useCandidate(alt)}>Use this</Button>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {quoteResult.quoteId && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="w-full gap-1.5"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/quote/${quoteResult.quoteId}`);
                              setQuoteLinkCopied(true);
                              setTimeout(() => setQuoteLinkCopied(false), 2000);
                            }}
                          >
                            <Share2 className="h-3.5 w-3.5" /> {quoteLinkCopied ? "Link copied" : "Copy shareable link for client"}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </>
          )}
          {createStep === 2 && (
            <>
                <div>
                  <Label>Product</Label>
                  <Select
                    value={createForm.selectedProductId}
                    onValueChange={(v) => setCreateForm({ ...createForm, selectedProductId: v, productVersionId: "" })}
                  >
                    <SelectTrigger data-testid="select-product">
                      <SelectValue placeholder="Select product..." />
                    </SelectTrigger>
                    <SelectContent>
                      {products?.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {createForm.selectedProductId && (
                  <div>
                    <Label>Product version</Label>
                    {activeProductVersion ? (
                      <>
                        <Input
                          readOnly
                          disabled
                          className="bg-muted"
                          value={`Version ${activeProductVersion.version ?? activeProductVersion.versionNumber ?? ""}${activeProductVersion.effectiveFrom ? ` (from ${activeProductVersion.effectiveFrom})` : ""} — Active`}
                          data-testid="select-product-version"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Only the active version can be used for new policies.</p>
                      </>
                    ) : (
                      <>
                        <Select
                          value={createForm.productVersionId}
                          onValueChange={(v) => setCreateForm({ ...createForm, productVersionId: v })}
                        >
                          <SelectTrigger data-testid="select-product-version">
                            <SelectValue placeholder="Select version..." />
                          </SelectTrigger>
                          <SelectContent>
                            {productVersions?.map((v: any) => (
                              <SelectItem key={v.id} value={v.id}>
                                {`Version ${v.version ?? v.versionNumber ?? ""}${v.effectiveFrom ? ` (${v.effectiveFrom})` : ""}`.trim() || v.id}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-amber-600 mt-1">No active version found. Select a version manually.</p>
                      </>
                    )}
                  </div>
                )}
              </>
          )}
          {createStep === 3 && (() => {
            const activeAddOns = addOns?.filter((a: any) => a.isActive !== false) || [];
            const policyMembers: { ref: string; label: string }[] = [];
            if (selectedClient) {
              policyMembers.push({ ref: "holder", label: `${selectedClient.firstName} ${selectedClient.lastName} (Policy holder)` });
            } else if (clientMode === "new" && createForm.newClient.firstName) {
              policyMembers.push({ ref: "holder", label: `${createForm.newClient.firstName} ${createForm.newClient.lastName} (Policy holder — new)` });
            }
            if (dependents) {
              for (const d of dependents) {
                if (createForm.beneficiaryDependentIds.includes(d.id)) {
                  policyMembers.push({ ref: d.id, label: `${d.firstName} ${d.lastName}${d.relationship ? ` (${d.relationship})` : " (Dependent)"}` });
                }
              }
            }

            const toggleMemberAddOn = (memberRef: string, addOnId: string, checked: boolean) => {
              setCreateForm((f) => {
                const current = f.memberAddOns[memberRef] || [];
                const next = checked ? [...current, addOnId] : current.filter((id) => id !== addOnId);
                return { ...f, memberAddOns: { ...f.memberAddOns, [memberRef]: next } };
              });
            };

            if (activeAddOns.length === 0) {
              return <p className="text-sm text-muted-foreground">No add-ons configured for this tenant.</p>;
            }

            return (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">Select which add-ons apply to each member. Price shown matches the policy's billing schedule.</p>
                {policyMembers.map((member) => (
                  <div key={member.ref} className="border rounded-md p-3 space-y-2">
                    <p className="text-sm font-semibold">{member.label}</p>
                    {activeAddOns.map((a: any) => {
                      const memberAo = createForm.memberAddOns[member.ref] || [];
                      const scheduleLabel = createForm.paymentSchedule === "weekly" ? "/wk" : createForm.paymentSchedule === "biweekly" ? "/2wk" : "/mo";
                      let displayPrice: string | null = null;
                      if (a.pricingMode === "percentage") {
                        displayPrice = `${a.priceAmount || a.priceMonthly || "0"}%`;
                      } else {
                        const p = createForm.paymentSchedule === "weekly" && a.priceWeekly ? a.priceWeekly
                          : createForm.paymentSchedule === "biweekly" && a.priceBiweekly ? a.priceBiweekly
                          : (a.priceMonthly || a.priceAmount);
                        if (p) displayPrice = `${createForm.currency} ${p}${scheduleLabel}`;
                      }
                      return (
                        <div key={a.id} className="flex items-center gap-2 pl-2">
                          <Checkbox
                            id={`ao-${member.ref}-${a.id}`}
                            checked={memberAo.includes(a.id)}
                            onCheckedChange={(checked) => toggleMemberAddOn(member.ref, a.id, !!checked)}
                          />
                          <label htmlFor={`ao-${member.ref}-${a.id}`} className="text-sm cursor-pointer flex-1">
                            {a.name}
                            {displayPrice && (
                              <span className="text-muted-foreground ml-1">— {displayPrice}</span>
                            )}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}
          {createStep === 4 && (
            <>
              <div className="rounded-md bg-muted/50 p-3 space-y-1">
                <p className="text-sm font-medium">
                  Premium: {createForm.currency} {calculatedPremium?.total ?? "—"}
                </p>
                {calculatedPremium && calculatedPremium.additionalMemberCount > 0 && (
                  <p className="text-xs text-amber-700 font-medium">
                    Includes {calculatedPremium.additionalMemberCount} additional member{calculatedPremium.additionalMemberCount !== 1 ? "s" : ""} beyond the {calculatedPremium.totalIncluded} included (@ {createForm.currency} {calculatedPremium.additionalRateMonthly.toFixed(2)}/mo each)
                  </p>
                )}
                {calculatedPremium && calculatedPremium.totalMembers > calculatedPremium.totalIncluded && (
                  <p className="text-xs text-muted-foreground">
                    Base: {createForm.currency} {calculatedPremium.base.toFixed(2)} · Add-ons: {createForm.currency} {calculatedPremium.addOnTotal.toFixed(2)} · Additional: {createForm.currency} {calculatedPremium.dependantSurcharge.toFixed(2)}
                  </p>
                )}
                {canEditPremium ? (
                  <p className="text-xs text-muted-foreground">Auto-calculated above. Enter an override below only if needed.</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Premium is calculated from the selected product version, members, and add-ons.</p>
                )}
              </div>
              {canEditPremium && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="create-form-premium-amount">Override premium ({createForm.currency})</Label>
                    <Input id="create-form-premium-amount"
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder={calculatedPremium?.total ?? "Leave blank to use calculated"}
                      value={createForm.premiumAmount}
                      onChange={(e) => setCreateForm({ ...createForm, premiumAmount: e.target.value })}
                      data-testid="input-create-premium-override"
                    />
                    <p className="text-xs text-muted-foreground mt-0.5">Leave blank to use the auto-calculated amount.</p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>Currency</Label>
                  <CurrencySelect value={createForm.currency} onValueChange={(v) => setCreateForm({ ...createForm, currency: v })} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="create-form-payment-schedule">Payment Schedule</Label>
                  <Select value={createForm.paymentSchedule} onValueChange={(v) => setCreateForm({ ...createForm, paymentSchedule: v })}>
                    <SelectTrigger id="create-form-payment-schedule" data-testid="select-schedule">
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
                  <Label htmlFor="create-form-effective-date">Effective Date</Label>
                  <Input id="create-form-effective-date"
                    type="date"
                    value={createForm.effectiveDate}
                    onChange={(e) => setCreateForm({ ...createForm, effectiveDate: e.target.value })}
                    data-testid="input-effective-date"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="create-form-branch-id">Branch</Label>
                <Select value={createForm.branchId} onValueChange={(v) => setCreateForm({ ...createForm, branchId: v })}>
                  <SelectTrigger id="create-form-branch-id" data-testid="select-create-branch">
                    <SelectValue placeholder="Select branch" />
                  </SelectTrigger>
                  <SelectContent>
                    {branches.map((b: any) => (
                      <SelectItem key={b.id} value={b.id}>{b.name}{b.isHeadOffice ? " (Head Office)" : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-3 border rounded-md p-3">
                <p className="text-sm font-medium">Saved mobile wallet (automation)</p>
                <p className="text-xs text-muted-foreground">When automation runs for overdue balances, we use this number so the client can approve on their phone. Stored cards are not used for recurring collection.</p>
                <div>
                  <Label>Mobile Provider</Label>
                  <Select
                    value={createForm.paymentMethod.provider}
                    onValueChange={(v) => setCreateForm({
                      ...createForm,
                      paymentMethod: { ...createForm.paymentMethod, provider: v },
                    })}
                  >
                    <SelectTrigger data-testid="select-payment-mobile-provider"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ecocash">EcoCash</SelectItem>
                      <SelectItem value="onemoney">OneMoney</SelectItem>
                      <SelectItem value="innbucks">InnBucks</SelectItem>
                      <SelectItem value="omari">O'Mari</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="create-form-payment-method-mobile-number">Mobile Number</Label>
                  <Input id="create-form-payment-method-mobile-number"
                    value={createForm.paymentMethod.mobileNumber}
                    onChange={(e) => setCreateForm({
                      ...createForm,
                      paymentMethod: { ...createForm.paymentMethod, mobileNumber: e.target.value },
                    })}
                    placeholder="e.g. 0771234567"
                    data-testid="input-payment-mobile-number"
                  />
                </div>
              </div>
            </>
          )}
        </div>
        {createStep === 4 && createMutation.isError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 mb-1" data-testid="text-create-error">
            <p className="text-xs text-destructive font-medium">
              {(createMutation.error as Error)?.message || "Could not create the policy. Please review the details and try again."}
            </p>
          </div>
        )}
        {(() => {
          // Derive a human-readable reason the Continue/Save button is blocked, shown as a hint.
          const missing: string[] = [];
          if (createStep === 1) {
            if (clientMode === "search" && !createForm.clientId) missing.push("select a client");
            if (clientMode === "new") {
              if (!createForm.newClient.firstName?.trim()) missing.push("first name");
              if (!createForm.newClient.lastName?.trim()) missing.push("last name");
              // National ID/phone/DOB/gender aren't required to advance past this step — whether
              // they're needed at all depends on the product picked next (Step 2), so full
              // validation is deferred to Save (Step 4) where isLegacyIssuance is resolvable.
            }
          } else if (createStep === 2) {
            if (!createForm.selectedProductId) missing.push("a product");
            else if (!createForm.productVersionId) missing.push("a product version");
          } else if (createStep === 4) {
            if (!createForm.productVersionId) missing.push("a product version");
            if (!calculatedPremium?.total) missing.push("a calculated premium (check product & add-ons)");
            if (clientMode === "new" && !isLegacyIssuance) {
              if (!createForm.newClient.nationalId?.trim()) missing.push("national ID");
              if (!createForm.newClient.phone?.trim()) missing.push("phone");
              if (!createForm.newClient.dateOfBirth) missing.push("date of birth");
              if (!createForm.newClient.gender) missing.push("gender");
            }
            if (!createForm.beneficiaryId && !isLegacyIssuance) {
              if (!createForm.beneficiaryManual.firstName?.trim()) missing.push("beneficiary first name");
              if (!createForm.beneficiaryManual.lastName?.trim()) missing.push("beneficiary last name");
              if (!createForm.beneficiaryManual.relationship?.trim()) missing.push("beneficiary relationship");
              if (!createForm.beneficiaryManual.nationalId?.trim()) missing.push("beneficiary national ID");
              else if (!isValidNationalId(createForm.beneficiaryManual.nationalId)) missing.push("a valid beneficiary national ID (e.g. 08833089H38)");
              if (!createForm.beneficiaryManual.phone?.trim()) missing.push("beneficiary phone");
            }
          }
          if (missing.length === 0) return null;
          return (
            <p className="text-xs text-amber-600 mb-1" data-testid="text-step-hint">
              To continue, provide: {missing.join(", ")}.
            </p>
          );
        })()}
        <DialogFooter>
          {createStep > 1 ? (
            <Button variant="outline" onClick={() => setCreateStep((s) => s - 1)}>Back</Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          )}
          {createStep < 4 ? (
            <Button
              onClick={() => setCreateStep((s) => s + 1)}
              disabled={
                (createStep === 1 && (
                  (clientMode === "search" && !createForm.clientId) ||
                  (clientMode === "new" && (
                    !createForm.newClient.firstName?.trim() ||
                    !createForm.newClient.lastName?.trim()
                    // National ID/phone/DOB/gender and beneficiary details are NOT required to
                    // advance past this step: whether they're required at all depends on the
                    // product chosen in Step 2 (Legacy Individual/Group relax them), which
                    // hasn't been picked yet here. Final validation happens on Save (Step 4),
                    // once isLegacyIssuance can actually be resolved correctly.
                  ))
                )) ||
                (createStep === 2 && (!createForm.selectedProductId || !createForm.productVersionId))
              }
            >
              Continue
            </Button>
          ) : (
            <Button
              onClick={() => createMutation.mutate({
                ...createForm,
                premiumAmount: (canEditPremium && createForm.premiumAmount) ? createForm.premiumAmount : (calculatedPremium?.total ?? ""),
              })}
              disabled={
                createMutation.isPending ||
                (clientMode === "search" && !createForm.clientId) ||
                (clientMode === "new" && (
                  !createForm.newClient.firstName?.trim() ||
                  !createForm.newClient.lastName?.trim() ||
                  (!isLegacyIssuance && (
                    !createForm.newClient.nationalId?.trim() ||
                    !createForm.newClient.phone?.trim() ||
                    !createForm.newClient.dateOfBirth ||
                    !createForm.newClient.gender
                  ))
                )) ||
                !createForm.productVersionId ||
                !calculatedPremium?.total
              }
              data-testid="btn-submit-policy"
            >
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save policy
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
