import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
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
  activationCode: string | null;
  isEnrolled: boolean;
  isActive: boolean;
  createdAt: string;
}

interface Policy {
  id: string;
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
  const [pendingDependents, setPendingDependents] = useState<DependentFormData[]>([]);

  const [showAddDepDialog, setShowAddDepDialog] = useState(false);
  const [editingDep, setEditingDep] = useState<Dependent | null>(null);
  const [depForm, setDepForm] = useState<DependentFormData>(emptyDependent);

  const { data: clientsList, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: selectedClient, isLoading: isLoadingDetail } = useQuery<Client>({
    queryKey: ["/api/clients", selectedClientId],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${selectedClientId}`, { credentials: "include" });
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
      const res = await fetch(`/api/clients/${selectedClientId}/dependents`, { credentials: "include" });
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
    onSuccess: async (client) => {
      if (pendingDependents.length > 0) {
        for (const dep of pendingDependents) {
          await apiRequest("POST", `/api/clients/${client.id}/dependents`, dep);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowCreateDialog(false);
      setFormData(emptyForm);
      setPendingDependents([]);
      setLastCreatedClient(client);
    },
    onError: (err: Error) => {
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

    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && client.isActive) ||
      (statusFilter === "inactive" && !client.isActive) ||
      (statusFilter === "enrolled" && client.isEnrolled) ||
      (statusFilter === "not_enrolled" && !client.isEnrolled);

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
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setViewMode("list"); setSelectedClientId(null); }}
              data-testid="btn-back-to-list"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-client-name">
                {isLoadingDetail ? "Loading..." : `${selectedClient?.firstName} ${selectedClient?.lastName}`}
              </h1>
              <p className="text-muted-foreground mt-1">Client Details</p>
            </div>
            {selectedClient && (
              <div className="ml-auto flex items-center gap-2">
                <Badge variant={selectedClient.isActive ? "default" : "secondary"} data-testid="badge-client-status">
                  {selectedClient.isActive ? "Active" : "Inactive"}
                </Badge>
                <Badge variant={selectedClient.isEnrolled ? "default" : "outline"} data-testid="badge-client-enrolled">
                  {selectedClient.isEnrolled ? "Enrolled" : "Not Enrolled"}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2"
                  onClick={() => openEdit(selectedClient)}
                  data-testid="btn-edit-client"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
              </div>
            )}
          </div>

          {isLoadingDetail ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Skeleton className="h-48" />
              <Skeleton className="h-48" />
            </div>
          ) : selectedClient ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Personal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
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
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><FileStack className="h-4 w-4" /> Linked Policies</CardTitle>
                </CardHeader>
                <CardContent>
                  {linkedPolicies.length === 0 ? (
                    <p className="text-sm text-muted-foreground" data-testid="text-no-policies">No policies linked to this client.</p>
                  ) : (
                    <div className="space-y-3">
                      {linkedPolicies.map((policy: any) => (
                        <div
                          key={policy.id}
                          className="flex items-center justify-between p-3 rounded-lg border"
                          data-testid={`card-policy-${policy.id}`}
                        >
                          <div>
                            <p className="font-medium font-mono text-sm">{policy.policyNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              Effective: {policy.effectiveDate || "—"}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-medium text-sm">
                              {policy.currency} {parseFloat(policy.premiumAmount).toFixed(2)}
                            </p>
                            <Badge
                              variant={policy.status === "active" ? "default" : "secondary"}
                              className="mt-1"
                            >
                              {policy.status}
                            </Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm md:col-span-2">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2">
                      <Heart className="h-4 w-4" /> Dependents & Beneficiaries
                    </CardTitle>
                    <Button
                      size="sm"
                      className="gap-2"
                      onClick={() => { setDepForm(emptyDependent); setShowAddDepDialog(true); }}
                      data-testid="btn-add-dependent"
                    >
                      <UserPlus className="h-3.5 w-3.5" /> Add Dependent
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {isLoadingDeps ? (
                    <div className="flex items-center justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : !clientDependents || clientDependents.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-no-dependents">
                      No dependents or beneficiaries recorded yet.
                    </p>
                  ) : (
                    <Table>
                      <TableHeader className="bg-muted/50">
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
                        {clientDependents.map((dep) => (
                          <TableRow key={dep.id} data-testid={`row-dependent-${dep.id}`}>
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
                              <Badge variant={dep.isActive ? "default" : "secondary"}>
                                {dep.isActive ? "Active" : "Inactive"}
                              </Badge>
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
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Enrollment & Access</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="grid grid-cols-2 gap-4">
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
                </CardContent>
              </Card>
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

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Clients</h1>
            <p className="text-muted-foreground mt-1">Manage policyholders and their communication preferences.</p>
          </div>
          <Button
            className="gap-2 shadow-sm"
            onClick={() => { setFormData(emptyForm); setPendingDependents([]); setShowCreateDialog(true); }}
            data-testid="btn-add-client"
          >
            <Plus className="h-4 w-4" /> Add New Client
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Client Registry</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search clients..."
                    className="pl-9 bg-background"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    data-testid="input-search-clients"
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-36" data-testid="select-status-filter">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Filter" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                    <SelectItem value="enrolled">Enrolled</SelectItem>
                    <SelectItem value="not_enrolled">Not Enrolled</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground" data-testid="text-no-clients">
                {searchQuery || statusFilter !== "all"
                  ? "No clients match your search criteria."
                  : "No clients found. Add your first client to get started."}
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Client</TableHead>
                    <TableHead>Contact Info</TableHead>
                    <TableHead>National ID</TableHead>
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
                        <div className="flex items-center gap-2">
                          <Badge variant={client.isActive ? "default" : "secondary"}>
                            {client.isActive ? "Active" : "Inactive"}
                          </Badge>
                          {client.isEnrolled && (
                            <Badge variant="outline" className="text-xs">Enrolled</Badge>
                          )}
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
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => openEdit(client)}
                            data-testid={`btn-edit-client-${client.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <CreateClientDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        formData={formData}
        setFormData={setFormData}
        pendingDependents={pendingDependents}
        setPendingDependents={setPendingDependents}
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
  pendingDependents,
  setPendingDependents,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formData: ClientFormData;
  setFormData: (data: ClientFormData) => void;
  pendingDependents: DependentFormData[];
  setPendingDependents: (deps: DependentFormData[]) => void;
  onSubmit: () => void;
  isPending: boolean;
}) {
  const [showInlineDepForm, setShowInlineDepForm] = useState(false);
  const [inlineDepForm, setInlineDepForm] = useState<DependentFormData>(emptyDependent);

  const addInlineDependent = () => {
    if (!inlineDepForm.firstName || !inlineDepForm.lastName || !inlineDepForm.relationship) return;
    setPendingDependents([...pendingDependents, { ...inlineDepForm }]);
    setInlineDepForm(emptyDependent);
    setShowInlineDepForm(false);
  };

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

          <div className="border-t pt-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Dependents & Beneficiaries
              </h3>
              {!showInlineDepForm && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1"
                  onClick={() => setShowInlineDepForm(true)}
                  data-testid="btn-add-inline-dependent"
                >
                  <UserPlus className="h-3.5 w-3.5" /> Add
                </Button>
              )}
            </div>

            {pendingDependents.length > 0 && (
              <div className="space-y-2 mb-3">
                {pendingDependents.map((dep, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 rounded-lg border bg-muted/30"
                    data-testid={`card-pending-dep-${idx}`}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary">
                          {dep.firstName[0]}{dep.lastName[0]}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-medium text-sm">{dep.firstName} {dep.lastName}</p>
                        <p className="text-xs text-muted-foreground">
                          {dep.relationship}
                          {dep.dateOfBirth ? ` · DOB: ${dep.dateOfBirth}` : ""}
                          {dep.gender ? ` · ${dep.gender}` : ""}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => setPendingDependents(pendingDependents.filter((_, i) => i !== idx))}
                      data-testid={`btn-remove-pending-dep-${idx}`}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {showInlineDepForm && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/20">
                <DependentFormFields depForm={inlineDepForm} setDepForm={setInlineDepForm} />
                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="button"
                    size="sm"
                    onClick={addInlineDependent}
                    disabled={!inlineDepForm.firstName || !inlineDepForm.lastName || !inlineDepForm.relationship}
                    data-testid="btn-confirm-inline-dep"
                  >
                    Add to List
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => { setShowInlineDepForm(false); setInlineDepForm(emptyDependent); }}
                    data-testid="btn-cancel-inline-dep"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {pendingDependents.length === 0 && !showInlineDepForm && (
              <p className="text-sm text-muted-foreground text-center py-3">
                No dependents added yet. You can add them now or later from the client detail view.
              </p>
            )}
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
    </div>
  );
}
