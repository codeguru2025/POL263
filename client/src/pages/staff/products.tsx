import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Box, Settings2, MoreHorizontal, ArrowRight } from "lucide-react";

const mockProducts = [
  {
    id: "prod_1",
    name: "Standard Funeral Cover",
    version: "v1.2.0",
    status: "ACTIVE",
    basePremium: "$15.00",
    waitingPeriod: "3 Months",
    updatedAt: "2023-10-15"
  },
  {
    id: "prod_2",
    name: "Premium Family Package",
    version: "v2.0.1",
    status: "ACTIVE",
    basePremium: "$45.00",
    waitingPeriod: "3 Months",
    updatedAt: "2023-10-20"
  },
  {
    id: "prod_3",
    name: "Senior Citizen Plan",
    version: "v1.0.0",
    status: "DRAFT",
    basePremium: "$25.00",
    waitingPeriod: "6 Months",
    updatedAt: "2023-10-24"
  }
];

export default function ProductBuilder() {
  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight">Product Builder</h1>
            <p className="text-muted-foreground mt-1">Configure products, benefits, rules, and pricing engines.</p>
          </div>
          <Button className="gap-2 shadow-sm">
            <Plus className="h-4 w-4" /> Create New Product
          </Button>
        </div>

        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardHeader className="pb-3">
              <Box className="h-8 w-8 text-primary mb-2" />
              <CardTitle className="text-lg">Product Catalog</CardTitle>
              <CardDescription>Manage core offerings</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-display font-bold">12</p>
              <p className="text-xs text-muted-foreground mt-1">Active Products</p>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <Settings2 className="h-8 w-8 text-muted-foreground mb-2" />
              <CardTitle className="text-lg">Global Rules</CardTitle>
              <CardDescription>Waiting & Lapse configs</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full justify-between">
                Configure Rules <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader className="pb-3">
              <Settings2 className="h-8 w-8 text-muted-foreground mb-2" />
              <CardTitle className="text-lg">Age Bands</CardTitle>
              <CardDescription>Pricing modifiers</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" size="sm" className="w-full justify-between">
                Manage Age Bands <ArrowRight className="h-4 w-4 text-muted-foreground" />
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm border-border/60">
          <CardHeader>
            <CardTitle>Configured Products</CardTitle>
            <CardDescription>Strictly versioned product definitions used for policy issuance.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead className="pl-6">Product Name</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Base Premium</TableHead>
                  <TableHead>Waiting Period</TableHead>
                  <TableHead>Last Updated</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockProducts.map((product) => (
                  <TableRow key={product.id} className="hover:bg-muted/30 transition-colors">
                    <TableCell className="font-medium pl-6">{product.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="font-mono text-[10px] bg-background">
                        {product.version}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge 
                        variant={product.status === 'ACTIVE' ? 'default' : 'secondary'}
                        className={product.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/25 border-emerald-200' : ''}
                      >
                        {product.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{product.basePremium}</TableCell>
                    <TableCell>{product.waitingPeriod}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{product.updatedAt}</TableCell>
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