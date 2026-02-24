import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Filter, MoreHorizontal, FileWarning } from "lucide-react";

const mockClaims = [
  { id: "CLM-2091", policyId: "POL-10029", claimant: "Jane Doe", date: "2023-10-25", status: "PENDING_REVIEW", type: "Death Claim", amount: "$5,000.00" },
  { id: "CLM-2090", policyId: "POL-09882", claimant: "Mark Wilson", date: "2023-10-22", status: "APPROVED", type: "Accidental Death", amount: "$10,000.00" },
  { id: "CLM-2089", policyId: "POL-09111", claimant: "Sarah Johnson", date: "2023-10-20", status: "REJECTED", type: "Death Claim", amount: "$0.00" },
  { id: "CLM-2088", policyId: "POL-10001", claimant: "Emily Davis", date: "2023-10-18", status: "PAID", type: "Death Claim", amount: "$5,000.00" },
];

export default function StaffClaims() {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'APPROVED': 
      case 'PAID': return 'bg-emerald-500/15 text-emerald-700 border-emerald-200';
      case 'PENDING_REVIEW': return 'bg-amber-500/15 text-amber-700 border-amber-200';
      case 'REJECTED': return 'bg-destructive/15 text-destructive border-destructive/30';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Claims</h1>
            <p className="text-muted-foreground mt-1">Manage claim submissions, document verification, and adjudication.</p>
          </div>
          <Button className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" /> Log New Claim
          </Button>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle>Claims Register</CardTitle>
              <div className="flex items-center gap-2">
                <div className="relative w-64">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input placeholder="Search claims..." className="pl-9 bg-background" />
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
                  <TableHead className="pl-6">Claim ID</TableHead>
                  <TableHead>Policy Number</TableHead>
                  <TableHead>Claimant</TableHead>
                  <TableHead>Date Filed</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Payout</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockClaims.map((claim) => (
                  <TableRow key={claim.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium pl-6">
                      <div className="flex items-center gap-2">
                        <FileWarning className="h-4 w-4 text-primary/70" />
                        {claim.id}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{claim.policyId}</TableCell>
                    <TableCell>{claim.claimant}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{claim.date}</TableCell>
                    <TableCell className="text-sm">{claim.type}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`font-medium text-[10px] ${getStatusColor(claim.status)}`}>
                        {claim.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-medium">{claim.amount}</TableCell>
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