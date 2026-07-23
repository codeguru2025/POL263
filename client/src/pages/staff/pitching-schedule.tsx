import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { SearchableSelect, type SearchableOption } from "@/components/searchable-select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { Plus, Trash2, Truck, Loader2, CalendarDays } from "lucide-react";

export default function StaffPitchingSchedule() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canWrite = permissions.includes("write:funeral_ops");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [showAdd, setShowAdd] = useState(false);

  const { data: assignments = [], isLoading } = useQuery<any[]>({
    queryKey: [`/api/pitching-assignments?date=${date}`],
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/pitching-assignments/${id}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pitching-assignments?date=${date}`] });
      toast({ title: "Assignment removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", "/api/pitching-assignments", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to create assignment");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/pitching-assignments?date=${date}`] });
      setShowAdd(false);
      toast({ title: "Pitching assignment added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // Group by vehicle so staff can see, at a glance, everywhere one vehicle is going today.
  const groups = new Map<string, any[]>();
  for (const a of assignments) {
    const key = a.vehicle ? a.vehicle.id : "__none__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  }

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Pitching Schedule"
          description="Cross-case view of who's setting up which cemetery, with which vehicle and equipment, on a given day."
        />
        <div className="flex items-center justify-between mb-4 gap-3">
          <div className="w-48">
            <Label className="text-xs" htmlFor="date">Date</Label>
            <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-schedule-date" />
          </div>
          {canWrite && (
            <Button onClick={() => setShowAdd(true)} data-testid="button-add-pitching-assignment">
              <Plus className="h-4 w-4 mr-1" />Add Assignment
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : assignments.length === 0 ? (
          <EmptyState icon={CalendarDays} title="No pitching assignments for this date" description="Add one to schedule a vehicle, crew, and equipment for a cemetery." />
        ) : (
          <div className="space-y-4">
            {Array.from(groups.entries()).map(([vehicleKey, rows]) => (
              <CardSection
                key={vehicleKey}
                title={rows[0].vehicle ? `${rows[0].vehicle.registration}${rows[0].vehicle.make ? ` — ${rows[0].vehicle.make} ${rows[0].vehicle.model || ""}`.trim() : ""}` : "No vehicle assigned"}
                icon={Truck}
                flush
              >
                <div className="divide-y">
                  {rows.map((a: any) => (
                    <div key={a.id} className="px-4 py-3 flex items-start justify-between gap-3" data-testid={`row-pitching-assignment-${a.id}`}>
                      <div className="min-w-0 space-y-1">
                        <div className="font-medium text-sm">
                          {a.cemetery?.name || "Unregistered cemetery"}
                          {a.funeralCase && <span className="text-muted-foreground font-normal"> — {a.funeralCase.caseNumber} ({a.funeralCase.deceasedName})</span>}
                        </div>
                        {a.staff?.length > 0 && (
                          <div className="text-xs text-muted-foreground">Crew: {a.staff.map((u: any) => u.displayName || u.email).join(", ")}</div>
                        )}
                        {a.equipment?.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {a.equipment.map((e: any) => <Badge key={e.id} variant="outline" className="text-[10px]">{e.name}</Badge>)}
                          </div>
                        )}
                        {a.notes && <div className="text-xs text-muted-foreground">{a.notes}</div>}
                      </div>
                      {canWrite && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive shrink-0" onClick={() => deleteMutation.mutate(a.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </CardSection>
            ))}
          </div>
        )}
      </PageShell>

      <AddPitchingAssignmentDialog
        open={showAdd}
        onOpenChange={setShowAdd}
        date={date}
        onSubmit={(data) => createMutation.mutate(data)}
        isPending={createMutation.isPending}
      />
    </StaffLayout>
  );
}

function AddPitchingAssignmentDialog({ open, onOpenChange, date, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void; date: string;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [funeralCaseId, setFuneralCaseId] = useState("");
  const [cemeteryId, setCemeteryId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [userIds, setUserIds] = useState<string[]>([]);
  const [equipmentItemIds, setEquipmentItemIds] = useState<string[]>([]);
  const [notes, setNotes] = useState("");

  const { data: cases = [] } = useQuery<any[]>({ queryKey: ["/api/funeral-cases"], enabled: open });
  const { data: cemeteries = [] } = useQuery<any[]>({ queryKey: ["/api/cemeteries"], enabled: open });
  const { data: vehicles = [] } = useQuery<any[]>({ queryKey: ["/api/fleet"], enabled: open });
  const { data: users = [] } = useQuery<any[]>({ queryKey: ["/api/users"], enabled: open });
  const { data: equipmentItems = [] } = useQuery<any[]>({ queryKey: ["/api/equipment-items"], enabled: open });

  const params = new URLSearchParams({ date });
  if (vehicleId) params.set("vehicleId", vehicleId);
  if (userIds.length > 0) params.set("userIds", userIds.join(","));
  if (equipmentItemIds.length > 0) params.set("equipmentItemIds", equipmentItemIds.join(","));
  const availabilityEnabled = open && !!date && (!!vehicleId || userIds.length > 0 || equipmentItemIds.length > 0);
  const { data: availability } = useQuery<{ conflicts: string[] }>({
    queryKey: [`/api/scheduling/availability?${params.toString()}`],
    enabled: availabilityEnabled,
  });

  const caseOptions: SearchableOption[] = cases.map((c: any) => ({ value: c.id, label: `${c.caseNumber} — ${c.deceasedName}`, hint: c.status || undefined }));
  const cemeteryOptions: SearchableOption[] = cemeteries.map((c: any) => ({ value: c.id, label: c.name, hint: c.address || undefined }));
  const vehicleOptions: SearchableOption[] = vehicles.map((v: any) => ({ value: v.id, label: `${v.registration}${v.make ? ` — ${v.make} ${v.model || ""}`.trim() : ""}`, hint: v.vehicleType || undefined }));

  const reset = () => {
    setFuneralCaseId(""); setCemeteryId(""); setVehicleId(""); setUserIds([]); setEquipmentItemIds([]); setNotes("");
  };

  const handleSubmit = () => {
    onSubmit({
      funeralCaseId,
      cemeteryId: cemeteryId || undefined,
      assignmentDate: date,
      vehicleId: vehicleId || undefined,
      userIds,
      equipmentItemIds,
      notes: notes.trim() || undefined,
    });
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Pitching Assignment</DialogTitle>
          <DialogDescription>Assign a cemetery, vehicle, crew, and equipment for {date}.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Funeral Case *</Label>
            <SearchableSelect options={caseOptions} value={funeralCaseId} onChange={setFuneralCaseId} placeholder="Search case number or name…" searchPlaceholder="Search…" />
          </div>
          <div>
            <Label className="text-xs">Cemetery</Label>
            <SearchableSelect options={cemeteryOptions} value={cemeteryId} onChange={setCemeteryId} placeholder="Select cemetery…" searchPlaceholder="Search…" />
          </div>
          <div>
            <Label className="text-xs">Vehicle</Label>
            <SearchableSelect options={vehicleOptions} value={vehicleId} onChange={setVehicleId} placeholder="Select vehicle…" searchPlaceholder="Search by registration…" />
          </div>
          <div>
            <Label className="text-xs">Pitching Crew</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1.5">
              {users.filter((u: any) => u.isActive !== false).map((u: any) => (
                <div key={u.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={userIds.includes(u.id)}
                    onCheckedChange={(v) => setUserIds((prev) => v ? [...prev, u.id] : prev.filter((id) => id !== u.id))}
                  />
                  <Label className="text-sm font-normal cursor-pointer" onClick={() => setUserIds((prev) => prev.includes(u.id) ? prev.filter((id) => id !== u.id) : [...prev, u.id])}>
                    {u.displayName || u.email}
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Equipment</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border p-2 space-y-1.5">
              {equipmentItems.length === 0 && <p className="text-xs text-muted-foreground">No equipment registered yet.</p>}
              {equipmentItems.map((e: any) => (
                <div key={e.id} className="flex items-center gap-2">
                  <Checkbox
                    checked={equipmentItemIds.includes(e.id)}
                    onCheckedChange={(v) => setEquipmentItemIds((prev) => v ? [...prev, e.id] : prev.filter((id) => id !== e.id))}
                  />
                  <Label className="text-sm font-normal cursor-pointer" onClick={() => setEquipmentItemIds((prev) => prev.includes(e.id) ? prev.filter((id) => id !== e.id) : [...prev, e.id])}>
                    {e.name} <span className="text-muted-foreground">({e.equipmentType})</span>
                  </Label>
                </div>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {availability?.conflicts && availability.conflicts.length > 0 && (
            <p className="text-[11px] text-amber-700 bg-amber-500/10 border border-amber-200 rounded-md px-2.5 py-1.5">
              {availability.conflicts.join(" · ")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!funeralCaseId || isPending} data-testid="button-submit-pitching-assignment">
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Assignment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
