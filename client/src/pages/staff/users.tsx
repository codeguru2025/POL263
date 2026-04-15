import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { UserPlus, Shield, Copy, Search, UserX, Pencil, Check, X, Trash2, Users } from "lucide-react";
import { PageHeader, CardSection, DataTable, dataTableStickyHeaderClass, KpiStatCard, EmptyState } from "@/components/ds";

export default function StaffUsers() {
  const { toast } = useToast();
  const { permissions } = useAuth();
  const queryClient = useQueryClient();
  const canEditUsers = permissions.includes("write:user");
  const canDeleteUsers = permissions.includes("delete:user");
  const isSuperuser = permissions.includes("create:tenant");
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<any>(null);
  const [newUser, setNewUser] = useState({ email: "", displayName: "", roleIds: [] as string[], branchId: "", password: "", phone: "", address: "", nationalId: "", dateOfBirth: "", gender: "", maritalStatus: "", nextOfKinName: "", nextOfKinPhone: "" });

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

  const deactivateMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/users/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted", description: "The user has been deactivated and can no longer sign in." });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to deactivate user", variant: "destructive" });
    },
  });

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
      staff: "bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400",
    };
    return colors[name] || colors.staff;
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
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
                  <div className="grid grid-cols-2 gap-3">
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
                    <TableRow key={u.id} data-testid={`row-user-${u.id}`}>
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
                            <button className="inline-flex items-center gap-1 text-sm font-mono bg-muted px-2 py-0.5 rounded hover:bg-muted/80" onClick={() => copyToClipboard(`${window.location.origin}/join?ref=${u.referralCode}`)} data-testid={`button-copy-referral-${u.id}`}>
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
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => setEditingUser({ ...u, roleIds: u.roles?.map((r: any) => r.id) || [], branchId: u.branchId || "" })} data-testid={`button-edit-user-${u.id}`}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          {canDeleteUsers && u.isActive && (
                            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => { if (confirm(`Delete user ${u.displayName || u.email}? They will be deactivated and cannot sign in.`)) deactivateMutation.mutate(u.id); }} data-testid={`button-deactivate-user-${u.id}`} title="Delete user">
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
                <div className="border-t pt-4 mt-2">
                  <h4 className="text-sm font-semibold mb-3">Personal Details</h4>
                  <div className="grid grid-cols-2 gap-3">
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
                  </div>
                </div>
              </div>
            )}
            <DialogFooter className="px-6 pb-6 pt-4 shrink-0 border-t flex-wrap gap-2">
              {canDeleteUsers && editingUser?.isActive && (
                <Button
                  variant="destructive"
                  className="mr-auto"
                  onClick={() => {
                    if (confirm(`Delete user ${editingUser?.displayName || editingUser?.email}? They will be deactivated and cannot sign in.`)) {
                      deactivateMutation.mutate(editingUser.id);
                      setEditingUser(null);
                    }
                  }}
                  disabled={deactivateMutation.isPending}
                  data-testid="button-delete-user-in-dialog"
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete user
                </Button>
              )}
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" onClick={() => setEditingUser(null)}>Cancel</Button>
                <Button onClick={() => updateMutation.mutate({ id: editingUser.id, data: { email: editingUser.email, displayName: editingUser.displayName, isActive: editingUser.isActive, branchId: editingUser.branchId || null, roleIds: editingUser.roleIds, password: editingUser.newPassword || undefined, phone: editingUser.phone || "", address: editingUser.address || "", nationalId: editingUser.nationalId || "", dateOfBirth: editingUser.dateOfBirth || "", gender: editingUser.gender || "", maritalStatus: editingUser.maritalStatus || "", nextOfKinName: editingUser.nextOfKinName || "", nextOfKinPhone: editingUser.nextOfKinPhone || "" } })} disabled={updateMutation.isPending || !canEditUsers} data-testid="button-submit-edit-user">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </StaffLayout>
  );
}
