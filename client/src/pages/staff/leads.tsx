import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, PageShell } from "@/components/ds";
import { Plus, Loader2, FileText, Phone, Mail, User, Calendar, Tag, MessageSquare, X, FileDown, MoreVertical } from "lucide-react";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";

/**
 * 6-stage pipeline. Each display column maps to one or more legacy DB stage values.
 * Advancing always writes the display column's `key` to the DB.
 */
const PIPELINE_STAGES = [
  {
    key: "new",
    label: "New",
    dbKeys: ["lead", "captured", "new"],
    color: "bg-slate-50 border-b border-slate-200",
    badgeColor: "bg-slate-100 text-slate-700",
  },
  {
    key: "contacted",
    label: "Contacted",
    dbKeys: ["contacted"],
    color: "bg-sky-50 border-b border-sky-100",
    badgeColor: "bg-sky-100 text-sky-700",
  },
  {
    key: "qualified",
    label: "Qualified",
    dbKeys: ["qualified", "application_started", "submitted"],
    color: "bg-violet-50 border-b border-violet-100",
    badgeColor: "bg-violet-100 text-violet-700",
  },
  {
    key: "quoted",
    label: "Quoted",
    dbKeys: ["quoted", "quote_generated", "approved", "agreed_to_pay"],
    color: "bg-amber-50 border-b border-amber-100",
    badgeColor: "bg-amber-100 text-amber-700",
  },
  {
    key: "converted",
    label: "Converted",
    dbKeys: ["converted", "activated"],
    color: "bg-emerald-50 border-b border-emerald-100",
    badgeColor: "bg-emerald-100 text-emerald-700",
  },
  {
    key: "lost",
    label: "Lost",
    dbKeys: ["lost"],
    color: "bg-red-50 border-b border-red-100",
    badgeColor: "bg-red-100 text-red-700",
  },
] as const;

type StageKey = (typeof PIPELINE_STAGES)[number]["key"];

function effectiveStage(lead: { stage?: string | null }): StageKey {
  const raw = (lead.stage ?? "new").trim();
  for (const s of PIPELINE_STAGES) {
    if ((s.dbKeys as readonly string[]).includes(raw)) return s.key;
  }
  return "new";
}

function nextStage(current: StageKey): StageKey | null {
  const idx = PIPELINE_STAGES.findIndex((s) => s.key === current);
  if (idx < 0 || idx >= PIPELINE_STAGES.length - 2) return null;
  const next = PIPELINE_STAGES[idx + 1];
  return next.key === "lost" ? null : next.key;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "2-digit" });
}

