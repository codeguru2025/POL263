import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Check } from "lucide-react";

export default function StaffSettings() {
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
                      <img src="/assets/logo.png" alt="Current Logo" className="object-contain" />
                    </div>
                    <Button variant="outline">Upload New Logo</Button>
                  </div>
                </div>

                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="orgName">Organization Name</Label>
                    <Input id="orgName" defaultValue="Acme Corp Properties" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="primaryColor">Primary Color (Hex)</Label>
                    <div className="flex gap-2">
                      <div className="h-10 w-10 rounded border" style={{ backgroundColor: '#2563EB' }}></div>
                      <Input id="primaryColor" defaultValue="#2563EB" className="font-mono flex-1" />
                    </div>
                  </div>
                </div>

                <Button>Save Branding Changes</Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="rbac" className="mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle>Role Permissions Mapping</CardTitle>
                <CardDescription>Manage DB-driven RBAC mapping for server-side guards.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="w-[200px]">Permission \ Role</TableHead>
                        <TableHead className="text-center">Superuser</TableHead>
                        <TableHead className="text-center">Manager</TableHead>
                        <TableHead className="text-center">Staff</TableHead>
                        <TableHead className="text-center">Viewer</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[
                        "read:property", "write:property", "delete:property",
                        "read:lease", "write:lease", 
                        "read:audit_log", "manage:settings"
                      ].map((perm) => (
                        <TableRow key={perm}>
                          <TableCell className="font-mono text-xs">{perm}</TableCell>
                          <TableCell className="text-center text-primary"><Check className="h-4 w-4 mx-auto" /></TableCell>
                          <TableCell className="text-center">
                            {perm.includes('read') || perm.includes('write') ? <Check className="h-4 w-4 mx-auto text-primary" /> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {perm.includes('read') || perm === 'write:lease' ? <Check className="h-4 w-4 mx-auto text-primary" /> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                          <TableCell className="text-center">
                            {perm.includes('read') && !perm.includes('audit') ? <Check className="h-4 w-4 mx-auto text-primary" /> : <span className="text-muted-foreground">-</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-6 flex items-center justify-between p-4 bg-muted/30 rounded-lg border">
                  <div>
                    <h4 className="font-medium text-sm">Allow Per-User Overrides</h4>
                    <p className="text-xs text-muted-foreground mt-1">Enable assigning explicit permissions directly to users overriding their roles.</p>
                  </div>
                  <Switch checked={true} />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </StaffLayout>
  );
}