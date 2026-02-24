import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check, Loader2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";

export default function StaffSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: orgs } = useQuery<any[]>({
    queryKey: ["/api/organizations"],
  });

  const { data: rolesList } = useQuery<any[]>({
    queryKey: ["/api/roles"],
  });

  const { data: permsList } = useQuery<any[]>({
    queryKey: ["/api/permissions"],
  });

  const currentOrg = orgs?.[0];

  const [orgName, setOrgName] = useState("");
  const [primaryColor, setPrimaryColor] = useState("");
  const [footerText, setFooterText] = useState("");

  const updateOrgMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/organizations/${currentOrg?.id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/organizations"] });
    },
  });

  const handleSaveBranding = () => {
    const updates: any = {};
    if (orgName) updates.name = orgName;
    if (primaryColor) updates.primaryColor = primaryColor;
    if (footerText) updates.footerText = footerText;
    updateOrgMutation.mutate(updates);
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-display font-bold">Settings</h1>
          <p className="text-muted-foreground mt-1">Manage organization settings and Role-Based Access Control.</p>
        </div>

        <Tabs defaultValue="branding" className="w-full">
          <TabsList className="grid w-full grid-cols-2 max-w-md">
            <TabsTrigger value="branding">Tenant Branding</TabsTrigger>
            <TabsTrigger value="rbac">RBAC Configuration</TabsTrigger>
          </TabsList>

          <TabsContent value="branding" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Organization Branding</CardTitle>
                <CardDescription>Customize the look and feel for this specific tenant.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <Label>Organization Logo</Label>
                  <div className="flex items-end gap-6">
                    <div className="h-24 w-24 rounded-xl border-2 border-dashed flex items-center justify-center bg-muted/20 overflow-hidden">
                      <img
                        src={currentOrg?.logoUrl || "/assets/logo.png"}
                        alt="Current Logo"
                        className="object-contain"
                      />
                    </div>
                    <Button variant="outline">Upload New Logo</Button>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input
                      id="orgName"
                      defaultValue={currentOrg?.name || ""}
                      onChange={(e) => setOrgName(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="primaryColor">Primary Color (Hex)</Label>
                    <div className="flex gap-2">
                      <div
                        className="h-10 w-10 rounded border"
                        style={{ backgroundColor: primaryColor || currentOrg?.primaryColor || "#2563EB" }}
                      ></div>
                      <Input
                        id="primaryColor"
                        defaultValue={currentOrg?.primaryColor || "#2563EB"}
                        className="font-mono flex-1"
                        onChange={(e) => setPrimaryColor(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="footerText">Footer Text</Label>
                    <Input
                      id="footerText"
                      defaultValue={currentOrg?.footerText || ""}
                      onChange={(e) => setFooterText(e.target.value)}
                    />
                  </div>
                </div>

                <Button onClick={handleSaveBranding} disabled={updateOrgMutation.isPending}>
                  {updateOrgMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                    </>
                  ) : (
                    "Save Branding Changes"
                  )}
                </Button>
                {updateOrgMutation.isSuccess && (
                  <p className="text-sm text-emerald-600 flex items-center gap-1">
                    <Check className="h-4 w-4" /> Saved successfully. Audit log entry created.
                  </p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rbac" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Role Permissions Mapping</CardTitle>
                <CardDescription>
                  Live DB-driven RBAC configuration. Roles and permissions are fetched from the database.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {rolesList && permsList ? (
                  <div className="border rounded-md overflow-hidden overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/50">
                        <TableRow>
                          <TableHead className="w-[200px] sticky left-0 bg-muted/50 z-10">Permission</TableHead>
                          {rolesList.map((role: any) => (
                            <TableHead key={role.id} className="text-center capitalize min-w-[100px]">
                              {role.name}
                            </TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {permsList.map((perm: any) => (
                          <RBACPermissionRow key={perm.id} permission={perm} roles={rolesList} />
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </StaffLayout>
  );
}

function RBACPermissionRow({ permission, roles }: { permission: any; roles: any[] }) {
  const rolePermQueries = roles.map((role: any) => {
    const { data: rolePerms } = useQuery<any[]>({
      queryKey: [`/api/roles/${role.id}/permissions`],
      staleTime: 60000,
    });
    return { role, perms: rolePerms };
  });

  return (
    <TableRow>
      <TableCell className="font-mono text-xs sticky left-0 bg-card z-10">{permission.name}</TableCell>
      {rolePermQueries.map(({ role, perms }) => {
        if (role.name === "superuser") {
          return (
            <TableCell key={role.id} className="text-center text-primary">
              <Check className="h-4 w-4 mx-auto" />
            </TableCell>
          );
        }
        const hasPerm = perms?.some((p: any) => p.id === permission.id);
        return (
          <TableCell key={role.id} className="text-center">
            {perms === undefined ? (
              <Loader2 className="h-3 w-3 animate-spin mx-auto" />
            ) : hasPerm ? (
              <Check className="h-4 w-4 mx-auto text-primary" />
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
        );
      })}
    </TableRow>
  );
}