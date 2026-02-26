import { useState, useEffect } from "react";
import StaffLayout from "@/components/layout/staff-layout";
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
import { Check, Loader2, Plus, Pencil, Trash2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export default function StaffSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  const { data: rolesList } = useQuery<any[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permsList } = useQuery<any[]>({
    queryKey: ["/api/permissions"],
  });

  const { data: termsList } = useQuery<any[]>({
    queryKey: ["/api/terms?all=true"],
  });

  const currentOrg = orgs?.[0];

  const [orgName, setOrgName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [footerText, setFooterText] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [signatureUrl, setSignatureUrl] = useState("");
  const [policyNumberPrefix, setPolicyNumberPrefix] = useState("");
  const [policyNumberPadding, setPolicyNumberPadding] = useState(5);
  const [databaseUrl, setDatabaseUrl] = useState("");

  const [termDialogOpen, setTermDialogOpen] = useState(false);
  const [editingTermId, setEditingTermId] = useState<string | null>(null);
  const [termTitle, setTermTitle] = useState("");
  const [termContent, setTermContent] = useState("");
  const [termCategory, setTermCategory] = useState("general");
  const [termSortOrder, setTermSortOrder] = useState(0);
  const [termIsActive, setTermIsActive] = useState(true);
  const [termToDeleteId, setTermToDeleteId] = useState<string | null>(null);

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
    }
  }, [currentOrg]);

  const updateOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/organizations/${currentOrg?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
  });

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
    if (policyNumberPadding !== undefined) updates.policyNumberPadding = Math.max(1, Math.min(20, policyNumberPadding));
    if (databaseUrl !== undefined) updates.databaseUrl = databaseUrl.trim() || null;
    updateOrgMutation.mutate(updates);
  };

  const getApiBase = () => {
    const u = typeof window !== "undefined" ? window.location.origin : "";
    return u;
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(getApiBase() + "/api/upload", {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    setLogoUrl(data.url);
    updateOrgMutation.mutate({ ...currentOrg, logoUrl: data.url });
  };

  const handleSignatureUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentOrg) return;
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch(getApiBase() + "/api/upload", {
      method: "POST",
      body: formData,
      credentials: "include",
    });
    if (!res.ok) return;
    const data = await res.json();
    setSignatureUrl(data.url);
    updateOrgMutation.mutate({ ...currentOrg, signatureUrl: data.url });
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
    mutationFn: async ({ id, data }: { id: string; data: Partial<{ title: string; content: string; category: string; sortOrder: number; isActive: boolean }> }) => {
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

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage organization settings and Role-Based Access Control.</p>
        </div>

        <Tabs defaultValue="branding" className="w-full">
          <TabsList className="grid w-full grid-cols-3 max-w-2xl">
            <TabsTrigger value="branding">Tenant Branding</TabsTrigger>
            <TabsTrigger value="terms">Terms & Conditions</TabsTrigger>
            <TabsTrigger value="rbac">RBAC Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Organization Branding</CardTitle>
                <CardDescription>Customize the look and feel for this specific tenant.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Organization Logo</Label>
                  <div className="flex items-end gap-6">
                    <div className="h-24 w-24 rounded-xl border-2 border-dashed flex items-center justify-center bg-muted/20 overflow-hidden">
                      <img
                        src={logoUrl || currentOrg?.logoUrl || "/assets/logo.png"}
                        alt="Current Logo"
                        className="object-contain max-h-full max-w-full"
                      />
                    </div>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                      <Button type="button" variant="outline">Upload Logo</Button>
                    </label>
                  </div>
                </div>

                <div className="space-y-4">
                  <Label>Authorized Signature (for receipts & policy documents)</Label>
                  <div className="flex items-end gap-6">
                    <div className="h-16 w-40 rounded border flex items-center justify-center bg-muted/20 overflow-hidden">
                      {signatureUrl || currentOrg?.signatureUrl ? (
                        <img
                          src={signatureUrl || currentOrg?.signatureUrl}
                          alt="Signature"
                          className="object-contain max-h-full max-w-full"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">No signature</span>
                      )}
                    </div>
                    <label className="cursor-pointer">
                      <input type="file" accept="image/*" className="hidden" onChange={handleSignatureUpload} />
                      <Button type="button" variant="outline">Upload Signature</Button>
                    </label>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input
                      id="orgName"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="address">Address</Label>
                    <Input
                      id="address"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="Street, city, country"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="phone">Phone</Label>
                      <Input
                        id="phone"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+263 ..."
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="contact@example.com"
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="website">Website</Label>
                    <Input
                      id="website"
                      value={website}
                      onChange={(e) => setWebsite(e.target.value)}
                      placeholder="https://..."
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="primaryColor">Primary Color (Hex)</Label>
                    <div className="flex gap-2">
                      <div
                        className="h-10 w-10 rounded border"
                        style={{ backgroundColor: primaryColor || currentOrg?.primaryColor || "#D4AF37" }}
                      ></div>
                      <Input
                        id="primaryColor"
                        value={primaryColor || currentOrg?.primaryColor || "#D4AF37"}
                        className="font-mono flex-1"
                        onChange={(e) => setPrimaryColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="footerText">Footer Text (on documents)</Label>
                    <Input
                      id="footerText"
                      value={footerText}
                      onChange={(e) => setFooterText(e.target.value)}
                    />
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
                  <div className="grid gap-2">
                    <Label htmlFor="databaseUrl">Tenant database URL (optional)</Label>
                    <Input
                      id="databaseUrl"
                      type="password"
                      autoComplete="off"
                      value={databaseUrl}
                      onChange={(e) => setDatabaseUrl(e.target.value)}
                      placeholder="postgresql://... (leave empty to use default)"
                    />
                    <p className="text-xs text-muted-foreground">
                      When set, this tenant can use a dedicated database. Requires storage to use getDbForOrg(orgId) for tenant data.
                    </p>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="terms" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Terms and Conditions</CardTitle>
                <CardDescription>
                  Manage terms shown on policy documents and e-statements. Only active terms appear on PDFs. Order by sort order.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex justify-end mb-4">
                  <Button onClick={openNewTermDialog}>
                    <Plus className="h-4 w-4 mr-2" /> Add term
                  </Button>
                </div>
                {termsList === undefined ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                ) : termsList.length === 0 ? (
                  <p className="text-muted-foreground text-sm py-6">No terms yet. Add one to show on policy documents.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Title</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead className="w-20">Order</TableHead>
                        <TableHead className="w-24">Active</TableHead>
                        <TableHead className="w-28">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {termsList.map((term: any) => (
                        <TableRow key={term.id}>
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
                  </Table>
                )}
              </CardContent>
            </Card>

            <Dialog open={termDialogOpen} onOpenChange={setTermDialogOpen}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editingTermId ? "Edit term" : "Add term"}</DialogTitle>
                  <DialogDescription>This text will appear in the Terms and Conditions section of policy documents when active.</DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="termTitle">Title</Label>
                    <Input
                      id="termTitle"
                      value={termTitle}
                      onChange={(e) => setTermTitle(e.target.value)}
                      placeholder="e.g. Premium Payment"
                    />
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
                      <Input
                        id="termCategory"
                        value={termCategory}
                        onChange={(e) => setTermCategory(e.target.value)}
                        placeholder="general"
                      />
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

          <TabsContent value="rbac" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Role Permissions Mapping</CardTitle>
                <CardDescription>
                  Live DB-driven RBAC configuration. Roles and permissions are fetched from the database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rolesList && permsList ? (
                  <div className="border rounded-md overflow-hidden overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[200px] sticky left-0 bg-muted/50 z-10">Permission</TableHead>
                          {rolesList.map((role: any) => (
                            <TableHead key={role.id} className="text-center capitalize min-w-[100px]">
                              {role.name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permsList.map((perm: any) => (
                          <RBACPermissionRow key={perm.id} permission={perm} roles={rolesList} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </StaffLayout>
  );
}

function RBACPermissionRow({ permission, roles }: { permission: any; roles: any[] }) {
  const rolePermQueries = roles.map((role: any) => {
    const { data: rolePerms } = useQuery<any[]>({
      queryKey: [`/api/roles/${role.id}/permissions`],
      staleTime: 60000,
    });
    return { role, perms: rolePerms };
  });

  return (
    <TableRow>
      <TableCell className="font-mono text-xs sticky left-0 bg-card z-10">{permission.name}</TableCell>
      {rolePermQueries.map(({ role, perms }) => {
        if (role.name === "superuser") {
          return (
            <TableCell key={role.id} className="text-center text-primary">
              <Check className="h-4 w-4 mx-auto" />
            </TableCell>
          );
        }
        const hasPerm = perms?.some((p: any) => p.id === permission.id);
        return (
          <TableCell key={role.id} className="text-center">
            {perms === undefined ? (
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