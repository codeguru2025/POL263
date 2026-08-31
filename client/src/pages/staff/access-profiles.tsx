import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Plus, Pencil, Trash2, ShieldCheck } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";

interface Perm { name: string; description: string | null; category: string | null }
interface Profile { id: string; name: string; description: string | null; permissions: string[] }

function groupPermissions(perms: Perm[]): [string, Perm[]][] {
  const groups = new Map<string, Perm[]>();
  for (const p of [...perms].sort((a, b) => a.name.localeCompare(b.name))) {
    const cat = p.category || (p.name.includes(":") ? p.name.split(":")[1] : "Other");
    const key = cat.charAt(0).toUpperCase() + cat.slice(1);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }
  return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

export default function AccessProfiles() {
  const { toast } = useToast();
  const { permissions } = useAuth();
  const queryClient = useQueryClient();
  const canManage = permissions.includes("write:role");
  const [form, setForm] = useState<{ id: string; name: string; description: string; permissions: string[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);

  const { data: profiles = [], isLoading } = useQuery<Profile[]>({ queryKey: ["/api/access-profiles"] });
  const { data: allPerms = [] } = useQuery<Perm[]>({ queryKey: ["/api/permissions"] });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/access-profiles"] });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      const body = { name: form.name.trim(), description: form.description.trim() || null, permissions: form.permissions };
      if (form.id) await apiRequest("PATCH", `/api/access-profiles/${form.id}`, body);
      else await apiRequest("POST", "/api/access-profiles", body);
    },
    onSuccess: () => { invalidate(); setForm(null); toast({ title: "Access profile saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => { if (deleteTarget) await apiRequest("DELETE", `/api/access-profiles/${deleteTarget.id}`); },
    onSuccess: () => { invalidate(); setDeleteTarget(null); toast({ title: "Access profile deleted" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggle = (name: string) =>
    setForm((f) => f && ({ ...f, permissions: f.permissions.includes(name) ? f.permissions.filter((p) => p !== name) : [...f.permissions, name] }));

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Access profiles"
          description="Reusable permission bundles you can apply to a user in one click — e.g. 'Receipting agent' or 'Read-only finance'. Applied on top of the user's roles."
        />
        <CardSection
          title="Profiles"
          icon={ShieldCheck}
          headerRight={canManage ? <Button size="sm" onClick={() => setForm({ id: "", name: "", description: "", permissions: [] })}><Plus className="h-4 w-4 mr-1" /> New profile</Button> : undefined}
        >
          {isLoading ? (
            <div className="p-6 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : profiles.length === 0 ? (
            <EmptyState title="No access profiles yet" description="Create one to speed up granting a common set of permissions." className="border-0 rounded-none bg-transparent py-10" />
          ) : (
            <div className="divide-y">
              {profiles.map((p) => (
                <div key={p.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="font-medium">{p.name}</div>
                    {p.description && <div className="text-sm text-muted-foreground">{p.description}</div>}
                    <div className="text-xs text-muted-foreground mt-1">{p.permissions.length} permission(s): {p.permissions.slice(0, 6).join(", ")}{p.permissions.length > 6 ? "…" : ""}</div>
                  </div>
                  {canManage && (
                    <div className="flex gap-1 shrink-0">
                      <Button size="sm" variant="ghost" onClick={() => setForm({ id: p.id, name: p.name, description: p.description || "", permissions: p.permissions })}><Pencil className="h-4 w-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(p)}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardSection>

        <Dialog open={!!form} onOpenChange={(o) => { if (!o) setForm(null); }}>
          <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col">
            <DialogHeader><DialogTitle>{form?.id ? "Edit profile" : "New profile"}</DialogTitle></DialogHeader>
            {form && (
              <div className="space-y-4 overflow-y-auto pr-1">
                <div className="space-y-2">
                  <Label htmlFor="ap-name">Name</Label>
                  <Input id="ap-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Receipting agent" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ap-desc">Description (optional)</Label>
                  <Input id="ap-desc" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </div>
                <div className="space-y-3">
                  <Label>Permissions ({form.permissions.length} selected)</Label>
                  {groupPermissions(allPerms).map(([category, perms]) => (
                    <div key={category} className="space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</p>
                      {perms.map((perm) => (
                        <label key={perm.name} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={form.permissions.includes(perm.name)} onCheckedChange={() => toggle(perm.name)} />
                          <span>{perm.description || perm.name}</span>
                          <span className="text-[11px] text-muted-foreground font-mono">{perm.name}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setForm(null)}>Cancel</Button>
              <Button disabled={!form?.name.trim() || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {form?.id ? "Save changes" : "Create profile"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
              <AlertDialogDescription>This won't change any user's current permissions — it only removes the reusable profile.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PageShell>
    </StaffLayout>
  );
}
