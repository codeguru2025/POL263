import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect, type SearchableOption } from "@/components/searchable-select";
import { CurrencySelect } from "@/components/currency-select";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Loader2, ChevronRight, Archive, FileDown, Box, DollarSign, ChevronDown } from "lucide-react";
import type { FleetVehicle } from "@shared/schema";

type IntakeForm = {
  serviceScope: string;
  deceasedName: string;
  deceasedGender: string;
  deceasedAge: string;
  deceasedNationalId: string;
  dateOfDeath: string;
  causeOfDeath: string;
  placeOfDeath: string;
  clientOrganizationName: string;
  informantName: string;
  informantPhone: string;
  informantRelationship: string;
  removalLocation: string;
  removalDateTime: string;
  removalVehicleId: string;
  removalDriverId: string;
  receivedByUserId: string;
  receivedAt: string;
  receiverAcknowledgedName: string;
  receiverAcknowledgedIdNumber: string;
  funeralCaseId: string;
  notes: string;
  partnerParlourId: string;
  storageCategory: string;
  storageFeeStatus: string;
  storageFeePaidBy: string;
};

const BLANK_INTAKE: IntakeForm = {
  serviceScope: "full_service",
  deceasedName: "",
  deceasedGender: "",
  deceasedAge: "",
  deceasedNationalId: "",
  dateOfDeath: "",
  causeOfDeath: "",
  placeOfDeath: "",
  clientOrganizationName: "",
  informantName: "",
  informantPhone: "",
  informantRelationship: "",
  removalLocation: "",
  removalDateTime: "",
  removalVehicleId: "",
  removalDriverId: "",
  receivedByUserId: "",
  receivedAt: new Date().toISOString().slice(0, 16),
  receiverAcknowledgedName: "",
  receiverAcknowledgedIdNumber: "",
  funeralCaseId: "",
  notes: "",
  partnerParlourId: "",
  storageCategory: "adult",
  storageFeeStatus: "unpaid",
  storageFeePaidBy: "",
};

function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return String(v); }
}

function scopeLabel(s: string) {
  if (s === "full_service") return "Full Service";
  if (s === "storage_only") return "Storage Only";
  if (s === "removal_only") return "Removal Only";
  return s;
}

function statusColor(s: string) {
  if (s === "dispatched") return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
  return "bg-blue-500/15 text-blue-700 border-blue-200";
}

function feeStatusBadge(status: string | null | undefined) {
  if (!status || status === "unpaid") return <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Unpaid</Badge>;
  if (status === "paid_at_admission") return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Paid — Admission</Badge>;
  if (status === "paid_at_collection") return <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Paid — Collection</Badge>;
  return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
}

