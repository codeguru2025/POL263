import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClientSearchInput } from "@/components/client-search-input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useState, useMemo, useEffect } from "react";
import { Plus, Search, Filter, MoreHorizontal, FileText, ArrowRightLeft, Users, CreditCard, Loader2, ChevronLeft, Eye, Download, UserPlus, X, CalendarDays, ShieldCheck, Clock, Receipt, Printer } from "lucide-react";
import { printDocument } from "@/lib/print-document";
import { useSearch } from "wouter";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/hooks/use-auth";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

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
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, roles, permissions } = useAuth();
  const safeRoles = Array.isArray(roles) ? roles : [];
  const safePermissions = Array.isArray(permissions) ? permissions : [];
  const isAgent = safeRoles.some((r: any) => r.name === "agent");
  const canWriteFinance = safePermissions.includes("write:finance");

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState<string>("all");
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
  const [pnIntentId, setPnIntentId] = useState<string | null>(null);
  const [pnPolling, setPnPolling] = useState(false);
  const [pnInnbucksCode, setPnInnbucksCode] = useState("");
  const [pnInnbucksExpiry, setPnInnbucksExpiry] = useState("");
  const [pnNeedsOtp, setPnNeedsOtp] = useState(false);
  const [pnOtpRef, setPnOtpRef] = useState("");
  const [pnOtp, setPnOtp] = useState("");
  const [pnPhase, setPnPhase] = useState<"select" | "waiting">("select");
  const [showEstatementViewer, setShowEstatementViewer] = useState(false);
  const [estatementViewerUrl, setEstatementViewerUrl] = useState<string>("");

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
    selectedAddOns: [] as string[],
    memberAddOns: {} as Record<string, string[]>,
    newClient: { firstName: "", lastName: "", phone: "", email: "", nationalId: "", dateOfBirth: "", gender: "" },
  });
  const [createStep, setCreateStep] = useState(1);
  const [clientMode, setClientMode] = useState<"search" | "new">("search");

  const searchString = useSearch();
  useEffect(() => {
    const params = new URLSearchParams(searchString);
    if (params.get("create") === "1") {
      const clientId = params.get("clientId") || "";
      setShowCreateDialog(true);
      setCreateForm((f) => ({ ...f, clientId }));
    }
  }, [searchString]);

  useEffect(() => {
    if (isAgent && user?.id) {
      setCreateForm((f) => ({ ...f, agentId: user.id }));
    }
  }, [isAgent, user?.id]);

  const policiesQueryUrl = debouncedSearch
    ? `/api/policies?q=${encodeURIComponent(debouncedSearch)}`
    : "/api/policies";

  const { data: policies, isLoading: policiesLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", { q: debouncedSearch }],
    queryFn: async () => {
      const res = await fetch(getApiBase() + policiesQueryUrl, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 403) return [];
        throw new Error("Failed to fetch policies");
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: clients } = useQuery<any[]>({
    queryKey: ["/api/clients"],
  });
  const { data: agents = [] } = useQuery<any[]>({
    queryKey: ["/api/agents"],
  });

  const { data: selectedClient } = useQuery<any>({
    queryKey: ["/api/clients", createForm.clientId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${createForm.clientId}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!createForm.clientId,
  });

  const { data: products } = useQuery<any[]>({
    queryKey: ["/api/products"],
  });

  const { data: addOns } = useQuery<any[]>({
    queryKey: ["/api/add-ons"],
  });

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
    if (dependents && dependents.length > 0) {
      setCreateForm((f) => ({ ...f, beneficiaryDependentIds: dependents.map((d: any) => d.id) }));
    }
  }, [dependents]);

  const [showAddDep, setShowAddDep] = useState(false);
  const [newDep, setNewDep] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });

  const [detailAddDepOpen, setDetailAddDepOpen] = useState(false);
  const [detailDepForm, setDetailDepForm] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
  const [membersAgeFilter, setMembersAgeFilter] = useState<"all" | "adult" | "child">("all");
  const detailAddDepMutation = useMutation({
    mutationFn: async (data: typeof detailDepForm) => {
      if (!selectedPolicy) throw new Error("No policy selected");
      const res = await apiRequest("POST", `/api/clients/${selectedPolicy.clientId}/dependents`, data);
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
      const res = await apiRequest("POST", `/api/clients/${createForm.clientId}/dependents`, data);
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
    return (base + addOnTotal).toFixed(2);
  }, [selectedVersion, createForm.currency, createForm.paymentSchedule, createForm.memberAddOns, addOns]);

  const { data: policyDetail } = useQuery<any>({
    queryKey: ["/api/policies", selectedPolicy?.id, "detail"],
    enabled: !!selectedPolicy?.id && showDetailView,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}`, { credentials: "include" });
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

  const createMutation = useMutation({
    mutationFn: async (data: typeof createForm) => {
      let clientId = data.clientId;

      if (clientMode === "new" && !clientId) {
        if (!data.newClient.firstName || !data.newClient.lastName) {
          throw new Error("First name and last name are required to create a new client.");
        }
        if (!data.newClient.nationalId?.trim()) throw new Error("National ID is required (format: digits + check letter + 2 digits, e.g. 08833089H38).");
        if (!isValidNationalId(data.newClient.nationalId)) throw new Error("National ID must be digits, one letter, then two digits (e.g. 08833089H38).");
        if (!data.newClient.phone?.trim()) throw new Error("Phone is required.");
        if (!data.newClient.dateOfBirth) throw new Error("Date of birth is required.");
        if (!data.newClient.gender) throw new Error("Gender is required.");
        const clientRes = await apiRequest("POST", "/api/clients", {
          firstName: toUpper(data.newClient.firstName),
          lastName: toUpper(data.newClient.lastName),
          phone: data.newClient.phone ? toUpper(data.newClient.phone) : undefined,
          email: data.newClient.email?.trim() || undefined,
          nationalId: data.newClient.nationalId ? toUpper(data.newClient.nationalId) : undefined,
          dateOfBirth: data.newClient.dateOfBirth || undefined,
          gender: data.newClient.gender ? toUpper(data.newClient.gender) : undefined,
        });
        const newClient = await clientRes.json();
        clientId = newClient.id;
      }

      const members = (data.beneficiaryDependentIds || []).map((dependentId: string) => ({ dependentId, role: "dependent" }));

      const memberAddOns: { memberRef: string; addOnId: string }[] = [];
      for (const [memberRef, aoIds] of Object.entries(data.memberAddOns || {})) {
        for (const addOnId of aoIds) {
          memberAddOns.push({ memberRef, addOnId });
        }
      }

      let beneficiary: any = undefined;
      if (data.beneficiaryId) {
        const dep = dependents?.find((d: any) => d.id === data.beneficiaryId);
        if (dep) {
          beneficiary = {
            dependentId: dep.id,
            firstName: dep.firstName,
            lastName: dep.lastName,
            relationship: dep.relationship,
            nationalId: dep.nationalId || "",
            phone: "",
          };
        }
      } else if (data.beneficiaryManual.firstName && data.beneficiaryManual.lastName) {
        if (!data.beneficiaryManual.relationship?.trim() || !data.beneficiaryManual.nationalId?.trim() || !data.beneficiaryManual.phone?.trim()) {
          throw new Error("Beneficiary: all fields are required (first name, last name, relationship, national ID, phone).");
        }
        if (!isValidNationalId(data.beneficiaryManual.nationalId)) {
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

      const res = await apiRequest("POST", "/api/policies", {
        clientId,
        agentId: data.agentId || undefined,
        productVersionId: data.productVersionId,
        premiumAmount: data.premiumAmount,
        currency: data.currency,
        paymentSchedule: data.paymentSchedule,
        effectiveDate: data.effectiveDate || undefined,
        members,
        memberAddOns,
        beneficiary,
      });
      return res.json();
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
        selectedAddOns: [],
        memberAddOns: {},
        newClient: { firstName: "", lastName: "", phone: "", email: "", nationalId: "", dateOfBirth: "", gender: "" },
      });
      toast({ title: "Policy created", description: `Policy ${policy.policyNumber} has been created in inactive status.` });
    },
    onError: (err: Error) => {
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

  const resetPnState = () => {
    setPnIntentId(null); setPnPolling(false); setPnInnbucksCode(""); setPnInnbucksExpiry("");
    setPnNeedsOtp(false); setPnOtpRef(""); setPnOtp(""); setPnPhase("select");
    setInPolicyReceiptMethod("cash"); setInPolicyReceiptRef(""); setInPolicyReceiptNotes("");
  };

  const inPolicyReceiptMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      if (selectedPolicy) queryClient.invalidateQueries({ queryKey: [`/api/policies/${selectedPolicy.id}/payments`] });
      setShowInPolicyReceiptDialog(false);
      resetPnState();
      toast({ title: "Payment recorded", description: "Receipt generated successfully." });
    },
    onError: (err: Error) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  const pnInitiateMutation = useMutation({
    mutationFn: async () => {
      const dp = displayPolicy;
      if (!dp) throw new Error("No policy");
      const amt = dp.premiumAmount ? parseFloat(dp.premiumAmount).toFixed(2) : "0";
      const intentRes = await apiRequest("POST", "/api/payment-intents", {
        policyId: selectedPolicy.id, clientId: dp.clientId, amount: amt, currency: inPolicyReceiptCurrency, purpose: "premium",
      });
      const intent = await intentRes.json();
      if (intent.message) throw new Error(intent.message);
      setPnIntentId(intent.id);
      const initRes = await apiRequest("POST", `/api/payment-intents/${intent.id}/initiate`, {
        method: inPolicyReceiptMethod,
        payerPhone: ["ecocash", "onemoney", "innbucks", "omari"].includes(inPolicyReceiptMethod) ? inPolicyReceiptRef : undefined,
        payerEmail: inPolicyReceiptMethod === "visa_mastercard" ? inPolicyReceiptRef : undefined,
      });
      return initRes.json() as Promise<{
        redirectUrl?: string; pollUrl?: string; message?: string;
        innbucksCode?: string; innbucksExpiry?: string;
        omariOtpReference?: string; needsOtp?: boolean;
      }>;
    },
    onSuccess: (data) => {
      if (data.message) { toast({ title: "Error", description: data.message, variant: "destructive" }); return; }
      setPnPhase("waiting");
      if (inPolicyReceiptMethod === "innbucks" && data.innbucksCode) {
        setPnInnbucksCode(data.innbucksCode); setPnInnbucksExpiry(data.innbucksExpiry || ""); setPnPolling(true);
        toast({ title: "InnBucks code ready" }); return;
      }
      if (inPolicyReceiptMethod === "omari" && data.needsOtp) {
        setPnNeedsOtp(true); setPnOtpRef(data.omariOtpReference || "");
        toast({ title: "OTP sent", description: "Ask the client for the OTP." }); return;
      }
      if (data.redirectUrl) { window.open(data.redirectUrl, "_blank"); setPnPolling(true); toast({ title: "Card payment page opened" }); return; }
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
        setShowInPolicyReceiptDialog(false); resetPnState();
        toast({ title: "Payment successful" });
      } else { setPnPolling(true); setPnNeedsOtp(false); toast({ title: "OTP accepted", description: "Processing..." }); }
    },
    onError: (e: Error) => toast({ title: "OTP failed", description: e.message, variant: "destructive" }),
  });

  const { data: pnPollData } = useQuery({
    queryKey: ["pn-poll-policy", pnIntentId],
    queryFn: async () => {
      if (!pnIntentId) return null;
      const res = await apiRequest("POST", `/api/payment-intents/${pnIntentId}/poll`, {});
      return res.json() as Promise<{ status: string; paid?: boolean }>;
    },
    enabled: !!pnIntentId && pnPolling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (!pnPollData) return;
    if (pnPollData.paid || pnPollData.status === "paid") {
      setPnPolling(false);
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setShowInPolicyReceiptDialog(false); resetPnState();
      toast({ title: "Payment successful", description: "Paynow payment confirmed." });
    }
    if (pnPollData.status === "failed") { setPnPolling(false); toast({ title: "Payment failed", variant: "destructive" }); }
  }, [pnPollData]);

  const filteredPolicies = useMemo(() => {
    const list = Array.isArray(policies) ? policies : [];
    return list.filter((p: any) => {
      const matchesStatus = statusFilter === "all" || p.status === statusFilter;
      return matchesStatus;
    });
  }, [policies, statusFilter]);

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients?.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const getClientName = (clientId: string) => {
    const c = clientMap[clientId];
    return c ? `${c.firstName} ${c.lastName}` : clientId?.slice(0, 8) + "...";
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

  if (showDetailView && selectedPolicy) {
    const allowedTransitions = VALID_POLICY_TRANSITIONS[displayPolicy.status] || [];
    return (
      <StaffLayout>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => { setShowDetailView(false); setSelectedPolicy(null); }} data-testid="btn-back-policies">
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="flex-1">
              <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-policy-number">{displayPolicy.policyNumber}</h1>
              <p className="text-muted-foreground mt-1">Policy details, members, and payment history</p>
            </div>
            <Badge variant="outline" className={`font-medium text-sm px-3 py-1 ${getStatusColor(displayPolicy.status)}`} data-testid="badge-policy-status">
              {STATUS_LABELS[displayPolicy.status] || displayPolicy.status}
            </Badge>
            {!isAgent && allowedTransitions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-2" data-testid="btn-transition-policy">
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
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => window.open(getApiBase() + `/api/policies/${selectedPolicy.id}/document?lang=${docLang}`, "_blank", "noopener")}
              data-testid="btn-download-policy-doc"
            >
              <Download className="h-4 w-4" /> Policy document
            </Button>
            <Button
              variant="outline"
              size="icon"
              title="Print policy document"
              onClick={() => printDocument(getApiBase() + `/api/policies/${selectedPolicy.id}/document?lang=${docLang}`)}
              data-testid="btn-print-policy-doc"
            >
              <Printer className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => window.open(getApiBase() + `/api/policies/${selectedPolicy.id}/estatement`, "_blank", "noopener")}
              data-testid="btn-download-estatement"
            >
              <FileText className="h-4 w-4" /> E-Statement
            </Button>
            {(canWriteFinance || isAgent) && (
              <Button
                className="gap-2"
                onClick={() => {
                  setInPolicyReceiptMethod(isAgent ? "ecocash" : "cash");
                  setInPolicyReceiptCurrency(displayPolicy.premiumCurrency || "USD");
                  const clientPhone = displayPolicy.clientId ? (clientMap[displayPolicy.clientId]?.phone || "").trim() : "";
                  setInPolicyReceiptRef(clientPhone);
                  setInPolicyReceiptNotes("");
                  setShowInPolicyReceiptDialog(true);
                }}
                data-testid="btn-receipt-policy"
              >
                <Receipt className="h-4 w-4" /> Receipt Payment
              </Button>
            )}
          </div>

          <Card className="shadow-sm border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><CalendarDays className="h-4 w-4 text-primary" /> Policy Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-4 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Premium</p>
                  <p className="text-lg font-bold" data-testid="text-premium-amount">{displayPolicy.currency} {Number(displayPolicy.premiumAmount).toFixed(2)}</p>
                  <p className="text-xs text-muted-foreground capitalize">{displayPolicy.paymentSchedule}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Client</p>
                  <p className="font-semibold" data-testid="text-policy-client">{getClientName(displayPolicy.clientId)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Product</p>
                  <p className="font-semibold">{displayPolicy.productName || "—"}</p>
                  {displayPolicy.productVersionLabel && <p className="text-xs text-muted-foreground">{displayPolicy.productVersionLabel}</p>}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Capture Date</p>
                  <p className="font-semibold">{displayPolicy.createdAt ? new Date(displayPolicy.createdAt).toLocaleDateString() : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Effective Date</p>
                  <p className="font-semibold" data-testid="text-effective-date">{displayPolicy.effectiveDate || "Not set"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Inception Date</p>
                  <p className="font-semibold">{displayPolicy.inceptionDate || "Not set"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Waiting Period</p>
                  {displayPolicy.waitingPeriodEndDate ? (() => {
                    const endDate = new Date(displayPolicy.waitingPeriodEndDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    endDate.setHours(0, 0, 0, 0);
                    const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    return daysRemaining > 0 ? (
                      <p className="font-semibold text-amber-600">{daysRemaining} days remaining</p>
                    ) : (
                      <p className="font-semibold text-emerald-600">Completed</p>
                    );
                  })() : (
                    <p className="font-semibold">{displayPolicy.waitingPeriodDays != null ? `${displayPolicy.waitingPeriodDays} days` : "—"}</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Waiting Period End</p>
                  <p className="font-semibold">{displayPolicy.waitingPeriodEndDate ? new Date(displayPolicy.waitingPeriodEndDate).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Grace Period</p>
                  {displayPolicy.graceEndDate ? (() => {
                    const endDate = new Date(displayPolicy.graceEndDate);
                    const today = new Date();
                    today.setHours(0, 0, 0, 0);
                    endDate.setHours(0, 0, 0, 0);
                    const daysRemaining = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                    return daysRemaining > 0 ? (
                      <p className="font-semibold text-amber-600">{daysRemaining} days remaining</p>
                    ) : (
                      <p className="font-semibold text-emerald-600">Completed</p>
                    );
                  })() : (
                    <p className="font-semibold">—</p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Claimability</p>
                  <Badge variant="outline" className={displayPolicy.claimable ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}>
                    {displayPolicy.claimable ? "Claimable" : "Not claimable"}
                  </Badge>
                  {displayPolicy.claimableReason && <p className="text-xs text-muted-foreground mt-1">{displayPolicy.claimableReason}</p>}
                </div>
                {displayPolicy.clientActivationCode && (
                  <div>
                    <p className="text-muted-foreground text-xs">Activation Code</p>
                    <div className="flex items-center gap-2">
                      <p className="font-mono font-bold text-primary" data-testid="text-activation-code">{displayPolicy.clientActivationCode}</p>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-xs"
                        onClick={() => {
                          navigator.clipboard.writeText(displayPolicy.clientActivationCode);
                          toast({ title: "Copied", description: "Activation code copied to clipboard." });
                        }}
                      >
                        Copy
                      </Button>
                    </div>
                    <p className="text-[10px] text-muted-foreground">Client has not yet claimed their portal account.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Policy Members</CardTitle>
                  <CardDescription>All lives covered (policy holder + dependants). Filter by age band.</CardDescription>
                </div>
                <div className="flex gap-2 flex-wrap items-center">
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
                    onClick={() => {
                      setDetailAddDepOpen(true);
                      setDetailDepForm({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
                    }}
                  >
                    <UserPlus className="h-3.5 w-3.5" /> Add Dependent
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
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
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Member</TableHead>
                      <TableHead>Relationship</TableHead>
                      <TableHead>National ID</TableHead>
                      <TableHead>DOB</TableHead>
                      <TableHead>Age</TableHead>
                      <TableHead>Gender</TableHead>
                      <TableHead>Capture Date</TableHead>
                      <TableHead>Inception</TableHead>
                      <TableHead>Cover Date</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Claimable</TableHead>
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
                        <TableCell className="font-mono text-sm">{m.nationalId || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.dateOfBirth || "—"}</TableCell>
                        <TableCell className="text-sm">{m.age != null ? m.age : "—"}</TableCell>
                        <TableCell className="text-sm capitalize">{m.gender || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.captureDate || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">{m.inceptionDate || "—"}</TableCell>
                        <TableCell className="text-sm whitespace-nowrap">
                          {m.coverDate || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {m.waitingPeriodEndDate ? (() => {
                            const end = new Date(m.waitingPeriodEndDate);
                            const now = new Date(); now.setHours(0,0,0,0); end.setHours(0,0,0,0);
                            const d = Math.ceil((end.getTime() - now.getTime()) / 86400000);
                            return d > 0 ? <span className="text-xs text-amber-600">{d}d left</span> : <span className="text-xs text-emerald-600">Done</span>;
                          })() : m.waitingPeriodDays != null ? <span className="text-xs">{m.waitingPeriodDays}d</span> : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={
                            m.effectiveStatus === "active" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" :
                            m.effectiveStatus === "grace" ? "bg-amber-500/15 text-amber-700 border-amber-200" :
                            m.effectiveStatus === "lapsed" ? "bg-red-500/15 text-red-700 border-red-200" :
                            m.effectiveStatus === "cancelled" ? "bg-gray-500/15 text-gray-600 border-gray-200" :
                            m.effectiveStatus === "removed" ? "bg-gray-500/15 text-gray-600 border-gray-200" :
                            "bg-blue-500/15 text-blue-700 border-blue-200"
                          }>
                            {m.effectiveStatus === "active" ? "Active" :
                             m.effectiveStatus === "grace" ? "Grace" :
                             m.effectiveStatus === "lapsed" ? "Lapsed" :
                             m.effectiveStatus === "cancelled" ? "Cancelled" :
                             m.effectiveStatus === "removed" ? "Removed" :
                             "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className={m.claimable ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                              {m.claimable ? "Yes" : "No"}
                            </Badge>
                            {m.claimableReason && <span className="text-[10px] text-muted-foreground leading-tight max-w-[140px]">{m.claimableReason}</span>}
                          </div>
                        </TableCell>
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
            </CardContent>
          </Card>

          {displayPolicy.beneficiaryFirstName && (
            <Card className="shadow-sm border-border/60">
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-primary" /> Beneficiary</CardTitle>
                <CardDescription>Designated beneficiary for this policy</CardDescription>
              </CardHeader>
              <CardContent>
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
                    <p className="font-medium font-mono">{displayPolicy.beneficiaryNationalId || "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground text-xs">Phone</p>
                    <p className="font-medium">{displayPolicy.beneficiaryPhone || "—"}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5 text-primary" /> Payment History</CardTitle>
              <CardDescription>Transactions recorded against this policy</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {paymentsLoading ? (
                <div className="p-6 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (policyPayments ?? []).length > 0 ? (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Date</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Reference</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(policyPayments ?? []).map((p: any) => (
                      <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                        <TableCell className="pl-6">{p.postedDate || new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        <TableCell className="font-medium">{p.currency} {Number(p.amount).toFixed(2)}</TableCell>
                        <TableCell>{p.paymentMethod}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={p.status === "cleared" ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                            {p.status === "cleared" ? "Receipted" : p.status === "reversed" ? "Reversed" : p.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{p.reference || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <div className="p-6 text-center text-muted-foreground" data-testid="text-no-payments">No payments recorded for this policy.</div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border/60">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> E-Statement</CardTitle>
              <CardDescription>View or download a statement PDF with policy summary and payment history (optionally filter by date range).</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                    const from = (document.getElementById("estatement-dateFrom") as HTMLInputElement)?.value;
                    const to = (document.getElementById("estatement-dateTo") as HTMLInputElement)?.value;
                    let url = getApiBase() + `/api/policies/${selectedPolicy.id}/estatement`;
                    const params = new URLSearchParams();
                    params.set("inline", "1");
                    if (from) params.set("dateFrom", from);
                    if (to) params.set("dateTo", to);
                    setShowEstatementViewer(true);
                    setEstatementViewerUrl(url + "?" + params.toString());
                  }}
                  data-testid="btn-view-estatement"
                >
                  <Eye className="h-4 w-4" /> View
                </Button>
                <Button
                  variant="default"
                  className="gap-2"
                  onClick={() => {
                    const from = (document.getElementById("estatement-dateFrom") as HTMLInputElement)?.value;
                    const to = (document.getElementById("estatement-dateTo") as HTMLInputElement)?.value;
                    let url = getApiBase() + `/api/policies/${selectedPolicy.id}/estatement`;
                    const params = new URLSearchParams();
                    if (from) params.set("dateFrom", from);
                    if (to) params.set("dateTo", to);
                    if (params.toString()) url += "?" + params.toString();
                    window.open(url, "_blank", "noopener");
                  }}
                  data-testid="btn-download-estatement-card"
                >
                  <Download className="h-4 w-4" /> Download
                </Button>
                <Button
                  variant="outline"
                  className="gap-2"
                  onClick={() => {
                    const from = (document.getElementById("estatement-dateFrom") as HTMLInputElement)?.value;
                    const to = (document.getElementById("estatement-dateTo") as HTMLInputElement)?.value;
                    let url = getApiBase() + `/api/policies/${selectedPolicy.id}/estatement`;
                    const params = new URLSearchParams();
                    if (from) params.set("dateFrom", from);
                    if (to) params.set("dateTo", to);
                    if (params.toString()) url += "?" + params.toString();
                    printDocument(url);
                  }}
                  data-testid="btn-print-estatement"
                >
                  <Printer className="h-4 w-4" /> Print
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">Leave dates empty for full payment history. Uses tenant logo and signature from Settings.</p>
            </CardContent>
          </Card>

          <Dialog open={showEstatementViewer} onOpenChange={setShowEstatementViewer}>
            <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
              <DialogHeader>
                <DialogTitle>E-Statement</DialogTitle>
                <DialogDescription>View your statement below. Use Download to save a copy.</DialogDescription>
              </DialogHeader>
              <div className="flex-1 min-h-0 flex flex-col gap-3">
                {estatementViewerUrl && (
                  <iframe
                    title="E-Statement"
                    src={estatementViewerUrl}
                    className="w-full flex-1 min-h-[60vh] border rounded-md"
                  />
                )}
                <div className="flex justify-end gap-2">
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => {
                      const u = new URL(estatementViewerUrl);
                      u.searchParams.delete("inline");
                      window.open(u.toString(), "_blank", "noopener");
                    }}
                  >
                    <Download className="h-4 w-4" /> Download
                  </Button>
                  <Button variant="outline" onClick={() => setShowEstatementViewer(false)}>Close</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>

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

        <Dialog open={showInPolicyReceiptDialog} onOpenChange={setShowInPolicyReceiptDialog}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Receipt Payment</DialogTitle>
              <DialogDescription>
                Record a payment for policy <strong>{displayPolicy.policyNumber}</strong>
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs">Amount</Label>
                  <Input
                    type="number"
                    value={displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount).toFixed(2) : "0.00"}
                    readOnly
                    className="bg-muted cursor-not-allowed"
                  />
                </div>
                <div>
                  <Label className="text-xs">Currency</Label>
                  <Select value={inPolicyReceiptCurrency} onValueChange={setInPolicyReceiptCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="ZAR">ZAR</SelectItem>
                      <SelectItem value="ZWL">ZWL</SelectItem>
                      <SelectItem value="BWP">BWP</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
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
                        {inPolicyReceiptMethod === "visa_mastercard" ? "Waiting for card payment..." : "Waiting for client approval..."}
                      </p>
                      <p className="text-sm text-green-800">
                        {inPolicyReceiptMethod === "visa_mastercard"
                          ? "Client should complete payment in the card page."
                          : "EcoCash/OneMoney use USSD — the client should see a prompt on their phone to enter their PIN. If nothing appears within 30 seconds, check the mobile number is correct (e.g. 0771234567) and try again."}
                      </p>
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
                      inPolicyReceiptMutation.mutate({
                        policyId: selectedPolicy.id,
                        clientId: displayPolicy.clientId,
                        amount: displayPolicy.premiumAmount ? parseFloat(displayPolicy.premiumAmount).toFixed(2) : "0",
                        currency: inPolicyReceiptCurrency,
                        paymentMethod: inPolicyReceiptMethod,
                        status: "cleared",
                        reference: inPolicyReceiptRef || undefined,
                        notes: inPolicyReceiptNotes || undefined,
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
                    (["ecocash", "onemoney"].includes(inPolicyReceiptMethod) && (!inPolicyReceiptRef || inPolicyReceiptRef.trim().replace(/\D/g, "").length < 9))
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
      </StaffLayout>
    );
  }

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Policies</h1>
            <p className="text-muted-foreground mt-1">Manage policy lifecycles, billing cycles, and status transitions.</p>
          </div>
          <Button className="gap-2 shadow-sm" onClick={() => setShowCreateDialog(true)} data-testid="btn-create-policy">
            <Plus className="h-4 w-4" /> Issue New Policy
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Policy Directory</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by policy number, name, ID, phone..."
                    className="pl-9 bg-background"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    data-testid="input-search-policies"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-40" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2" />
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
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {policiesLoading ? (
              <div className="p-6 space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : filteredPolicies.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground" data-testid="text-no-policies">
                {policies?.length === 0 ? "No policies found. Create your first policy to get started." : "No policies match your search criteria."}
              </div>
            ) : (
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
                  {filteredPolicies.map((policy: any) => (
                    <TableRow key={policy.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => openDetail(policy)} data-testid={`row-policy-${policy.id}`}>
                      <TableCell className="font-medium pl-6">
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-primary/70" />
                          {policy.policyNumber}
                        </div>
                      </TableCell>
                      <TableCell data-testid={`text-client-${policy.id}`}>{getClientName(policy.clientId)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-medium ${getStatusColor(policy.status)}`} data-testid={`badge-status-${policy.id}`}>
                          {STATUS_LABELS[policy.status] || policy.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{policy.currency} {Number(policy.premiumAmount).toFixed(2)}</TableCell>
                      <TableCell className="text-muted-foreground capitalize">{policy.paymentSchedule}</TableCell>
                      <TableCell className="text-muted-foreground">{policy.effectiveDate || "—"}</TableCell>
                      <TableCell className="text-right pr-6" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`btn-actions-${policy.id}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openDetail(policy)} data-testid={`menu-view-${policy.id}`}>
                              <Eye className="h-4 w-4 mr-2" /> View Details
                            </DropdownMenuItem>
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
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={showCreateDialog} onOpenChange={(open) => { setShowCreateDialog(open); if (!open) setCreateStep(1); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Issue New Policy</DialogTitle>
            <DialogDescription>
              {createStep === 1 && "Select an existing lead or create a new client. A client record is auto-created if needed."}
              {createStep === 2 && "Select product and version for this tenant."}
              {createStep === 3 && "Select add-ons (optional)."}
              {createStep === 4 && "Review premium and save. A unique policy number will be generated."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
                        onClick={() => { setClientMode("new"); setCreateForm((f) => ({ ...f, clientId: "" })); }}
                      >
                        New Client
                      </Button>
                    </div>
                  </div>
                  {clientMode === "search" ? (
                    <>
                      <ClientSearchInput
                        value={createForm.clientId}
                        onChange={(id) => setCreateForm({ ...createForm, clientId: id, beneficiaryDependentIds: [] })}
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
                        <p className="text-xs text-muted-foreground">All fields required except National ID. Text stored in uppercase.</p>
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
                            <Label className="text-xs">Date of Birth *</Label>
                            <Input type="date" value={newDep.dateOfBirth} onChange={(e) => setNewDep({ ...newDep, dateOfBirth: e.target.value })} />
                          </div>
                          <div>
                            <Label className="text-xs">Gender *</Label>
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
                            disabled={!newDep.firstName?.trim() || !newDep.lastName?.trim() || !newDep.relationship || !newDep.dateOfBirth || !newDep.gender || addDepMutation.isPending}
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
            {createStep === 2 && (() => {
              const activeVersion = productVersions?.find((v: any) => v.isActive);
              if (activeVersion && !createForm.productVersionId) {
                setTimeout(() => setCreateForm((f) => ({ ...f, productVersionId: activeVersion.id })), 0);
              }
              return (
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
                      {activeVersion ? (
                        <>
                          <Input
                            readOnly
                            disabled
                            className="bg-muted"
                            value={`Version ${activeVersion.version ?? activeVersion.versionNumber ?? ""}${activeVersion.effectiveFrom ? ` (from ${activeVersion.effectiveFrom})` : ""} — Active`}
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
              );
            })()}
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
                <div className="rounded-md bg-muted/50 p-3">
                  <p className="text-sm font-medium">
                    Premium (from product & add-ons): {createForm.currency} {calculatedPremium ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Premium is calculated from the selected product version and add-ons; it cannot be edited.</p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>Currency</Label>
                    <Select value={createForm.currency} onValueChange={(v) => setCreateForm({ ...createForm, currency: v })}>
                      <SelectTrigger data-testid="select-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="ZAR">ZAR</SelectItem>
                      </SelectContent>
                    </Select>
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
              </>
            )}
          </div>
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
                      !createForm.newClient.lastName?.trim() ||
                      !createForm.newClient.nationalId?.trim() ||
                      !createForm.newClient.phone?.trim() ||
                      !createForm.newClient.dateOfBirth ||
                      !createForm.newClient.gender
                    )) ||
                    (!createForm.beneficiaryId && (
                      !createForm.beneficiaryManual.firstName?.trim() ||
                      !createForm.beneficiaryManual.lastName?.trim() ||
                      !createForm.beneficiaryManual.relationship?.trim() ||
                      !createForm.beneficiaryManual.nationalId?.trim() ||
                      !createForm.beneficiaryManual.phone?.trim()
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
                  premiumAmount: calculatedPremium ?? "",
                })}
                disabled={
                  createMutation.isPending ||
                  (clientMode === "search" && !createForm.clientId) ||
                  (clientMode === "new" && (
                    !createForm.newClient.firstName?.trim() ||
                    !createForm.newClient.lastName?.trim() ||
                    !createForm.newClient.nationalId?.trim() ||
                    !createForm.newClient.phone?.trim() ||
                    !createForm.newClient.dateOfBirth ||
                    !createForm.newClient.gender
                  )) ||
                  !createForm.productVersionId ||
                  !calculatedPremium
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
    </StaffLayout>
  );
}
