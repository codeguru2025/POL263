import { useState, useEffect, type ChangeEvent } from "react";
import { useSearch, useLocation, Link } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EnhancedDataTable, type EdtColumn, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { validatePasswordPolicy, MIN_PASSWORD_LENGTH, NATIONAL_ID_FORMATS, NATIONAL_ID_FORMAT_KEYS, DEFAULT_NATIONAL_ID_FORMAT, SUPPORTED_CURRENCIES, CURRENCY_CONFIG, DEFAULT_ENABLED_CURRENCIES, normalizeEnabledCurrencies, type NationalIdFormatKey, type SupportedCurrency } from "@shared/validation";
import { RECEIPT_ADVERT_IMAGE_SPECS } from "@shared/receipt-advert-specs";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FeatureFlagsCard } from "@/components/feature-flags-card";
import {
  Check,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Shield,
  ShieldCheck,
  FileText,
  Globe,
  Video,
  Coins,
  MessageSquare,
} from "lucide-react";
import type { CountryFlagSettings } from "@/components/country-flag-fields";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { resolveAssetUrl } from "@/lib/assetUrl";

/** Mirrors server/module-gate.ts's ALL_KNOWN_MODULES — human labels for the self-service toggle list. */
const MODULE_TOGGLE_LABELS: Record<string, string> = {
  claims: "Claims",
  funeral_ops: "Funeral Operations",
  fleet: "Fleet Tracking",
  payroll: "Payroll & Attendance",
  whatsapp_notifications: "WhatsApp Notifications",
  mobile_payments: "Mobile Payments",
  email_notifications: "Email Notifications",
  email_inbound: "Inbound Email",
  sms_notifications: "SMS Notifications",
  legacy_records: "Legacy Records Import",
};

