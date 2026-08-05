import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Printer, Loader2, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const STATUSES = ["active", "grace", "lapsed", "inactive", "cancelled"];

export default function PrintPolicyCards() {
  const { toast } = useToast();
  const [branchId, setBranchId] = useState("");
  const [productId, setProductId] = useState("");
  const [status, setStatus] = useState("active");
  const [search, setSearch] = useState("");
  const [downloading, setDownloading] = useState(false);

  const { data: branches = [] } = useQuery<any[]>({
    queryKey: ["/api/branches"],
    queryFn: async () => { const r = await fetch("/api/branches", { credentials: "include" }); return r.ok ? r.json() : []; },
  });
  const { data: products = [] } = useQuery<any[]>({
    queryKey: ["/api/products"],
    queryFn: async () => { const r = await fetch("/api/products", { credentials: "include" }); return r.ok ? r.json() : []; },
  });

  const buildUrl = () => {
    const params = new URLSearchParams();
    if (branchId) params.set("branchId", branchId);
    if (productId) params.set("productId", productId);
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    return getApiBase() + `/api/policies/member-cards/batch-download?${params.toString()}`;
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(buildUrl(), { credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || "No policies matched the selected filters");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Member-Cards-Batch.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Could not generate cards", description: err.message, variant: "destructive" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Print Policy Cards"
          description="Batch-print membership / policy cards for a filtered set of policies — one card per page in a single PDF, print and cut."
        />

        <CardSection title="Filters" icon={Search}>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="grid gap-2">
              <Label htmlFor="ppc-branch">Branch</Label>
              <Select value={branchId || "all"} onValueChange={(v) => setBranchId(v === "all" ? "" : v)}>
                <SelectTrigger id="ppc-branch"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All branches</SelectItem>
                  {branches.map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ppc-product">Product</Label>
              <Select value={productId || "all"} onValueChange={(v) => setProductId(v === "all" ? "" : v)}>
                <SelectTrigger id="ppc-product"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All products</SelectItem>
                  {products.map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ppc-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="ppc-status"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ppc-search">Search (name / policy #)</Label>
              <Input id="ppc-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Optional" />
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Generates up to 150 cards per batch. Narrow the filters if you need a specific subset.</p>
            <Button onClick={handleDownload} disabled={downloading} className="gap-1.5" data-testid="btn-print-batch">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Generate Cards PDF
            </Button>
          </div>
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
