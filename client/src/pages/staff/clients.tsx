import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Search, Filter, MoreHorizontal, Mail, Phone } from "lucide-react";

const mockClients = [
  { id: "CL-8849", name: "Jane Doe", email: "jane.doe@example.com", phone: "+1 (555) 123-4567", policies: 1, status: "Active" },
  { id: "CL-8850", name: "Michael Smith", email: "msmith@example.com", phone: "+1 (555) 987-6543", policies: 2, status: "Active" },
  { id: "CL-8851", name: "Sarah Johnson", email: "s.johnson@example.com", phone: "+1 (555) 456-7890", policies: 1, status: "Inactive" },
  { id: "CL-8852", name: "David Brown", email: "davidb@example.com", phone: "+1 (555) 222-3333", policies: 0, status: "Prospect" },
];

export default function StaffClients() {
  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Clients</h1>
            <p className="text-muted-foreground mt-1">Manage policyholders and their communication preferences.</p>
          </div>
          <Button className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" /> Add New Client
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Client Registry</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search clients..." className="pl-9 bg-background" />
                </div>
                <Button variant="outline" size="icon">
                  <Filter className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Client</TableHead>
                  <TableHead>Contact Info</TableHead>
                  <TableHead>Active Policies</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockClients.map((client) => (
                  <TableRow key={client.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9">
                          <AvatarFallback className="bg-primary/10 text-primary font-medium">
                            {client.name.split(' ').map(n => n[0]).join('')}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium">{client.name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{client.id}</p>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Mail className="h-3 w-3" /> {client.email}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <Phone className="h-3 w-3" /> {client.phone}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-center w-8 bg-muted rounded-md py-1">
                        {client.policies}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        client.status === 'Active' ? 'bg-green-100 text-green-800' : 
                        client.status === 'Inactive' ? 'bg-red-100 text-red-800' : 
                        'bg-gray-100 text-gray-800'
                      }`}>
                        {client.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </StaffLayout>
  );
}