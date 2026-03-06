import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Search, Loader2, BookOpen, DollarSign, FileSpreadsheet,
  Trash2, Calculator,
} from "lucide-react";

type PriceBookItem = {
  id: string;
  organizationId: string;
  branchId: string | null;
  name: string;
  unit: string;
  priceAmount: string;
  currency: string;
  category: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  version: number;
  isActive: boolean;
  createdAt: string;
};

type CostSheet = {
  id: string;
  organizationId: string;
  funeralCaseId: string | null;
  claimId: string | null;
  totalAmount: string | null;
  currency: string;
  status: string;
  approvedBy: string | null;
  createdAt: string;
};

type CostLineItem = {
  id: string;
  costSheetId: string;
  priceBookItemId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  totalPrice: string;
  createdAt: string;
};

type FuneralCase = {
  id: string;
  deceasedName: string;
  caseNumber: string;
  status: string;
};

const CATEGORIES = [
  "Casket & Coffin",
  "Transport",
  "Mortuary Services",
  "Flowers & Wreaths",
  "Venue & Catering",
  "Burial & Cemetery",
  "Documentation",
  "Clothing & Dressing",
  "Religious Services",
  "Other",
];

const UNITS = ["each", "per km", "per hour", "per day", "per person", "flat rate", "per item"];

