import { useState, useEffect, type ChangeEvent } from "react";
import { useSearch, useLocation } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { FeatureFlagsCard } from "@/components/feature-flags-card";
import {
  Check,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  KeyRound,
  Shield,
  Building2,
  ArrowRightLeft,
  Globe,
  Settings as SettingsIcon,
  Users,
  FileText,
  Eye,
  EyeOff,
  CreditCard,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { resolveAssetUrl, getDefaultLogoUrl } from "@/lib/assetUrl";

export default function StaffSettings() {
  const { user, permissions: userPerms, isPlatformOwner } = useAuth();
  const effectiveOrgId = user?.effectiveOrganizationId ?? user?.organizationId ?? null;
  const isControlPlaneMode = isPlatformOwner && !effectiveOrgId;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const permissions = Array.isArray(userPerms) ? userPerms : [];
  const canEditRbac = permissions.includes("write:role") || permissions.includes("create:tenant");
  const canManageTenants = permissions.includes("create:tenant") || permissions.includes("delete:tenant");
  const canCreateTenant = permissions.includes("create:tenant");
  const canDeleteTenant = permissions.includes("delete:tenant");
  // Only administrators (write:organization) and platform owner can change org/branding/payments settings.
  const canOrgAdmin = isPlatformOwner || permissions.includes("write:organization");
  const search = useSearch();
  const [, setLocation] = useLocation();
  const tabParam = typeof window !== "undefined" ? new URLSearchParams(search).get("tab") : null;
  const defaultTab =
    isControlPlaneMode && canManageTenants
      ? "tenants"
      : tabParam === "tenants" && canManageTenants
      ? "tenants"
      : (tabParam === "branding" || tabParam === "payments") && canOrgAdmin
      ? tabParam
      : tabParam === "terms"
        ? "terms"
        : tabParam === "rbac"
          ? "rbac"
          : tabParam === "account"
            ? "account"
            : canOrgAdmin ? "branding" : "account";
  const [activeTab, setActiveTab] = useState(defaultTab);

  useEffect(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    if (isControlPlaneMode && canManageTenants) {
      setActiveTab("tenants");
      return;
    }
    if (t === "tenants" && canManageTenants) setActiveTab(t);
    else if ((t === "branding" || t === "payments") && canOrgAdmin) setActiveTab(t);
    else if (t === "terms" || t === "rbac" || t === "account") setActiveTab(t);
    else setActiveTab(canOrgAdmin ? "branding" : "account");
  }, [search, canManageTenants, isControlPlaneMode, canOrgAdmin]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setLocation(value === "branding" ? "/staff/settings" : `/staff/settings?tab=${value}`);
  };

  const {
    data: orgs,
    isLoading: orgsLoading,
    isError: isOrgsError,
    error: orgsError,
    refetch: refetchOrgsList,
  } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  // Safe list for tenants tab: API can return array, null (403), or undefined (loading/error)
  const orgsList = Array.isArray(orgs) ? orgs : [];
  const orgsForbidden = orgs === null;

  const { data: rolesList } = useQuery<any[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permsList } = useQuery<any[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: termsList } = useQuery<any[]>({
    queryKey: ["/api/terms?all=true"],
  });

  const currentOrg = isPlatformOwner && effectiveOrgId
    ? (Array.isArray(orgs) ? orgs.find((o: any) => o.id === effectiveOrgId) ?? orgs[0] : undefined)
    : orgs?.[0];

  // Fetch the full org record (always includes paynow fields even for admin users
  // whose /api/organizations list goes through the control-plane path that omits them).
  const { data: fullOrg } = useQuery<any>({
    queryKey: ["/api/organizations", currentOrg?.id],
    enabled: !!currentOrg?.id,
  });

  const [orgName, setOrgName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [footerText, setFooterText] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [logoUploading, setLogoUploading] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);
  const [policyNumberPrefix, setPolicyNumberPrefix] = useState("");
  const [policyNumberPadding, setPolicyNumberPadding] = useState(5);
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [isWhitelabeled, setIsWhitelabeled] = useState(false);

  // ── PayNow per-tenant credentials ────────────────────────────
  const [pnIntegrationId, setPnIntegrationId] = useState("");
  const [pnIntegrationKey, setPnIntegrationKey] = useState("");
  const [pnAuthEmail, setPnAuthEmail] = useState("");
  const [pnReturnUrl, setPnReturnUrl] = useState("");
  const [pnResultUrl, setPnResultUrl] = useState("");
  const [pnMode, setPnMode] = useState<"test" | "live">("test");
  const [showPnKey, setShowPnKey] = useState(false);

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
  const [advertImageUploading, setAdvertImageUploading] = useState(false);
  const [advertDeleteId, setAdvertDeleteId] = useState<string | null>(null);

  const { data: advertsList = [], refetch: refetchAdverts } = useQuery<any[]>({
    queryKey: ["/api/receipt-adverts"],
    enabled: !isControlPlaneMode,
  });

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
    setAdvertDialogOpen(true);
  }

  async function handleAdvertImageUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setAdvertImageUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const csrf = getCsrfToken();
      const res = await fetch("/api/upload/receipt-advert-image", {
        method: "POST",
        headers: csrf ? { "x-csrf-token": csrf } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      setAdvertImageUrl(json.url);
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setAdvertImageUploading(false);
    }
  }

  function handleSaveAdvert() {
    const data = { title: advertTitle.trim(), body: advertBody.trim(), imageUrl: advertImageUrl.trim() };
    if (editingAdvertId) updateAdvertMutation.mutate({ id: editingAdvertId, data });
    else createAdvertMutation.mutate(data);
  }

  const [changePasswordCurrent, setChangePasswordCurrent] = useState("");
  const [changePasswordNew, setChangePasswordNew] = useState("");
  const [changePasswordConfirm, setChangePasswordConfirm] = useState("");
  const canManagePermissions = permissions.includes("manage:permissions");

  const [tenantAddOpen, setTenantAddOpen] = useState(false);
  const [tenantEditId, setTenantEditId] = useState<string | null>(null);
  const [tenantDeleteId, setTenantDeleteId] = useState<string | null>(null);
  const [editingTenantForm, setEditingTenantForm] = useState({ name: "", email: "", phone: "", isWhitelabeled: false, databaseUrl: "" });
  const [newTenant, setNewTenant] = useState({
    name: "",
    adminEmail: "",
    adminPassword: "",
    adminDisplayName: "",
    phone: "",
    email: "",
    isWhitelabeled: false,
    databaseUrl: "",
  });

  useEffect(() => {
    if (currentOrg) {
      setOrgName(currentOrg.name || "");
      setPrimaryColor(currentOrg.primaryColor || "");
      setFooterText(currentOrg.footerText || "");
      setAddress(currentOrg.address || "");
      setPhone(currentOrg.phone || "");
      setEmail(currentOrg.email || "");
      setWebsite(currentOrg.website || "");
      setLogoUrl(currentOrg.logoUrl || "");
      setSignatureUrl(currentOrg.signatureUrl || "");
      setPolicyNumberPrefix(currentOrg.policyNumberPrefix ?? "");
      setPolicyNumberPadding(typeof currentOrg.policyNumberPadding === "number" ? currentOrg.policyNumberPadding : 5);
      setDatabaseUrl(currentOrg.databaseUrl ?? "");
      setIsWhitelabeled(currentOrg.isWhitelabeled ?? false);
    }
  }, [currentOrg]);

  // Paynow fields come from fullOrg (single-org endpoint always returns all columns).
  // The /api/organizations list uses a control-plane query for admins that omits paynow fields.
  useEffect(() => {
    const src = fullOrg ?? currentOrg;
    if (src) {
      setPnIntegrationId(src.paynowIntegrationId ?? "");
      setPnIntegrationKey(src.paynowIntegrationKey ?? "");
      setPnAuthEmail(src.paynowAuthEmail ?? "");
      setPnReturnUrl(src.paynowReturnUrl ?? "");
      setPnResultUrl(src.paynowResultUrl ?? "");
      setPnMode(src.paynowMode ?? "test");
    }
  }, [fullOrg, currentOrg]);

  const updateOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/organizations/${currentOrg?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      if (currentOrg?.id) queryClient.invalidateQueries({ queryKey: ["/api/organizations", currentOrg.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/branding"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/product-performance"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

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

  const createTenantMutation = useMutation({
    mutationFn: async (data: typeof newTenant) => {
      const res = await apiRequest("POST", "/api/organizations", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      setTenantAddOpen(false);
      setNewTenant({ name: "", adminEmail: "", adminPassword: "", adminDisplayName: "", phone: "", email: "", isWhitelabeled: false, databaseUrl: "" });
      toast({ title: "Tenant created", description: `${data?.name ?? "New tenant"} is ready.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create tenant", variant: "destructive" });
    },
  });

  const deleteTenantMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/organizations/${id}`);
    },
    onSuccess: (_data, deletedId) => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      // If the deleted tenant was the one we were actively managing, clear auth state
      // so the layout reflects the owner is now in no-tenant (control-plane) mode.
      if (deletedId === effectiveOrgId) {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
      setTenantDeleteId(null);
      toast({ title: "Tenant removed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to remove tenant", variant: "destructive" });
    },
  });

  const switchTenantMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", "/api/platform/switch-tenant", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      window.location.href = "/staff";
    },
    onError: (err: any) => {
      toast({ title: "Switch failed", description: err.message || "Could not switch tenant", variant: "destructive" });
    },
  });

  // Fetch full tenant record when edit dialog opens so databaseUrl (and other
  // fields absent from the control-plane list query) are pre-populated correctly.
  const { data: editingTenantFull } = useQuery<any>({
    queryKey: ["/api/organizations", tenantEditId],
    enabled: !!tenantEditId,
  });

  useEffect(() => {
    if (!tenantEditId) return;
    // Prefer the full record (has databaseUrl); fall back to the list entry.
    const org = editingTenantFull ?? orgsList.find((o: any) => o.id === tenantEditId);
    if (org) {
      setEditingTenantForm({
        name: org.name || "",
        email: org.email || "",
        phone: org.phone || "",
        isWhitelabeled: org.isWhitelabeled ?? false,
        databaseUrl: org.databaseUrl ?? "",
      });
    }
  }, [tenantEditId, editingTenantFull, orgsList]);

  const updateTenantMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/organizations/${id}`, data);
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/organizations", vars.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/public/branding"] });
      setTenantEditId(null);
      toast({ title: "Tenant updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update tenant", variant: "destructive" });
    },
  });

  const handleCreateTenant = () => {
    if (!newTenant.name.trim()) return;
    if (newTenant.adminPassword && newTenant.adminPassword.length < 8) {
      toast({
        title: "Validation error",
        description: "Admin password must be at least 8 characters",
        variant: "destructive",
      });
      return;
    }
    createTenantMutation.mutate(newTenant);
  };

  const handleSaveBranding = () => {
    const updates: any = {};
    if (orgName) updates.name = orgName;
    if (primaryColor) updates.primaryColor = primaryColor;
    if (footerText !== undefined) updates.footerText = footerText;
    if (address !== undefined) updates.address = address;
    if (phone !== undefined) updates.phone = phone;
    if (email !== undefined) updates.email = email;
    if (website !== undefined) updates.website = website;
    if (logoUrl !== undefined) updates.logoUrl = logoUrl || null;
    if (signatureUrl !== undefined) updates.signatureUrl = signatureUrl || null;
    if (policyNumberPrefix !== undefined) updates.policyNumberPrefix = policyNumberPrefix || null;
    if (policyNumberPadding !== undefined)
      updates.policyNumberPadding = Math.max(1, Math.min(20, policyNumberPadding));
    if (isPlatformOwner) {
      if (databaseUrl !== undefined) updates.databaseUrl = databaseUrl.trim() || null;
      updates.isWhitelabeled = isWhitelabeled;
    }
    updateOrgMutation.mutate(updates);
  };

  const getApiBase = () => {
    const u = typeof window !== "undefined" ? window.location.origin : "";
    return u;
  };

  const handleLogoUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    setLogoUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/upload/logo", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Upload failed", description: err.message || "Logo must be PNG, JPG, or WebP.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setLogoUrl(data.url);
      updateOrgMutation.mutate({ logoUrl: data.url });
    } finally {
      setLogoUploading(false);
      e.target.value = "";
    }
  };

  const handleSignatureUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    setSignatureUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/upload/signature", {
        method: "POST",
        headers,
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast({ title: "Upload failed", description: err.message || "Signature must be PNG or WebP.", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setSignatureUrl(data.url);
      updateOrgMutation.mutate({ signatureUrl: data.url });
    } finally {
      setSignatureUploading(false);
      e.target.value = "";
    }
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

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Settings"
          description="Manage organization settings and Role-Based Access Control."
        />

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList
            className={`grid w-full max-w-3xl ${
              isControlPlaneMode
                ? (canManageTenants ? "grid-cols-2" : "grid-cols-1")
                : (() => {
                    // Visible tabs: Tenants? | Branding? | Account | Payments? | Terms | RBAC
                    // Branding and Payments both require canOrgAdmin
                    const orgAdminTabs = canOrgAdmin ? 2 : 0; // branding + payments
                    const baseTabs = 3; // account + terms + rbac
                    const tenantTab = canManageTenants ? 1 : 0;
                    const total = tenantTab + orgAdminTabs + baseTabs;
                    if (total === 6) return "grid-cols-6";
                    if (total === 5) return "grid-cols-5";
                    if (total === 4) return "grid-cols-4";
                    return "grid-cols-3";
                  })()
            }`}
          >
            {canManageTenants && <TabsTrigger value="tenants">Tenants</TabsTrigger>}
            {!isControlPlaneMode && canOrgAdmin && <TabsTrigger value="branding">Branding</TabsTrigger>}
            <TabsTrigger value="account">Account</TabsTrigger>
            {!isControlPlaneMode && canOrgAdmin && <TabsTrigger value="payments">Payments</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="terms">Terms</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="rbac">RBAC</TabsTrigger>}
          </TabsList>

          {canManageTenants && (
            <TabsContent value="tenants" className="mt-6">
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                      <Globe className="h-6 w-6 text-primary" />
                      Platform Administration
                    </h2>
                    <p className="text-muted-foreground mt-1">Manage tenant organizations across the platform.</p>
                  </div>
                  {canCreateTenant && (
                    <Button onClick={() => setTenantAddOpen(true)} data-testid="btn-add-tenant">
                      <Plus className="h-4 w-4 mr-2" />
                      New tenant
                    </Button>
                  )}
                </div>

                {orgsLoading ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-4">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Loading tenants…</p>
                  </div>
                ) : isOrgsError ? (
                  <EmptyState
                    icon={Building2}
                    title="Could not load tenants"
                    description={orgsError instanceof Error ? orgsError.message : "Something went wrong."}
                    action={<Button variant="outline" onClick={() => refetchOrgsList()}>Try again</Button>}
                    className="py-16"
                  />
                ) : orgsForbidden ? (
                  <EmptyState
                    icon={Shield}
                    title="Access restricted"
                    description="You don't have permission to view or manage tenants."
                    className="py-16"
                  />
                ) : orgsList.length === 0 ? (
                  <EmptyState
                    icon={Building2}
                    title="No tenants yet"
                    description="Create your first tenant to get started."
                    action={
                      canCreateTenant ? (
                        <Button onClick={() => setTenantAddOpen(true)}>
                          <Plus className="h-4 w-4 mr-2" />
                          Create tenant
                        </Button>
                      ) : undefined
                    }
                    className="py-16"
                  />
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {orgsList.map((org: any) => {
                      const isActive = isPlatformOwner && org.id === effectiveOrgId;
                      return (
                        <Card
                          key={org.id}
                          className={`relative transition-shadow hover:shadow-md ${isActive ? "ring-2 ring-primary" : ""}`}
                        >
                          {isActive && (
                            <Badge className="absolute top-3 right-3 bg-primary/15 text-primary border-primary/30" variant="outline">
                              Active
                            </Badge>
                          )}
                          <CardHeader className="pb-3">
                            <div className="flex items-start gap-3">
                              {org.logoUrl ? (
                                <img src={resolveAssetUrl(org.logoUrl)} alt="" className="h-10 w-10 rounded-lg object-contain border bg-white shrink-0" loading="lazy" />
                              ) : (
                                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                                  <Building2 className="h-5 w-5 text-primary" />
                                </div>
                              )}
                              <div className="min-w-0 flex-1">
                                <CardTitle className="text-base truncate">{org.name}</CardTitle>
                                <CardDescription className="text-xs truncate">{org.email || "No contact email"}</CardDescription>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent className="pt-0">
                            <div className="text-xs text-muted-foreground space-y-1 mb-4">
                              {org.phone && <p>Phone: {org.phone}</p>}
                              <p className="font-mono opacity-60">ID: {org.id.slice(0, 8)}...</p>
                            </div>
                            <div className="flex gap-2">
                              {isPlatformOwner && (
                                <Button
                                  variant={isActive ? "secondary" : "default"}
                                  size="sm"
                                  className="flex-1"
                                  disabled={isActive || switchTenantMutation.isPending}
                                  onClick={() => switchTenantMutation.mutate(org.id)}
                                >
                                  <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                                  {isActive ? "Current" : "Switch"}
                                </Button>
                              )}
                              {isPlatformOwner && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setTenantEditId(org.id)}
                                  data-testid={`btn-edit-tenant-${org.id}`}
                                  aria-label="Edit tenant"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  if (isPlatformOwner) {
                                    switchTenantMutation.mutate(org.id, {
                                      onSuccess: () => {
                                        window.location.href = "/staff/settings?tab=branding";
                                      },
                                    });
                                  } else {
                                    handleTabChange("branding");
                                  }
                                }}
                              >
                                <SettingsIcon className="h-3.5 w-3.5" />
                              </Button>
                              {canDeleteTenant && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setTenantDeleteId(org.id)}
                                  data-testid={`btn-delete-tenant-${org.id}`}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              <Dialog open={tenantAddOpen} onOpenChange={setTenantAddOpen}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Create new tenant</DialogTitle>
                    <DialogDescription>Create a new organization. You can optionally set up an admin account now, or add one later.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-2">
                    <div className="space-y-2">
                      <Label htmlFor="tenant-org-name">Organization name *</Label>
                      <Input
                        id="tenant-org-name"
                        value={newTenant.name}
                        onChange={(e) => setNewTenant((p) => ({ ...p, name: e.target.value }))}
                        placeholder="e.g. Acme Insurance"
                        data-testid="input-tenant-name"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tenant-org-email">Organization email</Label>
                      <Input
                        id="tenant-org-email"
                        type="email"
                        value={newTenant.email}
                        onChange={(e) => setNewTenant((p) => ({ ...p, email: e.target.value }))}
                        placeholder="info@acme.com"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="tenant-org-phone">Organization phone</Label>
                      <Input
                        id="tenant-org-phone"
                        value={newTenant.phone}
                        onChange={(e) => setNewTenant((p) => ({ ...p, phone: e.target.value }))}
                        placeholder="+1 555 0100"
                      />
                    </div>
                    {isPlatformOwner && (
                      <>
                        <div className="flex items-center justify-between rounded-lg border p-4">
                          <div className="space-y-0.5">
                            <Label htmlFor="new-tenant-whitelabel" className="font-medium">White-Label Mode</Label>
                            <p className="text-xs text-muted-foreground">
                              When enabled, the app will show this tenant&apos;s name and logo instead of POL263.
                            </p>
                          </div>
                          <Switch
                            id="new-tenant-whitelabel"
                            checked={newTenant.isWhitelabeled}
                            onCheckedChange={(v) => setNewTenant((p) => ({ ...p, isWhitelabeled: v === true }))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="new-tenant-databaseUrl">Dedicated Database URL (optional)</Label>
                          <Input
                            id="new-tenant-databaseUrl"
                            type="password"
                            autoComplete="off"
                            value={newTenant.databaseUrl}
                            onChange={(e) => setNewTenant((p) => ({ ...p, databaseUrl: e.target.value }))}
                            placeholder="postgresql://... (leave empty for shared database)"
                          />
                          <p className="text-xs text-muted-foreground">
                            When set, this tenant&apos;s data is stored in a separate database.
                          </p>
                        </div>
                      </>
                    )}
                    <div className="border-t pt-4 space-y-4">
                      <p className="text-sm font-medium flex items-center gap-2">
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Tenant administrator account
                      </p>
                      <div className="space-y-2">
                        <Label htmlFor="tenant-admin-name">Display name</Label>
                        <Input
                          id="tenant-admin-name"
                          value={newTenant.adminDisplayName}
                          onChange={(e) => setNewTenant((p) => ({ ...p, adminDisplayName: e.target.value }))}
                          placeholder="John Doe"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tenant-admin-email">Email</Label>
                        <Input
                          id="tenant-admin-email"
                          type="email"
                          value={newTenant.adminEmail}
                          onChange={(e) => setNewTenant((p) => ({ ...p, adminEmail: e.target.value }))}
                          placeholder="admin@acme.com"
                          data-testid="input-admin-email"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tenant-admin-password">Password (min 8 chars)</Label>
                        <Input
                          id="tenant-admin-password"
                          type="password"
                          value={newTenant.adminPassword}
                          onChange={(e) => setNewTenant((p) => ({ ...p, adminPassword: e.target.value }))}
                          placeholder="Minimum 8 characters"
                          data-testid="input-admin-password"
                        />
                      </div>
                    </div>
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTenantAddOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreateTenant}
                      disabled={!newTenant.name.trim() || createTenantMutation.isPending}
                      data-testid="btn-confirm-add-tenant"
                    >
                      {createTenantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Create tenant
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <Dialog open={!!tenantEditId} onOpenChange={(open) => !open && setTenantEditId(null)}>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Edit tenant</DialogTitle>
                    <DialogDescription>Update organization details and platform owner settings.</DialogDescription>
                  </DialogHeader>
                  {tenantEditId && (
                    <div className="space-y-4 py-2">
                      <div className="space-y-2">
                        <Label htmlFor="edit-tenant-name">Organization name *</Label>
                        <Input
                          id="edit-tenant-name"
                          value={editingTenantForm.name}
                          onChange={(e) => setEditingTenantForm((p) => ({ ...p, name: e.target.value }))}
                          placeholder="e.g. Acme Insurance"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-tenant-email">Organization email</Label>
                        <Input
                          id="edit-tenant-email"
                          type="email"
                          value={editingTenantForm.email}
                          onChange={(e) => setEditingTenantForm((p) => ({ ...p, email: e.target.value }))}
                          placeholder="info@acme.com"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-tenant-phone">Organization phone</Label>
                        <Input
                          id="edit-tenant-phone"
                          value={editingTenantForm.phone}
                          onChange={(e) => setEditingTenantForm((p) => ({ ...p, phone: e.target.value }))}
                          placeholder="+1 555 0100"
                        />
                      </div>
                      <div className="flex items-center justify-between rounded-lg border p-4">
                        <div className="space-y-0.5">
                          <Label htmlFor="edit-tenant-whitelabel" className="font-medium">White-Label Mode</Label>
                          <p className="text-xs text-muted-foreground">
                            When enabled, the app shows this tenant&apos;s name and logo instead of POL263.
                          </p>
                        </div>
                        <Switch
                          id="edit-tenant-whitelabel"
                          checked={editingTenantForm.isWhitelabeled}
                          onCheckedChange={(v) => setEditingTenantForm((p) => ({ ...p, isWhitelabeled: v === true }))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="edit-tenant-databaseUrl">Dedicated Database URL (optional)</Label>
                        <Input
                          id="edit-tenant-databaseUrl"
                          type="password"
                          autoComplete="off"
                          value={editingTenantForm.databaseUrl}
                          onChange={(e) => setEditingTenantForm((p) => ({ ...p, databaseUrl: e.target.value }))}
                          placeholder="postgresql://... (leave empty for shared database)"
                        />
                      </div>
                    </div>
                  )}
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setTenantEditId(null)}>Cancel</Button>
                    <Button
                      onClick={() => {
                        if (!tenantEditId || !editingTenantForm.name.trim()) return;
                        updateTenantMutation.mutate({
                          id: tenantEditId,
                          data: {
                            name: editingTenantForm.name.trim(),
                            email: editingTenantForm.email || null,
                            phone: editingTenantForm.phone || null,
                            isWhitelabeled: editingTenantForm.isWhitelabeled,
                            databaseUrl: editingTenantForm.databaseUrl.trim() || null,
                          },
                        });
                      }}
                      disabled={!editingTenantForm.name.trim() || updateTenantMutation.isPending}
                    >
                      {updateTenantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Save changes
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <AlertDialog open={!!tenantDeleteId} onOpenChange={(open) => !open && setTenantDeleteId(null)}>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Remove tenant?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will soft-delete <strong>{orgsList.find((o: any) => o.id === tenantDeleteId)?.name ?? "this tenant"}</strong>. The tenant must have no active users. This action cannot be easily undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => tenantDeleteId && deleteTenantMutation.mutate(tenantDeleteId)}
                      disabled={deleteTenantMutation.isPending}
                    >
                      {deleteTenantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                      Remove
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </TabsContent>
          )}

          {/* Branding — only admins with write:organization */}
          {canOrgAdmin && <TabsContent value="branding" className="mt-6">
            <CardSection
              title="Organization branding"
              description="Customize the look and feel for this specific tenant."
              icon={SettingsIcon}
            >
              <div className="space-y-6">
                <div className="space-y-4">
                  <Label>Organization Logo</Label>
                  <div className="flex items-center gap-6">
                    <div className="h-28 w-28 rounded-xl border-2 border-dashed flex items-center justify-center bg-white overflow-hidden shrink-0 relative">
                      {logoUploading ? (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      ) : (logoUrl || currentOrg?.logoUrl) ? (
                        <img
                          key={logoUrl || currentOrg?.logoUrl}
                          src={resolveAssetUrl(logoUrl || currentOrg?.logoUrl)}
                          alt="Current Logo"
                          className="object-contain max-h-full max-w-full p-1"
                          onError={(e) => { (e.target as HTMLImageElement).src = getDefaultLogoUrl(); }}
                        />
                      ) : (
                        <img src={getDefaultLogoUrl()} alt="Default" className="object-contain max-h-full max-w-full p-1 opacity-40" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <input id="logo-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleLogoUpload} />
                      <Button type="button" variant="outline" disabled={logoUploading} onClick={() => document.getElementById("logo-upload")?.click()}>
                        {logoUploading ? "Uploading…" : "Upload Logo"}
                      </Button>
                      <p className="text-xs text-muted-foreground">PNG, JPG, or WebP. Transparent background recommended.</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <Label>Authorized Signature (for receipts & policy documents)</Label>
                  <div className="flex items-center gap-6">
                    <div className="h-20 w-48 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/20 overflow-hidden shrink-0">
                      {signatureUploading ? (
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      ) : (signatureUrl || currentOrg?.signatureUrl) ? (
                        <img
                          key={signatureUrl || currentOrg?.signatureUrl}
                          src={resolveAssetUrl(signatureUrl || currentOrg?.signatureUrl)}
                          alt="Signature"
                          className="object-contain max-h-full max-w-full p-1"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No signature uploaded</span>
                      )}
                    </div>
                    <div className="space-y-2">
                      <input id="sig-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleSignatureUpload} />
                      <Button type="button" variant="outline" disabled={signatureUploading} onClick={() => document.getElementById("sig-upload")?.click()}>
                        {signatureUploading ? "Uploading…" : "Upload Signature"}
                      </Button>
                      <p className="text-xs text-muted-foreground">PNG, JPG, or WebP. Transparent background recommended.</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input id="orgName" value={orgName} onChange={(e) => setOrgName(e.target.value)} />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="address">Address</Label>
                    <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street, city, country" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+263 ..." />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="email">Email</Label>
                      <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="contact@example.com" />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="website">Website</Label>
                    <Input id="website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://..." />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="primaryColor">Primary Color</Label>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        id="primaryColor"
                        value={primaryColor || currentOrg?.primaryColor || "#0d9488"}
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        className="h-10 w-10 rounded border cursor-pointer p-0.5"
                      />
                      <Input
                        value={primaryColor || currentOrg?.primaryColor || "#0d9488"}
                        className="font-mono w-32"
                        onChange={(e) => setPrimaryColor(e.target.value)}
                        maxLength={7}
                        placeholder="#0d9488"
                      />
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {["#0d9488","#D4AF37","#2563EB","#DC2626","#16A34A","#9333EA","#EA580C","#0891B2","#DB2777","#4F46E5","#CA8A04","#059669","#1E293B"].map((c) => (
                        <button
                          key={c}
                          type="button"
                          className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                            primaryColor === c ? "border-foreground ring-2 ring-offset-2 ring-primary" : "border-transparent"
                          }`}
                          style={{ backgroundColor: c }}
                          onClick={() => setPrimaryColor(c)}
                          title={c}
                        />
                      ))}
                    </div>
                  </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="footerText">Footer Text (on documents)</Label>
                    <Input id="footerText" value={footerText} onChange={(e) => setFooterText(e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="policyNumberPrefix">Policy Number Prefix (optional)</Label>
                      <Input
                        id="policyNumberPrefix"
                        value={policyNumberPrefix}
                        onChange={(e) => setPolicyNumberPrefix(e.target.value)}
                        placeholder="e.g. POL- or leave empty"
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="policyNumberPadding">Policy Number Padding (digits)</Label>
                      <Input
                        id="policyNumberPadding"
                        type="number"
                        min={1}
                        max={20}
                        value={policyNumberPadding}
                        onChange={(e) => setPolicyNumberPadding(parseInt(e.target.value, 10) || 5)}
                      />
                      <p className="text-xs text-muted-foreground">e.g. 5 → 00001, 00002 (per tenant)</p>
                    </div>
                  </div>

                <Button onClick={handleSaveBranding} disabled={updateOrgMutation.isPending}>
                  {updateOrgMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    "Save Branding Changes"
                  )}
                </Button>

                {updateOrgMutation.isSuccess && (
                  <p className="text-sm text-emerald-600 flex items-center gap-1">
                    <Check className="h-4 w-4" /> Saved successfully. Audit log entry created.
                  </p>
                )}
              </div>
            </CardSection>

            {/* Receipt Adverts */}
            {!isControlPlaneMode && (
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
            )}

            {/* Advert create/edit dialog */}
            <Dialog open={advertDialogOpen} onOpenChange={(v) => { if (!v) { setAdvertDialogOpen(false); resetAdvertForm(); } else setAdvertDialogOpen(true); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingAdvertId ? "Edit Advert" : "New Receipt Advert"}</DialogTitle>
                  <DialogDescription>This advert will appear at the bottom of all printed receipts when set as active.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-2">
                  <div className="space-y-2">
                    <Label>Advert Image <span className="text-muted-foreground text-xs">(optional)</span></Label>
                    <div className="flex items-center gap-4">
                      <div className="h-20 w-32 rounded border flex items-center justify-center bg-muted/20 overflow-hidden shrink-0">
                        {advertImageUrl ? (
                          <img key={advertImageUrl} src={resolveAssetUrl(advertImageUrl)} alt="Advert" className="object-contain max-h-full max-w-full p-1" />
                        ) : (
                          <span className="text-xs text-muted-foreground text-center px-2">No image</span>
                        )}
                      </div>
                      <div className="space-y-1">
                        <input id="advert-img-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden" onChange={handleAdvertImageUpload} />
                        <Button type="button" size="sm" variant="outline" disabled={advertImageUploading} onClick={() => document.getElementById("advert-img-upload")?.click()}>
                          {advertImageUploading ? <><Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> Uploading…</> : "Upload Image"}
                        </Button>
                        {advertImageUrl && (
                          <Button type="button" size="sm" variant="ghost" className="text-destructive text-xs" onClick={() => setAdvertImageUrl("")}>Remove</Button>
                        )}
                        <p className="text-xs text-muted-foreground">PNG, JPG or WebP. Max 5MB.</p>
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
          </TabsContent>}

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
                  <Label htmlFor="newPassword">New password (min 8 characters)</Label>
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
                    changePasswordNew.length < 8 ||
                    changePasswordNew !== changePasswordConfirm ||
                    changePasswordMutation.isPending
                  }
                >
                  {changePasswordMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Change password
                </Button>
              </div>
            </CardSection>

            <div className="mt-6">
              <FeatureFlagsCard />
            </div>
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
              flush
            >
                {termsList === undefined ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : (termsList ?? []).length === 0 ? (
                  <EmptyState
                    title="No terms yet"
                    description="Add one to show on policy documents."
                    className="border-0 rounded-none bg-transparent py-10"
                  />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="w-20">Order</TableHead>
                        <TableHead className="w-24">Active</TableHead>
                        <TableHead className="w-28">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {(termsList ?? []).map((term: any) => (
                        <TableRow key={term.id} className="hover:bg-muted/40">
                          <TableCell className="font-medium">{term.title}</TableCell>
                          <TableCell className="text-muted-foreground">{term.category || "general"}</TableCell>
                          <TableCell>{term.sortOrder}</TableCell>
                          <TableCell>{term.isActive ? "Yes" : "No"}</TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button variant="ghost" size="icon" onClick={() => openEditTermDialog(term)} aria-label="Edit">
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button variant="ghost" size="icon" onClick={() => setTermToDeleteId(term.id)} aria-label="Delete">
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
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
                  <div className="grid grid-cols-2 gap-4">
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

          {/* Payments / PayNow */}
          <TabsContent value="payments" className="mt-6">
            <CardSection
              title="PayNow Integration"
              description="Configure your organisation's PayNow merchant credentials. These override the platform defaults and allow each tenant to use their own merchant account."
              icon={CreditCard}
              headerRight={
                <Button
                  onClick={() =>
                    updateOrgMutation.mutate({
                      paynowIntegrationId: pnIntegrationId || null,
                      paynowIntegrationKey: pnIntegrationKey || null,
                      paynowAuthEmail: pnAuthEmail || null,
                      paynowReturnUrl: pnReturnUrl || null,
                      paynowResultUrl: pnResultUrl || null,
                      paynowMode: pnMode,
                    })
                  }
                  disabled={updateOrgMutation.isPending}
                >
                  {updateOrgMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
                  Save
                </Button>
              }
            >
              <div className="p-6 space-y-5">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="pnIntegrationId">Integration ID</Label>
                    <Input
                      id="pnIntegrationId"
                      value={pnIntegrationId}
                      onChange={(e) => setPnIntegrationId(e.target.value)}
                      placeholder="e.g. 12345"
                    />
                    <p className="text-xs text-muted-foreground">Your PayNow merchant integration ID</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pnIntegrationKey">Integration Key</Label>
                    <div className="relative">
                      <Input
                        id="pnIntegrationKey"
                        type={showPnKey ? "text" : "password"}
                        value={pnIntegrationKey}
                        onChange={(e) => setPnIntegrationKey(e.target.value)}
                        placeholder="Paste key — stored server-side only"
                        className="pr-10"
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPnKey((v) => !v)}
                      >
                        {showPnKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">Leave blank to keep the existing key unchanged</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pnAuthEmail">Auth Email</Label>
                    <Input
                      id="pnAuthEmail"
                      type="email"
                      value={pnAuthEmail}
                      onChange={(e) => setPnAuthEmail(e.target.value)}
                      placeholder="merchant@yourdomain.com"
                    />
                    <p className="text-xs text-muted-foreground">Shown on PayNow card payment page</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pnMode">Mode</Label>
                    <select
                      id="pnMode"
                      value={pnMode}
                      onChange={(e) => setPnMode(e.target.value as "test" | "live")}
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <option value="test">Test</option>
                      <option value="live">Live</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pnReturnUrl">Return URL</Label>
                  <Input
                    id="pnReturnUrl"
                    value={pnReturnUrl}
                    onChange={(e) => setPnReturnUrl(e.target.value)}
                    placeholder="https://yourapp.com/payment-complete"
                  />
                  <p className="text-xs text-muted-foreground">Where the browser redirects after card payment</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="pnResultUrl">Result URL</Label>
                  <Input
                    id="pnResultUrl"
                    value={pnResultUrl}
                    onChange={(e) => setPnResultUrl(e.target.value)}
                    placeholder={`https://yourapp.com/api/payments/paynow/result?org=${currentOrg?.id ?? "<orgId>"}`}
                  />
                  <p className="text-xs text-muted-foreground">
                    Server-side callback where PayNow POSTs payment results. Include <code>?org={currentOrg?.id ?? "<orgId>"}</code> so we verify with your key.
                  </p>
                </div>

                {currentOrg && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 space-y-1">
                    <p className="font-semibold">Suggested Result URL</p>
                    <code className="block text-xs break-all">
                      {`https://yourapp.com/api/payments/paynow/result?org=${currentOrg.id}`}
                    </code>
                    <p>Copy this into the Result URL field above and register it in your PayNow merchant portal.</p>
                  </div>
                )}
              </div>
            </CardSection>
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
        </Tabs>
      </PageShell>
    </StaffLayout>
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