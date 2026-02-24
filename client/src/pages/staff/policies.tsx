import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Filter, MoreHorizontal, FileText } from "lucide-react";

const mockPolicies = [
  { id: "POL-10029", client: "Jane Doe", product: "Standard Funeral Cover", status: "ACTIVE", premium: "$15.00/mo", nextDue: "2023-11-01" },
  { id: "POL-10030", client: "Michael Smith", product: "Premium Family Package", status: "GRACE", premium: "$45.00/mo", nextDue: "2023-10-15 (Overdue)" },
  { id: "POL-10031", client: "Sarah Johnson", product: "Senior Citizen Plan", status: "LAPSED", premium: "$25.00/mo", nextDue: "-" },
  { id: "POL-10032", client: "David Brown", product: "Standard Funeral Cover", status: "PENDING", premium: "$15.00/mo", nextDue: "-" },
];

export default function StaffPolicies() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'bg-emerald-500/15 text-emerald-700 border-emerald-200';
      case 'GRACE': return 'bg-amber-500/15 text-amber-700 border-amber-200';
      case 'LAPSED': return 'bg-destructive/15 text-destructive border-destructive/30';
      case 'PENDING': return 'bg-blue-500/15 text-blue-700 border-blue-200';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Policies</h1>
            <p className="text-muted-foreground mt-1">Manage policy lifecycles, billing cycles, and status transitions.</p>
          </div>
          <Button className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" /> Issue New Policy
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Policy Directory</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search by policy number or client..." className="pl-9 bg-background" />
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
                  <TableHead className="pl-6">Policy Number</TableHead>
                  <TableHead>Client Name</TableHead>
                  <TableHead>Product Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Premium</TableHead>
                  <TableHead>Next Cycle Due</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockPolicies.map((policy) => (
                  <TableRow key={policy.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium pl-6">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary/70" />
                        {policy.id}
                      </div>
                    </TableCell>
                    <TableCell>{policy.client}</TableCell>
                    <TableCell className="text-muted-foreground">{policy.product}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-medium ${getStatusColor(policy.status)}`}>
                        {policy.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{policy.premium}</TableCell>
                    <TableCell className={policy.status === 'GRACE' ? 'text-destructive font-medium' : 'text-muted-foreground'}>
                      {policy.nextDue}
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