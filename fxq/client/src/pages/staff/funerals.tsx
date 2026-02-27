import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Filter, Car, Box, Loader2, ChevronRight, Truck, CheckCircle2 } from "lucide-react";
import type { FuneralCase, FuneralTask, FleetVehicle } from "@shared/schema";

export default function StaffFunerals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCreateVehicle, setShowCreateVehicle] = useState(false);

  const { data: funeralCases = [], isLoading: casesLoading } = useQuery<FuneralCase[]>({
    queryKey: ["/api/funeral-cases"],
  });

  const { data: fleetVehicles = [], isLoading: fleetLoading } = useQuery<FleetVehicle[]>({
    queryKey: ["/api/fleet"],
  });

  const selectedCase = funeralCases.find((c) => c.id === selectedCaseId);

  const { data: caseTasks = [], isLoading: tasksLoading } = useQuery<FuneralTask[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`],
    enabled: !!selectedCaseId,
  });

  const createCaseMutation = useMutation({
    mutationFn: async (data: Record<string, string | null>) => {
      const res = await apiRequest("POST", "/api/funeral-cases", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/funeral-cases"] });
      setShowCreateCase(false);
      toast({ title: "Funeral case created" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateCaseMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | null> }) => {
      const res = await apiRequest("PATCH", `/api/funeral-cases/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/funeral-cases"] });
      toast({ title: "Case updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | null> }) => {
      const res = await apiRequest("PATCH", `/api/funeral-tasks/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
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
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
      case "in_progress": return "bg-blue-500/15 text-blue-700 border-blue-200";
      case "open": return "bg-amber-500/15 text-amber-700 border-amber-200";
      case "cancelled": return "bg-destructive/15 text-destructive border-destructive/30";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const getVehicleStatusColor = (status: string) => {
    switch (status) {
      case "available": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
      case "dispatched": return "bg-blue-500/15 text-blue-700 border-blue-200";
      case "maintenance": return "bg-amber-500/15 text-amber-700 border-amber-200";
      default: return "bg-muted text-muted-foreground";
    }
  };

  const filteredCases = funeralCases.filter((c) => {
    const matchesSearch =
      !search ||
      c.caseNumber.toLowerCase().includes(search.toLowerCase()) ||
      c.deceasedName.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const activeCases = funeralCases.filter((c) => c.status === "open" || c.status === "in_progress").length;
  const dispatchedVehicles = fleetVehicles.filter((v) => v.status === "dispatched").length;

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-page-title">
              Funeral Operations
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage funeral cases, logistics, fleet dispatch, and resource allocation.
            </p>
          </div>
          <Button className="gap-2 shadow-sm" data-testid="button-new-case" onClick={() => setShowCreateCase(true)}>
            <Plus className="h-4 w-4" /> New Case
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardHeader className="pb-3">
              <Box className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Active Cases</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold" data-testid="text-active-cases">{activeCases}</p>
              <p className="text-xs text-muted-foreground mt-1">Requiring immediate attention</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <Car className="h-8 w-8 text-muted-foreground mb-2" />
              <CardTitle className="text-lg">Fleet Utilization</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold" data-testid="text-fleet-utilization">
                {dispatchedVehicles}/{fleetVehicles.length}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Vehicles currently dispatched</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <CheckCircle2 className="h-8 w-8 text-emerald-600 mb-2" />
              <CardTitle className="text-lg">Total Cases</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold" data-testid="text-total-cases">{funeralCases.length}</p>
              <p className="text-xs text-muted-foreground mt-1">All time</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="cases">
          <TabsList>
            <TabsTrigger value="cases" data-testid="tab-cases">Funeral Cases</TabsTrigger>
            <TabsTrigger value="fleet" data-testid="tab-fleet">Fleet Vehicles</TabsTrigger>
          </TabsList>

          <TabsContent value="cases" className="mt-4">
            {selectedCaseId && selectedCase ? (
              <CaseDetailView
                funeralCase={selectedCase}
                tasks={caseTasks}
                tasksLoading={tasksLoading}
                onBack={() => setSelectedCaseId(null)}
                onAddTask={() => setShowAddTask(true)}
                onToggleTask={(task) => {
                  const newStatus = task.status === "completed" ? "pending" : "completed";
                  updateTaskMutation.mutate({
                    id: task.id,
                    data: {
                      status: newStatus,
                      completedAt: newStatus === "completed" ? new Date().toISOString() : null,
                    },
                  });
                }}
                onUpdateStatus={(status) => {
                  updateCaseMutation.mutate({
                    id: selectedCase.id,
                    data: {
                      status,
                      ...(status === "completed" ? { completedAt: new Date().toISOString() } : {}),
                    },
                  });
                }}
              />
            ) : (
              <Card className="shadow-sm border-border/60">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle>Logistics Board</CardTitle>
                    <div className="flex items-center gap-2">
                      <div className="relative w-64">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder="Search cases..."
                          className="pl-9 bg-background"
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          data-testid="input-search-cases"
                        />
                      </div>
                      <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="w-36" data-testid="select-status-filter">
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Statuses</SelectItem>
                          <SelectItem value="open">Open</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="completed">Completed</SelectItem>
                          <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  {casesLoading ? (
                    <div className="flex items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  ) : filteredCases.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground" data-testid="text-no-cases">
                      No funeral cases found.
                    </div>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="pl-6">Case #</TableHead>
                          <TableHead>Deceased</TableHead>
                          <TableHead>Funeral Date</TableHead>
                          <TableHead>Location</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right pr-6">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredCases.map((fc) => (
                          <TableRow
                            key={fc.id}
                            className="hover:bg-muted/30 transition-colors cursor-pointer"
                            onClick={() => setSelectedCaseId(fc.id)}
                            data-testid={`row-funeral-case-${fc.id}`}
                          >
                            <TableCell className="font-medium pl-6">{fc.caseNumber}</TableCell>
                            <TableCell>{fc.deceasedName}</TableCell>
                            <TableCell className="text-muted-foreground">{fc.funeralDate || "—"}</TableCell>
                            <TableCell className="text-sm">{fc.funeralLocation || "—"}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className={`font-medium text-[10px] ${getStatusColor(fc.status)}`}>
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
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="fleet" className="mt-4">
            <Card className="shadow-sm border-border/60">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle>Fleet Vehicles</CardTitle>
                  <Button
                    variant="outline"
                    className="gap-2"
                    onClick={() => setShowCreateVehicle(true)}
                    data-testid="button-add-vehicle"
                  >
                    <Plus className="h-4 w-4" /> Add Vehicle
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {fleetLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : fleetVehicles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground" data-testid="text-no-vehicles">
                    No fleet vehicles registered.
                  </div>
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
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-primary/70" />
                              {v.registration}
                            </div>
                          </TableCell>
                          <TableCell>{[v.make, v.model].filter(Boolean).join(" ") || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">{v.year || "—"}</TableCell>
                          <TableCell className="text-sm">{v.vehicleType || "—"}</TableCell>
                          <TableCell className="text-muted-foreground">
                            {v.currentMileage != null ? `${v.currentMileage.toLocaleString()} km` : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`font-medium text-[10px] ${getVehicleStatusColor(v.status)}`}>
                              {v.status.toUpperCase()}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CreateCaseDialog
        open={showCreateCase}
        onOpenChange={setShowCreateCase}
        onSubmit={(data) => createCaseMutation.mutate(data)}
        isPending={createCaseMutation.isPending}
      />

      <AddTaskDialog
        open={showAddTask}
        onOpenChange={setShowAddTask}
        onSubmit={(data) => {
          if (selectedCaseId) createTaskMutation.mutate({ caseId: selectedCaseId, data });
        }}
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

function CaseDetailView({
  funeralCase,
  tasks,
  tasksLoading,
  onBack,
  onAddTask,
  onToggleTask,
  onUpdateStatus,
}: {
  funeralCase: FuneralCase;
  tasks: FuneralTask[];
  tasksLoading: boolean;
  onBack: () => void;
  onAddTask: () => void;
  onToggleTask: (task: FuneralTask) => void;
  onUpdateStatus: (status: string) => void;
}) {
  const completedTasks = tasks.filter((t) => t.status === "completed").length;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "completed": return "bg-emerald-500/15 text-emerald-700 border-emerald-200";
      case "in_progress": return "bg-blue-500/15 text-blue-700 border-blue-200";
      case "open": return "bg-amber-500/15 text-amber-700 border-amber-200";
      default: return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} data-testid="button-back-to-list">
          ← Back
        </Button>
        <h2 className="text-xl font-bold" data-testid="text-case-number">{funeralCase.caseNumber}</h2>
        <Badge variant="outline" className={`font-medium text-[10px] ${getStatusColor(funeralCase.status)}`}>
          {funeralCase.status.replace("_", " ").toUpperCase()}
        </Badge>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Case Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Deceased</span>
              <span className="font-medium" data-testid="text-deceased-name">{funeralCase.deceasedName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Funeral Date</span>
              <span>{funeralCase.funeralDate || "—"}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Location</span>
              <span>{funeralCase.funeralLocation || "—"}</span>
            </div>
            {funeralCase.notes && (
              <div className="pt-2 border-t">
                <span className="text-muted-foreground">Notes</span>
                <p className="mt-1">{funeralCase.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Status Management</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2 flex-wrap">
              {["open", "in_progress", "completed", "cancelled"].map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={funeralCase.status === s ? "default" : "outline"}
                  onClick={() => onUpdateStatus(s)}
                  disabled={funeralCase.status === s}
                  data-testid={`button-status-${s}`}
                >
                  {s.replace("_", " ").toUpperCase()}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Task Checklist</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {completedTasks}/{tasks.length} completed
              </p>
            </div>
            <Button size="sm" variant="outline" className="gap-2" onClick={onAddTask} data-testid="button-add-task">
              <Plus className="h-3 w-3" /> Add Task
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {tasksLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-tasks">
              No tasks yet. Add tasks to track funeral logistics.
            </p>
          ) : (
            <div className="space-y-2">
              {tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  data-testid={`row-task-${task.id}`}
                >
                  <Checkbox
                    checked={task.status === "completed"}
                    onCheckedChange={() => onToggleTask(task)}
                    data-testid={`checkbox-task-${task.id}`}
                  />
                  <div className="flex-1">
                    <p className={`text-sm font-medium ${task.status === "completed" ? "line-through text-muted-foreground" : ""}`}>
                      {task.taskName}
                    </p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground">{task.description}</p>
                    )}
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${task.status === "completed" ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : "bg-amber-500/15 text-amber-700 border-amber-200"}`}
                  >
                    {task.status.toUpperCase()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function CreateCaseDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, string | null>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({ deceasedName: "", funeralDate: "", funeralLocation: "", notes: "" });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      deceasedName: form.deceasedName,
      funeralDate: form.funeralDate || null,
      funeralLocation: form.funeralLocation || null,
      notes: form.notes || null,
    });
    setForm({ deceasedName: "", funeralDate: "", funeralLocation: "", notes: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Funeral Case</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Deceased Name *</Label>
            <Input
              value={form.deceasedName}
              onChange={(e) => setForm({ ...form, deceasedName: e.target.value })}
              required
              data-testid="input-deceased-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Funeral Date</Label>
            <Input
              type="date"
              value={form.funeralDate}
              onChange={(e) => setForm({ ...form, funeralDate: e.target.value })}
              data-testid="input-funeral-date"
            />
          </div>
          <div className="space-y-2">
            <Label>Location</Label>
            <Input
              value={form.funeralLocation}
              onChange={(e) => setForm({ ...form, funeralLocation: e.target.value })}
              data-testid="input-funeral-location"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              data-testid="input-case-notes"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.deceasedName} data-testid="button-submit-case">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Create Case
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddTaskDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, string>) => void;
  isPending: boolean;
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
        <DialogHeader>
          <DialogTitle>Add Task</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Task Name *</Label>
            <Input
              value={form.taskName}
              onChange={(e) => setForm({ ...form, taskName: e.target.value })}
              required
              data-testid="input-task-name"
            />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              data-testid="input-task-description"
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.taskName} data-testid="button-submit-task">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Task
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateVehicleDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (data: Record<string, string | number | null>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    registration: "",
    make: "",
    model: "",
    year: "",
    vehicleType: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      registration: form.registration,
      make: form.make || null,
      model: form.model || null,
      year: form.year ? parseInt(form.year) : null,
      vehicleType: form.vehicleType || null,
    });
    setForm({ registration: "", make: "", model: "", year: "", vehicleType: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Fleet Vehicle</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Registration *</Label>
            <Input
              value={form.registration}
              onChange={(e) => setForm({ ...form, registration: e.target.value })}
              required
              data-testid="input-vehicle-registration"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Make</Label>
              <Input
                value={form.make}
                onChange={(e) => setForm({ ...form, make: e.target.value })}
                data-testid="input-vehicle-make"
              />
            </div>
            <div className="space-y-2">
              <Label>Model</Label>
              <Input
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                data-testid="input-vehicle-model"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Year</Label>
              <Input
                type="number"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                data-testid="input-vehicle-year"
              />
            </div>
            <div className="space-y-2">
              <Label>Vehicle Type</Label>
              <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                <SelectTrigger data-testid="select-vehicle-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hearse">Hearse</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.registration} data-testid="button-submit-vehicle">
              {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Add Vehicle
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
