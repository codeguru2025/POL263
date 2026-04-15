import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, KpiStatCard, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import {
  Plus,
  Search,
  Filter,
  Mail,
  Phone,
  Eye,
  Pencil,
  X,
  ChevronLeft,
  Users,
  FileStack,
  Loader2,
  Trash2,
  UserPlus,
  Heart,
  TrendingUp,
  ArrowRight,
  KeyRound,
} from "lucide-react";

interface Client {
  id: string;
  organizationId: string;
  branchId: string | null;
  title: string | null;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  maritalStatus: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  preferredCommMethod: string | null;
  location: string | null;
  sellingPoint: string | null;
  objectionsFaced: string | null;
  responseToObjections: string | null;
  clientFeedback: string | null;
  activationCode: string | null;
  isEnrolled: boolean;
  isActive: boolean;
  createdAt: string;
}

interface Policy {
  id: string;
  clientId: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
  effectiveDate: string | null;
  createdAt: string;
}

interface Dependent {
  id: string;
  organizationId: string;
  clientId: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  relationship: string;
  isActive: boolean;
  createdAt: string;
}

type ViewMode = "list" | "detail";

interface ClientFormData {
  title: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  dateOfBirth: string;
  gender: string;
  maritalStatus: string;
  phone: string;
  email: string;
  address: string;
  preferredCommMethod: string;
  location: string;
  sellingPoint: string;
  objectionsFaced: string;
  responseToObjections: string;
  clientFeedback: string;
}

interface DependentFormData {
  firstName: string;
  lastName: string;
  nationalId: string;
  dateOfBirth: string;
  gender: string;
  relationship: string;
}

const emptyForm: ClientFormData = {
  title: "",
  firstName: "",
  lastName: "",
  nationalId: "",
  dateOfBirth: "",
  gender: "",
  maritalStatus: "",
  phone: "",
  email: "",
  address: "",
  preferredCommMethod: "",
  location: "",
  sellingPoint: "",
  objectionsFaced: "",
  responseToObjections: "",
  clientFeedback: "",
};

const TITLES = ["Mr", "Mrs", "Ms", "Miss", "Dr", "Prof", "Rev", "Chief"];
const MARITAL_STATUSES = ["Single", "Married", "Divorced", "Widowed", "Separated"];
const COMM_METHODS = [
  { value: "sms", label: "SMS" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "calls", label: "Phone Calls" },
  { value: "email", label: "Email" },
];

const emptyDependent: DependentFormData = {
  firstName: "",
  lastName: "",
  nationalId: "",
  dateOfBirth: "",
  gender: "",
  relationship: "",
};

const RELATIONSHIPS = [
  "Spouse",
  "Son",
  "Daughter",
  "Father",
  "Mother",
  "Brother",
  "Sister",
  "Grandparent",
  "Grandchild",
  "Uncle",
  "Aunt",
  "Nephew",
  "Niece",
  "Cousin",
  "In-law",
  "Other",
];

