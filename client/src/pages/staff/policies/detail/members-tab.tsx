import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge, CardSection } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { Users, UserPlus, Pencil, Loader2 } from "lucide-react";

interface MembersTabProps {
  selectedPolicy: any;
  displayPolicy: any;
  canEditPremium: boolean;
  addOns: any[];
  getClientName: (clientId: string) => string;
  policyHolderClient: any;
}

export function MembersTab({ selectedPolicy, displayPolicy, canEditPremium, addOns, getClientName, policyHolderClient }: MembersTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: policyMembers, isLoading: membersLoading } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "members"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/members`, { credentials: "include" });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    },
  });

  const { data: policyMemberAddOns = [], refetch: refetchMemberAddOns } = useQuery<any[]>({
    queryKey: ["/api/policies", selectedPolicy?.id, "add-ons"],
    enabled: !!selectedPolicy?.id,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${selectedPolicy.id}/add-ons`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const [detailAddDepOpen, setDetailAddDepOpen] = useState(false);
  const [detailDepForm, setDetailDepForm] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
  const [detailShowNewDepForm, setDetailShowNewDepForm] = useState(false);
  const [membersAgeFilter, setMembersAgeFilter] = useState<"all" | "adult" | "child">("all");

  const detailAddDepMutation = useMutation({
    mutationFn: async (data: typeof detailDepForm) => {
      if (!selectedPolicy) throw new Error("No policy selected");
      const res = await apiRequest("POST", `/api/clients/${selectedPolicy.clientId}/dependents`, { ...data, policyId: selectedPolicy.id });
      const body = await res.json();
      // A matching dependent already exists on this client — reuse it instead of the response
      // being treated as a freshly-created one (server returns 200 + code, not 201, for this case).
      const dep = body.code === "EXISTING_DEPENDENT" ? body.existingDependent : body;
      await apiRequest("POST", `/api/policies/${selectedPolicy.id}/members`, { dependentId: dep.id, role: "dependent" });
      return dep;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedPolicy?.clientId, "dependents"] });
      setDetailAddDepOpen(false);
      toast({ title: "Dependent added to policy" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Existing dependents on the same client, not yet linked to this policy — offered as an
  // alternative to retyping identity details already captured elsewhere on this client.
  const { data: clientDependentsForDetail } = useQuery<any[]>({
    queryKey: ["/api/clients", selectedPolicy?.clientId, "dependents"],
    enabled: !!selectedPolicy?.clientId && detailAddDepOpen,
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${selectedPolicy.clientId}/dependents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });
  const linkExistingDepMutation = useMutation({
    mutationFn: async (dependentId: string) => {
      if (!selectedPolicy) throw new Error("No policy selected");
      await apiRequest("POST", `/api/policies/${selectedPolicy.id}/members`, { dependentId, role: "dependent" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      setDetailAddDepOpen(false);
      toast({ title: "Dependent linked to policy" });
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

  const linkedDependentIds = new Set((policyMembers || []).map((m: any) => m.dependentId).filter(Boolean));
  const unlinkedClientDependents = (clientDependentsForDetail || []).filter((d: any) => !linkedDependentIds.has(d.id));

  const [editAddOnsOpen, setEditAddOnsOpen] = useState(false);
  const [editAddOnsMemberId, setEditAddOnsMemberId] = useState<string | null>(null);
  const [editAddOnsSelected, setEditAddOnsSelected] = useState<string[]>([]);

  const setMemberAddOnsMutation = useMutation({
    mutationFn: async ({ memberId, addOnIds }: { memberId: string; addOnIds: string[] }) => {
      await apiRequest("PUT", `/api/policies/${selectedPolicy!.id}/members/${memberId}/add-ons`, { addOnIds });
    },
    onSuccess: () => {
      refetchMemberAddOns();
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditAddOnsOpen(false);
      toast({ title: "Add-ons saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [editMemberOpen, setEditMemberOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<any>(null);
  const [editMemberForm, setEditMemberForm] = useState({
    firstName: "", lastName: "", relationship: "", gender: "", nationalId: "", dateOfBirth: "", phone: "", email: "",
  });

  const editMemberMutation = useMutation({
    mutationFn: async ({ policyId, memberId, data }: { policyId: string; memberId: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}/members/${memberId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "members"] });
      queryClient.invalidateQueries({ queryKey: ["/api/policies", selectedPolicy?.id, "detail"] });
      setEditMemberOpen(false);
      toast({ title: "Member updated", description: "Member details have been saved." });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const openEditMember = (m: any) => {
    setEditingMember(m);
    const nameParts = (m.memberName || "").trim().split(" ");
    setEditMemberForm({
      firstName: nameParts[0] || "",
      lastName: nameParts.slice(1).join(" ") || "",
      relationship: m.relationship || "",
      gender: m.gender || "",
      nationalId: m.nationalId || "",
      dateOfBirth: m.dateOfBirth || "",
      phone: m.phone || "",
      email: m.email || "",
    });
    setEditMemberOpen(true);
  };

  const handleEditMemberSubmit = () => {
    if (!selectedPolicy || !editingMember) return;
    const data: Record<string, any> = {};
    const orig = {
      firstName: (editingMember.memberName || "").trim().split(" ")[0] || "",
      lastName: (editingMember.memberName || "").trim().split(" ").slice(1).join(" ") || "",
      relationship: editingMember.relationship || "",
      gender: editingMember.gender || "",
      nationalId: editingMember.nationalId || "",
      dateOfBirth: editingMember.dateOfBirth || "",
      phone: editingMember.phone || "",
      email: editingMember.email || "",
    };
    for (const key of Object.keys(editMemberForm) as (keyof typeof editMemberForm)[]) {
      if (editMemberForm[key] !== orig[key]) data[key] = editMemberForm[key] || null;
    }
    if (Object.keys(data).length === 0) { setEditMemberOpen(false); return; }
    editMemberMutation.mutate({ policyId: selectedPolicy.id, memberId: editingMember.id, data });
  };

  return (
    <>
      <CardSection
        title="Policy members"
        description="All lives covered (policy holder + dependants). Filter by age band."
        icon={Users}
        headerRight={(() => {
          const limits = displayPolicy?.productMemberLimits;
          const activeMembers = (policyMembers ?? []).filter((m: any) => m.isActive !== false);
          const activeMemberCount = activeMembers.length;
          const includedCount = limits?.includedCount ?? null;
          const maxAdditional = limits?.maxAdditional ?? null;
          const totalLimit = includedCount != null && maxAdditional != null ? includedCount + maxAdditional : null;
          const additionalCount = includedCount != null ? Math.max(0, activeMemberCount - includedCount) : 0;
          const limitReached = totalLimit != null && activeMemberCount >= totalLimit;
          return (
          <>
            {limits && (
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-muted-foreground">{activeMemberCount} member{activeMemberCount !== 1 ? "s" : ""}</span>
                {includedCount != null && (
                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${activeMemberCount > includedCount ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"}`}>
                    {activeMemberCount <= includedCount ? `${activeMemberCount}/${includedCount} included` : `${includedCount} included + ${additionalCount} additional`}
                  </span>
                )}
                {limitReached && <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">Limit reached</span>}
              </div>
            )}
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
                disabled={limitReached}
                title={limitReached ? `Maximum member limit reached (${totalLimit} total)` : "Add a new dependent to this policy"}
                onClick={() => {
                  setDetailAddDepOpen(true);
                  setDetailDepForm({ firstName: "", lastName: "", relationship: "", nationalId: "", dateOfBirth: "", gender: "" });
                }}
              >
                <UserPlus className="h-3.5 w-3.5" /> Add Dependent
              </Button>
          </>
          );
        })()}
        flush
      >
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
              <TableHeader className="bg-muted/50 sticky top-0 z-[1] shadow-sm">
                <TableRow>
                  <TableHead className="pl-6">Member</TableHead>
                  <TableHead>Relationship</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>National ID</TableHead>
                  <TableHead>DOB</TableHead>
                  <TableHead>Age</TableHead>
                  <TableHead>Gender</TableHead>
                  <TableHead>Capture Date</TableHead>
                  <TableHead>Inception</TableHead>
                  <TableHead>Cover starts</TableHead>
                  <TableHead>Waiting period</TableHead>
                  {canEditPremium && <TableHead>Edit</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead>Claimable</TableHead>
                  <TableHead>Add-ons</TableHead>
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
                    <TableCell className="text-sm whitespace-nowrap">
                      {(m.role === "policy_holder" || m.role === "principal") && policyHolderClient?.phone ? (
                        <a className="text-primary hover:underline font-medium" href={`tel:${String(policyHolderClient.phone).replace(/\s+/g, "")}`}>
                          {policyHolderClient.phone}
                        </a>
                      ) : (
                        "—"
                      )}
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
                    <TableCell className="text-sm align-top min-w-[140px]">
                      {(() => {
                        const waitEnd = m.waitingPeriodEndDate || m.coverDate;
                        if (!waitEnd) {
                          return m.waitingPeriodDays != null ? (
                            <span className="text-xs text-muted-foreground">Rule: {m.waitingPeriodDays} days (no start date)</span>
                          ) : "—";
                        }
                        const end = new Date(waitEnd);
                        if (isNaN(end.getTime())) return "—";
                        const now = new Date();
                        now.setHours(0, 0, 0, 0);
                        end.setHours(0, 0, 0, 0);
                        const d = Math.ceil((end.getTime() - now.getTime()) / 86400000);
                        return (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">Ends</span>
                            <span className="font-medium whitespace-nowrap">
                              {end.toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" })}
                            </span>
                            {d > 0 ? (
                              <span className="text-xs font-semibold text-amber-700">{d} day{d !== 1 ? "s" : ""} remaining</span>
                            ) : (
                              <span className="text-xs font-semibold text-emerald-700">Completed</span>
                            )}
                          </div>
                        );
                      })()}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={m.effectiveStatus || "inactive"} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant="outline" className={m.claimable ? "bg-emerald-500/15 text-emerald-700" : "bg-amber-500/15 text-amber-700"}>
                          {m.claimable ? "Yes" : "No"}
                        </Badge>
                        {m.claimableReason && <span className="text-[10px] text-muted-foreground leading-tight max-w-[140px]">{m.claimableReason}</span>}
                      </div>
                    </TableCell>
                    <TableCell>
                      {(() => {
                        const memberAoIds = policyMemberAddOns
                          .filter((ao: any) => ao.policyMemberId === m.id)
                          .map((ao: any) => ao.addOnId);
                        const memberAoNames = memberAoIds.map((aoId: string) => {
                          const ao = addOns.find((a: any) => a.id === aoId);
                          return ao?.name ?? aoId.slice(0, 6);
                        });
                        return (
                          <div className="flex flex-wrap gap-1 items-center min-w-[120px]">
                            {memberAoNames.map((name: string) => (
                              <Badge key={name} variant="secondary" className="text-xs">{name}</Badge>
                            ))}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 shrink-0"
                              title="Edit add-ons for this member"
                              aria-label="Edit add-ons for this member"
                              onClick={() => {
                                setEditAddOnsMemberId(m.id);
                                setEditAddOnsSelected(memberAoIds);
                                setEditAddOnsOpen(true);
                              }}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                            </Button>
                          </div>
                        );
                      })()}
                    </TableCell>
                    {canEditPremium && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7" title="Edit member details" aria-label="Edit member details" onClick={() => openEditMember(m)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    )}
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
      </CardSection>

      {/* Edit add-ons dialog */}
      <Dialog open={editAddOnsOpen} onOpenChange={setEditAddOnsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Add-ons</DialogTitle>
            <DialogDescription>
              Select add-ons for this member. Changes recalculate the policy premium.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {(addOns?.filter((a: any) => a.isActive !== false) ?? []).map((ao: any) => {
              const checked = editAddOnsSelected.includes(ao.id);
              return (
                <div key={ao.id} className="flex items-center gap-2">
                  <Checkbox
                    id={`edit-ao-${ao.id}`}
                    checked={checked}
                    onCheckedChange={(v) =>
                      setEditAddOnsSelected((prev) =>
                        v ? [...prev, ao.id] : prev.filter((id) => id !== ao.id)
                      )
                    }
                  />
                  <label htmlFor={`edit-ao-${ao.id}`} className="text-sm cursor-pointer flex-1">
                    {ao.name}
                    {ao.priceMonthly && (
                      <span className="text-muted-foreground ml-1">— {displayPolicy?.currency ?? "USD"} {ao.priceMonthly}/mo</span>
                    )}
                  </label>
                </div>
              );
            })}
            {(!addOns || addOns.length === 0) && (
              <p className="text-sm text-muted-foreground">No add-ons configured for this tenant.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditAddOnsOpen(false)}>Cancel</Button>
            <Button
              disabled={setMemberAddOnsMutation.isPending}
              onClick={() => {
                if (editAddOnsMemberId)
                  setMemberAddOnsMutation.mutate({ memberId: editAddOnsMemberId, addOnIds: editAddOnsSelected });
              }}
            >
              {setMemberAddOnsMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {displayPolicy.beneficiaryFirstName && (
        <CardSection title="Beneficiary" description="Designated beneficiary for this policy." icon={Users}>
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
                <p className="font-medium font-mono tabular-nums">{displayPolicy.beneficiaryNationalId || "—"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Phone</p>
                <p className="font-medium">{displayPolicy.beneficiaryPhone || "—"}</p>
              </div>
            </div>
        </CardSection>
      )}

      {/* Add dependent to policy dialog */}
      <Dialog open={detailAddDepOpen} onOpenChange={(open) => { setDetailAddDepOpen(open); if (!open) setDetailShowNewDepForm(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Dependent to Policy</DialogTitle>
            <DialogDescription>
              {unlinkedClientDependents.length > 0 && !detailShowNewDepForm
                ? "This client already has other dependents on file — pick one to link, or add a genuinely new one."
                : "This dependent will be added to the client record and linked to this policy."}
            </DialogDescription>
          </DialogHeader>

          {unlinkedClientDependents.length > 0 && !detailShowNewDepForm ? (
            <>
              <div className="border rounded-md divide-y max-h-56 overflow-y-auto">
                {unlinkedClientDependents.map((d: any) => (
                  <button
                    key={d.id}
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 flex items-center justify-between gap-2 disabled:opacity-50"
                    disabled={linkExistingDepMutation.isPending}
                    onClick={() => linkExistingDepMutation.mutate(d.id)}
                  >
                    <span>{d.firstName} {d.lastName}{d.relationship ? ` (${d.relationship})` : ""}</span>
                    {linkExistingDepMutation.isPending && linkExistingDepMutation.variables === d.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <span className="text-xs text-muted-foreground">Link</span>}
                  </button>
                ))}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setDetailAddDepOpen(false)}>Cancel</Button>
                <Button variant="secondary" onClick={() => setDetailShowNewDepForm(true)}>
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add a New Dependent Instead
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              {unlinkedClientDependents.length > 0 && (
                <Button type="button" variant="ghost" size="sm" className="-mt-2 self-start" onClick={() => setDetailShowNewDepForm(false)}>
                  ← Back to existing dependents
                </Button>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs" htmlFor="detail-dep-form-first-name">First Name *</Label>
                  <Input id="detail-dep-form-first-name" value={detailDepForm.firstName} onChange={(e) => setDetailDepForm({ ...detailDepForm, firstName: e.target.value })} placeholder="First name" />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="detail-dep-form-last-name">Last Name *</Label>
                  <Input id="detail-dep-form-last-name" value={detailDepForm.lastName} onChange={(e) => setDetailDepForm({ ...detailDepForm, lastName: e.target.value })} placeholder="Last name" />
                </div>
                <div>
                  <Label className="text-xs" htmlFor="detail-dep-form-relationship">Relationship *</Label>
                  <Select value={detailDepForm.relationship} onValueChange={(v) => setDetailDepForm({ ...detailDepForm, relationship: v })}>
                    <SelectTrigger id="detail-dep-form-relationship"><SelectValue placeholder="Select..." /></SelectTrigger>
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
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit member details dialog */}
      <Dialog open={editMemberOpen} onOpenChange={setEditMemberOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Member Details</DialogTitle>
            <DialogDescription>
              Update personal details for <strong>{editingMember?.memberName || "this member"}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-xs" htmlFor="edit-member-form-first-name">First Name</Label>
                <Input id="edit-member-form-first-name" value={editMemberForm.firstName} onChange={(e) => setEditMemberForm({ ...editMemberForm, firstName: e.target.value })} placeholder="First name" />
              </div>
              <div>
                <Label className="text-xs" htmlFor="edit-member-form-last-name">Last Name</Label>
                <Input id="edit-member-form-last-name" value={editMemberForm.lastName} onChange={(e) => setEditMemberForm({ ...editMemberForm, lastName: e.target.value })} placeholder="Last name" />
              </div>
              <div>
                <Label className="text-xs" htmlFor="relationship">Relationship</Label>
                <Select value={editMemberForm.relationship || "none"} onValueChange={(v) => setEditMemberForm({ ...editMemberForm, relationship: v === "none" ? "" : v })}>
                  <SelectTrigger id="relationship"><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="Policy Holder">Policy Holder</SelectItem>
                    {["Spouse","Son","Daughter","Father","Mother","Brother","Sister","Grandparent","Grandchild","Uncle","Aunt","Nephew","Niece","Cousin","In-law","Other"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Gender</Label>
                <Select value={editMemberForm.gender || "none"} onValueChange={(v) => setEditMemberForm({ ...editMemberForm, gender: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">National ID</Label>
                <Input value={editMemberForm.nationalId} onChange={(e) => setEditMemberForm({ ...editMemberForm, nationalId: e.target.value.toUpperCase() })} placeholder="National ID" />
              </div>
              <div>
                <Label className="text-xs">Date of Birth</Label>
                <Input type="date" value={editMemberForm.dateOfBirth} onChange={(e) => setEditMemberForm({ ...editMemberForm, dateOfBirth: e.target.value })} />
              </div>
              {(editingMember?.role === "policy_holder" || editingMember?.role === "principal") && (
                <>
                  <div>
                    <Label className="text-xs" htmlFor="edit-member-form-phone">Phone</Label>
                    <Input id="edit-member-form-phone" value={editMemberForm.phone} onChange={(e) => setEditMemberForm({ ...editMemberForm, phone: e.target.value })} placeholder="Phone number" />
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="edit-member-form-email">Email</Label>
                    <Input id="edit-member-form-email" type="email" value={editMemberForm.email} onChange={(e) => setEditMemberForm({ ...editMemberForm, email: e.target.value })} placeholder="Email address" />
                  </div>
                </>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditMemberOpen(false)}>Cancel</Button>
            <Button onClick={handleEditMemberSubmit} disabled={editMemberMutation.isPending}>
              {editMemberMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
