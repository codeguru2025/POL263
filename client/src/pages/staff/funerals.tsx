import { useState, useCallback, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { shareDocument } from "@/lib/share-document";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Car, Box, Loader2, ChevronRight, Truck, CheckCircle2, FileDown, Share2, Pencil, User } from "lucide-react";
import type { FuneralCase, FuneralTask, FleetVehicle } from "@shared/schema";

type CaseForm = {
  deceasedName: string;
  dateOfDeath: string;
  causeOfDeath: string;
  placeOfDeath: string;
  informantName: string;
  informantPhone: string;
  informantRelationship: string;
  serviceType: string;
  funeralDate: string;
  funeralLocation: string;
  removalLocation: string;
  removalVehicleId: string;
  removalDriverId: string;
  burialVehicleId: string;
  burialDriverId: string;
  attendingAgentId: string;
  notes: string;
  policyId: string;
  claimId: string;
};

const BLANK_FORM: CaseForm = {
  deceasedName: "", dateOfDeath: "", causeOfDeath: "", placeOfDeath: "",
  informantName: "", informantPhone: "", informantRelationship: "",
  serviceType: "", funeralDate: "", funeralLocation: "",
  removalLocation: "", removalVehicleId: "", removalDriverId: "",
  burialVehicleId: "", burialDriverId: "", attendingAgentId: "",
  notes: "", policyId: "", claimId: "",
};

