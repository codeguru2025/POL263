/**
 * Client claims page: list claims and lodge new claim (policy, claim type, deceased details).
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ClipboardList, ArrowLeft, Plus, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CLAIM_TYPES = ["death", "accidental_death", "disability", "repatriation", "cash_in_lieu"];

interface Claim {
  id: string;
  claimNumber: string;
  policyId: string;
  claimType: string;
  status: string;
  deceasedName: string | null;
  deceasedRelationship: string | null;
  dateOfDeath: string | null;
  causeOfDeath: string | null;
  createdAt: string;
}

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
}

export default function ClientClaims() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    policyId: "",
    claimType: "",
    deceasedName: "",
    deceasedRelationship: "",
    dateOfDeath: "",
    causeOfDeath: "",
  });

  const { data: me, isFetched: meFetched, isError: meError } = useQuery<{ client: { id: string } }>({ queryKey: ["/api/client-auth/me"], retry: false });
  const { data: policies } = useQuery<Policy[]>({ queryKey: ["/api/client-auth/policies"], enabled: !!me?.client });
  const { data: claims = [], isLoading } = useQuery<Claim[]>({
    queryKey: ["/api/client-auth/claims"],
    enabled: !!me?.client,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/client-auth/claims", {
        policyId: form.policyId,
        claimType: form.claimType,
        deceasedName: form.deceasedName || undefined,
        deceasedRelationship: form.deceasedRelationship || undefined,
        dateOfDeath: form.dateOfDeath || undefined,
        causeOfDeath: form.causeOfDeath || undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/client-auth/claims"] });
      setShowForm(false);
      setForm({ policyId: "", claimType: "", deceasedName: "", deceasedRelationship: "", dateOfDeath: "", causeOfDeath: "" });
      toast({ title: "Claim submitted", description: "Your claim has been submitted. We will contact you." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (meFetched && (meError || !me?.client)) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <p className="text-muted-foreground">Please sign in again to access your portal.</p>
            <Button onClick={() => setLocation("/client/login")}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatDate = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" }) : "—");
  const formatStatus = (s: string) => s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <ClientLayout clientName="">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button variant="ghost" className="gap-2" onClick={() => setLocation("/client")}>
          <ArrowLeft className="h-4 w-4" />
          Back to dashboard
        </Button>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              My claims
            </CardTitle>
            <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4" />
              Lodge claim
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-muted-foreground text-sm py-6 text-center">Loading…</p>
            ) : claims.length === 0 ? (
              <p className="text-muted-foreground text-sm py-6 text-center">No claims yet. Use &quot;Lodge claim&quot; to submit one.</p>
            ) : (
              <ul className="space-y-3">
                {claims.map((c) => (
                  <li key={c.id} className="p-4 border rounded-lg">
                    <div className="flex justify-between items-start gap-2">
                      <div>
                        <p className="font-medium text-sm">{c.claimNumber}</p>
                        <p className="text-xs text-muted-foreground capitalize">{formatStatus(c.claimType)} — {formatStatus(c.status)}</p>
                        {c.deceasedName && <p className="text-xs mt-1">Deceased: {c.deceasedName}{c.deceasedRelationship ? ` (${c.deceasedRelationship})` : ""}</p>}
                        <p className="text-xs text-muted-foreground mt-1">Submitted {formatDate(c.createdAt)}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {showForm && (
          <Card>
            <CardHeader>
              <CardTitle>Lodge a claim</CardTitle>
              <p className="text-sm text-muted-foreground">Submit a new claim for a policy you own. We will review and contact you.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label>Policy</Label>
                <Select value={form.policyId} onValueChange={(v) => setForm((p) => ({ ...p, policyId: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select policy" /></SelectTrigger>
                  <SelectContent>
                    {policies?.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.policyNumber} — {p.status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Claim type</Label>
                <Select value={form.claimType} onValueChange={(v) => setForm((p) => ({ ...p, claimType: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {CLAIM_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>{formatStatus(t)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Deceased name (if applicable)</Label>
                <Input value={form.deceasedName} onChange={(e) => setForm((p) => ({ ...p, deceasedName: e.target.value }))} placeholder="Full name" />
              </div>
              <div>
                <Label>Relationship to deceased</Label>
                <Input value={form.deceasedRelationship} onChange={(e) => setForm((p) => ({ ...p, deceasedRelationship: e.target.value }))} placeholder="e.g. spouse, parent" />
              </div>
              <div>
                <Label>Date of death</Label>
                <Input type="date" value={form.dateOfDeath} onChange={(e) => setForm((p) => ({ ...p, dateOfDeath: e.target.value }))} />
              </div>
              <div>
                <Label>Cause of death (optional)</Label>
                <Input value={form.causeOfDeath} onChange={(e) => setForm((p) => ({ ...p, causeOfDeath: e.target.value }))} placeholder="Brief description" />
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={!form.policyId || !form.claimType || createMutation.isPending}
                  onClick={() => createMutation.mutate()}
                >
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Submit claim
                </Button>
                <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </ClientLayout>
  );
}
