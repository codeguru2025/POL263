import { useState, useRef } from "react";
import { cn } from "@/lib/utils";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase, getCsrfToken } from "@/lib/queryClient";
import { resolveAssetUrl } from "@/lib/assetUrl";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { formatAmount } from "@shared/validation";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Box, Search, Loader2, Package, Layers, Puzzle, BarChart3,
  Edit, ChevronDown, ChevronUp, Upload, Image, Users, Baby, Crown,
  FileText, Trash2, RefreshCw, AlertTriangle,
} from "lucide-react";

type Product = {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  description: string | null;
  maxAdults: number | null;
  maxChildren: number | null;
  maxExtendedMembers: number | null;
  maxAdditionalMembers: number | null;
  casketType: string | null;
  casketImageUrl: string | null;
  coverAmount: string | null;
  coverCurrency: string | null;
  isActive: boolean;
  createdAt: string;
};

type ProductVersion = {
  id: string;
  productId: string;
  version: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  premiumMonthlyUsd: string | null;
  premiumMonthlyZar: string | null;
  premiumWeeklyUsd: string | null;
  premiumWeeklyZar: string | null;
  premiumBiweeklyUsd: string | null;
  premiumBiweeklyZar: string | null;
  eligibilityMinAge: number | null;
  eligibilityMaxAge: number | null;
  dependentMaxAge: number | null;
  waitingPeriodDays: number | null;
  waitingPeriodAccidentalDeath: number | null;
  waitingPeriodSuicide: number | null;
  gracePeriodDays: number | null;
  cashInLieuAdult: string | null;
  cashInLieuChild: string | null;
  commissionFirstMonthsCount: number | null;
  commissionFirstMonthsRate: string | null;
  commissionRecurringStartMonth: number | null;
  commissionRecurringRate: string | null;
  commissionClawbackThreshold: number | null;
  commissionFuneralIncentive: string | null;
  underwriterAmountAdult: string | null;
  underwriterAmountChild: string | null;
  underwriterAdvanceMonths: number;
  additionalMemberPremiumMonthlyUsd: string | null;
  additionalMemberPremiumMonthlyZar: string | null;
  additionalMemberRateChildUsd: string | null;
  additionalMemberRateChildZar: string | null;
  additionalMemberRate21To65Usd: string | null;
  additionalMemberRate21To65Zar: string | null;
  additionalMemberRate66To84Usd: string | null;
  additionalMemberRate66To84Zar: string | null;
  additionalMemberRate85PlusUsd: string | null;
  additionalMemberRate85PlusZar: string | null;
  reinstatementRequiresArrears: boolean | null;
  reinstatementNewWaitingPeriod: boolean | null;
  isActive: boolean;
};

type BenefitCatalogItem = { id: string; name: string; description: string | null; internalCostDefault: string | null; isActive: boolean; };
type BenefitBundle = { id: string; name: string; description: string | null; items: unknown; isActive: boolean; };
type AddOn = { id: string; name: string; description: string | null; pricingMode: string; priceAmount: string | null; priceMonthly: string | null; priceWeekly: string | null; priceBiweekly: string | null; isActive: boolean; };
type AgeBandConfig = { id: string; name: string; minAge: number; maxAge: number; version: number; effectiveFrom: string | null; isActive: boolean; };

const CASKET_TYPES = [
  "Standard Flat Lid",
  "Standard Dome Lid",
  "Semi-Casket",
  "Full Casket",
  "Premium Casket",
  "Presidential Casket",
  "Child Casket",
  "Infant Pod",
  "Eco-Friendly",
  "Custom",
];

