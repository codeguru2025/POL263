import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CardSection } from "@/components/ds";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, History, Loader2, UserCog } from "lucide-react";

type Mode = "dependent" | "new_person";

const blankPerson = { firstName: "", lastName: "", nationalId: "", dateOfBirth: "", gender: "", phone: "", email: "" };

/**
 * Change of policyholder — e.g. after the policyholder has died. Staff pick an eligible adult
 * dependant already on the policy, or capture a new person. The original holder stays on the
 * policy as "former policyholder" and every change is kept (see PolicyholderHistoryCard).
 */
export function ChangePolicyholderDialog({ open, onOpenChange, policy, members, defaultReason, claimId }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  policy: any;
  members: any[];
  defaultReason?: string;
  claimId?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const eligible = members.filter((m) => m.role === "dependent" && m.isActive !== false && m.claimStatus !== "claimed" && (m.age == null || m.age >= 18));
  const [mode, setMode] = useState<Mode>(eligible.length ? "dependent" : "new_person");
  const [memberId, setMemberId] = useState("");
  const [person, setPerson] = useState({ ...blankPerson });
  const [reason, setReason] = useState(defaultReason ?? "");

  const pickMember = (id: string) => {
    setMemberId(id);
    const m = members.find((x) => x.id === id);
    if (m) {
      const [firstName, ...rest] = (m.memberName || "").trim().split(" ");
      setPerson({
        firstName: firstName || "", lastName: rest.join(" "), nationalId: m.nationalId || "",
        dateOfBirth: m.dateOfBirth || "", gender: m.gender || "", phone: m.phone || "", email: "",
      });
    }
  };

  const change = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/policies/${policy.id}/change-policyholder`, {
      mode, policyMemberId: mode === "dependent" ? memberId : undefined, person, reason, claimId: claimId || undefined,
    })).json(),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      onOpenChange(false);
      setPerson({ ...blankPerson });
      setMemberId("");
      toast({
        title: `${data.newClient.firstName} ${data.newClient.lastName} is now the policyholder`,
        description: data.oldPremium !== data.newPremium
          ? `Premium changed from ${policy.currency} ${data.oldPremium} to ${policy.currency} ${data.newPremium}. The previous policyholder stays on record.`
          : "The previous policyholder stays on record.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't change the policyholder", description: err.message, variant: "destructive" }),
  });

  const set = (k: keyof typeof blankPerson, v: string) => setPerson((p) => ({ ...p, [k]: v }));
  const canSubmit = reason.trim() && person.firstName.trim() && person.lastName.trim() && person.phone.trim() && (mode === "new_person" || memberId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Change policyholder</DialogTitle>
          <DialogDescription>
            Policy {policy.policyNumber}. The current policyholder stays on the policy as the former policyholder — nothing is deleted.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={mode === "dependent" ? "default" : "outline"} size="sm" disabled={!eligible.length} onClick={() => setMode("dependent")}>
              A dependant on this policy
            </Button>
            <Button type="button" variant={mode === "new_person" ? "default" : "outline"} size="sm" onClick={() => { setMode("new_person"); setMemberId(""); setPerson({ ...blankPerson }); }}>
              Someone new
            </Button>
          </div>
          {!eligible.length && <p className="text-xs text-muted-foreground">No adult dependant on this policy can take it over — add the new policyholder's details instead.</p>}

          {mode === "dependent" && (
            <div className="space-y-2">
              <Label>Dependant who takes over</Label>
              <Select value={memberId} onValueChange={pickMember}>
                <SelectTrigger data-testid="select-new-policyholder"><SelectValue placeholder="Choose an adult dependant…" /></SelectTrigger>
                <SelectContent>
                  {eligible.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.memberName} · {(m.relationship || "dependant").toLowerCase()}{m.age != null ? ` · ${m.age}y` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">Only adults (18+) who are still covered are listed. They stop being priced as a dependant, so the premium may change.</p>
            </div>
          )}

          {(mode === "new_person" || memberId) && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label className="text-xs">First name *</Label><Input value={person.firstName} onChange={(e) => set("firstName", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Last name *</Label><Input value={person.lastName} onChange={(e) => set("lastName", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Phone * (gets the policy SMSes)</Label><Input value={person.phone} onChange={(e) => set("phone", e.target.value)} data-testid="input-new-holder-phone" /></div>
              <div className="space-y-1"><Label className="text-xs">National ID{policy.isLegacy ? "" : " *"}</Label><Input value={person.nationalId} onChange={(e) => set("nationalId", e.target.value)} /></div>
              <div className="space-y-1"><Label className="text-xs">Date of birth{policy.isLegacy ? "" : " *"}</Label><Input type="date" value={person.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} /></div>
              <div className="space-y-1">
                <Label className="text-xs">Gender{policy.isLegacy ? "" : " *"}</Label>
                <Select value={person.gender || "__none__"} onValueChange={(v) => set("gender", v === "__none__" ? "" : v)}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 col-span-2"><Label className="text-xs">Email</Label><Input type="email" value={person.email} onChange={(e) => set("email", e.target.value)} /></div>
            </div>
          )}

          <div className="space-y-1">
            <Label>Reason *</Label>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Policyholder passed away (claim CLM-000003)" data-testid="input-policyholder-change-reason" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => change.mutate()} disabled={!canSubmit || change.isPending} data-testid="button-confirm-policyholder-change">
            {change.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Change policyholder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Shown when the policyholder has died (their claim was approved) and nobody has taken over. */
export function DeceasedHolderBanner({ holder, onChange }: { holder: any; onChange: () => void }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-500/10 p-4 flex flex-wrap items-center gap-3" data-testid="banner-deceased-policyholder">
      <AlertTriangle className="h-5 w-5 text-amber-700 shrink-0" />
      <div className="flex-1 min-w-[220px] text-sm">
        <p className="font-semibold">The policyholder, {holder.memberName}, has died.</p>
        <p className="text-muted-foreground">Choose who takes over this policy — an adult dependant on it, or someone new. {holder.memberName} stays on record as the original policyholder.</p>
      </div>
      <Button size="sm" onClick={onChange} className="gap-1.5"><UserCog className="h-4 w-4" /> Choose new policyholder</Button>
    </div>
  );
}

export function PolicyholderHistoryCard({ policyId }: { policyId: string }) {
  const { data } = useQuery<any>({
    queryKey: ["/api/policies", policyId, "holder-history"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/policies/${policyId}/holder-history`, { credentials: "include" });
      return res.ok ? res.json() : null;
    },
  });
  if (!data || data.changes.length === 0) return null;
  return (
    <CardSection title="Policyholder history" icon={History} description={`Original policyholder: ${data.original.name ?? "—"}`}>
      <ol className="space-y-2 text-sm">
        {data.changes.map((c: any) => (
          <li key={c.id} className="border-l-2 border-primary/40 pl-3">
            <p><span className="font-medium">{c.fromName ?? "—"}</span> → <span className="font-medium">{c.toName ?? "—"}</span></p>
            <p className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString()} · by {c.changedByName ?? "staff"} · {c.reason}</p>
          </li>
        ))}
      </ol>
    </CardSection>
  );
}
