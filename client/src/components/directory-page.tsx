import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState, useDeferredValue } from "react";
import { Plus, Search, MoreHorizontal, Pencil, Trash2, Phone, Mail, MapPin } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface DirectoryContact {
  id: string;
  type: string;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  altPhone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  notes?: string | null;
  isActive: boolean;
}

interface DirectoryPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
  type: string;
  singularLabel: string;
  extraNotes?: string;
}

const EMPTY: Partial<DirectoryContact> = { name: "", contactPerson: "", phone: "", altPhone: "", email: "", address: "", city: "", notes: "" };

async function apiRequest(method: string, url: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(err.message || "Request failed");
  }
  return res.status === 204 ? null : res.json();
}

export function DirectoryPage({ title, description, icon: Icon, type, singularLabel, extraNotes }: DirectoryPageProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DirectoryContact | null>(null);
  const [form, setForm] = useState<Partial<DirectoryContact>>(EMPTY);

  const queryKey = ["/api/directory-contacts", type, deferredSearch];
  const { data: contacts = [], isLoading } = useQuery<DirectoryContact[]>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams({ type });
      if (deferredSearch) params.set("q", deferredSearch);
      return apiRequest("GET", `/api/directory-contacts?${params}`);
    },
  });

  const mutationOpts = {
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/directory-contacts"] }); setOpen(false); setEditing(null); },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  };

  const createMutation = useMutation({
    mutationFn: (data: Partial<DirectoryContact>) => apiRequest("POST", "/api/directory-contacts", { ...data, type }),
    ...mutationOpts,
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DirectoryContact> }) =>
      apiRequest("PATCH", `/api/directory-contacts/${id}`, data),
    ...mutationOpts,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/directory-contacts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/directory-contacts"] }),
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openAdd = () => { setForm(EMPTY); setEditing(null); setOpen(true); };
  const openEdit = (c: DirectoryContact) => { setForm(c); setEditing(c); setOpen(true); };

  const save = () => {
    if (!form.name?.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    if (editing) {
      updateMutation.mutate({ id: editing.id, data: form });
    } else {
      createMutation.mutate(form);
    }
  };

  const f = (field: keyof DirectoryContact) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">{title}</span>}
          description={description}
          actions={
            <Button size="sm" onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add {singularLabel}
            </Button>
          }
        />

        {extraNotes && (
          <p className="text-sm text-muted-foreground -mt-2 mb-0 px-0">{extraNotes}</p>
        )}

        <div className="flex items-center gap-2 max-w-sm">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            placeholder={`Search ${title.toLowerCase()}…`}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8"
          />
        </div>

        <CardSection title={title} icon={Icon} contentClassName="p-0">
          {isLoading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : contacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {deferredSearch ? `No matches for "${deferredSearch}"` : `No ${title.toLowerCase()} yet. Click "Add ${singularLabel}" to get started.`}
            </p>
          ) : (
            <ul className="divide-y">
              {contacts.map((c) => (
                <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{c.name}</span>
                      {!c.isActive && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    {c.contactPerson && (
                      <p className="text-sm text-muted-foreground mt-0.5">{c.contactPerson}</p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1">
                      {c.phone && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />{c.phone}
                          {c.altPhone && ` · ${c.altPhone}`}
                        </span>
                      )}
                      {c.email && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3" />{c.email}
                        </span>
                      )}
                      {(c.city || c.address) && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <MapPin className="h-3 w-3" />{[c.city, c.address].filter(Boolean).join(", ")}
                        </span>
                      )}
                    </div>
                    {c.notes && <p className="text-xs text-muted-foreground mt-1 italic">{c.notes}</p>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="shrink-0 h-7 w-7" aria-label="Actions">
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEdit(c)}>
                        <Pencil className="h-4 w-4 mr-2" />Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => { if (confirm(`Delete ${c.name}?`)) deleteMutation.mutate(c.id); }}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </li>
              ))}
            </ul>
          )}
        </CardSection>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{editing ? `Edit ${singularLabel}` : `Add ${singularLabel}`}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-2">
              <div className="grid gap-1.5">
                <Label>Name *</Label>
                <Input value={form.name || ""} onChange={f("name")} placeholder={`${singularLabel} or company name`} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Contact person</Label>
                  <Input value={form.contactPerson || ""} onChange={f("contactPerson")} placeholder="Full name" />
                </div>
                <div className="grid gap-1.5">
                  <Label>City / town</Label>
                  <Input value={form.city || ""} onChange={f("city")} placeholder="e.g. Harare" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Phone</Label>
                  <Input value={form.phone || ""} onChange={f("phone")} placeholder="+263 77 …" />
                </div>
                <div className="grid gap-1.5">
                  <Label>Alt. phone</Label>
                  <Input value={form.altPhone || ""} onChange={f("altPhone")} placeholder="Second number" />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Email</Label>
                <Input type="email" value={form.email || ""} onChange={f("email")} placeholder="name@example.com" />
              </div>
              <div className="grid gap-1.5">
                <Label>Address</Label>
                <Input value={form.address || ""} onChange={f("address")} placeholder="Street / P.O. Box" />
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Textarea value={form.notes || ""} onChange={f("notes")} placeholder="Any extra info…" className="min-h-[72px]" />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={save} disabled={createMutation.isPending || updateMutation.isPending}>
                {editing ? "Save changes" : `Add ${singularLabel}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </PageShell>
    </StaffLayout>
  );
}
