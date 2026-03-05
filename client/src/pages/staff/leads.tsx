import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Plus, Users, Loader2, ArrowRight, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

const STAGES = [
  { key: "lead", label: "Lead", color: "bg-gray-100" },
  { key: "captured", label: "Captured", color: "bg-slate-100" },
  { key: "contacted", label: "Contacted", color: "bg-blue-50" },
  { key: "quote_generated", label: "Quote", color: "bg-indigo-50" },
  { key: "application_started", label: "Application", color: "bg-purple-50" },
  { key: "submitted", label: "Submitted", color: "bg-yellow-50" },
  { key: "approved", label: "Approved", color: "bg-green-50" },
  { key: "agreed_to_pay", label: "Agreed to pay", color: "bg-emerald-100" },
  { key: "activated", label: "Activated", color: "bg-green-100" },
  { key: "lost", label: "Lost", color: "bg-red-50" },
];

export default function StaffLeads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [createSource, setCreateSource] = useState("walk_in");

  const { data: leads = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/leads"] });

  const createLeadMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/leads", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setShowDialog(false);
      toast({ title: "Lead captured" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateLeadMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PATCH", `/api/leads/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      toast({ title: "Lead updated" });
    },
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createLeadMutation.mutate({
      firstName: fd.get("firstName"),
      lastName: fd.get("lastName"),
      phone: fd.get("phone") || undefined,
      email: fd.get("email") || undefined,
      source: createSource || "walk_in",
    });
  };

  const advanceStage = (lead: any) => {
    const idx = STAGES.findIndex(s => s.key === lead.stage);
    if (idx >= 0 && idx < STAGES.length - 2) {
      updateLeadMutation.mutate({ id: lead.id, data: { stage: STAGES[idx + 1].key } });
    }
  };

  const markLost = (lead: any) => {
    updateLeadMutation.mutate({ id: lead.id, data: { stage: "lost", lostReason: "Manual" } });
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-leads-title">Lead Pipeline</h1>
            <p className="text-muted-foreground">Track leads from capture to activation</p>
          </div>
          <Dialog open={showDialog} onOpenChange={setShowDialog}>
            <DialogTrigger asChild>
              <Button data-testid="button-new-lead"><Plus className="h-4 w-4 mr-2" />Capture Lead</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Capture New Lead</DialogTitle></DialogHeader>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div><Label>First Name</Label><Input name="firstName" required data-testid="input-lead-first-name" /></div>
                  <div><Label>Last Name</Label><Input name="lastName" required data-testid="input-lead-last-name" /></div>
                </div>
                <div><Label>Phone</Label><Input name="phone" data-testid="input-lead-phone" /></div>
                <div><Label>Email</Label><Input name="email" type="email" data-testid="input-lead-email" /></div>
                <div><Label>Source</Label>
                  <Select name="source" value={createSource} onValueChange={setCreateSource}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="walk_in">Walk-in</SelectItem>
                      <SelectItem value="agent_link">Agent Referral</SelectItem>
                      <SelectItem value="campaign">Campaign</SelectItem>
                      <SelectItem value="website">Website</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={createLeadMutation.isPending} data-testid="button-submit-lead">
                  {createLeadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Capture
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin" /></div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-5 lg:grid-cols-10 gap-4">
            {STAGES.map(stage => {
              const stageLeads = leads.filter((l: any) => l.stage === stage.key);
              return (
                <Card key={stage.key} className="flex flex-col min-w-0">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-sm flex items-center justify-between gap-2">
                      <span className="truncate">{stage.label}</span>
                      <Badge variant="secondary" className="shrink-0">{stageLeads.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 flex-1 overflow-y-auto max-h-[70vh] px-4 pb-4">
                    {stageLeads.length === 0 ? (
                      <p className="text-xs text-muted-foreground text-center py-4">No leads</p>
                    ) : (
                      stageLeads.map((lead: any) => (
                        <div key={lead.id} className="p-3 rounded-lg border bg-card space-y-1" data-testid={`card-lead-${lead.id}`}>
                          <p className="font-medium text-sm">{lead.firstName} {lead.lastName}</p>
                          {lead.phone && <p className="text-xs text-muted-foreground">{lead.phone}</p>}
                          {lead.email && <p className="text-xs text-muted-foreground truncate" title={lead.email}>{lead.email}</p>}
                          {lead.source && <p className="text-[10px] text-muted-foreground capitalize">{lead.source.replace(/_/g, " ")}</p>}
                          {lead.clientId && (
                            <p className="text-[10px] text-primary mt-0.5 font-medium">Client linked</p>
                          )}
                          <div className="flex flex-wrap gap-1 mt-2">
                            {lead.clientId && (lead.stage === "approved" || lead.stage === "agreed_to_pay") && (
                              <Button
                                size="sm"
                                variant="default"
                                className="h-6 text-xs"
                                onClick={() => setLocation(`/staff/policies?create=1&clientId=${lead.clientId}`)}
                                data-testid={`btn-issue-policy-${lead.id}`}
                              >
                                <FileText className="h-3 w-3 mr-1" /> Issue policy
                              </Button>
                            )}
                            {stage.key !== "activated" && stage.key !== "lost" && (
                              <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => advanceStage(lead)}>
                                <ArrowRight className="h-3 w-3 mr-1" />Next
                              </Button>
                            )}
                            {stage.key !== "lost" && stage.key !== "activated" && (
                              <Button size="sm" variant="ghost" className="h-6 text-xs text-destructive" onClick={() => markLost(lead)}>
                                Lost
                              </Button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </StaffLayout>
  );
}
