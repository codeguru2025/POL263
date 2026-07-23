import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { SearchableSelect, type SearchableOption } from "@/components/searchable-select";
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
  requisitionId: string | null;
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

const CASKET_TYPES = [
  "Flat Lid",
  "Dome",
  "Mini Dome",
  "Executive Dome",
  "2-Tier",
  "3-Tier",
  "Coffin Shaped",
];

const UNITS = ["each", "per km", "per hour", "per day", "per person", "flat rate", "per item"];

export default function StaffPriceBook() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("pricebook");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [showCreateItem, setShowCreateItem] = useState(false);
  const [editingItem, setEditingItem] = useState<PriceBookItem | null>(null);
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

  const { data: requisitions = [] } = useQuery<any[]>({
    queryKey: ["/api/requisitions"],
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

  const updateItemMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/price-book/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/price-book"] });
      setEditingItem(null);
      toast({ title: "Price book item updated" });
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
      <PageShell>
        <PageHeader
          title="Price Book & Cost Sheets"
          description="Manage pricing catalog and generate itemized cost sheets for funeral cases."
          titleDataTestId="text-page-title"
        />

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiStatCard className="bg-primary/5 border-primary/20" label="Price book items" value={<span data-testid="text-pricebook-count">{loadingItems ? "—" : activeItemCount}</span>} icon={BookOpen} />
          <KpiStatCard label="Cost sheets" value={<span data-testid="text-costsheet-count">{loadingSheets ? "—" : costSheets.length}</span>} icon={FileSpreadsheet} />
          <KpiStatCard label="Draft sheets" value={<span data-testid="text-draft-count">{loadingSheets ? "—" : draftSheetCount}</span>} icon={Calculator} />
          <KpiStatCard label="Categories" value={<span data-testid="text-category-count">{loadingItems ? "—" : categories.length}</span>} icon={DollarSign} />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="pricebook" data-testid="tab-pricebook">Price Book</TabsTrigger>
            <TabsTrigger value="costsheets" data-testid="tab-costsheets">Cost Sheets</TabsTrigger>
          </TabsList>

          <TabsContent value="pricebook">
            <CardSection
              title="Price Book Catalog"
              icon={BookOpen}
              headerRight={(
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap sm:justify-end">
                  <div className="relative w-full sm:w-64">
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
                    <SelectTrigger className="w-full sm:w-44" data-testid="select-category-filter">
                      <SelectValue placeholder="All Categories" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Categories</SelectItem>
                      {CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button className="gap-2 shrink-0" onClick={() => setShowCreateItem(true)} data-testid="button-create-pricebook-item">
                    <Plus className="h-4 w-4" /> New Item
                  </Button>
                </div>
              )}
              flush
            >
                {loadingItems ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : filteredItems.length === 0 ? (
                  <EmptyState
                    icon={BookOpen}
                    title="No price book items"
                    description="Create an item or adjust search and category filters."
                    className="border-0 rounded-none bg-transparent py-12"
                  />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Item Name</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Price</TableHead>
                        <TableHead>Effective</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => (
                        <TableRow key={item.id} className="hover:bg-muted/40" data-testid={`row-pricebook-${item.id}`}>
                          <TableCell className="font-medium pl-6">{item.name}</TableCell>
                          <TableCell>
                            {item.category ? (
                              <Badge variant="outline" className="text-[10px]">{item.category}</Badge>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-muted-foreground">{item.unit}</TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
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
                          <TableCell>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setEditingItem(item)}
                              data-testid={`button-edit-pricebook-${item.id}`}
                            >
                              Edit
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="costsheets">
            <div className="grid md:grid-cols-3 gap-6">
              <div className="md:col-span-1">
                <CardSection
                  title="Cost Sheets"
                  icon={FileSpreadsheet}
                  headerRight={(
                    <Button size="sm" className="gap-1" onClick={() => setShowCreateCostSheet(true)} data-testid="button-create-costsheet">
                      <Plus className="h-3 w-3" /> New
                    </Button>
                  )}
                  flush
                >
                    {loadingSheets ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      </div>
                    ) : costSheets.length === 0 ? (
                      <EmptyState
                        icon={FileSpreadsheet}
                        title="No cost sheets yet"
                        description="Create a sheet to start adding line items from the catalog."
                        className="border-0 rounded-none bg-transparent py-8"
                      />
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
                </CardSection>
              </div>

              <div className="md:col-span-2">
                {selectedSheetId && selectedSheet ? (
                  <CardSection
                    title={selectedCase ? `Cost Sheet — ${selectedCase.deceasedName}` : `Cost Sheet #${selectedSheet.id.slice(0, 8)}`}
                    icon={Calculator}
                    description={(
                      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span>
                          Status:{" "}
                          <Badge variant="outline" className="text-[10px] align-middle">{selectedSheet.status}</Badge>
                        </span>
                        {selectedCase ? <span>Case: {selectedCase.caseNumber}</span> : null}
                      </span>
                    )}
                    headerRight={(
                      <Button
                        size="sm"
                        className="gap-1"
                        onClick={() => setShowAddLineItem(true)}
                        disabled={selectedSheet.status === "approved"}
                        data-testid="button-add-line-item"
                      >
                        <Plus className="h-3 w-3" /> Add Item
                      </Button>
                    )}
                    flush
                  >
                      {loadingLineItems ? (
                        <div className="flex items-center justify-center py-8">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : lineItems.length === 0 ? (
                        <EmptyState
                          icon={Calculator}
                          title="No line items yet"
                          description="Add items from the price book catalog."
                          className="border-0 rounded-none bg-transparent py-8"
                        />
                      ) : (
                        <>
                          <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                            <TableHeader className={dataTableStickyHeaderClass}>
                              <TableRow>
                                <TableHead className="pl-6">Description</TableHead>
                                <TableHead className="text-right">Qty</TableHead>
                                <TableHead className="text-right">Unit Price</TableHead>
                                <TableHead className="text-right pr-6">Total</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {lineItems.map((li) => (
                                <TableRow key={li.id} className="hover:bg-muted/40" data-testid={`row-lineitem-${li.id}`}>
                                  <TableCell className="font-medium pl-6">
                                    {li.description}
                                    {li.requisitionId ? (
                                      <Badge variant="outline" className="ml-2 text-[10px] bg-emerald-500/10 text-emerald-700 border-emerald-200">Actual</Badge>
                                    ) : li.priceBookItemId ? (
                                      <Badge variant="outline" className="ml-2 text-[10px]">Estimate</Badge>
                                    ) : null}
                                  </TableCell>
                                  <TableCell className="text-right tabular-nums">{parseFloat(li.quantity).toFixed(0)}</TableCell>
                                  <TableCell className="text-right tabular-nums">
                                    {selectedSheet.currency} {parseFloat(li.unitPrice).toFixed(2)}
                                  </TableCell>
                                  <TableCell className="text-right font-semibold pr-6 tabular-nums">
                                    {selectedSheet.currency} {parseFloat(li.totalPrice).toFixed(2)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </DataTable>
                          <div className="border-t bg-muted/30 px-6 py-4 flex items-center justify-between">
                            <span className="text-sm font-medium text-muted-foreground">Grand Total</span>
                            <span className="text-xl font-display font-bold tabular-nums" data-testid="text-costsheet-total">
                              {selectedSheet.currency} {lineItemsTotal.toFixed(2)}
                            </span>
                          </div>
                        </>
                      )}
                  </CardSection>
                ) : (
                  <CardSection title="Line items" icon={FileSpreadsheet} description="Select a cost sheet on the left to view its line items.">
                    <EmptyState
                      icon={FileSpreadsheet}
                      title="No sheet selected"
                      description="Choose a cost sheet from the list to edit line items."
                      className="border-0 rounded-none bg-transparent py-12"
                    />
                  </CardSection>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </PageShell>

      <CreatePriceBookItemDialog
        open={showCreateItem}
        onClose={() => setShowCreateItem(false)}
        onSubmit={(data) => createItemMut.mutate(data)}
        isPending={createItemMut.isPending}
      />

      {editingItem && (
        <EditPriceBookItemDialog
          key={editingItem.id}
          item={editingItem}
          open={!!editingItem}
          onClose={() => setEditingItem(null)}
          onSubmit={(data) => updateItemMut.mutate({ id: editingItem.id, data })}
          isPending={updateItemMut.isPending}
        />
      )}

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
          requisitions={(selectedSheet?.funeralCaseId
            ? requisitions.filter((r: any) => r.funeralCaseId === selectedSheet.funeralCaseId)
            : requisitions
          ).filter((r: any) => r.status === "paid" && !lineItems.some((li) => li.requisitionId === r.id))}
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
  const [casketType, setCasketType] = useState("");
  const [unit, setUnit] = useState("each");
  const [priceAmount, setPriceAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [category, setCategory] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  const isCasket = category === "Casket & Coffin";
  const effectiveName = isCasket ? (casketType ? `Type of Coffin — ${casketType}` : "") : name;

  const handleSubmit = () => {
    if (!effectiveName || !priceAmount) return;
    onSubmit({
      name: effectiveName,
      unit,
      priceAmount,
      currency,
      category: category || null,
      effectiveFrom: effectiveFrom || null,
      effectiveTo: null,
      isActive: true,
    });
    setName("");
    setCasketType("");
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
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setCasketType(""); setName(""); }}>
              <SelectTrigger id="category" data-testid="select-pricebook-category-top">
                <SelectValue placeholder="Select category first…" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Item Name *</Label>
            {isCasket ? (
              <Select value={casketType} onValueChange={setCasketType} data-testid="select-casket-type">
                <SelectTrigger>
                  <SelectValue placeholder="Select coffin type…" />
                </SelectTrigger>
                <SelectContent>
                  {CASKET_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Removal Fee" data-testid="input-pricebook-name" />
            )}
            {isCasket && casketType && (
              <p className="text-xs text-muted-foreground">Will be saved as: <strong>Type of Coffin — {casketType}</strong></p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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
          <Button onClick={handleSubmit} disabled={isPending || !effectiveName || !priceAmount} data-testid="button-submit-pricebook-item">
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
            <SearchableSelect
              options={funeralCases.map((fc) => ({ value: fc.id, label: `${fc.caseNumber} — ${fc.deceasedName}`, hint: fc.status || undefined }))}
              value={funeralCaseId}
              onChange={(v) => setFuneralCaseId(v === "__none__" ? "" : v)}
              placeholder="Search by case number or deceased name…"
              searchPlaceholder="Search…"
            />
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
  requisitions,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  priceBookItems: PriceBookItem[];
  requisitions: any[];
}) {
  const [selectedItemId, setSelectedItemId] = useState("");
  const [selectedRequisitionId, setSelectedRequisitionId] = useState("");
  const [description, setDescription] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");

  const requisitionOptions: SearchableOption[] = requisitions.map((r: any) => ({
    value: r.id,
    label: `${r.requisitionNumber} — ${r.description} (${r.currency} ${Number(r.amount).toFixed(2)})`,
    hint: r.status || undefined,
  }));

  const handleSelectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    const item = priceBookItems.find((i) => i.id === itemId);
    if (item) {
      setDescription(item.name);
      setUnitPrice(item.priceAmount);
    }
  };

  const handleSelectRequisition = (reqId: string) => {
    const id = reqId === "__none__" ? "" : reqId;
    setSelectedRequisitionId(id);
    const req = requisitions.find((r: any) => r.id === id);
    if (req) {
      setDescription(req.description);
      setUnitPrice(String(req.amount));
      setQuantity("1");
    }
  };

  const total = (parseFloat(quantity || "0") * parseFloat(unitPrice || "0")).toFixed(2);

  const handleSubmit = () => {
    if (!description || !unitPrice) return;
    onSubmit({
      priceBookItemId: selectedItemId || null,
      requisitionId: selectedRequisitionId || null,
      description,
      quantity: quantity || "1",
      unitPrice,
      totalPrice: total,
    });
    setSelectedItemId("");
    setSelectedRequisitionId("");
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
            <Label>From Price Book (estimate — optional)</Label>
            <SearchableSelect
              options={priceBookItems.filter((i) => i.isActive).map((item) => ({
                value: item.id,
                label: `${item.name} — ${item.currency} ${parseFloat(item.priceAmount).toFixed(2)}/${item.unit}`,
              }))}
              value={selectedItemId}
              onChange={handleSelectItem}
              placeholder="Select item to auto-fill…"
              searchPlaceholder="Search…"
            />
          </div>
          <div className="space-y-2">
            <Label>From an Actual Requisition (real cost — optional)</Label>
            <SearchableSelect
              options={requisitionOptions}
              value={selectedRequisitionId}
              onChange={handleSelectRequisition}
              placeholder="Select a paid requisition to auto-fill…"
              searchPlaceholder="Search…"
            />
          </div>
          <div className="space-y-2">
            <Label>Description *</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item description" data-testid="input-lineitem-description" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="quantity">Quantity</Label>
              <Input id="quantity" type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} data-testid="input-lineitem-quantity" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit-price">Unit Price *</Label>
              <Input id="unit-price" type="number" step="0.01" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="0.00" data-testid="input-lineitem-unitprice" />
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

function EditPriceBookItemDialog({
  open,
  onClose,
  onSubmit,
  isPending,
  item,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isPending: boolean;
  item: PriceBookItem;
}) {
  const isCasketInit = item.category === "Casket & Coffin";
  // Support both em dash (UI-created) and plain hyphen (raw SQL inserts)
  const casketTypeInit = isCasketInit
    ? (item.name.replace(/^Type of Coffin\s*[—–-]\s*/, "") !== item.name
        ? item.name.replace(/^Type of Coffin\s*[—–-]\s*/, "")
        : "")
    : "";

  const [casketType, setCasketType] = useState(casketTypeInit);
  const [name, setName] = useState(isCasketInit ? "" : item.name);
  const [unit, setUnit] = useState(item.unit);
  const [priceAmount, setPriceAmount] = useState(item.priceAmount);
  const [currency, setCurrency] = useState(item.currency);
  const [category, setCategory] = useState(item.category || "");
  const [effectiveFrom, setEffectiveFrom] = useState(item.effectiveFrom || "");

  const isCasket = category === "Casket & Coffin";
  // When casket category but no type chosen yet, keep existing name so price-only edits aren't blocked
  const effectiveName = isCasket ? (casketType ? `Type of Coffin — ${casketType}` : item.name) : name;

  const handleSubmit = () => {
    if (!effectiveName || !priceAmount) return;
    onSubmit({ name: effectiveName, unit, priceAmount, currency, category: category || null, effectiveFrom: effectiveFrom || null });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit Price Book Item</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-2">Category</Label>
            <Select value={category} onValueChange={(v) => { setCategory(v); setCasketType(""); setName(""); }}>
              <SelectTrigger id="category-2"><SelectValue placeholder="Select category…" /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((cat) => <SelectItem key={cat} value={cat}>{cat}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Item Name *</Label>
            {isCasket ? (
              <Select value={casketType} onValueChange={setCasketType}>
                <SelectTrigger><SelectValue placeholder="Select coffin type…" /></SelectTrigger>
                <SelectContent>{CASKET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            ) : (
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            )}
            {isCasket && casketType && (
              <p className="text-xs text-muted-foreground">Will be saved as: <strong>Type of Coffin — {casketType}</strong></p>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Unit *</Label>
              <Select value={unit} onValueChange={setUnit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Price *</Label>
              <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-2">
              <Label>Currency</Label>
              <CurrencySelect value={currency} onValueChange={setCurrency} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Effective From</Label>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={isPending || !effectiveName || !priceAmount}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
