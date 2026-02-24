import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Plus,
  Search,
  Pencil,
  Layers,
  FileStack,
  Loader2,
  LinkIcon,
} from "lucide-react";

interface Group {
  id: string;
  organizationId: string;
  name: string;
  type: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
}

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
  clientId: string;
  groupId: string | null;
  effectiveDate: string | null;
  createdAt: string;
}

interface GroupFormData {
  name: string;
  type: string;
  description: string;
}

const emptyForm: GroupFormData = {
  name: "",
  type: "community",
  description: "",
};

const GROUP_TYPES = [
  { value: "community", label: "Community" },
  { value: "corporate", label: "Corporate" },
  { value: "church", label: "Church" },
  { value: "cooperative", label: "Cooperative" },
  { value: "other", label: "Other" },
];

export default function StaffGroups() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [formData, setFormData] = useState<GroupFormData>(emptyForm);
  const [assignPolicyId, setAssignPolicyId] = useState("");

  const { data: groupsList, isLoading } = useQuery<Group[]>({
    queryKey: ["/api/groups"],
  });

  const { data: policiesList } = useQuery<Policy[]>({
    queryKey: ["/api/policies"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: GroupFormData) => {
      const res = await apiRequest("POST", "/api/groups", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowCreateDialog(false);
      setFormData(emptyForm);
      toast({ title: "Group created", description: "New group has been added successfully." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<GroupFormData & { isActive: boolean }> }) => {
      const res = await apiRequest("PATCH", `/api/groups/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setShowEditDialog(false);
      toast({ title: "Group updated", description: "Group details have been updated." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const assignPolicyMutation = useMutation({
    mutationFn: async ({ policyId, groupId }: { policyId: string; groupId: string }) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}`, { groupId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setAssignPolicyId("");
      toast({ title: "Policy assigned", description: "Policy has been assigned to the group." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const unassignPolicyMutation = useMutation({
    mutationFn: async (policyId: string) => {
      const res = await apiRequest("PATCH", `/api/policies/${policyId}`, { groupId: null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({ title: "Policy unassigned", description: "Policy has been removed from the group." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const filteredGroups = (groupsList || []).filter((group) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      group.name.toLowerCase().includes(q) ||
      group.type.toLowerCase().includes(q) ||
      (group.description || "").toLowerCase().includes(q)
    );
  });

  const getGroupPolicies = (groupId: string) =>
    (policiesList || []).filter((p) => p.groupId === groupId);

  const getUnassignedPolicies = () =>
    (policiesList || []).filter((p) => !p.groupId);

  const handleCreate = () => {
    if (!formData.name) {
      toast({ title: "Validation", description: "Group name is required.", variant: "destructive" });
      return;
    }
    createMutation.mutate(formData);
  };

  const handleUpdate = () => {
    if (!selectedGroupId) return;
    updateMutation.mutate({ id: selectedGroupId, data: formData });
  };

  const openEdit = (group: Group) => {
    setSelectedGroupId(group.id);
    setFormData({
      name: group.name,
      type: group.type,
      description: group.description || "",
    });
    setShowEditDialog(true);
  };

  const openAssign = (groupId: string) => {
    setSelectedGroupId(groupId);
    setAssignPolicyId("");
    setShowAssignDialog(true);
  };

  const handleAssign = () => {
    if (!assignPolicyId || !selectedGroupId) return;
    assignPolicyMutation.mutate({ policyId: assignPolicyId, groupId: selectedGroupId });
  };

  const selectedGroup = groupsList?.find((g) => g.id === selectedGroupId);

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-groups-title">Groups</h1>
            <p className="text-muted-foreground mt-1">Manage group policies for organizations, churches, and cooperatives.</p>
          </div>
          <Button
            className="gap-2 shadow-sm"
            onClick={() => { setFormData(emptyForm); setShowCreateDialog(true); }}
            data-testid="btn-add-group"
          >
            <Plus className="h-4 w-4" /> New Group
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle>Group Registry</CardTitle>
              <div className="relative w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search groups..."
                  className="pl-9 bg-background"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  data-testid="input-search-groups"
                />
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-8 flex items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredGroups.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground" data-testid="text-no-groups">
                {searchQuery ? "No groups match your search." : "No groups yet. Create your first group."}
              </div>
            ) : (
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="pl-6">Group Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Policies</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right pr-6">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredGroups.map((group) => {
                    const policyCount = getGroupPolicies(group.id).length;
                    return (
                      <TableRow
                        key={group.id}
                        className="hover:bg-muted/30 transition-colors"
                        data-testid={`row-group-${group.id}`}
                      >
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                              <Layers className="h-4 w-4 text-primary" />
                            </div>
                            <div>
                              <p className="font-medium" data-testid={`text-group-name-${group.id}`}>{group.name}</p>
                              {group.description && (
                                <p className="text-xs text-muted-foreground truncate max-w-[200px]">{group.description}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize" data-testid={`badge-group-type-${group.id}`}>
                            {group.type}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <FileStack className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-sm font-medium" data-testid={`text-group-policies-${group.id}`}>{policyCount}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={group.isActive ? "default" : "secondary"} data-testid={`badge-group-status-${group.id}`}>
                            {group.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">
                            {new Date(group.createdAt).toLocaleDateString()}
                          </span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openAssign(group.id)}
                              data-testid={`btn-assign-policy-${group.id}`}
                              title="Assign policies"
                            >
                              <LinkIcon className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEdit(group)}
                              data-testid={`btn-edit-group-${group.id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {filteredGroups.map((group) => {
          const gPolicies = getGroupPolicies(group.id);
          if (gPolicies.length === 0) return null;
          return (
            <Card key={group.id} className="shadow-sm" data-testid={`card-group-detail-${group.id}`}>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Layers className="h-4 w-4" />
                  {group.name} — Assigned Policies ({gPolicies.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead className="pl-6">Policy #</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Premium</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead className="text-right pr-6">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {gPolicies.map((policy) => (
                      <TableRow key={policy.id} data-testid={`row-group-policy-${policy.id}`}>
                        <TableCell className="pl-6">
                          <span className="font-mono text-sm font-medium">{policy.policyNumber}</span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={policy.status === "active" ? "default" : "secondary"}>
                            {policy.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{policy.currency} {parseFloat(policy.premiumAmount).toFixed(2)}</span>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground">{policy.effectiveDate || "—"}</span>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => unassignPolicyMutation.mutate(policy.id)}
                            disabled={unassignPolicyMutation.isPending}
                            data-testid={`btn-unassign-policy-${policy.id}`}
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Group Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Sunrise Community Group"
                data-testid="input-group-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(val) => setFormData({ ...formData, type: val })}>
                <SelectTrigger data-testid="select-group-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description..."
                rows={3}
                data-testid="input-group-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} data-testid="btn-cancel-create-group">
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending} data-testid="btn-submit-group">
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Group Name *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                data-testid="input-edit-group-name"
              />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <Select value={formData.type} onValueChange={(val) => setFormData({ ...formData, type: val })}>
                <SelectTrigger data-testid="select-edit-group-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Description</Label>
              <Textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={3}
                data-testid="input-edit-group-description"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)} data-testid="btn-cancel-edit-group">
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={updateMutation.isPending} data-testid="btn-update-group">
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Assign Policy to {selectedGroup?.name || "Group"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Policy</Label>
              <Select value={assignPolicyId} onValueChange={setAssignPolicyId}>
                <SelectTrigger data-testid="select-assign-policy">
                  <SelectValue placeholder="Choose a policy..." />
                </SelectTrigger>
                <SelectContent>
                  {getUnassignedPolicies().map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.policyNumber} — {p.status} ({p.currency} {parseFloat(p.premiumAmount).toFixed(2)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {getUnassignedPolicies().length === 0 && (
                <p className="text-sm text-muted-foreground">No unassigned policies available.</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAssignDialog(false)} data-testid="btn-cancel-assign">
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              disabled={!assignPolicyId || assignPolicyMutation.isPending}
              data-testid="btn-confirm-assign"
            >
              {assignPolicyMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Assign Policy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