export default function StaffFunerals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showEditCase, setShowEditCase] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCreateVehicle, setShowCreateVehicle] = useState(false);

  const { data: funeralCases = [], isLoading: casesLoading } = useQuery<FuneralCase[]>({
    queryKey: ["/api/funeral-cases"],
  });

  const { data: fleetVehicles = [], isLoading: fleetLoading } = useQuery<FleetVehicle[]>({
    queryKey: ["/api/fleet"],
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  const selectedCase = funeralCases.find((c) => c.id === selectedCaseId) ?? null;

  const { data: caseTasks = [], isLoading: tasksLoading } = useQuery<FuneralTask[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`],
    enabled: !!selectedCaseId,
  });

  const createCaseMutation = useMutation({
    mutationFn: async (data: Partial<CaseForm>) => {
      const res = await apiRequest("POST", "/api/funeral-cases", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/funeral-cases"] });
      setShowCreateCase(false);
      toast({ title: "Funeral case created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateCaseMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<CaseForm> }) => {
      const res = await apiRequest("PATCH", `/api/funeral-cases/${id}`, data);
      return res.json();
    },
    onSuccess: (updated: FuneralCase) => {
      queryClient.invalidateQueries({ queryKey: ["/api/funeral-cases"] });
      setShowEditCase(false);
      // Update selectedCase in cache
      queryClient.setQueryData(["/api/funeral-cases"], (old: FuneralCase[] = []) =>
        old.map((c) => (c.id === updated.id ? updated : c))
      );
      toast({ title: "Case updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createTaskMutation = useMutation({
    mutationFn: async ({ caseId, data }: { caseId: string; data: Record<string, string> }) => {
      const res = await apiRequest("POST", `/api/funeral-cases/${caseId}/tasks`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`] });
      setShowAddTask(false);
      toast({ title: "Task added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | null> }) => {
      const res = await apiRequest("PATCH", `/api/funeral-tasks/${id}`, data);
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`] }),
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createVehicleMutation = useMutation({
    mutationFn: async (data: Record<string, string | number | null>) => {
      const res = await apiRequest("POST", "/api/fleet", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet"] });
      setShowCreateVehicle(false);
      toast({ title: "Vehicle added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleExport = useCallback(async (fc: FuneralCase, download = false) => {
    const url = `${getApiBase()}/api/funeral-cases/${fc.id}/document${download ? "?download=1" : ""}`;
    const shared = await shareDocument(url, `Funeral-${fc.caseNumber}`, `Funeral service notification for ${fc.deceasedName}`);
    if (!shared && !download) window.open(url, "_blank", "noopener");
  }, []);

  const statusColor = (s: string) => {
    if (s === "completed") return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    if (s === "in_progress") return "bg-blue-500/15 text-blue-700 border-blue-200";
    if (s === "open") return "bg-amber-500/15 text-amber-700 border-amber-200";
    if (s === "cancelled") return "bg-destructive/15 text-destructive border-destructive/30";
    return "bg-muted text-muted-foreground";
  };

  const filteredCases = funeralCases.filter((c) => {
    const q = search.toLowerCase();
    const matchesSearch = !search || c.caseNumber.toLowerCase().includes(q) || c.deceasedName.toLowerCase().includes(q);
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCases = funeralCases.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const dispatchedVehicles = fleetVehicles.filter((v) => v.status === "dispatched").length;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Funeral Operations"
          description="Manage funeral cases, logistics, fleet dispatch, and resource allocation."
          titleDataTestId="text-page-title"
          actions={(
            <Button className="gap-2 shadow-sm" data-testid="button-new-case" onClick={() => setShowCreateCase(true)}>
              <Plus className="h-4 w-4" /> New Case
            </Button>
          )}
        />

        <div className="grid md:grid-cols-3 gap-4 mb-8">
          <KpiStatCard className="bg-primary/5 border-primary/20" label="Active cases" value={<span data-testid="text-active-cases">{activeCases}</span>} hint="Open or in progress" icon={Box} />
          <KpiStatCard label="Fleet utilization" value={<span data-testid="text-fleet-utilization">{dispatchedVehicles}/{fleetVehicles.length}</span>} hint="Vehicles dispatched" icon={Car} />
          <KpiStatCard label="Total cases" value={<span data-testid="text-total-cases">{funeralCases.length}</span>} hint="All time" icon={CheckCircle2} />
        </div>

        <Tabs defaultValue="cases">
          <TabsList>
            <TabsTrigger value="cases" data-testid="tab-cases">Funeral Cases</TabsTrigger>
            <TabsTrigger value="fleet" data-testid="tab-fleet">Fleet Vehicles</TabsTrigger>
          </TabsList>

          {/* ─── Cases tab ─────────────────────────────────────── */}
          <TabsContent value="cases" className="mt-4">
            {selectedCaseId && selectedCase ? (
              <CaseDetailView
                funeralCase={selectedCase}
                tasks={caseTasks}
                tasksLoading={tasksLoading}
                vehicles={fleetVehicles}
                users={users}
                onBack={() => setSelectedCaseId(null)}
                onEdit={() => setShowEditCase(true)}
                onAddTask={() => setShowAddTask(true)}
                onToggleTask={(task) => {
                  const newStatus = task.status === "completed" ? "pending" : "completed";
                  updateTaskMutation.mutate({ id: task.id, data: { status: newStatus, completedAt: newStatus === "completed" ? new Date().toISOString() : null } });
                }}
                onUpdateStatus={(status) => {
                  const patch: Record<string, string | null> = { status };
                  if (status === "completed") patch.completedAt = new Date().toISOString();
                  updateCaseMutation.mutate({ id: selectedCase.id, data: patch as any });
                }}
                onExport={(download) => handleExport(selectedCase, download)}
              />
            ) : (
              <CardSection title="Logistics Board" icon={Box} flush
                headerRight={(
                  <div className="flex items-center gap-2">
                    <div className="relative w-56">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Search cases…" className="pl-9 bg-background" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-cases" />
                    </div>
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-36" data-testid="select-status-filter"><SelectValue placeholder="All statuses" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In Progress</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              >
                {casesLoading ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredCases.length === 0 ? (
                  <EmptyState title="No funeral cases found" description="No cases match the current filter." className="border-0 rounded-none bg-transparent py-10" data-testid="text-no-cases" />
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Case #</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Date of Death</TableHead>
                        <TableHead>Funeral Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right pr-6">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredCases.map((fc) => (
                        <TableRow key={fc.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => setSelectedCaseId(fc.id)} data-testid={`row-funeral-case-${fc.id}`}>
                          <TableCell className="font-medium pl-6">{fc.caseNumber}</TableCell>
                          <TableCell>{fc.deceasedName}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{fc.dateOfDeath || "—"}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{fc.funeralDate || "—"}</TableCell>
                          <TableCell>
                            {fc.serviceType && (
                              <Badge variant="outline" className="text-[10px]">
                                {fc.serviceType === "claim" ? "Claim" : "Cash"}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-medium text-[10px] ${statusColor(fc.status)}`}>
                              {fc.status.replace("_", " ").toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right pr-6">
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-view-case-${fc.id}`}>
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardSection>
            )}
          </TabsContent>

          {/* ─── Fleet tab ─────────────────────────────────────── */}
          <TabsContent value="fleet" className="mt-4">
            <CardSection title="Fleet Vehicles" icon={Truck} flush
              headerRight={(
                <Button variant="outline" className="gap-2" onClick={() => setShowCreateVehicle(true)} data-testid="button-add-vehicle">
                  <Plus className="h-4 w-4" /> Add Vehicle
                </Button>
              )}
            >
              {fleetLoading ? (
                <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
              ) : fleetVehicles.length === 0 ? (
                <EmptyState title="No fleet vehicles registered" description="Add vehicles to manage your fleet." className="border-0 rounded-none bg-transparent py-10" data-testid="text-no-vehicles" />
              ) : (
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Registration</TableHead>
                      <TableHead>Make / Model</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Mileage</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fleetVehicles.map((v) => (
                      <TableRow key={v.id} className="hover:bg-muted/30 transition-colors" data-testid={`row-vehicle-${v.id}`}>
                        <TableCell className="font-medium pl-6">
                          <div className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary/70" />{v.registration}</div>
                        </TableCell>
                        <TableCell>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{v.year || "—"}</TableCell>
                        <TableCell className="text-sm">{v.vehicleType || "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{v.currentMileage != null ? `${v.currentMileage.toLocaleString()} km` : "—"}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={`font-medium text-[10px] ${v.status === "available" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : v.status === "dispatched" ? "bg-blue-500/15 text-blue-700 border-blue-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}`}>
                            {v.status.toUpperCase()}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      <CaseFormDialog
        open={showCreateCase}
        onOpenChange={setShowCreateCase}
        title="New Funeral Case"
        vehicles={fleetVehicles}
        users={users}
        onSubmit={(data) => createCaseMutation.mutate(data)}
        isPending={createCaseMutation.isPending}
      />

      {selectedCase && (
        <CaseFormDialog
          open={showEditCase}
          onOpenChange={setShowEditCase}
          title="Edit Case"
          vehicles={fleetVehicles}
          users={users}
          initial={selectedCase}
          onSubmit={(data) => updateCaseMutation.mutate({ id: selectedCase.id, data })}
          isPending={updateCaseMutation.isPending}
        />
      )}

      <AddTaskDialog
        open={showAddTask}
        onOpenChange={setShowAddTask}
        onSubmit={(data) => { if (selectedCaseId) createTaskMutation.mutate({ caseId: selectedCaseId, data }); }}
        isPending={createTaskMutation.isPending}
      />

      <CreateVehicleDialog
        open={showCreateVehicle}
        onOpenChange={setShowCreateVehicle}
        onSubmit={(data) => createVehicleMutation.mutate(data)}
        isPending={createVehicleMutation.isPending}
      />
    </StaffLayout>
  );
}

// ─── Case Detail View ──────────────────────────────────────────────────────

function CaseDetailView({
  funeralCase: fc, tasks, tasksLoading, vehicles, users,
  onBack, onEdit, onAddTask, onToggleTask, onUpdateStatus, onExport,
}: {
  funeralCase: FuneralCase;
  tasks: FuneralTask[];
  tasksLoading: boolean;
  vehicles: FleetVehicle[];
  users: any[];
  onBack: () => void;
  onEdit: () => void;
  onAddTask: () => void;
  onToggleTask: (t: FuneralTask) => void;
  onUpdateStatus: (s: string) => void;
  onExport: (download: boolean) => void;
}) {
  const completed = tasks.filter((t) => t.status === "completed").length;

  const vehicleLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const v = vehicles.find((x) => x.id === id);
    return v ? `${v.registration}${v.make ? ` (${v.make} ${v.model || ""})`.trim() : ""}` : id.slice(0, 8) + "…";
  };
  const userLabel = (id: string | null | undefined) => {
    if (!id) return "—";
    const u = users.find((x: any) => x.id === id);
    return u ? `${u.displayName || u.email}${u.phone ? ` · ${u.phone}` : ""}` : id.slice(0, 8) + "…";
  };
  const userGender = (id: string | null | undefined) => {
    const u = users.find((x: any) => x.id === id);
    return u?.gender || "—";
  };

  const statusColor = (s: string) => {
    if (s === "completed") return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
    if (s === "in_progress") return "bg-blue-500/15 text-blue-700 border-blue-200";
    if (s === "open") return "bg-amber-500/15 text-amber-700 border-amber-200";
    return "bg-muted text-muted-foreground";
  };

  const DetailRow = ({ label, value }: { label: string; value?: string | null }) => (
    <div className="flex justify-between py-1 border-b border-border/40 last:border-0">
      <span className="text-muted-foreground text-xs">{label}</span>
      <span className="text-sm font-medium text-right max-w-[55%]">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-list">← Back</Button>
        <h2 className="text-xl font-bold" data-testid="text-case-number">{fc.caseNumber}</h2>
        <Badge variant="outline" className={`font-medium text-[10px] ${statusColor(fc.status)}`}>
          {fc.status.replace("_", " ").toUpperCase()}
        </Badge>
        {fc.serviceType && (
          <Badge variant="outline" className="text-[10px]">{fc.serviceType === "claim" ? "Policy Claim" : "Cash Service"}</Badge>
        )}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onExport(false)}><Share2 className="h-3.5 w-3.5" /> Share</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onExport(true)}><FileDown className="h-3.5 w-3.5" /> Download PDF</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Deceased */}
        <CardSection title="Deceased" icon={Box}>
          <div className="space-y-0.5">
            <DetailRow label="Full name" value={fc.deceasedName} />
            <DetailRow label="Date of death" value={fc.dateOfDeath} />
            <DetailRow label="Cause of death" value={fc.causeOfDeath} />
            <DetailRow label="Place of death" value={fc.placeOfDeath} />
          </div>
        </CardSection>

        {/* Informant */}
        <CardSection title="Informant (Next of Kin)" icon={User}>
          <div className="space-y-0.5">
            <DetailRow label="Name" value={fc.informantName} />
            <DetailRow label="Phone" value={fc.informantPhone} />
            <DetailRow label="Relationship" value={fc.informantRelationship} />
          </div>
        </CardSection>

        {/* Service */}
        <CardSection title="Service Details" icon={CheckCircle2}>
          <div className="space-y-0.5">
            <DetailRow label="Service type" value={fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : undefined} />
            <DetailRow label="Date of burial" value={fc.funeralDate} />
            <DetailRow label="Place of burial" value={fc.funeralLocation} />
          </div>
        </CardSection>

        {/* Status mgmt */}
        <CardSection title="Status" icon={CheckCircle2}>
          <div className="flex gap-2 flex-wrap">
            {["open", "in_progress", "completed", "cancelled"].map((s) => (
              <Button key={s} size="sm" variant={fc.status === s ? "default" : "outline"} onClick={() => onUpdateStatus(s)} disabled={fc.status === s} data-testid={`button-status-${s}`}>
                {s.replace("_", " ").toUpperCase()}
              </Button>
            ))}
          </div>
        </CardSection>

        {/* Body removal */}
        <CardSection title="Body Removal" icon={Truck}>
          <div className="space-y-0.5">
            <DetailRow label="Removal location" value={fc.removalLocation} />
            <DetailRow label="Vehicle" value={vehicleLabel(fc.removalVehicleId)} />
            <DetailRow label="Driver" value={userLabel(fc.removalDriverId)} />
          </div>
        </CardSection>

        {/* Burial logistics */}
        <CardSection title="Burial Logistics" icon={Truck}>
          <div className="space-y-0.5">
            <DetailRow label="Vehicle" value={vehicleLabel(fc.burialVehicleId)} />
            <DetailRow label="Driver" value={userLabel(fc.burialDriverId)} />
          </div>
        </CardSection>

        {/* Attending agent */}
        <CardSection title="Attending Agent" icon={User}>
          <div className="space-y-0.5">
            <DetailRow label="Name" value={userLabel(fc.attendingAgentId)} />
            <DetailRow label="Gender" value={userGender(fc.attendingAgentId)} />
          </div>
        </CardSection>

        {/* Notes */}
        {fc.notes && (
          <CardSection title="Notes" icon={Box}>
            <p className="text-sm">{fc.notes}</p>
          </CardSection>
        )}
      </div>

      {/* Task checklist */}
      <CardSection title="Task Checklist" description={`${completed}/${tasks.length} completed`} icon={CheckCircle2}
        headerRight={(
          <Button size="sm" variant="outline" className="gap-2" onClick={onAddTask} data-testid="button-add-task">
            <Plus className="h-3 w-3" /> Add Task
          </Button>
        )}
      >
        {tasksLoading ? (
          <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-tasks">No tasks yet.</p>
        ) : (
          <div className="space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors" data-testid={`row-task-${task.id}`}>
                <Checkbox checked={task.status === "completed"} onCheckedChange={() => onToggleTask(task)} data-testid={`checkbox-task-${task.id}`} />
                <div className="flex-1">
                  <p className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}>{task.taskName}</p>
                  {task.description && <p className="text-xs text-muted-foreground">{task.description}</p>}
                </div>
                <Badge variant="outline" className={`text-[10px] ${task.status === "completed" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}`}>
                  {task.status.toUpperCase()}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </CardSection>
    </div>
  );
}