export default function StaffClients() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [formData, setFormData] = useState<ClientFormData>(emptyForm);

  const [showAddDepDialog, setShowAddDepDialog] = useState(false);
  const [editingDep, setEditingDep] = useState<Dependent | null>(null);
  const [depForm, setDepForm] = useState<DependentFormData>(emptyDependent);

  const { data: clientsList, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: allPolicies } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const clientsWithPolicies = new Set(
    (allPolicies || []).map((p) => p.clientId).filter(Boolean)
  );

  const { data: selectedClient, isLoading: isLoadingDetail } = useQuery<Client>({
    queryKey: ["/api/clients", selectedClientId],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${selectedClientId}`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return null;
      if (!res.ok) throw new Error("Failed to fetch client");
      return res.json();
    },
    enabled: !!selectedClientId && viewMode === "detail",
  });

  const { data: clientPolicies } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
    enabled: viewMode === "detail" && !!selectedClientId,
  });

  const { data: clientDependents, isLoading: isLoadingDeps } = useQuery<Dependent[]>({
    queryKey: ["/api/clients", selectedClientId, "dependents"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/clients/${selectedClientId}/dependents`, { credentials: "include" });
      if (res.status === 401 || res.status === 403) return [];
      if (!res.ok) throw new Error("Failed to fetch dependents");
      return res.json();
    },
    enabled: !!selectedClientId && viewMode === "detail",
  });

  const [lastCreatedClient, setLastCreatedClient] = useState<Client | null>(null);

  const createMutation = useMutation({
    mutationFn: async (data: ClientFormData) => {
      const res = await apiRequest("POST", "/api/clients", data);
      return res.json() as Promise<Client>;
    },
    onSuccess: (client) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowCreateDialog(false);
      setFormData(emptyForm);
      setLastCreatedClient(client);
    },
    onError: (err: Error) => {
      try {
        const jsonStr = err.message.replace(/^\d+:\s*/, "");
        const body = JSON.parse(jsonStr);
        if (body.code === "DUPLICATE_CLIENT" && body.existingClient) {
          const ec = body.existingClient;
          toast({
            title: "Duplicate Client Found",
            description: `${ec.firstName} ${ec.lastName} (ID: ${ec.nationalId || "—"}, Phone: ${ec.phone || "—"}) already exists. Request admin approval to create another policy for this client.`,
            variant: "destructive",
            duration: 12000,
          });
          return;
        }
      } catch {
        // not JSON — fall through to generic toast
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<ClientFormData> }) => {
      const res = await apiRequest("PATCH", `/api/clients/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      if (selectedClientId) {
        queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId] });
      }
      setShowEditDialog(false);
      toast({ title: "Client updated", description: "Client details have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const addDepMutation = useMutation({
    mutationFn: async (data: DependentFormData) => {
      const res = await apiRequest("POST", `/api/clients/${selectedClientId}/dependents`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "dependents"] });
      setShowAddDepDialog(false);
      setDepForm(emptyDependent);
      toast({ title: "Dependent added", description: "Dependent/beneficiary has been added." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateDepMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<DependentFormData> }) => {
      const res = await apiRequest("PATCH", `/api/clients/${selectedClientId}/dependents/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "dependents"] });
      setEditingDep(null);
      setDepForm(emptyDependent);
      toast({ title: "Dependent updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteDepMutation = useMutation({
    mutationFn: async (depId: string) => {
      await apiRequest("DELETE", `/api/clients/${selectedClientId}/dependents/${depId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "dependents"] });
      toast({ title: "Dependent removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredClients = (clientsList || []).filter((client) => {
    const fullName = `${client.firstName} ${client.lastName}`.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      fullName.includes(searchQuery.toLowerCase()) ||
      (client.email || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (client.phone || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (client.nationalId || "").toLowerCase().includes(searchQuery.toLowerCase());

    const hasPolicy = clientsWithPolicies.has(client.id);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "leads" && !hasPolicy) ||
      (statusFilter === "converted" && hasPolicy) ||
      (statusFilter === "active" && client.isActive) ||
      (statusFilter === "inactive" && !client.isActive);

    return matchesSearch && matchesStatus;
  });

  const linkedPolicies = (clientPolicies || []).filter(
    (p: any) => p.clientId === selectedClientId
  );

  const openDetail = (clientId: string) => {
    setSelectedClientId(clientId);
    setViewMode("detail");
  };

  const openEdit = (client: Client) => {
    setFormData({
      title: client.title || "",
      firstName: client.firstName,
      lastName: client.lastName,
      nationalId: client.nationalId || "",
      dateOfBirth: client.dateOfBirth || "",
      gender: client.gender || "",
      maritalStatus: client.maritalStatus || "",
      phone: client.phone || "",
      email: client.email || "",
      address: client.address || "",
      preferredCommMethod: client.preferredCommMethod || "",
      location: client.location ?? "",
      sellingPoint: client.sellingPoint ?? "",
      objectionsFaced: client.objectionsFaced ?? "",
      responseToObjections: client.responseToObjections ?? "",
      clientFeedback: client.clientFeedback ?? "",
    });
    setShowEditDialog(true);
  };

  const handleCreate = () => {
    if (!formData.firstName || !formData.lastName) {
      toast({ title: "Validation", description: "First name and last name are required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdate = () => {
    if (!selectedClientId) return;
    updateMutation.mutate({ id: selectedClientId, data: formData });
  };

  const getInitials = (first: string, last: string) =>
    `${first[0] || ""}${last[0] || ""}`.toUpperCase();

  if (viewMode === "detail" && selectedClientId) {
    return (
      <StaffLayout>
        <div className="space-y-6">
          <div className="rounded-2xl border border-border/60 bg-gradient-to-br from-primary/[0.06] via-card to-muted/25 p-4 sm:p-5 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 touch-target sm:h-9 sm:min-h-0 sm:min-w-0"
                  onClick={() => { setViewMode("list"); setSelectedClientId(null); }}
                  data-testid="btn-back-to-list"
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
                <div className="min-w-0">
                  <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight" data-testid="text-client-name">
                    {isLoadingDetail ? "Loading..." : `${selectedClient?.firstName} ${selectedClient?.lastName}`}
                  </h1>
                  <p className="text-muted-foreground mt-1 text-sm sm:text-base">
                    {linkedPolicies.length > 0 ? "Converted client" : "Lead — no policy issued yet"}
                  </p>
                </div>
              </div>
              {selectedClient && (
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  <Badge variant={selectedClient.isActive ? "default" : "secondary"} data-testid="badge-client-status">
                    {selectedClient.isActive ? "Active" : "Inactive"}
                  </Badge>
                  {linkedPolicies.length > 0 ? (
                    <Badge variant="default" className="bg-emerald-600" data-testid="badge-client-converted">
                      Converted
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200" data-testid="badge-client-lead">
                      Lead
                    </Badge>
                  )}
                  {linkedPolicies.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-2 touch-target sm:h-9 sm:min-h-0"
                        onClick={() => openEdit(selectedClient)}
                        data-testid="btn-edit-client"
                      >
                        <Pencil className="h-3.5 w-3.5" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        className="gap-2 touch-target sm:h-9 sm:min-h-0"
                        onClick={() => { window.location.href = `/staff/policies?create=1&clientId=${selectedClient.id}`; }}
                        data-testid="btn-issue-policy-detail"
                      >
                        <ArrowRight className="h-3.5 w-3.5" /> Issue Policy
                      </Button>
                    </div>
                  ) : (
                    <Badge variant="outline" className="text-xs text-muted-foreground">
                      Locked — edit via policy
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {isLoadingDetail ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : selectedClient ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <CardSection title="Personal Information" icon={Users}>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Full Name</p>
                      <p className="font-medium" data-testid="text-detail-fullname">
                        {selectedClient.title ? `${selectedClient.title} ` : ""}{selectedClient.firstName} {selectedClient.lastName}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">National ID</p>
                      <p className="font-medium" data-testid="text-detail-nationalid">{selectedClient.nationalId || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Date of Birth</p>
                      <p className="font-medium" data-testid="text-detail-dob">{selectedClient.dateOfBirth || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Gender</p>
                      <p className="font-medium capitalize" data-testid="text-detail-gender">{selectedClient.gender || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Marital Status</p>
                      <p className="font-medium" data-testid="text-detail-marital">{selectedClient.maritalStatus || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Phone</p>
                      <p className="font-medium" data-testid="text-detail-phone">{selectedClient.phone || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Email</p>
                      <p className="font-medium" data-testid="text-detail-email">{selectedClient.email || "—"}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Preferred Contact</p>
                      <p className="font-medium" data-testid="text-detail-comm">
                        {COMM_METHODS.find(m => m.value === selectedClient.preferredCommMethod)?.label || selectedClient.preferredCommMethod || "—"}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <p className="text-muted-foreground">Address</p>
                      <p className="font-medium" data-testid="text-detail-address">{selectedClient.address || "—"}</p>
                    </div>
                    {selectedClient.location && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Location</p>
                        <p className="font-medium">{selectedClient.location}</p>
                      </div>
                    )}
                    {selectedClient.sellingPoint && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Selling point</p>
                        <p className="font-medium whitespace-pre-wrap">{selectedClient.sellingPoint}</p>
                      </div>
                    )}
                    {selectedClient.objectionsFaced && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Objections faced</p>
                        <p className="font-medium whitespace-pre-wrap">{selectedClient.objectionsFaced}</p>
                      </div>
                    )}
                    {selectedClient.responseToObjections && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Response to objections</p>
                        <p className="font-medium whitespace-pre-wrap">{selectedClient.responseToObjections}</p>
                      </div>
                    )}
                    {selectedClient.clientFeedback && (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Client feedback</p>
                        <p className="font-medium whitespace-pre-wrap">{selectedClient.clientFeedback}</p>
                      </div>
                    )}
                  </div>
              </CardSection>

              <CardSection title="Linked Policies" icon={FileStack}>
                  {linkedPolicies.length === 0 ? (
                    <EmptyState
                      title="No policies linked"
                      description="Issue a policy from this lead to link coverage here."
                      className="border-0 rounded-none bg-transparent py-8"
                      dataTestId="text-no-policies"
                    />
                  ) : (
                    <div className="space-y-3">
                      {linkedPolicies.map((policy: any) => (
                        <div
                          key={policy.id}
                          className="flex items-center justify-between p-3 rounded-lg border bg-muted/5"
                          data-testid={`card-policy-${policy.id}`}
                        >
                          <div>
                            <p className="font-medium font-mono text-sm">{policy.policyNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              Effective: {policy.effectiveDate || "—"}
                            </p>
                          </div>
                          <div className="text-right space-y-1">
                            <p className="font-medium text-sm tabular-nums">
                              {policy.currency} {parseFloat(policy.premiumAmount).toFixed(2)}
                            </p>
                            <StatusBadge status={policy.status} variant="policy" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
              </CardSection>

              <CardSection
                className="md:col-span-2"
                title="Dependents & Beneficiaries"
                icon={Heart}
                headerRight={(
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => { setDepForm(emptyDependent); setShowAddDepDialog(true); }}
                      data-testid="btn-add-dependent"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Add Dependent
                    </Button>
                )}
                flush
              >
                  {isLoadingDeps ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !clientDependents || clientDependents.length === 0 ? (
                    <EmptyState
                      title="No dependents yet"
                      description="Add beneficiaries or dependents tied to this client record."
                      className="border-0 rounded-none bg-transparent py-8"
                      dataTestId="text-no-dependents"
                    />
                  ) : (
                    <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                      <TableHeader className={dataTableStickyHeaderClass}>
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Relationship</TableHead>
                          <TableHead>National ID</TableHead>
                          <TableHead>Date of Birth</TableHead>
                          <TableHead>Gender</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(clientDependents ?? []).map((dep) => (
                          <TableRow key={dep.id} className="hover:bg-muted/40" data-testid={`row-dependent-${dep.id}`}>
                            <TableCell className="font-medium">
                              {dep.firstName} {dep.lastName}
                            </TableCell>
                            <TableCell>
                              <Badge variant="outline">{dep.relationship}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-sm">{dep.nationalId || "—"}</TableCell>
                            <TableCell>{dep.dateOfBirth || "—"}</TableCell>
                            <TableCell className="capitalize">{dep.gender || "—"}</TableCell>
                            <TableCell>
                              <StatusBadge status={dep.isActive ? "active" : "inactive"} variant="policy" />
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => {
                                    setEditingDep(dep);
                                    setDepForm({
                                      firstName: dep.firstName,
                                      lastName: dep.lastName,
                                      nationalId: dep.nationalId || "",
                                      dateOfBirth: dep.dateOfBirth || "",
                                      gender: dep.gender || "",
                                      relationship: dep.relationship,
                                    });
                                  }}
                                  data-testid={`btn-edit-dep-${dep.id}`}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => {
                                    if (confirm(`Remove ${dep.firstName} ${dep.lastName} as a dependent?`)) {
                                      deleteDepMutation.mutate(dep.id);
                                    }
                                  }}
                                  data-testid={`btn-delete-dep-${dep.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </DataTable>
                  )}
              </CardSection>

              <CardSection title="Enrollment & Access" icon={KeyRound}>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Activation Code</p>
                      <p className="font-mono font-medium" data-testid="text-detail-activation-code">
                        {selectedClient.activationCode || "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Client Since</p>
                      <p className="font-medium" data-testid="text-detail-created">
                        {new Date(selectedClient.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
              </CardSection>
            </div>
          ) : null}
        </div>

        <EditClientDialog
          open={showEditDialog}
          onOpenChange={setShowEditDialog}
          formData={formData}
          setFormData={setFormData}
          onSubmit={handleUpdate}
          isPending={updateMutation.isPending}
        />

        <DependentDialog
          open={showAddDepDialog}
          onOpenChange={setShowAddDepDialog}
          title="Add Dependent / Beneficiary"
          depForm={depForm}
          setDepForm={setDepForm}
          onSubmit={() => {
            if (!depForm.firstName || !depForm.lastName || !depForm.relationship) {
              toast({ title: "Validation", description: "Name and relationship are required.", variant: "destructive" });
              return;
            }
            addDepMutation.mutate(depForm);
          }}
          isPending={addDepMutation.isPending}
          submitLabel="Add Dependent"
        />

        <DependentDialog
          open={!!editingDep}
          onOpenChange={(open) => { if (!open) setEditingDep(null); }}
          title="Edit Dependent / Beneficiary"
          depForm={depForm}
          setDepForm={setDepForm}
          onSubmit={() => {
            if (!editingDep) return;
            updateDepMutation.mutate({ id: editingDep.id, data: depForm });
          }}
          isPending={updateDepMutation.isPending}
          submitLabel="Save Changes"
        />
      </StaffLayout>
    );
  }

  const totalClients = (clientsList || []).length;
  const convertedCount = (clientsList || []).filter((c) => clientsWithPolicies.has(c.id)).length;
  const leadCount = totalClients - convertedCount;
  const conversionRate = totalClients > 0 ? ((convertedCount / totalClients) * 100).toFixed(1) : "0";

  return (
    <StaffLayout>
      <div className="space-y-6">
        <PageHeader
          title="Leads & Clients"
          description="Track prospects and conversions. Clients are your leads — policies are your source of truth."
          actions={(
            <Button className="gap-2 shadow-sm touch-target sm:h-9 sm:min-h-0 sm:min-w-0" onClick={() => { setFormData(emptyForm); setShowCreateDialog(true); }} data-testid="btn-add-client">
              <Plus className="h-4 w-4" /> Capture Lead
            </Button>
          )}
        />

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KpiStatCard label="Total records" value={totalClients} icon={Users} />
          <KpiStatCard label="Leads (no policy)" value={<span className="text-amber-700">{leadCount}</span>} icon={Users} />
          <KpiStatCard label="Converted" value={<span className="text-emerald-700">{convertedCount}</span>} icon={FileStack} />
          <KpiStatCard label="Conversion rate" value={<span className="tabular-nums">{conversionRate}%</span>} icon={TrendingUp} />
        </div>

        <CardSection
          title="Lead & client registry"
          description="Search, filter, and open a record to view full detail."
          icon={Users}
          headerRight={(
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                <div className="relative w-full sm:w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search leads & clients..."
                    className="pl-9 bg-background"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-search-clients"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full sm:w-40" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2 shrink-0" />
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="leads">Leads Only</SelectItem>
                    <SelectItem value="converted">Converted Only</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
          )}
          flush
        >
            {isLoading ? (
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead className="pl-6">Client</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Conversion</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-6"><div className="flex items-center gap-3"><Skeleton className="h-8 w-8 rounded-full" /><div className="space-y-1"><Skeleton className="h-3.5 w-28" /><Skeleton className="h-3 w-20" /></div></div></TableCell>
                      <TableCell><div className="space-y-1"><Skeleton className="h-3.5 w-32" /><Skeleton className="h-3 w-24" /></div></TableCell>
                      <TableCell><Skeleton className="h-3.5 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-20 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right pr-6"><Skeleton className="h-8 w-8 rounded ml-auto" /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            ) : filteredClients.length === 0 ? (
              <EmptyState
                dataTestId="text-no-clients"
                icon={Users}
                title={searchQuery || statusFilter !== "all" ? "No matching records" : "No clients yet"}
                description={searchQuery || statusFilter !== "all" ? "No clients match your search criteria." : "No clients found. Add your first client to get started."}
                className="border-0 rounded-none bg-transparent py-10"
              />
            ) : (
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead className="pl-6">Client</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>National ID</TableHead>
                    <TableHead>Conversion</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredClients.map((client) => (
                    <TableRow
                      key={client.id}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => openDetail(client.id)}
                      data-testid={`row-client-${client.id}`}
                    >
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            <AvatarFallback className="bg-primary/10 text-primary font-medium">
                              {getInitials(client.firstName, client.lastName)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium" data-testid={`text-client-name-${client.id}`}>
                              {client.firstName} {client.lastName}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(client.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          {client.email && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="h-3 w-3" /> {client.email}
                            </div>
                          )}
                          {client.phone && (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" /> {client.phone}
                            </div>
                          )}
                          {!client.email && !client.phone && (
                            <span className="text-sm text-muted-foreground">—</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-mono" data-testid={`text-client-nid-${client.id}`}>
                          {client.nationalId || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const cp = (allPolicies || []).filter((p) => p.clientId === client.id);
                          if (cp.length === 0) {
                            return (
                              <Badge variant="outline" className="bg-amber-500/10 text-amber-700 border-amber-200">
                                Lead
                              </Badge>
                            );
                          }
                          return (
                            <div className="space-y-1">
                              {cp.map((p) => (
                                <Badge key={p.id} variant="outline" className="font-mono text-xs block w-fit bg-emerald-500/10 text-emerald-700 border-emerald-200">
                                  {p.policyNumber}
                                </Badge>
                              ))}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Badge variant={client.isActive ? "default" : "secondary"}>
                            {client.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-6">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openDetail(client.id)}
                            data-testid={`btn-view-client-${client.id}`}
                            title="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {!clientsWithPolicies.has(client.id) && (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => openEdit(client)}
                                data-testid={`btn-edit-client-${client.id}`}
                                title="Edit lead"
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-primary"
                                onClick={() => { window.location.href = `/staff/policies?create=1&clientId=${client.id}`; }}
                                data-testid={`btn-issue-policy-${client.id}`}
                                title="Issue policy"
                              >
                                <ArrowRight className="h-4 w-4" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            )}
        </CardSection>
      </div>

      <CreateClientDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleCreate}
        isPending={createMutation.isPending}
      />

      <EditClientDialog
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        formData={formData}
        setFormData={setFormData}
        onSubmit={handleUpdate}
        isPending={updateMutation.isPending}
      />

      <Dialog open={!!lastCreatedClient} onOpenChange={(open) => !open && setLastCreatedClient(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Client Created Successfully</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Share the activation code below with <strong>{lastCreatedClient?.firstName} {lastCreatedClient?.lastName}</strong> so they can set up their client portal account.
            </p>
            <div className="bg-muted rounded-lg p-4 text-center space-y-1">
              <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Activation Code</p>
              <p className="text-2xl font-mono font-bold tracking-widest" data-testid="text-new-activation-code">
                {lastCreatedClient?.activationCode}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              The client will use this code along with their policy number on the enrollment page to create their login credentials.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (lastCreatedClient?.activationCode) {
                  navigator.clipboard.writeText(lastCreatedClient.activationCode);
                  toast({ title: "Copied", description: "Activation code copied to clipboard." });
                }
              }}
              data-testid="button-copy-activation-code"
            >
              Copy Code
            </Button>
            <Button onClick={() => setLastCreatedClient(null)} data-testid="button-dismiss-activation">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}

function CreateClientDialog({
  open,
  onOpenChange,
  formData,
  setFormData,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: ClientFormData;
  setFormData: (data: ClientFormData) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add New Client</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Client Details</h3>
            <ClientForm formData={formData} setFormData={setFormData} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel-form">
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending} data-testid="btn-submit-client">
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Client
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditClientDialog({
  open,
  onOpenChange,
  formData,
  setFormData,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: ClientFormData;
  setFormData: (data: ClientFormData) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Client</DialogTitle>
        </DialogHeader>
        <ClientForm formData={formData} setFormData={setFormData} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel-edit">
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending} data-testid="btn-save-client">
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DependentDialog({
  open,
  onOpenChange,
  title,
  depForm,
  setDepForm,
  onSubmit,
  isPending,
  submitLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  depForm: DependentFormData;
  setDepForm: (data: DependentFormData) => void;
  onSubmit: () => void;
  isPending: boolean;
  submitLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <DependentFormFields depForm={depForm} setDepForm={setDepForm} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="btn-cancel-dep-form">
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={isPending} data-testid="btn-submit-dependent">
            {isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DependentFormFields({
  depForm,
  setDepForm,
}: {
  depForm: DependentFormData;
  setDepForm: (data: DependentFormData) => void;
}) {
  const update = (field: keyof DependentFormData, value: string) =>
    setDepForm({ ...depForm, [field]: value });

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="space-y-2">
        <Label>First Name *</Label>
        <Input
          value={depForm.firstName}
          onChange={(e) => update("firstName", e.target.value)}
          placeholder="First name"
          data-testid="input-dep-first-name"
        />
      </div>
      <div className="space-y-2">
        <Label>Last Name *</Label>
        <Input
          value={depForm.lastName}
          onChange={(e) => update("lastName", e.target.value)}
          placeholder="Last name"
          data-testid="input-dep-last-name"
        />
      </div>
      <div className="space-y-2">
        <Label>Relationship *</Label>
        <Select value={depForm.relationship} onValueChange={(v) => update("relationship", v)}>
          <SelectTrigger data-testid="select-dep-relationship">
            <SelectValue placeholder="Select relationship" />
          </SelectTrigger>
          <SelectContent>
            {RELATIONSHIPS.map((r) => (
              <SelectItem key={r} value={r}>{r}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>National ID</Label>
        <Input
          value={depForm.nationalId}
          onChange={(e) => update("nationalId", e.target.value)}
          placeholder="ID number"
          data-testid="input-dep-national-id"
        />
      </div>
      <div className="space-y-2">
        <Label>Date of Birth</Label>
        <Input
          type="date"
          value={depForm.dateOfBirth}
          onChange={(e) => update("dateOfBirth", e.target.value)}
          data-testid="input-dep-dob"
        />
      </div>
      <div className="space-y-2">
        <Label>Gender</Label>
        <Select value={depForm.gender} onValueChange={(v) => update("gender", v)}>
          <SelectTrigger data-testid="select-dep-gender">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function ClientForm({
  formData,
  setFormData,
}: {
  formData: ClientFormData;
  setFormData: (data: ClientFormData) => void;
}) {
  const update = (field: keyof ClientFormData, value: string) =>
    setFormData({ ...formData, [field]: value });

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="space-y-2">
        <Label>Title</Label>
        <Select value={formData.title} onValueChange={(v) => update("title", v)}>
          <SelectTrigger data-testid="select-title">
            <SelectValue placeholder="Select title" />
          </SelectTrigger>
          <SelectContent>
            {TITLES.map((t) => (
              <SelectItem key={t} value={t}>{t}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="firstName">First Name *</Label>
        <Input
          id="firstName"
          value={formData.firstName}
          onChange={(e) => update("firstName", e.target.value)}
          placeholder="First name"
          data-testid="input-first-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="lastName">Last Name *</Label>
        <Input
          id="lastName"
          value={formData.lastName}
          onChange={(e) => update("lastName", e.target.value)}
          placeholder="Last name"
          data-testid="input-last-name"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="nationalId">National ID</Label>
        <Input
          id="nationalId"
          value={formData.nationalId}
          onChange={(e) => update("nationalId", e.target.value)}
          placeholder="ID number"
          data-testid="input-national-id"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dateOfBirth">Date of Birth</Label>
        <Input
          id="dateOfBirth"
          type="date"
          value={formData.dateOfBirth}
          onChange={(e) => update("dateOfBirth", e.target.value)}
          data-testid="input-dob"
        />
      </div>
      <div className="space-y-2">
        <Label>Gender</Label>
        <Select value={formData.gender} onValueChange={(v) => update("gender", v)}>
          <SelectTrigger data-testid="select-gender">
            <SelectValue placeholder="Select gender" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="male">Male</SelectItem>
            <SelectItem value="female">Female</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Marital Status</Label>
        <Select value={formData.maritalStatus} onValueChange={(v) => update("maritalStatus", v)}>
          <SelectTrigger data-testid="select-marital-status">
            <SelectValue placeholder="Select status" />
          </SelectTrigger>
          <SelectContent>
            {MARITAL_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="phone">Phone Number</Label>
        <Input
          id="phone"
          value={formData.phone}
          onChange={(e) => update("phone", e.target.value)}
          placeholder="+263 77 123 4567"
          data-testid="input-phone"
        />
      </div>
      <div className="space-y-2">
        <Label>Preferred Contact Method</Label>
        <Select value={formData.preferredCommMethod} onValueChange={(v) => update("preferredCommMethod", v)}>
          <SelectTrigger data-testid="select-comm-method">
            <SelectValue placeholder="Select method" />
          </SelectTrigger>
          <SelectContent>
            {COMM_METHODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2 col-span-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          value={formData.email}
          onChange={(e) => update("email", e.target.value)}
          placeholder="email@example.com"
          data-testid="input-email"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="address">Address</Label>
        <Input
          id="address"
          value={formData.address}
          onChange={(e) => update("address", e.target.value)}
          placeholder="Street address"
          data-testid="input-address"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="location">Location</Label>
        <Input
          id="location"
          value={formData.location}
          onChange={(e) => update("location", e.target.value)}
          placeholder="Area, city or region"
          data-testid="input-location"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="sellingPoint">Selling point (what was sold to the client)</Label>
        <Textarea
          id="sellingPoint"
          value={formData.sellingPoint}
          onChange={(e) => update("sellingPoint", e.target.value)}
          placeholder="What product/benefits were sold to the client"
          rows={2}
          data-testid="input-selling-point"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="objectionsFaced">Objections faced</Label>
        <Textarea
          id="objectionsFaced"
          value={formData.objectionsFaced}
          onChange={(e) => update("objectionsFaced", e.target.value)}
          placeholder="Objections or concerns the client raised"
          rows={2}
          data-testid="input-objections"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="responseToObjections">Response to objections</Label>
        <Textarea
          id="responseToObjections"
          value={formData.responseToObjections}
          onChange={(e) => update("responseToObjections", e.target.value)}
          placeholder="How the agent responded to the objections"
          rows={2}
          data-testid="input-response-to-objections"
        />
      </div>
      <div className="space-y-2 col-span-3">
        <Label htmlFor="clientFeedback">Client feedback (other notes)</Label>
        <Textarea
          id="clientFeedback"
          value={formData.clientFeedback}
          onChange={(e) => update("clientFeedback", e.target.value)}
          placeholder="Any other feedback or notes from the client"
          rows={2}
          data-testid="input-client-feedback"
        />
      </div>
    </div>
  );
}