export default function ProductBuilder() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("products");
  const [search, setSearch] = useState("");
  const [showCreateProduct, setShowCreateProduct] = useState(false);
  const [showCreateVersion, setShowCreateVersion] = useState<string | null>(null);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);
  const [showCreateBenefit, setShowCreateBenefit] = useState(false);
  const [showCreateBundle, setShowCreateBundle] = useState(false);
  const [showCreateAddOn, setShowCreateAddOn] = useState(false);
  const [showCreateAgeBand, setShowCreateAgeBand] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingAddOn, setEditingAddOn] = useState<AddOn | null>(null);
  const [editingBenefit, setEditingBenefit] = useState<BenefitCatalogItem | null>(null);
  const [editingBundle, setEditingBundle] = useState<BenefitBundle | null>(null);
  const [editingAgeBand, setEditingAgeBand] = useState<AgeBandConfig | null>(null);
  const [showCreateTerm, setShowCreateTerm] = useState(false);
  const [termProductVersionId, setTermProductVersionId] = useState<string>("");
  const [editingTerm, setEditingTerm] = useState<any>(null);
  const [editingVersion, setEditingVersion] = useState<ProductVersion | null>(null);

  const { data: products = [], isLoading: loadingProducts } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: benefitCatalog = [], isLoading: loadingBenefits } = useQuery<BenefitCatalogItem[]>({ queryKey: ["/api/benefit-catalog"] });
  const { data: benefitBundles = [], isLoading: loadingBundles } = useQuery<BenefitBundle[]>({ queryKey: ["/api/benefit-bundles"] });
  const { data: addOns = [], isLoading: loadingAddOns } = useQuery<AddOn[]>({ queryKey: ["/api/add-ons"] });
  const { data: ageBands = [], isLoading: loadingAgeBands } = useQuery<AgeBandConfig[]>({ queryKey: ["/api/age-bands"] });

  const { data: termsList = [], isLoading: loadingTerms } = useQuery<any[]>({ queryKey: ["/api/terms?all=true"] });

  const createProductMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      const res = await apiRequest("POST", "/api/products", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setShowCreateProduct(false);
      toast({ title: "Product created successfully" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateProductMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/products/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      setEditingProduct(null);
      toast({ title: "Product updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteProductMut = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/products/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-versions"] });
      setProductToDelete(null);
      toast({ title: "Product deleted" });
    },
    onError: (err: Error) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const createVersionMut = useMutation({
    mutationFn: async ({ productId, data }: { productId: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("POST", `/api/products/${productId}/versions`, data);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: [`/api/products/${vars.productId}/versions`] });
      setShowCreateVersion(null);
      toast({ title: "Version created" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateVersionMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/product-versions/${id}`, data);
      return res.json();
    },
    onSuccess: (_d, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/products"] });
      queryClient.invalidateQueries({ queryKey: ["/api/product-versions"] });
      if (editingVersion) queryClient.invalidateQueries({ queryKey: [`/api/products/${editingVersion.productId}/versions`] });
      setEditingVersion(null);
      toast({ title: "Version updated" });
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const recalcPremiumsMut = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/product-versions/${versionId}/recalculate-premiums`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      toast({ title: `Premiums recalculated`, description: `${data.updated} of ${data.total} policies updated.` });
    },
    onError: (err: Error) => toast({ title: "Recalculate failed", description: err.message, variant: "destructive" }),
  });

  const createBenefitMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => { const res = await apiRequest("POST", "/api/benefit-catalog", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/benefit-catalog"] }); setShowCreateBenefit(false); toast({ title: "Benefit item created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createBundleMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => { const res = await apiRequest("POST", "/api/benefit-bundles", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/benefit-bundles"] }); setShowCreateBundle(false); toast({ title: "Bundle created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createAddOnMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => { const res = await apiRequest("POST", "/api/add-ons", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/add-ons"] }); setShowCreateAddOn(false); toast({ title: "Add-on created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateAddOnMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/add-ons/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/add-ons"] }); setEditingAddOn(null); toast({ title: "Add-on updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateBenefitMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/benefit-catalog/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/benefit-catalog"] }); setEditingBenefit(null); toast({ title: "Benefit updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateBundleMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/benefit-bundles/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/benefit-bundles"] }); setEditingBundle(null); toast({ title: "Bundle updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateAgeBandMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/age-bands/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/age-bands"] }); setEditingAgeBand(null); toast({ title: "Age band updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createTermMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => { const res = await apiRequest("POST", "/api/terms", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] }); setShowCreateTerm(false); toast({ title: "Term created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const updateTermMut = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Record<string, unknown> }) => { const res = await apiRequest("PATCH", `/api/terms/${id}`, data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] }); setEditingTerm(null); toast({ title: "Term updated" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });
  const deleteTermMut = useMutation({
    mutationFn: async (id: string) => { await apiRequest("DELETE", `/api/terms/${id}`); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/terms?all=true"] }); toast({ title: "Term deleted" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const { data: allProductVersions = [] } = useQuery<{ id: string; productName: string; version: number }[]>({ queryKey: ["/api/product-versions"] });

  const createAgeBandMut = useMutation({
    mutationFn: async (data: Record<string, unknown>) => { const res = await apiRequest("POST", "/api/age-bands", data); return res.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/age-bands"] }); setShowCreateAgeBand(false); toast({ title: "Age band created" }); },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const filteredProducts = products.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()) || p.code.toLowerCase().includes(search.toLowerCase())
  );
  const activeProductCount = products.filter((p) => p.isActive).length;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Product Builder"
          description="Configure products, benefits, add-ons, and pricing."
          titleDataTestId="text-page-title"
        />

        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
          <KpiStatCard className="bg-primary/5 border-primary/20" label="Active products" value={<span data-testid="text-active-products-count">{loadingProducts ? "—" : activeProductCount}</span>} icon={Package} />
          <KpiStatCard label="Benefit items" value={<span data-testid="text-benefit-count">{loadingBenefits ? "—" : benefitCatalog.length}</span>} icon={Layers} />
          <KpiStatCard label="Add-ons" value={<span data-testid="text-addon-count">{loadingAddOns ? "—" : addOns.length}</span>} icon={Puzzle} />
          <KpiStatCard label="Age bands" value={<span data-testid="text-ageband-count">{loadingAgeBands ? "—" : ageBands.length}</span>} icon={BarChart3} />
          <KpiStatCard label="T&C clauses" value={<span data-testid="text-terms-count">{loadingTerms ? "—" : termsList.length}</span>} icon={FileText} />
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
            <TabsTrigger value="benefits" data-testid="tab-benefits">Benefits</TabsTrigger>
            <TabsTrigger value="bundles" data-testid="tab-bundles">Bundles</TabsTrigger>
            <TabsTrigger value="addons" data-testid="tab-addons">Add-Ons</TabsTrigger>
            <TabsTrigger value="agebands" data-testid="tab-agebands">Age Bands</TabsTrigger>
            <TabsTrigger value="terms" data-testid="tab-terms">Terms & Conditions</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <CardSection
              title="Configured Products"
              icon={Package}
              headerRight={(
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center w-full sm:w-auto">
                  <div className="relative w-full sm:w-64">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input placeholder="Search products..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-products" />
                  </div>
                  <Button className="gap-2 shrink-0" onClick={() => setShowCreateProduct(true)} data-testid="button-create-product">
                    <Plus className="h-4 w-4" /> New Product
                  </Button>
                </div>
              )}
              flush
            >
                {loadingProducts ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredProducts.length === 0 ? (
                  <EmptyState icon={Box} title="No products found" description="Create a product or adjust your search." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6 w-8"></TableHead>
                        <TableHead>Product</TableHead>
                        <TableHead>Code</TableHead>
                        <TableHead>Members</TableHead>
                        <TableHead>Casket</TableHead>
                        <TableHead>Cover</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right pr-6">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredProducts.map((product) => (
                        <ProductRow
                          key={product.id}
                          product={product}
                          isExpanded={expandedProduct === product.id}
                          onToggle={() => setExpandedProduct(expandedProduct === product.id ? null : product.id)}
                          onEdit={() => setEditingProduct(product)}
                          onCreateVersion={() => setShowCreateVersion(product.id)}
                          onEditVersion={(v) => setEditingVersion(v)}
                          onRecalcPremiums={(vId) => recalcPremiumsMut.mutate(vId)}
                          onDelete={() => setProductToDelete(product)}
                        />
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="benefits">
            <CardSection
              title="Benefit Catalog"
              description="Individual benefit items that can be grouped into bundles."
              icon={Layers}
              headerRight={<Button className="gap-2 shrink-0" onClick={() => setShowCreateBenefit(true)} data-testid="button-create-benefit"><Plus className="h-4 w-4" /> New Benefit</Button>}
              flush
            >
                {loadingBenefits ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : benefitCatalog.length === 0 ? (
                  <EmptyState icon={Layers} title="No benefit items yet" description="Create benefits to attach to bundles and products." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Default Cost</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {benefitCatalog.map((item) => (
                        <TableRow key={item.id} className="hover:bg-muted/40" data-testid={`row-benefit-${item.id}`}>
                          <TableCell className="font-medium pl-6">{item.name}</TableCell>
                          <TableCell className="text-muted-foreground">{item.description || "—"}</TableCell>
                          <TableCell>{item.internalCostDefault ? formatAmount(item.internalCostDefault, "USD") : "—"}</TableCell>
                          <TableCell><Badge variant={item.isActive ? "default" : "secondary"} className={item.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit benefit item" onClick={() => setEditingBenefit(item)}><Edit className="h-4 w-4" aria-hidden="true" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="bundles">
            <CardSection
              title="Benefit Bundles"
              description="Groups of benefits linked to product versions."
              icon={Package}
              headerRight={<Button className="gap-2 shrink-0" onClick={() => setShowCreateBundle(true)} data-testid="button-create-bundle"><Plus className="h-4 w-4" /> New Bundle</Button>}
              flush
            >
                {loadingBundles ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : benefitBundles.length === 0 ? (
                  <EmptyState icon={Package} title="No bundles yet" description="Create a bundle to group benefits for product versions." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {benefitBundles.map((bundle) => (
                        <TableRow key={bundle.id} className="hover:bg-muted/40" data-testid={`row-bundle-${bundle.id}`}>
                          <TableCell className="font-medium pl-6">{bundle.name}</TableCell>
                          <TableCell className="text-muted-foreground">{bundle.description || "—"}</TableCell>
                          <TableCell><Badge variant={bundle.isActive ? "default" : "secondary"} className={bundle.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{bundle.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit bundle" onClick={() => setEditingBundle(bundle)}><Edit className="h-4 w-4" aria-hidden="true" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="addons">
            <CardSection
              title="Add-Ons"
              description="Optional extras with their own premiums that can be added to policies."
              icon={Puzzle}
              headerRight={<Button className="gap-2 shrink-0" onClick={() => setShowCreateAddOn(true)} data-testid="button-create-addon"><Plus className="h-4 w-4" /> New Add-On</Button>}
              flush
            >
                {loadingAddOns ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : addOns.length === 0 ? (
                  <EmptyState icon={Puzzle} title="No add-ons yet" description="Create add-ons for optional policy extras." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Mode</TableHead>
                        <TableHead>Monthly</TableHead>
                        <TableHead>Weekly</TableHead>
                        <TableHead>Bi-weekly</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addOns.map((addon) => (
                        <TableRow key={addon.id} className="hover:bg-muted/40" data-testid={`row-addon-${addon.id}`}>
                          <TableCell className="pl-6">
                            <p className="font-medium">{addon.name}</p>
                            {addon.description && <p className="text-xs text-muted-foreground">{addon.description}</p>}
                          </TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-[10px]">{addon.pricingMode}</Badge></TableCell>
                          <TableCell className="font-semibold">{addon.pricingMode === "percentage" ? `${addon.priceAmount || addon.priceMonthly || "—"}%` : (addon.priceMonthly || addon.priceAmount ? formatAmount(addon.priceMonthly || addon.priceAmount!, "USD") : "—")}</TableCell>
                          <TableCell className="font-semibold">{addon.pricingMode === "percentage" ? "—" : (addon.priceWeekly ? formatAmount(addon.priceWeekly, "USD") : "—")}</TableCell>
                          <TableCell className="font-semibold">{addon.pricingMode === "percentage" ? "—" : (addon.priceBiweekly ? formatAmount(addon.priceBiweekly, "USD") : "—")}</TableCell>
                          <TableCell><Badge variant={addon.isActive ? "default" : "secondary"} className={addon.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{addon.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit add-on" onClick={() => setEditingAddOn(addon)}><Edit className="h-4 w-4" aria-hidden="true" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="agebands">
            <CardSection
              title="Age Band Configuration"
              description="Age-based pricing modifiers for products."
              icon={BarChart3}
              headerRight={<Button className="gap-2 shrink-0" onClick={() => setShowCreateAgeBand(true)} data-testid="button-create-ageband"><Plus className="h-4 w-4" /> New Age Band</Button>}
              flush
            >
                {loadingAgeBands ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : ageBands.length === 0 ? (
                  <EmptyState icon={BarChart3} title="No age bands configured" description="Define age bands to adjust premiums by age." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Min Age</TableHead>
                        <TableHead>Max Age</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ageBands.map((band) => (
                        <TableRow key={band.id} className="hover:bg-muted/40" data-testid={`row-ageband-${band.id}`}>
                          <TableCell className="font-medium pl-6">{band.name}</TableCell>
                          <TableCell>{band.minAge}</TableCell>
                          <TableCell>{band.maxAge}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-[10px]">v{band.version}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{band.effectiveFrom || "—"}</TableCell>
                          <TableCell><Badge variant={band.isActive ? "default" : "secondary"} className={band.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{band.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell><Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit age band" onClick={() => setEditingAgeBand(band)}><Edit className="h-4 w-4" aria-hidden="true" /></Button></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>

          <TabsContent value="terms">
            <CardSection
              title="Terms & Conditions"
              description="Manage T&Cs per product version. These appear on policy documents and can be translated into multiple languages when downloaded."
              icon={FileText}
              headerRight={(
                <Button className="gap-2 shrink-0" onClick={() => { setShowCreateTerm(true); setTermProductVersionId(""); }} data-testid="button-create-term">
                  <Plus className="h-4 w-4" /> New Term
                </Button>
              )}
              flush
            >
                {loadingTerms ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : termsList.length === 0 ? (
                  <EmptyState icon={FileText} title="No terms configured yet" description="Add clauses for product versions or general use." className="border-0 rounded-none bg-transparent py-12" />
                ) : (
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead className="pl-6">Title</TableHead>
                        <TableHead>Product Version</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Order</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="w-20">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {termsList.map((term: any) => {
                        const pv = allProductVersions.find((v) => v.id === term.productVersionId);
                        return (
                          <TableRow key={term.id} className="hover:bg-muted/40">
                            <TableCell className="pl-6">
                              <p className="font-medium">{term.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-1 max-w-[300px]">{term.content}</p>
                            </TableCell>
                            <TableCell>
                              {pv ? (
                                <Badge variant="outline" className="font-mono text-[10px]">{pv.productName} v{pv.version}</Badge>
                              ) : (
                                <Badge variant="secondary" className="text-[10px]">General (all products)</Badge>
                              )}
                            </TableCell>
                            <TableCell className="capitalize text-sm">{term.category || "general"}</TableCell>
                            <TableCell className="text-sm">{term.sortOrder}</TableCell>
                            <TableCell>
                              <Badge variant={term.isActive ? "default" : "secondary"} className={term.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>
                                {term.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit term" onClick={() => setEditingTerm(term)}><Edit className="h-4 w-4" aria-hidden="true" /></Button>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" aria-label="Delete term" onClick={() => { if (confirm("Delete this term?")) deleteTermMut.mutate(term.id); }}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </DataTable>
                )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      <CreateTermDialog
        open={showCreateTerm}
        onClose={() => setShowCreateTerm(false)}
        onSubmit={(data) => createTermMut.mutate(data)}
        isPending={createTermMut.isPending}
        productVersions={allProductVersions}
      />
      {editingTerm && (
        <EditTermDialog
          term={editingTerm}
          open={!!editingTerm}
          onClose={() => setEditingTerm(null)}
          onSubmit={(data) => updateTermMut.mutate({ id: editingTerm.id, data })}
          isPending={updateTermMut.isPending}
          productVersions={allProductVersions}
        />
      )}

      <CreateProductDialog open={showCreateProduct} onClose={() => setShowCreateProduct(false)} onSubmit={(data) => createProductMut.mutate(data)} isPending={createProductMut.isPending} />
      {editingProduct && <EditProductDialog product={editingProduct} open={!!editingProduct} onClose={() => setEditingProduct(null)} onSubmit={(data) => updateProductMut.mutate({ id: editingProduct.id, data })} isPending={updateProductMut.isPending} />}
      {showCreateVersion && <CreateVersionDialog productId={showCreateVersion} open={!!showCreateVersion} onClose={() => setShowCreateVersion(null)} onSubmit={(data) => createVersionMut.mutate({ productId: showCreateVersion, data })} isPending={createVersionMut.isPending} />}
      {editingVersion && <EditVersionDialog version={editingVersion} open={!!editingVersion} onClose={() => setEditingVersion(null)} onSubmit={(data) => updateVersionMut.mutate({ id: editingVersion.id, data })} isPending={updateVersionMut.isPending} />}

      <AlertDialog open={!!productToDelete} onOpenChange={(open) => !open && setProductToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete product?</AlertDialogTitle>
            <AlertDialogDescription>
              {productToDelete && (
                <>This will permanently delete &quot;{productToDelete.name}&quot; ({productToDelete.code}) and all its versions. This cannot be undone. If any policies use this product, deletion will be blocked.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => productToDelete && deleteProductMut.mutate(productToDelete.id)}
              disabled={deleteProductMut.isPending}
            >
              {deleteProductMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <CreateBenefitDialog open={showCreateBenefit} onClose={() => setShowCreateBenefit(false)} onSubmit={(data) => createBenefitMut.mutate(data)} isPending={createBenefitMut.isPending} />
      <CreateBundleDialog open={showCreateBundle} onClose={() => setShowCreateBundle(false)} onSubmit={(data) => createBundleMut.mutate(data)} isPending={createBundleMut.isPending} />
      <CreateAddOnDialog open={showCreateAddOn} onClose={() => setShowCreateAddOn(false)} onSubmit={(data) => createAddOnMut.mutate(data)} isPending={createAddOnMut.isPending} />
      <CreateAgeBandDialog open={showCreateAgeBand} onClose={() => setShowCreateAgeBand(false)} onSubmit={(data) => createAgeBandMut.mutate(data)} isPending={createAgeBandMut.isPending} />

      {editingAddOn && <EditAddOnDialog addon={editingAddOn} open={!!editingAddOn} onClose={() => setEditingAddOn(null)} onSubmit={(data) => updateAddOnMut.mutate({ id: editingAddOn.id, data })} isPending={updateAddOnMut.isPending} />}
      {editingBenefit && <EditBenefitDialog benefit={editingBenefit} open={!!editingBenefit} onClose={() => setEditingBenefit(null)} onSubmit={(data) => updateBenefitMut.mutate({ id: editingBenefit.id, data })} isPending={updateBenefitMut.isPending} />}
      {editingBundle && <EditBundleDialog bundle={editingBundle} open={!!editingBundle} onClose={() => setEditingBundle(null)} onSubmit={(data) => updateBundleMut.mutate({ id: editingBundle.id, data })} isPending={updateBundleMut.isPending} />}
      {editingAgeBand && <EditAgeBandDialog ageBand={editingAgeBand} open={!!editingAgeBand} onClose={() => setEditingAgeBand(null)} onSubmit={(data) => updateAgeBandMut.mutate({ id: editingAgeBand.id, data })} isPending={updateAgeBandMut.isPending} />}
    </StaffLayout>
  );
}

function ProductRow({ product, isExpanded, onToggle, onEdit, onCreateVersion, onEditVersion, onRecalcPremiums, onDelete }: {
  product: Product; isExpanded: boolean; onToggle: () => void; onEdit: () => void; onCreateVersion: () => void; onEditVersion: (v: ProductVersion) => void; onRecalcPremiums: (versionId: string) => void; onDelete: () => void;
}) {
  const { data: versions = [], isLoading } = useQuery<ProductVersion[]>({
    queryKey: [`/api/products/${product.id}/versions`],
    enabled: isExpanded,
  });

  return (
    <>
      <TableRow className="hover:bg-muted/30 transition-colors" data-testid={`row-product-${product.id}`}>
        <TableCell className="pl-6">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggle} data-testid={`button-expand-product-${product.id}`} aria-label={isExpanded ? "Collapse product" : "Expand product"}>
            {isExpanded ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            {product.casketImageUrl ? (
              <img src={resolveAssetUrl(product.casketImageUrl)} alt={product.casketType || ""} className="h-10 w-10 rounded object-cover border" loading="lazy" />
            ) : (
              <div className="h-10 w-10 rounded bg-muted flex items-center justify-center"><Box className="h-5 w-5 text-muted-foreground/50" /></div>
            )}
            <div>
              <p className="font-medium">{product.name}</p>
              {product.description && <p className="text-xs text-muted-foreground truncate max-w-[200px]">{product.description}</p>}
            </div>
          </div>
        </TableCell>
        <TableCell><Badge variant="outline" className="font-mono text-[10px]">{product.code}</Badge></TableCell>
        <TableCell>
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-0.5" title="Adults"><Users className="h-3 w-3" />{product.maxAdults ?? 2}</span>
            <span className="flex items-center gap-0.5" title="Children"><Baby className="h-3 w-3" />{product.maxChildren ?? 4}</span>
            {(product.maxExtendedMembers || 0) > 0 && <span className="flex items-center gap-0.5" title="Extended"><Crown className="h-3 w-3" />{product.maxExtendedMembers}</span>}
            {product.maxAdditionalMembers != null && <span className="flex items-center gap-0.5 text-amber-600" title={`Max ${product.maxAdditionalMembers} additional`}>+{product.maxAdditionalMembers}</span>}
          </div>
        </TableCell>
        <TableCell className="text-sm">{product.casketType || "—"}</TableCell>
        <TableCell className="font-semibold text-sm">{product.coverAmount ? `${product.coverCurrency || "USD"} ${parseFloat(product.coverAmount).toLocaleString()}` : "—"}</TableCell>
        <TableCell>
          <Badge variant={product.isActive ? "default" : "secondary"} className={product.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>
            {product.isActive ? "Active" : "Inactive"}
          </Badge>
        </TableCell>
        <TableCell className="text-right pr-6">
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Edit product" onClick={onEdit} data-testid={`button-edit-product-${product.id}`}><Edit className="h-4 w-4" aria-hidden="true" /></Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onCreateVersion} data-testid={`button-new-version-${product.id}`}><Plus className="h-3 w-3" aria-hidden="true" /> Version</Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10" onClick={onDelete} title="Delete product" aria-label="Delete product" data-testid={`button-delete-product-${product.id}`}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button>
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && (
        <TableRow>
          <TableCell colSpan={8} className="bg-muted/20 p-0">
            <div className="px-10 py-4">
              <h4 className="text-sm font-semibold mb-3">Product Versions & Pricing</h4>
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading versions...</div>
              ) : versions.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">No versions created yet. Click "+ Version" to define premiums and rules.</p>
              ) : (
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Monthly (USD)</TableHead>
                      <TableHead>Monthly (ZAR)</TableHead>
                      <TableHead>Weekly (USD)</TableHead>
                      <TableHead>Weekly (ZAR)</TableHead>
                      <TableHead>Bi-wk (USD)</TableHead>
                      <TableHead>Bi-wk (ZAR)</TableHead>
                      <TableHead>+Member/mo (USD)</TableHead>
                      <TableHead>+Member/mo (ZAR)</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Grace</TableHead>
                      <TableHead>Age Range</TableHead>
                      <TableHead>Commission</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.id} data-testid={`row-version-${v.id}`}>
                        <TableCell><Badge variant="outline" className="font-mono text-[10px]">v{v.version}</Badge></TableCell>
                        <TableCell>{v.effectiveFrom}</TableCell>
                        <TableCell className="font-semibold">{v.premiumMonthlyUsd ? formatAmount(v.premiumMonthlyUsd, "USD") : "—"}</TableCell>
                        <TableCell>{v.premiumMonthlyZar ? formatAmount(v.premiumMonthlyZar, "ZAR") : "—"}</TableCell>
                        <TableCell>{v.premiumWeeklyUsd ? formatAmount(v.premiumWeeklyUsd, "USD") : "—"}</TableCell>
                        <TableCell>{v.premiumWeeklyZar ? formatAmount(v.premiumWeeklyZar, "ZAR") : "—"}</TableCell>
                        <TableCell>{v.premiumBiweeklyUsd ? formatAmount(v.premiumBiweeklyUsd, "USD") : "—"}</TableCell>
                        <TableCell>{v.premiumBiweeklyZar ? formatAmount(v.premiumBiweeklyZar, "ZAR") : "—"}</TableCell>
                        <TableCell className="text-xs">{v.additionalMemberPremiumMonthlyUsd ? formatAmount(v.additionalMemberPremiumMonthlyUsd, "USD") : "—"}</TableCell>
                        <TableCell className="text-xs">{v.additionalMemberPremiumMonthlyZar ? formatAmount(v.additionalMemberPremiumMonthlyZar, "ZAR") : "—"}</TableCell>
                        <TableCell>{v.waitingPeriodDays != null ? `${v.waitingPeriodDays}d` : "—"}</TableCell>
                        <TableCell>{v.gracePeriodDays != null ? `${v.gracePeriodDays}d` : "—"}</TableCell>
                        <TableCell>{v.eligibilityMinAge ?? "—"} – {v.eligibilityMaxAge ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {v.commissionFirstMonthsRate
                            ? `${v.commissionFirstMonthsRate}% × ${v.commissionFirstMonthsCount ?? "—"}m, then ${v.commissionRecurringRate ?? "—"}%`
                            : "—"}
                        </TableCell>
                        <TableCell><Badge variant={v.isActive ? "default" : "secondary"} className={v.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" aria-label="Edit version" onClick={() => onEditVersion(v)} data-testid={`button-edit-version-${v.id}`}>
                              <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-amber-600 hover:text-amber-700" aria-label="Recalculate all policy premiums for this version" title="Recalculate premiums for all policies on this version" onClick={() => onRecalcPremiums(v.id)}>
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function CreateProductDialog({ open, onClose, onSubmit, isPending }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [maxAdults, setMaxAdults] = useState("2");
  const [maxChildren, setMaxChildren] = useState("4");
  const [maxExtended, setMaxExtended] = useState("0");
  const [maxAdditional, setMaxAdditional] = useState("");
  const [casketType, setCasketType] = useState("");
  const [casketImageUrl, setCasketImageUrl] = useState("");
  const [coverAmount, setCoverAmount] = useState("");
  const [coverCurrency, setCoverCurrency] = useState("USD");
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/upload", { method: "POST", headers, body: formData, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setCasketImageUrl(data.url);
    } catch {
      setCasketImageUrl("");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      name,
      code,
      description: description || undefined,
      maxAdults: maxAdults ? parseInt(maxAdults) : 2,
      maxChildren: maxChildren ? parseInt(maxChildren) : 4,
      maxExtendedMembers: maxExtended ? parseInt(maxExtended) : 0,
      maxAdditionalMembers: maxAdditional.trim() ? parseInt(maxAdditional) : null,
      casketType: casketType || undefined,
      casketImageUrl: casketImageUrl || undefined,
      coverAmount: coverAmount || undefined,
      coverCurrency,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Product</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Family Plan Standard" data-testid="input-product-name" />
            </div>
            <div className="space-y-2">
              <Label>Product Code *</Label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} required placeholder="e.g. FAM-STD" data-testid="input-product-code" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Brief description of the product and what it covers..." data-testid="input-product-description" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Member Limits</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5" />Max Adults</Label>
              <Input type="number" min="1" max="10" value={maxAdults} onChange={(e) => setMaxAdults(e.target.value)} data-testid="input-max-adults" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Baby className="h-3.5 w-3.5" />Max Children</Label>
              <Input type="number" min="0" max="20" value={maxChildren} onChange={(e) => setMaxChildren(e.target.value)} data-testid="input-max-children" />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Crown className="h-3.5 w-3.5" />Max Extended</Label>
              <Input type="number" min="0" max="20" value={maxExtended} onChange={(e) => setMaxExtended(e.target.value)} data-testid="input-max-extended" />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">Max Additional Members <span className="text-xs text-muted-foreground font-normal">(beyond included count — leave blank for unlimited)</span></Label>
            <Input type="number" min="0" max="50" value={maxAdditional} onChange={(e) => setMaxAdditional(e.target.value)} placeholder="e.g. 5 (blank = unlimited)" data-testid="input-max-additional" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cover & Casket</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cover Amount</Label>
              <Input type="number" step="0.01" min="0" value={coverAmount} onChange={(e) => setCoverAmount(e.target.value)} placeholder="e.g. 15000" data-testid="input-cover-amount" />
            </div>
            <div className="space-y-2">
              <Label>Cover Currency</Label>
              <CurrencySelect value={coverCurrency} onValueChange={setCoverCurrency} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Casket Type</Label>
            <Select value={casketType} onValueChange={setCasketType}>
              <SelectTrigger data-testid="select-casket-type"><SelectValue placeholder="Select casket type..." /></SelectTrigger>
              <SelectContent>
                {CASKET_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Casket Image</Label>
            <div className="flex items-start gap-4">
              {casketImageUrl ? (
                <div className="relative">
                  <img src={casketImageUrl} alt="Casket" className="h-24 w-32 rounded-lg object-cover border shadow-sm" loading="lazy" />
                  <button type="button" className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs" onClick={() => setCasketImageUrl("")}>×</button>
                </div>
              ) : (
                <div className="h-24 w-32 rounded-lg border-2 border-dashed border-muted-foreground/25 flex flex-col items-center justify-center text-muted-foreground/50">
                  <Image className="h-6 w-6 mb-1" />
                  <span className="text-[10px]">No image</span>
                </div>
              )}
              <div className="flex-1">
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} data-testid="input-casket-image" />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading} data-testid="button-upload-casket">
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {uploading ? "Uploading..." : "Upload Image"}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">JPG, PNG, or WebP. Max 5MB.</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name || !code} data-testid="button-submit-product">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Product
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditProductDialog({ product, open, onClose, onSubmit, isPending }: {
  product: Product; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description || "");
  const [maxAdults, setMaxAdults] = useState(String(product.maxAdults ?? 2));
  const [maxChildren, setMaxChildren] = useState(String(product.maxChildren ?? 4));
  const [maxExtended, setMaxExtended] = useState(String(product.maxExtendedMembers ?? 0));
  const [maxAdditional, setMaxAdditional] = useState(product.maxAdditionalMembers != null ? String(product.maxAdditionalMembers) : "");
  const [casketType, setCasketType] = useState(product.casketType || "");
  const [casketImageUrl, setCasketImageUrl] = useState(product.casketImageUrl || "");
  const [coverAmount, setCoverAmount] = useState(product.coverAmount || "");
  const [coverCurrency, setCoverCurrency] = useState(product.coverCurrency || "USD");
  const [isActive, setIsActive] = useState(product.isActive);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/upload", { method: "POST", headers, body: formData, credentials: "include" });
      if (!res.ok) throw new Error("Upload failed");
      const data = await res.json();
      setCasketImageUrl(data.url);
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const parseLimit = (v: string, fallback: number) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : fallback;
    };
    onSubmit({
      name,
      description: description || null,
      maxAdults: parseLimit(maxAdults, 1),
      maxChildren: parseLimit(maxChildren, 0),
      maxExtendedMembers: parseLimit(maxExtended, 0),
      maxAdditionalMembers: maxAdditional.trim() ? parseInt(maxAdditional, 10) : null,
      casketType: casketType || null,
      casketImageUrl: casketImageUrl || null,
      coverAmount: coverAmount || null,
      coverCurrency,
      isActive,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Product: {product.name}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Product Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-edit-product-name" />
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-edit-product-description" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Member Limits</h3>
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2"><Label>Max Adults</Label><Input type="number" min="1" max="10" value={maxAdults} onChange={(e) => setMaxAdults(e.target.value)} /></div>
            <div className="space-y-2"><Label>Max Children</Label><Input type="number" min="0" max="20" value={maxChildren} onChange={(e) => setMaxChildren(e.target.value)} /></div>
            <div className="space-y-2"><Label>Max Extended</Label><Input type="number" min="0" max="20" value={maxExtended} onChange={(e) => setMaxExtended(e.target.value)} /></div>
          </div>
          <div className="space-y-2">
            <Label>Max Additional Members <span className="text-xs text-muted-foreground font-normal">(beyond included count — blank = unlimited)</span></Label>
            <Input type="number" min="0" max="50" value={maxAdditional} onChange={(e) => setMaxAdditional(e.target.value)} placeholder="blank = unlimited" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cover & Casket</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Cover Amount</Label><Input type="number" step="0.01" value={coverAmount} onChange={(e) => setCoverAmount(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Cover Currency</Label>
              <CurrencySelect value={coverCurrency} onValueChange={setCoverCurrency} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Casket Type</Label>
            <Select value={casketType} onValueChange={setCasketType}><SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
              <SelectContent>{CASKET_TYPES.map((ct) => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Casket Image</Label>
            <div className="flex items-start gap-4">
              {casketImageUrl ? (
                <div className="relative">
                  <img src={casketImageUrl} alt="Casket" className="h-24 w-32 rounded-lg object-cover border" loading="lazy" />
                  <button type="button" className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center text-xs" onClick={() => setCasketImageUrl("")}>×</button>
                </div>
              ) : (
                <div className="h-24 w-32 rounded-lg border-2 border-dashed flex items-center justify-center text-muted-foreground/50"><Image className="h-6 w-6" /></div>
              )}
              <div>
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleUpload} />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  {uploading ? "Uploading..." : "Upload Image"}
                </Button>
              </div>
            </div>
          </div>

          <Separator />
          <div className="flex items-center gap-2">
            <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} id="edit-active" data-testid="input-edit-product-active" />
            <Label htmlFor="edit-active">Active</Label>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name} data-testid="button-submit-edit-product">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Product version form validation ──────────────────────────────────────
// Shared by CreateVersionDialog and EditVersionDialog, which have identical
// field shapes. Pricing here directly sets what real policyholders are
// billed, so mistakes (a negative premium, a typo'd non-numeric value, a
// minimum eligibility age above the maximum) are caught before submit rather
// than silently accepted — see the 2026-07-15 UX audit for why this dialog
// specifically needed it: previously every failure mode here surfaced only
// as a toast, with no indication of which of the 35 fields was wrong.
interface VersionFormValues {
  effectiveFrom: string;
  premiumMonthlyUsd: string; premiumMonthlyZar: string;
  premiumWeeklyUsd: string; premiumWeeklyZar: string;
  premiumBiweeklyUsd: string; premiumBiweeklyZar: string;
  waitingPeriodDays: string; waitingAccidental: string; waitingSuicide: string;
  gracePeriodDays: string;
  eligibilityMinAge: string; eligibilityMaxAge: string; dependentMaxAge: string;
  cashInLieuAdult: string; cashInLieuChild: string;
  commFirstMonths: string; commFirstRate: string;
  commRecurringStart: string; commRecurringRate: string;
  commClawback: string; commFuneralIncentive: string;
  underwriterAmountAdult: string; underwriterAmountChild: string;
  underwriterAdvanceMonths: string;
  additionalMemberPremiumMonthlyUsd: string; additionalMemberPremiumMonthlyZar: string;
  ageBandRateChildUsd: string; ageBandRateChildZar: string;
  ageBandRate21To65Usd: string; ageBandRate21To65Zar: string;
  ageBandRate66To84Usd: string; ageBandRate66To84Zar: string;
  ageBandRate85PlusUsd: string; ageBandRate85PlusZar: string;
}

const VERSION_NUMERIC_FIELDS: { key: keyof VersionFormValues; label: string }[] = [
  { key: "premiumMonthlyUsd", label: "Monthly Premium (USD)" },
  { key: "premiumMonthlyZar", label: "Monthly Premium (ZAR)" },
  { key: "premiumWeeklyUsd", label: "Weekly Premium (USD)" },
  { key: "premiumWeeklyZar", label: "Weekly Premium (ZAR)" },
  { key: "premiumBiweeklyUsd", label: "Bi-weekly Premium (USD)" },
  { key: "premiumBiweeklyZar", label: "Bi-weekly Premium (ZAR)" },
  { key: "waitingPeriodDays", label: "Natural Death waiting period" },
  { key: "waitingAccidental", label: "Accidental Death waiting period" },
  { key: "waitingSuicide", label: "Suicide waiting period" },
  { key: "gracePeriodDays", label: "Grace period" },
  { key: "eligibilityMinAge", label: "Minimum eligibility age" },
  { key: "eligibilityMaxAge", label: "Maximum eligibility age" },
  { key: "dependentMaxAge", label: "Dependent max age" },
  { key: "cashInLieuAdult", label: "Cash-in-lieu (adult)" },
  { key: "cashInLieuChild", label: "Cash-in-lieu (child)" },
  { key: "commFirstMonths", label: "Commission first-months count" },
  { key: "commFirstRate", label: "Commission first-months rate" },
  { key: "commRecurringStart", label: "Commission recurring start month" },
  { key: "commRecurringRate", label: "Commission recurring rate" },
  { key: "commClawback", label: "Commission clawback threshold" },
  { key: "commFuneralIncentive", label: "Commission funeral incentive" },
  { key: "underwriterAmountAdult", label: "Underwriter amount (adult)" },
  { key: "underwriterAmountChild", label: "Underwriter amount (child)" },
  { key: "underwriterAdvanceMonths", label: "Underwriter advance months" },
  { key: "additionalMemberPremiumMonthlyUsd", label: "Additional member premium (USD)" },
  { key: "additionalMemberPremiumMonthlyZar", label: "Additional member premium (ZAR)" },
  { key: "ageBandRateChildUsd", label: "Age band rate — child (USD)" },
  { key: "ageBandRateChildZar", label: "Age band rate — child (ZAR)" },
  { key: "ageBandRate21To65Usd", label: "Age band rate 21–65 (USD)" },
  { key: "ageBandRate21To65Zar", label: "Age band rate 21–65 (ZAR)" },
  { key: "ageBandRate66To84Usd", label: "Age band rate 66–84 (USD)" },
  { key: "ageBandRate66To84Zar", label: "Age band rate 66–84 (ZAR)" },
  { key: "ageBandRate85PlusUsd", label: "Age band rate 85+ (USD)" },
  { key: "ageBandRate85PlusZar", label: "Age band rate 85+ (ZAR)" },
];

function validateVersionForm(v: VersionFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.effectiveFrom) errors.effectiveFrom = "Effective date is required.";

  for (const { key, label } of VERSION_NUMERIC_FIELDS) {
    const raw = v[key];
    if (raw === "" || raw == null) continue;
    const n = Number(raw);
    if (!Number.isFinite(n)) { errors[key] = `${label} must be a number.`; continue; }
    if (n < 0) errors[key] = `${label} cannot be negative.`;
  }

  const hasAnyPremium = [
    v.premiumMonthlyUsd, v.premiumMonthlyZar, v.premiumWeeklyUsd,
    v.premiumWeeklyZar, v.premiumBiweeklyUsd, v.premiumBiweeklyZar,
  ].some((x) => x && x.trim() !== "");
  if (!hasAnyPremium && !errors.premiumMonthlyUsd) {
    errors.premiumMonthlyUsd = "Set at least one premium price for this version.";
  }

  if (v.eligibilityMinAge && v.eligibilityMaxAge && !errors.eligibilityMinAge && !errors.eligibilityMaxAge) {
    const min = Number(v.eligibilityMinAge);
    const max = Number(v.eligibilityMaxAge);
    if (min > max) errors.eligibilityMaxAge = "Maximum age must be greater than or equal to minimum age.";
  }

  return errors;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-destructive mt-1">{message}</p>;
}

function VersionFormErrorSummary({ errors }: { errors: Record<string, string> }) {
  const messages = Object.values(errors);
  if (messages.length === 0) return null;
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive space-y-1">
      <p className="font-medium flex items-center gap-1.5"><AlertTriangle className="h-4 w-4" /> Fix the following before saving:</p>
      <ul className="list-disc list-inside space-y-0.5">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </div>
  );
}

function CreateVersionDialog({ productId, open, onClose, onSubmit, isPending }: {
  productId: string; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [premiumMonthlyUsd, setPremiumMonthlyUsd] = useState("");
  const [premiumMonthlyZar, setPremiumMonthlyZar] = useState("");
  const [premiumWeeklyUsd, setPremiumWeeklyUsd] = useState("");
  const [premiumWeeklyZar, setPremiumWeeklyZar] = useState("");
  const [premiumBiweeklyUsd, setPremiumBiweeklyUsd] = useState("");
  const [premiumBiweeklyZar, setPremiumBiweeklyZar] = useState("");
  const [waitingPeriodDays, setWaitingPeriodDays] = useState("90");
  const [waitingAccidental, setWaitingAccidental] = useState("0");
  const [waitingSuicide, setWaitingSuicide] = useState("0");
  const [gracePeriodDays, setGracePeriodDays] = useState("30");
  const [eligibilityMinAge, setEligibilityMinAge] = useState("18");
  const [eligibilityMaxAge, setEligibilityMaxAge] = useState("70");
  const [dependentMaxAge, setDependentMaxAge] = useState("20");
  const [cashInLieuAdult, setCashInLieuAdult] = useState("");
  const [cashInLieuChild, setCashInLieuChild] = useState("");
  const [reinstatementRequiresArrears, setReinstatementRequiresArrears] = useState(true);
  const [reinstatementNewWaitingPeriod, setReinstatementNewWaitingPeriod] = useState(true);
  const [commFirstMonths, setCommFirstMonths] = useState("");
  const [commFirstRate, setCommFirstRate] = useState("");
  const [commRecurringStart, setCommRecurringStart] = useState("");
  const [commRecurringRate, setCommRecurringRate] = useState("");
  const [commClawback, setCommClawback] = useState("");
  const [commFuneralIncentive, setCommFuneralIncentive] = useState("");
  const [underwriterAmountAdult, setUnderwriterAmountAdult] = useState("");
  const [underwriterAmountChild, setUnderwriterAmountChild] = useState("");
  const [underwriterSameAmount, setUnderwriterSameAmount] = useState(true);
  const [underwriterAdvanceMonths, setUnderwriterAdvanceMonths] = useState("0");
  const [additionalMemberPremiumMonthlyUsd, setAdditionalMemberPremiumMonthlyUsd] = useState("");
  const [additionalMemberPremiumMonthlyZar, setAdditionalMemberPremiumMonthlyZar] = useState("");
  const [ageBandRateChildUsd, setAgeBandRateChildUsd] = useState("");
  const [ageBandRateChildZar, setAgeBandRateChildZar] = useState("");
  const [ageBandRate21To65Usd, setAgeBandRate21To65Usd] = useState("");
  const [ageBandRate21To65Zar, setAgeBandRate21To65Zar] = useState("");
  const [ageBandRate66To84Usd, setAgeBandRate66To84Usd] = useState("");
  const [ageBandRate66To84Zar, setAgeBandRate66To84Zar] = useState("");
  const [ageBandRate85PlusUsd, setAgeBandRate85PlusUsd] = useState("");
  const [ageBandRate85PlusZar, setAgeBandRate85PlusZar] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateVersionForm({
      effectiveFrom, premiumMonthlyUsd, premiumMonthlyZar, premiumWeeklyUsd, premiumWeeklyZar,
      premiumBiweeklyUsd, premiumBiweeklyZar, waitingPeriodDays, waitingAccidental, waitingSuicide,
      gracePeriodDays, eligibilityMinAge, eligibilityMaxAge, dependentMaxAge, cashInLieuAdult, cashInLieuChild,
      commFirstMonths, commFirstRate, commRecurringStart, commRecurringRate, commClawback, commFuneralIncentive,
      underwriterAmountAdult, underwriterAmountChild, underwriterAdvanceMonths,
      additionalMemberPremiumMonthlyUsd, additionalMemberPremiumMonthlyZar,
      ageBandRateChildUsd, ageBandRateChildZar, ageBandRate21To65Usd, ageBandRate21To65Zar,
      ageBandRate66To84Usd, ageBandRate66To84Zar, ageBandRate85PlusUsd, ageBandRate85PlusZar,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onSubmit({
      effectiveFrom,
      premiumMonthlyUsd: premiumMonthlyUsd || undefined,
      premiumMonthlyZar: premiumMonthlyZar || undefined,
      premiumWeeklyUsd: premiumWeeklyUsd || undefined,
      premiumWeeklyZar: premiumWeeklyZar || undefined,
      premiumBiweeklyUsd: premiumBiweeklyUsd || undefined,
      premiumBiweeklyZar: premiumBiweeklyZar || undefined,
      waitingPeriodDays: waitingPeriodDays ? parseInt(waitingPeriodDays) : undefined,
      waitingPeriodAccidentalDeath: waitingAccidental ? parseInt(waitingAccidental) : undefined,
      waitingPeriodSuicide: waitingSuicide ? parseInt(waitingSuicide) : undefined,
      gracePeriodDays: gracePeriodDays ? parseInt(gracePeriodDays) : undefined,
      reinstatementRequiresArrears,
      reinstatementNewWaitingPeriod,
      eligibilityMinAge: eligibilityMinAge ? parseInt(eligibilityMinAge) : undefined,
      eligibilityMaxAge: eligibilityMaxAge ? parseInt(eligibilityMaxAge) : undefined,
      dependentMaxAge: dependentMaxAge ? parseInt(dependentMaxAge) : undefined,
      cashInLieuAdult: cashInLieuAdult || undefined,
      cashInLieuChild: cashInLieuChild || undefined,
      commissionFirstMonthsCount: commFirstMonths ? parseInt(commFirstMonths) : undefined,
      commissionFirstMonthsRate: commFirstRate || undefined,
      commissionRecurringStartMonth: commRecurringStart ? parseInt(commRecurringStart) : undefined,
      commissionRecurringRate: commRecurringRate || undefined,
      commissionClawbackThreshold: commClawback ? parseInt(commClawback) : undefined,
      commissionFuneralIncentive: commFuneralIncentive || undefined,
      underwriterAmountAdult: underwriterAmountAdult.trim() ? underwriterAmountAdult : undefined,
      underwriterAmountChild: underwriterSameAmount ? (underwriterAmountAdult.trim() ? underwriterAmountAdult : undefined) : (underwriterAmountChild.trim() ? underwriterAmountChild : undefined),
      underwriterAdvanceMonths: underwriterAdvanceMonths ? parseInt(underwriterAdvanceMonths) : 0,
      additionalMemberPremiumMonthlyUsd: additionalMemberPremiumMonthlyUsd.trim() || undefined,
      additionalMemberPremiumMonthlyZar: additionalMemberPremiumMonthlyZar.trim() || undefined,
      additionalMemberRateChildUsd: ageBandRateChildUsd.trim() || undefined,
      additionalMemberRateChildZar: ageBandRateChildZar.trim() || undefined,
      additionalMemberRate21To65Usd: ageBandRate21To65Usd.trim() || undefined,
      additionalMemberRate21To65Zar: ageBandRate21To65Zar.trim() || undefined,
      additionalMemberRate66To84Usd: ageBandRate66To84Usd.trim() || undefined,
      additionalMemberRate66To84Zar: ageBandRate66To84Zar.trim() || undefined,
      additionalMemberRate85PlusUsd: ageBandRate85PlusUsd.trim() || undefined,
      additionalMemberRate85PlusZar: ageBandRate85PlusZar.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Product Version</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <VersionFormErrorSummary errors={fieldErrors} />
          <div className="space-y-2">
            <Label>Effective From *</Label>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required data-testid="input-version-effective-from" className={cn(fieldErrors.effectiveFrom && "border-destructive")} />
            <FieldError message={fieldErrors.effectiveFrom} />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Premium Pricing</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Monthly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyUsd} onChange={(e) => setPremiumMonthlyUsd(e.target.value)} placeholder="e.g. 15.00" data-testid="input-version-premium-usd" className={cn(fieldErrors.premiumMonthlyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumMonthlyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Monthly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyZar} onChange={(e) => setPremiumMonthlyZar(e.target.value)} placeholder="e.g. 250.00" data-testid="input-version-premium-zar" className={cn(fieldErrors.premiumMonthlyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumMonthlyZar} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumWeeklyUsd} onChange={(e) => setPremiumWeeklyUsd(e.target.value)} placeholder="e.g. 4.00" data-testid="input-version-premium-weekly" className={cn(fieldErrors.premiumWeeklyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumWeeklyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Weekly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumWeeklyZar} onChange={(e) => setPremiumWeeklyZar(e.target.value)} placeholder="e.g. 75.00" className={cn(fieldErrors.premiumWeeklyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumWeeklyZar} />
            </div>
            <div className="space-y-2">
              <Label>Bi-weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumBiweeklyUsd} onChange={(e) => setPremiumBiweeklyUsd(e.target.value)} placeholder="e.g. 7.50" data-testid="input-version-premium-biweekly" className={cn(fieldErrors.premiumBiweeklyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumBiweeklyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Bi-weekly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumBiweeklyZar} onChange={(e) => setPremiumBiweeklyZar(e.target.value)} placeholder="e.g. 140.00" className={cn(fieldErrors.premiumBiweeklyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumBiweeklyZar} />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Waiting & Grace Periods</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Natural Death (days)</Label>
              <Input type="number" value={waitingPeriodDays} onChange={(e) => setWaitingPeriodDays(e.target.value)} data-testid="input-version-waiting" className={cn(fieldErrors.waitingPeriodDays && "border-destructive")} />
              <FieldError message={fieldErrors.waitingPeriodDays} />
            </div>
            <div className="space-y-2">
              <Label>Accidental Death (days)</Label>
              <Input type="number" value={waitingAccidental} onChange={(e) => setWaitingAccidental(e.target.value)} data-testid="input-version-waiting-accidental" className={cn(fieldErrors.waitingAccidental && "border-destructive")} />
              <FieldError message={fieldErrors.waitingAccidental} />
            </div>
            <div className="space-y-2">
              <Label>Suicide (days)</Label>
              <Input type="number" value={waitingSuicide} onChange={(e) => setWaitingSuicide(e.target.value)} data-testid="input-version-waiting-suicide" className={cn(fieldErrors.waitingSuicide && "border-destructive")} />
              <FieldError message={fieldErrors.waitingSuicide} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Grace Period (days)</Label>
            <Input type="number" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} data-testid="input-version-grace" className={cn(fieldErrors.gracePeriodDays && "border-destructive")} />
            <FieldError message={fieldErrors.gracePeriodDays} />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Reinstatement Rules</h3>
          <div className="flex flex-col gap-3">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="reinstatement-requires-arrears"
                checked={reinstatementRequiresArrears}
                onCheckedChange={(v) => setReinstatementRequiresArrears(v === true)}
                data-testid="checkbox-reinstatement-requires-arrears"
              />
              <Label htmlFor="reinstatement-requires-arrears" className="text-sm font-normal cursor-pointer">
                Reinstatement requires arrears to be paid
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="reinstatement-new-waiting-period"
                checked={reinstatementNewWaitingPeriod}
                onCheckedChange={(v) => setReinstatementNewWaitingPeriod(v === true)}
                data-testid="checkbox-reinstatement-new-waiting-period"
              />
              <Label htmlFor="reinstatement-new-waiting-period" className="text-sm font-normal cursor-pointer">
                New waiting period applies after reinstatement
              </Label>
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Age Eligibility</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Min Age (main member)</Label>
              <Input type="number" value={eligibilityMinAge} onChange={(e) => setEligibilityMinAge(e.target.value)} data-testid="input-version-min-age" className={cn(fieldErrors.eligibilityMinAge && "border-destructive")} />
              <FieldError message={fieldErrors.eligibilityMinAge} />
            </div>
            <div className="space-y-2">
              <Label>Max Age (main member)</Label>
              <Input type="number" value={eligibilityMaxAge} onChange={(e) => setEligibilityMaxAge(e.target.value)} data-testid="input-version-max-age" className={cn(fieldErrors.eligibilityMaxAge && "border-destructive")} />
              <FieldError message={fieldErrors.eligibilityMaxAge} />
            </div>
            <div className="space-y-2">
              <Label>Max Dependent Age</Label>
              <Input type="number" value={dependentMaxAge} onChange={(e) => setDependentMaxAge(e.target.value)} data-testid="input-version-dependent-max-age" className={cn(fieldErrors.dependentMaxAge && "border-destructive")} />
              <FieldError message={fieldErrors.dependentMaxAge} />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cash in Lieu (optional)</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Adult Cash in Lieu</Label>
              <Input type="number" step="0.01" value={cashInLieuAdult} onChange={(e) => setCashInLieuAdult(e.target.value)} placeholder="e.g. 5000.00" data-testid="input-version-cash-adult" />
            </div>
            <div className="space-y-2">
              <Label>Child Cash in Lieu</Label>
              <Input type="number" step="0.01" value={cashInLieuChild} onChange={(e) => setCashInLieuChild(e.target.value)} placeholder="e.g. 2500.00" data-testid="input-version-cash-child" />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agent Commission</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Initial Months Count</Label>
              <Input type="number" value={commFirstMonths} onChange={(e) => setCommFirstMonths(e.target.value)} placeholder="e.g. 2" data-testid="input-version-comm-first-months" />
            </div>
            <div className="space-y-2">
              <Label>Initial Months Rate (%)</Label>
              <Input type="number" step="0.01" value={commFirstRate} onChange={(e) => setCommFirstRate(e.target.value)} placeholder="e.g. 50" data-testid="input-version-comm-first-rate" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Recurring Start Month</Label>
              <Input type="number" value={commRecurringStart} onChange={(e) => setCommRecurringStart(e.target.value)} placeholder="e.g. 5" data-testid="input-version-comm-recurring-start" />
            </div>
            <div className="space-y-2">
              <Label>Recurring Rate (%)</Label>
              <Input type="number" step="0.01" value={commRecurringRate} onChange={(e) => setCommRecurringRate(e.target.value)} placeholder="e.g. 10" data-testid="input-version-comm-recurring-rate" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Clawback Threshold (payments)</Label>
              <Input type="number" value={commClawback} onChange={(e) => setCommClawback(e.target.value)} placeholder="e.g. 4" data-testid="input-version-comm-clawback" />
            </div>
            <div className="space-y-2">
              <Label>Funeral Service Incentive</Label>
              <Input type="number" step="0.01" value={commFuneralIncentive} onChange={(e) => setCommFuneralIncentive(e.target.value)} placeholder="e.g. 50.00" data-testid="input-version-comm-funeral" />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Underwriter (optional)</h3>
          <p className="text-sm text-muted-foreground">Amount the tenant pays to the underwriter per member per month. Leave blank if this product has no underwriter.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount per adult (per month)</Label>
              <Input type="number" step="0.01" value={underwriterAmountAdult} onChange={(e) => setUnderwriterAmountAdult(e.target.value)} placeholder="Optional — e.g. 5.00" data-testid="input-version-underwriter-adult" />
            </div>
            <div className="space-y-2">
              <Label>Amount per child (per month)</Label>
              <Input type="number" step="0.01" value={underwriterAmountChild} onChange={(e) => setUnderwriterAmountChild(e.target.value)} placeholder="Same as adult if not set" data-testid="input-version-underwriter-child" disabled={underwriterSameAmount} />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="underwriter-same-amount" checked={underwriterSameAmount} onCheckedChange={(v) => setUnderwriterSameAmount(v === true)} data-testid="checkbox-underwriter-same-amount" />
            <Label htmlFor="underwriter-same-amount" className="text-sm font-normal cursor-pointer">Same amount for adult and child</Label>
          </div>
          <div className="space-y-2">
            <Label>Pay underwriter in advance (months)</Label>
            <Input type="number" min={0} value={underwriterAdvanceMonths} onChange={(e) => setUnderwriterAdvanceMonths(e.target.value)} placeholder="e.g. 3" data-testid="input-version-underwriter-advance" />
            <p className="text-xs text-muted-foreground">e.g. 3 = tenant pays 3 months ahead; total payable = monthly × (1 + advance months).</p>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Additional / Extended Members</h3>
          <p className="text-sm text-muted-foreground">
            Per-member premium charged for each member beyond the product's included count (max adults + max children + max extended).
            Leave blank if no extra charge applies.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Per additional member / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={additionalMemberPremiumMonthlyUsd} onChange={(e) => setAdditionalMemberPremiumMonthlyUsd(e.target.value)} placeholder="e.g. 5.00" data-testid="input-version-additional-member-usd" />
            </div>
            <div className="space-y-2">
              <Label>Per additional member / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={additionalMemberPremiumMonthlyZar} onChange={(e) => setAdditionalMemberPremiumMonthlyZar(e.target.value)} placeholder="e.g. 90.00" data-testid="input-version-additional-member-zar" />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Optional: price additional members by age band instead of one flat rate above. Leave all blank to keep the flat rate.
            "Child" uses the dependent age cutoff set above; this does not affect any existing policy on this version until you fill these in.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Child / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRateChildUsd} onChange={(e) => setAgeBandRateChildUsd(e.target.value)} data-testid="input-version-ageband-child-usd" />
            </div>
            <div className="space-y-2">
              <Label>Child / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRateChildZar} onChange={(e) => setAgeBandRateChildZar(e.target.value)} data-testid="input-version-ageband-child-zar" />
            </div>
            <div className="space-y-2">
              <Label>21–65 / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate21To65Usd} onChange={(e) => setAgeBandRate21To65Usd(e.target.value)} data-testid="input-version-ageband-21-65-usd" />
            </div>
            <div className="space-y-2">
              <Label>21–65 / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate21To65Zar} onChange={(e) => setAgeBandRate21To65Zar(e.target.value)} data-testid="input-version-ageband-21-65-zar" />
            </div>
            <div className="space-y-2">
              <Label>66–84 / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate66To84Usd} onChange={(e) => setAgeBandRate66To84Usd(e.target.value)} data-testid="input-version-ageband-66-84-usd" />
            </div>
            <div className="space-y-2">
              <Label>66–84 / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate66To84Zar} onChange={(e) => setAgeBandRate66To84Zar(e.target.value)} data-testid="input-version-ageband-66-84-zar" />
            </div>
            <div className="space-y-2">
              <Label>85+ / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate85PlusUsd} onChange={(e) => setAgeBandRate85PlusUsd(e.target.value)} data-testid="input-version-ageband-85-plus-usd" />
            </div>
            <div className="space-y-2">
              <Label>85+ / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate85PlusZar} onChange={(e) => setAgeBandRate85PlusZar(e.target.value)} data-testid="input-version-ageband-85-plus-zar" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !effectiveFrom} data-testid="button-submit-version">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Version
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditVersionDialog({ version, open, onClose, onSubmit, isPending }: {
  version: ProductVersion; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState(version.effectiveFrom);
  const [premiumMonthlyUsd, setPremiumMonthlyUsd] = useState(version.premiumMonthlyUsd || "");
  const [premiumMonthlyZar, setPremiumMonthlyZar] = useState(version.premiumMonthlyZar || "");
  const [premiumWeeklyUsd, setPremiumWeeklyUsd] = useState(version.premiumWeeklyUsd || "");
  const [premiumWeeklyZar, setPremiumWeeklyZar] = useState(version.premiumWeeklyZar || "");
  const [premiumBiweeklyUsd, setPremiumBiweeklyUsd] = useState(version.premiumBiweeklyUsd || "");
  const [premiumBiweeklyZar, setPremiumBiweeklyZar] = useState(version.premiumBiweeklyZar || "");
  const [waitingPeriodDays, setWaitingPeriodDays] = useState(String(version.waitingPeriodDays ?? "90"));
  const [waitingAccidental, setWaitingAccidental] = useState(String(version.waitingPeriodAccidentalDeath ?? "0"));
  const [waitingSuicide, setWaitingSuicide] = useState(String(version.waitingPeriodSuicide ?? "0"));
  const [gracePeriodDays, setGracePeriodDays] = useState(String(version.gracePeriodDays ?? "30"));
  const [eligibilityMinAge, setEligibilityMinAge] = useState(String(version.eligibilityMinAge ?? "18"));
  const [eligibilityMaxAge, setEligibilityMaxAge] = useState(String(version.eligibilityMaxAge ?? "70"));
  const [dependentMaxAge, setDependentMaxAge] = useState(String(version.dependentMaxAge ?? "20"));
  const [cashInLieuAdult, setCashInLieuAdult] = useState(version.cashInLieuAdult || "");
  const [cashInLieuChild, setCashInLieuChild] = useState(version.cashInLieuChild || "");
  const [isActive, setIsActive] = useState(version.isActive);
  const [commFirstMonths, setCommFirstMonths] = useState(version.commissionFirstMonthsCount != null ? String(version.commissionFirstMonthsCount) : "");
  const [commFirstRate, setCommFirstRate] = useState(version.commissionFirstMonthsRate || "");
  const [commRecurringStart, setCommRecurringStart] = useState(version.commissionRecurringStartMonth != null ? String(version.commissionRecurringStartMonth) : "");
  const [commRecurringRate, setCommRecurringRate] = useState(version.commissionRecurringRate || "");
  const [commClawback, setCommClawback] = useState(version.commissionClawbackThreshold != null ? String(version.commissionClawbackThreshold) : "");
  const [commFuneralIncentive, setCommFuneralIncentive] = useState(version.commissionFuneralIncentive || "");
  const [underwriterAmountAdult, setUnderwriterAmountAdult] = useState(version.underwriterAmountAdult || "");
  const [underwriterAmountChild, setUnderwriterAmountChild] = useState(version.underwriterAmountChild || "");
  const [underwriterSameAmount, setUnderwriterSameAmount] = useState(version.underwriterAmountChild == null || version.underwriterAmountChild === version.underwriterAmountAdult);
  const [underwriterAdvanceMonths, setUnderwriterAdvanceMonths] = useState(String(version.underwriterAdvanceMonths ?? 0));
  const [additionalMemberPremiumMonthlyUsd, setAdditionalMemberPremiumMonthlyUsd] = useState(version.additionalMemberPremiumMonthlyUsd || "");
  const [additionalMemberPremiumMonthlyZar, setAdditionalMemberPremiumMonthlyZar] = useState(version.additionalMemberPremiumMonthlyZar || "");
  const [ageBandRateChildUsd, setAgeBandRateChildUsd] = useState(version.additionalMemberRateChildUsd || "");
  const [ageBandRateChildZar, setAgeBandRateChildZar] = useState(version.additionalMemberRateChildZar || "");
  const [ageBandRate21To65Usd, setAgeBandRate21To65Usd] = useState(version.additionalMemberRate21To65Usd || "");
  const [ageBandRate21To65Zar, setAgeBandRate21To65Zar] = useState(version.additionalMemberRate21To65Zar || "");
  const [ageBandRate66To84Usd, setAgeBandRate66To84Usd] = useState(version.additionalMemberRate66To84Usd || "");
  const [ageBandRate66To84Zar, setAgeBandRate66To84Zar] = useState(version.additionalMemberRate66To84Zar || "");
  const [ageBandRate85PlusUsd, setAgeBandRate85PlusUsd] = useState(version.additionalMemberRate85PlusUsd || "");
  const [ageBandRate85PlusZar, setAgeBandRate85PlusZar] = useState(version.additionalMemberRate85PlusZar || "");
  const [reinstatementRequiresArrears, setReinstatementRequiresArrears] = useState(version.reinstatementRequiresArrears ?? true);
  const [reinstatementNewWaitingPeriod, setReinstatementNewWaitingPeriod] = useState(version.reinstatementNewWaitingPeriod ?? true);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateVersionForm({
      effectiveFrom, premiumMonthlyUsd, premiumMonthlyZar, premiumWeeklyUsd, premiumWeeklyZar,
      premiumBiweeklyUsd, premiumBiweeklyZar, waitingPeriodDays, waitingAccidental, waitingSuicide,
      gracePeriodDays, eligibilityMinAge, eligibilityMaxAge, dependentMaxAge, cashInLieuAdult, cashInLieuChild,
      commFirstMonths, commFirstRate, commRecurringStart, commRecurringRate, commClawback, commFuneralIncentive,
      underwriterAmountAdult, underwriterAmountChild, underwriterAdvanceMonths,
      additionalMemberPremiumMonthlyUsd, additionalMemberPremiumMonthlyZar,
      ageBandRateChildUsd, ageBandRateChildZar, ageBandRate21To65Usd, ageBandRate21To65Zar,
      ageBandRate66To84Usd, ageBandRate66To84Zar, ageBandRate85PlusUsd, ageBandRate85PlusZar,
    });
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    onSubmit({
      effectiveFrom,
      premiumMonthlyUsd: premiumMonthlyUsd || null,
      premiumMonthlyZar: premiumMonthlyZar || null,
      premiumWeeklyUsd: premiumWeeklyUsd || null,
      premiumWeeklyZar: premiumWeeklyZar || null,
      premiumBiweeklyUsd: premiumBiweeklyUsd || null,
      premiumBiweeklyZar: premiumBiweeklyZar || null,
      waitingPeriodDays: waitingPeriodDays ? parseInt(waitingPeriodDays) : null,
      waitingPeriodAccidentalDeath: waitingAccidental ? parseInt(waitingAccidental) : null,
      waitingPeriodSuicide: waitingSuicide ? parseInt(waitingSuicide) : null,
      gracePeriodDays: gracePeriodDays ? parseInt(gracePeriodDays) : null,
      eligibilityMinAge: eligibilityMinAge ? parseInt(eligibilityMinAge) : null,
      eligibilityMaxAge: eligibilityMaxAge ? parseInt(eligibilityMaxAge) : null,
      dependentMaxAge: dependentMaxAge ? parseInt(dependentMaxAge) : null,
      cashInLieuAdult: cashInLieuAdult || null,
      cashInLieuChild: cashInLieuChild || null,
      isActive,
      reinstatementRequiresArrears,
      reinstatementNewWaitingPeriod,
      commissionFirstMonthsCount: commFirstMonths ? parseInt(commFirstMonths) : null,
      commissionFirstMonthsRate: commFirstRate || null,
      commissionRecurringStartMonth: commRecurringStart ? parseInt(commRecurringStart) : null,
      commissionRecurringRate: commRecurringRate || null,
      commissionClawbackThreshold: commClawback ? parseInt(commClawback) : null,
      commissionFuneralIncentive: commFuneralIncentive || null,
      underwriterAmountAdult: underwriterAmountAdult.trim() ? underwriterAmountAdult : null,
      underwriterAmountChild: underwriterSameAmount ? (underwriterAmountAdult.trim() ? underwriterAmountAdult : null) : (underwriterAmountChild.trim() ? underwriterAmountChild : null),
      underwriterAdvanceMonths: underwriterAdvanceMonths ? parseInt(underwriterAdvanceMonths) : 0,
      additionalMemberPremiumMonthlyUsd: additionalMemberPremiumMonthlyUsd.trim() || null,
      additionalMemberPremiumMonthlyZar: additionalMemberPremiumMonthlyZar.trim() || null,
      additionalMemberRateChildUsd: ageBandRateChildUsd.trim() || null,
      additionalMemberRateChildZar: ageBandRateChildZar.trim() || null,
      additionalMemberRate21To65Usd: ageBandRate21To65Usd.trim() || null,
      additionalMemberRate21To65Zar: ageBandRate21To65Zar.trim() || null,
      additionalMemberRate66To84Usd: ageBandRate66To84Usd.trim() || null,
      additionalMemberRate66To84Zar: ageBandRate66To84Zar.trim() || null,
      additionalMemberRate85PlusUsd: ageBandRate85PlusUsd.trim() || null,
      additionalMemberRate85PlusZar: ageBandRate85PlusZar.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Edit Version v{version.version}</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <VersionFormErrorSummary errors={fieldErrors} />
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Effective From *</Label>
              <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required data-testid="input-edit-version-effective-from" className={cn(fieldErrors.effectiveFrom && "border-destructive")} />
              <FieldError message={fieldErrors.effectiveFrom} />
            </div>
            <div className="flex items-center gap-2 pt-7">
              <Checkbox id="edit-version-active" checked={isActive} onCheckedChange={(v) => setIsActive(v === true)} data-testid="checkbox-edit-version-active" />
              <Label htmlFor="edit-version-active" className="text-sm font-normal cursor-pointer">Active</Label>
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Premium Pricing</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Monthly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyUsd} onChange={(e) => setPremiumMonthlyUsd(e.target.value)} placeholder="e.g. 15.00" data-testid="input-edit-version-premium-usd" className={cn(fieldErrors.premiumMonthlyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumMonthlyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Monthly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyZar} onChange={(e) => setPremiumMonthlyZar(e.target.value)} placeholder="e.g. 250.00" data-testid="input-edit-version-premium-zar" className={cn(fieldErrors.premiumMonthlyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumMonthlyZar} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumWeeklyUsd} onChange={(e) => setPremiumWeeklyUsd(e.target.value)} placeholder="e.g. 4.00" data-testid="input-edit-version-premium-weekly" className={cn(fieldErrors.premiumWeeklyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumWeeklyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Weekly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumWeeklyZar} onChange={(e) => setPremiumWeeklyZar(e.target.value)} placeholder="e.g. 75.00" className={cn(fieldErrors.premiumWeeklyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumWeeklyZar} />
            </div>
            <div className="space-y-2">
              <Label>Bi-weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumBiweeklyUsd} onChange={(e) => setPremiumBiweeklyUsd(e.target.value)} placeholder="e.g. 7.50" data-testid="input-edit-version-premium-biweekly" className={cn(fieldErrors.premiumBiweeklyUsd && "border-destructive")} />
              <FieldError message={fieldErrors.premiumBiweeklyUsd} />
            </div>
            <div className="space-y-2">
              <Label>Bi-weekly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumBiweeklyZar} onChange={(e) => setPremiumBiweeklyZar(e.target.value)} placeholder="e.g. 140.00" className={cn(fieldErrors.premiumBiweeklyZar && "border-destructive")} />
              <FieldError message={fieldErrors.premiumBiweeklyZar} />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Waiting & Grace Periods</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Natural Death (days)</Label>
              <Input type="number" value={waitingPeriodDays} onChange={(e) => setWaitingPeriodDays(e.target.value)} data-testid="input-edit-version-waiting" className={cn(fieldErrors.waitingPeriodDays && "border-destructive")} />
              <FieldError message={fieldErrors.waitingPeriodDays} />
            </div>
            <div className="space-y-2">
              <Label>Accidental Death (days)</Label>
              <Input type="number" value={waitingAccidental} onChange={(e) => setWaitingAccidental(e.target.value)} data-testid="input-edit-version-waiting-accidental" className={cn(fieldErrors.waitingAccidental && "border-destructive")} />
              <FieldError message={fieldErrors.waitingAccidental} />
            </div>
            <div className="space-y-2">
              <Label>Suicide (days)</Label>
              <Input type="number" value={waitingSuicide} onChange={(e) => setWaitingSuicide(e.target.value)} data-testid="input-edit-version-waiting-suicide" className={cn(fieldErrors.waitingSuicide && "border-destructive")} />
              <FieldError message={fieldErrors.waitingSuicide} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Grace Period (days)</Label>
            <Input type="number" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} data-testid="input-edit-version-grace" className={cn(fieldErrors.gracePeriodDays && "border-destructive")} />
            <FieldError message={fieldErrors.gracePeriodDays} />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Reinstatement Rules</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex items-center gap-2">
              <Checkbox id="edit-reinstatement-arrears" checked={reinstatementRequiresArrears} onCheckedChange={(v) => setReinstatementRequiresArrears(v === true)} data-testid="checkbox-edit-reinstatement-arrears" />
              <Label htmlFor="edit-reinstatement-arrears" className="text-sm font-normal cursor-pointer">Requires arrears payment</Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="edit-reinstatement-waiting" checked={reinstatementNewWaitingPeriod} onCheckedChange={(v) => setReinstatementNewWaitingPeriod(v === true)} data-testid="checkbox-edit-reinstatement-waiting" />
              <Label htmlFor="edit-reinstatement-waiting" className="text-sm font-normal cursor-pointer">New waiting period on reinstatement</Label>
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Age Eligibility</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Min Age (main member)</Label>
              <Input type="number" value={eligibilityMinAge} onChange={(e) => setEligibilityMinAge(e.target.value)} data-testid="input-edit-version-min-age" className={cn(fieldErrors.eligibilityMinAge && "border-destructive")} />
              <FieldError message={fieldErrors.eligibilityMinAge} />
            </div>
            <div className="space-y-2">
              <Label>Max Age (main member)</Label>
              <Input type="number" value={eligibilityMaxAge} onChange={(e) => setEligibilityMaxAge(e.target.value)} data-testid="input-edit-version-max-age" className={cn(fieldErrors.eligibilityMaxAge && "border-destructive")} />
              <FieldError message={fieldErrors.eligibilityMaxAge} />
            </div>
            <div className="space-y-2">
              <Label>Max Dependent Age</Label>
              <Input type="number" value={dependentMaxAge} onChange={(e) => setDependentMaxAge(e.target.value)} data-testid="input-edit-version-dependent-max-age" className={cn(fieldErrors.dependentMaxAge && "border-destructive")} />
              <FieldError message={fieldErrors.dependentMaxAge} />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cash in Lieu (optional)</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Adult Cash in Lieu</Label>
              <Input type="number" step="0.01" value={cashInLieuAdult} onChange={(e) => setCashInLieuAdult(e.target.value)} placeholder="e.g. 5000.00" data-testid="input-edit-version-cash-adult" />
            </div>
            <div className="space-y-2">
              <Label>Child Cash in Lieu</Label>
              <Input type="number" step="0.01" value={cashInLieuChild} onChange={(e) => setCashInLieuChild(e.target.value)} placeholder="e.g. 2500.00" data-testid="input-edit-version-cash-child" />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Agent Commission</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Initial Months Count</Label>
              <Input type="number" value={commFirstMonths} onChange={(e) => setCommFirstMonths(e.target.value)} placeholder="e.g. 2" data-testid="input-edit-version-comm-first-months" />
            </div>
            <div className="space-y-2">
              <Label>Initial Months Rate (%)</Label>
              <Input type="number" step="0.01" value={commFirstRate} onChange={(e) => setCommFirstRate(e.target.value)} placeholder="e.g. 50" data-testid="input-edit-version-comm-first-rate" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Recurring Start Month</Label>
              <Input type="number" value={commRecurringStart} onChange={(e) => setCommRecurringStart(e.target.value)} placeholder="e.g. 5" data-testid="input-edit-version-comm-recurring-start" />
            </div>
            <div className="space-y-2">
              <Label>Recurring Rate (%)</Label>
              <Input type="number" step="0.01" value={commRecurringRate} onChange={(e) => setCommRecurringRate(e.target.value)} placeholder="e.g. 10" data-testid="input-edit-version-comm-recurring-rate" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Clawback Threshold (payments)</Label>
              <Input type="number" value={commClawback} onChange={(e) => setCommClawback(e.target.value)} placeholder="e.g. 4" data-testid="input-edit-version-comm-clawback" />
            </div>
            <div className="space-y-2">
              <Label>Funeral Service Incentive</Label>
              <Input type="number" step="0.01" value={commFuneralIncentive} onChange={(e) => setCommFuneralIncentive(e.target.value)} placeholder="e.g. 50.00" data-testid="input-edit-version-comm-funeral" />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Underwriter (optional)</h3>
          <p className="text-sm text-muted-foreground">Amount the tenant pays to the underwriter per member per month. Leave blank if no underwriter.</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Amount per adult (per month)</Label>
              <Input type="number" step="0.01" value={underwriterAmountAdult} onChange={(e) => setUnderwriterAmountAdult(e.target.value)} placeholder="Optional — e.g. 5.00" data-testid="input-edit-version-underwriter-adult" />
            </div>
            <div className="space-y-2">
              <Label>Amount per child (per month)</Label>
              <Input type="number" step="0.01" value={underwriterAmountChild} onChange={(e) => setUnderwriterAmountChild(e.target.value)} placeholder="Same as adult if not set" data-testid="input-edit-version-underwriter-child" disabled={underwriterSameAmount} />
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox id="edit-underwriter-same-amount" checked={underwriterSameAmount} onCheckedChange={(v) => setUnderwriterSameAmount(v === true)} data-testid="checkbox-edit-underwriter-same-amount" />
            <Label htmlFor="edit-underwriter-same-amount" className="text-sm font-normal cursor-pointer">Same amount for adult and child</Label>
          </div>
          <div className="space-y-2">
            <Label>Pay underwriter in advance (months)</Label>
            <Input type="number" min={0} value={underwriterAdvanceMonths} onChange={(e) => setUnderwriterAdvanceMonths(e.target.value)} placeholder="e.g. 3" data-testid="input-edit-version-underwriter-advance" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Additional / Extended Members</h3>
          <p className="text-sm text-muted-foreground">
            Per-member premium charged for each member beyond the product's included count (max adults + max children + max extended).
            Leave blank if no extra charge applies.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Per additional member / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={additionalMemberPremiumMonthlyUsd} onChange={(e) => setAdditionalMemberPremiumMonthlyUsd(e.target.value)} placeholder="e.g. 5.00" data-testid="input-edit-version-additional-member-usd" />
            </div>
            <div className="space-y-2">
              <Label>Per additional member / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={additionalMemberPremiumMonthlyZar} onChange={(e) => setAdditionalMemberPremiumMonthlyZar(e.target.value)} placeholder="e.g. 90.00" data-testid="input-edit-version-additional-member-zar" />
            </div>
          </div>

          <p className="text-sm text-muted-foreground">
            Optional: price additional members by age band instead of one flat rate above. Leave all blank to keep the flat rate.
            "Child" uses the dependent age cutoff set above; existing policies on this version are unaffected until you fill these in.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Child / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRateChildUsd} onChange={(e) => setAgeBandRateChildUsd(e.target.value)} data-testid="input-edit-version-ageband-child-usd" />
            </div>
            <div className="space-y-2">
              <Label>Child / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRateChildZar} onChange={(e) => setAgeBandRateChildZar(e.target.value)} data-testid="input-edit-version-ageband-child-zar" />
            </div>
            <div className="space-y-2">
              <Label>21–65 / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate21To65Usd} onChange={(e) => setAgeBandRate21To65Usd(e.target.value)} data-testid="input-edit-version-ageband-21-65-usd" />
            </div>
            <div className="space-y-2">
              <Label>21–65 / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate21To65Zar} onChange={(e) => setAgeBandRate21To65Zar(e.target.value)} data-testid="input-edit-version-ageband-21-65-zar" />
            </div>
            <div className="space-y-2">
              <Label>66–84 / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate66To84Usd} onChange={(e) => setAgeBandRate66To84Usd(e.target.value)} data-testid="input-edit-version-ageband-66-84-usd" />
            </div>
            <div className="space-y-2">
              <Label>66–84 / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate66To84Zar} onChange={(e) => setAgeBandRate66To84Zar(e.target.value)} data-testid="input-edit-version-ageband-66-84-zar" />
            </div>
            <div className="space-y-2">
              <Label>85+ / month (USD)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate85PlusUsd} onChange={(e) => setAgeBandRate85PlusUsd(e.target.value)} data-testid="input-edit-version-ageband-85-plus-usd" />
            </div>
            <div className="space-y-2">
              <Label>85+ / month (ZAR)</Label>
              <Input type="number" step="0.01" min={0} value={ageBandRate85PlusZar} onChange={(e) => setAgeBandRate85PlusZar(e.target.value)} data-testid="input-edit-version-ageband-85-plus-zar" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !effectiveFrom} data-testid="button-update-version">
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateBenefitDialog({ open, onClose, onSubmit, isPending }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Benefit Item</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || undefined, internalCostDefault: cost || undefined }); }} className="space-y-4">
          <div className="space-y-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-benefit-name" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-benefit-description" /></div>
          <div className="space-y-2"><Label>Default Internal Cost</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="e.g. 50.00" data-testid="input-benefit-cost" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name} data-testid="button-submit-benefit">{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateBundleDialog({ open, onClose, onSubmit, isPending }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Benefit Bundle</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || undefined }); }} className="space-y-4">
          <div className="space-y-2"><Label>Bundle Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required data-testid="input-bundle-name" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} data-testid="input-bundle-description" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name} data-testid="button-submit-bundle">{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateAddOnDialog({ open, onClose, onSubmit, isPending }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pricingMode, setPricingMode] = useState("flat");
  const [priceMonthly, setPriceMonthly] = useState("");
  const [priceWeekly, setPriceWeekly] = useState("");
  const [priceBiweekly, setPriceBiweekly] = useState("");
  const [priceAmount, setPriceAmount] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Add-On</DialogTitle></DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name,
            description: description || undefined,
            pricingMode,
            priceAmount: priceMonthly || priceAmount || undefined,
            priceMonthly: priceMonthly || undefined,
            priceWeekly: priceWeekly || undefined,
            priceBiweekly: priceBiweekly || undefined,
          });
        }} className="space-y-4">
          <div className="space-y-2"><Label>Add-On Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Tombstone Cover" data-testid="input-addon-name" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What does this add-on provide?" data-testid="input-addon-description" /></div>
          <div className="space-y-2">
            <Label>Pricing Mode</Label>
            <Select value={pricingMode} onValueChange={setPricingMode}>
              <SelectTrigger data-testid="input-addon-pricing-mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat Rate</SelectItem>
                <SelectItem value="percentage">Percentage of base premium</SelectItem>
                <SelectItem value="per_member">Per Member</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pricingMode === "percentage" ? (
            <div className="space-y-2">
              <Label>Percentage (%)</Label>
              <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder="e.g. 10" data-testid="input-addon-price" />
            </div>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">Set the price for each billing frequency, just like the main product.</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label className="text-xs">Monthly ($)</Label>
                  <Input type="number" step="0.01" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} placeholder="e.g. 10.00" data-testid="input-addon-price-monthly" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Weekly ($)</Label>
                  <Input type="number" step="0.01" value={priceWeekly} onChange={(e) => setPriceWeekly(e.target.value)} placeholder="e.g. 2.50" data-testid="input-addon-price-weekly" />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Bi-weekly ($)</Label>
                  <Input type="number" step="0.01" value={priceBiweekly} onChange={(e) => setPriceBiweekly(e.target.value)} placeholder="e.g. 5.00" data-testid="input-addon-price-biweekly" />
                </div>
              </div>
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name} data-testid="button-submit-addon">{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Add-On</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateAgeBandDialog({ open, onClose, onSubmit, isPending }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState("");
  const [minAge, setMinAge] = useState("0");
  const [maxAge, setMaxAge] = useState("17");
  const [effectiveFrom, setEffectiveFrom] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Age Band</DialogTitle></DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault();
          const min = parseInt(minAge, 10);
          const max = parseInt(maxAge, 10);
          if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return;
          onSubmit({ name, minAge: min, maxAge: max, effectiveFrom: effectiveFrom || undefined });
        }} className="space-y-4">
          <div className="space-y-2"><Label>Band Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Child (0-17)" data-testid="input-ageband-name" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Min Age</Label><Input type="number" min="0" value={minAge} onChange={(e) => setMinAge(e.target.value)} data-testid="input-ageband-min" /></div>
            <div className="space-y-2"><Label>Max Age</Label><Input type="number" min="0" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} data-testid="input-ageband-max" /></div>
          </div>
          <div className="space-y-2"><Label>Effective From</Label><Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} data-testid="input-ageband-effective" /></div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name} data-testid="button-submit-ageband">{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAddOnDialog({ addon, open, onClose, onSubmit, isPending }: {
  addon: AddOn; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState(addon.name);
  const [description, setDescription] = useState(addon.description || "");
  const [pricingMode, setPricingMode] = useState(addon.pricingMode);
  const [priceMonthly, setPriceMonthly] = useState(addon.priceMonthly || addon.priceAmount || "");
  const [priceWeekly, setPriceWeekly] = useState(addon.priceWeekly || "");
  const [priceBiweekly, setPriceBiweekly] = useState(addon.priceBiweekly || "");
  const [priceAmount, setPriceAmount] = useState(addon.priceAmount || "");
  const [isActive, setIsActive] = useState(addon.isActive);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Add-On</DialogTitle></DialogHeader>
        <form onSubmit={(e) => {
          e.preventDefault();
          onSubmit({
            name,
            description: description || null,
            pricingMode,
            priceAmount: priceMonthly || priceAmount || null,
            priceMonthly: priceMonthly || null,
            priceWeekly: priceWeekly || null,
            priceBiweekly: priceBiweekly || null,
            isActive,
          });
        }} className="space-y-4">
          <div className="space-y-2"><Label>Add-On Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div className="space-y-2">
            <Label>Pricing Mode</Label>
            <Select value={pricingMode} onValueChange={setPricingMode}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="flat">Flat Rate</SelectItem>
                <SelectItem value="percentage">Percentage of base premium</SelectItem>
                <SelectItem value="per_member">Per Member</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {pricingMode === "percentage" ? (
            <div className="space-y-2">
              <Label>Percentage (%)</Label>
              <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} />
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label className="text-xs">Monthly ($)</Label>
                <Input type="number" step="0.01" value={priceMonthly} onChange={(e) => setPriceMonthly(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Weekly ($)</Label>
                <Input type="number" step="0.01" value={priceWeekly} onChange={(e) => setPriceWeekly(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Bi-weekly ($)</Label>
                <Input type="number" step="0.01" value={priceBiweekly} onChange={(e) => setPriceBiweekly(e.target.value)} />
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Checkbox id="addon-active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <label htmlFor="addon-active" className="text-sm cursor-pointer">Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBenefitDialog({ benefit, open, onClose, onSubmit, isPending }: {
  benefit: BenefitCatalogItem; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState(benefit.name);
  const [description, setDescription] = useState(benefit.description || "");
  const [cost, setCost] = useState(benefit.internalCostDefault || "");
  const [isActive, setIsActive] = useState(benefit.isActive);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Benefit Item</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || null, internalCostDefault: cost || null, isActive }); }} className="space-y-4">
          <div className="space-y-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div className="space-y-2"><Label>Default Internal Cost</Label><Input type="number" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
          <div className="flex items-center gap-2">
            <Checkbox id="benefit-active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <label htmlFor="benefit-active" className="text-sm cursor-pointer">Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditBundleDialog({ bundle, open, onClose, onSubmit, isPending }: {
  bundle: BenefitBundle; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState(bundle.name);
  const [description, setDescription] = useState(bundle.description || "");
  const [isActive, setIsActive] = useState(bundle.isActive);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Benefit Bundle</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || null, isActive }); }} className="space-y-4">
          <div className="space-y-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div className="flex items-center gap-2">
            <Checkbox id="bundle-active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <label htmlFor="bundle-active" className="text-sm cursor-pointer">Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditAgeBandDialog({ ageBand, open, onClose, onSubmit, isPending }: {
  ageBand: AgeBandConfig; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [name, setName] = useState(ageBand.name);
  const [minAge, setMinAge] = useState(String(ageBand.minAge));
  const [maxAge, setMaxAge] = useState(String(ageBand.maxAge));
  const [isActive, setIsActive] = useState(ageBand.isActive);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit Age Band</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, minAge: parseInt(minAge), maxAge: parseInt(maxAge), isActive }); }} className="space-y-4">
          <div className="space-y-2"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Min Age</Label><Input type="number" value={minAge} onChange={(e) => setMinAge(e.target.value)} /></div>
            <div className="space-y-2"><Label>Max Age</Label><Input type="number" value={maxAge} onChange={(e) => setMaxAge(e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="ageband-active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <label htmlFor="ageband-active" className="text-sm cursor-pointer">Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !name}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CreateTermDialog({ open, onClose, onSubmit, isPending, productVersions }: {
  open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
  productVersions: { id: string; productName: string; version: number }[];
}) {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [sortOrder, setSortOrder] = useState("0");
  const [pvId, setPvId] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) { onClose(); setTitle(""); setContent(""); setCategory("general"); setSortOrder("0"); setPvId(""); } }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Create Term / Clause</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, content, category, sortOrder: parseInt(sortOrder) || 0, productVersionId: pvId || null }); }} className="space-y-4">
          <div className="space-y-2">
            <Label>Product Version (optional)</Label>
            <Select value={pvId || "__general__"} onValueChange={(v) => setPvId(v === "__general__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="General (all products)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__general__">General (all products)</SelectItem>
                {productVersions.map((pv) => (
                  <SelectItem key={pv.id} value={pv.id}>{pv.productName} v{pv.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Waiting Period Clause" /></div>
          <div className="space-y-2"><Label>Content *</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={5} placeholder="Full clause text in English — auto-translated when downloading in other languages" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="coverage">Coverage</SelectItem>
                  <SelectItem value="exclusions">Exclusions</SelectItem>
                  <SelectItem value="claims">Claims</SelectItem>
                  <SelectItem value="cancellation">Cancellation</SelectItem>
                  <SelectItem value="privacy">Privacy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Sort Order</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !title || !content}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Create Term</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditTermDialog({ term, open, onClose, onSubmit, isPending, productVersions }: {
  term: any; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
  productVersions: { id: string; productName: string; version: number }[];
}) {
  const [title, setTitle] = useState(term.title);
  const [content, setContent] = useState(term.content);
  const [category, setCategory] = useState(term.category || "general");
  const [sortOrder, setSortOrder] = useState(String(term.sortOrder || 0));
  const [pvId, setPvId] = useState(term.productVersionId || "");
  const [isActive, setIsActive] = useState(term.isActive);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Edit Term / Clause</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ title, content, category, sortOrder: parseInt(sortOrder) || 0, productVersionId: pvId || null, isActive }); }} className="space-y-4">
          <div className="space-y-2">
            <Label>Product Version (optional)</Label>
            <Select value={pvId || "__general__"} onValueChange={(v) => setPvId(v === "__general__" ? "" : v)}>
              <SelectTrigger><SelectValue placeholder="General (all products)" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__general__">General (all products)</SelectItem>
                {productVersions.map((pv) => (
                  <SelectItem key={pv.id} value={pv.id}>{pv.productName} v{pv.version}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2"><Label>Title *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} required /></div>
          <div className="space-y-2"><Label>Content *</Label><Textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={5} /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="coverage">Coverage</SelectItem>
                  <SelectItem value="exclusions">Exclusions</SelectItem>
                  <SelectItem value="claims">Claims</SelectItem>
                  <SelectItem value="cancellation">Cancellation</SelectItem>
                  <SelectItem value="privacy">Privacy</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Sort Order</Label><Input type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} /></div>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox id="edit-term-active" checked={isActive} onCheckedChange={(v) => setIsActive(!!v)} />
            <label htmlFor="edit-term-active" className="text-sm cursor-pointer">Active</label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={isPending || !title || !content}>{isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save Changes</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
