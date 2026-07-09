import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ClientSearchInput } from "@/components/client-search-input";
import { CurrencySelect } from "@/components/currency-select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiFetch, getApiBase } from "@/lib/queryClient";
import { useState, useMemo, useEffect, useRef } from "react";
import { Plus, Search, Filter, MoreHorizontal, FileText, ArrowRightLeft, Users, User, CreditCard, Loader2, ChevronLeft, Eye, Download, UserPlus, X, CalendarDays, ShieldCheck, Clock, Receipt, Printer, Share2, CheckCircle2, Pencil, Trash2, Phone, Mail, IdCard, MapPin, ScrollText, FileDown, ChevronDown } from "lucide-react";
import { printDocument } from "@/lib/print-document";
import { shareDocument } from "@/lib/share-document";
import { isAgentScoped } from "@shared/roles";
import { useSearch, useLocation } from "wouter";
import { useFlag } from "@/lib/flags";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { PageHeader, PageShell, CardSection, FilterBar, EmptyState, StatusBadge, EnhancedDataTable, type EdtColumn } from "@/components/ds";

function readEstatementDateRange() {
  const from = (document.getElementById("estatement-dateFrom") as HTMLInputElement | null)?.value;
  const to = (document.getElementById("estatement-dateTo") as HTMLInputElement | null)?.value;
  return { from, to };
}

const VALID_POLICY_TRANSITIONS: Record<string, string[]> = {
  inactive: ["cancelled"],
  active: ["grace", "cancelled"],
  grace: ["lapsed"],
  lapsed: ["cancelled"],
};

const STATUS_LABELS: Record<string, string> = {
  inactive: "Inactive",
  active: "Active",
  grace: "Grace",
  lapsed: "Lapsed",
  cancelled: "Cancelled",
};

function getStatusColor(status: string) {
  switch (status) {
    case "active": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    case "grace": return "bg-amber-500/15 text-amber-700 border-amber-200";
    case "lapsed": return "bg-destructive/15 text-destructive border-destructive/30";
    case "inactive": return "bg-blue-500/15 text-blue-700 border-blue-200";
    case "cancelled": return "bg-gray-500/15 text-gray-600 border-gray-200";
    default: return "bg-muted text-muted-foreground";
  }
}

function isPaynowPaidLike(s: string) {
  const l = s.toLowerCase();
  return l === "paid" || l === "sent" || l === "awaiting delivery" || l === "delivered";
}

