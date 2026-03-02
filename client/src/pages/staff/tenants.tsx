import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import {
  Building2,
  Loader2,
  Plus,
  Trash2,
  ArrowRightLeft,
  Settings,
  Users,
  Globe,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";

export default function StaffTenants() {
  const { permissions, isPlatformOwner, user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [addOpen, setAddOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const [newOrg, setNewOrg] = useState({
    name: "",
    adminEmail: "",
    adminPassword: "",
    adminDisplayName: "",
    phone: "",
    email: "",
  });

  const canCreate = permissions.includes("create:tenant");
  const canDelete = permissions.includes("delete:tenant");

  const { data: orgs = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof newOrg) => {
      const res = await apiRequest("POST", "/api/organizations", data);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      setAddOpen(false);
      setNewOrg({ name: "", adminEmail: "", adminPassword: "", adminDisplayName: "", phone: "", email: "" });
      toast({ title: "Tenant created", description: `${data.organization?.name || "New tenant"} is ready.` });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to create tenant", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/organizations/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
      setDeleteId(null);
      toast({ title: "Tenant removed" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to remove tenant", variant: "destructive" });
    },
  });

  const switchMutation = useMutation({
    mutationFn: async (tenantId: string) => {
      const res = await apiRequest("POST", "/api/platform/switch-tenant", { tenantId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries();
      setLocation("/staff");
    },
  });

  const handleCreate = () => {
    if (!newOrg.name.trim() || !newOrg.adminEmail.trim() || !newOrg.adminPassword.trim()) return;
    if (newOrg.adminPassword.length < 8) {
      toast({ title: "Validation error", description: "Admin password must be at least 8 characters", variant: "destructive" });
      return;
    }
    createMutation.mutate(newOrg);
  };

  if (!canCreate && !canDelete) {
    return (
      <StaffLayout>
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">You do not have permission to manage tenants.</p>
          </CardContent>
        </Card>
      </StaffLayout>
    );
  }

  const deleteName = orgs.find((o: any) => o.id === deleteId)?.name;

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <Globe className="h-6 w-6 text-primary" />
              Platform Administration
            </h1>
            <p className="text-muted-foreground mt-1">Manage tenant organizations across the platform.</p>
          </div>
          {canCreate && (
            <Button onClick={() => setAddOpen(true)} data-testid="btn-add-tenant">
              <Plus className="h-4 w-4 mr-2" />
              New tenant
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : orgs.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16">
              <Building2 className="h-12 w-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground font-medium">No tenants yet</p>
              <p className="text-sm text-muted-foreground mt-1">Create your first tenant to get started.</p>
              {canCreate && (
                <Button className="mt-4" onClick={() => setAddOpen(true)}>
                  <Plus className="h-4 w-4 mr-2" />
                  Create tenant
                </Button>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {orgs.map((org: any) => {
              const isActive = isPlatformOwner && org.id === user?.organizationId;
              return (
                <Card key={org.id} className={`relative transition-shadow hover:shadow-md ${isActive ? "ring-2 ring-primary" : ""}`}>
                  {isActive && (
                    <Badge className="absolute top-3 right-3 bg-primary/15 text-primary border-primary/30" variant="outline">
                      Active
                    </Badge>
                  )}
                  <CardHeader className="pb-3">
                    <div className="flex items-start gap-3">
                      {org.logoUrl ? (
                        <img src={org.logoUrl} alt="" className="h-10 w-10 rounded-lg object-contain border bg-background shrink-0" />
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
                          disabled={isActive || switchMutation.isPending}
                          onClick={() => switchMutation.mutate(org.id)}
                        >
                          <ArrowRightLeft className="h-3.5 w-3.5 mr-1.5" />
                          {isActive ? "Current" : "Switch"}
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (isPlatformOwner) {
                            switchMutation.mutate(org.id, {
                              onSuccess: () => {
                                queryClient.invalidateQueries();
                                setLocation("/staff/settings");
                              },
                            });
                          } else {
                            setLocation("/staff/settings");
                          }
                        }}
                      >
                        <Settings className="h-3.5 w-3.5" />
                      </Button>
                      {canDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteId(org.id)}
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

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new tenant</DialogTitle>
            <DialogDescription>
              Set up a new organization with its own admin account. A default branch "Head Office" will be created automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="org-name">Organization name *</Label>
              <Input
                id="org-name"
                value={newOrg.name}
                onChange={(e) => setNewOrg((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Acme Insurance"
                data-testid="input-tenant-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-email">Organization email</Label>
              <Input
                id="org-email"
                type="email"
                value={newOrg.email}
                onChange={(e) => setNewOrg((p) => ({ ...p, email: e.target.value }))}
                placeholder="info@acme.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="org-phone">Organization phone</Label>
              <Input
                id="org-phone"
                value={newOrg.phone}
                onChange={(e) => setNewOrg((p) => ({ ...p, phone: e.target.value }))}
                placeholder="+1 555 0100"
              />
            </div>
            <div className="border-t pt-4 space-y-4">
              <p className="text-sm font-medium flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                Tenant administrator account
              </p>
              <div className="space-y-2">
                <Label htmlFor="admin-name">Display name</Label>
                <Input
                  id="admin-name"
                  value={newOrg.adminDisplayName}
                  onChange={(e) => setNewOrg((p) => ({ ...p, adminDisplayName: e.target.value }))}
                  placeholder="John Doe"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-email">Email *</Label>
                <Input
                  id="admin-email"
                  type="email"
                  value={newOrg.adminEmail}
                  onChange={(e) => setNewOrg((p) => ({ ...p, adminEmail: e.target.value }))}
                  placeholder="admin@acme.com"
                  data-testid="input-admin-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="admin-password">Password * (min 8 chars)</Label>
                <Input
                  id="admin-password"
                  type="password"
                  value={newOrg.adminPassword}
                  onChange={(e) => setNewOrg((p) => ({ ...p, adminPassword: e.target.value }))}
                  placeholder="Minimum 8 characters"
                  data-testid="input-admin-password"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newOrg.name.trim() || !newOrg.adminEmail.trim() || newOrg.adminPassword.length < 8 || createMutation.isPending}
              data-testid="btn-confirm-add-tenant"
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create tenant
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete <strong>{deleteName}</strong>. The tenant must have no active users. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </StaffLayout>
  );
}