export default function StaffPriceBook() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pricebook");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [showCreateCostSheet, setShowCreateCostSheet] = useState(false);
  const [selectedSheetId, setSelectedSheetId] = useState<string | null>(null);
  const [showAddLineItem, setShowAddLineItem] = useState(false);

  const { data: priceBookItems = [], isLoading: loadingItems } = useQuery<PriceBookItem[]>({
    queryKey: ["/api/price-book"],
  });

  const { data: costSheets = [], isLoading: loadingSheets } = useQuery<CostSheet[]>({
    queryKey: ["/api/cost-sheets"],
  });

  const { data: funeralCases = [] } = useQuery<FuneralCase[]>({
    queryKey: ["/api/funeral-cases"],
  });

  const { data: lineItems = [], isLoading: loadingLineItems } = useQuery<CostLineItem[]>({
    queryKey: [`/api/cost-sheets/${selectedSheetId}/items`],
    enabled: !!selectedSheetId,
  });

  const createItemMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/price-book", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-book"] });
      setShowCreateItem(false);
      toast({ title: "Price book item created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createCostSheetMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/cost-sheets", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cost-sheets"] });
      setShowCreateCostSheet(false);
      toast({ title: "Cost sheet created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const addLineItemMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", `/api/cost-sheets/${selectedSheetId}/items`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/cost-sheets/${selectedSheetId}/items`] });
      queryClient.invalidateQueries({ queryKey: ["/api/cost-sheets"] });
      setShowAddLineItem(false);
      toast({ title: "Line item added" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredItems = priceBookItems.filter((item) => {
    const matchesSearch = item.name.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = categoryFilter === "all" || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const activeItemCount = priceBookItems.filter((i) => i.isActive).length;
  const draftSheetCount = costSheets.filter((s) => s.status === "draft").length;
  const categories = Array.from(new Set(priceBookItems.map((i) => i.category).filter(Boolean))) as string[];

  const selectedSheet = costSheets.find((s) => s.id === selectedSheetId);
  const selectedCase = selectedSheet?.funeralCaseId
    ? funeralCases.find((c) => c.id === selectedSheet.funeralCaseId)
    : null;

  const lineItemsTotal = lineItems.reduce((sum, li) => sum + parseFloat(li.totalPrice || "0"), 0);

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-page-title">
              Price Book & Cost Sheets
            </h1>
            <p className="text-muted-foreground mt-1">
              Manage pricing catalog and generate itemized cost sheets for funeral cases.
            </p>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardHeader className="pb-2">
              <BookOpen className="h-6 w-6 text-primary mb-1" />
              <CardDescription>Price Book Items</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-display font-bold" data-testid="text-pricebook-count">
                {loadingItems ? "—" : activeItemCount}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <FileSpreadsheet className="h-6 w-6 text-muted-foreground mb-1" />
              <CardDescription>Cost Sheets</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-display font-bold" data-testid="text-costsheet-count">
                {loadingSheets ? "—" : costSheets.length}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <Calculator className="h-6 w-6 text-muted-foreground mb-1" />
              <CardDescription>Draft Sheets</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-display font-bold" data-testid="text-draft-count">
                {loadingSheets ? "—" : draftSheetCount}
              </p>
            </CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <DollarSign className="h-6 w-6 text-muted-foreground mb-1" />
              <CardDescription>Categories</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-display font-bold" data-testid="text-category-count">
                {loadingItems ? "—" : categories.length}
              </p>
            </CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="pricebook" data-testid="tab-pricebook">Price Book</TabsTrigger>
            <TabsTrigger value="costsheets" data-testid="tab-costsheets">Cost Sheets</TabsTrigger>
          </TabsList>

          <TabsContent value="pricebook">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle>Price Book Catalog</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Search items..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        data-testid="input-search-pricebook"
                      />
                    </div>
                    <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                      <SelectTrigger className="w-44" data-testid="select-category-filter">
                        <SelectValue placeholder="All Categories" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        {CATEGORIES.map((cat) => (
                          <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button className="gap-2" onClick={() => setShowCreateItem(true)} data-testid="button-create-pricebook-item">
                      <Plus className="h-4 w-4" /> New Item
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingItems ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredItems.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-40" />
                    <p>No price book items found</p>
                  </div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Item Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => (
                        <TableRow key={item.id} data-testid={`row-pricebook-${item.id}`}>
                          <TableCell className="font-medium pl-6">{item.name}</TableCell>
                          <TableCell>
                            {item.category ? (
                              <Badge variant="outline" className="text-[10px]">{item.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                          <TableCell className="text-right font-semibold">
                            {item.currency} {parseFloat(item.priceAmount).toFixed(2)}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {item.effectiveFrom || "—"} {item.effectiveTo ? `→ ${item.effectiveTo}` : ""}
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono text-[10px]">v{item.version}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={item.isActive ? "default" : "secondary"}
                              className={item.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}
                            >
                              {item.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="costsheets">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <Card className="shadow-sm">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base">Cost Sheets</CardTitle>
                      <Button size="sm" className="gap-1" onClick={() => setShowCreateCostSheet(true)} data-testid="button-create-costsheet">
                        <Plus className="h-3 w-3" /> New
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="p-0">
                    {loadingSheets ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : costSheets.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground text-sm">
                        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-40" />
                        <p>No cost sheets yet</p>
                      </div>
                    ) : (
                      <div className="divide-y max-h-[500px] overflow-auto">
                        {costSheets.map((sheet) => {
                          const fc = sheet.funeralCaseId
                            ? funeralCases.find((c) => c.id === sheet.funeralCaseId)
                            : null;
                          const isSelected = selectedSheetId === sheet.id;
                          return (
                            <button
                              key={sheet.id}
                              className={`w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors ${isSelected ? "bg-primary/5 border-l-2 border-l-primary" : ""}`}
                              onClick={() => setSelectedSheetId(sheet.id)}
                              data-testid={`costsheet-select-${sheet.id}`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium truncate">
                                  {fc ? fc.deceasedName : `Sheet #${sheet.id.slice(0, 8)}`}
                                </span>
                                <Badge
                                  variant="outline"
                                  className={
                                    sheet.status === "approved"
                                      ? "bg-emerald-500/15 text-emerald-700 border-emerald-200 text-[10px]"
                                      : sheet.status === "draft"
                                      ? "bg-amber-500/15 text-amber-700 border-amber-200 text-[10px]"
                                      : "text-[10px]"
                                  }
                                >
                                  {sheet.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground mt-1">
                                {sheet.currency} {parseFloat(sheet.totalAmount || "0").toFixed(2)} · {new Date(sheet.createdAt).toLocaleDateString()}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="md:col-span-2">
                {selectedSheetId && selectedSheet ? (
                  <Card className="shadow-sm">
                    <CardHeader className="pb-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle>
                            {selectedCase ? `Cost Sheet — ${selectedCase.deceasedName}` : `Cost Sheet #${selectedSheet.id.slice(0, 8)}`}
                          </CardTitle>
                          <CardDescription className="mt-1">
                            Status: <Badge variant="outline" className="ml-1 text-[10px]">{selectedSheet.status}</Badge>
                            {selectedCase && (
                              <span className="ml-3">Case: {selectedCase.caseNumber}</span>
                            )}
                          </CardDescription>
                        </div>
                        <Button
                          size="sm"
                          className="gap-1"
                          onClick={() => setShowAddLineItem(true)}
                          disabled={selectedSheet.status === "approved"}
                          data-testid="button-add-line-item"
                        >
                          <Plus className="h-3 w-3" /> Add Item
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0">
                      {loadingLineItems ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : lineItems.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground text-sm">
                          <Calculator className="h-8 w-8 mx-auto mb-2 opacity-40" />
                          <p>No line items yet. Add items from the price book.</p>
                        </div>
                      ) : (
                        <>
                          <Table>
                            <TableHeader className="bg-muted/50">
                              <TableRow>
                                <TableHead className="pl-6">Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Unit Price</TableHead>
                                <TableHead className="text-right pr-6">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {lineItems.map((li) => (
                                <TableRow key={li.id} data-testid={`row-lineitem-${li.id}`}>
                                  <TableCell className="font-medium pl-6">{li.description}</TableCell>
                                  <TableCell className="text-right">{parseFloat(li.quantity).toFixed(0)}</TableCell>
                                  <TableCell className="text-right">
                                    {selectedSheet.currency} {parseFloat(li.unitPrice).toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold pr-6">
                                    {selectedSheet.currency} {parseFloat(li.totalPrice).toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          <div className="border-t bg-muted/30 px-6 py-4 flex items-center justify-between">
                            <span className="text-sm font-medium text-muted-foreground">Grand Total</span>
                            <span className="text-xl font-display font-bold" data-testid="text-costsheet-total">
                              {selectedSheet.currency} {lineItemsTotal.toFixed(2)}
                            </span>
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                ) : (
                  <Card className="shadow-sm">
                    <CardContent className="flex items-center justify-center py-20 text-muted-foreground">
                      <div className="text-center">
                        <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">Select a cost sheet to view its line items</p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      <CreatePriceBookItemDialog
        open={showCreateItem}
        onClose={() => setShowCreateItem(false)}
        onSubmit={(data) => createItemMut.mutate(data)}
        isPending={createItemMut.isPending}
      />

      <CreateCostSheetDialog
        open={showCreateCostSheet}
        onClose={() => setShowCreateCostSheet(false)}
        onSubmit={(data) => createCostSheetMut.mutate(data)}
        isPending={createCostSheetMut.isPending}
        funeralCases={funeralCases}
      />

      {selectedSheetId && (
        <AddLineItemDialog
          open={showAddLineItem}
          onClose={() => setShowAddLineItem(false)}
          onSubmit={(data) => addLineItemMut.mutate(data)}
          isPending={addLineItemMut.isPending}
          priceBookItems={priceBookItems}
        />
      )}
    </StaffLayout>
  );
}

function CreatePriceBookItemDialog({
  open,
  onClose,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("each");
  const [priceAmount, setPriceAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const handleSubmit = () => {
    if (!name || !priceAmount) return;
    onSubmit({
      name,
      unit,
      priceAmount,
      currency,
      category: category || null,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: null,
      isActive: true,
    });
    setName("");
    setUnit("each");
    setPriceAmount("");
    setCurrency("USD");
    setCategory("");
    setEffectiveFrom("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Price Book Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Item Name *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Standard Casket" data-testid="input-pricebook-name" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-pricebook-category">
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger data-testid="select-pricebook-unit">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => (
                    <SelectItem key={u} value={u}>{u}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Price *</Label>
              <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder="0.00" data-testid="input-pricebook-price" />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <CurrencySelect value={currency} onValueChange={setCurrency} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Effective From</Label>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="input-pricebook-effective" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !name || !priceAmount} data-testid="button-submit-pricebook-item">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateCostSheetDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  funeralCases,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  funeralCases: FuneralCase[];
}) {
  const [funeralCaseId, setFuneralCaseId] = useState("");
  const [currency, setCurrency] = useState("USD");

  const handleSubmit = () => {
    onSubmit({
      funeralCaseId: funeralCaseId || null,
      claimId: null,
      currency,
      status: "draft",
      totalAmount: "0",
    });
    setFuneralCaseId("");
    setCurrency("USD");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New Cost Sheet</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Funeral Case (optional)</Label>
            <Select value={funeralCaseId} onValueChange={setFuneralCaseId}>
              <SelectTrigger data-testid="select-costsheet-case">
                <SelectValue placeholder="Select funeral case..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No linked case</SelectItem>
                {funeralCases.map((fc) => (
                  <SelectItem key={fc.id} value={fc.id}>
                    {fc.deceasedName} ({fc.caseNumber})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Currency</Label>
            <CurrencySelect value={currency} onValueChange={setCurrency} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending} data-testid="button-submit-costsheet">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Create Sheet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddLineItemDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  priceBookItems,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  priceBookItems: PriceBookItem[];
}) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    const item = priceBookItems.find((i) => i.id === itemId);
    if (item) {
      setDescription(item.name);
      setUnitPrice(item.priceAmount);
    }
  };

  const total = (parseFloat(quantity || "0") * parseFloat(unitPrice || "0")).toFixed(2);

  const handleSubmit = () => {
    if (!description || !unitPrice) return;
    onSubmit({
      priceBookItemId: selectedItemId || null,
      description,
      quantity: quantity || "1",
      unitPrice,
      totalPrice: total,
    });
    setSelectedItemId("");
    setDescription("");
    setQuantity("1");
    setUnitPrice("");
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Line Item</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>From Price Book (optional)</Label>
            <Select value={selectedItemId} onValueChange={handleSelectItem}>
              <SelectTrigger data-testid="select-lineitem-pricebook">
                <SelectValue placeholder="Select item to auto-fill..." />
              </SelectTrigger>
              <SelectContent>
                {priceBookItems.filter((i) => i.isActive).map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name} — {item.currency} {parseFloat(item.priceAmount).toFixed(2)}/{item.unit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Description *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item description" data-testid="input-lineitem-description" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Quantity</Label>
              <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-lineitem-quantity" />
            </div>
            <div className="space-y-2">
              <Label>Unit Price *</Label>
              <Input type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" data-testid="input-lineitem-unitprice" />
            </div>
          </div>
          <div className="bg-muted/50 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Line Total</span>
            <span className="font-display font-bold text-lg" data-testid="text-lineitem-total">{total}</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !description || !unitPrice} data-testid="button-submit-lineitem">
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Add Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
