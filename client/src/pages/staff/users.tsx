import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { UserPlus, Shield, Copy, Search, Pencil, Check, Trash2, Users, KeyRound, AlertTriangle } from "lucide-react";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, KpiStatCard, EmptyState } from "@/components/ds";

export default function StaffUsers() {
  const { toast } = useToast();
  const { permissions } = useAuth();
  const queryClient = useQueryClient();
  const canEditUsers = permissions.includes("write:user");
  const canDeleteUsers = permissions.includes("delete:user");
  const canManageOverrides = permissions.includes("write:role");
  const isSuperuser = permissions.includes("create:tenant");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [newUser, setNewUser] = useState({ email: "", displayName: "", roleIds: [] as string[], branchId: "", password: "", phone: "", address: "", nationalId: "", dateOfBirth: "", gender: "", maritalStatus: "", nextOfKinName: "", nextOfKinPhone: "" });

  // Delete / reassign dialog state
  const [viewingUser, setViewingUser] = useState<any>(null);

  const [deleteTarget, setDeleteTarget] = useState<any>(null);
  const [deleteAgentPolicies, setDeleteAgentPolicies] = useState<{ count: number; policies: any[] } | null>(null);
  const [reassignToId, setReassignToId] = useState("__none__");
  const [loadingPolicies, setLoadingPolicies] = useState(false);

  // Reset password dialog state
  const [resetTarget, setResetTarget] = useState<any>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const { data: users = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/users"] });
  const { data: roles = [] } = useQuery<any[]>({ queryKey: ["/api/roles"] });
  const { data: branches = [] } = useQuery<any[]>({ queryKey: ["/api/branches"] });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/users", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setShowCreateDialog(false);
      setNewUser({ email: "", displayName: "", roleIds: [], branchId: "", password: "", phone: "", address: "", nationalId: "", dateOfBirth: "", gender: "", maritalStatus: "", nextOfKinName: "", nextOfKinPhone: "" });
      toast({ title: "User created", description: "The new user has been added successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create user", variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/users/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setEditingUser(null);
      toast({ title: "User updated", description: "Changes saved successfully." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update user", variant: "destructive" });
    },
  });

  const { data: overrideData } = useQuery<{ overrides: { permissionName: string; isGranted: boolean }[]; effectivePermissions: string[] }>({
    queryKey: [`/api/users/${editingUser?.id}/permission-overrides`],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/users/${editingUser.id}/permission-overrides`);
      return res.json();
    },
    enabled: !!editingUser?.id && canManageOverrides,
  });

  const setOverrideMutation = useMutation({
    mutationFn: async ({ userId, permissionName, isGranted }: { userId: string; permissionName: string; isGranted: boolean }) => {
      await apiRequest("PUT", `/api/users/${userId}/permission-overrides/${permissionName}`, { isGranted });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/users/${variables.userId}/permission-overrides`] });
      toast({ title: "Access updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update access", variant: "destructive" });
    },
  });

  const clearOverrideMutation = useMutation({
    mutationFn: async ({ userId, permissionName }: { userId: string; permissionName: string }) => {
      await apiRequest("DELETE", `/api/users/${userId}/permission-overrides/${permissionName}`);
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [`/api/users/${variables.userId}/permission-overrides`] });
      toast({ title: "Access updated" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to update access", variant: "destructive" });
    },
  });

  const reassignDeleteMutation = useMutation({
    mutationFn: async ({ userId, toAgentId }: { userId: string; toAgentId: string | null }) => {
      const res = await apiRequest("POST", `/api/users/${userId}/reassign-policies`, { toAgentId: toAgentId || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      setDeleteTarget(null);
      setDeleteAgentPolicies(null);
      setReassignToId("__none__");
      setEditingUser(null);
      toast({ title: "User deleted", description: "The user has been deactivated and policies reassigned (if applicable)." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to delete user", variant: "destructive" });
    },
  });

  const resetPasswordMutation = useMutation({
    mutationFn: async ({ userId, password }: { userId: string; password: string }) => {
      const res = await apiRequest("POST", `/api/users/${userId}/reset-password`, { newPassword: password });
      return res.json();
    },
    onSuccess: () => {
      setResetTarget(null);
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password reset", description: "The user's password has been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to reset password", variant: "destructive" });
    },
  });

  const openDeleteDialog = async (u: any) => {
    setDeleteTarget(u);
    setReassignToId("__none__");
    setDeleteAgentPolicies(null);
    const isAgent = u.roles?.some((r: any) => r.name === "agent");
    if (isAgent) {
      setLoadingPolicies(true);
      try {
        const res = await apiRequest("GET", `/api/users/${u.id}/agent-policies`);
        const data = await res.json();
        setDeleteAgentPolicies(data);
      } catch {
        setDeleteAgentPolicies({ count: 0, policies: [] });
      } finally {
        setLoadingPolicies(false);
      }
    }
  };

  const filtered = users.filter((u: any) =>
    (u.email || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
    (u.displayName || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  const activeCount = users.filter((u: any) => u.isActive).length;
  const agentCount = users.filter((u: any) => u.roles?.some((r: any) => r.name === "agent")).length;

  const toggleRole = (roleId: string, current: string[]) => {
    return current.includes(roleId) ? current.filter(r => r !== roleId) : [...current, roleId];
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Referral code copied to clipboard." });
  };

  const roleColor = (name: string) => {
    const colors: Record<string, string> = {
      superuser: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
      administrator: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400",
      manager: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
      executive: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
      agent: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
      cashier: "bg-cyan-100 text-cyan-800 dark:bg-cyan-900/30 dark:text-cyan-400",
      claims_officer: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
      fleet_ops: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-400",
      driver: "bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400",
      staff: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    };
    return colors[name] || colors.staff;
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="User & Team Management"
          description="Manage staff accounts, roles, and agent access"
          titleDataTestId="text-page-title"
          actions={(
          <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-user"><UserPlus className="mr-2 h-4 w-4" />Add User</Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
              <div className="px-6 pt-6 pb-2 shrink-0">
                <DialogHeader>
                  <DialogTitle>Add New User</DialogTitle>
                  <DialogDescription>
                    Staff: add email and they sign in with Google (must be added first). Agents: add email, assign the Agent role, and set a password—they sign in at the agent login page.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="space-y-4 px-6 py-2 overflow-y-auto min-h-0 flex-1">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input id="email" type="email" placeholder="user@example.com" value={newUser.email} onChange={e => setNewUser(p => ({ ...p, email: e.target.value }))} data-testid="input-user-email" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="displayName">Display Name</Label>
                  <Input id="displayName" placeholder="Full Name" value={newUser.displayName} onChange={e => setNewUser(p => ({ ...p, displayName: e.target.value }))} data-testid="input-user-name" />
                </div>
                {branches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Select value={newUser.branchId} onValueChange={v => setNewUser(p => ({ ...p, branchId: v }))}>
                      <SelectTrigger data-testid="select-user-branch"><SelectValue placeholder="Select branch" /></SelectTrigger>
                      <SelectContent>
                        {branches.map((b: any) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Assign Roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {roles.filter((r: any) => isSuperuser || r.name !== "superuser").map((role: any) => {
                      const isSelected = newUser.roleIds.includes(role.id);
                      return (
                        <Badge key={role.id} variant={isSelected ? "default" : "outline"} className={`cursor-pointer select-none ${isSelected ? "" : "opacity-60 hover:opacity-100"}`} onClick={() => setNewUser(p => ({ ...p, roleIds: toggleRole(role.id, p.roleIds) }))} data-testid={`badge-role-${role.name}`}>
                          {isSelected ? <Check className="mr-1 h-3 w-3" /> : null}
                          {role.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                {newUser.roleIds.some(rid => roles.find((r: any) => r.id === rid)?.name === "agent") && (
                  <div className="space-y-2">
                    <Label htmlFor="new-user-password">Agent password (min 8 characters)</Label>
                    <Input id="new-user-password" type="password" placeholder="••••••••" value={newUser.password} onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))} data-testid="input-agent-password" />
                  </div>
                )}
                <div className="border-t pt-4 mt-2">
                  <h4 className="text-sm font-semibold mb-3">Personal Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="new-phone">Phone</Label>
                      <Input id="new-phone" placeholder="+263..." value={newUser.phone} onChange={e => setNewUser(p => ({ ...p, phone: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="new-nationalId">National ID</Label>
                      <Input id="new-nationalId" placeholder="ID number" value={newUser.nationalId} onChange={e => setNewUser(p => ({ ...p, nationalId: e.target.value }))} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="new-address">Address</Label>
                      <Input id="new-address" placeholder="Physical address" value={newUser.address} onChange={e => setNewUser(p => ({ ...p, address: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="new-dob">Date of Birth</Label>
                      <Input id="new-dob" type="date" value={newUser.dateOfBirth} onChange={e => setNewUser(p => ({ ...p, dateOfBirth: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label>Gender</Label>
                      <Select value={newUser.gender} onValueChange={v => setNewUser(p => ({ ...p, gender: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Marital Status</Label>
                      <Select value={newUser.maritalStatus} onValueChange={v => setNewUser(p => ({ ...p, maritalStatus: v }))}>
                        <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Single">Single</SelectItem>
                          <SelectItem value="Married">Married</SelectItem>
                          <SelectItem value="Divorced">Divorced</SelectItem>
                          <SelectItem value="Widowed">Widowed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="new-nextOfKinName">Next of Kin Name</Label>
                      <Input id="new-nextOfKinName" placeholder="Full name" value={newUser.nextOfKinName} onChange={e => setNewUser(p => ({ ...p, nextOfKinName: e.target.value }))} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="new-nextOfKinPhone">Next of Kin Phone</Label>
                      <Input id="new-nextOfKinPhone" placeholder="+263..." value={newUser.nextOfKinPhone} onChange={e => setNewUser(p => ({ ...p, nextOfKinPhone: e.target.value }))} />
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter className="px-6 pb-6 pt-4 shrink-0 border-t">
                <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Cancel</Button>
                <Button onClick={() => createMutation.mutate(newUser)} disabled={!newUser.email || createMutation.isPending || (newUser.roleIds.some(rid => roles.find((r: any) => r.id === rid)?.name === "agent") && newUser.password.length < 8)} data-testid="button-submit-create-user">
                  {createMutation.isPending ? "Creating..." : "Create User"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          )}
        />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <KpiStatCard label="Total users" value={<span data-testid="text-total-users">{users.length}</span>} icon={Users} />
          <KpiStatCard label="Active" value={<span className="text-emerald-600" data-testid="text-active-users">{activeCount}</span>} icon={Users} />
          <KpiStatCard label="Agents" value={<span className="text-primary" data-testid="text-agent-count">{agentCount}</span>} icon={Shield} />
        </div>

        <CardSection
          title="Team members"
          description="All staff and agent accounts in your organization"
          headerRight={(
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search by name or email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-9" data-testid="input-search-users" />
              </div>
          )}
          flush
        >
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading users...</div>
            ) : filtered.length === 0 ? (
              <EmptyState title="No users found" description="Try a different search term." className="border-0 rounded-none bg-transparent py-10" />
            ) : (
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead>Referral Link</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((u: any) => (
                    <TableRow key={u.id} data-testid={`row-user-${u.id}`} className="cursor-pointer hover:bg-muted/40" onClick={() => setViewingUser(u)}>
                      <TableCell className="font-medium">{u.displayName || "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{u.email}</TableCell>
                      <TableCell className="text-muted-foreground">{u.phone || "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {u.roles?.length > 0 ? u.roles.map((r: any) => (
                            <span key={r.id} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleColor(r.name)}`}>
                              {r.name}
                            </span>
                          )) : <span className="text-muted-foreground text-sm">No roles</span>}
                        </div>
                      </TableCell>
                      <TableCell>
                        {u.referralCode ? (
                          <div className="flex flex-col gap-1">
                            <button className="inline-flex items-center gap-1 text-sm font-mono bg-muted px-2 py-0.5 rounded hover:bg-muted/80" onClick={(e) => { e.stopPropagation(); copyToClipboard(`${window.location.origin}/join?ref=${u.referralCode}`); }} data-testid={`button-copy-referral-${u.id}`}>
                              {u.referralCode} <Copy className="h-3 w-3" />
                            </button>
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={u.isActive ? "default" : "secondary"} className={u.isActive ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : ""} data-testid={`badge-status-${u.id}`}>
                          {u.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">{new Date(u.createdAt).toLocaleDateString()}</TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingUser({ ...u, roleIds: u.roles?.map((r: any) => r.id) || [], branchId: u.branchId || "" })} data-testid={`button-edit-user-${u.id}`} title="Edit user">
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canEditUsers && (
                            <Button variant="ghost" size="sm" onClick={() => { setResetTarget(u); setNewPassword(""); setConfirmPassword(""); }} data-testid={`button-reset-pw-${u.id}`} title="Reset password">
                              <KeyRound className="h-4 w-4" />
                            </Button>
                          )}
                          {canDeleteUsers && u.isActive && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => openDeleteDialog(u)} data-testid={`button-deactivate-user-${u.id}`} title="Delete user">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            )}
        </CardSection>

        <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
            <div className="px-6 pt-6 pb-2 shrink-0">
              <DialogHeader>
                <DialogTitle>Edit User</DialogTitle>
                <DialogDescription>
                  Update {editingUser?.displayName || editingUser?.email}'s details and roles.
                  {canEditUsers && " You can edit all fields below, including email."}
                </DialogDescription>
              </DialogHeader>
            </div>
            {editingUser && (
              <div className="space-y-4 px-6 py-2 overflow-y-auto min-h-0 flex-1">
                <div className="space-y-2">
                  <Label htmlFor="edit-user-email">Email (sign-in address)</Label>
                  <Input
                    id="edit-user-email"
                    type="email"
                    value={editingUser.email || ""}
                    onChange={e => setEditingUser((p: any) => ({ ...p, email: e.target.value }))}
                    placeholder="user@example.com"
                    data-testid="input-edit-user-email"
                    readOnly={!canEditUsers}
                    className={!canEditUsers ? "bg-muted" : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-user-display-name">Display Name</Label>
                  <Input
                    id="edit-user-display-name"
                    value={editingUser.displayName || ""}
                    onChange={e => setEditingUser((p: any) => ({ ...p, displayName: e.target.value }))}
                    data-testid="input-edit-user-name"
                    readOnly={!canEditUsers}
                    className={!canEditUsers ? "bg-muted" : undefined}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editingUser.isActive ? "true" : "false"} onValueChange={v => setEditingUser((p: any) => ({ ...p, isActive: v === "true" }))} disabled={!canEditUsers}>
                    <SelectTrigger data-testid="select-edit-user-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="true">Active</SelectItem>
                      <SelectItem value="false">Inactive</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>New password (optional, min 8 characters)</Label>
                  <Input type="password" placeholder="Leave blank to keep current" value={editingUser.newPassword || ""} onChange={e => setEditingUser((p: any) => ({ ...p, newPassword: e.target.value }))} data-testid="input-edit-agent-password" disabled={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                </div>
                {branches.length > 0 && (
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Select value={editingUser.branchId || "none"} onValueChange={v => setEditingUser((p: any) => ({ ...p, branchId: v === "none" ? "" : v }))} disabled={!canEditUsers}>
                      <SelectTrigger data-testid="select-edit-user-branch"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No Branch</SelectItem>
                        {branches.map((b: any) => (
                          <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {roles.filter((r: any) => isSuperuser || r.name !== "superuser").map((role: any) => {
                      const isSelected = editingUser.roleIds?.includes(role.id);
                      return (
                        <Badge key={role.id} variant={isSelected ? "default" : "outline"} className={`cursor-pointer select-none ${isSelected ? "" : "opacity-60 hover:opacity-100"} ${!canEditUsers ? "pointer-events-none" : ""}`} onClick={() => canEditUsers && setEditingUser((p: any) => ({ ...p, roleIds: toggleRole(role.id, p.roleIds || []) }))} data-testid={`badge-edit-role-${role.name}`}>
                          {isSelected ? <Check className="mr-1 h-3 w-3" /> : null}
                          {role.name}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
                {canManageOverrides && (
                  <div className="space-y-2">
                    <Label>Product Builder &amp; Terms &amp; Conditions access</Label>
                    {(() => {
                      const override = overrideData?.overrides?.find((o) => o.permissionName === "write:product");
                      const value = override ? (override.isGranted ? "allow" : "deny") : "default";
                      const effectiveHasIt = overrideData?.effectivePermissions?.includes("write:product");
                      return (
                        <>
                          <Select
                            value={value}
                            onValueChange={(v) => {
                              if (v === "default") clearOverrideMutation.mutate({ userId: editingUser.id, permissionName: "write:product" });
                              else setOverrideMutation.mutate({ userId: editingUser.id, permissionName: "write:product", isGranted: v === "allow" });
                            }}
                            disabled={setOverrideMutation.isPending || clearOverrideMutation.isPending}
                          >
                            <SelectTrigger data-testid="select-edit-user-product-override"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="default">Default (follows their role)</SelectItem>
                              <SelectItem value="allow">Always allow, regardless of role</SelectItem>
                              <SelectItem value="deny">Always deny, regardless of role</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-muted-foreground">
                            Controls both the Product Builder and Terms &amp; Conditions editor (same underlying permission). Currently: {effectiveHasIt ? "can" : "cannot"} access{override ? " (explicit override)" : " (from role)"}.
                          </p>
                        </>
                      );
                    })()}
                  </div>
                )}
                <div className="border-t pt-4 mt-2">
                  <h4 className="text-sm font-semibold mb-3">Personal Details</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label htmlFor="edit-phone">Phone</Label>
                      <Input id="edit-phone" placeholder="+263..." value={editingUser.phone || ""} onChange={e => setEditingUser((p: any) => ({ ...p, phone: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-nationalId">National ID</Label>
                      <Input id="edit-nationalId" placeholder="ID number" value={editingUser.nationalId || ""} onChange={e => setEditingUser((p: any) => ({ ...p, nationalId: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="edit-address">Address</Label>
                      <Input id="edit-address" placeholder="Physical address" value={editingUser.address || ""} onChange={e => setEditingUser((p: any) => ({ ...p, address: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="edit-department">Department</Label>
                      <Input id="edit-department" placeholder="e.g. Sales, Finance, Claims…" value={editingUser.department || ""} onChange={e => setEditingUser((p: any) => ({ ...p, department: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-dob">Date of Birth</Label>
                      <Input id="edit-dob" type="date" value={editingUser.dateOfBirth || ""} onChange={e => setEditingUser((p: any) => ({ ...p, dateOfBirth: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="space-y-1">
                      <Label>Gender</Label>
                      <Select value={editingUser.gender || ""} onValueChange={v => setEditingUser((p: any) => ({ ...p, gender: v }))} disabled={!canEditUsers}>
                        <SelectTrigger><SelectValue placeholder="Select gender" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Marital Status</Label>
                      <Select value={editingUser.maritalStatus || ""} onValueChange={v => setEditingUser((p: any) => ({ ...p, maritalStatus: v }))} disabled={!canEditUsers}>
                        <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Single">Single</SelectItem>
                          <SelectItem value="Married">Married</SelectItem>
                          <SelectItem value="Divorced">Divorced</SelectItem>
                          <SelectItem value="Widowed">Widowed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-nextOfKinName">Next of Kin Name</Label>
                      <Input id="edit-nextOfKinName" placeholder="Full name" value={editingUser.nextOfKinName || ""} onChange={e => setEditingUser((p: any) => ({ ...p, nextOfKinName: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="edit-nextOfKinPhone">Next of Kin Phone</Label>
                      <Input id="edit-nextOfKinPhone" placeholder="+263..." value={editingUser.nextOfKinPhone || ""} onChange={e => setEditingUser((p: any) => ({ ...p, nextOfKinPhone: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                    <div className="col-span-2 space-y-1">
                      <Label htmlFor="edit-bio">Bio (shown on their public vCard page, if they're an agent)</Label>
                      <Textarea id="edit-bio" rows={3} placeholder="A short intro clients see on this agent's referral page…" value={editingUser.bio || ""} onChange={e => setEditingUser((p: any) => ({ ...p, bio: e.target.value }))} readOnly={!canEditUsers} className={!canEditUsers ? "bg-muted" : undefined} />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="px-6 pb-6 pt-4 shrink-0 border-t flex-wrap gap-2">
              {canDeleteUsers && editingUser?.isActive && (
                <Button
                  variant="destructive"
                  className="mr-auto"
                  onClick={() => { openDeleteDialog(editingUser); setEditingUser(null); }}
                  data-testid="button-delete-user-in-dialog"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete user
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                <Button onClick={() => updateMutation.mutate({ id: editingUser.id, data: { email: editingUser.email, displayName: editingUser.displayName, isActive: editingUser.isActive, branchId: editingUser.branchId || null, roleIds: editingUser.roleIds, password: editingUser.newPassword || undefined, phone: editingUser.phone || "", address: editingUser.address || "", nationalId: editingUser.nationalId || "", dateOfBirth: editingUser.dateOfBirth || "", gender: editingUser.gender || "", maritalStatus: editingUser.maritalStatus || "", nextOfKinName: editingUser.nextOfKinName || "", nextOfKinPhone: editingUser.nextOfKinPhone || "", department: editingUser.department || "", bio: editingUser.bio || "" } })} disabled={updateMutation.isPending || !canEditUsers} data-testid="button-submit-edit-user">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── Delete / Reassign Dialog ── */}
        <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) { setDeleteTarget(null); setDeleteAgentPolicies(null); setReassignToId("__none__"); } }}>
          <AlertDialogContent className="sm:max-w-md">
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Delete {deleteTarget?.displayName || deleteTarget?.email}?
              </AlertDialogTitle>
              <AlertDialogDescription asChild>
                <div className="space-y-3">
                  <p>This will deactivate the account immediately. The user will no longer be able to sign in. All audit trail records and historical policy data are preserved.</p>
                  {loadingPolicies && (
                    <p className="text-sm text-muted-foreground">Checking assigned policies...</p>
                  )}
                  {deleteAgentPolicies && deleteAgentPolicies.count > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        This agent has {deleteAgentPolicies.count} assigned {deleteAgentPolicies.count === 1 ? "policy" : "policies"}
                      </p>
                      <p className="text-sm text-amber-700 dark:text-amber-400">Select an agent to reassign them to, or leave unassigned.</p>
                      <Select value={reassignToId} onValueChange={setReassignToId}>
                        <SelectTrigger className="bg-white dark:bg-background">
                          <SelectValue placeholder="Select agent to reassign to..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Leave unassigned</SelectItem>
                          {(users as any[])
                            .filter((u: any) => u.id !== deleteTarget?.id && u.isActive && u.roles?.some((r: any) => r.name === "agent"))
                            .map((u: any) => (
                              <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={reassignDeleteMutation.isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={reassignDeleteMutation.isPending || loadingPolicies}
                onClick={(e) => {
                  e.preventDefault();
                  reassignDeleteMutation.mutate({
                    userId: deleteTarget.id,
                    toAgentId: reassignToId === "__none__" ? null : reassignToId,
                  });
                }}
                data-testid="button-confirm-delete-user"
              >
                {reassignDeleteMutation.isPending ? "Deleting..." : "Delete user"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* ── Reset Password Dialog ── */}
        <Dialog open={!!resetTarget} onOpenChange={(open) => { if (!open) { setResetTarget(null); setNewPassword(""); setConfirmPassword(""); } }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <KeyRound className="h-4 w-4" />
                Reset password
              </DialogTitle>
              <DialogDescription>
                Set a new password for <strong>{resetTarget?.displayName || resetTarget?.email}</strong>. They will need to use this password to sign in.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-pw">New password</Label>
                <Input
                  id="new-pw"
                  type="password"
                  placeholder="Min. 8 characters"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  data-testid="input-reset-password"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="confirm-pw">Confirm password</Label>
                <Input
                  id="confirm-pw"
                  type="password"
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  data-testid="input-reset-password-confirm"
                />
              </div>
              {newPassword && confirmPassword && newPassword !== confirmPassword && (
                <p className="text-sm text-destructive">Passwords do not match.</p>
              )}
              {newPassword && newPassword.length > 0 && newPassword.length < 8 && (
                <p className="text-sm text-destructive">Password must be at least 8 characters.</p>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button
                onClick={() => resetPasswordMutation.mutate({ userId: resetTarget.id, password: newPassword })}
                disabled={resetPasswordMutation.isPending || newPassword.length < 8 || newPassword !== confirmPassword}
                data-testid="button-confirm-reset-password"
              >
                {resetPasswordMutation.isPending ? "Resetting..." : "Reset password"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* ── User View Card ── */}
        <Dialog open={!!viewingUser} onOpenChange={(open) => { if (!open) setViewingUser(null); }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0">
            <div className="px-6 pt-6 pb-2 shrink-0">
              <DialogHeader>
                <DialogTitle>{viewingUser?.displayName || viewingUser?.email || "User Details"}</DialogTitle>
                <DialogDescription>Full profile for this team member.</DialogDescription>
              </DialogHeader>
            </div>
            {viewingUser && (
              <div className="space-y-4 px-6 py-2 overflow-y-auto min-h-0 flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Display Name</p>
                    <p className="font-medium">{viewingUser.displayName || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="font-medium break-all">{viewingUser.email || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{viewingUser.phone || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">National ID</p>
                    <p className="font-medium font-mono">{viewingUser.nationalId || "—"}</p>
                  </div>
                  <div className="col-span-2 space-y-0.5">
                    <p className="text-xs text-muted-foreground">Address</p>
                    <p className="font-medium">{viewingUser.address || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Date of Birth</p>
                    <p className="font-medium">{viewingUser.dateOfBirth || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Gender</p>
                    <p className="font-medium">{viewingUser.gender || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Marital Status</p>
                    <p className="font-medium">{viewingUser.maritalStatus || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Branch</p>
                    <p className="font-medium">{branches.find((b: any) => b.id === viewingUser.branchId)?.name || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Next of Kin</p>
                    <p className="font-medium">{viewingUser.nextOfKinName || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Next of Kin Phone</p>
                    <p className="font-medium">{viewingUser.nextOfKinPhone || "—"}</p>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <Badge variant={viewingUser.isActive ? "default" : "secondary"} className={viewingUser.isActive ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : ""}>
                      {viewingUser.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-xs text-muted-foreground">Joined</p>
                    <p className="font-medium">{viewingUser.createdAt ? new Date(viewingUser.createdAt).toLocaleDateString() : "—"}</p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">Roles</p>
                  <div className="flex flex-wrap gap-1.5">
                    {viewingUser.roles?.length > 0 ? viewingUser.roles.map((r: any) => (
                      <span key={r.id} className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${roleColor(r.name)}`}>
                        {r.name}
                      </span>
                    )) : <span className="text-muted-foreground text-sm">No roles</span>}
                  </div>
                </div>
                {viewingUser.referralCode && (
                  <div className="space-y-1.5">
                    <p className="text-xs text-muted-foreground">Referral Link</p>
                    <button className="inline-flex items-center gap-1 text-sm font-mono bg-muted px-2 py-0.5 rounded hover:bg-muted/80" onClick={() => copyToClipboard(`${window.location.origin}/join?ref=${viewingUser.referralCode}`)}>
                      {viewingUser.referralCode} <Copy className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </div>
            )}
            <DialogFooter className="px-6 pb-6 pt-4 shrink-0 border-t flex-wrap gap-2">
              {canEditUsers && viewingUser && (
                <Button variant="outline" className="mr-auto" onClick={() => { setEditingUser({ ...viewingUser, roleIds: viewingUser.roles?.map((r: any) => r.id) || [], branchId: viewingUser.branchId || "" }); setViewingUser(null); }}>
                  <Pencil className="h-4 w-4 mr-1" /> Edit
                </Button>
              )}
              <Button onClick={() => setViewingUser(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </PageShell>
    </StaffLayout>
  );
}
