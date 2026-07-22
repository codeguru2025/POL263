import { useState, useCallback, useRef, useEffect } from "react";
import { useSearch, Link } from "wouter";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { SearchableSelect, type SearchableOption } from "@/components/searchable-select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { Plus, Search, Car, Box, Loader2, ChevronRight, Truck, CheckCircle2, FileDown, Share2, Pencil, User, ChevronDown, Trash2, Building2, Users, DollarSign } from "lucide-react";
import type { FuneralCase, FuneralTask, FleetVehicle } from "@shared/schema";
import { computeServiceCharge } from "@shared/pricing";
import { QuoteDialog } from "./quotations";
import { useAuth } from "@/hooks/use-auth";
import { CountryFlagFields, type CountryFlagSettings } from "@/components/country-flag-fields";

// Funeral cases store date of birth, not age — the quotation form wants age directly.
function ageFromDob(dob: string | null | undefined): string {
  if (!dob) return "";
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? String(age) : "";
}

// Convert a UTC timestamp from the DB into a value suitable for <input type="datetime-local">.
// datetime-local expects local time; .toISOString() gives UTC, so we offset by the browser's TZ.
function utcToDatetimeLocal(utcStr: string): string {
  const d = new Date(utcStr);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

// Convert a datetime-local string (local time, no TZ) to a UTC ISO string for the server.
// The browser parses "YYYY-MM-DDTHH:mm" as LOCAL time, so .toISOString() correctly gives UTC.
function datetimeLocalToUtc(local: string): string {
  return new Date(local).toISOString();
}

const TIME_FIELDS: (keyof CaseForm)[] = ["bodyWashTime", "burialDepartureTime", "memorialServiceStart", "memorialServiceEnd"];

// Service timeline: body wash (0) → memorial start (+30min) → memorial end (+60min) → departure (+90min).
// 15-minute buffer after departure before next service can start.
const STEP = 30; // minutes per step

// Add/subtract minutes from a datetime-local string.
function shiftTime(local: string, minutes: number): string {
  const d = new Date(local);
  d.setMinutes(d.getMinutes() + minutes);
  return utcToDatetimeLocal(d.toISOString());
}

// Non-blocking "already assigned elsewhere on this date" notice for a vehicle/driver pair —
// checks both other funeral cases' legs and pitching assignments server-side, warns only.
function AvailabilityWarning({ date, vehicleId, driverId, excludeFuneralCaseId }: {
  date: string; vehicleId?: string; driverId?: string; excludeFuneralCaseId?: string;
}) {
  const enabled = !!date && (!!vehicleId || !!driverId);
  const params = new URLSearchParams({ date });
  if (vehicleId) params.set("vehicleId", vehicleId);
  if (driverId) params.set("driverId", driverId);
  if (excludeFuneralCaseId) params.set("excludeFuneralCaseId", excludeFuneralCaseId);
  const { data } = useQuery<{ conflicts: string[] }>({
    queryKey: [`/api/scheduling/availability?${params.toString()}`],
    enabled,
  });
  if (!enabled || !data?.conflicts?.length) return null;
  return (
    <p className="col-span-2 text-[11px] text-amber-700 bg-amber-500/10 border border-amber-200 rounded-md px-2.5 py-1.5">
      {data.conflicts.join(" · ")}
    </p>
  );
}

// Returns true if two time windows [aStart, aEnd] and [bStart, bEnd] overlap.
function windowsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// Check if the proposed service window clashes with any other case.
// Returns the name of the clashing case, or null if clear.
function detectClash(
  proposedWash: string,        // datetime-local
  proposedDeparture: string,   // datetime-local
  cases: FuneralCase[],
  excludeId?: string,
): string | null {
  if (!proposedWash || !proposedDeparture) return null;
  const BUFFER = 15 * 60 * 1000; // 15 min in ms
  const pStart = new Date(proposedWash);
  const pEnd   = new Date(new Date(proposedDeparture).getTime() + BUFFER);
  for (const c of cases) {
    if (c.id === excludeId) continue;
    const wash = (c as any).bodyWashTime;
    const dep  = (c as any).burialDepartureTime;
    if (!wash || !dep) continue;
    const cStart = new Date(wash);
    const cEnd   = new Date(new Date(dep).getTime() + BUFFER);
    if (windowsOverlap(pStart, pEnd, cStart, cEnd)) {
      return (c as any).deceasedName || "another family";
    }
  }
  return null;
}

type CaseForm = {
  deceasedName: string;
  deceasedDob: string;
  deceasedGender: string;
  deceasedNationalId: string;
  deceasedRelationship: string;
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
  overnightUsed: boolean;
  overnightDate: string;
  overnightLocation: string;
  overnightVehicleId: string;
  overnightDriverId: string;
  cemeteryId: string;
  attendingAgentId: string;
  bodyWashTime: string;
  burialDepartureTime: string;
  memorialServiceStart: string;
  memorialServiceEnd: string;
  bodyIdentifierName: string;
  bodyIdentifierIdNumber: string;
  notes: string;
  policyId: string;
  claimId: string;
  quotationId: string;
  branchId: string;
  isCrossBorderFlag: boolean;
  crossBorderReference: string;
};

const BLANK_FORM: CaseForm = {
  deceasedName: "", deceasedDob: "", deceasedGender: "", deceasedNationalId: "", deceasedRelationship: "",
  dateOfDeath: "", causeOfDeath: "", placeOfDeath: "",
  informantName: "", informantPhone: "", informantRelationship: "",
  serviceType: "", funeralDate: "", funeralLocation: "",
  removalLocation: "", removalVehicleId: "", removalDriverId: "",
  burialVehicleId: "", burialDriverId: "",
  overnightUsed: false, overnightDate: "", overnightLocation: "", overnightVehicleId: "", overnightDriverId: "",
  cemeteryId: "", attendingAgentId: "",
  bodyWashTime: "", burialDepartureTime: "", memorialServiceStart: "", memorialServiceEnd: "",
  bodyIdentifierName: "", bodyIdentifierIdNumber: "",
  notes: "", policyId: "", claimId: "", quotationId: "",
  branchId: "", isCrossBorderFlag: false, crossBorderReference: "",
};

export default function StaffFunerals() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { permissions } = useAuth();
  const canWriteFuneralOps = permissions.includes("write:funeral_ops");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreateCase, setShowCreateCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [showEditCase, setShowEditCase] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showCreateVehicle, setShowCreateVehicle] = useState(false);
  const [showEditVehicle, setShowEditVehicle] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState<FleetVehicle | null>(null);

  const { data: funeralCases = [], isLoading: casesLoading, isError: casesError } = useQuery<FuneralCase[]>({
    queryKey: ["/api/funeral-cases"],
  });

  const { data: fleetVehicles = [], isLoading: fleetLoading } = useQuery<FleetVehicle[]>({
    queryKey: ["/api/fleet"],
  });

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
  });

  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["/api/branches"],
  });
  const defaultBranchId = branches.find((b: any) => b.isHeadOffice && b.isActive)?.id ?? "";
  const { data: countryFlagSettings } = useQuery<CountryFlagSettings>({
    queryKey: ["/api/country-flag-settings"],
  });

  const selectedCase = funeralCases.find((c) => c.id === selectedCaseId) ?? null;

  // Deep-link support for the Claims<->Funerals cross-link (claims.tsx links here via
  // ?openCase=), matching the ?openPolicy= pattern already used on the Policies page.
  const deepLinkSearch = useSearch();
  useEffect(() => {
    const id = new URLSearchParams(deepLinkSearch).get("openCase");
    if (!id || funeralCases.length === 0) return;
    if (funeralCases.some((c) => c.id === id)) setSelectedCaseId(id);
  }, [deepLinkSearch, funeralCases]);

  const { data: caseTasks = [], isLoading: tasksLoading } = useQuery<FuneralTask[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/tasks`],
    enabled: !!selectedCaseId,
  });

  // Cash-service billing: quotation (what the family is charged) + receipts (payments received).
  const { data: caseQuotation } = useQuery<any>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/quotation`],
    enabled: !!selectedCaseId,
  });
  const { data: caseReceipts = [] } = useQuery<any[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/receipts`],
    enabled: !!selectedCaseId,
  });
  const { data: caseVehicleTrips = [] } = useQuery<any[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/vehicle-trips`],
    enabled: !!selectedCaseId,
  });
  const { data: caseProfitLoss } = useQuery<any>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/profit-loss`],
    enabled: !!selectedCaseId,
  });

  // ── Service Charges (mortuary/funeral-day service rate card) ──
  const { data: caseServiceCharges = [] } = useQuery<any[]>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/service-charges`],
    enabled: !!selectedCaseId,
  });
  const { data: serviceRates = [] } = useQuery<any[]>({ queryKey: ["/api/mortuary-service-rates"] });
  const [showAddServiceCharge, setShowAddServiceCharge] = useState(false);

  const addServiceChargeMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/funeral-cases/${selectedCaseId}/service-charges`, data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to add service charge");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/service-charges`] });
      setShowAddServiceCharge(false);
      toast({ title: "Service charge added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const payServiceChargeMutation = useMutation({
    mutationFn: async ({ id, paidBy }: { id: string; paidBy: string }) => {
      const res = await apiRequest("POST", `/api/case-service-charges/${id}/payment`, { paidBy });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/service-charges`] });
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteServiceChargeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/case-service-charges/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/service-charges`] });
      toast({ title: "Charge removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Service Rates (org rate-card CRUD) ─────────────────────
  const [showRateDialog, setShowRateDialog] = useState(false);
  const [editingRate, setEditingRate] = useState<any>(null);
  const saveServiceRateMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = editingRate
        ? await apiRequest("PATCH", `/api/mortuary-service-rates/${editingRate.id}`, data)
        : await apiRequest("POST", "/api/mortuary-service-rates", data);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Failed to save rate");
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/mortuary-service-rates"] });
      setShowRateDialog(false);
      setEditingRate(null);
      toast({ title: editingRate ? "Rate updated" : "Rate added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Cemeteries ─────────────────────────────────────────────
  const { data: cemeteriesList = [] } = useQuery<any[]>({ queryKey: ["/api/cemeteries"] });
  const [showCemeteryDialog, setShowCemeteryDialog] = useState(false);
  const [editingCemetery, setEditingCemetery] = useState<any>(null);
  const [cemeteryForm, setCemeteryForm] = useState({ name: "", address: "", notes: "" });
  const saveCemeteryMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = editingCemetery
        ? await apiRequest("PATCH", `/api/cemeteries/${editingCemetery.id}`, data)
        : await apiRequest("POST", "/api/cemeteries", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cemeteries"] });
      setShowCemeteryDialog(false);
      setEditingCemetery(null);
      setCemeteryForm({ name: "", address: "", notes: "" });
      toast({ title: editingCemetery ? "Cemetery updated" : "Cemetery added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Equipment ──────────────────────────────────────────────
  const { data: equipmentList = [] } = useQuery<any[]>({ queryKey: ["/api/equipment-items"] });
  const [showEquipmentDialog, setShowEquipmentDialog] = useState(false);
  const [editingEquipment, setEditingEquipment] = useState<any>(null);
  const [equipmentForm, setEquipmentForm] = useState({ name: "", equipmentType: "tent", status: "available", notes: "" });
  const saveEquipmentMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = editingEquipment
        ? await apiRequest("PATCH", `/api/equipment-items/${editingEquipment.id}`, data)
        : await apiRequest("POST", "/api/equipment-items", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/equipment-items"] });
      setShowEquipmentDialog(false);
      setEditingEquipment(null);
      setEquipmentForm({ name: "", equipmentType: "tent", status: "available", notes: "" });
      toast({ title: editingEquipment ? "Equipment updated" : "Equipment added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  // ── Parlours ──────────────────────────────────────────────
  const [selectedParlourId, setSelectedParlourId] = useState<string | null>(null);
  const [showParlourDialog, setShowParlourDialog] = useState(false);
  const [editingParlour, setEditingParlour] = useState<any>(null);
  const [parlourForm, setParlourForm] = useState({ name: "", contactPerson: "", phone: "", email: "", address: "" });
  const [showPersonnelDialog, setShowPersonnelDialog] = useState(false);
  const [editingPersonnel, setEditingPersonnel] = useState<any>(null);
  const [personnelForm, setPersonnelForm] = useState({ name: "", role: "", phone: "", email: "" });

  const { data: parlours = [] } = useQuery<any[]>({ queryKey: ["/api/partner-parlours"] });
  const { data: parlourPersonnel = [] } = useQuery<any[]>({
    queryKey: [`/api/partner-parlours/${selectedParlourId}/personnel`],
    enabled: !!selectedParlourId,
  });

  const saveParlourMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = editingParlour
        ? await apiRequest("PATCH", `/api/partner-parlours/${editingParlour.id}`, data)
        : await apiRequest("POST", "/api/partner-parlours", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner-parlours"] });
      setShowParlourDialog(false);
      setEditingParlour(null);
      setParlourForm({ name: "", contactPerson: "", phone: "", email: "", address: "" });
      toast({ title: editingParlour ? "Parlour updated" : "Parlour added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const savePersonnelMutation = useMutation({
    mutationFn: async (data: Record<string, string>) => {
      const res = editingPersonnel
        ? await apiRequest("PATCH", `/api/parlour-personnel/${editingPersonnel.id}`, data)
        : await apiRequest("POST", `/api/partner-parlours/${selectedParlourId}/personnel`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/partner-parlours/${selectedParlourId}/personnel`] });
      setShowPersonnelDialog(false);
      setEditingPersonnel(null);
      setPersonnelForm({ name: "", role: "", phone: "", email: "" });
      toast({ title: editingPersonnel ? "Contact updated" : "Contact added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deletePersonnelMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/parlour-personnel/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/partner-parlours/${selectedParlourId}/personnel`] });
      toast({ title: "Contact removed" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const [showDriverChecklist, setShowDriverChecklist] = useState(false);

  const { data: driverChecklist } = useQuery<any>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/driver-checklist`],
    enabled: !!selectedCaseId,
  });

  const upsertDriverChecklistMutation = useMutation({
    mutationFn: async (data: Record<string, any>) => {
      const res = await apiRequest("POST", `/api/funeral-cases/${selectedCaseId}/driver-checklist`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/driver-checklist`] });
      setShowDriverChecklist(false);
      toast({ title: "Driver checklist saved" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: linkedMortuaryIntake } = useQuery<any>({
    queryKey: [`/api/funeral-cases/${selectedCaseId}/mortuary-intake`],
    enabled: !!selectedCaseId,
  });

  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [paymentForm, setPaymentForm] = useState({ amount: "", currency: "USD", paymentChannel: "cash" });
  const [paymentIdempotencyKey, setPaymentIdempotencyKey] = useState(() => crypto.randomUUID());
  const addServiceReceiptMutation = useMutation({
    mutationFn: async (data: { amount: string; currency: string; paymentChannel: string }) => {
      const res = await apiRequest("POST", `/api/funeral-cases/${selectedCaseId}/receipts`, { ...data, idempotencyKey: paymentIdempotencyKey });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/receipts`] });
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/quotation`] });
      setShowPaymentDialog(false);
      setPaymentForm({ amount: "", currency: "USD", paymentChannel: "cash" });
      setPaymentIdempotencyKey(crypto.randomUUID());
      toast({ title: "Payment recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const [showQuotationDialog, setShowQuotationDialog] = useState(false);

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

  const startTripMutation = useMutation({
    mutationFn: async ({ caseId, data }: { caseId: string; data: Record<string, any> }) => {
      const res = await apiRequest("POST", `/api/funeral-cases/${caseId}/vehicle-trips`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/vehicle-trips`] });
      toast({ title: "Trip started — start mileage recorded" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const endTripMutation = useMutation({
    mutationFn: async ({ tripId, data }: { tripId: string; data: Record<string, any> }) => {
      const res = await apiRequest("PATCH", `/api/vehicle-trips/${tripId}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/vehicle-trips`] });
      toast({ title: "Trip closed — closing mileage recorded" });
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

  const updateVehicleMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, string | number | null> }) => {
      const res = await apiRequest("PUT", `/api/fleet/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/fleet"] });
      setShowEditVehicle(false);
      setSelectedVehicle(null);
      toast({ title: "Vehicle updated" });
    },
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
            <div className="flex gap-2 flex-wrap">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="gap-1.5 shadow-sm">
                    <FileDown className="h-4 w-4" /> Blank Forms <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/funeral-case-worksheet`} target="_blank" rel="noopener noreferrer">Case Worksheet</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/funeral-quotation`} target="_blank" rel="noopener noreferrer">Funeral Quotation</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/driver-checklist`} target="_blank" rel="noopener noreferrer">Driver Checklist</a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/vehicle-registration`} target="_blank" rel="noopener noreferrer">Vehicle Registration</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/fuel-log`} target="_blank" rel="noopener noreferrer">Fuel Log</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/maintenance-record`} target="_blank" rel="noopener noreferrer">Maintenance Record</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/driver-assignment`} target="_blank" rel="noopener noreferrer">Driver Assignment</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={`${getApiBase()}/api/forms/blank/vehicle-trip-log`} target="_blank" rel="noopener noreferrer">Vehicle Trip Log</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button className="gap-2 shadow-sm" data-testid="button-new-case" onClick={() => setShowCreateCase(true)}>
                <Plus className="h-4 w-4" /> New Case
              </Button>
            </div>
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
            <TabsTrigger value="parlours" data-testid="tab-parlours">Partner Parlours</TabsTrigger>
            <TabsTrigger value="rates" data-testid="tab-service-rates">Service Rates</TabsTrigger>
            <TabsTrigger value="cemeteries" data-testid="tab-cemeteries">Cemeteries</TabsTrigger>
            <TabsTrigger value="equipment" data-testid="tab-equipment">Equipment</TabsTrigger>
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
                driverChecklist={driverChecklist}
                linkedMortuaryIntake={linkedMortuaryIntake}
                onOpenDriverChecklist={() => setShowDriverChecklist(true)}
                quotation={caseQuotation}
                receipts={caseReceipts}
                onRecordPayment={() => setShowPaymentDialog(true)}
                onEditQuotation={() => setShowQuotationDialog(true)}
                vehicleTrips={caseVehicleTrips}
                onStartTrip={(data) => startTripMutation.mutate({ caseId: selectedCase.id, data })}
                onEndTrip={(tripId, data) => endTripMutation.mutate({ tripId, data })}
                profitLoss={caseProfitLoss}
                countryFlagSettings={countryFlagSettings}
                serviceCharges={caseServiceCharges}
                onAddServiceCharge={() => setShowAddServiceCharge(true)}
                onPayServiceCharge={(id, paidBy) => payServiceChargeMutation.mutate({ id, paidBy })}
                onDeleteServiceCharge={(id) => deleteServiceChargeMutation.mutate(id)}
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
                ) : casesError ? (
                  <EmptyState title="Failed to load cases" description="An error occurred. Please refresh the page." className="border-0 rounded-none bg-transparent py-10" />
                ) : filteredCases.length === 0 ? (
                  <EmptyState title="No funeral cases found" description="No cases match the current filter." className="border-0 rounded-none bg-transparent py-10" data-testid="text-no-cases" />
                ) : (
                  <div className="overflow-x-auto">
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
                            <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-view-case-${fc.id}`} aria-label="View funeral case details">
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
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="pl-6">Registration</TableHead>
                      <TableHead>Make / Model</TableHead>
                      <TableHead>Year</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Mileage</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
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
                        <TableCell className="text-right pr-6">
                          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit vehicle" data-testid={`button-edit-vehicle-${v.id}`}
                            onClick={() => { setSelectedVehicle(v); setShowEditVehicle(true); }}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardSection>
          </TabsContent>
          {/* ─── Parlours tab ──────────────────────────────────────── */}
          <TabsContent value="parlours" className="mt-4">
            <div className="grid md:grid-cols-3 gap-4">
              {/* Parlours list */}
              <CardSection
                title="Partner Parlours"
                icon={Building2}
                headerRight={canWriteFuneralOps ? (
                  <Button size="sm" onClick={() => { setEditingParlour(null); setParlourForm({ name: "", contactPerson: "", phone: "", email: "", address: "" }); setShowParlourDialog(true); }}>
                    <Plus className="h-4 w-4 mr-1" />Add
                  </Button>
                ) : undefined}
              >
                {parlours.length === 0 ? (
                  <EmptyState icon={Building2} title="No parlours" description="Add partner funeral parlours to track contacts." />
                ) : (
                  <div className="divide-y">
                    {parlours.map((p: any) => (
                      <div key={p.id} className={`px-4 py-3 cursor-pointer hover:bg-muted/40 flex items-start justify-between gap-2 ${selectedParlourId === p.id ? "bg-muted/60" : ""}`} onClick={() => setSelectedParlourId(p.id)}>
                        <div className="min-w-0">
                          <div className="font-medium text-sm truncate">{p.name}</div>
                          {p.contactPerson && <div className="text-xs text-muted-foreground">{p.contactPerson}</div>}
                          {p.phone && <div className="text-xs text-muted-foreground">{p.phone}</div>}
                        </div>
                        {canWriteFuneralOps && (
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-label={`Edit ${p.name}`} onClick={(e) => { e.stopPropagation(); setEditingParlour(p); setParlourForm({ name: p.name || "", contactPerson: p.contactPerson || "", phone: p.phone || "", email: p.email || "", address: p.address || "" }); setShowParlourDialog(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardSection>

              {/* Personnel panel */}
              <div className="md:col-span-2">
                <CardSection
                  title={selectedParlourId ? `Personnel — ${parlours.find((p: any) => p.id === selectedParlourId)?.name || ""}` : "Personnel"}
                  icon={Users}
                  headerRight={canWriteFuneralOps && selectedParlourId ? (
                    <Button size="sm" onClick={() => { setEditingPersonnel(null); setPersonnelForm({ name: "", role: "", phone: "", email: "" }); setShowPersonnelDialog(true); }}>
                      <Plus className="h-4 w-4 mr-1" />Add Contact
                    </Button>
                  ) : undefined}
                >
                  {!selectedParlourId ? (
                    <EmptyState icon={Users} title="Select a parlour" description="Click a parlour on the left to view its personnel." />
                  ) : parlourPersonnel.length === 0 ? (
                    <EmptyState icon={Users} title="No contacts" description="Add contacts for this parlour." />
                  ) : (
                    <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Phone</TableHead>
                          <TableHead>Email</TableHead>
                          {canWriteFuneralOps && <TableHead className="w-[80px]" />}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {parlourPersonnel.map((p: any) => (
                          <TableRow key={p.id}>
                            <TableCell className="font-medium text-sm">{p.name}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{p.role || "—"}</TableCell>
                            <TableCell className="text-sm">{p.phone || "—"}</TableCell>
                            <TableCell className="text-sm">{p.email || "—"}</TableCell>
                            {canWriteFuneralOps && (
                              <TableCell>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`Edit ${p.name}`} onClick={() => { setEditingPersonnel(p); setPersonnelForm({ name: p.name || "", role: p.role || "", phone: p.phone || "", email: p.email || "" }); setShowPersonnelDialog(true); }}>
                                    <Pencil className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label={`Delete ${p.name}`} onClick={() => deletePersonnelMutation.mutate(p.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    </div>
                  )}
                </CardSection>
              </div>
            </div>
          </TabsContent>

          {/* ─── Service Rates tab ─────────────────────────────────── */}
          <TabsContent value="rates" className="mt-4">
            <CardSection
              title="Mortuary & Funeral-Day Service Rates"
              description="Rate card for ancillary services (storage, chapel, removal, tents, transport, etc). One rate per service per client type — partner-parlour cases and direct-client cases can be priced differently."
              icon={DollarSign}
              flush
              headerRight={canWriteFuneralOps ? (
                <Button size="sm" onClick={() => { setEditingRate(null); setShowRateDialog(true); }} data-testid="button-add-service-rate">
                  <Plus className="h-4 w-4 mr-1" />Add Rate
                </Button>
              ) : undefined}
            >
              {serviceRates.length === 0 ? (
                <EmptyState icon={DollarSign} title="No rates configured" description="Add service rates to start billing ancillary services." className="border-0 rounded-none bg-transparent py-10" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Service</TableHead>
                        <TableHead>Client Type</TableHead>
                        <TableHead>Pricing</TableHead>
                        <TableHead>Rate</TableHead>
                        <TableHead>Active</TableHead>
                        {canWriteFuneralOps && <TableHead className="text-right pr-6">Actions</TableHead>}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...serviceRates].sort((a: any, b: any) => a.name.localeCompare(b.name) || a.clientType.localeCompare(b.clientType)).map((r: any) => (
                        <TableRow key={r.id} data-testid={`row-service-rate-${r.id}`}>
                          <TableCell className="pl-6 font-medium text-sm">{r.name}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-[10px]">{r.clientType === "partner_parlour" ? "Partner Parlour" : "Direct Client"}</Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {r.pricingType === "flat" && "Flat"}
                            {r.pricingType === "per_km" && "Base + per km"}
                            {r.pricingType === "tiered_group" && `Per ${r.tierGroupSize} unit(s)`}
                          </TableCell>
                          <TableCell className="text-sm">
                            {r.pricingType === "flat" && `${r.currency} ${parseFloat(r.baseAmount).toFixed(2)}`}
                            {r.pricingType === "per_km" && `${r.currency} ${parseFloat(r.baseAmount).toFixed(2)} + ${parseFloat(r.perKmRate).toFixed(2)}/km`}
                            {r.pricingType === "tiered_group" && `${r.currency} ${parseFloat(r.tierGroupPrice).toFixed(2)} / ${r.tierGroupSize}`}
                          </TableCell>
                          <TableCell>
                            {r.isActive
                              ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Active</Badge>
                              : <Badge variant="outline" className="text-[10px] bg-muted text-muted-foreground">Inactive</Badge>}
                          </TableCell>
                          {canWriteFuneralOps && (
                            <TableCell className="text-right pr-6">
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`Edit ${r.name}`} onClick={() => { setEditingRate(r); setShowRateDialog(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardSection>
          </TabsContent>

          {/* ─── Cemeteries tab ─────────────────────────────────────── */}
          <TabsContent value="cemeteries" className="mt-4">
            <CardSection
              title="Cemeteries"
              description="Registered burial sites — pick one on a case to auto-fill the burial location and enable pitching assignments there."
              icon={Box}
              flush
              headerRight={canWriteFuneralOps ? (
                <Button size="sm" onClick={() => { setEditingCemetery(null); setCemeteryForm({ name: "", address: "", notes: "" }); setShowCemeteryDialog(true); }} data-testid="button-add-cemetery">
                  <Plus className="h-4 w-4 mr-1" />Add Cemetery
                </Button>
              ) : undefined}
            >
              {cemeteriesList.length === 0 ? (
                <EmptyState icon={Box} title="No cemeteries yet" description="Add cemeteries to link them on funeral cases and pitching assignments." className="border-0 rounded-none bg-transparent py-10" />
              ) : (
                <div className="divide-y">
                  {cemeteriesList.map((c: any) => (
                    <div key={c.id} className="px-4 py-3 flex items-start justify-between gap-2" data-testid={`row-cemetery-${c.id}`}>
                      <div className="min-w-0">
                        <div className="font-medium text-sm">{c.name}</div>
                        {c.address && <div className="text-xs text-muted-foreground">{c.address}</div>}
                      </div>
                      {canWriteFuneralOps && (
                        <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0" aria-label={`Edit ${c.name}`} onClick={() => { setEditingCemetery(c); setCemeteryForm({ name: c.name || "", address: c.address || "", notes: c.notes || "" }); setShowCemeteryDialog(true); }}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardSection>
          </TabsContent>

          {/* ─── Equipment tab ──────────────────────────────────────── */}
          <TabsContent value="equipment" className="mt-4">
            <CardSection
              title="Equipment"
              description="Named, individually-tracked gravesite/event equipment — tents, lowering devices, coffin stands, PA systems, etc."
              icon={Box}
              flush
              headerRight={canWriteFuneralOps ? (
                <Button size="sm" onClick={() => { setEditingEquipment(null); setEquipmentForm({ name: "", equipmentType: "tent", status: "available", notes: "" }); setShowEquipmentDialog(true); }} data-testid="button-add-equipment">
                  <Plus className="h-4 w-4 mr-1" />Add Equipment
                </Button>
              ) : undefined}
            >
              {equipmentList.length === 0 ? (
                <EmptyState icon={Box} title="No equipment yet" description="Add equipment items to assign them on pitching assignments." className="border-0 rounded-none bg-transparent py-10" />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        {canWriteFuneralOps && <TableHead className="w-[60px]" />}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {equipmentList.map((e: any) => (
                        <TableRow key={e.id} data-testid={`row-equipment-${e.id}`}>
                          <TableCell className="font-medium text-sm">{e.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.equipmentType}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className={`text-[10px] ${e.status === "in_use" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                              {e.status === "in_use" ? "In Use" : "Available"}
                            </Badge>
                          </TableCell>
                          {canWriteFuneralOps && (
                            <TableCell>
                              <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={`Edit ${e.name}`} onClick={() => { setEditingEquipment(e); setEquipmentForm({ name: e.name || "", equipmentType: e.equipmentType || "tent", status: e.status || "available", notes: e.notes || "" }); setShowEquipmentDialog(true); }}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          )}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      {/* ─── Parlour dialog ─────────────────────────────────────── */}
      <Dialog open={showParlourDialog} onOpenChange={setShowParlourDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingParlour ? "Edit Parlour" : "Add Partner Parlour"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={parlourForm.name} onChange={(e) => setParlourForm({ ...parlourForm, name: e.target.value })} placeholder="Parlour name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Contact Person</Label>
                <Input value={parlourForm.contactPerson} onChange={(e) => setParlourForm({ ...parlourForm, contactPerson: e.target.value })} placeholder="Main contact" />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={parlourForm.phone} onChange={(e) => setParlourForm({ ...parlourForm, phone: e.target.value })} placeholder="+263..." />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={parlourForm.email} onChange={(e) => setParlourForm({ ...parlourForm, email: e.target.value })} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Textarea rows={2} value={parlourForm.address} onChange={(e) => setParlourForm({ ...parlourForm, address: e.target.value })} placeholder="Physical address" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowParlourDialog(false)}>Cancel</Button>
            <Button onClick={() => saveParlourMutation.mutate(parlourForm)} disabled={!parlourForm.name.trim() || saveParlourMutation.isPending}>
              {saveParlourMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingParlour ? "Save Changes" : "Add Parlour"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ─── Personnel dialog ───────────────────────────────────── */}
      <Dialog open={showPersonnelDialog} onOpenChange={setShowPersonnelDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editingPersonnel ? "Edit Contact" : "Add Contact"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={personnelForm.name} onChange={(e) => setPersonnelForm({ ...personnelForm, name: e.target.value })} placeholder="Full name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Role / Title</Label>
                <Input value={personnelForm.role} onChange={(e) => setPersonnelForm({ ...personnelForm, role: e.target.value })} placeholder="e.g. Director" />
              </div>
              <div>
                <Label className="text-xs">Phone</Label>
                <Input value={personnelForm.phone} onChange={(e) => setPersonnelForm({ ...personnelForm, phone: e.target.value })} placeholder="+263..." />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input type="email" value={personnelForm.email} onChange={(e) => setPersonnelForm({ ...personnelForm, email: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPersonnelDialog(false)}>Cancel</Button>
            <Button onClick={() => savePersonnelMutation.mutate(personnelForm)} disabled={!personnelForm.name.trim() || savePersonnelMutation.isPending}>
              {savePersonnelMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingPersonnel ? "Save Changes" : "Add Contact"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ServiceRateFormDialog
        open={showRateDialog}
        onOpenChange={setShowRateDialog}
        rate={editingRate}
        onSubmit={(data) => saveServiceRateMutation.mutate(data)}
        isPending={saveServiceRateMutation.isPending}
      />

      <Dialog open={showCemeteryDialog} onOpenChange={setShowCemeteryDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingCemetery ? "Edit Cemetery" : "Add Cemetery"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={cemeteryForm.name} onChange={(e) => setCemeteryForm({ ...cemeteryForm, name: e.target.value })} placeholder="Cemetery name" />
            </div>
            <div>
              <Label className="text-xs">Address</Label>
              <Textarea rows={2} value={cemeteryForm.address} onChange={(e) => setCemeteryForm({ ...cemeteryForm, address: e.target.value })} placeholder="Physical address" />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={cemeteryForm.notes} onChange={(e) => setCemeteryForm({ ...cemeteryForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCemeteryDialog(false)}>Cancel</Button>
            <Button onClick={() => saveCemeteryMutation.mutate(cemeteryForm)} disabled={!cemeteryForm.name.trim() || saveCemeteryMutation.isPending}>
              {saveCemeteryMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingCemetery ? "Save Changes" : "Add Cemetery"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEquipmentDialog} onOpenChange={setShowEquipmentDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editingEquipment ? "Edit Equipment" : "Add Equipment"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Name *</Label>
              <Input value={equipmentForm.name} onChange={(e) => setEquipmentForm({ ...equipmentForm, name: e.target.value })} placeholder="e.g. Tent #1" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={equipmentForm.equipmentType} onValueChange={(v) => setEquipmentForm({ ...equipmentForm, equipmentType: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="tent">Tent</SelectItem>
                    <SelectItem value="lowering_device">Lowering Device</SelectItem>
                    <SelectItem value="coffin_stand">Coffin Stand</SelectItem>
                    <SelectItem value="pa_system">PA System</SelectItem>
                    <SelectItem value="carpet">Carpet</SelectItem>
                    <SelectItem value="chairs">Chairs</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editingEquipment && (
                <div>
                  <Label className="text-xs">Status</Label>
                  <Select value={equipmentForm.status} onValueChange={(v) => setEquipmentForm({ ...equipmentForm, status: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="available">Available</SelectItem>
                      <SelectItem value="in_use">In Use</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={equipmentForm.notes} onChange={(e) => setEquipmentForm({ ...equipmentForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEquipmentDialog(false)}>Cancel</Button>
            <Button onClick={() => saveEquipmentMutation.mutate(equipmentForm)} disabled={!equipmentForm.name.trim() || saveEquipmentMutation.isPending}>
              {saveEquipmentMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editingEquipment ? "Save Changes" : "Add Equipment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddServiceChargeDialog
        open={showAddServiceCharge}
        onOpenChange={setShowAddServiceCharge}
        rates={serviceRates.filter((r: any) => r.isActive && r.clientType === (linkedMortuaryIntake?.partnerParlourId ? "partner_parlour" : "direct_client"))}
        mortuaryIntakeId={linkedMortuaryIntake?.id}
        onSubmit={(data) => addServiceChargeMutation.mutate(data)}
        isPending={addServiceChargeMutation.isPending}
      />

      <CaseFormDialog
        open={showCreateCase}
        onOpenChange={setShowCreateCase}
        title="New Funeral Case"
        vehicles={fleetVehicles}
        users={users}
        otherCases={funeralCases}
        onSubmit={(data) => createCaseMutation.mutate(data)}
        isPending={createCaseMutation.isPending}
        branches={branches}
        defaultBranchId={defaultBranchId}
        countryFlagSettings={countryFlagSettings}
      />

      {selectedCase && (
        <CaseFormDialog
          open={showEditCase}
          onOpenChange={setShowEditCase}
          title="Edit Case"
          vehicles={fleetVehicles}
          users={users}
          initial={selectedCase}
          otherCases={funeralCases}
          onSubmit={(data) => updateCaseMutation.mutate({ id: selectedCase.id, data })}
          isPending={updateCaseMutation.isPending}
          branches={branches}
          defaultBranchId={defaultBranchId}
          countryFlagSettings={countryFlagSettings}
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
      {selectedVehicle && (
        <EditVehicleDialog
          open={showEditVehicle}
          onOpenChange={(v) => { setShowEditVehicle(v); if (!v) setSelectedVehicle(null); }}
          vehicle={selectedVehicle}
          onSubmit={(data) => updateVehicleMutation.mutate({ id: selectedVehicle.id, data })}
          isPending={updateVehicleMutation.isPending}
        />
      )}

      {/* Record cash-service payment */}
      <Dialog open={showPaymentDialog} onOpenChange={(open) => { setShowPaymentDialog(open); if (open) setPaymentIdempotencyKey(crypto.randomUUID()); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            {caseQuotation && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Against <span className="font-mono font-semibold text-foreground">{caseQuotation.quotationNumber}</span>
                {" · "}{caseQuotation.currency} {Number(caseQuotation.grandTotal || caseQuotation.total || 0).toFixed(2)}
              </p>
            )}
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount *</Label>
                <Input type="number" step="0.01" min="0" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} data-testid="input-payment-amount" />
              </div>
              <div>
                <Label className="text-xs">Currency</Label>
                <Select value={paymentForm.currency} onValueChange={(v) => setPaymentForm({ ...paymentForm, currency: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZIG">ZiG</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Payment method</Label>
              <Select value={paymentForm.paymentChannel} onValueChange={(v) => setPaymentForm({ ...paymentForm, paymentChannel: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="paynow_ecocash">EcoCash</SelectItem>
                  <SelectItem value="paynow_card">Card</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {!paymentForm.amount || parseFloat(paymentForm.amount) <= 0 ? (
            <p className="text-xs text-amber-600" data-testid="text-payment-hint">To continue, provide: an amount greater than zero.</p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
            <Button onClick={() => addServiceReceiptMutation.mutate(paymentForm)} disabled={addServiceReceiptMutation.isPending || !paymentForm.amount || parseFloat(paymentForm.amount) <= 0} data-testid="button-submit-payment">
              {addServiceReceiptMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Record
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Driver Checklist */}
      {selectedCase && (
        <DriverChecklistDialog
          open={showDriverChecklist}
          onOpenChange={setShowDriverChecklist}
          funeralCase={selectedCase}
          existing={driverChecklist}
          users={users}
          onSubmit={(data) => upsertDriverChecklistMutation.mutate(data)}
          isPending={upsertDriverChecklistMutation.isPending}
        />
      )}

      {/* Quotation builder — uses same full form as /quotations page */}
      {showQuotationDialog && (
        <QuoteDialog
          open={showQuotationDialog}
          onClose={() => setShowQuotationDialog(false)}
          quoteId={caseQuotation?.id}
          initialData={caseQuotation ? {
            informantFullNames: caseQuotation.informantFullNames || "",
            informantPhone: caseQuotation.informantPhone || "",
            informantAddress: caseQuotation.informantAddress || "",
            deceasedName: caseQuotation.deceasedName || "",
            deceasedAge: caseQuotation.deceasedAge != null ? String(caseQuotation.deceasedAge) : "",
            deceasedSex: caseQuotation.deceasedSex || "",
            casketType: caseQuotation.casketType || "",
            quotationDate: caseQuotation.quotationDate ? caseQuotation.quotationDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
            currency: caseQuotation.currency || "USD",
            paymentType: caseQuotation.paymentType || "full",
            vatRate: caseQuotation.vatRate != null ? String(caseQuotation.vatRate) : "0",
            discountAmount: caseQuotation.discountAmount != null ? String(caseQuotation.discountAmount) : "0",
            notes: caseQuotation.notes || "",
          } : (selectedCase ? {
            // No quotation exists yet for this case — pre-fill from the funeral case's own
            // informant/deceased details instead of opening a blank form.
            informantFullNames: selectedCase.informantName || "",
            informantPhone: selectedCase.informantPhone || "",
            deceasedName: selectedCase.deceasedName || "",
            deceasedAge: ageFromDob(selectedCase.deceasedDob),
            deceasedSex: (selectedCase.deceasedGender || "").toLowerCase(),
          } : undefined)}
          initialItems={caseQuotation?.items?.length
            ? caseQuotation.items.map((i: any) => ({ description: i.description, qty: String(i.quantity ?? "1"), unitPrice: String(i.unitPrice ?? ""), priceBookItemId: i.priceBookItemId ?? null }))
            : undefined}
          onSuccess={() => queryClient.invalidateQueries({ queryKey: [`/api/funeral-cases/${selectedCaseId}/quotation`] })}
        />
      )}
    </StaffLayout>
  );
}

// ─── Case Detail View ──────────────────────────────────────────────────────

function CaseDetailView({
  funeralCase: fc, tasks, tasksLoading, vehicles, users,
  onBack, onEdit, onAddTask, onToggleTask, onUpdateStatus, onExport,
  driverChecklist, linkedMortuaryIntake, onOpenDriverChecklist,
  quotation, receipts, onRecordPayment, onEditQuotation,
  vehicleTrips, onStartTrip, onEndTrip, profitLoss,
  serviceCharges, onAddServiceCharge, onPayServiceCharge, onDeleteServiceCharge,
  countryFlagSettings,
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
  driverChecklist?: any;
  linkedMortuaryIntake?: any;
  onOpenDriverChecklist?: () => void;
  quotation?: any;
  receipts?: any[];
  onRecordPayment?: () => void;
  onEditQuotation?: () => void;
  vehicleTrips?: any[];
  onStartTrip?: (data: Record<string, any>) => void;
  onEndTrip?: (tripId: string, data: Record<string, any>) => void;
  profitLoss?: any;
  serviceCharges?: any[];
  onAddServiceCharge?: () => void;
  onPayServiceCharge?: (id: string, paidBy: string) => void;
  onDeleteServiceCharge?: (id: string) => void;
  countryFlagSettings?: CountryFlagSettings;
}) {
  const completed = tasks.filter((t) => t.status === "completed").length;
  const [payingChargeId, setPayingChargeId] = useState<string | null>(null);
  const [payingChargeBy, setPayingChargeBy] = useState("");
  const [startTripFor, setStartTripFor] = useState<{ role: string; vehicleId: string; driverId?: string | null } | null>(null);
  const [endTripFor, setEndTripFor] = useState<any>(null);
  const [tripOdometer, setTripOdometer] = useState("");
  const openTripsForCase = (vehicleTrips || []).filter((t: any) => t.endOdometer == null);

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
        {(fc as any).isCrossBorderFlag && countryFlagSettings?.isEnabled && (
          <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-700 border-blue-200" data-testid="badge-case-country-flag">
            {countryFlagSettings.flagLabel}
          </Badge>
        )}
        {fc.claimId && (
          <Link
            href={`/staff/claims?openClaim=${fc.claimId}`}
            className="text-xs text-primary hover:underline"
            data-testid="link-view-claim"
          >
            View claim →
          </Link>
        )}
        <div className="ml-auto flex gap-2 flex-wrap">
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onEdit}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onExport(false)}><Share2 className="h-3.5 w-3.5" /> Share</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onExport(true)}><FileDown className="h-3.5 w-3.5" /> Download PDF</Button>
          <a href={`${getApiBase()}/api/funeral-cases/${fc.id}/worksheet-pdf?download=1`} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Worksheet</Button>
          </a>
          <a href={`${getApiBase()}/api/funeral-cases/${fc.id}/tasks-pdf?download=1`} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Task Sheet</Button>
          </a>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenDriverChecklist}><FileDown className="h-3.5 w-3.5" /> Driver Checklist</Button>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Deceased */}
        <CardSection title="Deceased" icon={Box}>
          <div className="space-y-0.5">
            <DetailRow label="Full name" value={fc.deceasedName} />
            <DetailRow label="Date of birth" value={fc.deceasedDob} />
            <DetailRow label="Gender" value={fc.deceasedGender ? fc.deceasedGender.charAt(0).toUpperCase() + fc.deceasedGender.slice(1) : null} />
            <DetailRow label="National ID" value={fc.deceasedNationalId} />
            {fc.serviceType === "claim" && <DetailRow label="Relationship to policyholder" value={fc.deceasedRelationship} />}
            <DetailRow label="Date of death" value={fc.dateOfDeath} />
            <DetailRow label="Cause of death" value={fc.causeOfDeath} />
            <DetailRow label="Place of death" value={fc.placeOfDeath} />
            {(fc as any).bodyIdentifierName && (
              <DetailRow label="Body identified by" value={`${(fc as any).bodyIdentifierName}${(fc as any).bodyIdentifierIdNumber ? ` · ${(fc as any).bodyIdentifierIdNumber}` : ""}`} />
            )}
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

        {/* Service details + timeline merged */}
        <CardSection title="Service Details" icon={CheckCircle2}>
          <div className="space-y-0.5">
            <DetailRow label="Service type" value={fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : undefined} />
            <DetailRow label="Date of burial" value={fc.funeralDate} />
            <DetailRow label="Place of burial" value={fc.funeralLocation} />
          </div>
          {((fc as any).bodyWashTime || (fc as any).burialDepartureTime || (fc as any).memorialServiceStart) && (
            <>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-4 mb-1.5">Timeline</p>
              <div className="space-y-0.5">
                <DetailRow label="Body wash" value={(fc as any).bodyWashTime ? new Date((fc as any).bodyWashTime).toLocaleString("en-ZA", { timeZone: "Africa/Harare" }) : undefined} />
                <DetailRow label="Departure for burial" value={(fc as any).burialDepartureTime ? new Date((fc as any).burialDepartureTime).toLocaleString("en-ZA", { timeZone: "Africa/Harare" }) : undefined} />
                <DetailRow label="Memorial start" value={(fc as any).memorialServiceStart ? new Date((fc as any).memorialServiceStart).toLocaleString("en-ZA", { timeZone: "Africa/Harare" }) : undefined} />
                <DetailRow label="Memorial end" value={(fc as any).memorialServiceEnd ? new Date((fc as any).memorialServiceEnd).toLocaleString("en-ZA", { timeZone: "Africa/Harare" }) : undefined} />
              </div>
            </>
          )}
        </CardSection>

        {/* Logistics — removal + burial merged into one card */}
        <CardSection title="Logistics" icon={Truck}>
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Body Removal</p>
              <div className="space-y-0.5">
                <DetailRow label="Collection point" value={fc.removalLocation} />
                <DetailRow label="Vehicle" value={vehicleLabel(fc.removalVehicleId)} />
                <DetailRow label="Driver" value={userLabel(fc.removalDriverId)} />
              </div>
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Burial</p>
              <div className="space-y-0.5">
                <DetailRow label="Vehicle" value={vehicleLabel(fc.burialVehicleId)} />
                <DetailRow label="Driver" value={userLabel(fc.burialDriverId)} />
              </div>
            </div>
          </div>
        </CardSection>

        {/* Attending agent */}
        <CardSection title="Attending Agent" icon={User}>
          <div className="space-y-0.5">
            <DetailRow label="Name" value={userLabel(fc.attendingAgentId)} />
            <DetailRow label="Gender" value={userGender(fc.attendingAgentId)} />
          </div>
        </CardSection>

        {/* Vehicle trips & mileage — one trip log per vehicle (removal + burial). Also shown
            when there are no vehicles currently assigned but a trip log still exists from
            before a reassignment, so it stays visible and closeable. */}
        {(fc.removalVehicleId || fc.burialVehicleId || (vehicleTrips || []).length > 0) && (
          <CardSection title="Vehicle Trips & Mileage" icon={Car}>
            <div className="space-y-3">
              {[
                { role: "Removal", vehicleId: fc.removalVehicleId, driverId: fc.removalDriverId },
                { role: "Burial", vehicleId: fc.burialVehicleId, driverId: fc.burialDriverId },
              ].filter((v) => v.vehicleId).map((v) => {
                const trip = (vehicleTrips || []).find((t: any) => t.vehicleId === v.vehicleId);
                return (
                  <div key={v.role} className="border rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{v.role} Vehicle</p>
                        <p className="text-sm font-medium">{vehicleLabel(v.vehicleId)}</p>
                      </div>
                      {!trip && (
                        <Button size="sm" variant="outline" onClick={() => { setStartTripFor({ role: v.role, vehicleId: v.vehicleId as string, driverId: v.driverId }); setTripOdometer(""); }} data-testid={`button-start-trip-${v.role.toLowerCase()}`}>
                          Start Trip
                        </Button>
                      )}
                      {trip && trip.endOdometer == null && (
                        <Button size="sm" onClick={() => { setEndTripFor(trip); setTripOdometer(""); }} data-testid={`button-end-trip-${v.role.toLowerCase()}`}>
                          End Trip
                        </Button>
                      )}
                    </div>
                    {trip && (
                      <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                        <div>Start odometer: {trip.startOdometer} km</div>
                        {trip.endOdometer != null ? (
                          <>
                            <div>End odometer: {trip.endOdometer} km</div>
                            <div className="font-medium text-foreground">Distance: {trip.distanceKm} km</div>
                          </>
                        ) : (
                          <div className="text-amber-600 font-medium">Trip open — closing mileage not yet recorded</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {/* Trips left over from a vehicle that was later swapped off this case — still
                  shown (and still closeable) so a reassignment can never leave an invisible
                  open trip permanently blocking case completion. */}
              {(vehicleTrips || [])
                .filter((t: any) => t.vehicleId !== fc.removalVehicleId && t.vehicleId !== fc.burialVehicleId)
                .map((trip: any) => (
                  <div key={trip.id} className="border rounded-lg p-3 border-amber-300/50">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reassigned Vehicle (no longer on this case)</p>
                        <p className="text-sm font-medium">{vehicleLabel(trip.vehicleId)}</p>
                      </div>
                      {trip.endOdometer == null && (
                        <Button size="sm" onClick={() => { setEndTripFor(trip); setTripOdometer(""); }} data-testid={`button-end-trip-orphaned-${trip.id}`}>
                          End Trip
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 text-xs text-muted-foreground space-y-0.5">
                      <div>Start odometer: {trip.startOdometer} km</div>
                      {trip.endOdometer != null ? (
                        <>
                          <div>End odometer: {trip.endOdometer} km</div>
                          <div className="font-medium text-foreground">Distance: {trip.distanceKm} km</div>
                        </>
                      ) : (
                        <div className="text-amber-600 font-medium">Trip open — closing mileage not yet recorded</div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </CardSection>
        )}

        {/* Status management */}
        <CardSection title="Case Status" icon={CheckCircle2}>
          <StatusChanger
            current={fc.status}
            onUpdateStatus={onUpdateStatus}
            blockCompletionReason={openTripsForCase.length > 0
              ? `Close all open vehicle trips before completing this case (${openTripsForCase.length} still open — see Vehicle Trips & Mileage above).`
              : null}
          />
        </CardSection>

        {/* Start trip dialog */}
        <Dialog open={!!startTripFor} onOpenChange={(open) => !open && setStartTripFor(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>Start {startTripFor?.role} Trip</DialogTitle>
              <DialogDescription>Record the odometer reading before this vehicle departs.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label className="text-xs">Start Odometer (km) *</Label>
              <Input type="number" min="0" value={tripOdometer} onChange={(e) => setTripOdometer(e.target.value)} placeholder="e.g. 45210" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStartTripFor(null)}>Cancel</Button>
              <Button
                disabled={!tripOdometer || Number(tripOdometer) < 0}
                onClick={() => {
                  if (!startTripFor) return;
                  onStartTrip?.({
                    vehicleId: startTripFor.vehicleId,
                    driverId: startTripFor.driverId || null,
                    purpose: startTripFor.role,
                    startOdometer: Number(tripOdometer),
                    timeDeparted: new Date().toISOString(),
                  });
                  setStartTripFor(null);
                }}
                data-testid="button-confirm-start-trip"
              >
                Start Trip
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* End trip dialog */}
        <Dialog open={!!endTripFor} onOpenChange={(open) => !open && setEndTripFor(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>End Trip</DialogTitle>
              <DialogDescription>
                Record the closing odometer reading. Start was {endTripFor?.startOdometer} km.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label className="text-xs">End Odometer (km) *</Label>
              <Input type="number" min={endTripFor?.startOdometer ?? 0} value={tripOdometer} onChange={(e) => setTripOdometer(e.target.value)} placeholder="e.g. 45260" />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEndTripFor(null)}>Cancel</Button>
              <Button
                disabled={!tripOdometer || Number(tripOdometer) < (endTripFor?.startOdometer ?? 0)}
                onClick={() => {
                  if (!endTripFor) return;
                  onEndTrip?.(endTripFor.id, {
                    endOdometer: Number(tripOdometer),
                    timeReturned: new Date().toISOString(),
                  });
                  setEndTripFor(null);
                }}
                data-testid="button-confirm-end-trip"
              >
                End Trip
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Linked mortuary intake */}
        {linkedMortuaryIntake && (
          <CardSection title="Mortuary Record" icon={Box}>
            <div className="space-y-0.5">
              <DetailRow label="Intake number" value={linkedMortuaryIntake.intakeNumber} />
              <DetailRow label="Status" value={linkedMortuaryIntake.status?.replace(/_/g, " ").toUpperCase()} />
              <DetailRow label="Received at" value={linkedMortuaryIntake.receivedAt ? new Date(linkedMortuaryIntake.receivedAt).toLocaleString("en-ZA") : undefined} />
            </div>
            <div className="flex gap-2 mt-3">
              <a href={`/api/mortuary-intakes/${linkedMortuaryIntake.id}/receipt-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Receipt PDF</Button>
              </a>
              {linkedMortuaryIntake.status === "dispatched" && (
                <a href={`/api/mortuary-intakes/${linkedMortuaryIntake.id}/dispatch-pdf?download=1`} target="_blank" rel="noopener noreferrer">
                  <Button size="sm" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Dispatch PDF</Button>
                </a>
              )}
            </div>
          </CardSection>
        )}

        {/* Service charges — ancillary billing (storage/wash/chapel/removal/tents/etc) */}
        <div className="md:col-span-2">
          <CardSection
            title="Service Charges"
            icon={DollarSign}
            description="Ancillary services billed on this case, computed from the rate card."
            headerRight={onAddServiceCharge ? (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={onAddServiceCharge} data-testid="button-add-service-charge">
                <Plus className="h-3.5 w-3.5" /> Add Service
              </Button>
            ) : undefined}
          >
            {!serviceCharges || serviceCharges.length === 0 ? (
              <EmptyState icon={DollarSign} title="No service charges yet" description="Add a service to start billing storage, chapel, removal, or funeral-day extras." className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Service</TableHead>
                        <TableHead>Qty / Distance</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-[140px]" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {serviceCharges.map((c: any) => (
                        <TableRow key={c.id} data-testid={`row-service-charge-${c.id}`}>
                          <TableCell className="font-medium text-sm">{c.name}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {c.distanceKm != null ? `${parseFloat(c.distanceKm).toFixed(1)} km` : (parseFloat(c.quantity) !== 1 ? `x${parseFloat(c.quantity)}` : "—")}
                          </TableCell>
                          <TableCell className="text-sm">{c.currency} {parseFloat(c.computedAmount).toFixed(2)}</TableCell>
                          <TableCell>
                            {c.status === "paid"
                              ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Paid</Badge>
                              : <Badge variant="outline" className="text-[10px] bg-red-50 text-red-700 border-red-200">Unpaid</Badge>}
                          </TableCell>
                          <TableCell className="text-right">
                            {c.status === "unpaid" && (
                              <div className="flex gap-1 justify-end">
                                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setPayingChargeId(c.id); setPayingChargeBy(""); }}>Record payment</Button>
                                {onDeleteServiceCharge && (
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" aria-label={`Delete ${c.name}`} onClick={() => onDeleteServiceCharge(c.id)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                )}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-sm text-muted-foreground mt-3">
                  Total: {serviceCharges[0]?.currency || "USD"} {serviceCharges.reduce((sum: number, c: any) => sum + parseFloat(c.computedAmount), 0).toFixed(2)}
                  {" · "}Outstanding: {serviceCharges.filter((c: any) => c.status === "unpaid").reduce((sum: number, c: any) => sum + parseFloat(c.computedAmount), 0).toFixed(2)}
                </p>
              </>
            )}
          </CardSection>
        </div>

        <Dialog open={!!payingChargeId} onOpenChange={(v) => { if (!v) setPayingChargeId(null); }}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
            <div>
              <Label className="text-xs">Received From (Name) *</Label>
              <Input value={payingChargeBy} onChange={(e) => setPayingChargeBy(e.target.value)} placeholder="Name of person who paid" />
            </div>
            {!payingChargeBy.trim() && (
              <p className="text-xs text-amber-600">To continue, provide: the name of who paid.</p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPayingChargeId(null)}>Cancel</Button>
              <Button
                disabled={!payingChargeBy.trim()}
                onClick={() => { if (payingChargeId && onPayServiceCharge) onPayServiceCharge(payingChargeId, payingChargeBy.trim()); setPayingChargeId(null); }}
              >
                Confirm
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Notes — full width */}
        {fc.notes && (
          <div className="md:col-span-2">
            <CardSection title="Notes" icon={Box}>
              <p className="text-sm">{fc.notes}</p>
            </CardSection>
          </div>
        )}
      </div>

      {/* Cash-service billing — quotation + payments received (income) */}
      <CardSection
        title="Cash Service Billing"
        description="Quote the family and capture payments received. Payments feed the income statement and daily cash-ups."
        icon={CheckCircle2}
        headerRight={(
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onEditQuotation} data-testid="button-edit-quotation"><Pencil className="h-3.5 w-3.5" /> Quotation</Button>
            <Button
              size="sm"
              className="gap-1.5"
              onClick={onRecordPayment}
              disabled={!quotation?.items?.length}
              title={!quotation?.items?.length ? "Add line items to the quotation before recording a payment" : undefined}
              data-testid="button-record-payment"
            ><Plus className="h-3.5 w-3.5" /> Record Payment</Button>
          </div>
        )}
      >
        {(() => {
          const cur = quotation?.currency || (receipts && receipts[0]?.currency) || "USD";
          const quoted = quotation ? Number(quotation.grandTotal || quotation.total || 0) : 0;
          const received = (receipts || []).filter((r: any) => r.status !== "voided").reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
          const outstanding = quoted - received;
          return (
            <div className="space-y-3">
              {quotation && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span className="font-mono font-semibold text-foreground">{quotation.quotationNumber}</span>
                  {quotation.conversionStatus === "converted" && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-700 border border-emerald-200">PAID IN FULL</span>
                  )}
                  {quotation.conversionStatus === "partial" && (
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-700 border border-amber-200">PARTIALLY PAID</span>
                  )}
                </div>
              )}
              <div className="grid grid-cols-3 gap-3">
                <div><p className="text-xs text-muted-foreground">Quoted</p><p className="text-lg font-bold tabular-nums">{cur} {quoted.toFixed(2)}</p></div>
                <div><p className="text-xs text-muted-foreground">Received</p><p className="text-lg font-bold tabular-nums text-emerald-600">{cur} {received.toFixed(2)}</p></div>
                <div><p className="text-xs text-muted-foreground">Outstanding</p><p className={`text-lg font-bold tabular-nums ${outstanding > 0 ? "text-amber-600" : ""}`}>{cur} {outstanding.toFixed(2)}</p></div>
              </div>
              {(receipts && receipts.length > 0) ? (
                <div className="space-y-1">
                  {receipts.map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between text-sm border-b border-border/40 py-1.5">
                      <span className="font-mono text-xs text-muted-foreground">{r.receiptNumber}</span>
                      <span className="capitalize text-xs">{String(r.paymentChannel || "").replace(/_/g, " ")}</span>
                      <span className="text-xs text-muted-foreground">{r.issuedAt ? new Date(r.issuedAt).toLocaleDateString() : ""}</span>
                      <span className="font-semibold tabular-nums">{r.currency} {Number(r.amount).toFixed(2)}</span>
                      <a href={`/api/service-receipts/${r.id}/pdf?download=1`} target="_blank" rel="noopener noreferrer" title="Print / download receipt">
                        <Button size="icon" variant="ghost" className="h-6 w-6" data-testid={`button-receipt-pdf-${r.id}`} aria-label="Print or download receipt">
                          <FileDown className="h-3.5 w-3.5" />
                        </Button>
                      </a>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
              )}
            </div>
          );
        })()}
      </CardSection>

      {/* Profit & loss — revenue actually collected vs. costs actually incurred */}
      {profitLoss && (
        <CardSection title="Profit & Loss" description="Cash collected vs. costs incurred, broken out by currency (not FX-converted)" icon={DollarSign}>
          {(() => {
            const currencies = Array.from(new Set([
              ...Object.keys(profitLoss.revenueByCurrency || {}),
              ...Object.keys(profitLoss.costByCurrency || {}),
            ]));
            if (currencies.length === 0) {
              return <p className="text-sm text-muted-foreground">No revenue or costs recorded against this case yet.</p>;
            }
            return (
              <div className="space-y-3">
                {currencies.map((cur) => {
                  const revenue = profitLoss.revenueByCurrency?.[cur] || 0;
                  const cost = profitLoss.costByCurrency?.[cur] || 0;
                  const profit = profitLoss.profitByCurrency?.[cur] ?? (revenue - cost);
                  return (
                    <div key={cur} className="grid grid-cols-3 gap-3 border-b border-border/40 pb-3 last:border-0 last:pb-0">
                      <div>
                        <p className="text-xs text-muted-foreground">Revenue ({cur})</p>
                        <p className="text-lg font-bold tabular-nums text-emerald-600">{cur} {revenue.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Costs ({cur})</p>
                        <p className="text-lg font-bold tabular-nums text-amber-600">{cur} {cost.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">{profit >= 0 ? "Profit" : "Loss"} ({cur})</p>
                        <p className={`text-lg font-bold tabular-nums ${profit >= 0 ? "text-emerald-600" : "text-destructive"}`}>{cur} {profit.toFixed(2)}</p>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[10px] text-muted-foreground pt-1">
                  Costs include {profitLoss.costSheetCount || 0} cost sheet(s) and {profitLoss.directRequisitionCount || 0} requisition(s) raised directly against this case.
                </p>
              </div>
            );
          })()}
        </CardSection>
      )}

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

// ─── Status changer ───────────────────────────────────────────────────────────

function StatusChanger({ current, onUpdateStatus, blockCompletionReason }: { current: string; onUpdateStatus: (s: string) => void; blockCompletionReason?: string | null }) {
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const blocked = pendingStatus === "completed" && !!blockCompletionReason;
  return (
    <>
      <AlertDialog open={!!pendingStatus} onOpenChange={(open) => { if (!open) setPendingStatus(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm status change</AlertDialogTitle>
            <AlertDialogDescription>
              {blocked
                ? blockCompletionReason
                : pendingStatus === "cancelled"
                ? "Cancelling this case cannot be easily undone. Are you sure?"
                : `Mark this case as "${pendingStatus?.replace("_", " ")}"?`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={blocked} onClick={() => { if (pendingStatus && !blocked) { onUpdateStatus(pendingStatus); setPendingStatus(null); } }}>Confirm</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <div className="flex gap-2 flex-wrap">
        {["open", "in_progress", "completed", "cancelled"].map((s) => (
          <Button key={s} size="sm" variant={current === s ? "default" : "outline"} onClick={() => setPendingStatus(s)} disabled={current === s} data-testid={`button-status-${s}`}>
            {s.replace("_", " ").toUpperCase()}
          </Button>
        ))}
      </div>
    </>
  );
}

// ─── Service Rate Form Dialog (create + edit) ────────────────────────────────

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function ServiceRateFormDialog({ open, onOpenChange, rate, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  rate: any | null;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    name: "", clientType: "partner_parlour", category: "mortuary", pricingType: "flat",
    baseAmount: "", perKmRate: "", tierGroupSize: "3", tierGroupPrice: "", isActive: true,
  });
  useEffect(() => {
    if (rate) {
      setForm({
        name: rate.name || "",
        clientType: rate.clientType || "partner_parlour",
        category: rate.category || "mortuary",
        pricingType: rate.pricingType || "flat",
        baseAmount: rate.baseAmount != null ? String(rate.baseAmount) : "",
        perKmRate: rate.perKmRate != null ? String(rate.perKmRate) : "",
        tierGroupSize: rate.tierGroupSize != null ? String(rate.tierGroupSize) : "3",
        tierGroupPrice: rate.tierGroupPrice != null ? String(rate.tierGroupPrice) : "",
        isActive: rate.isActive !== false,
      });
    } else {
      setForm({ name: "", clientType: "partner_parlour", category: "mortuary", pricingType: "flat", baseAmount: "", perKmRate: "", tierGroupSize: "3", tierGroupPrice: "", isActive: true });
    }
  }, [rate, open]);

  const handleSubmit = () => {
    const data: Record<string, any> = {
      name: form.name.trim(),
      clientType: form.clientType,
      category: form.category,
      pricingType: form.pricingType,
      baseAmount: form.pricingType === "tiered_group" ? "0" : (parseFloat(form.baseAmount) || 0).toFixed(2),
      currency: "USD",
      isActive: form.isActive,
    };
    if (!rate) data.serviceKey = slugify(form.name);
    if (form.pricingType === "per_km") data.perKmRate = (parseFloat(form.perKmRate) || 0).toFixed(4);
    if (form.pricingType === "tiered_group") {
      data.tierGroupSize = parseInt(form.tierGroupSize, 10) || 1;
      data.tierGroupPrice = (parseFloat(form.tierGroupPrice) || 0).toFixed(2);
    }
    onSubmit(data);
  };

  const valid = form.name.trim().length > 0
    && (form.pricingType !== "flat" || parseFloat(form.baseAmount) >= 0)
    && (form.pricingType !== "per_km" || (parseFloat(form.baseAmount) >= 0 && parseFloat(form.perKmRate) >= 0))
    && (form.pricingType !== "tiered_group" || (parseInt(form.tierGroupSize, 10) > 0 && parseFloat(form.tierGroupPrice) >= 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{rate ? "Edit Service Rate" : "Add Service Rate"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Service Name *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Body Wash" disabled={!!rate} />
            {!rate && <p className="text-[10px] text-muted-foreground mt-1">Key: {form.name ? slugify(form.name) : "—"}</p>}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Client Type *</Label>
              <Select value={form.clientType} onValueChange={(v) => setForm({ ...form, clientType: v })} disabled={!!rate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partner_parlour">Partner Parlour</SelectItem>
                  <SelectItem value="direct_client">Direct Client</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="mortuary">Mortuary</SelectItem>
                  <SelectItem value="event_services">Event Services</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">Pricing Type *</Label>
            <Select value={form.pricingType} onValueChange={(v) => setForm({ ...form, pricingType: v })} disabled={!!rate}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat rate</SelectItem>
                <SelectItem value="per_km">Base fee + per km</SelectItem>
                <SelectItem value="tiered_group">Per group of N units</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {form.pricingType === "flat" && (
            <div>
              <Label className="text-xs">Amount (USD) *</Label>
              <Input type="number" step="0.01" min="0" value={form.baseAmount} onChange={(e) => setForm({ ...form, baseAmount: e.target.value })} placeholder="e.g. 10.00" />
            </div>
          )}
          {form.pricingType === "per_km" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Base Fee (USD) *</Label>
                <Input type="number" step="0.01" min="0" value={form.baseAmount} onChange={(e) => setForm({ ...form, baseAmount: e.target.value })} placeholder="e.g. 40.00" />
              </div>
              <div>
                <Label className="text-xs">Rate per km (USD) *</Label>
                <Input type="number" step="0.01" min="0" value={form.perKmRate} onChange={(e) => setForm({ ...form, perKmRate: e.target.value })} placeholder="e.g. 1.50" />
              </div>
            </div>
          )}
          {form.pricingType === "tiered_group" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Group Size *</Label>
                <Input type="number" step="1" min="1" value={form.tierGroupSize} onChange={(e) => setForm({ ...form, tierGroupSize: e.target.value })} placeholder="e.g. 3" />
              </div>
              <div>
                <Label className="text-xs">Price per Group (USD) *</Label>
                <Input type="number" step="0.01" min="0" value={form.tierGroupPrice} onChange={(e) => setForm({ ...form, tierGroupPrice: e.target.value })} placeholder="e.g. 1.00" />
              </div>
            </div>
          )}
          {rate && (
            <div className="flex items-center gap-2">
              <Checkbox id="rate-active" checked={form.isActive} onCheckedChange={(v) => setForm({ ...form, isActive: v === true })} />
              <Label htmlFor="rate-active" className="text-sm font-normal cursor-pointer">Active (available to add to cases)</Label>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!valid || isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {rate ? "Save Changes" : "Add Rate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Service Charge Dialog ───────────────────────────────────────────────

function AddServiceChargeDialog({ open, onOpenChange, rates, mortuaryIntakeId, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  rates: any[]; mortuaryIntakeId?: string;
  onSubmit: (data: Record<string, any>) => void; isPending: boolean;
}) {
  const [rateId, setRateId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [distanceKm, setDistanceKm] = useState("");
  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (open) { setRateId(""); setQuantity("1"); setDistanceKm(""); setNotes(""); }
  }, [open]);

  const rate = rates.find((r: any) => r.id === rateId);
  const preview = rate
    ? computeServiceCharge(rate, { quantity: parseFloat(quantity) || 1, distanceKm: parseFloat(distanceKm) || 0 })
    : null;

  const valid = !!rate
    && parseFloat(quantity) > 0
    && (rate.pricingType !== "per_km" || (distanceKm !== "" && parseFloat(distanceKm) >= 0));

  const handleSubmit = () => {
    if (!rate) return;
    onSubmit({
      serviceRateId: rate.id,
      quantity: rate.pricingType === "tiered_group" ? quantity : (rate.pricingType === "flat" ? quantity : "1"),
      distanceKm: rate.pricingType === "per_km" ? distanceKm : undefined,
      mortuaryIntakeId: mortuaryIntakeId || undefined,
      notes: notes.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Service Charge</DialogTitle>
          <DialogDescription>Pick a service from the rate card — the amount is computed automatically.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Service *</Label>
            <Select value={rateId} onValueChange={setRateId}>
              <SelectTrigger data-testid="select-service-rate"><SelectValue placeholder="Choose a service…" /></SelectTrigger>
              <SelectContent>
                {rates.map((r: any) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {rates.length === 0 && <p className="text-[10px] text-muted-foreground mt-1">No active rates for this client type — add one in the Service Rates tab.</p>}
          </div>
          {rate?.pricingType === "tiered_group" && (
            <div>
              <Label className="text-xs">Quantity (e.g. number of chairs) *</Label>
              <Input type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          )}
          {rate?.pricingType === "flat" && (
            <div>
              <Label className="text-xs">Quantity</Label>
              <Input type="number" step="1" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            </div>
          )}
          {rate?.pricingType === "per_km" && (
            <div>
              <Label className="text-xs">Distance (km) *</Label>
              <Input type="number" step="0.1" min="0" value={distanceKm} onChange={(e) => setDistanceKm(e.target.value)} placeholder="0 for local" data-testid="input-distance-km" />
            </div>
          )}
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
          </div>
          {preview !== null && (
            <p className="text-sm rounded-md bg-muted/50 px-3 py-2">
              Charge: <strong>{rate.currency} {preview.toFixed(2)}</strong>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!valid || isPending} data-testid="button-submit-service-charge">
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Add Charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Case Form Dialog (create + edit) ────────────────────────────────────────

/**
 * Module-scoped so its component identity is stable across renders. Defining this
 * inside CaseFormDialog made React remount every wrapped <Input> on each keystroke,
 * which stole focus after every letter typed.
 */
function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}{required && " *"}</Label>
      {children}
    </div>
  );
}

function CaseFormDialog({
  open, onOpenChange, title, vehicles, users, initial, onSubmit, isPending, otherCases, branches, defaultBranchId, countryFlagSettings,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  vehicles: FleetVehicle[];
  users: any[];
  initial?: FuneralCase | null;
  onSubmit: (data: Partial<CaseForm>) => void;
  isPending: boolean;
  otherCases?: FuneralCase[];
  branches: any[];
  defaultBranchId: string;
  countryFlagSettings?: CountryFlagSettings;
}) {
  const [form, setForm] = useState<CaseForm>(() => {
    if (initial) {
      return {
        deceasedName: initial.deceasedName ?? "",
        deceasedDob: initial.deceasedDob ?? "",
        deceasedGender: initial.deceasedGender ?? "",
        deceasedNationalId: initial.deceasedNationalId ?? "",
        deceasedRelationship: initial.deceasedRelationship ?? "",
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
        overnightUsed: (initial as any).overnightUsed ?? false,
        overnightDate: (initial as any).overnightDate ?? "",
        overnightLocation: (initial as any).overnightLocation ?? "",
        overnightVehicleId: (initial as any).overnightVehicleId ?? "",
        overnightDriverId: (initial as any).overnightDriverId ?? "",
        cemeteryId: (initial as any).cemeteryId ?? "",
        attendingAgentId: initial.attendingAgentId ?? "",
        bodyWashTime: (initial as any).bodyWashTime ? utcToDatetimeLocal((initial as any).bodyWashTime) : "",
        burialDepartureTime: (initial as any).burialDepartureTime ? utcToDatetimeLocal((initial as any).burialDepartureTime) : "",
        memorialServiceStart: (initial as any).memorialServiceStart ? utcToDatetimeLocal((initial as any).memorialServiceStart) : "",
        memorialServiceEnd: (initial as any).memorialServiceEnd ? utcToDatetimeLocal((initial as any).memorialServiceEnd) : "",
        bodyIdentifierName: (initial as any).bodyIdentifierName ?? "",
        bodyIdentifierIdNumber: (initial as any).bodyIdentifierIdNumber ?? "",
        notes: initial.notes ?? "",
        policyId: initial.policyId ?? "",
        claimId: initial.claimId ?? "",
        quotationId: "",
        branchId: (initial as any).branchId ?? "",
        isCrossBorderFlag: (initial as any).isCrossBorderFlag ?? false,
        crossBorderReference: (initial as any).crossBorderReference ?? "",
      };
    }
    return { ...BLANK_FORM, branchId: defaultBranchId };
  });

  const { toast } = useToast();
  const set = (k: keyof CaseForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const setSel = (k: keyof CaseForm) => (v: string) =>
    setForm((f) => ({ ...f, [k]: v === "__none__" ? "" : v }));

  // Branch list/head-office flag load async after this dialog mounts — backfill the default
  // once available rather than only at initial mount (create dialog only, never overwrite an edit).
  useEffect(() => {
    if (!initial && defaultBranchId) {
      setForm((f) => (f.branchId ? f : { ...f, branchId: defaultBranchId }));
    }
  }, [initial, defaultBranchId]);

  // Policy claim lookup state
  const [policySearch, setPolicySearch] = useState(initial?.policyId ? "linked" : "");
  const [policyLookupLoading, setPolicyLookupLoading] = useState(false);
  const [foundPolicy, setFoundPolicy] = useState<any>(null);
  const [policyMembers, setPolicyMembers] = useState<any[]>([]);
  const [policyLookupError, setPolicyLookupError] = useState("");
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const policySearchRef = useRef<HTMLInputElement>(null);

  const [quotSearch, setQuotSearch] = useState("");
  const [quotLookupLoading, setQuotLookupLoading] = useState(false);
  const [foundQuot, setFoundQuot] = useState<any>(null);
  const [quotLookupError, setQuotLookupError] = useState("");

  const lookupQuotation = async (search: string) => {
    if (!search.trim()) return;
    setQuotLookupLoading(true);
    setQuotLookupError("");
    setFoundQuot(null);
    try {
      const res = await fetch(`${getApiBase()}/api/quotations?q=${encodeURIComponent(search.trim())}&limit=5`, { credentials: "include" });
      const data = await res.json();
      const quotes: any[] = Array.isArray(data) ? data : [];
      const exact = quotes.find((q: any) => q.quotationNumber?.toLowerCase() === search.trim().toLowerCase()) || quotes[0];
      if (!exact) { setQuotLookupError("No quotation found with that number."); return; }
      if (exact.funeralCaseId) { setQuotLookupError("This quotation is already linked to another funeral case."); return; }
      setFoundQuot(exact);
      // Blanks-only auto-fill from the quote, mirroring the server's own quoteToCaseBlankFillPatch
      // (server/routes.ts) so the two never disagree — without this, "Deceased Full Name" stays
      // empty-but-required and blocks submission even though the name is shown right above it.
      const isBlank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      setForm((f) => ({
        ...f,
        quotationId: exact.id,
        deceasedName: isBlank(f.deceasedName) && !isBlank(exact.deceasedName) ? exact.deceasedName : f.deceasedName,
        deceasedGender: isBlank(f.deceasedGender) && !isBlank(exact.deceasedSex) ? String(exact.deceasedSex).toLowerCase() : f.deceasedGender,
        informantName: isBlank(f.informantName) && !isBlank(exact.informantFullNames) ? exact.informantFullNames : f.informantName,
        informantPhone: isBlank(f.informantPhone) && !isBlank(exact.informantPhone) ? exact.informantPhone : f.informantPhone,
      }));
    } catch {
      setQuotLookupError("Failed to look up quotation.");
    } finally {
      setQuotLookupLoading(false);
    }
  };

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
      // Blanks-only auto-fill of the informant from the policy's beneficiary — usually the same
      // person reporting the death, and already on file, so don't make staff retype it.
      const isBlank = (v: any) => v === null || v === undefined || (typeof v === "string" && v.trim() === "");
      const beneficiaryName = [exact.beneficiaryFirstName, exact.beneficiaryLastName].filter((v) => !isBlank(v)).join(" ").trim();
      setForm((f) => ({
        ...f,
        policyId: exact.id,
        informantName: isBlank(f.informantName) && beneficiaryName ? beneficiaryName : f.informantName,
        informantPhone: isBlank(f.informantPhone) && !isBlank(exact.beneficiaryPhone) ? exact.beneficiaryPhone : f.informantPhone,
      }));
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

  // Auto-fill empty time fields using the fixed 90-min service window:
  // body wash → +30min → memorial start → +30min → memorial end → +30min → burial departure
  // Only fills fields that are still empty so manual entries are never overwritten.
  const autoFillTimes = (field: keyof CaseForm, value: string) => {
    if (!value) { setForm((f) => ({ ...f, [field]: value })); return; }
    setForm((f) => {
      const next = { ...f, [field]: value };
      if (field === "bodyWashTime") {
        if (!next.memorialServiceStart) next.memorialServiceStart = shiftTime(value, STEP);
        if (!next.memorialServiceEnd)   next.memorialServiceEnd   = shiftTime(value, STEP * 2);
        if (!next.burialDepartureTime)  next.burialDepartureTime  = shiftTime(value, STEP * 3);
      }
      if (field === "memorialServiceStart") {
        if (!next.bodyWashTime)         next.bodyWashTime         = shiftTime(value, -STEP);
        if (!next.memorialServiceEnd)   next.memorialServiceEnd   = shiftTime(value, STEP);
        if (!next.burialDepartureTime)  next.burialDepartureTime  = shiftTime(value, STEP * 2);
      }
      if (field === "memorialServiceEnd") {
        if (!next.bodyWashTime)         next.bodyWashTime         = shiftTime(value, -STEP * 2);
        if (!next.memorialServiceStart) next.memorialServiceStart = shiftTime(value, -STEP);
        if (!next.burialDepartureTime)  next.burialDepartureTime  = shiftTime(value, STEP);
      }
      if (field === "burialDepartureTime") {
        if (!next.memorialServiceEnd)   next.memorialServiceEnd   = shiftTime(value, -STEP);
        if (!next.memorialServiceStart) next.memorialServiceStart = shiftTime(value, -STEP * 2);
        if (!next.bodyWashTime)         next.bodyWashTime         = shiftTime(value, -STEP * 3);
      }
      // Clash check after filling
      if (next.bodyWashTime && next.burialDepartureTime && otherCases?.length) {
        const clash = detectClash(next.bodyWashTime, next.burialDepartureTime, otherCases, initial?.id);
        if (clash) {
          setTimeout(() => toast({
            title: "Scheduling clash",
            description: `These times overlap with the service for ${clash}. Please choose a different time slot.`,
            variant: "destructive",
          }), 0);
        }
      }
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data: Partial<CaseForm> = {};
    (Object.keys(form) as (keyof CaseForm)[]).forEach((k) => {
      const v = form[k];
      // Convert datetime-local strings (local time) to UTC ISO before sending to server
      if (TIME_FIELDS.includes(k) && typeof v === "string" && v) {
        (data as any)[k] = datetimeLocalToUtc(v);
      } else if (typeof v === "boolean") {
        // `v || null` would coerce `false` to `null` — booleans must be sent as-is.
        (data as any)[k] = v;
      } else {
        (data as any)[k] = v || null;
      }
    });
    onSubmit(data);
  };

  // Auto-fill the deceased's identity from the selected covered member (claim cases).
  // The /api/policies/:id/members endpoint returns memberName/dateOfBirth/gender/
  // nationalId/relationship for each covered life.
  const selectMember = (memberId: string) => {
    const m = policyMembers.find((x: any) => String(x.id) === memberId);
    if (!m) return;
    setForm((f) => ({
      ...f,
      deceasedName: m.memberName || f.deceasedName,
      deceasedDob: m.dateOfBirth || "",
      deceasedGender: (m.gender || "").toLowerCase(),
      deceasedNationalId: m.nationalId || "",
      // "Policy Holder" members have no relationship-to-policyholder; leave blank for them.
      deceasedRelationship: m.relationship && m.relationship !== "Policy Holder" ? m.relationship : "",
    }));
  };

  const hasRole = (u: any, role: string) =>
    Array.isArray(u?.roles) && u.roles.some((r: any) => r?.name === role);

  const activeUsers = users.filter((u: any) => u.isActive !== false);
  const vehicleOptions: SearchableOption[] = vehicles.map((v) => ({
    value: v.id,
    label: `${v.registration}${v.make ? ` — ${v.make} ${v.model || ""}`.trim() : ""}`,
    hint: v.vehicleType || undefined,
  }));
  const { data: cemeteries = [] } = useQuery<any[]>({ queryKey: ["/api/cemeteries"] });
  const cemeteryOptions: SearchableOption[] = (cemeteries as any[]).map((c: any) => ({ value: c.id, label: c.name, hint: c.address || undefined }));
  // Drivers are staff explicitly assigned the "driver" role; agents are "agent"-role staff.
  const driverOptions: SearchableOption[] = activeUsers
    .filter((u: any) => hasRole(u, "driver"))
    .map((u: any) => ({ value: u.id, label: u.displayName || u.email, hint: u.email || undefined }));
  const agentOptions: SearchableOption[] = activeUsers
    .filter((u: any) => hasRole(u, "agent"))
    .map((u: any) => ({ value: u.id, label: u.displayName || u.email, hint: u.email || undefined }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Choose the service type. Cash service requires an existing quotation — create the quote first, then open this form. For a policy claim, look up the policy and pick the deceased member.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} noValidate className="space-y-4 pt-1">

          {/* Step 1 — service type drives the rest of the flow */}
          <div className="space-y-1.5">
            <Label className="text-xs">Service Type *</Label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { v: "cash", label: "Cash Service", hint: "Private / walk-in funeral" },
                { v: "claim", label: "Policy Claim", hint: "Against an existing policy" },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => {
                    setSel("serviceType")(opt.v);
                    if (opt.v !== "claim") {
                      setFoundPolicy(null); setPolicyMembers([]); setPolicySearch(""); setPolicyLookupError(""); setSelectedMemberId("");
                      setForm((f) => ({ ...f, policyId: "" }));
                    }
                    if (opt.v !== "cash") {
                      setFoundQuot(null); setQuotSearch(""); setQuotLookupError("");
                      setForm((f) => ({ ...f, quotationId: "" }));
                    }
                  }}
                  className={`rounded-md border p-3 text-left transition-colors ${form.serviceType === opt.v ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}
                  data-testid={`button-service-${opt.v}`}
                >
                  <p className="text-sm font-medium">{opt.label}</p>
                  <p className="text-[11px] text-muted-foreground">{opt.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Step 2 (cash only) — link an existing quotation */}
          {form.serviceType === "cash" && !initial && (
            <div className="border rounded-md p-3 space-y-3 bg-muted/20">
              <p className="text-xs font-semibold text-primary">Link a quotation to this cash service case. <span className="font-normal text-muted-foreground">(Required — create the quote first if it doesn't exist yet.)</span></p>
              <div className="flex gap-2">
                <Input
                  placeholder="Quotation number, e.g. QUO-000001"
                  value={quotSearch}
                  onChange={(e) => setQuotSearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupQuotation(quotSearch); } }}
                  className="flex-1"
                  data-testid="input-quotation-search"
                />
                <Button type="button" size="sm" onClick={() => lookupQuotation(quotSearch)} disabled={quotLookupLoading || !quotSearch.trim()}>
                  {quotLookupLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Find"}
                </Button>
              </div>
              {quotLookupError && <p className="text-xs text-destructive">{quotLookupError}</p>}
              {foundQuot && (
                <div className="text-xs border-t pt-2 space-y-0.5">
                  <p className="text-muted-foreground">Linked: <strong className="text-foreground">{foundQuot.quotationNumber}</strong> · {foundQuot.currency} {Number(foundQuot.grandTotal || foundQuot.total || 0).toFixed(2)} · {(foundQuot.items?.length || 0)} item(s)</p>
                  {foundQuot.deceasedName && <p>Deceased: <strong>{foundQuot.deceasedName}</strong></p>}
                </div>
              )}
              {!form.quotationId && (
                <p className="text-[11px] text-amber-600">Find and link a quotation to continue.</p>
              )}
            </div>
          )}

          {/* Step 2 (claim only) — find the policy, then pick the deceased covered member */}
          {form.serviceType === "claim" && (
            <div className="border rounded-md p-3 space-y-3 bg-muted/20">
              <p className="text-xs font-semibold text-primary">Find the policy, then select the deceased covered member.</p>
              <div className="flex gap-2">
                <Input
                  ref={policySearchRef}
                  placeholder="Policy number, e.g. FLK00123"
                  value={policySearch === "linked" ? (foundPolicy?.policyNumber || "") : policySearch}
                  onChange={(e) => setPolicySearch(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookupPolicy(policySearch); } }}
                  className="flex-1"
                  data-testid="input-policy-search"
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
                  {policyMembers.length > 0 ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Deceased Covered Member *</Label>
                      <Select
                        value={selectedMemberId || "__none__"}
                        onValueChange={(v) => {
                          if (v === "__none__") { setSelectedMemberId(""); return; }
                          setSelectedMemberId(v);
                          selectMember(v);
                        }}
                      >
                        <SelectTrigger data-testid="select-deceased-member"><SelectValue placeholder="Select covered member…" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Select member —</SelectItem>
                          {policyMembers.map((m: any) => {
                            const name = m.memberName || "Member";
                            const role = (m.role || "member").replace("_", " ");
                            return (
                              <SelectItem key={m.id} value={String(m.id)}>
                                {name} · {role}{m.age != null ? ` · ${m.age}y` : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground">Fills the deceased name, date of birth, gender, ID and relationship below.</p>
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">No covered members found on this policy.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Deceased name — always required; auto-filled for claims */}
          <Field label="Deceased Full Name" required>
            <Input value={form.deceasedName} onChange={set("deceasedName")} placeholder="Full name of deceased" required data-testid="input-deceased-name" />
          </Field>

          <Accordion type="multiple" defaultValue={["deceased"]} className="border rounded-md px-3">
            {/* Deceased details */}
            <AccordionItem value="deceased">
              <AccordionTrigger>Deceased Details</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Date of Birth">
                    <Input type="date" value={form.deceasedDob} onChange={set("deceasedDob")} data-testid="input-deceased-dob" />
                  </Field>
                  <Field label="Gender">
                    <Select value={form.deceasedGender || "__none__"} onValueChange={setSel("deceasedGender")}>
                      <SelectTrigger data-testid="select-deceased-gender"><SelectValue placeholder="Select…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not set —</SelectItem>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="National ID">
                    <Input value={form.deceasedNationalId} onChange={set("deceasedNationalId")} placeholder="e.g. 63-1234567A12" data-testid="input-deceased-national-id" />
                  </Field>
                  <Field label="Relationship to Policyholder">
                    <Input value={form.deceasedRelationship} onChange={set("deceasedRelationship")} placeholder="e.g. Spouse, Son" data-testid="input-deceased-relationship" />
                  </Field>
                  <Field label="Date of Death" required>
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
              </AccordionContent>
            </AccordionItem>

            {/* Informant */}
            <AccordionItem value="informant">
              <AccordionTrigger>Informant (Next of Kin)</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Informant Name" required>
                    <Input value={form.informantName} onChange={set("informantName")} placeholder="Next of kin name" />
                  </Field>
                  <Field label="Informant Phone">
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
              </AccordionContent>
            </AccordionItem>

            {/* Service & burial */}
            <AccordionItem value="service">
              <AccordionTrigger>Service &amp; Burial</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Date of Burial">
                    <Input type="date" value={form.funeralDate} onChange={set("funeralDate")} data-testid="input-funeral-date" />
                  </Field>
                  <div className="col-span-2">
                    <Field label="Cemetery">
                      <SearchableSelect options={cemeteryOptions} value={form.cemeteryId} onChange={(v) => {
                        const c = cemeteries.find((x: any) => x.id === v);
                        setForm((f) => ({ ...f, cemeteryId: v, funeralLocation: c ? c.name : f.funeralLocation }));
                      }} placeholder="Select a registered cemetery (optional)…" searchPlaceholder="Search cemeteries…" />
                    </Field>
                  </div>
                  <div className="col-span-2">
                    <Field label="Place of Burial">
                      <Input value={form.funeralLocation} onChange={set("funeralLocation")} placeholder="Cemetery or burial site" data-testid="input-funeral-location" />
                    </Field>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Service timing */}
            <AccordionItem value="timing">
              <AccordionTrigger>Service Timing</AccordionTrigger>
              <AccordionContent>
                <p className="text-xs text-muted-foreground mb-3">
                  Set any one time — the rest auto-fill. Each service is <strong>1 hr 30 min</strong> (body wash → memorial start → memorial end → burial departure, 30 min each). A 15-minute gap is required before the next family's service.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <Field label="Body Wash">
                    <Input type="datetime-local" value={form.bodyWashTime} onChange={(e) => autoFillTimes("bodyWashTime", e.target.value)} />
                  </Field>
                  <Field label="Memorial / Church Service Start">
                    <Input type="datetime-local" value={form.memorialServiceStart} onChange={(e) => autoFillTimes("memorialServiceStart", e.target.value)} />
                  </Field>
                  <Field label="Memorial / Church Service End">
                    <Input type="datetime-local" value={form.memorialServiceEnd} onChange={(e) => autoFillTimes("memorialServiceEnd", e.target.value)} />
                  </Field>
                  <Field label="Departure for Burial">
                    <Input type="datetime-local" value={form.burialDepartureTime} onChange={(e) => autoFillTimes("burialDepartureTime", e.target.value)} />
                  </Field>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Body identification */}
            <AccordionItem value="body-id">
              <AccordionTrigger>Body Identification</AccordionTrigger>
              <AccordionContent>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <Field label="Identifier Full Name">
                    <Input value={form.bodyIdentifierName} onChange={set("bodyIdentifierName")} placeholder="Person who identified the body" />
                  </Field>
                  <Field label="Identifier National ID">
                    <Input value={form.bodyIdentifierIdNumber} onChange={set("bodyIdentifierIdNumber")} placeholder="ID / Passport number" />
                  </Field>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Logistics — removal + burial + agent */}
            <AccordionItem value="logistics">
              <AccordionTrigger>Logistics &amp; Attending Agent</AccordionTrigger>
              <AccordionContent>
                <div className="space-y-4">
                  {driverOptions.length === 0 && (
                    <p className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-200 rounded-md px-2.5 py-1.5">
                      No staff have the <strong>Driver</strong> role yet. Assign it on the Users page to populate the driver dropdowns.
                    </p>
                  )}
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Body Removal</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <Field label="Removal Location">
                          <Input value={form.removalLocation} onChange={set("removalLocation")} placeholder="Where the body is being collected from" />
                        </Field>
                      </div>
                      <Field label="Removal Vehicle">
                        <SearchableSelect options={vehicleOptions} value={form.removalVehicleId} onChange={setSel("removalVehicleId")} placeholder="Select vehicle…" searchPlaceholder="Search by registration…" />
                      </Field>
                      <Field label="Removal Driver">
                        <SearchableSelect options={driverOptions} value={form.removalDriverId} onChange={setSel("removalDriverId")} placeholder="Select driver…" searchPlaceholder="Search by name…" emptyText="No staff have the Driver role yet." />
                      </Field>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Checkbox id="overnight-used" checked={form.overnightUsed}
                        onCheckedChange={(v) => setForm((f) => ({ ...f, overnightUsed: v === true }))} />
                      <Label htmlFor="overnight-used" className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer">
                        Body will overnight before burial
                      </Label>
                    </div>
                    {form.overnightUsed && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Field label="Overnight Date">
                          <Input type="date" value={form.overnightDate} onChange={set("overnightDate")} />
                        </Field>
                        <Field label="Overnight Location">
                          <Input value={form.overnightLocation} onChange={set("overnightLocation")} placeholder="Deceased's residence" />
                        </Field>
                        <Field label="Overnight Vehicle">
                          <SearchableSelect options={vehicleOptions} value={form.overnightVehicleId} onChange={setSel("overnightVehicleId")} placeholder="Select vehicle…" searchPlaceholder="Search by registration…" />
                        </Field>
                        <Field label="Overnight Driver">
                          <SearchableSelect options={driverOptions} value={form.overnightDriverId} onChange={setSel("overnightDriverId")} placeholder="Select driver…" searchPlaceholder="Search by name…" emptyText="No staff have the Driver role yet." />
                        </Field>
                        <AvailabilityWarning date={form.overnightDate} vehicleId={form.overnightVehicleId} driverId={form.overnightDriverId} excludeFuneralCaseId={initial?.id} />
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Burial Logistics</p>
                    <p className="text-xs text-muted-foreground mb-2">Can be the same or different vehicle/driver as removal.</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Field label="Burial Vehicle">
                        <SearchableSelect options={vehicleOptions} value={form.burialVehicleId} onChange={setSel("burialVehicleId")} placeholder="Select vehicle…" searchPlaceholder="Search by registration…" />
                      </Field>
                      <Field label="Burial Driver">
                        <SearchableSelect options={driverOptions} value={form.burialDriverId} onChange={setSel("burialDriverId")} placeholder="Select driver…" searchPlaceholder="Search by name…" emptyText="No staff have the Driver role yet." />
                      </Field>
                      <AvailabilityWarning date={form.funeralDate} vehicleId={form.burialVehicleId} driverId={form.burialDriverId} excludeFuneralCaseId={initial?.id} />
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attending Agent</p>
                    <Field label="Agent attending the funeral">
                      <SearchableSelect options={agentOptions} value={form.attendingAgentId} onChange={setSel("attendingAgentId")} placeholder="Select agent…" searchPlaceholder="Search agents…" emptyText="No staff have the Agent role yet." />
                    </Field>
                  </div>
                </div>
              </AccordionContent>
            </AccordionItem>

            {/* Branch */}
            <AccordionItem value="branch">
              <AccordionTrigger>Branch{countryFlagSettings?.isEnabled ? " & Country Flag" : ""}</AccordionTrigger>
              <AccordionContent className="space-y-3">
                <Field label="Branch">
                  <Select value={form.branchId} onValueChange={setSel("branchId")}>
                    <SelectTrigger data-testid="select-case-branch"><SelectValue placeholder="Select branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b: any) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}{b.isHeadOffice ? " (Head Office)" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <CountryFlagFields
                  settings={countryFlagSettings}
                  idPrefix={initial ? "edit-funeral-case" : "create-funeral-case"}
                  checked={form.isCrossBorderFlag}
                  reference={form.crossBorderReference}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isCrossBorderFlag: v }))}
                  onReferenceChange={(v) => setForm((f) => ({ ...f, crossBorderReference: v }))}
                />
              </AccordionContent>
            </AccordionItem>

            {/* Notes */}
            <AccordionItem value="notes">
              <AccordionTrigger>Notes</AccordionTrigger>
              <AccordionContent>
                <Field label="Additional Notes">
                  <Textarea value={form.notes} onChange={set("notes")} rows={3} placeholder="Any additional information…" data-testid="input-case-notes" />
                </Field>
              </AccordionContent>
            </AccordionItem>
          </Accordion>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending || !form.deceasedName || (!initial && form.serviceType === "cash" && !form.quotationId)} data-testid="button-submit-case">
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

// ─── Driver Checklist Dialog ──────────────────────────────────────────────────

function DriverChecklistDialog({ open, onOpenChange, funeralCase, existing, users, onSubmit, isPending }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  funeralCase: FuneralCase;
  existing?: any;
  users: any[];
  onSubmit: (data: Record<string, any>) => void;
  isPending: boolean;
}) {
  const [form, setForm] = useState({
    graveTent: false,
    loweringDevice: false,
    gloves: false,
    masks: false,
    fuelGauge: "",
    tollGateRequired: false,
    tollGateAmount: "",
    driverAllowance: "",
    burialOrderRef: "",
    completedAt: "",
    driverId: "",
  });

  // Sync from existing when dialog opens
  const hasSync = useRef(false);
  if (open && existing && !hasSync.current) {
    hasSync.current = true;
    setForm({
      graveTent: existing.graveTent ?? false,
      loweringDevice: existing.loweringDevice ?? false,
      gloves: existing.gloves ?? false,
      masks: existing.masks ?? false,
      fuelGauge: existing.fuelGauge ?? "",
      tollGateRequired: existing.tollGateRequired ?? false,
      tollGateAmount: existing.tollGateAmount ?? "",
      driverAllowance: existing.driverAllowance ?? "",
      burialOrderRef: existing.burialOrderRef ?? "",
      completedAt: existing.completedAt ? new Date(existing.completedAt).toISOString().slice(0, 16) : "",
      driverId: existing.driverId ?? funeralCase.burialDriverId ?? "",
    });
  }
  if (!open) hasSync.current = false;

  const apiBase = getApiBase();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      graveTent: form.graveTent,
      loweringDevice: form.loweringDevice,
      gloves: form.gloves,
      masks: form.masks,
      fuelGauge: form.fuelGauge || null,
      tollGateRequired: form.tollGateRequired,
      tollGateAmount: form.tollGateAmount || null,
      driverAllowance: form.driverAllowance || null,
      burialOrderRef: form.burialOrderRef || null,
      completedAt: form.completedAt || null,
      driverId: form.driverId || funeralCase.burialDriverId || null,
    });
  };

  const driverOptions: SearchableOption[] = users
    .filter((u: any) => u.isActive !== false)
    .map((u: any) => ({ value: u.id, label: u.displayName || u.email, hint: u.phone || undefined }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Driver Checklist — {funeralCase.caseNumber}</DialogTitle>
          <DialogDescription>Complete before departure. Download as PDF for driver sign-off.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Pre-departure items — 2×2 grid */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Pre-Departure Items</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 rounded-md border bg-muted/30 px-4 py-3">
              {([
                ["graveTent", "Grave Tent"],
                ["loweringDevice", "Lowering Device"],
                ["gloves", "Gloves"],
                ["masks", "Masks"],
              ] as [keyof typeof form, string][]).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2.5">
                  <Checkbox
                    id={key}
                    checked={!!form[key]}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, [key]: !!v }))}
                  />
                  <label htmlFor={key} className="text-sm cursor-pointer select-none">{label}</label>
                </div>
              ))}
            </div>
          </div>

          {/* Vehicle condition */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Vehicle Condition</p>
            <div className="space-y-1.5">
              <Label className="text-xs">Fuel Gauge</Label>
              <Select value={form.fuelGauge || "__none__"} onValueChange={(v) => setForm((f) => ({ ...f, fuelGauge: v === "__none__" ? "" : v }))}>
                <SelectTrigger><SelectValue placeholder="Select fuel level…" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— Not set —</SelectItem>
                  <SelectItem value="full">Full</SelectItem>
                  <SelectItem value="three_quarter">Three-Quarter (¾)</SelectItem>
                  <SelectItem value="half">Half (½)</SelectItem>
                  <SelectItem value="quarter">Quarter (¼)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Toll gate */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Toll Gate</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  id="tollGateRequired"
                  checked={form.tollGateRequired}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, tollGateRequired: !!v }))}
                />
                <label htmlFor="tollGateRequired" className="text-sm cursor-pointer select-none">Toll gate required on this route</label>
              </div>
              {form.tollGateRequired && (
                <div className="space-y-1.5 pl-7">
                  <Label className="text-xs">Amount ($)</Label>
                  <Input type="number" step="0.01" min="0" value={form.tollGateAmount} onChange={(e) => setForm((f) => ({ ...f, tollGateAmount: e.target.value }))} placeholder="0.00" className="max-w-[160px]" />
                </div>
              )}
            </div>
          </div>

          {/* Expenses & references */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Expenses &amp; References</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Driver Allowance ($)</Label>
                <Input type="number" step="0.01" min="0" value={form.driverAllowance} onChange={(e) => setForm((f) => ({ ...f, driverAllowance: e.target.value }))} placeholder="0.00" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Burial Order Ref</Label>
                <Input value={form.burialOrderRef} onChange={(e) => setForm((f) => ({ ...f, burialOrderRef: e.target.value }))} placeholder="Order / reference number" />
              </div>
            </div>
          </div>

          {/* Driver & schedule */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Driver &amp; Schedule</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Driver Allocated</Label>
                <SearchableSelect
                  options={driverOptions}
                  value={form.driverId || funeralCase.burialDriverId || ""}
                  onChange={(v) => setForm((f) => ({ ...f, driverId: v }))}
                  placeholder="Select driver…"
                  searchPlaceholder="Search by name…"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Checklist Prepared At</Label>
                <Input type="datetime-local" value={form.completedAt} onChange={(e) => setForm((f) => ({ ...f, completedAt: e.target.value }))} />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 flex-wrap">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <a href={`${apiBase}/api/funeral-cases/${funeralCase.id}/driver-checklist/pdf?download=1`} target="_blank" rel="noopener noreferrer">
              <Button type="button" variant="outline" className="gap-1.5"><FileDown className="h-3.5 w-3.5" /> Download PDF</Button>
            </a>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save Checklist
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Vehicle Dialog ──────────────────────────────────────────────────────

function EditVehicleDialog({ open, onOpenChange, vehicle, onSubmit, isPending }: {
  open: boolean; onOpenChange: (v: boolean) => void;
  vehicle: FleetVehicle;
  onSubmit: (data: Record<string, string | number | null>) => void; isPending: boolean;
}) {
  const [form, setForm] = useState({
    registration: vehicle.registration,
    make: vehicle.make || "",
    model: vehicle.model || "",
    year: vehicle.year ? String(vehicle.year) : "",
    vehicleType: vehicle.vehicleType || "",
    currentMileage: vehicle.currentMileage != null ? String(vehicle.currentMileage) : "",
    status: vehicle.status || "available",
  });
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      registration: form.registration,
      make: form.make || null,
      model: form.model || null,
      year: form.year ? parseInt(form.year) : null,
      vehicleType: form.vehicleType || null,
      currentMileage: form.currentMileage ? parseInt(form.currentMileage) : null,
      status: form.status,
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Vehicle</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Registration *</Label>
            <Input value={form.registration} onChange={(e) => setForm({ ...form, registration: e.target.value })} required data-testid="input-edit-vehicle-registration" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Make</Label><Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} data-testid="input-edit-vehicle-make" /></div>
            <div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="input-edit-vehicle-model" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Year</Label><Input type="number" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} data-testid="input-edit-vehicle-year" /></div>
            <div className="space-y-2">
              <Label>Vehicle Type</Label>
              <Select value={form.vehicleType} onValueChange={(v) => setForm({ ...form, vehicleType: v })}>
                <SelectTrigger data-testid="select-edit-vehicle-type"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hearse">Hearse</SelectItem>
                  <SelectItem value="ambulance">Ambulance</SelectItem>
                  <SelectItem value="transport">Transport</SelectItem>
                  <SelectItem value="utility">Utility</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Current Mileage (km)</Label><Input type="number" value={form.currentMileage} onChange={(e) => setForm({ ...form, currentMileage: e.target.value })} data-testid="input-edit-vehicle-mileage" /></div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                <SelectTrigger data-testid="select-edit-vehicle-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="dispatched">Dispatched</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending || !form.registration} data-testid="button-submit-edit-vehicle">
              {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Save Changes
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Make</Label><Input value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} data-testid="input-vehicle-make" /></div>
            <div className="space-y-2"><Label>Model</Label><Input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} data-testid="input-vehicle-model" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