export default function StaffMortuary() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedIntakeId, setSelectedIntakeId] = useState<string | null>(null);
  const [showCreateIntake, setShowCreateIntake] = useState(false);
  const [showDispatch, setShowDispatch] = useState(false);
  const [showAddBelonging, setShowAddBelonging] = useState(false);
  const [showBodyWash, setShowBodyWash] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);
  const [showChapelWashBayPayment, setShowChapelWashBayPayment] = useState(false);
  const [showSendForPostMortem, setShowSendForPostMortem] = useState(false);

  const { data: intakes = [], isLoading: intakesLoading } = useQuery<any[]>({
    queryKey: ["/api/mortuary-intakes"],
  });
  const { data: fleetVehicles = [] } = useQuery<FleetVehicle[]>({
    queryKey: ["/api/fleet"],
  });
  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });
  const { data: partnerParlours = [] } = useQuery<any[]>({
    queryKey: ["/api/partner-parlours"],
  });
  const { data: funeralCases = [] } = useQuery<any[]>({
    queryKey: ["/api/funeral-cases"],
  });

  const selectedIntake = intakes.find((i) => i.id === selectedIntakeId) ?? null;

  const { data: dispatch } = useQuery<any>({
    queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/dispatch`],
    enabled: !!selectedIntakeId,
  });
  const { data: belongings = [] } = useQuery<any[]>({
    queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/belongings`],
    enabled: !!selectedIntakeId,
  });
  const { data: bodyWash } = useQuery<any>({
    queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/body-wash`],
    enabled: !!selectedIntakeId,
  });
  const { data: postMortemMovements = [] } = useQuery<any[]>({
    queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/post-mortem`],
    enabled: !!selectedIntakeId,
  });

  const createIntakeMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/mortuary-intakes", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-intakes"] });
      setShowCreateIntake(false);
      toast({ title: "Intake recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const upsertDispatchMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/dispatch`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-intakes"] });
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/dispatch`] });
      setShowDispatch(false);
      toast({ title: "Dispatch recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addBelongingMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/belongings`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/belongings`] });
      setShowAddBelonging(false);
      toast({ title: "Belonging added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteBelongingMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/belongings/${id}`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/belongings`] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const sendForPostMortemMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/post-mortem`, data);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Failed");
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-intakes"] });
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/post-mortem`] });
      setShowSendForPostMortem(false);
      toast({ title: "Recorded as sent for post-mortem" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const recordPostMortemReturnMutation = useMutation({
    mutationFn: async (movementId: string) => {
      const res = await apiRequest("POST", `/api/post-mortem-movements/${movementId}/return`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-intakes"] });
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/post-mortem`] });
      toast({ title: "Body recorded as returned to mortuary" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const upsertBodyWashMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/body-wash`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/body-wash`] });
      setShowBodyWash(false);
      toast({ title: "Body wash requirements updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const recordPaymentMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/storage-payment`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-intakes"] });
      setShowRecordPayment(false);
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const recordChapelWashBayPaymentMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/mortuary-intakes/${selectedIntakeId}/chapel-wash-bay-payment`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/mortuary-intakes/${selectedIntakeId}/dispatch`] });
      setShowChapelWashBayPayment(false);
      toast({ title: "Chapel & wash bay fee recorded as paid" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredIntakes = intakes.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch = !search
      || i.intakeNumber?.toLowerCase().includes(q)
      || i.deceasedName?.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || i.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const inStorage = intakes.filter((i) => i.status === "in_storage").length;
  const dispatched = intakes.filter((i) => i.status === "dispatched").length;
  const unpaidFees = intakes.filter((i) => i.partnerParlourId && i.storageFeeStatus === "unpaid").length;

  const vehicleOptions: SearchableOption[] = fleetVehicles.map((v) => ({
    value: v.id,
    label: `${v.registration}${v.make ? ` — ${v.make} ${v.model || ""}`.trim() : ""}`,
  }));
  const userOptions: SearchableOption[] = (users as any[])
    .filter((u) => u.isActive !== false)
    .map((u) => ({ value: u.id, label: u.displayName || u.email, hint: u.phone || undefined }));
  const funeralCaseOptions: SearchableOption[] = (funeralCases as any[])
    .map((c) => ({ value: c.id, label: `${c.caseNumber} — ${c.deceasedName}`, hint: c.status || undefined }));

  const vehicleLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const v = fleetVehicles.find((x) => x.id === id);
    return v ? `${v.registration}${v.make ? ` (${v.make} ${v.model || ""})` : ""}` : "—";
  };
  const userLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const u = (users as any[]).find((x) => x.id === id);
    return u ? `${u.displayName || u.email}${u.phone ? ` · ${u.phone}` : ""}` : "—";
  };
  const parlourLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const p = (partnerParlours as any[]).find((x) => x.id === id);
    return p ? p.name : "—";
  };

  const apiBase = getApiBase();

  const DetailRow = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="flex justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium text-right max-w-[55%]">{value || "—"}</span>
    </div>
  );

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Mortuary Register"
          description="Track every body received into and dispatched from the mortuary."
          actions={(
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5 shadow-sm">
                    <FileDown className="h-4 w-4" /> Blank Forms <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`${apiBase}/api/forms/blank/mortuary-intake`} target="_blank" rel="noopener noreferrer">Intake Form</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${apiBase}/api/forms/blank/mortuary-dispatch`} target="_blank" rel="noopener noreferrer">Dispatch Note</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${apiBase}/api/forms/blank/deceased-belongings`} target="_blank" rel="noopener noreferrer">Deceased Belongings</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${apiBase}/api/forms/blank/body-wash`} target="_blank" rel="noopener noreferrer">Body Wash Form</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${apiBase}/api/forms/blank/storage-receipt`} target="_blank" rel="noopener noreferrer">Storage Receipt</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="gap-2 shadow-sm" onClick={() => setShowCreateIntake(true)}>
                <Plus className="h-4 w-4" /> Record Intake
              </Button>
            </div>
          )}
        />

        <div className="grid md:grid-cols-4 gap-4 mb-8">
          <KpiStatCard label="In Storage" value={inStorage} hint="Bodies currently in mortuary" icon={Archive} />
          <KpiStatCard label="Dispatched" value={dispatched} hint="Bodies collected / released" icon={Box} />
          <KpiStatCard label="Total Intakes" value={intakes.length} hint="All time" icon={Box} />
          <KpiStatCard label="Unpaid Fees" value={unpaidFees} hint="Partner parlour fees outstanding" icon={DollarSign} />
        </div>

        {selectedIntakeId && selectedIntake ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 flex-wrap">
              <Button variant="ghost" size="sm" onClick={() => setSelectedIntakeId(null)}>← Back</Button>
              <h2 className="text-xl font-bold">{selectedIntake.intakeNumber}</h2>
              <Badge variant="outline" className={`font-medium text-[10px] ${statusColor(selectedIntake.status)}`}>
                {selectedIntake.status?.replace(/_/g, " ").toUpperCase()}
              </Badge>
              <Badge variant="outline" className="text-[10px]">{scopeLabel(selectedIntake.serviceScope)}</Badge>
              {selectedIntake.partnerParlourId && feeStatusBadge(selectedIntake.storageFeeStatus)}
              <div className="ml-auto flex gap-2 flex-wrap">
                <a href={`${apiBase}/api/mortuary-intakes/${selectedIntake.id}/receipt-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Print Receipt</Button>
                </a>
                <a href={`${apiBase}/api/mortuary-intakes/${selectedIntake.id}/belongings-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Belongings</Button>
                </a>
                <a href={`${apiBase}/api/mortuary-intakes/${selectedIntake.id}/body-wash-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Body Wash Form</Button>
                </a>
                {selectedIntake.partnerParlourId && (
                  <a href={`${apiBase}/api/mortuary-intakes/${selectedIntake.id}/storage-receipt-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Storage Receipt</Button>
                  </a>
                )}
                {selectedIntake.status === "dispatched" && (
                  <a href={`${apiBase}/api/mortuary-intakes/${selectedIntake.id}/dispatch-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                    <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Print Dispatch Note</Button>
                  </a>
                )}
                {selectedIntake.status !== "dispatched" && (
                  <Button size="sm" className="gap-1.5" onClick={() => setShowDispatch(true)}>Record Dispatch</Button>
                )}
              </div>
            </div>

            <div className="grid md:grid-cols-2 gap-4">
              <CardSection title="Deceased Details" icon={Box}>
                <div className="space-y-0.5">
                  <DetailRow label="Full name" value={selectedIntake.deceasedName} />
                  <DetailRow label="Gender" value={selectedIntake.deceasedGender} />
                  <DetailRow label="Age" value={selectedIntake.deceasedAge != null ? String(selectedIntake.deceasedAge) : undefined} />
                  <DetailRow label="National ID" value={selectedIntake.deceasedNationalId} />
                  <DetailRow label="Date of death" value={selectedIntake.dateOfDeath} />
                  <DetailRow label="Cause of death" value={selectedIntake.causeOfDeath} />
                  <DetailRow label="Place of death" value={selectedIntake.placeOfDeath} />
                </div>
              </CardSection>

              <CardSection title="Referring Party / Next of Kin" icon={Box}>
                <div className="space-y-0.5">
                  {selectedIntake.clientOrganizationName && <DetailRow label="Organisation" value={selectedIntake.clientOrganizationName} />}
                  <DetailRow label="Informant name" value={selectedIntake.informantName} />
                  <DetailRow label="Phone" value={selectedIntake.informantPhone} />
                  <DetailRow label="Relationship" value={selectedIntake.informantRelationship} />
                </div>
              </CardSection>

              <CardSection title="Removal Details" icon={Box}>
                <div className="space-y-0.5">
                  <DetailRow label="Removal location" value={selectedIntake.removalLocation} />
                  <DetailRow label="Date & time" value={fmtDateTime(selectedIntake.removalDateTime)} />
                  <DetailRow label="Driver" value={userLabel(selectedIntake.removalDriverId)} />
                  <DetailRow label="Vehicle" value={vehicleLabel(selectedIntake.removalVehicleId)} />
                </div>
              </CardSection>

              <CardSection title="Mortuary Receipt" icon={Box}>
                <div className="space-y-0.5">
                  <DetailRow label="Received by" value={userLabel(selectedIntake.receivedByUserId)} />
                  <DetailRow label="Received at" value={fmtDateTime(selectedIntake.receivedAt)} />
                  <DetailRow label="Acknowledged name" value={selectedIntake.receiverAcknowledgedName} />
                  <DetailRow label="Acknowledged ID" value={selectedIntake.receiverAcknowledgedIdNumber} />
                </div>
              </CardSection>

              {/* Storage fee card — only for partner parlour intakes */}
              {selectedIntake.partnerParlourId && (
                <CardSection
                  title="Storage Fee"
                  icon={DollarSign}
                  headerRight={
                    selectedIntake.storageFeeStatus === "unpaid" ? (
                      <Button size="sm" className="gap-1.5" onClick={() => setShowRecordPayment(true)}>
                        <DollarSign className="h-3.5 w-3.5" /> Record Payment
                      </Button>
                    ) : null
                  }
                >
                  <div className="space-y-0.5">
                    <DetailRow label="Partner parlour" value={parlourLabel(selectedIntake.partnerParlourId)} />
                    <DetailRow label="Category" value={selectedIntake.storageCategory === "child" ? "Child" : "Adult"} />
                    <DetailRow label="Fee" value={`USD ${parseFloat(selectedIntake.storageFeeAmount || "0").toFixed(2)}`} />
                    <div className="flex justify-between py-1 border-b border-border/40">
                      <span className="text-muted-foreground text-xs">Payment status</span>
                      <span>{feeStatusBadge(selectedIntake.storageFeeStatus)}</span>
                    </div>
                    {selectedIntake.storageFeeStatus !== "unpaid" && (
                      <>
                        <DetailRow label="Paid by" value={selectedIntake.storageFeePaidBy} />
                        <DetailRow label="Paid at" value={fmtDateTime(selectedIntake.storageFeePaidAt)} />
                      </>
                    )}
                  </div>
                  {selectedIntake.storageFeeStatus === "unpaid" && (
                    <div className="mt-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                      This body cannot be released until the storage fee is paid.
                    </div>
                  )}
                </CardSection>
              )}

              {/* Belongings */}
              <CardSection title="Belongings Submitted" icon={Box}
                headerRight={(
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowAddBelonging(true)}>
                    <Plus className="h-3 w-3" /> Add Item
                  </Button>
                )}
              >
                {belongings.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No belongings recorded.</p>
                ) : (
                  <div className="space-y-1">
                    {belongings.map((b: any) => (
                      <div key={b.id} className="flex items-center justify-between text-sm border-b border-border/40 py-1.5">
                        <span className="font-medium">{b.itemDescription}</span>
                        <span className="text-xs text-muted-foreground">Qty: {b.quantity}</span>
                        {b.submittedByName && <span className="text-xs text-muted-foreground">{b.submittedByName}</span>}
                        <Button variant="ghost" size="sm" className="h-6 px-2 text-destructive" onClick={() => deleteBelongingMutation.mutate(b.id)}>×</Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardSection>

              {/* Body Wash */}
              <CardSection title="Body Wash Requirements" icon={Box}
                headerRight={(
                  <Button size="sm" variant="outline" onClick={() => setShowBodyWash(true)}>
                    {bodyWash ? "Edit" : "Set Requirements"}
                  </Button>
                )}
              >
                {!bodyWash ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No body wash requirements set.</p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="flex gap-4 flex-wrap">
                      <span className={`text-sm ${bodyWash.clothesProvided ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                        {bodyWash.clothesProvided ? "✓" : "✗"} Clothes
                      </span>
                      <span className={`text-sm ${bodyWash.blanketProvided ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                        {bodyWash.blanketProvided ? "✓" : "✗"} Blanket
                      </span>
                      <span className={`text-sm ${bodyWash.wreathProvided ? "text-emerald-600 font-medium" : "text-muted-foreground"}`}>
                        {bodyWash.wreathProvided ? "✓" : "✗"} Wreath
                      </span>
                    </div>
                    {bodyWash.otherItems && <p className="text-xs text-muted-foreground">Other: {bodyWash.otherItems}</p>}
                    {bodyWash.washedByName && <p className="text-xs">Washed by: <span className="font-medium">{bodyWash.washedByName}</span></p>}
                    {bodyWash.completedAt && <p className="text-xs text-muted-foreground">Completed: {fmtDateTime(bodyWash.completedAt)}</p>}
                  </div>
                )}
              </CardSection>

              {/* Post-mortem out-and-back */}
              <CardSection title="Post-Mortem" icon={Box}
                headerRight={selectedIntake.status !== "dispatched" && selectedIntake.status !== "out_for_post_mortem" && (
                  <Button size="sm" variant="outline" onClick={() => setShowSendForPostMortem(true)}>Send for Post-Mortem</Button>
                )}
              >
                {postMortemMovements.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-3">No post-mortem movements recorded.</p>
                ) : (
                  <div className="space-y-3">
                    {postMortemMovements.map((m: any) => (
                      <div key={m.id} className="space-y-0.5 border-b border-border last:border-0 pb-2 last:pb-0">
                        <DetailRow label="Taken out at" value={fmtDateTime(m.takenOutAt)} />
                        {m.takenToLocation && <DetailRow label="Taken to" value={m.takenToLocation} />}
                        {m.authorizedBy && <DetailRow label="Authorized by" value={m.authorizedBy} />}
                        {m.collectedByName && <DetailRow label="Collected by" value={m.collectedByName} />}
                        {m.returnedAt ? (
                          <DetailRow label="Returned at" value={fmtDateTime(m.returnedAt)} />
                        ) : (
                          <div className="flex items-center justify-between py-1">
                            <span className="text-xs text-amber-700">Still out for post-mortem</span>
                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => recordPostMortemReturnMutation.mutate(m.id)}
                              disabled={recordPostMortemReturnMutation.isPending}>
                              Record return
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardSection>

              {/* Dispatch info */}
              {dispatch && (
                <CardSection title="Dispatch Record" icon={Box}>
                  <div className="space-y-0.5">
                    <DetailRow label="Dispatched by" value={userLabel(dispatch.dispatchedByUserId)} />
                    <DetailRow label="Dispatched at" value={fmtDateTime(dispatch.dispatchedAt)} />
                    <DetailRow label="Collected by" value={dispatch.collectedByName} />
                    <DetailRow label="Collector ID" value={dispatch.collectedByIdNumber} />
                    {dispatch.collectedByOrganization && <DetailRow label="Collector org" value={dispatch.collectedByOrganization} />}
                    <DetailRow label="Destination" value={dispatch.destination} />
                    {dispatch.collectorAcknowledgedName && <DetailRow label="Collector acknowledged" value={dispatch.collectorAcknowledgedName} />}
                    {dispatch.chapelWashBayUsed && (
                      <div className="flex items-center justify-between py-1">
                        <span className="text-xs text-muted-foreground">Chapel & wash bay fee</span>
                        <span className="flex items-center gap-2 text-sm">
                          USD {parseFloat(dispatch.chapelWashBayFeeAmount || "0").toFixed(2)}
                          {dispatch.chapelWashBayFeeStatus === "paid"
                            ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Paid</Badge>
                            : <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Unpaid</Badge>}
                          {dispatch.chapelWashBayFeeStatus === "unpaid" && (
                            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => setShowChapelWashBayPayment(true)}>Record payment</Button>
                          )}
                        </span>
                      </div>
                    )}
                  </div>
                </CardSection>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
          <CardSection title="Mortuary Register" icon={Archive} flush
            headerRight={(
              <div className="flex items-center gap-2">
                <div className="relative w-56">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search intakes…" className="pl-9 bg-background" value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36"><SelectValue placeholder="All statuses" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="in_storage">In Storage</SelectItem>
                    <SelectItem value="dispatched">Dispatched</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          >
            {intakesLoading ? (
              <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : filteredIntakes.length === 0 ? (
              <EmptyState title="No mortuary intakes found" description="No records match the current filter." className="border-0 rounded-none bg-transparent py-10" />
            ) : (
              <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Intake No</TableHead>
                    <TableHead>Deceased</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Received At</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIntakes.map((i) => (
                    <TableRow key={i.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedIntakeId(i.id)}>
                      <TableCell className="font-medium pl-6">{i.intakeNumber}</TableCell>
                      <TableCell>{i.deceasedName}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{scopeLabel(i.serviceScope)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{fmtDateTime(i.receivedAt)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`font-medium text-[10px] ${statusColor(i.status)}`}>
                          {i.status?.replace(/_/g, " ").toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {i.partnerParlourId ? feeStatusBadge(i.storageFeeStatus) : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="View mortuary case details">
                          <ChevronRight className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardSection>

          <PartnerParlourVehicleUsageSection
            vehicleOptions={vehicleOptions}
            userOptions={userOptions}
            partnerParlours={partnerParlours}
          />
          </div>
        )}
      </PageShell>

      {/* New Intake Dialog */}
      <NewIntakeDialog
        open={showCreateIntake}
        onOpenChange={setShowCreateIntake}
        vehicleOptions={vehicleOptions}
        userOptions={userOptions}
        partnerParlours={partnerParlours}
        funeralCases={funeralCases}
        funeralCaseOptions={funeralCaseOptions}
        onSubmit={(data) => createIntakeMutation.mutate(data)}
        isPending={createIntakeMutation.isPending}
        onParlourCreated={() => queryClient.invalidateQueries({ queryKey: ["/api/partner-parlours"] })}
      />

      {/* Dispatch Dialog */}
      {selectedIntakeId && (
        <DispatchDialog
          open={showDispatch}
          onOpenChange={setShowDispatch}
          intake={selectedIntake}
          onSubmit={(data) => upsertDispatchMutation.mutate(data)}
          isPending={upsertDispatchMutation.isPending}
        />
      )}

      {/* Send for Post-Mortem Dialog */}
      {selectedIntakeId && (
        <SendForPostMortemDialog
          open={showSendForPostMortem}
          onOpenChange={setShowSendForPostMortem}
          onSubmit={(data) => sendForPostMortemMutation.mutate(data)}
          isPending={sendForPostMortemMutation.isPending}
        />
      )}

      {/* Chapel & Wash Bay Payment Dialog */}
      {selectedIntakeId && dispatch && (
        <RecordPaymentDialog
          open={showChapelWashBayPayment}
          onOpenChange={setShowChapelWashBayPayment}
          feeAmount={dispatch.chapelWashBayFeeAmount}
          onSubmit={(data) => recordChapelWashBayPaymentMutation.mutate(data)}
          isPending={recordChapelWashBayPaymentMutation.isPending}
          title="Record Chapel & Wash Bay Payment"
          statusOptions={[{ value: "paid", label: "Paid" }]}
        />
      )}

      {/* Add Belonging Dialog */}
      {selectedIntakeId && (
        <AddBelongingDialog
          open={showAddBelonging}
          onOpenChange={setShowAddBelonging}
          onSubmit={(data) => addBelongingMutation.mutate(data)}
          isPending={addBelongingMutation.isPending}
        />
      )}

      {/* Body Wash Dialog */}
      {selectedIntakeId && (
        <BodyWashDialog
          open={showBodyWash}
          onOpenChange={setShowBodyWash}
          existing={bodyWash}
          onSubmit={(data) => upsertBodyWashMutation.mutate(data)}
          isPending={upsertBodyWashMutation.isPending}
        />
      )}

      {/* Record Payment Dialog */}
      {selectedIntakeId && selectedIntake?.partnerParlourId && (
        <RecordPaymentDialog
          open={showRecordPayment}
          onOpenChange={setShowRecordPayment}
          feeAmount={selectedIntake.storageFeeAmount}
          onSubmit={(data) => recordPaymentMutation.mutate(data)}
          isPending={recordPaymentMutation.isPending}
        />
      )}
    </StaffLayout>
  );
}

// ─── Partner Parlour Vehicle Usage ─────────────────────────────────────────────

function PartnerParlourVehicleUsageSection({ vehicleOptions, userOptions, partnerParlours }: {
  vehicleOptions: SearchableOption[];
  userOptions: SearchableOption[];
  partnerParlours: any[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showLogUsage, setShowLogUsage] = useState(false);
  const [feePaymentTarget, setFeePaymentTarget] = useState<any | null>(null);

  const { data: usageRecords = [], isLoading } = useQuery<any[]>({
    queryKey: ["/api/partner-parlour-vehicle-usage"],
  });

  const logUsageMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/partner-parlour-vehicle-usage", data);
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Failed");
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner-parlour-vehicle-usage"] });
      setShowLogUsage(false);
      toast({ title: "Vehicle usage logged" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const returnMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/partner-parlour-vehicle-usage/${id}/return`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner-parlour-vehicle-usage"] });
      toast({ title: "Vehicle recorded as returned" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const feePaymentMutation = useMutation({
    mutationFn: async ({ id, paidBy }: { id: string; paidBy: string }) => {
      const res = await apiRequest("POST", `/api/partner-parlour-vehicle-usage/${id}/fee-payment`, { paidBy });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || "Failed");
      return j;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner-parlour-vehicle-usage"] });
      setFeePaymentTarget(null);
      toast({ title: "Fee recorded as paid" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const parlourName = (id: string | null) => (partnerParlours as any[]).find((p) => p.id === id)?.name || "—";
  const vehicleLabel = (id: string | null) => vehicleOptions.find((v) => v.value === id)?.label || "—";
  const driverLabel = (id: string | null) => id ? (userOptions.find((u) => u.value === id)?.label || "—") : "—";

  return (
    <>
      <CardSection
        title="Partner Parlour Vehicle Usage"
        description="Vehicles/drivers lent to other parlours for their own removals or burials."
        icon={Box}
        headerRight={<Button size="sm" onClick={() => setShowLogUsage(true)}><Plus className="h-4 w-4 mr-1.5" />Log Usage</Button>}
      >
        {isLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : usageRecords.length === 0 ? (
          <EmptyState title="No vehicle usage recorded" description="Logged when we lend a vehicle/driver to a partner parlour." className="border-0 rounded-none bg-transparent py-8" />
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="pl-6">Parlour</TableHead>
                <TableHead>Vehicle</TableHead>
                <TableHead>Driver</TableHead>
                <TableHead>Purpose</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead className="text-right pr-6">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usageRecords.map((u: any) => (
                <TableRow key={u.id}>
                  <TableCell className="pl-6 font-medium">{parlourName(u.partnerParlourId)}</TableCell>
                  <TableCell>{vehicleLabel(u.vehicleId)}</TableCell>
                  <TableCell>{driverLabel(u.driverId)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground capitalize">{u.purpose}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{fmtDateTime(u.usageDateTime)}</TableCell>
                  <TableCell className="text-xs">
                    {u.feeAmount ? `${u.feeCurrency} ${parseFloat(u.feeAmount).toFixed(2)}` : "—"}
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <div className="flex justify-end gap-1.5 flex-wrap">
                      {!u.returnedAt && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => returnMutation.mutate(u.id)} disabled={returnMutation.isPending}>
                          Record Return
                        </Button>
                      )}
                      {u.feeAmount && u.feeStatus !== "paid" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setFeePaymentTarget(u)}>
                          Mark Fee Paid
                        </Button>
                      )}
                      {u.returnedAt && (!u.feeAmount || u.feeStatus === "paid") && (
                        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Closed</Badge>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
      </CardSection>

      <LogVehicleUsageDialog
        open={showLogUsage}
        onOpenChange={setShowLogUsage}
        vehicleOptions={vehicleOptions}
        userOptions={userOptions}
        partnerParlours={partnerParlours}
        onSubmit={(data) => logUsageMutation.mutate(data)}
        isPending={logUsageMutation.isPending}
      />

      {feePaymentTarget && (
        <FeePaymentDialog
          open={!!feePaymentTarget}
          onOpenChange={(v) => !v && setFeePaymentTarget(null)}
          feeAmount={feePaymentTarget.feeAmount}
          feeCurrency={feePaymentTarget.feeCurrency}
          onSubmit={(paidBy) => feePaymentMutation.mutate({ id: feePaymentTarget.id, paidBy })}
          isPending={feePaymentMutation.isPending}
        />
      )}
    </>
  );
}

function LogVehicleUsageDialog({ open, onOpenChange, vehicleOptions, userOptions, partnerParlours, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  vehicleOptions: SearchableOption[]; userOptions: SearchableOption[]; partnerParlours: any[];
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    partnerParlourId: "",
    vehicleId: "",
    driverId: "",
    purpose: "removal",
    deceasedName: "",
    usageDateTime: new Date().toISOString().slice(0, 16),
    destination: "",
    feeAmount: "",
    feeCurrency: "USD",
    notes: "",
  });

  const setSel = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v === "__none__" ? "" : v }));
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      partnerParlourId: form.partnerParlourId || null,
      vehicleId: form.vehicleId || null,
      driverId: form.driverId || null,
      purpose: form.purpose,
      deceasedName: form.deceasedName || null,
      usageDateTime: form.usageDateTime || null,
      destination: form.destination || null,
      feeAmount: form.feeAmount || null,
      feeCurrency: form.feeAmount ? form.feeCurrency : null,
      notes: form.notes || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Partner Parlour Vehicle Usage</DialogTitle>
          <DialogDescription>Record a vehicle/driver lent to another parlour for their own removal or burial.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Partner Parlour *</Label>
            <Select value={form.partnerParlourId || "__none__"} onValueChange={setSel("partnerParlourId")}>
              <SelectTrigger><SelectValue placeholder="Select parlour…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">— Select parlour —</SelectItem>
                {partnerParlours.map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Vehicle *</Label>
              <SearchableSelect options={vehicleOptions} value={form.vehicleId} onChange={setSel("vehicleId")} placeholder="Select vehicle…" searchPlaceholder="Search…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Driver</Label>
              <SearchableSelect options={userOptions} value={form.driverId} onChange={setSel("driverId")} placeholder="Select driver…" searchPlaceholder="Search…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Purpose *</Label>
              <Select value={form.purpose} onValueChange={setSel("purpose")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="removal">Removal</SelectItem>
                  <SelectItem value="burial">Burial</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Date & Time</Label>
              <Input type="datetime-local" value={form.usageDateTime} onChange={set("usageDateTime")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Deceased Name</Label>
            <Input value={form.deceasedName} onChange={set("deceasedName")} placeholder="Whose removal/burial this is for" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Destination</Label>
            <Input value={form.destination} onChange={set("destination")} placeholder="Where the vehicle is going" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Fee Amount</Label>
              <Input type="number" step="0.01" min="0" value={form.feeAmount} onChange={set("feeAmount")} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fee Currency</Label>
              <CurrencySelect value={form.feeCurrency} onValueChange={setSel("feeCurrency")} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={set("notes")} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.partnerParlourId || !form.vehicleId}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Log Usage
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FeePaymentDialog({ open, onOpenChange, feeAmount, feeCurrency, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  feeAmount: string | number | null; feeCurrency: string | null;
  onSubmit: (paidBy: string) => void; isPending: boolean;
}) {
  const [paidBy, setPaidBy] = useState("");
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(paidBy);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Mark Vehicle Usage Fee Paid</DialogTitle>
          <DialogDescription>
            {feeAmount ? `${feeCurrency} ${parseFloat(String(feeAmount)).toFixed(2)}` : "Fee"} for this vehicle usage.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Paid By *</Label>
            <Input value={paidBy} onChange={(e) => setPaidBy(e.target.value)} required placeholder="Name of person who paid" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !paidBy}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Confirm Paid
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── New Intake Dialog ────────────────────────────────────────────────────────

function NewIntakeDialog({ open, onOpenChange, vehicleOptions, userOptions, partnerParlours, funeralCases, funeralCaseOptions, onSubmit, isPending, onParlourCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  vehicleOptions: SearchableOption[];
  userOptions: SearchableOption[];
  partnerParlours: any[];
  funeralCases: any[];
  funeralCaseOptions: SearchableOption[];
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
  onParlourCreated: () => void;
}) {
  const [form, setForm] = useState<IntakeForm>({ ...BLANK_INTAKE });
  const [showCreateParlour, setShowCreateParlour] = useState(false);
  const [autoFilledFromCase, setAutoFilledFromCase] = useState(false);

  const set = (k: keyof IntakeForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSel = (k: keyof IntakeForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v === "__none__" ? "" : v }));

  // Blanks-only auto-populate from a linked funeral case — never overwrites something the
  // user already typed (same rule the backend enforces again on submit as the source of truth).
  const handleFuneralCaseSelect = (caseId: string) => {
    const id = caseId === "__none__" ? "" : caseId;
    const linkedCase = id ? funeralCases.find((c) => c.id === id) : null;
    if (!linkedCase) {
      setForm((f) => ({ ...f, funeralCaseId: id }));
      setAutoFilledFromCase(false);
      return;
    }
    setForm((f) => ({
      ...f,
      funeralCaseId: id,
      deceasedName: f.deceasedName || linkedCase.deceasedName || "",
      deceasedGender: f.deceasedGender || linkedCase.deceasedGender || "",
      deceasedNationalId: f.deceasedNationalId || linkedCase.deceasedNationalId || "",
      dateOfDeath: f.dateOfDeath || linkedCase.dateOfDeath || "",
      causeOfDeath: f.causeOfDeath || linkedCase.causeOfDeath || "",
      placeOfDeath: f.placeOfDeath || linkedCase.placeOfDeath || "",
      informantName: f.informantName || linkedCase.informantName || "",
      informantPhone: f.informantPhone || linkedCase.informantPhone || "",
      informantRelationship: f.informantRelationship || linkedCase.informantRelationship || "",
      removalLocation: f.removalLocation || linkedCase.removalLocation || "",
      removalVehicleId: f.removalVehicleId || linkedCase.removalVehicleId || "",
      removalDriverId: f.removalDriverId || linkedCase.removalDriverId || "",
    }));
    setAutoFilledFromCase(true);
  };

  const isPartnerScope = form.serviceScope === "storage_only" || form.serviceScope === "removal_only";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Record<string, any> = {};
    (Object.keys(form) as (keyof IntakeForm)[]).forEach((k) => {
      const v = form[k];
      data[k] = v || null;
    });
    if (form.deceasedAge) data.deceasedAge = parseInt(form.deceasedAge);
    // Only send partner parlour fields when applicable
    if (!isPartnerScope) {
      data.partnerParlourId = null;
      data.storageCategory = null;
      data.storageFeeStatus = null;
      data.storageFeePaidBy = null;
    }
    // Only send paidBy when paid at admission
    if (data.storageFeeStatus !== "paid_at_admission") {
      data.storageFeePaidBy = null;
    }
    onSubmit(data);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record Mortuary Intake</DialogTitle>
            <DialogDescription>Document the body being received into the mortuary.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Service Scope *</Label>
              <Select value={form.serviceScope} onValueChange={setSel("serviceScope")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_service">Full Service (we handle burial)</SelectItem>
                  <SelectItem value="storage_only">Storage Only (another parlour does burial)</SelectItem>
                  <SelectItem value="removal_only">Removal Only (we collected, they bury)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Deceased Full Name *</Label>
              <Input value={form.deceasedName} onChange={set("deceasedName")} required placeholder="Full name" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Gender</Label>
                <Select value={form.deceasedGender || "__none__"} onValueChange={setSel("deceasedGender")}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not set —</SelectItem>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Age</Label>
                <Input type="number" min="0" value={form.deceasedAge} onChange={set("deceasedAge")} placeholder="e.g. 65" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">National ID</Label>
                <Input value={form.deceasedNationalId} onChange={set("deceasedNationalId")} placeholder="ID / Passport" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date of Death</Label>
                <Input type="date" value={form.dateOfDeath} onChange={set("dateOfDeath")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Cause of Death</Label>
                <Input value={form.causeOfDeath} onChange={set("causeOfDeath")} placeholder="e.g. Natural causes" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Place of Death</Label>
                <Input value={form.placeOfDeath} onChange={set("placeOfDeath")} placeholder="Hospital, home, etc." />
              </div>
            </div>

            {/* Partner parlour section — only for storage_only / removal_only */}
            {isPartnerScope && (
              <div className="space-y-3 rounded-md border border-border/60 bg-muted/20 p-3">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Partner Parlour & Storage Fee</p>

                <div className="space-y-1.5">
                  <Label className="text-xs">Partner Parlour *</Label>
                  <Select value={form.partnerParlourId || "__none__"} onValueChange={setSel("partnerParlourId")}>
                    <SelectTrigger><SelectValue placeholder="Select partner parlour…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Select parlour —</SelectItem>
                      {partnerParlours.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] text-muted-foreground">
                    Not listed?{" "}
                    <button type="button" className="underline text-primary" onClick={() => setShowCreateParlour(true)}>
                      Add new parlour
                    </button>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Deceased Category *</Label>
                    <Select value={form.storageCategory} onValueChange={setSel("storageCategory")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="adult">Adult — USD 20.00</SelectItem>
                        <SelectItem value="child">Child — USD 10.00</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Payment at Admission?</Label>
                    <Select value={form.storageFeeStatus} onValueChange={setSel("storageFeeStatus")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unpaid">Pay on Collection</SelectItem>
                        <SelectItem value="paid_at_admission">Paid Now (Admission)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.storageFeeStatus === "paid_at_admission" && (
                    <div className="col-span-2 space-y-1.5">
                      <Label className="text-xs">Received From (Name)</Label>
                      <Input value={form.storageFeePaidBy} onChange={set("storageFeePaidBy")} placeholder="Name of person who paid" />
                    </div>
                  )}
                </div>

                <div className="rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800">
                  Storage fee: <strong>USD {form.storageCategory === "child" ? "10.00" : "20.00"}</strong>{" "}
                  — {form.storageFeeStatus === "paid_at_admission" ? "Paid at admission" : "To be collected on dispatch"}
                </div>
              </div>
            )}

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Next of Kin / Informant</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Informant Name</Label>
                <Input value={form.informantName} onChange={set("informantName")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Informant Phone</Label>
                <Input value={form.informantPhone} onChange={set("informantPhone")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Relationship</Label>
                <Input value={form.informantRelationship} onChange={set("informantRelationship")} placeholder="e.g. Spouse, Son" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Removal Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 space-y-1.5">
                <Label className="text-xs">Removal Location</Label>
                <Input value={form.removalLocation} onChange={set("removalLocation")} placeholder="Where body was collected from" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Date & Time of Removal</Label>
                <Input type="datetime-local" value={form.removalDateTime} onChange={set("removalDateTime")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Removal Driver</Label>
                <SearchableSelect options={userOptions} value={form.removalDriverId} onChange={setSel("removalDriverId")} placeholder="Select driver…" searchPlaceholder="Search…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Removal Vehicle</Label>
                <SearchableSelect options={vehicleOptions} value={form.removalVehicleId} onChange={setSel("removalVehicleId")} placeholder="Select vehicle…" searchPlaceholder="Search…" />
              </div>
            </div>

            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-1">Mortuary Receipt</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Received By (Staff)</Label>
                <SearchableSelect options={userOptions} value={form.receivedByUserId} onChange={setSel("receivedByUserId")} placeholder="Select staff member…" searchPlaceholder="Search…" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Received At</Label>
                <Input type="datetime-local" value={form.receivedAt} onChange={set("receivedAt")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Receiver Acknowledged Name (printed)</Label>
                <Input value={form.receiverAcknowledgedName} onChange={set("receiverAcknowledgedName")} placeholder="Printed name at sign-off" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Receiver ID Number</Label>
                <Input value={form.receiverAcknowledgedIdNumber} onChange={set("receiverAcknowledgedIdNumber")} placeholder="ID / Passport number" />
              </div>
            </div>

            {form.serviceScope === "full_service" && (
              <div className="space-y-1.5">
                <Label className="text-xs">Funeral Case (optional — link to existing case)</Label>
                <SearchableSelect
                  options={funeralCaseOptions}
                  value={form.funeralCaseId}
                  onChange={handleFuneralCaseSelect}
                  placeholder="Search by case number or deceased name…"
                  searchPlaceholder="Search…"
                />
                {autoFilledFromCase && (
                  <p className="text-xs text-emerald-600">Deceased, informant &amp; removal details filled from this case where blank.</p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={set("notes")} rows={2} placeholder="Any additional information…" />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending || !form.deceasedName || (isPartnerScope && !form.partnerParlourId)}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Record Intake
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <CreateParlourDialog
        open={showCreateParlour}
        onOpenChange={setShowCreateParlour}
        onCreated={(parlour) => {
          onParlourCreated();
          setForm((f) => ({ ...f, partnerParlourId: parlour.id }));
          setShowCreateParlour(false);
        }}
      />
    </>
  );
}

// ─── Create Parlour Dialog ────────────────────────────────────────────────────

function CreateParlourDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (parlour: any) => void;
}) {
  const { toast } = useToast();
  const [form, setForm] = useState({ name: "", phone: "", contactPerson: "", address: "" });
  const [isPending, setIsPending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsPending(true);
    try {
      const res = await apiRequest("POST", "/api/partner-parlours", {
        name: form.name,
        phone: form.phone || null,
        contactPerson: form.contactPerson || null,
        address: form.address || null,
      });
      const parlour = await res.json();
      onCreated(parlour);
      setForm({ name: "", phone: "", contactPerson: "", address: "" });
      toast({ title: "Partner parlour added" });
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setIsPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add Partner Parlour</DialogTitle>
          <DialogDescription>Register a new funeral parlour that stores bodies with you.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Parlour Name *</Label>
            <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="e.g. ABC Funerals" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Phone</Label>
              <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+263…" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Contact Person</Label>
              <Input value={form.contactPerson} onChange={(e) => setForm((f) => ({ ...f, contactPerson: e.target.value }))} placeholder="Full name" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Address</Label>
            <Textarea value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} rows={2} placeholder="Physical address" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.name}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add Parlour
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Record Payment Dialog ────────────────────────────────────────────────────

function RecordPaymentDialog({ open, onOpenChange, feeAmount, onSubmit, isPending, title = "Record Storage Payment", statusOptions }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  feeAmount?: string | null;
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
  title?: string;
  statusOptions?: { value: string; label: string }[];
}) {
  const options = statusOptions ?? [
    { value: "paid_at_collection", label: "Paid on Collection" },
    { value: "paid_at_admission", label: "Paid at Admission (backdating)" },
  ];
  const [form, setForm] = useState({
    paidBy: "",
    paidAt: new Date().toISOString().slice(0, 16),
    status: options[0].value,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ paidBy: form.paidBy, paidAt: form.paidAt || null, status: form.status });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Fee due: <strong>USD {parseFloat(feeAmount || "0").toFixed(2)}</strong>
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          {options.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">Payment Type *</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">Received From (Name) *</Label>
            <Input value={form.paidBy} onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))} required placeholder="Name of person who paid" />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Date & Time</Label>
            <Input type="datetime-local" value={form.paidAt} onChange={(e) => setForm((f) => ({ ...f, paidAt: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.paidBy}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Record Payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Dispatch Dialog ──────────────────────────────────────────────────────────

function DispatchDialog({ open, onOpenChange, intake, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  intake?: any;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    dispatchedAt: new Date().toISOString().slice(0, 16),
    collectedByName: "",
    collectedByIdNumber: "",
    collectedByOrganization: "",
    destination: "",
    collectorAcknowledgedName: "",
    notes: "",
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      dispatchedAt: form.dispatchedAt || null,
      collectedByName: form.collectedByName || null,
      collectedByIdNumber: form.collectedByIdNumber || null,
      collectedByOrganization: form.collectedByOrganization || null,
      destination: form.destination || null,
      collectorAcknowledgedName: form.collectorAcknowledgedName || null,
      notes: form.notes || null,
    });
  };

  const feeUnpaid = intake?.partnerParlourId && intake?.storageFeeStatus === "unpaid";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Record Dispatch</DialogTitle>
          <DialogDescription>Document who collected the body and when.</DialogDescription>
        </DialogHeader>
        {feeUnpaid ? (
          <div className="rounded-md bg-red-50 border border-red-200 px-4 py-4 text-sm text-red-800">
            <p className="font-semibold">Storage fee unpaid</p>
            <p className="mt-1">
              The storage fee of <strong>USD {parseFloat(intake.storageFeeAmount || "0").toFixed(2)}</strong> must be paid before this body can be released.
              Go back and record payment first.
            </p>
            <DialogFooter className="mt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Date & Time of Dispatch</Label>
              <Input type="datetime-local" value={form.dispatchedAt} onChange={(e) => setForm((f) => ({ ...f, dispatchedAt: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Collected By (Name) *</Label>
                <Input value={form.collectedByName} onChange={(e) => setForm((f) => ({ ...f, collectedByName: e.target.value }))} required placeholder="Person collecting" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Collector ID Number</Label>
                <Input value={form.collectedByIdNumber} onChange={(e) => setForm((f) => ({ ...f, collectedByIdNumber: e.target.value }))} placeholder="ID / Passport" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Collector Organisation</Label>
                <Input value={form.collectedByOrganization} onChange={(e) => setForm((f) => ({ ...f, collectedByOrganization: e.target.value }))} placeholder="Other parlour / hospital" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Destination</Label>
                <Input value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} placeholder="Cemetery, other parlour, etc." />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Collector Acknowledged Name (printed)</Label>
              <Input value={form.collectorAcknowledgedName} onChange={(e) => setForm((f) => ({ ...f, collectorAcknowledgedName: e.target.value }))} placeholder="Printed name at sign-off" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
            </div>
            {intake?.partnerParlourId && (
              <p className="text-xs text-muted-foreground rounded-md border border-border bg-muted/40 px-3 py-2.5">
                Chapel, body wash, and any other services used are billed separately from the case's
                Service Charges section, not from this dispatch form.
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={isPending || !form.collectedByName}>
                {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Record Dispatch
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Send for Post-Mortem Dialog ──────────────────────────────────────────────

function SendForPostMortemDialog({ open, onOpenChange, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    takenOutAt: new Date().toISOString().slice(0, 16),
    takenToLocation: "",
    authorizedBy: "",
    collectedByName: "",
    notes: "",
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      takenOutAt: form.takenOutAt || null,
      takenToLocation: form.takenToLocation || null,
      authorizedBy: form.authorizedBy || null,
      collectedByName: form.collectedByName || null,
      notes: form.notes || null,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Send for Post-Mortem</DialogTitle>
          <DialogDescription>Record the body leaving the mortuary for post-mortem examination.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Date & Time Taken Out</Label>
            <Input type="datetime-local" value={form.takenOutAt} onChange={(e) => setForm((f) => ({ ...f, takenOutAt: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Taken To (location)</Label>
            <Input value={form.takenToLocation} onChange={(e) => setForm((f) => ({ ...f, takenToLocation: e.target.value }))} placeholder="e.g. State Pathologist, hospital name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Authorized By</Label>
              <Input value={form.authorizedBy} onChange={(e) => setForm((f) => ({ ...f, authorizedBy: e.target.value }))} placeholder="Doctor / police officer" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Collected By (Name)</Label>
              <Input value={form.collectedByName} onChange={(e) => setForm((f) => ({ ...f, collectedByName: e.target.value }))} placeholder="Person/ambulance collecting" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Send for Post-Mortem
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Belonging Dialog ─────────────────────────────────────────────────────

function AddBelongingDialog({ open, onOpenChange, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({ itemDescription: "", quantity: "1", submittedByName: "", notes: "" });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ itemDescription: form.itemDescription, quantity: parseInt(form.quantity) || 1, submittedByName: form.submittedByName || null, notes: form.notes || null });
    setForm({ itemDescription: "", quantity: "1", submittedByName: "", notes: "" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add Belonging</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Item Description *</Label>
            <Input value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} required placeholder="e.g. Watch, Wallet, Clothing" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity</Label>
              <Input type="number" min="1" value={form.quantity} onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Submitted By</Label>
              <Input value={form.submittedByName} onChange={(e) => setForm((f) => ({ ...f, submittedByName: e.target.value }))} placeholder="Name of person" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={2} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.itemDescription}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Body Wash Dialog ─────────────────────────────────────────────────────────

function BodyWashDialog({ open, onOpenChange, existing, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  existing?: any;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    clothesProvided: false,
    blanketProvided: false,
    wreathProvided: false,
    otherItems: "",
    washedByName: "",
    completedAt: "",
  });

  useEffect(() => {
    if (open && existing) {
      setForm({
        clothesProvided: existing.clothesProvided ?? false,
        blanketProvided: existing.blanketProvided ?? false,
        wreathProvided: existing.wreathProvided ?? false,
        otherItems: existing.otherItems ?? "",
        washedByName: existing.washedByName ?? "",
        completedAt: existing.completedAt ? new Date(existing.completedAt).toISOString().slice(0, 16) : "",
      });
    }
  }, [open, existing]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      clothesProvided: form.clothesProvided,
      blanketProvided: form.blanketProvided,
      wreathProvided: form.wreathProvided,
      otherItems: form.otherItems || null,
      washedByName: form.washedByName || null,
      completedAt: form.completedAt || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Body Wash Requirements</DialogTitle>
          <DialogDescription>Track items provided and who performed the wash.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="space-y-2">
            {([
              ["clothesProvided", "Clothes Provided"],
              ["blanketProvided", "Blanket Provided"],
              ["wreathProvided", "Wreath Provided"],
            ] as [keyof typeof form, string][]).map(([key, label]) => (
              <div key={key} className="flex items-center gap-3">
                <Checkbox
                  id={key}
                  checked={!!form[key]}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, [key]: !!v }))}
                />
                <label htmlFor={key} className="text-sm cursor-pointer">{label}</label>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Other Items</Label>
            <Textarea value={form.otherItems} onChange={(e) => setForm((f) => ({ ...f, otherItems: e.target.value }))} rows={2} placeholder="Any other items provided…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Washed By (Name)</Label>
              <Input value={form.washedByName} onChange={(e) => setForm((f) => ({ ...f, washedByName: e.target.value }))} placeholder="Person who performed wash" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Completed At</Label>
              <Input type="datetime-local" value={form.completedAt} onChange={(e) => setForm((f) => ({ ...f, completedAt: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