export default function StaffLeads() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const createSearch = useSearch();

  const [showCreate, setShowCreate] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("create") === "1",
  );
  const [createSource, setCreateSource] = useState("walk_in");
  const [viewingLead, setViewingLead] = useState<any | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editProduct, setEditProduct] = useState("");
  const [dragLeadId, setDragLeadId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<StageKey | null>(null);

  useEffect(() => {
    if (new URLSearchParams(createSearch).get("create") === "1") setShowCreate(true);
  }, [createSearch]);

  const { data: leads = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/leads"] });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"] });

  const userMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const u of users) m.set(u.id, u.displayName || u.email || "—");
    return m;
  }, [users]);

  const leadsByStage = useMemo(() => {
    const map = new Map<StageKey, any[]>();
    for (const s of PIPELINE_STAGES) map.set(s.key, []);
    for (const lead of leads) map.get(effectiveStage(lead))!.push(lead);
    return map;
  }, [leads]);

  const createMutation = useMutation({
    mutationFn: async (data: any) => (await apiRequest("POST", "/api/leads", data)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      setShowCreate(false);
      toast({ title: "Lead captured" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) =>
      (await apiRequest("PATCH", `/api/leads/${id}`, data)).json(),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
      if (viewingLead?.id === updated.id) setViewingLead(updated);
      toast({ title: "Lead updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreate = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    createMutation.mutate({
      firstName: fd.get("firstName"),
      lastName: fd.get("lastName"),
      phone: fd.get("phone") || undefined,
      email: fd.get("email") || undefined,
      productInterest: fd.get("productInterest") || undefined,
      source: createSource || "walk_in",
      stage: "new",
    });
  };

  const openDetail = (lead: any) => {
    setViewingLead(lead);
    setEditNotes(lead.notes || "");
    setEditProduct(lead.productInterest || "");
  };

  const saveDetail = () => {
    if (!viewingLead) return;
    updateMutation.mutate({
      id: viewingLead.id,
      data: { notes: editNotes || null, productInterest: editProduct || null },
    });
  };

  const moveStage = (lead: any, stage: StageKey) => {
    updateMutation.mutate({ id: lead.id, data: { stage } });
  };

  // Drag-and-drop handlers
  const handleDragStart = (e: React.DragEvent, lead: any) => {
    setDragLeadId(lead.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", lead.id);
  };

  const handleDragOver = (e: React.DragEvent, stageKey: StageKey) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOver(stageKey);
  };

  const handleDrop = (e: React.DragEvent, stageKey: StageKey) => {
    e.preventDefault();
    const leadId = e.dataTransfer.getData("text/plain") || dragLeadId;
    const lead = leads.find((l) => l.id === leadId);
    if (lead && effectiveStage(lead) !== stageKey) {
      updateMutation.mutate({ id: leadId!, data: { stage: stageKey } });
    }
    setDragLeadId(null);
    setDragOver(null);
  };

  const handleDragEnd = () => {
    setDragLeadId(null);
    setDragOver(null);
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Lead Pipeline"
          description="Drag cards between stages or click a card to edit."
          actions={
            <div className="flex gap-2 flex-wrap items-center">
              <Button variant="outline" className="gap-1.5" asChild>
                <a href={getApiBase() + "/api/forms/blank/lead-capture"} target="_blank" rel="noopener noreferrer">
                  <FileDown className="h-4 w-4" /> Blank Lead Form
                </a>
              </Button>
            <Dialog open={showCreate} onOpenChange={setShowCreate}>
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
                <form onSubmit={handleCreate} noValidate className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <Label>First Name *</Label>
                      <Input name="firstName" required data-testid="input-lead-first-name" />
                    </div>
                    <div>
                      <Label>Last Name *</Label>
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
                    <Label>Product of Interest</Label>
                    <Input name="productInterest" placeholder="e.g. Life Cover, Funeral Plan…" />
                  </div>
                  <div>
                    <Label>Source</Label>
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
                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-lead">
                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Capture
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            </div>
          }
        />

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="rounded-xl border border-border/60 bg-muted/10 p-2 sm:p-3">
            <div
              className="flex flex-row gap-3 overflow-x-auto pb-3 pt-1 scroll-smooth"
              style={{ scrollbarGutter: "stable" }}
              role="region"
              aria-label="Lead pipeline"
            >
              {PIPELINE_STAGES.map((stage) => {
                const stageLeads = leadsByStage.get(stage.key) ?? [];
                const isDropTarget = dragOver === stage.key;
                return (
                  <section
                    key={stage.key}
                    className={cn(
                      "flex w-64 shrink-0 flex-col rounded-lg border bg-card shadow-sm transition-colors",
                      isDropTarget ? "border-primary/50 ring-2 ring-primary/20" : "border-border/70",
                      "min-h-[14rem] max-h-[min(78dvh,calc(100vh-8rem))]",
                    )}
                    onDragOver={(e) => handleDragOver(e, stage.key)}
                    onDrop={(e) => handleDrop(e, stage.key)}
                    onDragLeave={() => setDragOver(null)}
                    aria-labelledby={`col-${stage.key}`}
                  >
                    <header className={cn("shrink-0 rounded-t-[inherit] px-3 py-2", stage.color)}>
                      <div className="flex items-center justify-between gap-2">
                        <h2 id={`col-${stage.key}`} className="text-sm font-semibold">
                          {stage.label}
                        </h2>
                        <span className={cn("text-xs font-medium px-1.5 py-0.5 rounded-full tabular-nums", stage.badgeColor)}>
                          {stageLeads.length}
                        </span>
                      </div>
                    </header>

                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
                      {stageLeads.length === 0 ? (
                        <p className={cn(
                          "text-xs text-muted-foreground text-center py-8 px-2 rounded-md border-2 border-dashed",
                          isDropTarget ? "border-primary/30 text-primary" : "border-transparent",
                        )}>
                          {isDropTarget ? "Drop here" : "No leads"}
                        </p>
                      ) : (
                        stageLeads.map((lead: any) => {
                          const curStage = effectiveStage(lead);
                          const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "—";
                          const agentName = lead.agentId ? userMap.get(lead.agentId) : null;
                          const isDragging = dragLeadId === lead.id;
                          return (
                            <article
                              key={lead.id}
                              draggable
                              onDragStart={(e) => handleDragStart(e, lead)}
                              onDragEnd={handleDragEnd}
                              onClick={() => openDetail(lead)}
                              className={cn(
                                "rounded-md border border-border/60 bg-background p-2.5 shadow-xs cursor-pointer",
                                "hover:border-primary/40 hover:shadow-sm transition-all select-none",
                                isDragging && "opacity-40",
                              )}
                              data-testid={`card-lead-${lead.id}`}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <p className="font-medium text-sm leading-snug truncate" title={fullName}>
                                  {fullName}
                                </p>
                                {/* Touch-friendly alternative to drag-and-drop (HTML5 DnD doesn't work on
                                    touch/Capacitor WebViews) — reuses the same moveStage() mutation the
                                    desktop drop handler calls. stopPropagation so tapping this doesn't
                                    also trigger the card's onClick (openDetail). */}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      onClick={(e) => e.stopPropagation()}
                                      className="shrink-0 -mr-1 -mt-1 rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground touch-target"
                                      aria-label={`Move ${fullName} to a different stage`}
                                      data-testid={`button-move-stage-${lead.id}`}
                                    >
                                      <MoreVertical className="h-3.5 w-3.5" />
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                                    {PIPELINE_STAGES.map((stage) => (
                                      <DropdownMenuItem
                                        key={stage.key}
                                        disabled={stage.key === curStage}
                                        onClick={() => moveStage(lead, stage.key)}
                                      >
                                        Move to {stage.label}
                                      </DropdownMenuItem>
                                    ))}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                              {lead.phone && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <Phone className="h-3 w-3 shrink-0" />
                                  {lead.phone}
                                </p>
                              )}
                              {agentName && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <User className="h-3 w-3 shrink-0" />
                                  {agentName}
                                </p>
                              )}
                              {lead.productInterest && (
                                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                                  <Tag className="h-3 w-3 shrink-0" />
                                  {lead.productInterest}
                                </p>
                              )}
                              <p className="text-[11px] text-muted-foreground/70 mt-1 flex items-center gap-1">
                                <Calendar className="h-3 w-3 shrink-0" />
                                {fmtDate(lead.createdAt)}
                              </p>
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

        {/* Lead detail dialog */}
        {viewingLead && (
          <Dialog open={!!viewingLead} onOpenChange={(open) => { if (!open) setViewingLead(null); }}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  {[viewingLead.firstName, viewingLead.lastName].filter(Boolean).join(" ") || "Lead"}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                {/* Contact info */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                  {viewingLead.phone && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Phone className="h-4 w-4 shrink-0" />
                      {viewingLead.phone}
                    </div>
                  )}
                  {viewingLead.email && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="h-4 w-4 shrink-0" />
                      {viewingLead.email}
                    </div>
                  )}
                  {viewingLead.agentId && (
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <User className="h-4 w-4 shrink-0" />
                      {userMap.get(viewingLead.agentId) || "Agent"}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Calendar className="h-4 w-4 shrink-0" />
                    {fmtDate(viewingLead.createdAt)}
                  </div>
                </div>

                {/* Source + stage */}
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="capitalize">
                    {String(viewingLead.source ?? "").replace(/_/g, " ") || "Walk-in"}
                  </Badge>
                  <Badge variant="outline" className="capitalize">
                    {PIPELINE_STAGES.find((s) => s.key === effectiveStage(viewingLead))?.label}
                  </Badge>
                  {viewingLead.clientId && <Badge className="bg-primary/10 text-primary">Client linked</Badge>}
                </div>

                {/* Move to stage */}
                <div>
                  <Label className="text-xs text-muted-foreground mb-1 block">Move to stage</Label>
                  <div className="flex flex-wrap gap-1.5">
                    {PIPELINE_STAGES.map((s) => {
                      const isCurrent = effectiveStage(viewingLead) === s.key;
                      return (
                        <button
                          key={s.key}
                          onClick={() => !isCurrent && moveStage(viewingLead, s.key)}
                          className={cn(
                            "text-xs px-2.5 py-1 rounded-full border transition-colors",
                            isCurrent
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background border-border hover:border-primary/50 hover:bg-muted",
                          )}
                          disabled={isCurrent || updateMutation.isPending}
                        >
                          {s.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Product of interest */}
                <div>
                  <Label htmlFor="detail-product" className="text-xs text-muted-foreground">Product of Interest</Label>
                  <Input
                    id="detail-product"
                    value={editProduct}
                    onChange={(e) => setEditProduct(e.target.value)}
                    placeholder="e.g. Life Cover, Funeral Plan…"
                    className="mt-1"
                  />
                </div>

                {/* Notes */}
                <div>
                  <Label htmlFor="detail-notes" className="text-xs text-muted-foreground">Notes</Label>
                  <Textarea
                    id="detail-notes"
                    value={editNotes}
                    onChange={(e) => setEditNotes(e.target.value)}
                    rows={3}
                    placeholder="Any follow-up notes…"
                    className="mt-1 resize-none"
                  />
                </div>

                {viewingLead.lostReason && (
                  <p className="text-sm text-destructive">Lost reason: {viewingLead.lostReason}</p>
                )}

                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={saveDetail}
                      disabled={updateMutation.isPending}
                    >
                      {updateMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                      Save
                    </Button>
                    {viewingLead.clientId && effectiveStage(viewingLead) === "converted" && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => { setViewingLead(null); setLocation(`/staff/policies?create=1&clientId=${viewingLead.clientId}`); }}
                      >
                        <FileText className="h-3 w-3 mr-1" />
                        Issue Policy
                      </Button>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive"
                    onClick={() => { moveStage(viewingLead, "lost"); setViewingLead(null); }}
                    disabled={effectiveStage(viewingLead) === "lost"}
                  >
                    Mark Lost
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </PageShell>
    </StaffLayout>
  );
}
