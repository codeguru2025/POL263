import { useState, useEffect, type ChangeEvent } from "react";
import { useSearch, useLocation } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
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
  FileText,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { apiRequest, getCsrfToken } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { resolveAssetUrl } from "@/lib/assetUrl";

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
  const validTabs = ["terms", "rbac", "adverts", "account"];
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
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            {!isControlPlaneMode && <TabsTrigger value="terms">Terms</TabsTrigger>}
            {!isControlPlaneMode && canManageSettings && <TabsTrigger value="adverts">Receipt Adverts</TabsTrigger>}
            {!isControlPlaneMode && <TabsTrigger value="rbac">RBAC</TabsTrigger>}
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