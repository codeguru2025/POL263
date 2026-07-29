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
import { Plus, Loader2, FileText, Phone, Mail, User, Calendar, Tag, MessageSquare, X, FileDown, MoreVertical, Link2, Check, ArrowRight, Receipt } from "lucide-react";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useLocation, useSearch } from "wouter";
import { cn } from "@/lib/utils";
import { resolveDobForQuote } from "@/lib/estimated-dob";
import { PIPELINE_STAGES, effectiveLeadStage, nextLeadStage, type LeadStageKey } from "@shared/lead-pipeline";

type StageKey = LeadStageKey;
const effectiveStage = effectiveLeadStage;
const nextStage = nextLeadStage;

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

  // ── Quote a lead (standalone — no client record required) ──────────────
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteDob, setQuoteDob] = useState("");
  const [quoteDeps, setQuoteDeps] = useState<{ firstName: string; lastName: string; dateOfBirth: string; estimatedAge: string }[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [quoteApiError, setQuoteApiError] = useState<string | null>(null);
  const [freshQuote, setFreshQuote] = useState<{ recommended: any; alternatives: any[]; quoteId: string | null } | null>(null);
  const [quoteLinkCopied, setQuoteLinkCopied] = useState(false);
  const [emailQuoteAddress, setEmailQuoteAddress] = useState("");

  const { data: existingQuote, isLoading: existingQuoteLoading } = useQuery<any>({
    queryKey: ["/api/leads", viewingLead?.id, "quote"],
    queryFn: async () => {
      try {
        return await (await apiRequest("GET", `/api/leads/${viewingLead.id}/quote`)).json();
      } catch {
        return null;
      }
    },
    enabled: !!viewingLead,
  });
  const activeQuote = freshQuote || (existingQuote ? {
    recommended: existingQuote.recommendedProductVersionId ? {
      productName: existingQuote.recommendedProductName,
      premium: existingQuote.recommendedPremium,
      currency: existingQuote.currency,
      paymentSchedule: existingQuote.paymentSchedule,
    } : null,
    alternatives: existingQuote.alternativesJson || [],
    quoteId: existingQuote.id,
  } : null);

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

  const emailQuoteMutation = useMutation({
    mutationFn: async ({ quoteId, email }: { quoteId: string; email: string }) =>
      (await apiRequest("POST", `/api/quotes/${quoteId}/email`, { email })).json(),
    onSuccess: (data: any) => toast({ title: "Quote emailed", description: data.message }),
    onError: (err: any) => toast({ title: "Couldn't send quote email", description: err.message, variant: "destructive" }),
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
    setShowQuoteForm(false);
    setQuoteDob("");
    setQuoteDeps([]);
    setQuoteApiError(null);
    setFreshQuote(null);
    setEmailQuoteAddress(lead.email || "");
  };

  const addQuoteDep = () => setQuoteDeps((d) => [...d, { firstName: "", lastName: "", dateOfBirth: "", estimatedAge: "" }]);
  const removeQuoteDep = (i: number) => setQuoteDeps((d) => d.filter((_, idx) => idx !== i));
  const updateQuoteDep = (i: number, field: "firstName" | "lastName" | "dateOfBirth" | "estimatedAge", value: string) =>
    setQuoteDeps((d) => d.map((dep, idx) => (idx === i ? { ...dep, [field]: value } : dep)));

  const getLeadQuote = async () => {
    if (!viewingLead || !quoteDob) return;
    setQuoting(true);
    setQuoteApiError(null);
    try {
      const policyholderName = [viewingLead.firstName, viewingLead.lastName].filter(Boolean).join(" ");
      const res = await apiRequest("POST", "/api/quote", {
        leadId: viewingLead.id,
        policyholderName,
        policyholderDateOfBirth: quoteDob,
        dependents: quoteDeps.map((d) => ({ firstName: d.firstName, lastName: d.lastName, dateOfBirth: resolveDobForQuote(d.dateOfBirth, d.estimatedAge) || "" })),
        dependentDateOfBirths: quoteDeps.map((d) => resolveDobForQuote(d.dateOfBirth, d.estimatedAge)).filter((x): x is string => !!x),
      });
      const data = await res.json();
      setFreshQuote(data);
      setShowQuoteForm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/leads"] });
    } catch (err: any) {
      setQuoteApiError(err.message || "Couldn't get a quote right now — please try again.");
    } finally {
      setQuoting(false);
    }
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
                      <Label htmlFor="first-name">First Name *</Label>
                      <Input id="first-name" name="firstName" required data-testid="input-lead-first-name" />
                    </div>
                    <div>
                      <Label htmlFor="last-name">Last Name *</Label>
                      <Input id="last-name" name="lastName" required data-testid="input-lead-last-name" />
                    </div>
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input id="phone" name="phone" data-testid="input-lead-phone" />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" name="email" type="email" data-testid="input-lead-email" />
                  </div>
                  <div>
                    <Label htmlFor="product-of-interest">Product of Interest</Label>
                    <Input id="product-of-interest" name="productInterest" placeholder="e.g. Life Cover, Funeral Plan…" />
                  </div>
                  <div>
                    <Label htmlFor="create-source">Source</Label>
                    <Select name="source" value={createSource} onValueChange={setCreateSource}>
                      <SelectTrigger id="create-source"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="walk_in">Walk-in</SelectItem>
                        <SelectItem value="agent_link">Agent Referral</SelectItem>
                        <SelectItem value="vcard_quote">Agent vCard Quote</SelectItem>
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

                {/* Quote — no client record required, uses the same recommendation engine as the
                    staff wizard and public vCard (server/quote-engine.ts). */}
                <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium flex items-center gap-1.5"><Receipt className="h-3.5 w-3.5" /> Quote</p>
                    {!activeQuote && !showQuoteForm && (
                      <Button type="button" size="sm" variant="outline" onClick={() => setShowQuoteForm(true)} disabled={existingQuoteLoading}>
                        {existingQuoteLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Get a quote"}
                      </Button>
                    )}
                  </div>

                  {showQuoteForm && !activeQuote && (
                    <div className="space-y-2">
                      <div>
                        <Label className="text-xs">Date of birth</Label>
                        <Input type="date" value={quoteDob} onChange={(e) => setQuoteDob(e.target.value)} data-testid="input-lead-quote-dob" />
                      </div>
                      {quoteDeps.map((dep, i) => (
                        <div key={i} className="rounded-md border p-2 space-y-1.5 relative bg-background">
                          <Button type="button" variant="ghost" size="icon" className="h-5 w-5 absolute top-1.5 right-1.5" onClick={() => removeQuoteDep(i)}>
                            <X className="h-3 w-3" />
                          </Button>
                          <div className="grid grid-cols-2 gap-1.5 pr-6">
                            <Input className="h-8 text-xs" placeholder="First name" value={dep.firstName} onChange={(e) => updateQuoteDep(i, "firstName", e.target.value)} />
                            <Input className="h-8 text-xs" placeholder="Last name" value={dep.lastName} onChange={(e) => updateQuoteDep(i, "lastName", e.target.value)} />
                          </div>
                          <div className="grid grid-cols-2 gap-1.5">
                            <Input className="h-8 text-xs" type="date" value={dep.dateOfBirth} onChange={(e) => updateQuoteDep(i, "dateOfBirth", e.target.value)} />
                            {!dep.dateOfBirth && (
                              <Input className="h-8 text-xs" type="number" min="0" max="120" placeholder="Est. age if DOB unknown" value={dep.estimatedAge} onChange={(e) => updateQuoteDep(i, "estimatedAge", e.target.value)} />
                            )}
                          </div>
                        </div>
                      ))}
                      <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={addQuoteDep}>
                        <Plus className="h-3 w-3" /> Add a dependant
                      </Button>
                      <Button type="button" size="sm" className="w-full" disabled={!quoteDob || quoting} onClick={getLeadQuote} data-testid="button-get-lead-quote">
                        {quoting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                        Get Quote
                      </Button>
                      {quoteApiError && <p className="text-xs text-destructive">{quoteApiError}</p>}
                    </div>
                  )}

                  {activeQuote?.recommended && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <Badge>Recommended</Badge>
                        <p className="text-sm font-medium">{activeQuote.recommended.productName}</p>
                      </div>
                      <p className="text-lg font-bold tabular-nums">
                        {activeQuote.recommended.currency} {parseFloat(activeQuote.recommended.premium).toFixed(2)}
                        <span className="text-xs font-normal text-muted-foreground"> / {activeQuote.recommended.paymentSchedule}</span>
                      </p>
                      <div className="flex gap-2">
                        {activeQuote.quoteId && (
                          <Button
                            type="button" size="sm" variant="outline" className="gap-1.5"
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/quote/${activeQuote.quoteId}`);
                              setQuoteLinkCopied(true);
                              setTimeout(() => setQuoteLinkCopied(false), 2000);
                            }}
                          >
                            {quoteLinkCopied ? <Check className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}
                            {quoteLinkCopied ? "Copied" : "Copy link"}
                          </Button>
                        )}
                        <Button
                          type="button" size="sm" variant="default" className="gap-1.5"
                          onClick={() => { setViewingLead(null); setLocation(`/staff/policies?create=1&leadId=${viewingLead.id}`); }}
                        >
                          Convert to policy <ArrowRight className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      {activeQuote.quoteId && (
                        <div className="flex gap-1.5 items-center pt-1">
                          <Input
                            type="email" placeholder="client@email.com" className="h-8 text-xs"
                            value={emailQuoteAddress} onChange={(e) => setEmailQuoteAddress(e.target.value)}
                            data-testid="input-email-quote-address"
                          />
                          <Button
                            type="button" size="sm" variant="outline" className="gap-1.5 shrink-0"
                            disabled={!emailQuoteAddress.trim() || emailQuoteMutation.isPending}
                            onClick={() => emailQuoteMutation.mutate({ quoteId: activeQuote.quoteId, email: emailQuoteAddress.trim() })}
                            data-testid="button-email-quote"
                          >
                            {emailQuoteMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            Email quote
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
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
