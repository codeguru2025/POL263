import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, PageShell } from "@/components/ds";
import { Plus, Loader2, ArrowRight, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

/**
 * Canonical funnel order — keep aligned with `leadFunnel` / dashboard
 * (`client/src/pages/staff/dashboard.tsx`) and server-created leads (`stage: "lead"`).
 * Linear "Next" moves one step right; "Lost" jumps to terminal `lost`.
 */
const PIPELINE_STAGES = [
  { key: "lead", label: "Lead", color: "bg-muted/80 border-b border-border/60" },
  { key: "captured", label: "Captured", color: "bg-slate-100/90 border-b border-border/60" },
  { key: "contacted", label: "Contacted", color: "bg-sky-50/90 border-b border-border/60" },
  { key: "quote_generated", label: "Quote", color: "bg-indigo-50/90 border-b border-border/60" },
  { key: "application_started", label: "Application", color: "bg-violet-50/90 border-b border-border/60" },
  { key: "submitted", label: "Submitted", color: "bg-amber-50/90 border-b border-border/60" },
  { key: "approved", label: "Approved", color: "bg-green-50/90 border-b border-border/60" },
  { key: "agreed_to_pay", label: "Agreed to pay", color: "bg-emerald-100/90 border-b border-border/60" },
  { key: "activated", label: "Activated", color: "bg-emerald-50/90 border-b border-border/60" },
  { key: "lost", label: "Lost", color: "bg-red-50/90 border-b border-border/60" },
] as const;

type PipelineStageKey = (typeof PIPELINE_STAGES)[number]["key"];

const STAGE_KEYS = new Set<string>(PIPELINE_STAGES.map((s) => s.key));

function effectiveStage(lead: { stage?: string | null }): PipelineStageKey {
  const raw = (lead.stage || "captured").trim();
  if (STAGE_KEYS.has(raw)) return raw as PipelineStageKey;
  return "lead";
}

/** Next stage in the funnel, or null if already at Activated / Lost / unknown. */
function getNextStageKey(current: PipelineStageKey): PipelineStageKey | null {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
  if (idx < 0) return null;
  // Same rule as before: do not advance into `lost` via "Next" (terminal via Lost button only).
  if (idx >= PIPELINE_STAGES.length - 2) return null;
  const next = PIPELINE_STAGES[idx + 1];
  return next.key === "lost" ? null : (next.key as PipelineStageKey);
}

export default function StaffLeads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [showDialog, setShowDialog] = useState(false);
  const [createSource, setCreateSource] = useState("walk_in");

  const { data: leads = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/leads"] });

  const leadsByStage = useMemo(() => {
    const map = new Map<PipelineStageKey, any[]>();
    for (const s of PIPELINE_STAGES) map.set(s.key, []);
    for (const lead of leads) {
      const col = effectiveStage(lead);
      map.get(col)!.push(lead);
    }
    return map;
  }, [leads]);

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
    const next = getNextStageKey(effectiveStage(lead));
    if (next) updateLeadMutation.mutate({ id: lead.id, data: { stage: next } });
  };

  const markLost = (lead: any) => {
    updateLeadMutation.mutate({ id: lead.id, data: { stage: "lost", lostReason: "Manual" } });
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Lead Pipeline"
          description="Track leads from capture to activation. Scroll horizontally to see all stages."
          actions={
            <Dialog open={showDialog} onOpenChange={setShowDialog}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-lead">
                  <Plus className="h-4 w-4 mr-2" />
                  Capture Lead
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Capture New Lead</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>First Name</Label>
                      <Input name="firstName" required data-testid="input-lead-first-name" />
                    </div>
                    <div>
                      <Label>Last Name</Label>
                      <Input name="lastName" required data-testid="input-lead-last-name" />
                    </div>
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input name="phone" data-testid="input-lead-phone" />
                  </div>
                  <div>
                    <Label>Email</Label>
                    <Input name="email" type="email" data-testid="input-lead-email" />
                  </div>
                  <div>
                    <Label>Source</Label>
                    <Select name="source" value={createSource} onValueChange={setCreateSource}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="walk_in">Walk-in</SelectItem>
                        <SelectItem value="agent_link">Agent Referral</SelectItem>
                        <SelectItem value="campaign">Campaign</SelectItem>
                        <SelectItem value="website">Website</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button type="submit" disabled={createLeadMutation.isPending} data-testid="button-submit-lead">
                    {createLeadMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Capture
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          }
        />

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl border border-border/70 bg-muted/20 p-2 sm:p-3 -mx-1 sm:mx-0">
            <div
              className="flex flex-row gap-3 sm:gap-4 overflow-x-auto pb-2 pt-0.5 scroll-smooth overscroll-x-contain"
              style={{ scrollbarGutter: "stable" }}
              role="region"
              aria-label="Lead pipeline columns"
            >
              {PIPELINE_STAGES.map((stage) => {
                const stageLeads = leadsByStage.get(stage.key) ?? [];
                return (
                  <section
                    key={stage.key}
                    className={cn(
                      "flex w-[17.5rem] sm:w-[18.25rem] shrink-0 flex-col rounded-lg border border-border/80 bg-card shadow-sm",
                      "snap-start min-h-[12rem] max-h-[min(75dvh,calc(100vh-9rem))]",
                    )}
                    aria-labelledby={`lead-col-${stage.key}`}
                  >
                    <header className={cn("shrink-0 rounded-t-[inherit] px-3 py-2.5", stage.color)}>
                      <div className="flex items-start justify-between gap-2">
                        <h2
                          id={`lead-col-${stage.key}`}
                          className="text-sm font-semibold text-foreground leading-snug pr-1"
                          title={stage.label}
                        >
                          {stage.label}
                        </h2>
                        <Badge variant="secondary" className="shrink-0 tabular-nums">
                          {stageLeads.length}
                        </Badge>
                      </div>
                    </header>
                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden p-3">
                      {stageLeads.length === 0 ? (
                        <p className="text-xs text-muted-foreground text-center py-6 px-1">No leads</p>
                      ) : (
                        stageLeads.map((lead: any) => {
                          const key = effectiveStage(lead);
                          const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || "—";
                          return (
                            <article
                              key={lead.id}
                              className="rounded-lg border border-border/70 bg-background p-3 shadow-xs space-y-1.5 overflow-hidden"
                              data-testid={`card-lead-${lead.id}`}
                            >
                              <p className="font-medium text-sm leading-snug break-words" title={fullName}>
                                {fullName}
                              </p>
                              {lead.phone && (
                                <p className="text-xs text-muted-foreground break-all" title={lead.phone}>
                                  {lead.phone}
                                </p>
                              )}
                              {lead.email && (
                                <p className="text-xs text-muted-foreground break-all" title={lead.email}>
                                  {lead.email}
                                </p>
                              )}
                              {lead.source && (
                                <p className="text-[11px] text-muted-foreground capitalize">
                                  {String(lead.source).replace(/_/g, " ")}
                                </p>
                              )}
                              {lead.clientId && (
                                <p className="text-[11px] text-primary font-medium">Client linked</p>
                              )}
                              {lead.stage && !STAGE_KEYS.has(lead.stage) && (
                                <p className="text-[10px] text-amber-800/90" title={`Stored stage: ${lead.stage}`}>
                                  Unmapped stage — shown in Lead
                                </p>
                              )}
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {lead.clientId && (key === "approved" || key === "agreed_to_pay") && (
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-7 text-xs"
                                    onClick={() => setLocation(`/staff/policies?create=1&clientId=${lead.clientId}`)}
                                    data-testid={`btn-issue-policy-${lead.id}`}
                                  >
                                    <FileText className="h-3 w-3 mr-1 shrink-0" />
                                    Issue policy
                                  </Button>
                                )}
                                {stage.key !== "activated" && stage.key !== "lost" && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    className="h-7 text-xs"
                                    disabled={!getNextStageKey(key)}
                                    onClick={() => advanceStage(lead)}
                                  >
                                    <ArrowRight className="h-3 w-3 mr-1 shrink-0" />
                                    Next
                                  </Button>
                                )}
                                {stage.key !== "lost" && stage.key !== "activated" && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs text-destructive hover:text-destructive"
                                    onClick={() => markLost(lead)}
                                  >
                                    Lost
                                  </Button>
                                )}
                              </div>
                            </article>
                          );
                        })
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}
