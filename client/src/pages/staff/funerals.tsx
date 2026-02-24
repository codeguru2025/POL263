import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Filter, MoreHorizontal, Car, Box } from "lucide-react";

const mockFunerals = [
  { id: "FUN-501", name: "John Doe Funeral", date: "2023-10-30", status: "SCHEDULED", branch: "HQ - New York", vehicle: "Hearse 01 (V-102)" },
  { id: "FUN-500", name: "Mary Smith Funeral", date: "2023-10-28", status: "IN_PROGRESS", branch: "HQ - New York", vehicle: "Hearse 02 (V-104)" },
  { id: "FUN-499", name: "Robert Jones Funeral", date: "2023-10-25", status: "COMPLETED", branch: "HQ - New York", vehicle: "Hearse 01 (V-102)" },
];

export default function StaffFunerals() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'COMPLETED': return 'bg-emerald-500/15 text-emerald-700 border-emerald-200';
      case 'IN_PROGRESS': return 'bg-blue-500/15 text-blue-700 border-blue-200';
      case 'SCHEDULED': return 'bg-amber-500/15 text-amber-700 border-amber-200';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Funeral Operations</h1>
            <p className="text-muted-foreground mt-1">Manage funeral cases, logistics, fleet dispatch, and resource allocation.</p>
          </div>
          <Button className="gap-2 shadow-sm">
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
              <p className="text-3xl font-display font-bold">4</p>
              <p className="text-xs text-muted-foreground mt-1">Requiring immediate attention</p>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <Car className="h-8 w-8 text-muted-foreground mb-2" />
              <CardTitle className="text-lg">Fleet Utilization</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold">2/5</p>
              <p className="text-xs text-muted-foreground mt-1">Vehicles currently dispatched</p>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Logistics Board</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search cases..." className="pl-9 bg-background" />
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
                  <TableHead className="pl-6">Case ID</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Scheduled Date</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Vehicle Assignment</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockFunerals.map((caseItem) => (
                  <TableRow key={caseItem.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium pl-6">{caseItem.id}</TableCell>
                    <TableCell>{caseItem.name}</TableCell>
                    <TableCell className="text-muted-foreground">{caseItem.date}</TableCell>
                    <TableCell className="text-sm">{caseItem.branch}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Car className="h-3 w-3" /> {caseItem.vehicle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-medium text-[10px] ${getStatusColor(caseItem.status)}`}>
                        {caseItem.status}
                      </Badge>
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