const NATIONAL_ID_REGEX = /^\d+[A-Z]\d{2}$/;
function toUpper(value: string) { return value.trim().toUpperCase(); }
function isValidNationalId(value: string | null | undefined): boolean {
  if (!value || !value.trim()) return false;
  const n = value.trim().toUpperCase();
  return NATIONAL_ID_REGEX.test(n);
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

export default function StaffPolicies() {
  const [, setLocation] = useLocation();
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
  const policyWizardFlag = useFlag("policyWizard");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [countryFilter, setCountryFilter] = useState<string>("all");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showTransitionDialog, setShowTransitionDialog] = useState(false);
  const [docLang, setDocLang] = useState("en");

  const { data: languages } = useQuery<{ code: string; name: string }[]>({ queryKey: ["/api/languages"] });
  const [showDetailView, setShowDetailView] = useState(false);
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [transitionTarget, setTransitionTarget] = useState("");
  const [transitionReason, setTransitionReason] = useState("");
  const [showInPolicyReceiptDialog, setShowInPolicyReceiptDialog] = useState(false);
  const [inPolicyReceiptMethod, setInPolicyReceiptMethod] = useState("cash");
  const [inPolicyReceiptCurrency, setInPolicyReceiptCurrency] = useState("USD");
  const [inPolicyReceiptRef, setInPolicyReceiptRef] = useState("");
  const [inPolicyReceiptNotes, setInPolicyReceiptNotes] = useState("");
  const [inPolicyReceiptMonths, setInPolicyReceiptMonths] = useState(1);
  const [inPolicyReceiptAmountOverride, setInPolicyReceiptAmountOverride] = useState<string | null>(null);
  const [inPolicyReceiptSubmitterNote, setInPolicyReceiptSubmitterNote] = useState("");
  const [pnIntentId, setPnIntentId] = useState<string | null>(null);
  const [pnPolling, setPnPolling] = useState(false);
  const [pnPollStartTime, setPnPollStartTime] = useState<number>(0);
  const [pnPollError, setPnPollError] = useState<string | null>(null);
  const [pnInnbucksCode, setPnInnbucksCode] = useState("");
  const [pnInnbucksExpiry, setPnInnbucksExpiry] = useState("");
  const [pnNeedsOtp, setPnNeedsOtp] = useState(false);
  const [pnOtpRef, setPnOtpRef] = useState("");
  const [pnOtp, setPnOtp] = useState("");
  const [pnPhase, setPnPhase] = useState<"select" | "waiting">("select");
  const [showEstatementViewer, setShowEstatementViewer] = useState(false);
  const [estatementViewerUrl, setEstatementViewerUrl] = useState<string>("");
  const [showPolicyDocViewer, setShowPolicyDocViewer] = useState(false);
  const [policyDocViewerUrl, setPolicyDocViewerUrl] = useState<string>("");
  const [showReceiptSuccess, setShowReceiptSuccess] = useState(false);
  const [receiptSuccessData, setReceiptSuccessData] = useState<any>(null);
  const [receiptViewFormat, setReceiptViewFormat] = useState<"a4" | "thermal48" | "thermal58" | "thermal80">("a4");

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showPaymentMethodDialog, setShowPaymentMethodDialog] = useState(false);
  const [paymentMethodForm, setPaymentMethodForm] = useState({
    provider: "ecocash",
    mobileNumber: "",
  });
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [upgradeForm, setUpgradeForm] = useState({
    selectedProductId: "",
    productVersionId: "",
  });
  // Effective date + live arrears/credit preview for premium-affecting changes (upgrade / manual premium).
  const todayISO = new Date().toISOString().split("T")[0];
  const [changeEffectiveDate, setChangeEffectiveDate] = useState(todayISO);
  const [changePreview, setChangePreview] = useState<{ oldPremium: string; newPremium: string; currency: string; periods: number; reconciliation: string; direction: string } | null>(null);
  const [editForm, setEditForm] = useState({
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

  const [editMemberOpen, setEditMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    firstName: "", lastName: "", relationship: "", gender: "", nationalId: "", dateOfBirth: "", phone: "", email: "",
  });

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
  });
  const [createStep, setCreateStep] = useState(1);
  const [clientMode, setClientMode] = useState<"search" | "new">("search");

  const searchString = useSearch();
  const openPolicyConsumed = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("create") === "1") {
      const clientId = params.get("clientId") || "";
      const groupId = params.get("groupId") || "";
      setShowCreateDialog(true);
      setCreateForm((f) => ({ ...f, clientId, groupId }));
      if (clientId) setClientMode("search");
    }
  }, [searchString]);

  useEffect(() => {
    if (isAgent && user?.id) {
      setCreateForm((f) => ({ ...f, agentId: user.id }));
    }
  }, [isAgent, user?.id]);

  // limit=500 (the server's hard ceiling — see GET /api/policies) since this page has no
  // pagination UI of its own and expects the full list in one fetch. Without an explicit limit
  // the server silently defaults to 100, which for an org with >100 policies (like Falakhe)
  // meant the tail of the list just never loaded.
  const policiesQueryUrl = debouncedSearch
    ? `/api/policies?limit=500&q=${encodeURIComponent(debouncedSearch)}`
    : "/api/policies?limit=500";

  const { data: policies, isLoading: policiesLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", { q: debouncedSearch }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + policiesQueryUrl, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch policies");
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    const pid = params.get("openPolicy");
    if (!pid) return;
    if (openPolicyConsumed.current === pid) return;
    if (policiesLoading) return;

    const pol = (policies as any[] | undefined)?.find((p: any) => p.id === pid);
    if (pol) {
      openPolicyConsumed.current = pid;
      setSelectedPolicy(pol);
      setShowDetailView(true);
      setLocation("/staff/policies", { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getApiBase() + `/api/policies/${pid}`, { credentials: "include" });
        if (cancelled) return;
        if (!res.ok) {
          openPolicyConsumed.current = pid;
          return;
        }
        const one = await res.json();
        if (!one?.id || cancelled) return;
        openPolicyConsumed.current = pid;
        setSelectedPolicy(one);
        setShowDetailView(true);
        setLocation("/staff/policies", { replace: true });
      } catch {
        if (!cancelled) openPolicyConsumed.current = pid;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [searchString, policies, policiesLoading, setLocation]);

  // limit=500 for the same reason as policiesQueryUrl above — clients feed getClientName()'s
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
  const { data: rawGroups } = useQuery<any[]>({
    queryKey: ["/api/groups"],
  });
  const groups = rawGroups ?? [];
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

  const { data: rawProducts } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });
  const products = rawProducts ?? [];
  // Legacy Individual/Legacy Group products are for quickly capturing historical clients —
  // same relaxation as a legacy group, since full details are frequently unknown up front.
  const selectedProductForCreate = products.find((p: any) => p.id === createForm.selectedProductId);
  const isLegacyProductIssuance = selectedProductForCreate?.code === "LEGIND" || selectedProductForCreate?.code === "LEGGRP";
  const isLegacyIssuance = isLegacyGroupIssuance || isLegacyProductIssuance;

  const { data: rawAddOns } = useQuery<any[]>({
    queryKey: ["/api/add-ons"],
  });
  const addOns = rawAddOns ?? [];

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

  const [detailAddDepOpen, setDetailAddDepOpen] = useState(false);
  const [detailDepForm, setDetailDepForm] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
  const [membersAgeFilter, setMembersAgeFilter] = useState<"all" | "adult" | "child">("all");
  const detailAddDepMutation = useMutation({
    mutationFn: async (data: typeof detailDepForm) => {
      if (!selectedPolicy) throw new Error("No policy selected");
      const res = await apiRequest("POST", `/api/clients/${selectedPolicy.clientId}/dependents`, { ...data, policyId: selectedPolicy.id });
      const dep = await res.json();
      await apiRequest("POST", `/api/policies/${selectedPolicy.id}/members`, { dependentId: dep.id, role: "dependent" });
      return dep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      setDetailAddDepOpen(false);
      toast({ title: "Dependent added to policy" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });
  const syncMembersMutation = useMutation({
    mutationFn: async () => {
      if (!selectedPolicy) throw new Error("No policy selected");
      const res = await apiRequest("POST", `/api/policies/${selectedPolicy.id}/sync-members`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      toast({ title: data.synced > 0 ? `${data.synced} dependent(s) synced to policy` : "All dependents already on policy" });
    },
    onError: (err: Error) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });
  const addDepMutation = useMutation({
    mutationFn: async (data: typeof newDep) => {
      const res = await apiRequest("POST", `/api/clients/${createForm.clientId}/dependents`, {
        ...data,
        legacyGroupId: isLegacyGroupIssuance ? (createForm as any).groupId : undefined,
        legacyProductVersionId: isLegacyProductIssuance ? createForm.productVersionId : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", createForm.clientId, "dependents"] });
      setShowAddDep(false);
      setNewDep({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
      toast({ title: "Dependent added" });
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

  const { data: upgradeProductVersions } = useQuery<any[]>({
    queryKey: ["/api/products", upgradeForm.selectedProductId, "versions", "upgrade"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/products/${upgradeForm.selectedProductId}/versions`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!upgradeForm.selectedProductId && showUpgradeDialog,
  });

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

  const calculatedPremium = useMemo(() => {
    if (!selectedVersion) return null;
    const { currency, paymentSchedule, memberAddOns } = createForm;
    let base = 0;
    if (paymentSchedule === "monthly") {
      base = currency === "ZAR" ? parseFloat(selectedVersion.premiumMonthlyZar || "0") : parseFloat(selectedVersion.premiumMonthlyUsd || "0");
    } else if (paymentSchedule === "weekly") {
      base = currency === "ZAR" ? parseFloat((selectedVersion as any).premiumWeeklyZar || "0") : parseFloat(selectedVersion.premiumWeeklyUsd || "0");
    } else if (paymentSchedule === "biweekly") {
      base = currency === "ZAR" ? parseFloat((selectedVersion as any).premiumBiweeklyZar || "0") : parseFloat(selectedVersion.premiumBiweeklyUsd || "0");
    }
    if (base === 0) return null;

    const getAoPrice = (ao: any) => {
      if (ao.pricingMode === "percentage") return parseFloat(ao.priceAmount || ao.priceMonthly || "0");
      if (paymentSchedule === "weekly" && ao.priceWeekly) return parseFloat(ao.priceWeekly);
      if (paymentSchedule === "biweekly" && ao.priceBiweekly) return parseFloat(ao.priceBiweekly);
      return parseFloat(ao.priceMonthly || ao.priceAmount || "0");
    };

    let addOnTotal = 0;
    const allMemberAddOns = Object.values(memberAddOns).flat();
    if (addOns && allMemberAddOns.length > 0) {
      for (const aoId of allMemberAddOns) {
        const ao = addOns.find((a: any) => a.id === aoId);
        if (!ao) continue;
        const price = getAoPrice(ao);
        if (ao.pricingMode === "percentage") {
          addOnTotal += base * (price / 100);
        } else {
          addOnTotal += price;
        }
      }
    }
    const scheduleFactor = paymentSchedule === "weekly"
      ? (12 / 52)
      : paymentSchedule === "biweekly"
      ? (12 / 26)
      : paymentSchedule === "quarterly"
      ? 3
      : paymentSchedule === "annually"
      ? 12
      : 1;
    const childThresholdAge = Number(selectedVersion.dependentMaxAge ?? 20);
    const maxAdults = Number(selectedProduct?.maxAdults ?? 2);
    const maxChildren = Number(selectedProduct?.maxChildren ?? 4);
    const maxExtended = Number((selectedProduct as any)?.maxExtendedMembers ?? 0);

    let adults = 1; // Policy holder always counts as one adult.
    let children = 0;
    const selectedDependentSet = new Set(createForm.beneficiaryDependentIds);
    for (const dep of dependents || []) {
      if (!selectedDependentSet.has(dep.id)) continue;
      const dob = dep.dateOfBirth ? new Date(dep.dateOfBirth) : null;
      if (!dob || Number.isNaN(dob.getTime())) {
        adults += 1;
        continue;
      }
      const today = new Date();
      let age = today.getFullYear() - dob.getFullYear();
      const m = today.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
      if (age >= childThresholdAge) adults += 1;
      else children += 1;
    }

    // Use the dedicated additional-member rate if set; otherwise fall back to
    // underwriter rates (mirrors the backend computePolicyPremium logic exactly).
    const additionalRateMonthly = parseFloat(String(
      createForm.currency === "ZAR"
        ? (selectedVersion as any).additionalMemberPremiumMonthlyZar || "0"
        : (selectedVersion as any).additionalMemberPremiumMonthlyUsd || "0"
    ));

    let dependantSurcharge = 0;
    let additionalMemberCount = 0;
    const totalIncluded = maxAdults + maxChildren + maxExtended;
    if (additionalRateMonthly > 0) {
      additionalMemberCount = Math.max(0, (adults + children) - totalIncluded);
      dependantSurcharge = additionalMemberCount * additionalRateMonthly * scheduleFactor;
    } else {
      const adultRateMonthly = parseFloat(String(selectedVersion.underwriterAmountAdult || "0"));
      const childRateMonthly = parseFloat(String(selectedVersion.underwriterAmountChild || selectedVersion.underwriterAmountAdult || "0"));
      const extraAdults = Math.max(0, adults - maxAdults);
      const extraChildren = Math.max(0, children - maxChildren);
      dependantSurcharge = ((extraAdults * adultRateMonthly) + (extraChildren * childRateMonthly)) * scheduleFactor;
    }

    const total = (base + addOnTotal + dependantSurcharge).toFixed(2);
    return { total, base, addOnTotal, dependantSurcharge, additionalMemberCount, totalIncluded, additionalRateMonthly, totalMembers: adults + children };
  }, [selectedVersion, selectedProduct, createForm.currency, createForm.paymentSchedule, createForm.memberAddOns, createForm.beneficiaryDependentIds, dependents, addOns]);

  const { data: policyDetail } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicy?.id, "detail"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to load policy detail");
      return res.json();
    },
  });
  const displayPolicy = policyDetail || selectedPolicy;

  const { data: policyMembers, isLoading: membersLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "members"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/members`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: policyMemberAddOns = [], refetch: refetchMemberAddOns } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "add-ons"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/add-ons`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [editAddOnsOpen, setEditAddOnsOpen] = useState(false);
  const [editAddOnsMemberId, setEditAddOnsMemberId] = useState<string | null>(null);
  const [editAddOnsSelected, setEditAddOnsSelected] = useState<string[]>([]);

  const setMemberAddOnsMutation = useMutation({
    mutationFn: async ({ memberId, addOnIds }: { memberId: string; addOnIds: string[] }) => {
      const res = await apiRequest("PUT", `/api/policies/${selectedPolicy!.id}/members/${memberId}/add-ons`, { addOnIds });
      if (!res.ok) throw new Error("Failed to save add-ons");
    },
    onSuccess: () => {
      refetchMemberAddOns();
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditAddOnsOpen(false);
      toast({ title: "Add-ons saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: policyPayments, isLoading: paymentsLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "payments"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/payments`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: policyReceipts } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "receipts"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/receipts`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });
  const { data: clientPaymentMethods } = useQuery<any[]>({
    queryKey: ["/api/clients", displayPolicy?.clientId, "payment-methods"],
    enabled: !!displayPolicy?.clientId && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${displayPolicy.clientId}/payment-methods`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: policyHolderClient, isLoading: policyHolderLoading } = useQuery<any>({
    queryKey: ["/api/clients", displayPolicy?.clientId, "policy-detail-holder"],
    enabled: !!displayPolicy?.clientId && showDetailView,
    queryFn: async () => {
      const cid = displayPolicy!.clientId as string;
      const res = await fetch(getApiBase() + `/api/clients/${cid}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) return null;
      return res.json();
    },
  });

  const { data: policyDocs = [], refetch: refetchPolicyDocs } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "documents"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/documents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: policyWaiver, refetch: refetchWaiver } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicy?.id, "waiver-request"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/waiver-request`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const [docUploadType, setDocUploadType] = useState("other");
  const [docUploadLabel, setDocUploadLabel] = useState("");
  const [docUploading, setDocUploading] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement>(null);

  const [waiverReason, setWaiverReason] = useState("");
  const [waiverNotes, setWaiverNotes] = useState("");
  const [showWaiverDialog, setShowWaiverDialog] = useState(false);
  const [waiverSubmitting, setWaiverSubmitting] = useState(false);

  const canManageApprovals = safePermissions.includes("manage:approvals");

  async function uploadPolicyDoc(file: File) {
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("documentType", docUploadType);
      fd.append("label", docUploadLabel || file.name);
      const res = await apiFetch(`/api/policies/${selectedPolicy!.id}/documents`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Upload failed");
      }
      refetchPolicyDocs();
      setDocUploadLabel("");
      toast({ title: "Document uploaded" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setDocUploading(false);
      if (docFileInputRef.current) docFileInputRef.current.value = "";
    }
  }

  async function deletePolicyDoc(docId: string) {
    const res = await apiFetch(`/api/policies/${selectedPolicy!.id}/documents/${docId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
      return;
    }
    refetchPolicyDocs();
    toast({ title: "Document deleted" });
  }

  async function submitWaiverRequest() {
    setWaiverSubmitting(true);
    try {
      const res = await apiRequest("POST", `/api/policies/${selectedPolicy!.id}/waiver-request`, {
        reason: waiverReason,
        supportingNotes: waiverNotes,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Failed to submit waiver request");
      }
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
      setShowCreateDialog(false);
      setCreateStep(1);
      setClientMode("search");
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

  const editPolicyMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/policies/${id}`, data);
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setShowEditDialog(false);
      if (showDetailView) setSelectedPolicy(updated);
      toast({ title: "Policy updated", description: "Policy details have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });
  const editMemberMutation = useMutation({
    mutationFn: async ({ policyId, memberId, data }: { policyId: string; memberId: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}/members/${memberId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditMemberOpen(false);
      toast({ title: "Member updated", description: "Member details have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const openEditMember = (m: any) => {
    setEditingMember(m);
    const nameParts = (m.memberName || "").trim().split(" ");
    setEditMemberForm({
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      relationship: m.relationship || "",
      gender: m.gender || "",
      nationalId: m.nationalId || "",
      dateOfBirth: m.dateOfBirth || "",
      phone: m.phone || "",
      email: m.email || "",
    });
    setEditMemberOpen(true);
  };

  const handleEditMemberSubmit = () => {
    if (!selectedPolicy || !editingMember) return;
    const data: Record<string, any> = {};
    const orig = {
      firstName: (editingMember.memberName || "").trim().split(" ")[0] || "",
      lastName: (editingMember.memberName || "").trim().split(" ").slice(1).join(" ") || "",
      relationship: editingMember.relationship || "",
      gender: editingMember.gender || "",
      nationalId: editingMember.nationalId || "",
      dateOfBirth: editingMember.dateOfBirth || "",
      phone: editingMember.phone || "",
      email: editingMember.email || "",
    };
    for (const key of Object.keys(editMemberForm) as (keyof typeof editMemberForm)[]) {
      if (editMemberForm[key] !== orig[key]) data[key] = editMemberForm[key] || null;
    }
    if (Object.keys(data).length === 0) { setEditMemberOpen(false); return; }
    editMemberMutation.mutate({ policyId: selectedPolicy.id, memberId: editingMember.id, data });
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
      if (showDetailView) setSelectedPolicy(updated);
      toast({ title: "Policy product changed", description: `Premium recalculated.${reconNote}` });
    },
    onError: (err: Error) => {
      toast({ title: "Change failed", description: err.message, variant: "destructive" });
    },
  });

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

  // Policy holder contact/address details live on the client record, not the policy — there was
  // previously no way to correct them without leaving the policy page for the Clients page.
  const [showEditClientDialog, setShowEditClientDialog] = useState(false);
  const [editClientForm, setEditClientForm] = useState({ phone: "", email: "", physicalAddress: "", postalAddress: "" });
  const openEditClientDialog = () => {
    if (!policyHolderClient) return;
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
      const res = await apiRequest("PATCH", `/api/clients/${policyHolderClient.id}`, editClientForm);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Could not update client details.");
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", displayPolicy?.clientId, "policy-detail-holder"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowEditClientDialog(false);
      toast({ title: "Client details updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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

  const [confirmDeletePolicy, setConfirmDeletePolicy] = useState(false);
  const [editPaymentId, setEditPaymentId] = useState<string | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState({ amount: "", status: "", reference: "", notes: "" });
  const [confirmDeletePayment, setConfirmDeletePayment] = useState<string | null>(null);
  const [editReceiptId, setEditReceiptId] = useState<string | null>(null);
  const [editReceiptForm, setEditReceiptForm] = useState({ amount: "", status: "", paymentChannel: "" });
  const [confirmDeleteReceipt, setConfirmDeleteReceipt] = useState<string | null>(null);

  const deletePolicyMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/policies/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setShowDetailView(false);
      setSelectedPolicy(null);
      setConfirmDeletePolicy(false);
      toast({ title: "Policy deleted", description: "Policy and all related records have been permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const editPaymentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/payments/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditPaymentId(null);
      toast({ title: "Payment updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/payments/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setConfirmDeletePayment(null);
      toast({ title: "Payment deleted", description: "Payment transaction permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const editReceiptMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/receipts/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setEditReceiptId(null);
      toast({ title: "Receipt updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const deleteReceiptMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/receipts/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "receipts"] });
      setConfirmDeleteReceipt(null);
      toast({ title: "Receipt deleted", description: "Receipt permanently removed." });
    },
    onError: (err: Error) => {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    },
  });

  const resetPnState = () => {
    setPnIntentId(null); setPnPolling(false); setPnPollStartTime(0); setPnPollError(null);
    setPnInnbucksCode(""); setPnInnbucksExpiry("");
    setPnNeedsOtp(false); setPnOtpRef(""); setPnOtp(""); setPnPhase("select");
    setInPolicyReceiptMethod("cash"); setInPolicyReceiptRef(""); setInPolicyReceiptNotes(""); setInPolicyReceiptMonths(1);
    setInPolicyReceiptAmountOverride(null); setInPolicyReceiptSubmitterNote("");
  };

  const inPolicyReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      if (selectedPolicy) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "payments"] });
        queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
      }
      setShowInPolicyReceiptDialog(false);
      resetPnState();
      if (data?.pendingApproval) {
        toast({ title: "Submitted for approval", description: `Receipt ${data.receipt?.receiptNumber ?? ""} won't apply to the policy until a manager approves the amount.` });
      } else if (data?.receipt?.id) {
        setReceiptSuccessData({ ...data, receipt: data.receipt, policyNumber: displayPolicy?.policyNumber });
        setShowReceiptSuccess(true);
      } else {
        toast({ title: "Payment recorded", description: "Receipt generated successfully." });
      }
    },
    onError: (err: Error) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  const pnInitiateMutation = useMutation({
    mutationFn: async () => {
      const dp = displayPolicy;
      if (!dp) throw new Error("No policy");
      const amt = dp.premiumAmount ? (parseFloat(dp.premiumAmount) * inPolicyReceiptMonths).toFixed(2) : "0";
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: selectedPolicy.id, clientId: dp.clientId, amount: amt, currency: inPolicyReceiptCurrency, purpose: "premium",
      });
      const intent = await intentRes.json();
      if (intent.message) throw new Error(intent.message);
      const initRes = await apiRequest("POST", `/api/payment-intents/${intent.id}/initiate`, {
        method: inPolicyReceiptMethod,
        payerPhone: ["ecocash", "onemoney", "innbucks", "omari"].includes(inPolicyReceiptMethod) ? inPolicyReceiptRef : undefined,
        payerEmail: inPolicyReceiptMethod === "visa_mastercard" ? inPolicyReceiptRef : undefined,
      });
      return { intentId: intent.id as string, initData: await initRes.json() as {
        redirectUrl?: string; pollUrl?: string; message?: string;
        innbucksCode?: string; innbucksExpiry?: string;
        omariOtpReference?: string; needsOtp?: boolean;
      } };
    },
    onSuccess: (data) => {
      setPnIntentId(data.intentId);
      const initData = data.initData;
      if (initData.message) { toast({ title: "Error", description: initData.message, variant: "destructive" }); return; }
      setPnPhase("waiting");
      setPnPollStartTime(Date.now());
      setPnPollError(null);
      if (inPolicyReceiptMethod === "innbucks" && initData.innbucksCode) {
        setPnInnbucksCode(initData.innbucksCode); setPnInnbucksExpiry(initData.innbucksExpiry || ""); setPnPolling(true);
        toast({ title: "InnBucks code ready" }); return;
      }
      if (inPolicyReceiptMethod === "omari" && initData.needsOtp) {
        setPnNeedsOtp(true); setPnOtpRef(initData.omariOtpReference || "");
        toast({ title: "OTP sent", description: "Ask the client for the OTP." }); return;
      }
      if (initData.redirectUrl) { window.open(initData.redirectUrl, "_blank"); setPnPolling(true); toast({ title: "Card payment page opened" }); return; }
      setPnPolling(true);
      toast({ title: "USSD sent", description: "Client should receive a prompt on their phone." });
    },
    onError: (e: Error) => toast({ title: "Payment failed", description: e.message, variant: "destructive" }),
  });

  const pnOtpMutation = useMutation({
    mutationFn: async () => {
      if (!pnIntentId) throw new Error("No intent");
      const res = await apiRequest("POST", `/api/payment-intents/${pnIntentId}/otp`, { otp: pnOtp });
      return res.json() as Promise<{ paid?: boolean; message?: string }>;
    },
    onSuccess: (data) => {
      if (data.message) { toast({ title: "OTP error", description: data.message, variant: "destructive" }); return; }
      if (data.paid) {
        queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
        queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
        if (selectedPolicy) queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
        setShowInPolicyReceiptDialog(false); resetPnState();
        setReceiptSuccessData({ paynow: true, policyId: selectedPolicy?.id, policyNumber: displayPolicy?.policyNumber });
        setShowReceiptSuccess(true);
      } else { setPnPolling(true); setPnNeedsOtp(false); toast({ title: "OTP accepted", description: "Processing..." }); }
    },
    onError: (e: Error) => toast({ title: "OTP failed", description: e.message, variant: "destructive" }),
  });

  const { data: pnPollData } = useQuery({
    queryKey: ["pn-poll-policy", pnIntentId],
    queryFn: async () => {
      if (!pnIntentId) return null;
      const res = await apiRequest("POST", `/api/payment-intents/${pnIntentId}/poll`, {});
      return res.json() as Promise<{ status: string; paid?: boolean; error?: string; paynowStatus?: string }>;
    },
    enabled: !!pnIntentId && pnPolling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!pnPollData) return;
    if (pnPollData.paid || pnPollData.status === "paid") {
      setPnPolling(false);
      setPnPollError(null);
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      if (selectedPolicy) queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy.id, "receipts"] });
      setShowInPolicyReceiptDialog(false); resetPnState();
      setReceiptSuccessData({ paynow: true, policyId: selectedPolicy?.id, policyNumber: displayPolicy?.policyNumber });
      setShowReceiptSuccess(true);
      return;
    }
    if (pnPollData.status === "failed") {
      setPnPolling(false);
      toast({ title: "Payment failed", description: "The payment was declined or cancelled.", variant: "destructive" });
      return;
    }
    if (pnPollData.error) {
      setPnPollError(pnPollData.error);
    }
    const PN_POLL_TIMEOUT_MS = 5 * 60 * 1000;
    if (pnPollStartTime && Date.now() - pnPollStartTime > PN_POLL_TIMEOUT_MS) {
      setPnPolling(false);
      toast({
        title: "Payment confirmation timed out",
        description: "If the money was deducted, the payment will be recorded automatically once the gateway confirms. Check back shortly.",
        variant: "destructive",
      });
    }
  }, [pnPollData]);

  const filteredPolicies = useMemo(() => {
    const list = Array.isArray(policies) ? policies : [];
    return list.filter((p: any) => {
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      const matchesCountry = countryFilter === "all"
        || (countryFilter === "south_africa" && p.isSouthAfrica)
        || (countryFilter === "zimbabwe" && !p.isSouthAfrica);
      return matchesStatus && matchesCountry;
    });
  }, [policies, statusFilter, countryFilter]);

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients?.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const principalPhone = useMemo(() => {
    const cid = displayPolicy?.clientId;
    if (!cid) return "";
    const fromDetail = String(policyHolderClient?.phone || "").trim();
    const fromList = String(clientMap[cid]?.phone || "").trim();
    return fromDetail || fromList;
  }, [displayPolicy?.clientId, policyHolderClient, clientMap]);

  const getClientName = (clientId: string) => {
    const c = clientMap[clientId];
    return c ? `${c.firstName} ${c.lastName}` : "Unknown client";
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

  const openUpgradeDialog = (policy: any) => {
    setSelectedPolicy(policy);
    setUpgradeForm({ selectedProductId: "", productVersionId: "" });
    setShowUpgradeDialog(true);
  };

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

  if (showDetailView && selectedPolicy) {
    const allowedTransitions = VALID_POLICY_TRANSITIONS[displayPolicy.status] || [];
    return (
      <StaffLayout>
        <PageShell>
          <section
            className="rounded-2xl border border-border/60 bg-card/90 shadow-[var(--shadow-card,0_1px_2px_rgb(0_0_0/0.05))] px-4 py-5 sm:px-6 sm:py-6 space-y-5"
            aria-label="Policy summary"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between min-w-0">
              <div className="flex items-start gap-3 min-w-0">
                <Button variant="ghost" size="icon" aria-label="Back to policies list" className="shrink-0 mt-0.5" onClick={() => { setShowDetailView(false); setSelectedPolicy(null); }} data-testid="btn-back-policies">
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Policy</p>
                  <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight break-words tabular-nums" data-testid="text-policy-number">{displayPolicy.policyNumber}</h1>
                  <p className="text-muted-foreground mt-1 text-sm leading-relaxed max-w-2xl">Holder, cover, lifecycle, and ledger — structured for quick scanning.</p>
                  {displayPolicy.isSouthAfrica && displayPolicy.externalReference && (
                    <p className="text-xs text-muted-foreground mt-0.5" data-testid="text-external-reference">RSA reference: <span className="font-medium text-foreground">{displayPolicy.externalReference}</span></p>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0" data-testid="badge-policy-status">
                <StatusBadge status={displayPolicy.status} />
                {displayPolicy.isSouthAfrica && (
                  <Badge variant="outline" className="font-medium bg-blue-500/10 text-blue-700 border-blue-200" data-testid="badge-detail-south-africa">South Africa</Badge>
                )}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                {(canWriteFinance || isAgent) && (
                  <Button
                    className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                    onClick={() => {
                      setInPolicyReceiptMethod(isAgent ? "ecocash" : "cash");
                      setInPolicyReceiptCurrency(displayPolicy.currency || "USD");
                      setInPolicyReceiptRef(principalPhone);
                      setInPolicyReceiptNotes("");
                      setShowInPolicyReceiptDialog(true);
                    }}
                    data-testid="btn-receipt-policy"
                  >
                    <Receipt className="h-4 w-4" /> Receipt payment
                  </Button>
                )}
                <Button variant="outline" className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => openEditDialog(displayPolicy)} data-testid="btn-edit-policy">
                  <Pencil className="h-4 w-4" /> Edit
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                  onClick={() => {
                    setPolicyDocViewerUrl(staffPolicyDocumentUrl(selectedPolicy.id, docLang));
                    setShowPolicyDocViewer(true);
                  }}
                  data-testid="btn-view-policy-doc"
                >
                  <FileText className="h-4 w-4" /> Policy document
                </Button>
                <Button
                  variant="outline"
                  className="gap-2 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                  onClick={() => {
                    setEstatementViewerUrl(staffEstatementUrl(selectedPolicy.id));
                    setShowEstatementViewer(true);
                  }}
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
                        <DropdownMenuItem key={t} onClick={() => { setTransitionTarget(t); setTransitionReason(""); setShowTransitionDialog(true); }} data-testid={`menu-transition-${t}`}>
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
                  <Button variant="destructive" size="sm" className="gap-2" onClick={() => setConfirmDeletePolicy(true)} data-testid="btn-delete-policy">
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
            </TabsList>

            <TabsContent value="overview" className="space-y-4 mt-4">
          <CardSection
            title="Policy holder (principal)"
            description="Contact and identity for the main insured person linked to this policy."
            icon={User}
            headerRight={
              policyHolderClient ? (
                <Button size="sm" variant="outline" onClick={openEditClientDialog} data-testid="btn-edit-policy-holder">
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Edit contact details
                </Button>
              ) : undefined
            }
          >
              {!displayPolicy.clientId ? (
                <p className="text-sm text-muted-foreground">No client is linked to this policy.</p>
              ) : policyHolderLoading ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-16 w-full" />
                </div>
              ) : policyHolderClient ? (
                <>
                  <div className="mb-5">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Full name</p>
                    <p className="text-xl font-semibold tracking-tight break-words" data-testid="text-policy-client">
                      {[policyHolderClient.title, policyHolderClient.firstName, policyHolderClient.lastName].filter(Boolean).join(" ")}
                    </p>
                  </div>
                  <Separator className="mb-5" />
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                        <Phone className="h-3.5 w-3.5 shrink-0" />
                        Phone
                      </p>
                      {policyHolderClient.phone ? (
                        <a
                          className="font-medium text-primary hover:underline break-all"
                          href={`tel:${String(policyHolderClient.phone).replace(/\s+/g, "")}`}
                          data-testid="text-policy-holder-phone"
                        >
                          {policyHolderClient.phone}
                        </a>
                      ) : (
                        <p className="font-medium text-muted-foreground">Not on file</p>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                        Email
                      </p>
                      {policyHolderClient.email ? (
                        <a className="font-medium text-primary hover:underline break-all" href={`mailto:${policyHolderClient.email}`}>
                          {policyHolderClient.email}
                        </a>
                      ) : (
                        <p className="font-medium text-muted-foreground">Not on file</p>
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                        <IdCard className="h-3.5 w-3.5 shrink-0" />
                        National ID
                      </p>
                      <p className="font-medium font-mono break-all">{policyHolderClient.nationalId || "—"}</p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-muted-foreground text-xs">Date of birth</p>
                      <p className="font-medium">
                        {policyHolderClient.dateOfBirth
                          ? new Date(policyHolderClient.dateOfBirth).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })
                          : "—"}
                      </p>
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="text-muted-foreground text-xs">Gender</p>
                      <p className="font-medium capitalize">{policyHolderClient.gender || "—"}</p>
                    </div>
                    {policyHolderClient.maritalStatus ? (
                      <div className="min-w-0 space-y-1">
                        <p className="text-muted-foreground text-xs">Marital status</p>
                        <p className="font-medium capitalize">{policyHolderClient.maritalStatus}</p>
                      </div>
                    ) : null}
                    {policyHolderClient.address ? (
                      <div className="min-w-0 space-y-1 sm:col-span-2 lg:col-span-3">
                        <p className="text-muted-foreground text-xs flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 shrink-0" />
                          Address
                        </p>
                        <p className="font-medium whitespace-pre-wrap break-words">{policyHolderClient.address}</p>
                      </div>
                    ) : null}
                    {policyHolderClient.location ? (
                      <div className="min-w-0 space-y-1">
                        <p className="text-muted-foreground text-xs">Location / area</p>
                        <p className="font-medium break-words">{policyHolderClient.location}</p>
                      </div>
                    ) : null}
                    {policyHolderClient.preferredCommMethod ? (
                      <div className="min-w-0 space-y-1">
                        <p className="text-muted-foreground text-xs">Preferred contact</p>
                        <p className="font-medium capitalize">{policyHolderClient.preferredCommMethod}</p>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Could not load full client details (check access to this client).</p>
                  <p className="font-medium" data-testid="text-policy-client">{getClientName(displayPolicy.clientId)}</p>
                </div>
              )}
          </CardSection>

          <CardSection title="Cover & product" description="Plan version, claims gate, and client portal activation when applicable." icon={ShieldCheck}>
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Product</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Plan</p>
                    <p className="font-semibold">{displayPolicy.productName || "—"}</p>
                    {displayPolicy.productVersionLabel && <p className="text-xs text-muted-foreground mt-0.5">{displayPolicy.productVersionLabel}</p>}
                  </div>
                </div>
              </div>

              <Separator className="my-6" />

              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Claims</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-6">
                  <div>
                    <p className="text-muted-foreground text-xs mb-1">Eligibility</p>
                    <Badge variant="outline" className={displayPolicy.claimable ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}>
                      {displayPolicy.claimable ? "Claimable" : "Not claimable"}
                    </Badge>
                  </div>
                  {displayPolicy.claimableReason ? (
                    <p className="text-sm text-muted-foreground flex-1 leading-relaxed">{displayPolicy.claimableReason}</p>
                  ) : null}
                </div>
              </div>

              {displayPolicy.clientActivationCode ? (
                <>
                  <Separator className="my-6" />
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Client portal</h3>
                    <p className="text-muted-foreground text-xs mb-2">Activation code (client has not claimed their portal account yet)</p>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-mono font-bold text-primary text-lg tabular-nums" data-testid="text-activation-code">{displayPolicy.clientActivationCode}</p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={() => {
                          navigator.clipboard.writeText(displayPolicy.clientActivationCode);
                          toast({ title: "Copied", description: "Activation code copied to clipboard." });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                  </div>
                </>
              ) : null}
          </CardSection>

          <CardSection title="Dates & lifecycle" description="Capture, effective dates, waiting and grace windows." icon={CalendarDays}>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Capture date</p>
                    <p className="font-semibold tabular-nums">{displayPolicy.createdAt ? new Date(displayPolicy.createdAt).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Effective date</p>
                    <p className="font-semibold tabular-nums" data-testid="text-effective-date">{displayPolicy.effectiveDate || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Inception date</p>
                    <p className="font-semibold tabular-nums">{displayPolicy.inceptionDate || "Not set"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Waiting period</p>
                    {displayPolicy.waitingPeriodEndDate ? (() => {
                      const endDate = new Date(displayPolicy.waitingPeriodEndDate);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      endDate.setHours(0, 0, 0, 0);
                      const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      const waived = policyWaiver?.status === "approved";
                      return daysRemaining > 0 ? (
                        <p className="font-semibold text-amber-600">{daysRemaining} days left</p>
                      ) : waived ? (
                        <p className="font-semibold text-emerald-600 flex items-center gap-1">Waived <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-500/10 px-1.5 py-0 text-[10px] font-medium text-emerald-700">WAIVER</span></p>
                      ) : (
                        <p className="font-semibold text-emerald-600">Completed</p>
                      );
                    })() : (
                      <p className="font-semibold">{displayPolicy.waitingPeriodDays != null ? `${displayPolicy.waitingPeriodDays} days (product rule)` : "—"}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Waiting period ends</p>
                    <p className="font-semibold tabular-nums">{displayPolicy.waitingPeriodEndDate ? new Date(displayPolicy.waitingPeriodEndDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Grace period</p>
                    {displayPolicy.graceEndDate ? (() => {
                      const endDate = new Date(displayPolicy.graceEndDate);
                      const today = new Date();
                      today.setHours(0, 0, 0, 0);
                      endDate.setHours(0, 0, 0, 0);
                      const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                      return daysRemaining > 0 ? (
                        <p className="font-semibold text-amber-600">{daysRemaining} days left</p>
                      ) : (
                        <p className="font-semibold text-emerald-600">Completed</p>
                      );
                    })() : (
                      <p className="font-semibold">—</p>
                    )}
                  </div>
                </div>
          </CardSection>
            </TabsContent>

            <TabsContent value="financials" className="space-y-4 mt-4">
          <CardSection title="Financial position" description="Premium schedule, balance, and cumulative receipts." icon={CreditCard}>
              <div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Premium</p>
                    <p className="text-lg font-bold tabular-nums" data-testid="text-premium-amount">{displayPolicy.currency} {Number(displayPolicy.premiumAmount).toFixed(2)}</p>
                    <p className="text-xs text-muted-foreground capitalize">{displayPolicy.paymentSchedule}</p>
                  </div>
                  {displayPolicy.balance != null && (
                    <div>
                      <p className="text-muted-foreground text-xs">Balance</p>
                      <p className={`text-lg font-bold tabular-nums ${Number(displayPolicy.balance) > 0 ? "text-emerald-600" : Number(displayPolicy.balance) < 0 ? "text-destructive" : ""}`} data-testid="text-balance">
                        {displayPolicy.currency} {Number(displayPolicy.balance).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {Number(displayPolicy.balance) > 0 ? "Advance" : Number(displayPolicy.balance) < 0 ? "Arrears" : "Up to date"}
                      </p>
                    </div>
                  )}
                  {displayPolicy.totalPaid != null && (
                    <div>
                      <p className="text-muted-foreground text-xs">Total paid</p>
                      <p className="text-lg font-bold tabular-nums">{displayPolicy.currency} {Number(displayPolicy.totalPaid).toFixed(2)}</p>
                      <p className="text-xs text-muted-foreground">{displayPolicy.periodsElapsed ?? 0} period{(displayPolicy.periodsElapsed ?? 0) !== 1 ? "s" : ""} elapsed</p>
                    </div>
                  )}
                  {displayPolicy.walletBalance != null && Math.abs(Number(displayPolicy.walletBalance)) >= 0.01 && (
                    <div>
                      <p className="text-muted-foreground text-xs">Credit wallet</p>
                      <p className={`text-lg font-bold tabular-nums ${Number(displayPolicy.walletBalance) >= 0 ? "text-emerald-600" : "text-destructive"}`} data-testid="text-wallet-balance">
                        {displayPolicy.currency} {Number(displayPolicy.walletBalance).toFixed(2)}
                      </p>
                      <p className="text-xs text-muted-foreground">{Number(displayPolicy.walletBalance) >= 0 ? "Credit / advance" : "Owed (arrears)"}</p>
                    </div>
                  )}
                </div>
              </div>
          </CardSection>

          <CardSection
            title="Automatic mobile payments"
            icon={CreditCard}
            headerRight={(
              <Button variant="outline" size="sm" onClick={openPaymentMethodDialog} data-testid="btn-edit-payment-method">
                <Pencil className="h-4 w-4 mr-2" /> Edit
              </Button>
            )}
          >
              {(() => {
                const current = (clientPaymentMethods || []).find((m: any) => m.isDefault && m.isActive) || (clientPaymentMethods || [])[0];
                if (!current) return <p className="text-sm text-muted-foreground">No saved mobile wallet. Add one to enable automatic collection reminders (the client confirms with their PIN on their phone).</p>;
                if (current.methodType === "card") {
                  return (
                    <div className="text-sm space-y-1">
                      <p className="text-muted-foreground">Legacy card on file is not used for recurring collection.</p>
                      <p className="font-medium">Replace with EcoCash / OneMoney / InnBucks / O&apos;Mari + mobile number.</p>
                    </div>
                  );
                }
                return <p className="text-sm">{(current.provider || "mobile").toUpperCase()} · {current.mobileNumber || "—"}</p>;
              })()}
          </CardSection>
            </TabsContent>

            <TabsContent value="members" className="space-y-4 mt-4">
              {policyWaiver?.status === "approved" && (
                <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-800">
                  <span className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 mr-1">WAIVER APPROVED</span>
                  Waiting period has been formally waived — all members on this policy are immediately claimable.
                </div>
              )}
          <CardSection
            title="Policy members"
            description="All lives covered (policy holder + dependants). Filter by age band."
            icon={Users}
            headerRight={(() => {
              const limits = displayPolicy?.productMemberLimits;
              const activeMembers = (policyMembers ?? []).filter((m: any) => m.isActive !== false);
              const activeMemberCount = activeMembers.length;
              const includedCount = limits?.includedCount ?? null;
              const maxAdditional = limits?.maxAdditional ?? null;
              const totalLimit = includedCount != null && maxAdditional != null ? includedCount + maxAdditional : null;
              const additionalCount = includedCount != null ? Math.max(0, activeMemberCount - includedCount) : 0;
              const limitReached = totalLimit != null && activeMemberCount >= totalLimit;
              return (
              <>
                {limits && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="text-muted-foreground">{activeMemberCount} member{activeMemberCount !== 1 ? "s" : ""}</span>
                    {includedCount != null && (
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${activeMemberCount > includedCount ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                        {activeMemberCount <= includedCount ? `${activeMemberCount}/${includedCount} included` : `${includedCount} included + ${additionalCount} additional`}
                      </span>
                    )}
                    {limitReached && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Limit reached</span>}
                  </div>
                )}
                  <Select value={membersAgeFilter} onValueChange={(v: "all" | "adult" | "child") => setMembersAgeFilter(v)}>
                    <SelectTrigger className="w-[140px] h-8">
                      <SelectValue placeholder="Age band" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All lives</SelectItem>
                      <SelectItem value="adult">Adults (18+)</SelectItem>
                      <SelectItem value="child">Children (0–17)</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    onClick={() => syncMembersMutation.mutate()}
                    disabled={syncMembersMutation.isPending}
                  >
                    {syncMembersMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Users className="h-3.5 w-3.5" />}
                    Sync from client
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1"
                    disabled={limitReached}
                    title={limitReached ? `Maximum member limit reached (${totalLimit} total)` : "Add a new dependent to this policy"}
                    onClick={() => {
                      setDetailAddDepOpen(true);
                      setDetailDepForm({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Add Dependent
                  </Button>
              </>
              );
            })()}
            flush
          >
              {membersLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (() => {
                const all = policyMembers ?? [];
                const filtered = membersAgeFilter === "all" ? all : membersAgeFilter === "adult"
                  ? all.filter((m: any) => m.role === "policy_holder" || (m.age != null && m.age >= 18))
                  : all.filter((m: any) => m.age != null && m.age < 18);
                return filtered.length > 0 ? (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                    <TableRow>
                      <TableHead className="pl-6">Member</TableHead>
                      <TableHead>Relationship</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>National ID</TableHead>
                      <TableHead>DOB</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Capture Date</TableHead>
                      <TableHead>Inception</TableHead>
                      <TableHead>Cover starts</TableHead>
                      <TableHead>Waiting period</TableHead>
                      {canEditPremium && <TableHead>Edit</TableHead>}
                      <TableHead>Status</TableHead>
                      <TableHead>Claimable</TableHead>
                      <TableHead>Add-ons</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((m: any) => (
                      <TableRow key={m.id} data-testid={`row-member-${m.id}`}>
                        <TableCell className="pl-6 font-medium whitespace-nowrap">
                          {m.memberName || (m.clientId ? getClientName(m.clientId) : "—")}
                          {m.memberNumber && <span className="block text-xs text-muted-foreground font-mono">{m.memberNumber}</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{m.relationship || m.role}</Badge>
                        </TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {(m.role === "policy_holder" || m.role === "principal") && policyHolderClient?.phone ? (
                            <a className="text-primary hover:underline font-medium" href={`tel:${String(policyHolderClient.phone).replace(/\s+/g, "")}`}>
                              {policyHolderClient.phone}
                            </a>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{m.nationalId || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.dateOfBirth || "—"}</TableCell>
                        <TableCell className="text-sm">{m.age != null ? m.age : "—"}</TableCell>
                        <TableCell className="text-sm capitalize">{m.gender || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.captureDate || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.inceptionDate || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {m.coverDate || "—"}
                        </TableCell>
                        <TableCell className="text-sm align-top min-w-[140px]">
                          {(() => {
                            const waitEnd = m.waitingPeriodEndDate || m.coverDate;
                            if (!waitEnd) {
                              return m.waitingPeriodDays != null ? (
                                <span className="text-xs text-muted-foreground">Rule: {m.waitingPeriodDays} days (no start date)</span>
                              ) : "—";
                            }
                            const end = new Date(waitEnd);
                            if (isNaN(end.getTime())) return "—";
                            const now = new Date();
                            now.setHours(0, 0, 0, 0);
                            end.setHours(0, 0, 0, 0);
                            const d = Math.ceil((end.getTime() - now.getTime()) / 86400000);
                            return (
                              <div className="flex flex-col gap-0.5">
                                <span className="text-xs text-muted-foreground">Ends</span>
                                <span className="font-medium whitespace-nowrap">
                                  {end.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
                                </span>
                                {d > 0 ? (
                                  <span className="text-xs font-semibold text-amber-700">{d} day{d !== 1 ? "s" : ""} remaining</span>
                                ) : (
                                  <span className="text-xs font-semibold text-emerald-700">Completed</span>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={m.effectiveStatus || "inactive"} />
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className={m.claimable ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                              {m.claimable ? "Yes" : "No"}
                            </Badge>
                            {m.claimableReason && <span className="text-[10px] text-muted-foreground leading-tight max-w-[140px]">{m.claimableReason}</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {(() => {
                            const memberAoIds = policyMemberAddOns
                              .filter((ao: any) => ao.policyMemberId === m.id)
                              .map((ao: any) => ao.addOnId);
                            const memberAoNames = memberAoIds.map((aoId: string) => {
                              const ao = addOns.find((a: any) => a.id === aoId);
                              return ao?.name ?? aoId.slice(0, 6);
                            });
                            return (
                              <div className="flex flex-wrap gap-1 items-center min-w-[120px]">
                                {memberAoNames.map((name: string) => (
                                  <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                                ))}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  title="Edit add-ons for this member"
                                  aria-label="Edit add-ons for this member"
                                  onClick={() => {
                                    setEditAddOnsMemberId(m.id);
                                    setEditAddOnsSelected(memberAoIds);
                                    setEditAddOnsOpen(true);
                                  }}
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                                </Button>
                              </div>
                            );
                          })()}
                        </TableCell>
                        {canEditPremium && (
                          <TableCell>
                            <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit member details" onClick={() => openEditMember(m)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              ) : (
                <div className="p-6 text-center text-muted-foreground" data-testid="text-no-members">
                  {all.length === 0 ? "No members found for this policy." : `No members match the selected age band (${membersAgeFilter === "adult" ? "Adults 18+" : "Children 0–17"}).`}
                </div>
              );
              })()}
          </CardSection>

          {/* Edit add-ons dialog */}
          <Dialog open={editAddOnsOpen} onOpenChange={setEditAddOnsOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit Add-ons</DialogTitle>
                <DialogDescription>
                  Select add-ons for this member. Changes recalculate the policy premium.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {(addOns?.filter((a: any) => a.isActive !== false) ?? []).map((ao: any) => {
                  const checked = editAddOnsSelected.includes(ao.id);
                  return (
                    <div key={ao.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`edit-ao-${ao.id}`}
                        checked={checked}
                        onCheckedChange={(v) =>
                          setEditAddOnsSelected((prev) =>
                            v ? [...prev, ao.id] : prev.filter((id) => id !== ao.id)
                          )
                        }
                      />
                      <label htmlFor={`edit-ao-${ao.id}`} className="text-sm cursor-pointer flex-1">
                        {ao.name}
                        {ao.priceMonthly && (
                          <span className="text-muted-foreground ml-1">— {displayPolicy?.currency ?? "USD"} {ao.priceMonthly}/mo</span>
                        )}
                      </label>
                    </div>
                  );
                })}
                {(!addOns || addOns.length === 0) && (
                  <p className="text-sm text-muted-foreground">No add-ons configured for this tenant.</p>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setEditAddOnsOpen(false)}>Cancel</Button>
                <Button
                  disabled={setMemberAddOnsMutation.isPending}
                  onClick={() => {
                    if (editAddOnsMemberId)
                      setMemberAddOnsMutation.mutate({ memberId: editAddOnsMemberId, addOnIds: editAddOnsSelected });
                  }}
                >
                  {setMemberAddOnsMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {displayPolicy.beneficiaryFirstName && (
            <CardSection title="Beneficiary" description="Designated beneficiary for this policy." icon={Users}>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground text-xs">Name</p>
                    <p className="font-medium">{displayPolicy.beneficiaryFirstName} {displayPolicy.beneficiaryLastName}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Relationship</p>
                    <p className="font-medium">{displayPolicy.beneficiaryRelationship || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">National ID</p>
                    <p className="font-medium font-mono tabular-nums">{displayPolicy.beneficiaryNationalId || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Phone</p>
                    <p className="font-medium">{displayPolicy.beneficiaryPhone || "—"}</p>
                  </div>
                </div>
            </CardSection>
          )}
            </TabsContent>

            <TabsContent value="payments" className="space-y-4 mt-4">
          <CardSection title="Payment history" description="Transactions recorded against this policy." icon={CreditCard} flush>
              {paymentsLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (policyPayments ?? []).length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                    <TableRow>
                      <TableHead className="pl-6">Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Reference</TableHead>
                      {(canEditPayment || canDeletePayment) && <TableHead className="text-right pr-6">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(policyPayments ?? []).map((p: any) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell className="pl-6 tabular-nums">{p.postedDate || new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="font-medium tabular-nums text-right">{p.currency} {Number(p.amount).toFixed(2)}</TableCell>
                        <TableCell>{p.paymentMethod}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={p.status}
                            variant="payment"
                            label={p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : undefined}
                          />
                        </TableCell>
                        <TableCell className="text-muted-foreground tabular-nums text-xs">
                          {p.periodFrom && p.periodTo ? (() => {
                            const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
                            const from = fmt(p.periodFrom);
                            const to = fmt(p.periodTo);
                            return from === to ? from : `${from} – ${to}`;
                          })() : "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                        {(canEditPayment || canDeletePayment) && (
                          <TableCell className="text-right pr-6">
                            <div className="flex items-center justify-end gap-1">
                              {canEditPayment && (
                                <Button variant="ghost" size="icon" title="Edit payment" aria-label="Edit payment" data-testid={`btn-edit-payment-${p.id}`} onClick={() => {
                                  setEditPaymentId(p.id);
                                  setEditPaymentForm({ amount: String(p.amount), status: p.status, reference: p.reference || "", notes: p.notes || "" });
                                }}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              )}
                              {canDeletePayment && (
                                <Button variant="ghost" size="icon" title="Delete payment" aria-label="Delete payment" data-testid={`btn-delete-payment-${p.id}`} className="text-destructive hover:text-destructive" onClick={() => setConfirmDeletePayment(p.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground" data-testid="text-no-payments">No payments recorded for this policy.</div>
              )}
          </CardSection>

          <CardSection title="Receipts" description="Payment receipts issued for this policy." icon={Receipt} flush>
              {(policyReceipts ?? []).length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                    <TableRow>
                      <TableHead className="pl-6">Receipt #</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Channel</TableHead>
                      <TableHead>Period</TableHead>
                      <TableHead>Issued</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(policyReceipts ?? []).map((r: any) => {
                      const receiptViewUrl = getApiBase() + `/api/receipts/${r.id}/view`;
                      const receiptDownloadUrl = getApiBase() + `/api/receipts/${r.id}/download`;
                      const receiptThermalUrl = getApiBase() + `/api/receipts/${r.id}/view?format=thermal`;
                      const displayNum = /^\d+$/.test(String(r.receiptNumber).trim())
                        ? `RCP-${String(r.receiptNumber).padStart(5, "0")}`
                        : r.receiptNumber;
                      return (
                        <TableRow key={r.id} data-testid={`row-receipt-${r.id}`}>
                          <TableCell className="pl-6 font-mono font-medium">{displayNum}</TableCell>
                          <TableCell>{r.currency} {Number(r.amount).toFixed(2)}</TableCell>
                          <TableCell className="capitalize">{r.paymentChannel}</TableCell>
                          <TableCell className="text-muted-foreground tabular-nums text-xs">
                            {r.periodFrom && r.periodTo ? (() => {
                              const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { month: "short", year: "numeric" });
                              const from = fmt(r.periodFrom);
                              const to = fmt(r.periodTo);
                              return from === to ? from : `${from} – ${to}`;
                            })() : "—"}
                          </TableCell>
                          <TableCell>{new Date(r.issuedAt).toLocaleDateString("en-GB")}</TableCell>
                          <TableCell className="text-right pr-6">
                            <div className="flex items-center justify-end gap-1">
                              <Button variant="ghost" size="icon" title="View receipt" aria-label="View receipt" onClick={() => { setReceiptViewFormat("a4"); setReceiptSuccessData({ viewOnly: true, receiptId: r.id, receiptNumber: displayNum }); setShowReceiptSuccess(true); }}><Eye className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" title="Thermal receipt" aria-label="Print thermal receipt" onClick={() => { setReceiptViewFormat("thermal80"); setReceiptSuccessData({ viewOnly: true, receiptId: r.id, receiptNumber: displayNum }); setShowReceiptSuccess(true); }}><ScrollText className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" title="Download" aria-label="Download receipt" onClick={() => window.open(receiptDownloadUrl, "_blank", "noopener")}><Download className="h-4 w-4" /></Button>
                              <Button variant="ghost" size="icon" title="Print" aria-label="Print receipt" onClick={() => printDocument(receiptViewUrl)}><Printer className="h-4 w-4" aria-hidden="true" /></Button>
                              <Button variant="ghost" size="icon" title="Share" aria-label="Share receipt" onClick={() => shareDocument(receiptDownloadUrl, `Receipt-${displayNum}`)}><Share2 className="h-4 w-4" aria-hidden="true" /></Button>
                              {canEditReceipt && (
                                <Button variant="ghost" size="icon" title="Edit receipt" aria-label="Edit receipt" data-testid={`btn-edit-receipt-${r.id}`} onClick={() => {
                                  setEditReceiptId(r.id);
                                  setEditReceiptForm({ amount: String(r.amount), status: r.status || "issued", paymentChannel: r.paymentChannel || "" });
                                }}><Pencil className="h-4 w-4" /></Button>
                              )}
                              {canDeleteReceipt && (
                                <Button variant="ghost" size="icon" title="Delete receipt" aria-label="Delete receipt" data-testid={`btn-delete-receipt-${r.id}`} className="text-destructive hover:text-destructive" onClick={() => setConfirmDeleteReceipt(r.id)}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground">No receipts issued for this policy.</div>
              )}
          </CardSection>

            </TabsContent>

            <TabsContent value="documents" className="space-y-4 mt-4">
          <CardSection title="E-Statement" description="Open the preview to review your statement, then download from there if you need a file. Optionally filter by date range first." icon={FileText} contentClassName="space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">From (optional)</Label>
                  <Input
                    type="date"
                    id="estatement-dateFrom"
                    className="w-36"
                    data-testid="input-estatement-dateFrom"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">To (optional)</Label>
                  <Input
                    type="date"
                    id="estatement-dateTo"
                    className="w-36"
                    data-testid="input-estatement-dateTo"
                  />
                </div>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const { from, to } = readEstatementDateRange();
                    setShowEstatementViewer(true);
                    setEstatementViewerUrl(staffEstatementUrl(selectedPolicy.id, false, from, to));
                  }}
                  data-testid="btn-view-estatement"
                >
                  <Eye className="h-4 w-4" /> View
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const { from, to } = readEstatementDateRange();
                    printDocument(staffEstatementUrl(selectedPolicy.id, false, from, to));
                  }}
                  data-testid="btn-print-estatement"
                >
                  <Printer className="h-4 w-4" /> Print
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const { from, to } = readEstatementDateRange();
                    shareDocument(staffEstatementUrl(selectedPolicy.id, false, from, to), `E-Statement-${displayPolicy.policyNumber}`);
                  }}
                >
                  <Share2 className="h-4 w-4" /> Share
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Leave dates empty for full payment history. Uses tenant logo and signature from Settings.</p>
          </CardSection>

          <CardSection title="Policy Documents" description="Upload and manage documents for this policy (PDF, images, Word, audio, video — max 10MB each)." icon={FileText} contentClassName="space-y-4">
            {canWritePolicy && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="grid gap-1.5">
                  <Label className="text-xs">Document type</Label>
                  <Select value={docUploadType} onValueChange={setDocUploadType}>
                    <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="other">General</SelectItem>
                      <SelectItem value="id_copy">ID Copy</SelectItem>
                      <SelectItem value="policy_schedule">Policy Schedule</SelectItem>
                      <SelectItem value="payment_proof">Payment Proof</SelectItem>
                      <SelectItem value="claim_support">Claim Support</SelectItem>
                      <SelectItem value="medical">Medical</SelectItem>
                      <SelectItem value="waiver_support">Waiver Support</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">Label (optional)</Label>
                  <Input className="w-48 h-9" placeholder="e.g. ID copy front" value={docUploadLabel} onChange={(e) => setDocUploadLabel(e.target.value)} />
                </div>
                <Button variant="outline" className="gap-2 h-9" disabled={docUploading} onClick={() => docFileInputRef.current?.click()}>
                  {docUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Upload file
                </Button>
                <input ref={docFileInputRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.gif,.webp,.doc,.docx,.mp3,.mp4,.wav,.m4a,.ogg,.avi,.mov" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPolicyDoc(f); }} />
              </div>
            )}
            {policyDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No documents uploaded yet.</p>
            ) : (
              <div className="divide-y divide-border rounded-md border">
                {policyDocs.map((doc: any) => (
                  <div key={doc.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{doc.label || doc.fileName}</p>
                      <p className="text-xs text-muted-foreground">{doc.documentType} · {doc.mimeType} · {doc.fileSize ? `${(doc.fileSize / 1024).toFixed(0)} KB` : ""}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Open document" aria-label="Open document"><Eye className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                      </a>
                      <a href={doc.fileUrl} download={doc.fileName}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="Download" aria-label="Download document"><Download className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                      </a>
                      {canWritePolicy && (
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" title="Delete" aria-label="Delete document" onClick={() => deletePolicyDoc(doc.id)}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardSection>

            </TabsContent>

            <TabsContent value="waivers" className="space-y-4 mt-4">
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
            </TabsContent>
          </Tabs>

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
                      shareDocument(u.toString(), `E-Statement-${displayPolicy.policyNumber}`);
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
                      shareDocument(u.toString(), `Policy-${displayPolicy.policyNumber}`);
                    }}
                  >
                    <Share2 className="h-4 w-4" /> Share
                  </Button>
                  <Button variant="outline" onClick={() => { setShowPolicyDocViewer(false); setPolicyDocViewerUrl(""); }}>Close</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={showWaiverDialog} onOpenChange={(open) => { setShowWaiverDialog(open); if (!open) { setWaiverReason(""); setWaiverNotes(""); } }}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Request Waiting Period Waiver</DialogTitle>
                <DialogDescription>Provide the reason for the waiver. Admins and managers will review your request before approving.</DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>Reason for waiver <span className="text-destructive">*</span></Label>
                  <Textarea placeholder="e.g. Client had an active policy with another insurer for the past 2 years" value={waiverReason} onChange={(e) => setWaiverReason(e.target.value)} rows={3} />
                </div>
                <div>
                  <Label>Supporting notes (optional)</Label>
                  <Textarea placeholder="Any additional context or document references" value={waiverNotes} onChange={(e) => setWaiverNotes(e.target.value)} rows={2} />
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

          <Dialog open={showReceiptSuccess} onOpenChange={(open) => { setShowReceiptSuccess(open); if (!open) setReceiptViewFormat("a4"); }}>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  {receiptSuccessData?.viewOnly ? "Receipt" : "Payment Successful"}
                </DialogTitle>
                <DialogDescription>
                  {receiptSuccessData?.viewOnly
                    ? `Viewing receipt ${receiptSuccessData?.receiptNumber || ""}`
                    : `Payment has been recorded for policy ${receiptSuccessData?.policyNumber || ""}.`
                  }
                </DialogDescription>
              </DialogHeader>
              {receiptSuccessData && (() => {
                const receiptId = receiptSuccessData.viewOnly
                  ? receiptSuccessData.receiptId
                  : receiptSuccessData.receipt?.id;
                if (!receiptId) return (
                  <div className="text-center py-4 text-muted-foreground">
                    {receiptSuccessData.paynow ? "Paynow payment processed. Receipt will appear shortly." : "No receipt ID available."}
                  </div>
                );
                const thermalSize = receiptViewFormat === "thermal48" ? "48" : receiptViewFormat === "thermal58" ? "58" : "80";
                const isThermal = receiptViewFormat !== "a4";
                const iframeSrc = isThermal
                  ? getApiBase() + `/api/receipts/${receiptId}/view?format=thermal&size=${thermalSize}`
                  : getApiBase() + `/api/receipts/${receiptId}/view`;
                const receiptDownloadUrl = getApiBase() + `/api/receipts/${receiptId}/download`;
                const receiptDownloadThermalUrl = getApiBase() + `/api/receipts/${receiptId}/download?format=thermal&size=${thermalSize}`;
                const iframeH = isThermal ? "h-[600px]" : "h-[480px]";
                return (
                  <div className="space-y-3">
                    {/* Format toggle */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-muted-foreground mr-1">Format:</span>
                      <Button size="sm" variant={receiptViewFormat === "a4" ? "default" : "outline"} className="h-7 text-xs gap-1.5" onClick={() => setReceiptViewFormat("a4")}>
                        <FileText className="h-3 w-3" /> A4
                      </Button>
                      <Button size="sm" variant={receiptViewFormat === "thermal48" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal48")}>
                        <ScrollText className="h-3 w-3" /> 48mm
                      </Button>
                      <Button size="sm" variant={receiptViewFormat === "thermal58" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal58")}>
                        <ScrollText className="h-3 w-3" /> 58mm
                      </Button>
                      <Button size="sm" variant={receiptViewFormat === "thermal80" ? "default" : "outline"} className="h-7 text-xs gap-1" onClick={() => setReceiptViewFormat("thermal80")}>
                        <ScrollText className="h-3 w-3" /> 80mm
                      </Button>
                    </div>
                    {/* Inline PDF viewer */}
                    <div className="border rounded-md overflow-hidden bg-muted/30">
                      <iframe
                        key={iframeSrc}
                        title="Receipt Preview"
                        src={iframeSrc}
                        className={`w-full ${iframeH}`}
                      />
                    </div>
                    <div className="flex justify-between gap-2 flex-wrap">
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => printDocument(iframeSrc)}>
                          <Printer className="h-3.5 w-3.5" aria-hidden="true" /> Print
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open(isThermal ? receiptDownloadThermalUrl : receiptDownloadUrl, "_blank", "noopener")}>
                          <Download className="h-3.5 w-3.5" aria-hidden="true" /> Download
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => {
                          const num = receiptSuccessData.receipt?.receiptNumber || receiptSuccessData.receiptNumber || "";
                          shareDocument(isThermal ? receiptDownloadThermalUrl : receiptDownloadUrl, `Receipt-${num}`);
                        }}>
                          <Share2 className="h-3.5 w-3.5" aria-hidden="true" /> Share
                        </Button>
                      </div>
                      <Button variant="outline" size="sm" onClick={() => { setShowReceiptSuccess(false); setReceiptSuccessData(null); }}>
                        Close
                      </Button>
                    </div>
                  </div>
                );
              })()}
            </DialogContent>
          </Dialog>
        </PageShell>

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

        <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Policy Details</DialogTitle>
              <DialogDescription>
                Update details for policy <strong>{displayPolicy?.policyNumber}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Currency</Label>
                  <CurrencySelect value={editForm.currency} onValueChange={(v) => setEditForm({ ...editForm, currency: v })} />
                </div>
                <div>
                  <Label className="text-xs">Payment Schedule</Label>
                  <Select value={editForm.paymentSchedule} onValueChange={(v) => setEditForm({ ...editForm, paymentSchedule: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
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
                  <Label className="text-xs">Effective Date</Label>
                  <Input type="date" value={editForm.effectiveDate} onChange={(e) => setEditForm({ ...editForm, effectiveDate: e.target.value })} />
                </div>
                {canEditPremium && (
                  <div>
                    <Label className="text-xs">Inception Date</Label>
                    <Input type="date" value={editForm.inceptionDate} onChange={(e) => setEditForm({ ...editForm, inceptionDate: e.target.value })} />
                  </div>
                )}
                <div>
                  <Label className="text-xs">Branch</Label>
                  <Select value={editForm.branchId || "none"} onValueChange={(v) => setEditForm({ ...editForm, branchId: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="No branch" /></SelectTrigger>
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
                <div className="grid grid-cols-2 gap-4">
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
                  <div className="grid grid-cols-2 gap-4">
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
                      <Label className="text-xs">Effective from</Label>
                      <Input type="date" value={editForm.premiumEffectiveDate} onChange={(e) => setEditForm({ ...editForm, premiumEffectiveDate: e.target.value })} data-testid="input-edit-premium-date" />
                    </div>
                    <div className="col-span-2">
                      <Label className="text-xs">Reason (optional)</Label>
                      <Input value={editForm.premiumChangeReason} onChange={(e) => setEditForm({ ...editForm, premiumChangeReason: e.target.value })} placeholder="e.g. Correction, negotiated rate" />
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

              <div className="flex items-start gap-3 rounded-md border p-3">
                <Checkbox
                  id="edit-is-south-africa"
                  checked={editForm.isSouthAfrica}
                  onCheckedChange={(v) => setEditForm({ ...editForm, isSouthAfrica: !!v })}
                  className="mt-0.5"
                  data-testid="checkbox-edit-is-south-africa"
                />
                <div className="space-y-0.5">
                  <label htmlFor="edit-is-south-africa" className="text-sm font-medium cursor-pointer">South Africa-based policy</label>
                  <p className="text-xs text-muted-foreground">Client is based in South Africa. Leave unchecked for Zimbabwe-based policies.</p>
                </div>
              </div>
              {editForm.isSouthAfrica && (
                <div>
                  <Label className="text-xs">RSA Policy Number / Reference</Label>
                  <Input
                    value={editForm.externalReference}
                    onChange={(e) => setEditForm({ ...editForm, externalReference: e.target.value })}
                    placeholder="e.g. the South Africa branch's own policy number"
                    data-testid="input-edit-external-reference"
                  />
                </div>
              )}

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

        <Dialog open={showEditClientDialog} onOpenChange={setShowEditClientDialog}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Contact Details</DialogTitle>
              <DialogDescription>
                Update contact/address for <strong>{[policyHolderClient?.firstName, policyHolderClient?.lastName].filter(Boolean).join(" ")}</strong>. National ID, date of birth, and gender are edited from the Clients page.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Phone</Label>
                  <Input value={editClientForm.phone} onChange={(e) => setEditClientForm({ ...editClientForm, phone: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Email</Label>
                  <Input type="email" value={editClientForm.email} onChange={(e) => setEditClientForm({ ...editClientForm, email: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Physical Address</Label>
                <Textarea rows={2} value={editClientForm.physicalAddress} onChange={(e) => setEditClientForm({ ...editClientForm, physicalAddress: e.target.value })} placeholder="Street address, suburb, city" />
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

        <Dialog open={editMemberOpen} onOpenChange={setEditMemberOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Edit Member Details</DialogTitle>
              <DialogDescription>
                Update personal details for <strong>{editingMember?.memberName || "this member"}</strong>.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">First Name</Label>
                  <Input value={editMemberForm.firstName} onChange={(e) => setEditMemberForm({ ...editMemberForm, firstName: e.target.value })} placeholder="First name" />
                </div>
                <div>
                  <Label className="text-xs">Last Name</Label>
                  <Input value={editMemberForm.lastName} onChange={(e) => setEditMemberForm({ ...editMemberForm, lastName: e.target.value })} placeholder="Last name" />
                </div>
                <div>
                  <Label className="text-xs">Relationship</Label>
                  <Select value={editMemberForm.relationship || "none"} onValueChange={(v) => setEditMemberForm({ ...editMemberForm, relationship: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      <SelectItem value="Policy Holder">Policy Holder</SelectItem>
                      {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Gender</Label>
                  <Select value={editMemberForm.gender || "none"} onValueChange={(v) => setEditMemberForm({ ...editMemberForm, gender: v === "none" ? "" : v })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">National ID</Label>
                  <Input value={editMemberForm.nationalId} onChange={(e) => setEditMemberForm({ ...editMemberForm, nationalId: e.target.value.toUpperCase() })} placeholder="National ID" />
                </div>
                <div>
                  <Label className="text-xs">Date of Birth</Label>
                  <Input type="date" value={editMemberForm.dateOfBirth} onChange={(e) => setEditMemberForm({ ...editMemberForm, dateOfBirth: e.target.value })} />
                </div>
                {(editingMember?.role === "policy_holder" || editingMember?.role === "principal") && (
                  <>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input value={editMemberForm.phone} onChange={(e) => setEditMemberForm({ ...editMemberForm, phone: e.target.value })} placeholder="Phone number" />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input type="email" value={editMemberForm.email} onChange={(e) => setEditMemberForm({ ...editMemberForm, email: e.target.value })} placeholder="Email address" />
                    </div>
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditMemberOpen(false)}>Cancel</Button>
              <Button onClick={handleEditMemberSubmit} disabled={editMemberMutation.isPending}>
                {editMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
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
                <Label>Product</Label>
                <Select
                  value={upgradeForm.selectedProductId || undefined}
                  onValueChange={(v) => setUpgradeForm({ selectedProductId: v, productVersionId: "" })}
                >
                  <SelectTrigger data-testid="select-upgrade-product">
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
                <Label>Provider</Label>
                <Select value={paymentMethodForm.provider} onValueChange={(v) => setPaymentMethodForm({ ...paymentMethodForm, provider: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ecocash">EcoCash</SelectItem>
                    <SelectItem value="onemoney">OneMoney</SelectItem>
                    <SelectItem value="innbucks">InnBucks</SelectItem>
                    <SelectItem value="omari">O'Mari</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Mobile Number</Label>
                <Input value={paymentMethodForm.mobileNumber} onChange={(e) => setPaymentMethodForm({ ...paymentMethodForm, mobileNumber: e.target.value })} placeholder="e.g. 0771234567" />
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

        <Dialog open={detailAddDepOpen} onOpenChange={setDetailAddDepOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Dependent to Policy</DialogTitle>
              <DialogDescription>This dependent will be added to the client record and linked to this policy.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">First Name *</Label>
                <Input value={detailDepForm.firstName} onChange={(e) => setDetailDepForm({ ...detailDepForm, firstName: e.target.value })} placeholder="First name" />
              </div>
              <div>
                <Label className="text-xs">Last Name *</Label>
                <Input value={detailDepForm.lastName} onChange={(e) => setDetailDepForm({ ...detailDepForm, lastName: e.target.value })} placeholder="Last name" />
              </div>
              <div>
                <Label className="text-xs">Relationship *</Label>
                <Select value={detailDepForm.relationship} onValueChange={(v) => setDetailDepForm({ ...detailDepForm, relationship: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">National ID</Label>
                <Input value={detailDepForm.nationalId} onChange={(e) => setDetailDepForm({ ...detailDepForm, nationalId: e.target.value })} placeholder="ID number" />
              </div>
              <div>
                <Label className="text-xs">Date of Birth</Label>
                <Input type="date" value={detailDepForm.dateOfBirth} onChange={(e) => setDetailDepForm({ ...detailDepForm, dateOfBirth: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Gender</Label>
                <Select value={detailDepForm.gender} onValueChange={(v) => setDetailDepForm({ ...detailDepForm, gender: v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDetailAddDepOpen(false)}>Cancel</Button>
              <Button
                onClick={() => detailAddDepMutation.mutate(detailDepForm)}
                disabled={!detailDepForm.firstName || !detailDepForm.lastName || !detailDepForm.relationship || detailAddDepMutation.isPending}
              >
                {detailAddDepMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Dependent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={showInPolicyReceiptDialog} onOpenChange={(open) => { setShowInPolicyReceiptDialog(open); if (!open) resetPnState(); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Receipt Payment</DialogTitle>
              <DialogDescription>
                Record a payment for policy <strong>{displayPolicy.policyNumber}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-xs">Months</Label>
                  <Select value={String(inPolicyReceiptMonths)} onValueChange={(v) => setInPolicyReceiptMonths(Number(v))} disabled={pnPhase !== "select"}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>{m} {m === 1 ? "month" : "months"}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    value={inPolicyReceiptAmountOverride ?? (displayPolicy.premiumAmount ? (parseFloat(displayPolicy.premiumAmount) * inPolicyReceiptMonths).toFixed(2) : "0.00")}
                    onChange={canEditPremium ? (e) => setInPolicyReceiptAmountOverride(e.target.value) : undefined}
                    readOnly={!canEditPremium}
                    className={!canEditPremium ? "bg-muted cursor-not-allowed" : undefined}
                    data-testid="input-in-policy-receipt-amount"
                  />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <CurrencySelect value={inPolicyReceiptCurrency} onValueChange={setInPolicyReceiptCurrency} />
                </div>
              </div>
              {(() => {
                const systemAmount = displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount) * inPolicyReceiptMonths : 0;
                const enteredAmount = inPolicyReceiptAmountOverride != null ? parseFloat(inPolicyReceiptAmountOverride) : systemAmount;
                const isOverridden = canEditPremium && Number.isFinite(enteredAmount) && Math.abs(enteredAmount - systemAmount) >= 0.01;
                if (!isOverridden) return null;
                return (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-400">
                      Amount differs from system premium ({inPolicyReceiptCurrency} {systemAmount.toFixed(2)}) — this receipt will be held for approval and won't apply to the policy until approved.
                    </p>
                    <div className="space-y-1">
                      <Label className="text-xs">Notes for approver *</Label>
                      <Textarea value={inPolicyReceiptSubmitterNote} onChange={(e) => setInPolicyReceiptSubmitterNote(e.target.value)}
                        placeholder="Explain why this amount differs from the system premium..." rows={2} className="text-sm" data-testid="textarea-in-policy-submitter-note" />
                    </div>
                  </div>
                );
              })()}
              {inPolicyReceiptMonths > 1 && (
                <p className="text-xs text-muted-foreground">
                  {inPolicyReceiptMonths}× premium of {inPolicyReceiptCurrency} {displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount).toFixed(2) : "0.00"} = <strong>{inPolicyReceiptCurrency} {displayPolicy.premiumAmount ? (parseFloat(displayPolicy.premiumAmount) * inPolicyReceiptMonths).toFixed(2) : "0.00"}</strong>
                </p>
              )}
              <div>
                <Label className="text-xs">Payment Method</Label>
                <Select value={inPolicyReceiptMethod} onValueChange={setInPolicyReceiptMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {!isAgent && <SelectItem value="cash">Cash</SelectItem>}
                    <SelectItem value="ecocash">EcoCash</SelectItem>
                    <SelectItem value="onemoney">OneMoney</SelectItem>
                    <SelectItem value="innbucks">InnBucks</SelectItem>
                    <SelectItem value="omari">O'Mari</SelectItem>
                    <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {pnPhase === "select" && (
                <>
                  {(inPolicyReceiptMethod === "ecocash" || inPolicyReceiptMethod === "onemoney") && (
                    <div>
                      <Label className="text-xs">Client's Mobile Number (EcoCash/OneMoney)</Label>
                      <Input placeholder="e.g. 0771234567" value={inPolicyReceiptRef} onChange={(e) => setInPolicyReceiptRef(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">EcoCash uses USSD — a prompt is sent to this number. The client enters their PIN on their phone (no app push). Use the number registered with EcoCash/OneMoney.</p>
                    </div>
                  )}
                  {inPolicyReceiptMethod === "innbucks" && (
                    <div>
                      <Label className="text-xs">Client's Mobile Number</Label>
                      <Input placeholder="e.g. 0771234567" value={inPolicyReceiptRef} onChange={(e) => setInPolicyReceiptRef(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">An authorization code will be generated for the InnBucks app.</p>
                    </div>
                  )}
                  {inPolicyReceiptMethod === "omari" && (
                    <div>
                      <Label className="text-xs">Client's Mobile Number</Label>
                      <Input placeholder="e.g. 0771234567" value={inPolicyReceiptRef} onChange={(e) => setInPolicyReceiptRef(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">An OTP will be sent via SMS. You'll enter it here.</p>
                    </div>
                  )}
                  {inPolicyReceiptMethod === "visa_mastercard" && (
                    <div>
                      <Label className="text-xs">Client's Email Address</Label>
                      <Input type="email" placeholder="client@example.com" value={inPolicyReceiptRef} onChange={(e) => setInPolicyReceiptRef(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">A secure card payment page will open.</p>
                    </div>
                  )}
                  {inPolicyReceiptMethod === "cash" && (
                    <div>
                      <Label className="text-xs">Notes (optional)</Label>
                      <Input placeholder="e.g. Walk-in payment" value={inPolicyReceiptRef} onChange={(e) => setInPolicyReceiptRef(e.target.value)} />
                      <p className="text-xs text-muted-foreground mt-1">Receipt number is auto-generated.</p>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Notes (optional)</Label>
                    <Input placeholder="Additional notes..." value={inPolicyReceiptNotes} onChange={(e) => setInPolicyReceiptNotes(e.target.value)} />
                  </div>
                </>
              )}

              {pnPhase === "waiting" && (
                <>
                  {pnInnbucksCode && (
                    <div className="p-4 rounded-lg border-2 border-blue-300 bg-blue-50 space-y-3">
                      <p className="font-semibold text-blue-900">InnBucks Authorization Code</p>
                      <p className="text-3xl font-mono font-bold text-center tracking-widest text-blue-800">{pnInnbucksCode}</p>
                      {pnInnbucksExpiry && <p className="text-xs text-blue-700 text-center">Expires: {pnInnbucksExpiry}</p>}
                      <p className="text-sm text-blue-800">Give this code to the client. They open InnBucks app and enter it.</p>
                      {pnPolling && <div className="flex items-center justify-center gap-2 text-sm text-blue-700"><Loader2 className="h-4 w-4 animate-spin" /> Waiting for confirmation...</div>}
                    </div>
                  )}
                  {pnNeedsOtp && (
                    <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3">
                      <p className="font-semibold text-amber-900">Enter O'Mari OTP</p>
                      <p className="text-sm text-amber-800">Ask the client for the OTP sent to their phone.</p>
                      {pnOtpRef && <p className="text-xs text-amber-700">Reference: {pnOtpRef}</p>}
                      <Input placeholder="Enter OTP" value={pnOtp} onChange={(e) => setPnOtp(e.target.value)} maxLength={10} className="text-center text-lg font-mono tracking-widest" />
                      <Button className="w-full" disabled={!pnOtp || pnOtp.trim().length < 4 || pnOtpMutation.isPending} onClick={() => pnOtpMutation.mutate()}>
                        {pnOtpMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />} Verify OTP
                      </Button>
                    </div>
                  )}
                  {!pnInnbucksCode && !pnNeedsOtp && pnPolling && (
                    <div className="p-4 rounded-lg border-2 border-green-300 bg-green-50 space-y-3 text-center">
                      <Loader2 className="h-8 w-8 animate-spin mx-auto text-green-700" />
                      <p className="font-semibold text-green-900">
                        {pnPollData?.paynowStatus && isPaynowPaidLike(pnPollData.paynowStatus)
                          ? "Payment received — recording transaction..."
                          : inPolicyReceiptMethod === "visa_mastercard" ? "Waiting for card payment..." : "Waiting for client approval..."}
                      </p>
                      <p className="text-sm text-green-800">
                        {pnPollData?.paynowStatus && isPaynowPaidLike(pnPollData.paynowStatus)
                          ? "The payment gateway confirmed receipt. Finalising your receipt now..."
                          : inPolicyReceiptMethod === "visa_mastercard"
                            ? "Client should complete payment in the card page."
                            : "EcoCash/OneMoney use USSD — the client should see a prompt on their phone to enter their PIN. If nothing appears within 30 seconds, check the mobile number is correct (e.g. 0771234567) and try again."}
                      </p>
                      {pnPollError && (
                        <p className="text-xs text-amber-700 mt-1">{pnPollError}</p>
                      )}
                    </div>
                  )}
                  {!pnInnbucksCode && !pnNeedsOtp && !pnPolling && pnPhase === "waiting" && (
                    <div className="p-4 rounded-lg border-2 border-amber-300 bg-amber-50 space-y-3 text-center">
                      <p className="font-semibold text-amber-900">Confirmation timed out</p>
                      <p className="text-sm text-amber-800">
                        If the money was deducted, the payment will be recorded automatically once the gateway confirms. You can close this dialog and check back shortly.
                      </p>
                      <Button variant="outline" size="sm" onClick={() => { setPnPolling(true); setPnPollStartTime(Date.now()); setPnPollError(null); }}>
                        Retry polling
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setShowInPolicyReceiptDialog(false); resetPnState(); }}>Cancel</Button>
              {pnPhase === "select" && (
                <Button
                  onClick={() => {
                    const paynowMethods = ["ecocash", "onemoney", "innbucks", "omari", "visa_mastercard"];
                    if (inPolicyReceiptMethod === "cash") {
                      const systemAmount = displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount) * inPolicyReceiptMonths : 0;
                      const finalAmount = inPolicyReceiptAmountOverride != null ? parseFloat(inPolicyReceiptAmountOverride) : systemAmount;
                      inPolicyReceiptMutation.mutate({
                        policyId: selectedPolicy.id,
                        clientId: displayPolicy.clientId,
                        amount: Number.isFinite(finalAmount) ? finalAmount.toFixed(2) : systemAmount.toFixed(2),
                        months: inPolicyReceiptMonths,
                        currency: inPolicyReceiptCurrency,
                        paymentMethod: inPolicyReceiptMethod,
                        status: "cleared",
                        reference: inPolicyReceiptRef || undefined,
                        notes: inPolicyReceiptNotes || undefined,
                        submitterNote: inPolicyReceiptSubmitterNote.trim() || undefined,
                      });
                    } else if (paynowMethods.includes(inPolicyReceiptMethod)) {
                      if (!inPolicyReceiptRef || inPolicyReceiptRef.trim().length < 5) {
                        const label = inPolicyReceiptMethod === "visa_mastercard" ? "email" : "mobile number";
                        toast({ title: `Enter ${label}`, variant: "destructive" });
                        return;
                      }
                      pnInitiateMutation.mutate();
                    }
                  }}
                  disabled={
                    !displayPolicy.premiumAmount ||
                    inPolicyReceiptMutation.isPending ||
                    pnInitiateMutation.isPending ||
                    (["ecocash", "onemoney"].includes(inPolicyReceiptMethod) && (!inPolicyReceiptRef || inPolicyReceiptRef.trim().replace(/\D/g, "").length < 9)) ||
                    (canEditPremium && inPolicyReceiptMethod === "cash" && inPolicyReceiptAmountOverride != null &&
                      Math.abs(parseFloat(inPolicyReceiptAmountOverride) - (displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount) * inPolicyReceiptMonths : 0)) >= 0.01 &&
                      !inPolicyReceiptSubmitterNote.trim())
                  }
                >
                  {(inPolicyReceiptMutation.isPending || pnInitiateMutation.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  <Receipt className="h-4 w-4 mr-2" />
                  {inPolicyReceiptMethod === "cash" ? "Record Payment" : "Send Payment Request"}
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Superuser: confirm delete policy */}
        <AlertDialog open={confirmDeletePolicy} onOpenChange={setConfirmDeletePolicy}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Permanently Delete Policy?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete policy <strong>{displayPolicy?.policyNumber}</strong> and all related records
                including payments, receipts, members, claims, and commission entries. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deletePolicyMutation.mutate(selectedPolicy.id)}
                disabled={deletePolicyMutation.isPending}
              >
                {deletePolicyMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete Permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Superuser: edit payment dialog */}
        <Dialog open={!!editPaymentId} onOpenChange={(open) => { if (!open) setEditPaymentId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Payment Transaction</DialogTitle>
              <DialogDescription>Modify payment details. Changes are audit-logged.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input type="number" step="0.01" value={editPaymentForm.amount} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, amount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editPaymentForm.status} onValueChange={(v) => setEditPaymentForm({ ...editPaymentForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="cleared">Cleared</SelectItem>
                    <SelectItem value="reversed">Reversed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Reference</Label>
                <Input value={editPaymentForm.reference} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, reference: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea value={editPaymentForm.notes} onChange={(e) => setEditPaymentForm({ ...editPaymentForm, notes: e.target.value })} rows={2} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditPaymentId(null)}>Cancel</Button>
              <Button onClick={() => {
                if (!editPaymentId) return;
                editPaymentMutation.mutate({ id: editPaymentId, data: { amount: editPaymentForm.amount, status: editPaymentForm.status, reference: editPaymentForm.reference || null, notes: editPaymentForm.notes || null } });
              }} disabled={editPaymentMutation.isPending}>
                {editPaymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Superuser: confirm delete payment */}
        <AlertDialog open={!!confirmDeletePayment} onOpenChange={(open) => { if (!open) setConfirmDeletePayment(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Payment Transaction?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this payment transaction and any linked receipts. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { if (confirmDeletePayment) deletePaymentMutation.mutate(confirmDeletePayment); }}
                disabled={deletePaymentMutation.isPending}
              >
                {deletePaymentMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Superuser: edit receipt dialog */}
        <Dialog open={!!editReceiptId} onOpenChange={(open) => { if (!open) setEditReceiptId(null); }}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit Receipt</DialogTitle>
              <DialogDescription>Modify receipt details. Changes are audit-logged.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label className="text-xs">Amount</Label>
                <Input type="number" step="0.01" value={editReceiptForm.amount} onChange={(e) => setEditReceiptForm({ ...editReceiptForm, amount: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs">Status</Label>
                <Select value={editReceiptForm.status} onValueChange={(v) => setEditReceiptForm({ ...editReceiptForm, status: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issued">Issued</SelectItem>
                    <SelectItem value="voided">Voided</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Payment Channel</Label>
                <Select value={editReceiptForm.paymentChannel} onValueChange={(v) => setEditReceiptForm({ ...editReceiptForm, paymentChannel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="paynow_ecocash">EcoCash</SelectItem>
                    <SelectItem value="paynow_card">Card</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditReceiptId(null)}>Cancel</Button>
              <Button onClick={() => {
                if (!editReceiptId) return;
                editReceiptMutation.mutate({ id: editReceiptId, data: { amount: editReceiptForm.amount, status: editReceiptForm.status, paymentChannel: editReceiptForm.paymentChannel } });
              }} disabled={editReceiptMutation.isPending}>
                {editReceiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Superuser: confirm delete receipt */}
        <AlertDialog open={!!confirmDeleteReceipt} onOpenChange={(open) => { if (!open) setConfirmDeleteReceipt(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Receipt?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this receipt. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { if (confirmDeleteReceipt) deleteReceiptMutation.mutate(confirmDeleteReceipt); }}
                disabled={deleteReceiptMutation.isPending}
              >
                {deleteReceiptMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">Policies</span>}
          description="Manage policy lifecycles, billing cycles, and status transitions."
          actions={
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5 shadow-sm">
                    <FileDown className="h-4 w-4" /> Blank Forms <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/policy-application"} target="_blank" rel="noopener noreferrer">Policy Application Form</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/waiver-request"} target="_blank" rel="noopener noreferrer">Waiver Request Form</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/debit-order-mandate"} target="_blank" rel="noopener noreferrer">Debit Order Mandate</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={getApiBase() + "/api/forms/blank/claim-submission"} target="_blank" rel="noopener noreferrer">Claim Submission Form</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="gap-2 shadow-sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-policy">
                <Plus className="h-4 w-4" /> Issue New Policy
              </Button>
            </div>
          }
        />

        <CardSection
          flush
          icon={FileText}
          title="Policy Directory"
          description="Search and filter your book of business, then open a policy to work on it."
        >
            {policiesLoading ? (
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
                  {Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6"><div className="flex items-center gap-2"><Skeleton className="h-4 w-4 rounded" /><Skeleton className="h-3.5 w-28" /></div></TableCell>
                      <TableCell><Skeleton className="h-3.5 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                      <TableCell><Skeleton className="h-3.5 w-16" /></TableCell>
                      <TableCell><Skeleton className="h-3.5 w-20" /></TableCell>
                      <TableCell className="text-right pr-6"><Skeleton className="h-8 w-8 rounded ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <div className="px-4 pb-4 pt-2 sm:px-6">
              <EnhancedDataTable<any>
                columns={[
                  {
                    id: "policyNumber",
                    header: "Policy Number",
                    accessor: (p: any) => p.policyNumber,
                    cell: (p: any) => (
                      <div className="flex items-center gap-2 font-medium">
                        <FileText className="h-4 w-4 text-primary/70 shrink-0" />
                        {p.policyNumber}
                        {p.isSouthAfrica && (
                          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-200" data-testid={`badge-south-africa-${p.id}`}>SA</Badge>
                        )}
                      </div>
                    ),
                  },
                  {
                    id: "client",
                    header: "Client",
                    accessor: (p: any) => getClientName(p.clientId),
                  },
                  {
                    id: "status",
                    header: "Status",
                    accessor: (p: any) => p.status,
                    cell: (p: any) => (
                      <Badge variant="outline" className={`font-medium ${getStatusColor(p.status)}`} data-testid={`badge-status-${p.id}`}>
                        {STATUS_LABELS[p.status] || p.status}
                      </Badge>
                    ),
                  },
                  {
                    id: "premium",
                    header: "Premium",
                    accessor: (p: any) => parseFloat(p.premiumAmount) || 0,
                    cell: (p: any) => `${p.currency} ${Number(p.premiumAmount).toFixed(2)}`,
                    cellClassName: "tabular-nums",
                  },
                  {
                    id: "schedule",
                    header: "Schedule",
                    accessor: (p: any) => p.paymentSchedule,
                    cellClassName: "text-muted-foreground capitalize",
                  },
                  {
                    id: "effectiveDate",
                    header: "Effective Date",
                    accessor: (p: any) => p.effectiveDate || "",
                    cellClassName: "text-muted-foreground",
                  },
                  {
                    id: "actions",
                    header: "Actions",
                    align: "right",
                    exportable: false,
                    sortable: false,
                    cell: (policy: any) => (
                      <div onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Policy actions" data-testid={`btn-actions-${policy.id}`}>
                              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(policy)} data-testid={`menu-view-${policy.id}`}>
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => { openDetail(policy); setTimeout(() => openEditDialog(policy), 100); }} data-testid={`menu-edit-${policy.id}`}>
                              <Pencil className="h-4 w-4 mr-2" /> Edit
                            </DropdownMenuItem>
                            {canWritePolicy && (
                              <DropdownMenuItem onClick={() => { openDetail(policy); setTimeout(() => openUpgradeDialog(policy), 100); }} data-testid={`menu-upgrade-${policy.id}`}>
                                <ArrowRightLeft className="h-4 w-4 mr-2" /> Upgrade Product
                              </DropdownMenuItem>
                            )}
                            {!isAgent && (VALID_POLICY_TRANSITIONS[policy.status] || []).length > 0 && (
                              <>
                                <DropdownMenuSeparator />
                                {VALID_POLICY_TRANSITIONS[policy.status]?.map((t) => (
                                  <DropdownMenuItem key={t} onClick={() => { setSelectedPolicy(policy); setTransitionTarget(t); setTransitionReason(""); setShowTransitionDialog(true); }} data-testid={`menu-transition-${policy.id}-${t}`}>
                                    <ArrowRightLeft className="h-4 w-4 mr-2" /> → {STATUS_LABELS[t] || t}
                                  </DropdownMenuItem>
                                ))}
                              </>
                            )}
                            {canDeletePolicy && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => { setSelectedPolicy(policy); setConfirmDeletePolicy(true); }} data-testid={`menu-delete-${policy.id}`}>
                                  <Trash2 className="h-4 w-4 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    ),
                  },
                ]}
                rows={filteredPolicies}
                getRowKey={(p: any) => p.id}
                searchable={false}
                exportable
                exportFilename="policies"
                storageKey="policies-list"
                onRowClick={openDetail}
                rowTestId={(p: any) => `row-policy-${p.id}`}
                emptyMessage={policies?.length === 0 ? "No policies yet" : "No matching policies"}
                toolbarExtra={
                  <>
                    <div className="relative w-full sm:w-72 lg:w-64">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search policies..."
                        className="pl-9 bg-background h-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        data-testid="input-search-policies"
                      />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full sm:w-40 shrink-0 h-9" data-testid="select-status-filter">
                        <Filter className="h-4 w-4 mr-2 shrink-0" />
                        <SelectValue placeholder="All Statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="grace">Grace</SelectItem>
                        <SelectItem value="lapsed">Lapsed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={countryFilter} onValueChange={setCountryFilter}>
                      <SelectTrigger className="w-full sm:w-40 shrink-0 h-9" data-testid="select-country-filter">
                        <SelectValue placeholder="All Countries" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Countries</SelectItem>
                        <SelectItem value="zimbabwe">Zimbabwe</SelectItem>
                        <SelectItem value="south_africa">South Africa</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                }
              />
              </div>
            )}
        </CardSection>
      </PageShell>

      <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) setCreateStep(1); }}>
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
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">First Name *</Label>
                          <Input
                            value={createForm.newClient.firstName}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, firstName: e.target.value } })}
                            onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, firstName: toUpper(e.target.value) } })}
                            placeholder="First name"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Last Name *</Label>
                          <Input
                            value={createForm.newClient.lastName}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, lastName: e.target.value } })}
                            onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, lastName: toUpper(e.target.value) } })}
                            placeholder="Last name"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Phone *</Label>
                          <Input
                            value={createForm.newClient.phone}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, phone: e.target.value } })}
                            onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, phone: toUpper(e.target.value) } })}
                            placeholder="Phone number"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Email</Label>
                          <Input
                            type="email"
                            value={createForm.newClient.email}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, email: e.target.value } })}
                            placeholder="Email address"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">National ID *</Label>
                          <Input
                            value={createForm.newClient.nationalId}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, nationalId: e.target.value } })}
                            onBlur={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, nationalId: toUpper(e.target.value) } })}
                            placeholder="e.g. 08833089H38"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Date of Birth *</Label>
                          <Input
                            type="date"
                            value={createForm.newClient.dateOfBirth}
                            onChange={(e) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, dateOfBirth: e.target.value } })}
                          />
                        </div>
                        <div>
                          <Label className="text-xs">Gender *</Label>
                          <Select
                            value={createForm.newClient.gender}
                            onValueChange={(v) => setCreateForm({ ...createForm, newClient: { ...createForm.newClient, gender: v } })}
                          >
                            <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="male">Male</SelectItem>
                              <SelectItem value="female">Female</SelectItem>
                              <SelectItem value="other">Other</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2">
                          <Label className="text-xs">Physical Address</Label>
                          <Input
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
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs">First Name *</Label>
                            <Input value={newDep.firstName} onChange={(e) => setNewDep({ ...newDep, firstName: e.target.value })} onBlur={(e) => setNewDep({ ...newDep, firstName: toUpper(e.target.value) })} placeholder="First name" />
                          </div>
                          <div>
                            <Label className="text-xs">Last Name *</Label>
                            <Input value={newDep.lastName} onChange={(e) => setNewDep({ ...newDep, lastName: e.target.value })} onBlur={(e) => setNewDep({ ...newDep, lastName: toUpper(e.target.value) })} placeholder="Last name" />
                          </div>
                          <div>
                            <Label className="text-xs">Relationship *</Label>
                            <Select value={newDep.relationship} onValueChange={(v) => setNewDep({ ...newDep, relationship: v })}>
                              <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
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
                        <div className="grid grid-cols-2 gap-3">
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
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Override premium ({createForm.currency})</Label>
                      <Input
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
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Currency</Label>
                    <CurrencySelect value={createForm.currency} onValueChange={(v) => setCreateForm({ ...createForm, currency: v })} />
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
                      <p className="text-xs text-muted-foreground">This policy was captured from a prior system. It will be automatically activated with no waiting period.</p>
                    </div>
                  </div>
                )}
                <div className="flex items-start gap-3 border rounded-md p-3">
                  <Checkbox
                    id="create-south-africa-flag"
                    checked={createForm.isSouthAfrica}
                    onCheckedChange={(v) => setCreateForm({ ...createForm, isSouthAfrica: !!v })}
                    data-testid="checkbox-is-south-africa"
                  />
                  <div className="space-y-1 leading-none">
                    <label htmlFor="create-south-africa-flag" className="text-sm font-medium cursor-pointer">South Africa-based policy</label>
                    <p className="text-xs text-muted-foreground">Client is based in South Africa (currency alone doesn't always indicate this — some SA clients pay in USD). Leave unchecked for Zimbabwe-based policies.</p>
                  </div>
                </div>
                {createForm.isSouthAfrica && (
                  <div>
                    <Label>RSA Policy Number / Reference</Label>
                    <Input
                      value={createForm.externalReference}
                      onChange={(e) => setCreateForm({ ...createForm, externalReference: e.target.value })}
                      placeholder="e.g. the South Africa branch's own policy number"
                      data-testid="input-external-reference"
                    />
                  </div>
                )}
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
                    <Label>Mobile Number</Label>
                    <Input
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
              <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
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

      <AlertDialog open={confirmDeletePolicy && !showDetailView} onOpenChange={setConfirmDeletePolicy}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently Delete Policy?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete policy <strong>{selectedPolicy?.policyNumber}</strong> and all related records
              including payments, receipts, members, claims, and commission entries. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => selectedPolicy && deletePolicyMutation.mutate(selectedPolicy.id)}
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