// ─── Case Form Dialog (create + edit) ────────────────────────────────────────

function CaseFormDialog({
  open, onOpenChange, title, vehicles, users, initial, onSubmit, isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  vehicles: FleetVehicle[];
  users: any[];
  initial?: FuneralCase | null;
  onSubmit: (data: Partial<CaseForm>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState<CaseForm>(() => {
    if (initial) {
      return {
        deceasedName: initial.deceasedName ?? "",
        dateOfDeath: initial.dateOfDeath ?? "",
        causeOfDeath: initial.causeOfDeath ?? "",
        placeOfDeath: initial.placeOfDeath ?? "",
        informantName: initial.informantName ?? "",
        informantPhone: initial.informantPhone ?? "",
        informantRelationship: initial.informantRelationship ?? "",
        serviceType: initial.serviceType ?? "",
        funeralDate: initial.funeralDate ?? "",
        funeralLocation: initial.funeralLocation ?? "",
        removalLocation: initial.removalLocation ?? "",
        removalVehicleId: initial.removalVehicleId ?? "",
        removalDriverId: initial.removalDriverId ?? "",
        burialVehicleId: initial.burialVehicleId ?? "",
        burialDriverId: initial.burialDriverId ?? "",
        attendingAgentId: initial.attendingAgentId ?? "",
        notes: initial.notes ?? "",
        policyId: initial.policyId ?? "",
        claimId: initial.claimId ?? "",
      };
    }
    return { ...BLANK_FORM };
  });

  const set = (k: keyof CaseForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSel = (k: keyof CaseForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v === "__none__" ? "" : v }));

  // Policy claim lookup state
  const [policySearch, setPolicySearch] = useState(initial?.policyId ? "linked" : "");
  const [policyLookupLoading, setPolicyLookupLoading] = useState(false);
  const [foundPolicy, setFoundPolicy] = useState<any>(null);
  const [policyMembers, setPolicyMembers] = useState<any[]>([]);
  const [policyLookupError, setPolicyLookupError] = useState("");
  const policySearchRef = useRef<HTMLInputElement>(null);

  const lookupPolicy = async (search: string) => {
    if (!search.trim()) return;
    setPolicyLookupLoading(true);
    setPolicyLookupError("");
    setFoundPolicy(null);
    setPolicyMembers([]);
    try {
      const res = await fetch(`${getApiBase()}/api/policies?q=${encodeURIComponent(search.trim())}&limit=5`, { credentials: "include" });
      const data = await res.json();
      const policies: any[] = Array.isArray(data) ? data : [];
      const exact = policies.find((p: any) =>
        p.policyNumber?.toLowerCase() === search.trim().toLowerCase()
      ) || policies[0];
      if (!exact) {
        setPolicyLookupError("No policy found with that number.");
        return;
      }
      setFoundPolicy(exact);
      setForm((f) => ({ ...f, policyId: exact.id }));
      // Fetch members
      const mRes = await fetch(`${getApiBase()}/api/policies/${exact.id}/members`, { credentials: "include" });
      if (mRes.ok) {
        const mData = await mRes.json();
        setPolicyMembers(Array.isArray(mData) ? mData : []);
      }
    } catch {
      setPolicyLookupError("Failed to look up policy.");
    } finally {
      setPolicyLookupLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<CaseForm> = {};
    (Object.keys(form) as (keyof CaseForm)[]).forEach((k) => {
      const v = form[k];
      (data as any)[k] = v || null;
    });
    onSubmit(data);
  };

  const Field = ({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) => (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}{required && " *"}</Label>
      {children}
    </div>
  );

  const userOptions = users.filter((u: any) => u.isActive !== false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Complete all applicable sections. Starred fields are required.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5 pt-1">

          {/* Deceased */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Deceased Details</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Full Name" required>
                  <Input value={form.deceasedName} onChange={set("deceasedName")} placeholder="Full name of deceased" required data-testid="input-deceased-name" />
                </Field>
              </div>
              <Field label="Date of Death">
                <Input type="date" value={form.dateOfDeath} onChange={set("dateOfDeath")} data-testid="input-date-of-death" />
              </Field>
              <Field label="Cause of Death">
                <Input value={form.causeOfDeath} onChange={set("causeOfDeath")} placeholder="e.g. Natural causes" />
              </Field>
              <div className="col-span-2">
                <Field label="Place of Death">
                  <Input value={form.placeOfDeath} onChange={set("placeOfDeath")} placeholder="Hospital, home address, etc." />
                </Field>
              </div>
            </div>
          </div>

          {/* Informant */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Informant (Next of Kin)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Name">
                <Input value={form.informantName} onChange={set("informantName")} placeholder="Full name" />
              </Field>
              <Field label="Phone">
                <Input value={form.informantPhone} onChange={set("informantPhone")} placeholder="+263 77 …" />
              </Field>
              <div className="col-span-2">
                <Field label="Relationship to Deceased">
                  <Select value={form.informantRelationship || "__none__"} onValueChange={setSel("informantRelationship")}>
                    <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {["Spouse", "Son", "Daughter", "Father", "Mother", "Brother", "Sister", "Grandparent", "Grandchild", "Other"].map((r) => (
                        <SelectItem key={r} value={r}>{r}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>
            </div>
          </div>

          {/* Service */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Service Details</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Service Type">
                <Select value={form.serviceType || "__none__"} onValueChange={(v) => {
                  setSel("serviceType")(v);
                  if (v !== "claim") { setFoundPolicy(null); setPolicyMembers([]); setPolicySearch(""); setPolicyLookupError(""); setForm((f) => ({ ...f, policyId: "" })); }
                }}>
                  <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Not set —</SelectItem>
                    <SelectItem value="cash">Cash Service</SelectItem>
                    <SelectItem value="claim">Policy Claim</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Date of Burial">
                <Input type="date" value={form.funeralDate} onChange={set("funeralDate")} data-testid="input-funeral-date" />
              </Field>
              <div className="col-span-2">
                <Field label="Place of Burial">
                  <Input value={form.funeralLocation} onChange={set("funeralLocation")} placeholder="Cemetery or burial site" data-testid="input-funeral-location" />
                </Field>
              </div>

              {/* Policy Claim lookup — shown only when serviceType = claim */}
              {form.serviceType === "claim" && (
                <div className="col-span-2 border rounded-md p-3 space-y-3 bg-muted/20">
                  <p className="text-xs font-semibold text-primary">Policy Claim — enter the policy number to link the claim and select the deceased member</p>
                  <div className="flex gap-2">
                    <Input
                      ref={policySearchRef}
                      placeholder="Policy number, e.g. FLK00123"
                      value={policySearch === "linked" ? (foundPolicy?.policyNumber || "") : policySearch}
                      onChange={(e) => setPolicySearch(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupPolicy(policySearch); } }}
                      className="flex-1"
                    />
                    <Button type="button" size="sm" onClick={() => lookupPolicy(policySearch)} disabled={policyLookupLoading || !policySearch.trim()}>
                      {policyLookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
                    </Button>
                  </div>
                  {policyLookupError && <p className="text-xs text-destructive">{policyLookupError}</p>}
                  {foundPolicy && (
                    <div className="space-y-2 text-xs border-t pt-2">
                      <p className="text-muted-foreground">
                        Found: <strong className="text-foreground">{foundPolicy.policyNumber}</strong> · {foundPolicy.status?.toUpperCase()} · {foundPolicy.currency} {Number(foundPolicy.premiumAmount || 0).toFixed(2)}/mo
                      </p>
                      {policyMembers.length > 0 && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Select Deceased Member</Label>
                          <Select
                            value={form.deceasedName || "__none__"}
                            onValueChange={(v) => {
                              if (v === "__none__") return;
                              setForm((f) => ({ ...f, deceasedName: v }));
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Select deceased…" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">— Select member —</SelectItem>
                              {policyMembers.map((m: any) => {
                                const name = m.name || `${m.firstName || ""} ${m.lastName || ""}`.trim() || m.clientName || m.dependentName || "Member";
                                const role = m.role || "member";
                                return (
                                  <SelectItem key={m.id || name} value={name}>
                                    {name} ({role.replace("_", " ")})
                                  </SelectItem>
                                );
                              })}
                            </SelectContent>
                          </Select>
                          <p className="text-[10px] text-muted-foreground">Selecting a member auto-fills the deceased name above.</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Body Removal */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Body Removal</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <Field label="Removal Location">
                  <Input value={form.removalLocation} onChange={set("removalLocation")} placeholder="Where the body is being collected from" />
                </Field>
              </div>
              <Field label="Removal Vehicle">
                <Select value={form.removalVehicleId || "__none__"} onValueChange={setSel("removalVehicleId")}>
                  <SelectTrigger><SelectValue placeholder="Select vehicle…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.registration}{v.make ? ` — ${v.make} ${v.model || ""}`.trim() : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Removal Driver">
                <Select value={form.removalDriverId || "__none__"} onValueChange={setSel("removalDriverId")}>
                  <SelectTrigger><SelectValue placeholder="Select driver…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {userOptions.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}{u.phone ? ` · ${u.phone}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          {/* Burial logistics */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Burial Logistics</p>
            <p className="text-xs text-muted-foreground mb-3">Can be the same or different vehicle/driver as removal.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Burial Vehicle">
                <Select value={form.burialVehicleId || "__none__"} onValueChange={setSel("burialVehicleId")}>
                  <SelectTrigger><SelectValue placeholder="Select vehicle…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {vehicles.map((v) => (
                      <SelectItem key={v.id} value={v.id}>{v.registration}{v.make ? ` — ${v.make} ${v.model || ""}`.trim() : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Burial Driver">
                <Select value={form.burialDriverId || "__none__"} onValueChange={setSel("burialDriverId")}>
                  <SelectTrigger><SelectValue placeholder="Select driver…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— None —</SelectItem>
                    {userOptions.map((u: any) => (
                      <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}{u.phone ? ` · ${u.phone}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </div>

          {/* Attending agent */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Attending Agent</p>
            <Field label="Staff member attending the funeral">
              <Select value={form.attendingAgentId || "__none__"} onValueChange={setSel("attendingAgentId")}>
                <SelectTrigger><SelectValue placeholder="Select agent…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— None —</SelectItem>
                  {userOptions.map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.displayName || u.email}
                      {u.gender ? ` · ${u.gender}` : ""}
                      {u.phone ? ` · ${u.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Notes */}
          <Field label="Notes">
            <Textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Any additional information…" data-testid="input-case-notes" />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.deceasedName} data-testid="button-submit-case">
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {initial ? "Save Changes" : "Create Case"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Task Dialog ──────────────────────────────────────────────────────────

function AddTaskDialog({ open, onOpenChange, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, string>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({ taskName: "", description: "" });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ taskName: form.taskName, description: form.description || "" });
    setForm({ taskName: "", description: "" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Task Name *</Label>
            <Input value={form.taskName} onChange={(e) => setForm({ ...form, taskName: e.target.value })} required data-testid="input-task-name" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} data-testid="input-task-description" />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.taskName} data-testid="button-submit-task">
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Create Vehicle Dialog ────────────────────────────────────────────────────

function CreateVehicleDialog({ open, onOpenChange, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, string | number | null>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({ registration: "", make: "", model: "", year: "", vehicleType: "" });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ registration: form.registration, make: form.make || null, model: form.model || null, year: form.year ? parseInt(form.year) : null, vehicleType: form.vehicleType || null });
    setForm({ registration: "", make: "", model: "", year: "", vehicleType: "" });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add Fleet Vehicle</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Registration *</Label>
            <Input value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} required data-testid="input-vehicle-registration" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Make</Label><Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} data-testid="input-vehicle-make" /></div>
            <div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="input-vehicle-model" /></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Year</Label><Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} data-testid="input-vehicle-year" /></div>
            <div className="space-y-2">
              <Label>Vehicle Type</Label>
              <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                <SelectTrigger data-testid="select-vehicle-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hearse">Hearse</SelectItem>
                  <SelectItem value="ambulance">Ambulance</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.registration} data-testid="button-submit-vehicle">
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Add Vehicle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
