import { useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import StaffLayout from "@/components/layout/staff-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Box, Search, Loader2, Package, Layers, Puzzle, BarChart3,
  Edit, ChevronDown, ChevronUp, Upload, Image, Users, Baby, Crown,
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
  premiumBiweeklyUsd: string | null;
  eligibilityMinAge: number | null;
  eligibilityMaxAge: number | null;
  dependentMaxAge: number | null;
  waitingPeriodDays: number | null;
  waitingPeriodAccidentalDeath: number | null;
  waitingPeriodSuicide: number | null;
  gracePeriodDays: number | null;
  cashInLieuAdult: string | null;
  cashInLieuChild: string | null;
  isActive: boolean;
};

type BenefitCatalogItem = { id: string; name: string; description: string | null; internalCostDefault: string | null; isActive: boolean; };
type BenefitBundle = { id: string; name: string; description: string | null; items: unknown; isActive: boolean; };
type AddOn = { id: string; name: string; description: string | null; pricingMode: string; priceAmount: string | null; isActive: boolean; };
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
  const [showCreateBenefit, setShowCreateBenefit] = useState(false);
  const [showCreateBundle, setShowCreateBundle] = useState(false);
  const [showCreateAddOn, setShowCreateAddOn] = useState(false);
  const [showCreateAgeBand, setShowCreateAgeBand] = useState(false);
  const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);

  const { data: products = [], isLoading: loadingProducts } = useQuery<Product[]>({ queryKey: ["/api/products"] });
  const { data: benefitCatalog = [], isLoading: loadingBenefits } = useQuery<BenefitCatalogItem[]>({ queryKey: ["/api/benefit-catalog"] });
  const { data: benefitBundles = [], isLoading: loadingBundles } = useQuery<BenefitBundle[]>({ queryKey: ["/api/benefit-bundles"] });
  const { data: addOns = [], isLoading: loadingAddOns } = useQuery<AddOn[]>({ queryKey: ["/api/add-ons"] });
  const { data: ageBands = [], isLoading: loadingAgeBands } = useQuery<AgeBandConfig[]>({ queryKey: ["/api/age-bands"] });

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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-display font-bold tracking-tight" data-testid="text-page-title">Product Builder</h1>
            <p className="text-muted-foreground mt-1">Configure products, benefits, add-ons, and pricing.</p>
          </div>
        </div>

        <div className="grid md:grid-cols-4 gap-4">
          <Card className="bg-primary/5 border-primary/20 shadow-sm">
            <CardHeader className="pb-2"><Package className="h-6 w-6 text-primary mb-1" /><CardDescription>Active Products</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-display font-bold" data-testid="text-active-products-count">{loadingProducts ? "—" : activeProductCount}</p></CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><Layers className="h-6 w-6 text-muted-foreground mb-1" /><CardDescription>Benefit Items</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-display font-bold" data-testid="text-benefit-count">{loadingBenefits ? "—" : benefitCatalog.length}</p></CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><Puzzle className="h-6 w-6 text-muted-foreground mb-1" /><CardDescription>Add-Ons</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-display font-bold" data-testid="text-addon-count">{loadingAddOns ? "—" : addOns.length}</p></CardContent>
          </Card>
          <Card className="shadow-sm">
            <CardHeader className="pb-2"><BarChart3 className="h-6 w-6 text-muted-foreground mb-1" /><CardDescription>Age Bands</CardDescription></CardHeader>
            <CardContent><p className="text-2xl font-display font-bold" data-testid="text-ageband-count">{loadingAgeBands ? "—" : ageBands.length}</p></CardContent>
          </Card>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList>
            <TabsTrigger value="products" data-testid="tab-products">Products</TabsTrigger>
            <TabsTrigger value="benefits" data-testid="tab-benefits">Benefits</TabsTrigger>
            <TabsTrigger value="bundles" data-testid="tab-bundles">Bundles</TabsTrigger>
            <TabsTrigger value="addons" data-testid="tab-addons">Add-Ons</TabsTrigger>
            <TabsTrigger value="agebands" data-testid="tab-agebands">Age Bands</TabsTrigger>
          </TabsList>

          <TabsContent value="products">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle>Configured Products</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative w-64">
                      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input placeholder="Search products..." className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="input-search-products" />
                    </div>
                    <Button className="gap-2" onClick={() => setShowCreateProduct(true)} data-testid="button-create-product">
                      <Plus className="h-4 w-4" /> New Product
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingProducts ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
                ) : filteredProducts.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><Box className="h-10 w-10 mx-auto mb-3 opacity-40" /><p>No products found</p></div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
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
                        />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="benefits">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div><CardTitle>Benefit Catalog</CardTitle><CardDescription>Individual benefit items that can be grouped into bundles.</CardDescription></div>
                  <Button className="gap-2" onClick={() => setShowCreateBenefit(true)} data-testid="button-create-benefit"><Plus className="h-4 w-4" /> New Benefit</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingBenefits ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : benefitCatalog.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><Layers className="h-10 w-10 mx-auto mb-3 opacity-40" /><p>No benefit items yet</p></div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Default Cost</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {benefitCatalog.map((item) => (
                        <TableRow key={item.id} data-testid={`row-benefit-${item.id}`}>
                          <TableCell className="font-medium pl-6">{item.name}</TableCell>
                          <TableCell className="text-muted-foreground">{item.description || "—"}</TableCell>
                          <TableCell>{item.internalCostDefault ? `$${item.internalCostDefault}` : "—"}</TableCell>
                          <TableCell><Badge variant={item.isActive ? "default" : "secondary"} className={item.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{item.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bundles">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div><CardTitle>Benefit Bundles</CardTitle><CardDescription>Groups of benefits linked to product versions.</CardDescription></div>
                  <Button className="gap-2" onClick={() => setShowCreateBundle(true)} data-testid="button-create-bundle"><Plus className="h-4 w-4" /> New Bundle</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingBundles ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : benefitBundles.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><Package className="h-10 w-10 mx-auto mb-3 opacity-40" /><p>No bundles yet</p></div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {benefitBundles.map((bundle) => (
                        <TableRow key={bundle.id} data-testid={`row-bundle-${bundle.id}`}>
                          <TableCell className="font-medium pl-6">{bundle.name}</TableCell>
                          <TableCell className="text-muted-foreground">{bundle.description || "—"}</TableCell>
                          <TableCell><Badge variant={bundle.isActive ? "default" : "secondary"} className={bundle.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{bundle.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="addons">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div><CardTitle>Add-Ons</CardTitle><CardDescription>Optional extras with their own premiums that can be added to policies.</CardDescription></div>
                  <Button className="gap-2" onClick={() => setShowCreateAddOn(true)} data-testid="button-create-addon"><Plus className="h-4 w-4" /> New Add-On</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingAddOns ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : addOns.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><Puzzle className="h-10 w-10 mx-auto mb-3 opacity-40" /><p>No add-ons yet</p></div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Pricing</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {addOns.map((addon) => (
                        <TableRow key={addon.id} data-testid={`row-addon-${addon.id}`}>
                          <TableCell className="font-medium pl-6">{addon.name}</TableCell>
                          <TableCell className="text-muted-foreground">{addon.description || "—"}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-[10px]">{addon.pricingMode}</Badge></TableCell>
                          <TableCell className="font-semibold">{addon.priceAmount ? `$${addon.priceAmount}/mo` : "—"}</TableCell>
                          <TableCell><Badge variant={addon.isActive ? "default" : "secondary"} className={addon.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{addon.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="agebands">
            <Card className="shadow-sm">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div><CardTitle>Age Band Configuration</CardTitle><CardDescription>Age-based pricing modifiers for products.</CardDescription></div>
                  <Button className="gap-2" onClick={() => setShowCreateAgeBand(true)} data-testid="button-create-ageband"><Plus className="h-4 w-4" /> New Age Band</Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {loadingAgeBands ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : ageBands.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground"><BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-40" /><p>No age bands configured</p></div>
                ) : (
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead className="pl-6">Name</TableHead>
                        <TableHead>Min Age</TableHead>
                        <TableHead>Max Age</TableHead>
                        <TableHead>Version</TableHead>
                        <TableHead>Effective From</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ageBands.map((band) => (
                        <TableRow key={band.id} data-testid={`row-ageband-${band.id}`}>
                          <TableCell className="font-medium pl-6">{band.name}</TableCell>
                          <TableCell>{band.minAge}</TableCell>
                          <TableCell>{band.maxAge}</TableCell>
                          <TableCell><Badge variant="outline" className="font-mono text-[10px]">v{band.version}</Badge></TableCell>
                          <TableCell className="text-muted-foreground">{band.effectiveFrom || "—"}</TableCell>
                          <TableCell><Badge variant={band.isActive ? "default" : "secondary"} className={band.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{band.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <CreateProductDialog open={showCreateProduct} onClose={() => setShowCreateProduct(false)} onSubmit={(data) => createProductMut.mutate(data)} isPending={createProductMut.isPending} />
      {editingProduct && <EditProductDialog product={editingProduct} open={!!editingProduct} onClose={() => setEditingProduct(null)} onSubmit={(data) => updateProductMut.mutate({ id: editingProduct.id, data })} isPending={updateProductMut.isPending} />}
      {showCreateVersion && <CreateVersionDialog productId={showCreateVersion} open={!!showCreateVersion} onClose={() => setShowCreateVersion(null)} onSubmit={(data) => createVersionMut.mutate({ productId: showCreateVersion, data })} isPending={createVersionMut.isPending} />}
      <CreateBenefitDialog open={showCreateBenefit} onClose={() => setShowCreateBenefit(false)} onSubmit={(data) => createBenefitMut.mutate(data)} isPending={createBenefitMut.isPending} />
      <CreateBundleDialog open={showCreateBundle} onClose={() => setShowCreateBundle(false)} onSubmit={(data) => createBundleMut.mutate(data)} isPending={createBundleMut.isPending} />
      <CreateAddOnDialog open={showCreateAddOn} onClose={() => setShowCreateAddOn(false)} onSubmit={(data) => createAddOnMut.mutate(data)} isPending={createAddOnMut.isPending} />
      <CreateAgeBandDialog open={showCreateAgeBand} onClose={() => setShowCreateAgeBand(false)} onSubmit={(data) => createAgeBandMut.mutate(data)} isPending={createAgeBandMut.isPending} />
    </StaffLayout>
  );
}

function ProductRow({ product, isExpanded, onToggle, onEdit, onCreateVersion }: {
  product: Product; isExpanded: boolean; onToggle: () => void; onEdit: () => void; onCreateVersion: () => void;
}) {
  const { data: versions = [], isLoading } = useQuery<ProductVersion[]>({
    queryKey: [`/api/products/${product.id}/versions`],
    enabled: isExpanded,
  });

  return (
    <>
      <TableRow className="hover:bg-muted/30 transition-colors" data-testid={`row-product-${product.id}`}>
        <TableCell className="pl-6">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onToggle} data-testid={`button-expand-product-${product.id}`}>
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            {product.casketImageUrl ? (
              <img src={product.casketImageUrl} alt={product.casketType || ""} className="h-10 w-10 rounded object-cover border" />
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
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit} data-testid={`button-edit-product-${product.id}`}><Edit className="h-4 w-4" /></Button>
            <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs" onClick={onCreateVersion} data-testid={`button-new-version-${product.id}`}><Plus className="h-3 w-3" /> Version</Button>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Effective From</TableHead>
                      <TableHead>Monthly (USD)</TableHead>
                      <TableHead>Monthly (ZAR)</TableHead>
                      <TableHead>Weekly (USD)</TableHead>
                      <TableHead>Waiting</TableHead>
                      <TableHead>Grace</TableHead>
                      <TableHead>Age Range</TableHead>
                      <TableHead>Cash in Lieu</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {versions.map((v) => (
                      <TableRow key={v.id} data-testid={`row-version-${v.id}`}>
                        <TableCell><Badge variant="outline" className="font-mono text-[10px]">v{v.version}</Badge></TableCell>
                        <TableCell>{v.effectiveFrom}</TableCell>
                        <TableCell className="font-semibold">{v.premiumMonthlyUsd ? `$${v.premiumMonthlyUsd}` : "—"}</TableCell>
                        <TableCell>{v.premiumMonthlyZar ? `R${v.premiumMonthlyZar}` : "—"}</TableCell>
                        <TableCell>{v.premiumWeeklyUsd ? `$${v.premiumWeeklyUsd}` : "—"}</TableCell>
                        <TableCell>{v.waitingPeriodDays != null ? `${v.waitingPeriodDays}d` : "—"}</TableCell>
                        <TableCell>{v.gracePeriodDays != null ? `${v.gracePeriodDays}d` : "—"}</TableCell>
                        <TableCell>{v.eligibilityMinAge ?? "—"} – {v.eligibilityMaxAge ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {v.cashInLieuAdult ? `Adult: $${v.cashInLieuAdult}` : ""}
                          {v.cashInLieuAdult && v.cashInLieuChild ? " / " : ""}
                          {v.cashInLieuChild ? `Child: $${v.cashInLieuChild}` : ""}
                          {!v.cashInLieuAdult && !v.cashInLieuChild ? "—" : ""}
                        </TableCell>
                        <TableCell><Badge variant={v.isActive ? "default" : "secondary"} className={v.isActive ? "bg-emerald-500/15 text-emerald-700 border-emerald-200" : ""}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
      const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
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

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cover & Casket</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Cover Amount</Label>
              <Input type="number" step="0.01" min="0" value={coverAmount} onChange={(e) => setCoverAmount(e.target.value)} placeholder="e.g. 15000" data-testid="input-cover-amount" />
            </div>
            <div className="space-y-2">
              <Label>Cover Currency</Label>
              <Select value={coverCurrency} onValueChange={setCoverCurrency}>
                <SelectTrigger data-testid="select-cover-currency"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD</SelectItem>
                  <SelectItem value="ZAR">ZAR</SelectItem>
                  <SelectItem value="ZWL">ZWL</SelectItem>
                  <SelectItem value="BWP">BWP</SelectItem>
                </SelectContent>
              </Select>
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
                  <img src={casketImageUrl} alt="Casket" className="h-24 w-32 rounded-lg object-cover border shadow-sm" />
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
      const res = await fetch("/api/upload", { method: "POST", body: formData, credentials: "include" });
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
    onSubmit({
      name,
      description: description || null,
      maxAdults: parseInt(maxAdults),
      maxChildren: parseInt(maxChildren),
      maxExtendedMembers: parseInt(maxExtended),
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

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Cover & Casket</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2"><Label>Cover Amount</Label><Input type="number" step="0.01" value={coverAmount} onChange={(e) => setCoverAmount(e.target.value)} /></div>
            <div className="space-y-2">
              <Label>Cover Currency</Label>
              <Select value={coverCurrency} onValueChange={setCoverCurrency}><SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="USD">USD</SelectItem><SelectItem value="ZAR">ZAR</SelectItem><SelectItem value="ZWL">ZWL</SelectItem><SelectItem value="BWP">BWP</SelectItem></SelectContent>
              </Select>
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
                  <img src={casketImageUrl} alt="Casket" className="h-24 w-32 rounded-lg object-cover border" />
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

function CreateVersionDialog({ productId, open, onClose, onSubmit, isPending }: {
  productId: string; open: boolean; onClose: () => void; onSubmit: (data: Record<string, unknown>) => void; isPending: boolean;
}) {
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [premiumMonthlyUsd, setPremiumMonthlyUsd] = useState("");
  const [premiumMonthlyZar, setPremiumMonthlyZar] = useState("");
  const [premiumWeeklyUsd, setPremiumWeeklyUsd] = useState("");
  const [premiumBiweeklyUsd, setPremiumBiweeklyUsd] = useState("");
  const [waitingPeriodDays, setWaitingPeriodDays] = useState("90");
  const [waitingAccidental, setWaitingAccidental] = useState("0");
  const [waitingSuicide, setWaitingSuicide] = useState("0");
  const [gracePeriodDays, setGracePeriodDays] = useState("30");
  const [eligibilityMinAge, setEligibilityMinAge] = useState("18");
  const [eligibilityMaxAge, setEligibilityMaxAge] = useState("70");
  const [dependentMaxAge, setDependentMaxAge] = useState("20");
  const [cashInLieuAdult, setCashInLieuAdult] = useState("");
  const [cashInLieuChild, setCashInLieuChild] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      effectiveFrom,
      premiumMonthlyUsd: premiumMonthlyUsd || undefined,
      premiumMonthlyZar: premiumMonthlyZar || undefined,
      premiumWeeklyUsd: premiumWeeklyUsd || undefined,
      premiumBiweeklyUsd: premiumBiweeklyUsd || undefined,
      waitingPeriodDays: waitingPeriodDays ? parseInt(waitingPeriodDays) : undefined,
      waitingPeriodAccidentalDeath: waitingAccidental ? parseInt(waitingAccidental) : undefined,
      waitingPeriodSuicide: waitingSuicide ? parseInt(waitingSuicide) : undefined,
      gracePeriodDays: gracePeriodDays ? parseInt(gracePeriodDays) : undefined,
      eligibilityMinAge: eligibilityMinAge ? parseInt(eligibilityMinAge) : undefined,
      eligibilityMaxAge: eligibilityMaxAge ? parseInt(eligibilityMaxAge) : undefined,
      dependentMaxAge: dependentMaxAge ? parseInt(dependentMaxAge) : undefined,
      cashInLieuAdult: cashInLieuAdult || undefined,
      cashInLieuChild: cashInLieuChild || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Product Version</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label>Effective From *</Label>
            <Input type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} required data-testid="input-version-effective-from" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Premium Pricing</h3>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Monthly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyUsd} onChange={(e) => setPremiumMonthlyUsd(e.target.value)} placeholder="e.g. 15.00" data-testid="input-version-premium-usd" />
            </div>
            <div className="space-y-2">
              <Label>Monthly Premium (ZAR)</Label>
              <Input type="number" step="0.01" value={premiumMonthlyZar} onChange={(e) => setPremiumMonthlyZar(e.target.value)} placeholder="e.g. 250.00" data-testid="input-version-premium-zar" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumWeeklyUsd} onChange={(e) => setPremiumWeeklyUsd(e.target.value)} placeholder="e.g. 4.00" data-testid="input-version-premium-weekly" />
            </div>
            <div className="space-y-2">
              <Label>Bi-weekly Premium (USD)</Label>
              <Input type="number" step="0.01" value={premiumBiweeklyUsd} onChange={(e) => setPremiumBiweeklyUsd(e.target.value)} placeholder="e.g. 7.50" data-testid="input-version-premium-biweekly" />
            </div>
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Waiting & Grace Periods</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Natural Death (days)</Label>
              <Input type="number" value={waitingPeriodDays} onChange={(e) => setWaitingPeriodDays(e.target.value)} data-testid="input-version-waiting" />
            </div>
            <div className="space-y-2">
              <Label>Accidental Death (days)</Label>
              <Input type="number" value={waitingAccidental} onChange={(e) => setWaitingAccidental(e.target.value)} data-testid="input-version-waiting-accidental" />
            </div>
            <div className="space-y-2">
              <Label>Suicide (days)</Label>
              <Input type="number" value={waitingSuicide} onChange={(e) => setWaitingSuicide(e.target.value)} data-testid="input-version-waiting-suicide" />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Grace Period (days)</Label>
            <Input type="number" value={gracePeriodDays} onChange={(e) => setGracePeriodDays(e.target.value)} data-testid="input-version-grace" />
          </div>

          <Separator />
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Age Eligibility</h3>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Min Age (main member)</Label>
              <Input type="number" value={eligibilityMinAge} onChange={(e) => setEligibilityMinAge(e.target.value)} data-testid="input-version-min-age" />
            </div>
            <div className="space-y-2">
              <Label>Max Age (main member)</Label>
              <Input type="number" value={eligibilityMaxAge} onChange={(e) => setEligibilityMaxAge(e.target.value)} data-testid="input-version-max-age" />
            </div>
            <div className="space-y-2">
              <Label>Max Dependent Age</Label>
              <Input type="number" value={dependentMaxAge} onChange={(e) => setDependentMaxAge(e.target.value)} data-testid="input-version-dependent-max-age" />
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
  const [priceAmount, setPriceAmount] = useState("");

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Create Add-On</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, description: description || undefined, pricingMode, priceAmount: priceAmount || undefined }); }} className="space-y-4">
          <div className="space-y-2"><Label>Add-On Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Tombstone Cover" data-testid="input-addon-name" /></div>
          <div className="space-y-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="What does this add-on provide?" data-testid="input-addon-description" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Pricing Mode</Label>
              <Select value={pricingMode} onValueChange={setPricingMode}>
                <SelectTrigger data-testid="input-addon-pricing-mode"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="flat">Flat Rate (fixed monthly)</SelectItem>
                  <SelectItem value="percentage">Percentage of base premium</SelectItem>
                  <SelectItem value="per_member">Per Member</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{pricingMode === "percentage" ? "Percentage (%)" : "Monthly Premium ($)"}</Label>
              <Input type="number" step="0.01" value={priceAmount} onChange={(e) => setPriceAmount(e.target.value)} placeholder={pricingMode === "percentage" ? "e.g. 10" : "e.g. 5.00"} data-testid="input-addon-price" />
            </div>
          </div>
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
        <form onSubmit={(e) => { e.preventDefault(); onSubmit({ name, minAge: parseInt(minAge), maxAge: parseInt(maxAge), effectiveFrom: effectiveFrom || undefined }); }} className="space-y-4">
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