export default function StaffSettings() {
  const { user, permissions: userPerms, isPlatformOwner } = useAuth();
  const effectiveOrgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const isControlPlaneMode = isPlatformOwner && !effectiveOrgId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const permissions = Array.isArray(userPerms) ? userPerms : [];
  const canEditRbac = permissions.includes("write:role") || permissions.includes("create:tenant");
  const search = useSearch();
  const [, setLocation] = useLocation();
  const canManageSettings = permissions.includes("manage:settings");
  const tabParam = typeof window !== "undefined" ? new URLSearchParams(search).get("tab") : null;
  const validTabs = ["terms", "rbac", "adverts", "account", "countryFlag", "agentContent", "inbox", "general"];
  const defaultTab = tabParam && validTabs.includes(tabParam) ? tabParam : "account";
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    setActiveTab(t && validTabs.includes(t) ? t : "account");
  }, [search]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLocation(value === "account" ? "/staff/settings" : `/staff/settings?tab=${value}`);
  };

  const { data: rolesList } = useQuery<any[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permsList } = useQuery<any[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: termsList } = useQuery<any[]>({
    queryKey: ["/api/terms?all=true"],
  });

  const [termDialogOpen, setTermDialogOpen] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [termTitle, setTermTitle] = useState("");
  const [termContent, setTermContent] = useState("");
  const [termCategory, setTermCategory] = useState("general");
  const [termSortOrder, setTermSortOrder] = useState(0);
  const [termIsActive, setTermIsActive] = useState(true);
  const [termToDeleteId, setTermToDeleteId] = useState<string | null>(null);

  // ── Receipt Adverts ──────────────────────────────────────────
  const [advertDialogOpen, setAdvertDialogOpen] = useState(false);
  const [editingAdvertId, setEditingAdvertId] = useState<string | null>(null);
  const [advertTitle, setAdvertTitle] = useState("");
  const [advertBody, setAdvertBody] = useState("");
  const [advertImageUrl, setAdvertImageUrl] = useState("");
  const [advertImageUrlThermal, setAdvertImageUrlThermal] = useState("");
  const [advertImageUploading, setAdvertImageUploading] = useState(false);
  const [advertImageUploadingThermal, setAdvertImageUploadingThermal] = useState(false);
  const [advertDeleteId, setAdvertDeleteId] = useState<string | null>(null);

  const { data: advertsList = [], refetch: refetchAdverts } = useQuery<any[]>({
    queryKey: ["/api/receipt-adverts"],
    enabled: !isControlPlaneMode,
  });

  // ── Country Flag Settings ────────────────────────────────────
  const { data: countryFlagSettings } = useQuery<CountryFlagSettings>({
    queryKey: ["/api/country-flag-settings"],
    enabled: !isControlPlaneMode && canManageSettings,
  });
  const [countryFlagForm, setCountryFlagForm] = useState({ isEnabled: false, flagLabel: "South Africa", homeLabel: "Zimbabwe" });
  useEffect(() => {
    if (countryFlagSettings) {
      setCountryFlagForm({
        isEnabled: countryFlagSettings.isEnabled,
        flagLabel: countryFlagSettings.flagLabel,
        homeLabel: countryFlagSettings.homeLabel,
      });
    }
  }, [countryFlagSettings]);
  const saveCountryFlagMutation = useMutation({
    mutationFn: async () => apiRequest("PUT", "/api/country-flag-settings", countryFlagForm),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/country-flag-settings"] });
      toast({ title: "Country flag settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Organization timezone ────────────────────────────────────
  // Bounded to plausible target markets, not the full IANA tz database — see server/date-utils.ts.
  const TIMEZONE_OPTIONS = [
    { value: "Africa/Harare", label: "Harare, Lusaka (CAT, UTC+2)" },
    { value: "Africa/Johannesburg", label: "Johannesburg, Maseru, Mbabane (SAST, UTC+2)" },
    { value: "Africa/Gaborone", label: "Gaborone (CAT, UTC+2)" },
    { value: "Africa/Windhoek", label: "Windhoek (CAT, UTC+2)" },
    { value: "Africa/Nairobi", label: "Nairobi, Dar es Salaam, Kampala (EAT, UTC+3)" },
    { value: "Africa/Lagos", label: "Lagos, Kinshasa (WAT, UTC+1)" },
    { value: "Africa/Cairo", label: "Cairo (EET, UTC+2)" },
    { value: "Africa/Accra", label: "Accra, Abidjan (GMT, UTC+0)" },
    { value: "Europe/London", label: "London (GMT/BST)" },
    { value: "UTC", label: "UTC" },
  ];
  const { data: orgSettings } = useQuery<{ timezone?: string; nationalIdFormat?: NationalIdFormatKey; enabledCurrencies?: string[] }>({
    queryKey: ["/api/organizations", effectiveOrgId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/organizations/${effectiveOrgId}`);
      return res.json();
    },
    enabled: !isControlPlaneMode && canManageSettings && !!effectiveOrgId,
  });
  const [orgTimezone, setOrgTimezone] = useState("Africa/Harare");
  useEffect(() => {
    if (orgSettings?.timezone) setOrgTimezone(orgSettings.timezone);
  }, [orgSettings]);
  const saveTimezoneMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/organizations/${effectiveOrgId}`, { timezone: orgTimezone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", effectiveOrgId] });
      toast({ title: "Timezone saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Organization national ID format ──────────────────────────
  // Curated catalog (shared/validation.ts NATIONAL_ID_FORMATS) an org picks from, rather than a
  // free-text regex an admin could author — avoids ReDoS/correctness risk from untrusted patterns.
  const [orgNationalIdFormat, setOrgNationalIdFormat] = useState<NationalIdFormatKey>(DEFAULT_NATIONAL_ID_FORMAT);
  useEffect(() => {
    if (orgSettings?.nationalIdFormat) setOrgNationalIdFormat(orgSettings.nationalIdFormat);
  }, [orgSettings]);
  const saveNationalIdFormatMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/organizations/${effectiveOrgId}`, { nationalIdFormat: orgNationalIdFormat }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", effectiveOrgId] });
      toast({ title: "National ID format saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Organization enabled currencies ──────────────────────────
  // Multi-select subset of the platform-wide catalog (shared/validation.ts CURRENCY_CATALOG) this
  // org has turned on — unlike timezone/nationalIdFormat above, an org picks MULTIPLE entries here,
  // so this uses the same clickable-Badge multi-select pattern as productTypes/distributionChannels
  // in client/src/pages/public/tenant-signup.tsx rather than a single-select <Select>.
  const [orgEnabledCurrencies, setOrgEnabledCurrencies] = useState<string[]>(DEFAULT_ENABLED_CURRENCIES);
  useEffect(() => {
    if (orgSettings?.enabledCurrencies) setOrgEnabledCurrencies(normalizeEnabledCurrencies(orgSettings.enabledCurrencies));
  }, [orgSettings]);
  const toggleEnabledCurrency = (code: string) => {
    setOrgEnabledCurrencies((prev) => (prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]));
  };
  const saveEnabledCurrenciesMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/organizations/${effectiveOrgId}`, { enabledCurrencies: orgEnabledCurrencies }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", effectiveOrgId] });
      toast({ title: "Enabled currencies saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── SMS (Africala/SMSala) config ─────────────────────────────
  // Each tenant is a distinct customer under our SMSala reseller account with their own API
  // token and Sender ID — see server/sms-config.ts. The token is never returned by GET; the
  // input stays blank (placeholder shows whether one is set) and is only sent on save if the
  // admin actually typed a new one.
  const { data: smsConfig } = useQuery<{ enabled: boolean; senderId?: string; hasApiToken: boolean }>({
    queryKey: ["/api/sms-config"],
    enabled: !isControlPlaneMode && canManageSettings,
  });
  const [smsSenderId, setSmsSenderId] = useState("");
  const [smsApiToken, setSmsApiToken] = useState("");
  useEffect(() => {
    if (smsConfig?.senderId !== undefined) setSmsSenderId(smsConfig.senderId || "");
  }, [smsConfig]);
  const saveSmsConfigMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/sms-config", { senderId: smsSenderId, ...(smsApiToken ? { apiToken: smsApiToken } : {}) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/sms-config"] });
      setSmsApiToken("");
      toast({ title: "SMS settings saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Self-service module toggles — see server/module-gate.ts. `inPlan: false` modules render
  // disabled (can't self-grant something not on the billing plan); anything currently on can
  // always be switched off. ──────────────────────────────────────
  const { data: orgModulesData } = useQuery<{ modules: { key: string; inPlan: boolean; enabled: boolean }[] }>({
    queryKey: ["/api/organization-modules"],
    enabled: !isControlPlaneMode && canManageSettings,
  });
  const toggleModuleMutation = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiRequest("PATCH", `/api/organization-modules/${key}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/organization-modules"] }),
    onError: (e: any) => toast({ title: "Couldn't update module", description: e.message, variant: "destructive" }),
  });

  // ── Agent Content Posts (vCard training/education feed) ──────
  const { data: agentContentList = [] } = useQuery<any[]>({
    queryKey: ["/api/agent-content-posts"],
    enabled: !isControlPlaneMode && canManageSettings,
  });
  const [contentDialogOpen, setContentDialogOpen] = useState(false);
  const [editingContentId, setEditingContentId] = useState<string | null>(null);
  const [contentForm, setContentForm] = useState({ type: "post", title: "", body: "", videoUrl: "", thumbnailUrl: "" });
  const [contentDeleteId, setContentDeleteId] = useState<string | null>(null);
  const resetContentForm = () => { setEditingContentId(null); setContentForm({ type: "post", title: "", body: "", videoUrl: "", thumbnailUrl: "" }); };
  const openNewContent = () => { resetContentForm(); setContentDialogOpen(true); };
  const openEditContent = (post: any) => {
    setEditingContentId(post.id);
    setContentForm({ type: post.type, title: post.title || "", body: post.body || "", videoUrl: post.videoUrl || "", thumbnailUrl: post.thumbnailUrl || "" });
    setContentDialogOpen(true);
  };
  const createContentMutation = useMutation({
    mutationFn: async (data: typeof contentForm) => apiRequest("POST", "/api/agent-content-posts", data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agent-content-posts"] }); setContentDialogOpen(false); resetContentForm(); toast({ title: "Post added" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const updateContentMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof contentForm> }) => apiRequest("PATCH", `/api/agent-content-posts/${id}`, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agent-content-posts"] }); setContentDialogOpen(false); resetContentForm(); toast({ title: "Post updated" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const deleteContentMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/agent-content-posts/${id}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/agent-content-posts"] }); setContentDeleteId(null); toast({ title: "Post deleted" }); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const toggleContentActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/agent-content-posts/${id}`, { isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/agent-content-posts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  const handleSaveContent = () => {
    if (!contentForm.title.trim()) return;
    if (editingContentId) updateContentMutation.mutate({ id: editingContentId, data: contentForm });
    else createContentMutation.mutate(contentForm);
  };

  const createAdvertMutation = useMutation({
    mutationFn: async (data: { title: string; body: string; imageUrl: string }) => {
      return apiRequest("POST", "/api/receipt-adverts", data);
    },
    onSuccess: () => { refetchAdverts(); setAdvertDialogOpen(false); resetAdvertForm(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateAdvertMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { title: string; body: string; imageUrl: string } }) => {
      return apiRequest("PATCH", `/api/receipt-adverts/${id}`, data);
    },
    onSuccess: () => { refetchAdverts(); setAdvertDialogOpen(false); resetAdvertForm(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAdvertMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/receipt-adverts/${id}`),
    onSuccess: () => { refetchAdverts(); setAdvertDeleteId(null); },
  });

  const activateAdvertMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipt-adverts/${id}/activate`),
    onSuccess: () => refetchAdverts(),
  });

  const deactivateAdvertMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/receipt-adverts/${id}/deactivate`),
    onSuccess: () => refetchAdverts(),
  });

  function resetAdvertForm() {
    setEditingAdvertId(null);
    setAdvertTitle("");
    setAdvertBody("");
    setAdvertImageUrl("");
    setAdvertImageUrlThermal("");
  }

  function openNewAdvert() {
    resetAdvertForm();
    setAdvertDialogOpen(true);
  }

  function openEditAdvert(advert: any) {
    setEditingAdvertId(advert.id);
    setAdvertTitle(advert.title || "");
    setAdvertBody(advert.body || "");
    setAdvertImageUrl(advert.imageUrl || "");
    setAdvertImageUrlThermal(advert.imageUrlThermal || "");
    setAdvertDialogOpen(true);
  }

  // Shared by both image slots below — format ("a4" | "thermal") picks which shape the server
  // validates against (shared/receipt-advert-specs.ts) and which state setter receives the result.
  async function handleAdvertImageUpload(
    e: ChangeEvent<HTMLInputElement>,
    format: "a4" | "thermal",
    setUrl: (url: string) => void,
    setUploading: (v: boolean) => void
  ) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const csrf = getCsrfToken();
      const res = await fetch(`/api/upload/receipt-advert-image?format=${format}`, {
        method: "POST",
        headers: csrf ? { "x-csrf-token": csrf } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      setUrl(json.url);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleSaveAdvert() {
    const data = {
      title: advertTitle.trim(),
      body: advertBody.trim(),
      imageUrl: advertImageUrl.trim(),
      imageUrlThermal: advertImageUrlThermal.trim(),
    };
    if (editingAdvertId) updateAdvertMutation.mutate({ id: editingAdvertId, data });
    else createAdvertMutation.mutate(data);
  }

  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNew, setChangePasswordNew] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const canManagePermissions = permissions.includes("manage:permissions");

  const changePasswordMutation = useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const res = await apiRequest("POST", "/api/auth/change-password", body);
      return res.json();
    },
    onSuccess: () => {
      setChangePasswordCurrent("");
      setChangePasswordNew("");
      setChangePasswordConfirm("");
    },
  });

  const [mfaDialogOpen, setMfaDialogOpen] = useState(false);
  const [mfaStep, setMfaStep] = useState<"qr" | "backup-codes">("qr");
  const [mfaEnrollData, setMfaEnrollData] = useState<{ qrDataUrl: string; secret: string } | null>(null);
  const [mfaConfirmCode, setMfaConfirmCode] = useState("");
  const [mfaBackupCodes, setMfaBackupCodes] = useState<string[]>([]);
  const [mfaDisableDialogOpen, setMfaDisableDialogOpen] = useState(false);
  const [mfaDisablePassword, setMfaDisablePassword] = useState("");

  const enrollMfaMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/mfa/enroll", {});
      return res.json();
    },
    onSuccess: (data) => setMfaEnrollData(data),
  });

  const confirmMfaMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("POST", "/api/auth/mfa/confirm", { code });
      return res.json();
    },
    onSuccess: (data) => {
      setMfaBackupCodes(data.backupCodes || []);
      setMfaStep("backup-codes");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const disableMfaMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/mfa/disable", { password });
      return res.json();
    },
    onSuccess: () => {
      setMfaDisableDialogOpen(false);
      setMfaDisablePassword("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  const openMfaEnrollDialog = () => {
    setMfaStep("qr");
    setMfaEnrollData(null);
    setMfaConfirmCode("");
    setMfaBackupCodes([]);
    setMfaDialogOpen(true);
    enrollMfaMutation.mutate();
  };

  const openNewTermDialog = () => {
    setEditingTermId(null);
    setTermTitle("");
    setTermContent("");
    setTermCategory("general");
    setTermSortOrder(termsList?.length ?? 0);
    setTermIsActive(true);
    setTermDialogOpen(true);
  };

  const openEditTermDialog = (term: any) => {
    setEditingTermId(term.id);
    setTermTitle(term.title);
    setTermContent(term.content);
    setTermCategory(term.category || "general");
    setTermSortOrder(term.sortOrder ?? 0);
    setTermIsActive(term.isActive ?? true);
    setTermDialogOpen(true);
  };

  const createTermMutation = useMutation({
    mutationFn: async (data: { title: string; content: string; category: string; sortOrder: number; isActive: boolean }) => {
      const res = await apiRequest("POST", "/api/terms", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] });
      setTermDialogOpen(false);
    },
  });

  const updateTermMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<{ title: string; content: string; category: string; sortOrder: number; isActive: boolean }>;
    }) => {
      const res = await apiRequest("PATCH", `/api/terms/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] });
      setTermDialogOpen(false);
    },
  });

  const deleteTermMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/terms/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] });
      setTermToDeleteId(null);
    },
  });

  const handleSaveTerm = () => {
    if (!termTitle.trim() || !termContent.trim()) return;
    const payload = {
      title: termTitle.trim(),
      content: termContent.trim(),
      category: termCategory.trim() || "general",
      sortOrder: termSortOrder,
      isActive: termIsActive,
    };
    if (editingTermId) {
      updateTermMutation.mutate({ id: editingTermId, data: payload });
    } else {
      createTermMutation.mutate(payload);
    }
  };

  // ✅ FIX: fetch role permissions with useQueries (hook-safe)
  const rolePermResults = useQueries({
    queries: (rolesList ?? []).map((role: any) => ({
      queryKey: [`/api/roles/${role.id}/permissions`],
      staleTime: 60_000,
      enabled: !!role?.id,
    })),
  });

  const permsByRoleId: Record<string, any[] | undefined> = {};
  (rolesList ?? []).forEach((role: any, idx: number) => {
    permsByRoleId[role.id] = rolePermResults[idx]?.data as any[] | undefined;
  });

  const syncPermissionsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/sync-permissions");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/permissions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/roles"] });
      (rolesList ?? []).forEach((r: any) => {
        queryClient.invalidateQueries({ queryKey: [`/api/roles/${r.id}/permissions`] });
      });
      toast({ title: "Permissions synced", description: "All roles and permissions have been synchronized with the latest configuration." });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message || "Could not synchronize permissions.", variant: "destructive" });
    },
  });

  const termsColumns: EdtColumn<any>[] = [
    { id: "title", header: "Title", accessor: (term) => term.title, cell: (term) => <span className="font-medium">{term.title}</span> },
    { id: "category", header: "Category", accessor: (term) => term.category || "general", cell: (term) => <span className="text-muted-foreground">{term.category || "general"}</span> },
    { id: "order", header: "Order", accessor: (term) => term.sortOrder },
    { id: "active", header: "Active", accessor: (term) => (term.isActive ? "Yes" : "No") },
    {
      id: "actions",
      header: "Actions",
      sortable: false,
      cell: (term) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="icon" onClick={() => openEditTermDialog(term)} aria-label="Edit">
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setTermToDeleteId(term.id)} aria-label="Delete">
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Settings"
          description="Manage organization settings and Role-Based Access Control."
        />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            {!isControlPlaneMode && canManageSettings && <TabsTrigger value="general">General</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="terms">Terms</TabsTrigger>}
            {!isControlPlaneMode && canManageSettings && <TabsTrigger value="adverts">Receipt Adverts</TabsTrigger>}
            {!isControlPlaneMode && canManageSettings && <TabsTrigger value="countryFlag">Country Flag</TabsTrigger>}
            {!isControlPlaneMode && canManageSettings && <TabsTrigger value="agentContent">Agent Content</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="rbac">RBAC</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="inbox">Inbox</TabsTrigger>}
          </TabsList>

          {/* Receipt Adverts */}
          {!isControlPlaneMode && canManageSettings && (
            <TabsContent value="adverts" className="mt-6">
              <CardSection
                title="Receipt Adverts"
                description="Add a promotional image, title, and message to appear at the bottom of printed receipts."
                icon={FileText}
              >
                <div className="space-y-4">
                  <Button size="sm" onClick={openNewAdvert} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> New Advert
                  </Button>

                  {advertsList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No adverts configured. Create one to have it print on receipts.</p>
                  ) : (
                    <div className="space-y-3">
                      {advertsList.map((advert: any) => (
                        <div key={advert.id} className="flex items-start gap-4 rounded-lg border p-4 bg-muted/20">
                          {advert.imageUrl && (
                            <img src={resolveAssetUrl(advert.imageUrl)} alt="" className="h-16 w-24 object-contain rounded border bg-white shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-sm truncate">{advert.title || "(No title)"}</span>
                              {advert.isActive && <Badge className="bg-emerald-600 text-white text-xs">Active</Badge>}
                              <Badge variant="outline" className="text-[10px]" title={advert.imageUrlThermal ? "Has a separate thermal-receipt image" : "Falls back to the A4 image on thermal receipts"}>
                                {advert.imageUrlThermal ? "A4 + Thermal images" : "A4 image only"}
                              </Badge>
                            </div>
                            {advert.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{advert.body}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {advert.isActive ? (
                              <Button size="sm" variant="outline" className="text-xs" onClick={() => deactivateAdvertMutation.mutate(advert.id)} disabled={deactivateAdvertMutation.isPending}>
                                Deactivate
                              </Button>
                            ) : (
                              <Button size="sm" variant="outline" className="text-xs text-emerald-700 border-emerald-300" onClick={() => activateAdvertMutation.mutate(advert.id)} disabled={activateAdvertMutation.isPending}>
                                Set Active
                              </Button>
                            )}
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit advert" onClick={() => openEditAdvert(advert)}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete advert" onClick={() => setAdvertDeleteId(advert.id)}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardSection>

              {/* Advert create/edit dialog */}
              <Dialog open={advertDialogOpen} onOpenChange={(v) => { if (!v) { setAdvertDialogOpen(false); resetAdvertForm(); } else setAdvertDialogOpen(true); }}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editingAdvertId ? "Edit Advert" : "New Receipt Advert"}</DialogTitle>
                    <DialogDescription>This advert will appear at the bottom of all printed receipts when set as active.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>A4 Receipt Image <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-32 rounded border flex items-center justify-center bg-muted/20 overflow-hidden shrink-0">
                          {advertImageUrl ? (
                            <img key={advertImageUrl} src={resolveAssetUrl(advertImageUrl)} alt="A4 advert" className="object-contain max-h-full max-w-full p-1" />
                          ) : (
                            <span className="text-xs text-muted-foreground text-center px-2">No image</span>
                          )}
                        </div>
                        <div className="space-y-1">
                          <input id="advert-img-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => handleAdvertImageUpload(e, "a4", setAdvertImageUrl, setAdvertImageUploading)} />
                          <Button type="button" size="sm" variant="outline" disabled={advertImageUploading} onClick={() => document.getElementById("advert-img-upload")?.click()}>
                            {advertImageUploading ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</> : "Upload Image"}
                          </Button>
                          {advertImageUrl && (
                            <Button type="button" size="sm" variant="ghost" className="text-destructive text-xs" onClick={() => setAdvertImageUrl("")}>Remove</Button>
                          )}
                          <p className="text-xs text-muted-foreground">{RECEIPT_ADVERT_IMAGE_SPECS.a4.hintText}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label>Thermal Receipt Image <span className="text-muted-foreground text-xs">(optional — falls back to the A4 image above if not set)</span></Label>
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 rounded border flex items-center justify-center bg-muted/20 overflow-hidden shrink-0">
                          {advertImageUrlThermal ? (
                            <img key={advertImageUrlThermal} src={resolveAssetUrl(advertImageUrlThermal)} alt="Thermal advert" className="object-contain max-h-full max-w-full p-1" />
                          ) : (
                            <span className="text-xs text-muted-foreground text-center px-2">No image</span>
                          )}
                        </div>
                        <div className="space-y-1">
                          <input id="advert-img-upload-thermal" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={(e) => handleAdvertImageUpload(e, "thermal", setAdvertImageUrlThermal, setAdvertImageUploadingThermal)} />
                          <Button type="button" size="sm" variant="outline" disabled={advertImageUploadingThermal} onClick={() => document.getElementById("advert-img-upload-thermal")?.click()}>
                            {advertImageUploadingThermal ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</> : "Upload Image"}
                          </Button>
                          {advertImageUrlThermal && (
                            <Button type="button" size="sm" variant="ghost" className="text-destructive text-xs" onClick={() => setAdvertImageUrlThermal("")}>Remove</Button>
                          )}
                          <p className="text-xs text-muted-foreground">{RECEIPT_ADVERT_IMAGE_SPECS.thermal.hintText}</p>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="advert-title">Title <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input id="advert-title" value={advertTitle} onChange={(e) => setAdvertTitle(e.target.value)} placeholder="e.g. Special Offer — Family Cover" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="advert-body">Message <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Textarea id="advert-body" value={advertBody} onChange={(e) => setAdvertBody(e.target.value)} placeholder="e.g. Add a family member for only $2 extra/month. Ask your agent today." rows={3} />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setAdvertDialogOpen(false); resetAdvertForm(); }}>Cancel</Button>
                    <Button onClick={handleSaveAdvert} disabled={createAdvertMutation.isPending || updateAdvertMutation.isPending}>
                      {(createAdvertMutation.isPending || updateAdvertMutation.isPending) ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Advert"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Advert delete confirm */}
              <AlertDialog open={!!advertDeleteId} onOpenChange={(v) => { if (!v) setAdvertDeleteId(null); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Advert?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone. The advert will stop appearing on receipts immediately.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => advertDeleteId && deleteAdvertMutation.mutate(advertDeleteId)} className="bg-destructive text-white">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>
          )}

          {/* General */}
          {!isControlPlaneMode && canManageSettings && (
            <TabsContent value="general" className="mt-6">
              <CardSection
                title="Timezone"
                description="Drives this organization's 'today' — grace/lapse deadlines, notification timing, and default report dates. Defaults to Africa/Harare; change it if your organization operates elsewhere."
                icon={Globe}
              >
                <div className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="org-timezone">Organization timezone</Label>
                    <Select value={orgTimezone} onValueChange={setOrgTimezone}>
                      <SelectTrigger id="org-timezone"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {TIMEZONE_OPTIONS.map((tz) => (
                          <SelectItem key={tz.value} value={tz.value}>{tz.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => saveTimezoneMutation.mutate()} disabled={saveTimezoneMutation.isPending}>
                    {saveTimezoneMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </CardSection>
              <CardSection
                title="National ID Format"
                description="The national ID shape enforced on client, dependent, and beneficiary records. Defaults to Zimbabwe's format; pick 'No format enforcement' if your organization operates elsewhere and just needs a free-text identifier."
                icon={FileText}
                className="mt-6"
              >
                <div className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="org-national-id-format">National ID format</Label>
                    <Select value={orgNationalIdFormat} onValueChange={(v) => setOrgNationalIdFormat(v as NationalIdFormatKey)}>
                      <SelectTrigger id="org-national-id-format"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {NATIONAL_ID_FORMAT_KEYS.map((key) => (
                          <SelectItem key={key} value={key}>{NATIONAL_ID_FORMATS[key].label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button onClick={() => saveNationalIdFormatMutation.mutate()} disabled={saveNationalIdFormatMutation.isPending}>
                    {saveNationalIdFormatMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </CardSection>
              <CardSection
                title="Enabled Currencies"
                description="Which currencies show up in every currency picker across the app (policies, payments, product pricing, reports). Defaults to USD, ZAR and ZIG; at least one must stay enabled."
                icon={Coins}
                className="mt-6"
              >
                <div className="space-y-4 max-w-md">
                  <div className="flex flex-wrap gap-2">
                    {SUPPORTED_CURRENCIES.map((code) => {
                      const selected = orgEnabledCurrencies.includes(code);
                      return (
                        <Badge
                          key={code}
                          variant={selected ? "default" : "outline"}
                          className={`cursor-pointer select-none ${selected ? "" : "opacity-60 hover:opacity-100"}`}
                          onClick={() => toggleEnabledCurrency(code)}
                          data-testid={`badge-currency-${code}`}
                        >
                          {selected ? <Check className="mr-1 h-3 w-3" /> : null}
                          {code} ({CURRENCY_CONFIG[code as SupportedCurrency].symbol})
                        </Badge>
                      );
                    })}
                  </div>
                  {orgEnabledCurrencies.length === 0 && (
                    <p className="text-xs text-destructive">At least one currency must remain enabled.</p>
                  )}
                  <Button
                    onClick={() => saveEnabledCurrenciesMutation.mutate()}
                    disabled={saveEnabledCurrenciesMutation.isPending || orgEnabledCurrencies.length === 0}
                  >
                    {saveEnabledCurrenciesMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </CardSection>
              <CardSection
                title="SMS (Africala)"
                description="Your own SMSala sub-account credentials, used to send policy/account SMS notices. Each organization has a distinct API token and Sender ID under our SMSala reseller account — never shared across tenants."
                icon={MessageSquare}
                className="mt-6"
              >
                <div className="space-y-4 max-w-md">
                  <div className="space-y-2">
                    <Label htmlFor="sms-api-token">API Token</Label>
                    <Input
                      id="sms-api-token"
                      type="password"
                      value={smsApiToken}
                      onChange={(e) => setSmsApiToken(e.target.value)}
                      placeholder={smsConfig?.hasApiToken ? "••••••••  (set — leave blank to keep)" : "Not set"}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sms-sender-id">Sender ID</Label>
                    <Input
                      id="sms-sender-id"
                      value={smsSenderId}
                      onChange={(e) => setSmsSenderId(e.target.value)}
                      placeholder="e.g. FALAKHE"
                    />
                  </div>
                  <Button onClick={() => saveSmsConfigMutation.mutate()} disabled={saveSmsConfigMutation.isPending}>
                    {saveSmsConfigMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </CardSection>
              <CardSection
                title="Modules"
                description="Turn features on or off for your organization. A greyed-out module isn't included in your current billing plan — contact us to upgrade."
                icon={Check}
                className="mt-6"
              >
                <div className="space-y-3 max-w-md">
                  {(orgModulesData?.modules ?? []).map((m) => (
                    <div key={m.key} className="flex items-center justify-between gap-4">
                      <div>
                        <p className={`text-sm font-medium ${m.inPlan ? "" : "text-muted-foreground"}`}>
                          {MODULE_TOGGLE_LABELS[m.key] ?? m.key}
                        </p>
                        {!m.inPlan && <p className="text-xs text-muted-foreground">Not in your plan</p>}
                      </div>
                      <Switch
                        checked={m.enabled}
                        disabled={(!m.inPlan && !m.enabled) || toggleModuleMutation.isPending}
                        onCheckedChange={(checked) => toggleModuleMutation.mutate({ key: m.key, enabled: checked })}
                        data-testid={`switch-module-${m.key}`}
                      />
                    </div>
                  ))}
                </div>
              </CardSection>
            </TabsContent>
          )}

          {/* Country Flag */}
          {!isControlPlaneMode && canManageSettings && (
            <TabsContent value="countryFlag" className="mt-6">
              <CardSection
                title="Country Flag"
                description="Flag policies and funeral cases tied to another country (e.g. a tenant operating across a border). Off by default — turn on and set your own labels if this applies to your organization."
                icon={Globe}
              >
                <div className="space-y-4 max-w-md">
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div className="space-y-0.5">
                      <Label htmlFor="country-flag-enabled">Enable country flag</Label>
                      <p className="text-xs text-muted-foreground">Shows a checkbox on policy and funeral case forms, plus a filter and badge.</p>
                    </div>
                    <Switch
                      id="country-flag-enabled"
                      checked={countryFlagForm.isEnabled}
                      onCheckedChange={(v) => setCountryFlagForm({ ...countryFlagForm, isEnabled: v })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country-flag-label">Flagged country label</Label>
                    <Input
                      id="country-flag-label"
                      value={countryFlagForm.flagLabel}
                      onChange={(e) => setCountryFlagForm({ ...countryFlagForm, flagLabel: e.target.value })}
                      placeholder="e.g. South Africa"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="country-home-label">Home country label</Label>
                    <Input
                      id="country-home-label"
                      value={countryFlagForm.homeLabel}
                      onChange={(e) => setCountryFlagForm({ ...countryFlagForm, homeLabel: e.target.value })}
                      placeholder="e.g. Zimbabwe"
                    />
                  </div>
                  <Button
                    onClick={() => saveCountryFlagMutation.mutate()}
                    disabled={saveCountryFlagMutation.isPending || !countryFlagForm.flagLabel.trim() || !countryFlagForm.homeLabel.trim()}
                  >
                    {saveCountryFlagMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Save
                  </Button>
                </div>
              </CardSection>
            </TabsContent>
          )}

          {/* Agent Content Posts */}
          {!isControlPlaneMode && canManageSettings && (
            <TabsContent value="agentContent" className="mt-6">
              <CardSection
                title="Agent Content"
                description="Training videos, educational content, and posts pushed to every agent's public referral (vCard) page."
                icon={Video}
              >
                <div className="space-y-4">
                  <Button size="sm" onClick={openNewContent} className="flex items-center gap-2">
                    <Plus className="h-4 w-4" /> New Post
                  </Button>

                  {agentContentList.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No content yet. Add a video or post to show it on every agent's referral page.</p>
                  ) : (
                    <div className="space-y-3">
                      {agentContentList.map((post: any) => (
                        <div key={post.id} className="flex items-start gap-4 rounded-lg border p-4 bg-muted/20">
                          {post.thumbnailUrl ? (
                            <img src={post.thumbnailUrl} alt="" className="h-16 w-24 object-cover rounded border bg-white shrink-0" />
                          ) : (
                            <div className="h-16 w-24 rounded border bg-muted/40 flex items-center justify-center shrink-0">
                              {post.type === "video" ? <Video className="h-5 w-5 text-muted-foreground" /> : <FileText className="h-5 w-5 text-muted-foreground" />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="outline" className="text-xs capitalize">{post.type}</Badge>
                              <span className="font-medium text-sm truncate">{post.title}</span>
                              {post.isActive && <Badge className="bg-emerald-600 text-white text-xs">Active</Badge>}
                            </div>
                            {post.body && <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{post.body}</p>}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <Button
                              size="sm" variant="outline" className="text-xs"
                              onClick={() => toggleContentActiveMutation.mutate({ id: post.id, isActive: !post.isActive })}
                              disabled={toggleContentActiveMutation.isPending}
                            >
                              {post.isActive ? "Hide" : "Show"}
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8" aria-label="Edit post" onClick={() => openEditContent(post)}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive" aria-label="Delete post" onClick={() => setContentDeleteId(post.id)}>
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardSection>

              {/* Post create/edit dialog */}
              <Dialog open={contentDialogOpen} onOpenChange={(v) => { if (!v) { setContentDialogOpen(false); resetContentForm(); } else setContentDialogOpen(true); }}>
                <DialogContent className="max-w-lg">
                  <DialogHeader>
                    <DialogTitle>{editingContentId ? "Edit Post" : "New Agent Content Post"}</DialogTitle>
                    <DialogDescription>Shown on every agent's public referral page when active.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label>Type</Label>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant={contentForm.type === "post" ? "default" : "outline"} onClick={() => setContentForm({ ...contentForm, type: "post" })}>Post</Button>
                        <Button type="button" size="sm" variant={contentForm.type === "video" ? "default" : "outline"} onClick={() => setContentForm({ ...contentForm, type: "video" })}>Video</Button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="content-title">Title</Label>
                      <Input id="content-title" value={contentForm.title} onChange={(e) => setContentForm({ ...contentForm, title: e.target.value })} placeholder="e.g. How to explain family cover" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="content-body">Body / Caption <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Textarea id="content-body" value={contentForm.body} onChange={(e) => setContentForm({ ...contentForm, body: e.target.value })} rows={3} />
                    </div>
                    {contentForm.type === "video" && (
                      <div className="space-y-2">
                        <Label htmlFor="content-video">Video URL <span className="text-muted-foreground text-xs">(YouTube / Vimeo link)</span></Label>
                        <Input id="content-video" value={contentForm.videoUrl} onChange={(e) => setContentForm({ ...contentForm, videoUrl: e.target.value })} placeholder="https://youtube.com/watch?v=…" />
                      </div>
                    )}
                    <div className="space-y-2">
                      <Label htmlFor="content-thumb">Thumbnail URL <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input id="content-thumb" value={contentForm.thumbnailUrl} onChange={(e) => setContentForm({ ...contentForm, thumbnailUrl: e.target.value })} placeholder="https://…" />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => { setContentDialogOpen(false); resetContentForm(); }}>Cancel</Button>
                    <Button onClick={handleSaveContent} disabled={!contentForm.title.trim() || createContentMutation.isPending || updateContentMutation.isPending}>
                      {(createContentMutation.isPending || updateContentMutation.isPending) ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : "Save Post"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* Post delete confirm */}
              <AlertDialog open={!!contentDeleteId} onOpenChange={(v) => { if (!v) setContentDeleteId(null); }}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Post?</AlertDialogTitle>
                    <AlertDialogDescription>This cannot be undone. It will stop appearing on agent referral pages immediately.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={() => contentDeleteId && deleteContentMutation.mutate(contentDeleteId)} className="bg-destructive text-white">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>
          )}

          {/* Account */}
          <TabsContent value="account" className="mt-6">
            <CardSection
              title="Change password"
              description="Change your sign-in password. If you sign in with Google, this section does not apply."
              icon={KeyRound}
              className="max-w-2xl"
              contentClassName="max-w-md"
            >
              <div className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="currentPassword">Current password</Label>
                  <Input
                    id="currentPassword"
                    type="password"
                    autoComplete="current-password"
                    value={changePasswordCurrent}
                    onChange={(e) => setChangePasswordCurrent(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="newPassword">New password (min {MIN_PASSWORD_LENGTH} characters, with a letter and a number)</Label>
                  <Input
                    id="newPassword"
                    type="password"
                    autoComplete="new-password"
                    value={changePasswordNew}
                    onChange={(e) => setChangePasswordNew(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="confirmPassword">Confirm new password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    value={changePasswordConfirm}
                    onChange={(e) => setChangePasswordConfirm(e.target.value)}
                    placeholder="••••••••"
                  />
                </div>
                {changePasswordMutation.isError && (
                  <p className="text-sm text-destructive">
                    {(() => {
                      const msg = (changePasswordMutation.error as Error)?.message || "";
                      const match = msg.match(/^\d+: (.+)$/);
                      if (match) {
                        try {
                          const o = JSON.parse(match[1]);
                          return o.message || msg;
                        } catch {
                          return msg;
                        }
                      }
                      return msg;
                    })()}
                  </p>
                )}
                {changePasswordMutation.isSuccess && (
                  <p className="text-sm text-emerald-600 flex items-center gap-1">
                    <Check className="h-4 w-4" /> Password updated successfully.
                  </p>
                )}
                <Button
                  onClick={() =>
                    changePasswordMutation.mutate({
                      currentPassword: changePasswordCurrent,
                      newPassword: changePasswordNew,
                    })
                  }
                  disabled={
                    !changePasswordCurrent ||
                    !!validatePasswordPolicy(changePasswordNew) ||
                    changePasswordNew !== changePasswordConfirm ||
                    changePasswordMutation.isPending
                  }
                >
                  {changePasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change password
                </Button>
              </div>
            </CardSection>

            <CardSection
              title="Two-factor authentication"
              description="Add a second step to sign-in with an authenticator app (Google Authenticator, Authy, 1Password, etc). Opt-in — nothing changes until you enable it."
              icon={ShieldCheck}
              className="max-w-2xl mt-6"
              contentClassName="max-w-md"
            >
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm text-muted-foreground">
                  {user?.mfaEnabled
                    ? "Two-factor authentication is enabled on your account."
                    : "Two-factor authentication is not enabled."}
                </p>
                {user?.mfaEnabled ? (
                  <Button variant="outline" onClick={() => setMfaDisableDialogOpen(true)} data-testid="button-disable-mfa">
                    Disable
                  </Button>
                ) : (
                  <Button onClick={openMfaEnrollDialog} data-testid="button-enable-mfa">
                    Enable
                  </Button>
                )}
              </div>
            </CardSection>

            <Dialog open={mfaDialogOpen} onOpenChange={(open) => { setMfaDialogOpen(open); if (!open) queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] }); }}>
              <DialogContent className="max-w-md">
                {mfaStep === "qr" ? (
                  <>
                    <DialogHeader>
                      <DialogTitle>Scan this QR code</DialogTitle>
                      <DialogDescription>
                        Scan with your authenticator app, then enter the 6-digit code it shows to confirm.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      {enrollMfaMutation.isPending ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                      ) : mfaEnrollData ? (
                        <>
                          <div className="flex justify-center">
                            <img src={mfaEnrollData.qrDataUrl} alt="MFA enrollment QR code" className="h-48 w-48 rounded-lg border" />
                          </div>
                          <p className="text-xs text-center text-muted-foreground font-mono break-all">{mfaEnrollData.secret}</p>
                          <div className="grid gap-2">
                            <Label htmlFor="mfa-confirm-code">Confirmation code</Label>
                            <Input
                              id="mfa-confirm-code"
                              inputMode="numeric"
                              autoComplete="one-time-code"
                              placeholder="123456"
                              className="text-center text-lg tracking-widest"
                              value={mfaConfirmCode}
                              onChange={(e) => setMfaConfirmCode(e.target.value)}
                              data-testid="input-mfa-confirm-code"
                            />
                          </div>
                          {confirmMfaMutation.isError && (
                            <p className="text-sm text-destructive">Invalid code — try again.</p>
                          )}
                        </>
                      ) : (
                        <p className="text-sm text-destructive">Could not start enrollment. Close and try again.</p>
                      )}
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setMfaDialogOpen(false)}>Cancel</Button>
                      <Button
                        onClick={() => confirmMfaMutation.mutate(mfaConfirmCode)}
                        disabled={!mfaConfirmCode.trim() || confirmMfaMutation.isPending}
                        data-testid="button-confirm-mfa"
                      >
                        {confirmMfaMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Confirm
                      </Button>
                    </DialogFooter>
                  </>
                ) : (
                  <>
                    <DialogHeader>
                      <DialogTitle>Save your backup codes</DialogTitle>
                      <DialogDescription>
                        Each code works once, if you ever lose access to your authenticator app. Store them somewhere safe — they won't be shown again.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-2 gap-2 font-mono text-sm bg-muted/40 rounded-lg p-4">
                      {mfaBackupCodes.map((c) => <div key={c} data-testid="text-mfa-backup-code">{c}</div>)}
                    </div>
                    <DialogFooter>
                      <Button onClick={() => setMfaDialogOpen(false)} data-testid="button-mfa-done">Done</Button>
                    </DialogFooter>
                  </>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={mfaDisableDialogOpen} onOpenChange={setMfaDisableDialogOpen}>
              <DialogContent className="max-w-sm">
                <DialogHeader>
                  <DialogTitle>Disable two-factor authentication</DialogTitle>
                  <DialogDescription>Confirm your current password to disable MFA.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-2">
                  <Label htmlFor="mfa-disable-password">Current password</Label>
                  <Input
                    id="mfa-disable-password"
                    type="password"
                    autoComplete="current-password"
                    value={mfaDisablePassword}
                    onChange={(e) => setMfaDisablePassword(e.target.value)}
                    data-testid="input-mfa-disable-password"
                  />
                  {disableMfaMutation.isError && (
                    <p className="text-sm text-destructive">Incorrect password.</p>
                  )}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setMfaDisableDialogOpen(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={() => disableMfaMutation.mutate(mfaDisablePassword)} disabled={disableMfaMutation.isPending} data-testid="button-confirm-disable-mfa">
                    {disableMfaMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Disable
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <div className="mt-6">
              <FeatureFlagsCard />
            </div>

            <CardSection
              title="Compliance policies"
              description="Platform-wide baselines POL263 operates under as the technology provider. Every tenant inherits these by default."
              icon={Shield}
              className="max-w-2xl mt-6"
            >
              <div className="space-y-3 text-sm">
                <p>
                  Suspicious payments (single or cumulative <strong>$1,000 USD-equivalent</strong> or more) should be
                  escalated to <strong>compliance@pol263.com</strong> rather than processed as routine — see the AML
                  policy for the full list of indicators and escalation steps.
                </p>
                <div className="flex flex-wrap gap-4">
                  <Link href="/legal/aml-policy" className="text-primary underline underline-offset-2">
                    AML &amp; Suspicious Transaction Policy →
                  </Link>
                  <Link href="/legal/data-retention-policy" className="text-primary underline underline-offset-2">
                    Client Data Handling &amp; Retention Policy →
                  </Link>
                </div>
              </div>
            </CardSection>
          </TabsContent>

          {/* Terms */}
          <TabsContent value="terms" className="mt-6">
            <CardSection
              title="Terms and Conditions"
              description="Terms appear on policy documents and e-statements. Only active terms are included on PDFs."
              icon={FileText}
              headerRight={(
                <Button onClick={openNewTermDialog}>
                  <Plus className="h-4 w-4 mr-2" /> Add term
                </Button>
              )}
            >
                {termsList === undefined ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (
                  <EnhancedDataTable
                    columns={termsColumns}
                    rows={termsList ?? []}
                    getRowKey={(term) => term.id}
                    exportFilename="terms-and-conditions"
                    storageKey="staff-settings-terms"
                    emptyMessage="No terms yet. Add one to show on policy documents."
                  />
                )}
            </CardSection>

            <Dialog open={termDialogOpen} onOpenChange={setTermDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingTermId ? "Edit term" : "Add term"}</DialogTitle>
                  <DialogDescription>This text will appear in the Terms and Conditions section of policy documents when active.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="termTitle">Title</Label>
                    <Input id="termTitle" value={termTitle} onChange={(e) => setTermTitle(e.target.value)} placeholder="e.g. Premium Payment" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="termContent">Content</Label>
                    <Textarea
                      id="termContent"
                      value={termContent}
                      onChange={(e) => setTermContent(e.target.value)}
                      placeholder="Full terms text..."
                      rows={5}
                      className="resize-y"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="termCategory">Category</Label>
                      <Input id="termCategory" value={termCategory} onChange={(e) => setTermCategory(e.target.value)} placeholder="general" />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="termSortOrder">Sort order</Label>
                      <Input
                        id="termSortOrder"
                        type="number"
                        value={termSortOrder}
                        onChange={(e) => setTermSortOrder(parseInt(e.target.value, 10) || 0)}
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="termIsActive"
                      checked={termIsActive}
                      onChange={(e) => setTermIsActive(e.target.checked)}
                      className="rounded border-input"
                    />
                    <Label htmlFor="termIsActive">Active (show on policy documents)</Label>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setTermDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveTerm}
                    disabled={!termTitle.trim() || !termContent.trim() || createTermMutation.isPending || updateTermMutation.isPending}
                  >
                    {(createTermMutation.isPending || updateTermMutation.isPending) && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    {editingTermId ? "Save changes" : "Add term"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <AlertDialog open={!!termToDeleteId} onOpenChange={(open) => !open && setTermToDeleteId(null)}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete term?</AlertDialogTitle>
                  <AlertDialogDescription>This term will be removed. It will no longer appear on policy documents.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => termToDeleteId && deleteTermMutation.mutate(termToDeleteId)}
                  >
                    {deleteTermMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </TabsContent>

          {/* RBAC */}
          <TabsContent value="rbac" className="mt-6">
            <CardSection
              title="Role permissions mapping"
              description={
                canEditRbac
                  ? "Click a cell to toggle permissions for each role. Superuser always has all permissions."
                  : "Live DB-driven RBAC configuration. Roles and permissions are fetched from the database."
              }
              icon={Shield}
              headerRight={
                canManagePermissions ? (
                  <Button
                    variant="outline"
                    onClick={() => syncPermissionsMutation.mutate()}
                    disabled={syncPermissionsMutation.isPending}
                    data-testid="btn-sync-permissions"
                  >
                    {syncPermissionsMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Shield className="h-4 w-4 mr-2" />}
                    Sync Permissions
                  </Button>
                ) : undefined
              }
              flush
            >
                {rolesList && permsList ? (
                  <div className="border border-border/70 rounded-md overflow-hidden overflow-x-auto">
                    <Table>
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead className="w-[200px] sticky left-0 bg-muted/50 z-10">Permission</TableHead>
                          {(rolesList ?? []).map((role: any) => (
                            <TableHead key={role.id} className="text-center capitalize min-w-[100px]">
                              {role.name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(permsList ?? []).map((perm: any) => (
                          <RBACPermissionRow
                            key={perm.id}
                            permission={perm}
                            roles={rolesList ?? []}
                            canEdit={canEditRbac}
                            permsByRoleId={permsByRoleId}
                          />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="inbox" className="mt-6">
            <InboxTab />
          </TabsContent>
        </Tabs>
      </PageShell>
    </StaffLayout>
  );
}

function InboxTab() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string>("unread");
  const [viewingEmail, setViewingEmail] = useState<any | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data: emails, isLoading, isError, error } = useQuery<any[]>({
    queryKey: ["/api/inbound-emails", statusFilter],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/inbound-emails?status=${statusFilter}`);
      return res.json();
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest("PATCH", `/api/inbound-emails/${id}`, { status });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/inbound-emails"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: string }) => {
      const res = await apiRequest("POST", `/api/inbound-emails/${id}/reply`, { body });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reply sent" });
      setViewingEmail(null);
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["/api/inbound-emails"] });
    },
    onError: (e: any) => toast({ title: "Reply failed", description: e.message, variant: "destructive" }),
  });

  const notEnabled = isError && String((error as any)?.message || "").includes("isn't included in your current plan");

  return (
    <CardSection
      title="Inbound Email"
      description="Mail received at your organisation's inbound address. View a message and reply directly — replies are sent from your organisation's own email address."
      icon={Globe}
    >
      <div className="p-6 space-y-4">
        {notEnabled ? (
          <EmptyState
            title="Inbound email isn't enabled for your organisation"
            description="Ask your platform contact to enable the Email Inbound module for your account."
          />
        ) : (
          <>
            <div className="flex items-center gap-2">
              {["unread", "reviewed", "archived"].map((s) => (
                <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </Button>
              ))}
            </div>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : !emails || emails.length === 0 ? (
              <EmptyState title="Nothing here" description={`No ${statusFilter} messages.`} />
            ) : (
              <div className="border border-border/70 rounded-md overflow-hidden overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Received</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {emails.map((e: any) => (
                      <TableRow key={e.id}>
                        <TableCell className="text-sm">{e.fromAddress}</TableCell>
                        <TableCell className="text-sm">{e.subject || "(no subject)"}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{new Date(e.receivedAt).toLocaleString()}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button size="sm" variant="outline" onClick={() => { setViewingEmail(e); setReplyText(""); }}>
                            View
                          </Button>
                          {statusFilter !== "reviewed" && (
                            <Button size="sm" variant="outline" onClick={() => updateMutation.mutate({ id: e.id, status: "reviewed" })}>
                              Mark reviewed
                            </Button>
                          )}
                          {statusFilter !== "archived" && (
                            <Button size="sm" variant="ghost" onClick={() => updateMutation.mutate({ id: e.id, status: "archived" })}>
                              Archive
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={!!viewingEmail} onOpenChange={(open) => { if (!open) { setViewingEmail(null); setReplyText(""); } }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{viewingEmail?.subject || "(no subject)"}</DialogTitle>
            <DialogDescription>
              From {viewingEmail?.fromAddress} · {viewingEmail ? new Date(viewingEmail.receivedAt).toLocaleString() : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border/70 bg-muted/30 p-3 text-sm whitespace-pre-wrap">
            {viewingEmail?.bodyText?.trim() || "(No text content — this message may only contain HTML or attachments not shown here.)"}
          </div>
          {viewingEmail?.linkedNote && (
            <div className="max-h-32 overflow-y-auto rounded-md border border-border/70 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
              {viewingEmail.linkedNote}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="inbound-reply">Reply</Label>
            <Textarea
              id="inbound-reply"
              rows={5}
              placeholder="Type your reply…"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setViewingEmail(null); setReplyText(""); }}>
              Close
            </Button>
            <Button
              disabled={!replyText.trim() || replyMutation.isPending}
              onClick={() => viewingEmail && replyMutation.mutate({ id: viewingEmail.id, body: replyText.trim() })}
            >
              {replyMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Send reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardSection>
  );
}

function RBACPermissionRow({
  permission,
  roles,
  canEdit,
  permsByRoleId,
}: {
  permission: any;
  roles: any[];
  canEdit: boolean;
  permsByRoleId: Record<string, any[] | undefined>;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const toggleMutation = useMutation({
    mutationFn: async ({ roleId, permId, grant }: { roleId: string; permId: string; grant: boolean }) => {
      if (grant) {
        await apiRequest("POST", `/api/roles/${roleId}/permissions/${permId}`);
      } else {
        await apiRequest("DELETE", `/api/roles/${roleId}/permissions/${permId}`);
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/roles/${variables.roleId}/permissions`] });
    },
    onError: (err: any) => {
      toast({ title: "Failed to update permission", description: err?.message ?? "Unknown error", variant: "destructive" });
    },
  });

  return (
    <TableRow>
      <TableCell className="font-mono text-xs sticky left-0 bg-card z-10">{permission.name}</TableCell>

      {roles.map((role: any) => {
        if (role.name === "superuser") {
          return (
            <TableCell key={role.id} className="text-center text-primary">
              <Check className="h-4 w-4 mx-auto" />
            </TableCell>
          );
        }

        const perms = permsByRoleId[role.id];
        const loading = perms === undefined;
        const hasPerm = perms?.some((p: any) => p.id === permission.id);

        const handleToggle = () => {
          if (!canEdit || loading) return;
          toggleMutation.mutate({ roleId: role.id, permId: permission.id, grant: !hasPerm });
        };

        return (
          <TableCell
            key={role.id}
            className={`text-center ${canEdit ? "cursor-pointer hover:bg-muted/50 transition-colors" : ""}`}
            onClick={handleToggle}
          >
            {loading ? (
              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
            ) : hasPerm ? (
              <Check className="h-4 w-4 mx-auto text-primary" />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}