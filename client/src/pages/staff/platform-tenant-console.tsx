import { useState, useEffect, type ChangeEvent } from "react";
import { useRoute, useLocation } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
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
  Loader2, Check, Eye, EyeOff, Settings as SettingsIcon, CreditCard, Flag, Globe,
  Database, HardDrive, Trash2, Star, ShieldAlert, PauseCircle, PlayCircle,
} from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getCsrfToken, getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { resolveAssetUrl, getDefaultLogoUrl } from "@/lib/assetUrl";

const SWATCHES = ["#0d9488","#D4AF37","#2563EB","#DC2626","#16A34A","#9333EA","#EA580C","#0891B2","#DB2777","#4F46E5","#CA8A04","#059669","#1E293B"];
const KNOWN_FLAGS = ["claims_enabled", "mobile_payments", "agent_portal", "whatsapp_notifications"];

interface TenantConfig {
  id: string;
  name: string;
  lifecycle: {
    slug: string | null; isActive: boolean; licenseStatus: string; provisioningState: string;
    suspendedAt: string | null; suspendReason: string | null;
  };
  branding: {
    logoUrl: string | null; signatureUrl: string | null; primaryColor: string | null;
    footerText: string | null; address: string | null; phone: string | null; email: string | null;
    website: string | null; policyNumberPrefix: string | null; policyNumberPadding: number | null;
    isWhitelabeled: boolean;
  };
  payments: {
    integrationId: string; authEmail: string; returnUrl: string; resultUrl: string;
    mode: "test" | "live"; hasKey: boolean;
  };
  featureFlags: { flag: string; enabled: boolean; setAt: string }[];
  domains: { id: string; domain: string; isPrimary: boolean; isVerified: boolean }[];
  database: { databaseUrl: string | null; hasDatabaseUrl: boolean; migrationState: string; schemaVersion: string | null; lastMigratedAt: string | null };
  storage: { prefix: string | null; bucket: string | null; region: string | null; endpoint: string | null; accessKeyId: string | null; hasSecretAccessKey: boolean };
}

export default function PlatformTenantConsole() {
  const [, params] = useRoute("/staff/platform/tenants/:id");
  const id = params?.id as string;
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const configKey = ["/api/platform/tenants", id, "config"];
  const { data: config, isLoading, isError } = useQuery<TenantConfig>({
    queryKey: configKey,
    enabled: !!id,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: configKey });
    queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
    queryClient.invalidateQueries({ queryKey: ["/api/public/branding"] });
  }

  if (!id) return null;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={config?.name || "Configure tenant"}
          description="Platform-owner configuration for this tenant."
          titleDataTestId="text-platform-tenant-title"
          actions={(
            <div className="flex items-center gap-2">
              {config && !config.lifecycle.isActive && (
                <Badge variant="destructive">Suspended</Badge>
              )}
              {config && config.lifecycle.isActive && config.lifecycle.licenseStatus !== "active" && (
                <Badge variant="outline" className="capitalize">{config.lifecycle.licenseStatus}</Badge>
              )}
              <Button variant="outline" onClick={() => setLocation("/staff")}>Back to dashboard</Button>
            </div>
          )}
        />

        {isLoading && (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
        )}
        {isError && (
          <EmptyState title="Failed to load tenant" description="Could not load configuration for this tenant." />
        )}

        {config && (
          <Tabs defaultValue="branding" className="w-full">
            <TabsList className="flex flex-wrap h-auto">
              <TabsTrigger value="branding">Branding</TabsTrigger>
              <TabsTrigger value="payments">Payments</TabsTrigger>
              <TabsTrigger value="flags">Feature Flags</TabsTrigger>
              <TabsTrigger value="domains">Domains</TabsTrigger>
              <TabsTrigger value="database">Database</TabsTrigger>
              <TabsTrigger value="storage">Storage</TabsTrigger>
              <TabsTrigger value="lifecycle">Lifecycle</TabsTrigger>
              <TabsTrigger value="danger">Danger Zone</TabsTrigger>
            </TabsList>

            <TabsContent value="branding" className="mt-6">
              <BrandingTab tenantId={id} branding={config.branding} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="payments" className="mt-6">
              <PaymentsTab tenantId={id} payments={config.payments} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="flags" className="mt-6">
              <FeatureFlagsTab tenantId={id} flags={config.featureFlags} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="domains" className="mt-6">
              <DomainsTab tenantId={id} domains={config.domains} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="database" className="mt-6">
              <DatabaseTab tenantId={id} tenantName={config.name} database={config.database} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="storage" className="mt-6">
              <StorageTab tenantId={id} storage={config.storage} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="lifecycle" className="mt-6">
              <LifecycleTab tenantId={id} lifecycle={config.lifecycle} onSaved={invalidate} />
            </TabsContent>
            <TabsContent value="danger" className="mt-6">
              <DangerZoneTab tenantId={id} tenantName={config.name} />
            </TabsContent>
          </Tabs>
        )}
      </PageShell>
    </StaffLayout>
  );
}

// ── Branding ───────────────────────────────────────────────────────
function BrandingTab({ tenantId, branding, onSaved }: { tenantId: string; branding: TenantConfig["branding"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [logoUrl, setLogoUrl] = useState(branding.logoUrl || "");
  const [signatureUrl, setSignatureUrl] = useState(branding.signatureUrl || "");
  const [primaryColor, setPrimaryColor] = useState(branding.primaryColor || "#0d9488");
  const [footerText, setFooterText] = useState(branding.footerText || "");
  const [address, setAddress] = useState(branding.address || "");
  const [phone, setPhone] = useState(branding.phone || "");
  const [email, setEmail] = useState(branding.email || "");
  const [website, setWebsite] = useState(branding.website || "");
  const [policyNumberPrefix, setPolicyNumberPrefix] = useState(branding.policyNumberPrefix || "");
  const [policyNumberPadding, setPolicyNumberPadding] = useState(branding.policyNumberPadding ?? 5);
  const [isWhitelabeled, setIsWhitelabeled] = useState(branding.isWhitelabeled);
  const [logoUploading, setLogoUploading] = useState(false);
  const [signatureUploading, setSignatureUploading] = useState(false);

  useEffect(() => {
    setLogoUrl(branding.logoUrl || "");
    setSignatureUrl(branding.signatureUrl || "");
    setPrimaryColor(branding.primaryColor || "#0d9488");
    setFooterText(branding.footerText || "");
    setAddress(branding.address || "");
    setPhone(branding.phone || "");
    setEmail(branding.email || "");
    setWebsite(branding.website || "");
    setPolicyNumberPrefix(branding.policyNumberPrefix || "");
    setPolicyNumberPadding(branding.policyNumberPadding ?? 5);
    setIsWhitelabeled(branding.isWhitelabeled);
  }, [branding]);

  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("PATCH", `/api/platform/tenants/${tenantId}/branding`, data);
      return res.json();
    },
    onSuccess: () => { onSaved(); toast({ title: "Branding saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  async function uploadAsset(kind: "logo" | "signature", file: File) {
    const setUploading = kind === "logo" ? setLogoUploading : setSignatureUploading;
    const setUrl = kind === "logo" ? setLogoUrl : setSignatureUrl;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const headers: Record<string, string> = {};
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + `/api/platform/tenants/${tenantId}/branding/upload-${kind}`, {
        method: "POST", headers, body: formData, credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Upload failed");
      setUrl(json.url);
      saveMutation.mutate(kind === "logo" ? { logoUrl: json.url } : { signatureUrl: json.url });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  }

  function handleSave() {
    saveMutation.mutate({
      logoUrl: logoUrl || null,
      signatureUrl: signatureUrl || null,
      primaryColor: primaryColor || null,
      footerText: footerText || null,
      address: address || null,
      phone: phone || null,
      email: email || null,
      website: website || null,
      policyNumberPrefix: policyNumberPrefix || null,
      policyNumberPadding: Math.max(1, Math.min(20, policyNumberPadding)),
      isWhitelabeled,
    });
  }

  return (
    <CardSection title="Organization branding" description="Logo, colors, and document formatting for this tenant." icon={SettingsIcon}>
      <div className="space-y-6">
        <div className="space-y-4">
          <Label>Organization Logo</Label>
          <div className="flex items-center gap-6">
            <div className="h-28 w-28 rounded-xl border-2 border-dashed flex items-center justify-center bg-white overflow-hidden shrink-0">
              {logoUploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : logoUrl ? (
                <img key={logoUrl} src={resolveAssetUrl(logoUrl)} alt="Logo" className="object-contain max-h-full max-w-full p-1"
                  onError={(e) => { (e.target as HTMLImageElement).src = getDefaultLogoUrl(); }} />
              ) : (
                <img src={getDefaultLogoUrl()} alt="Default" className="object-contain max-h-full max-w-full p-1 opacity-40" />
              )}
            </div>
            <div className="space-y-2">
              <input id="platform-logo-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadAsset("logo", f); }} />
              <Button type="button" variant="outline" disabled={logoUploading} onClick={() => document.getElementById("platform-logo-upload")?.click()}>
                {logoUploading ? "Uploading…" : "Upload Logo"}
              </Button>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <Label>Authorized Signature</Label>
          <div className="flex items-center gap-6">
            <div className="h-20 w-48 rounded-lg border-2 border-dashed flex items-center justify-center bg-muted/20 overflow-hidden shrink-0">
              {signatureUploading ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : signatureUrl ? (
                <img key={signatureUrl} src={resolveAssetUrl(signatureUrl)} alt="Signature" className="object-contain max-h-full max-w-full p-1"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              ) : (
                <span className="text-xs text-muted-foreground italic">No signature uploaded</span>
              )}
            </div>
            <div className="space-y-2">
              <input id="platform-sig-upload" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" className="hidden"
                onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) uploadAsset("signature", f); }} />
              <Button type="button" variant="outline" disabled={signatureUploading} onClick={() => document.getElementById("platform-sig-upload")?.click()}>
                {signatureUploading ? "Uploading…" : "Upload Signature"}
              </Button>
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="pt-address">Address</Label>
            <Input id="pt-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pt-phone">Phone</Label>
              <Input id="pt-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pt-email">Email</Label>
              <Input id="pt-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pt-website">Website</Label>
            <Input id="pt-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pt-primaryColor">Primary Color</Label>
            <div className="flex items-center gap-3">
              <input type="color" id="pt-primaryColor" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} className="h-10 w-10 rounded border cursor-pointer p-0.5" />
              <Input value={primaryColor} className="font-mono w-32" onChange={(e) => setPrimaryColor(e.target.value)} maxLength={7} />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {SWATCHES.map((c) => (
                <button key={c} type="button"
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${primaryColor === c ? "border-foreground ring-2 ring-offset-2 ring-primary" : "border-transparent"}`}
                  style={{ backgroundColor: c }} onClick={() => setPrimaryColor(c)} title={c} />
              ))}
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="pt-footerText">Footer Text (on documents)</Label>
            <Input id="pt-footerText" value={footerText} onChange={(e) => setFooterText(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="pt-prefix">Policy Number Prefix</Label>
              <Input id="pt-prefix" value={policyNumberPrefix} onChange={(e) => setPolicyNumberPrefix(e.target.value)} placeholder="e.g. POL-" />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="pt-padding">Policy Number Padding (digits)</Label>
              <Input id="pt-padding" type="number" min={1} max={20} value={policyNumberPadding}
                onChange={(e) => setPolicyNumberPadding(parseInt(e.target.value, 10) || 5)} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="font-medium">White-Label Mode</Label>
              <p className="text-xs text-muted-foreground">Show this tenant&apos;s name/logo instead of POL263.</p>
            </div>
            <Switch checked={isWhitelabeled} onCheckedChange={(v) => setIsWhitelabeled(v === true)} />
          </div>
        </div>

        <Button onClick={handleSave} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</> : "Save Branding"}
        </Button>
      </div>
    </CardSection>
  );
}

// ── Payments ───────────────────────────────────────────────────────
function PaymentsTab({ tenantId, payments, onSaved }: { tenantId: string; payments: TenantConfig["payments"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [integrationId, setIntegrationId] = useState(payments.integrationId || "");
  const [integrationKey, setIntegrationKey] = useState("");
  const [authEmail, setAuthEmail] = useState(payments.authEmail || "");
  const [returnUrl, setReturnUrl] = useState(payments.returnUrl || "");
  const [resultUrl, setResultUrl] = useState(payments.resultUrl || "");
  const [mode, setMode] = useState<"test" | "live">(payments.mode || "test");
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    setIntegrationId(payments.integrationId || "");
    setAuthEmail(payments.authEmail || "");
    setReturnUrl(payments.returnUrl || "");
    setResultUrl(payments.resultUrl || "");
    setMode(payments.mode || "test");
  }, [payments]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/platform/tenants/${tenantId}/payments`, {
        paynowIntegrationId: integrationId || null,
        paynowIntegrationKey: integrationKey || undefined,
        paynowAuthEmail: authEmail || null,
        paynowReturnUrl: returnUrl || null,
        paynowResultUrl: resultUrl || null,
        paynowMode: mode,
      });
      return res.json();
    },
    onSuccess: () => { setIntegrationKey(""); onSaved(); toast({ title: "PayNow config saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CardSection
      title="PayNow Integration"
      description="This tenant's PayNow merchant credentials. Overrides platform defaults."
      icon={CreditCard}
      headerRight={
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
          Save
        </Button>
      }
    >
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="ptp-id">Integration ID</Label>
            <Input id="ptp-id" value={integrationId} onChange={(e) => setIntegrationId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ptp-key">Integration Key</Label>
            <div className="relative">
              <Input id="ptp-key" type={showKey ? "text" : "password"} value={integrationKey}
                onChange={(e) => setIntegrationKey(e.target.value)}
                placeholder={payments.hasKey ? "Leave blank to keep existing key" : "Paste key — stored server-side only"}
                className="pr-10" />
              <button type="button" className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowKey((v) => !v)}>
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{payments.hasKey ? "A key is currently set." : "No key set yet."}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ptp-authEmail">Auth Email</Label>
            <Input id="ptp-authEmail" type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ptp-mode">Mode</Label>
            <select id="ptp-mode" value={mode} onChange={(e) => setMode(e.target.value as "test" | "live")}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
              <option value="test">Test</option>
              <option value="live">Live</option>
            </select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ptp-returnUrl">Return URL</Label>
          <Input id="ptp-returnUrl" value={returnUrl} onChange={(e) => setReturnUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ptp-resultUrl">Result URL</Label>
          <Input id="ptp-resultUrl" value={resultUrl} onChange={(e) => setResultUrl(e.target.value)}
            placeholder={`https://yourapp.com/api/payments/paynow/result?org=${tenantId}`} />
          <p className="text-xs text-muted-foreground">Include <code>?org={tenantId}</code> so we verify with this tenant's key.</p>
        </div>
      </div>
    </CardSection>
  );
}

// ── Feature Flags ──────────────────────────────────────────────────
function FeatureFlagsTab({ tenantId, flags, onSaved }: { tenantId: string; flags: TenantConfig["featureFlags"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [newFlag, setNewFlag] = useState("");

  const setMutation = useMutation({
    mutationFn: async ({ flag, enabled }: { flag: string; enabled: boolean }) => {
      await apiRequest("PUT", `/api/platform/tenants/${tenantId}/feature-flags/${flag}`, { enabled });
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (flag: string) => { await apiRequest("DELETE", `/api/platform/tenants/${tenantId}/feature-flags/${flag}`); },
    onSuccess: () => onSaved(),
  });

  const availableToAdd = KNOWN_FLAGS.filter((f) => !flags.some((existing) => existing.flag === f));

  return (
    <CardSection title="Feature Flags" description="Per-tenant feature overrides. Note: these are not yet wired to any feature — toggling has no runtime effect until a feature is built to consult them." icon={Flag}>
      <div className="p-6 space-y-4">
        {flags.length === 0 ? (
          <p className="text-sm text-muted-foreground">No overrides set for this tenant.</p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Flag</TableHead><TableHead>Enabled</TableHead><TableHead>Last set</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {flags.map((f) => (
                <TableRow key={f.flag}>
                  <TableCell className="font-mono text-sm">{f.flag}</TableCell>
                  <TableCell>
                    <Switch checked={f.enabled} onCheckedChange={(v) => setMutation.mutate({ flag: f.flag, enabled: v === true })} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{f.setAt ? new Date(f.setAt).toLocaleString() : "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(f.flag)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
        {availableToAdd.length > 0 && (
          <div className="flex items-center gap-2 pt-2 border-t">
            <select value={newFlag} onChange={(e) => setNewFlag(e.target.value)}
              className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm">
              <option value="">Add flag…</option>
              {availableToAdd.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <Button size="sm" disabled={!newFlag} onClick={() => { setMutation.mutate({ flag: newFlag, enabled: true }); setNewFlag(""); }}>
              Add
            </Button>
          </div>
        )}
      </div>
    </CardSection>
  );
}

// ── Domains ────────────────────────────────────────────────────────
function DomainsTab({ tenantId, domains, onSaved }: { tenantId: string; domains: TenantConfig["domains"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [newDomain, setNewDomain] = useState("");

  const addMutation = useMutation({
    mutationFn: async () => { await apiRequest("POST", `/api/platform/tenants/${tenantId}/domains`, { domain: newDomain.trim().toLowerCase() }); },
    onSuccess: () => { setNewDomain(""); onSaved(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: async (domainId: string) => { await apiRequest("PATCH", `/api/platform/tenants/${tenantId}/domains/${domainId}`, { isPrimary: true }); },
    onSuccess: () => onSaved(),
  });

  const removeMutation = useMutation({
    mutationFn: async (domainId: string) => { await apiRequest("DELETE", `/api/platform/tenants/${tenantId}/domains/${domainId}`); },
    onSuccess: () => onSaved(),
  });

  return (
    <CardSection title="Domain Routing" description="Subdomains/custom domains that resolve to this tenant." icon={Globe}>
      <div className="p-6 space-y-4">
        {domains.length === 0 ? (
          <p className="text-sm text-muted-foreground">No domains configured.</p>
        ) : (
          <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Domain</TableHead><TableHead>Status</TableHead><TableHead /></TableRow>
            </TableHeader>
            <TableBody>
              {domains.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-sm">{d.domain}</TableCell>
                  <TableCell className="flex gap-1.5">
                    {d.isPrimary && <Badge variant="default"><Star className="h-3 w-3 mr-1" />Primary</Badge>}
                    {d.isVerified ? <Badge variant="outline">Verified</Badge> : <Badge variant="outline" className="text-muted-foreground">Unverified</Badge>}
                  </TableCell>
                  <TableCell className="flex gap-1 justify-end">
                    {!d.isPrimary && (
                      <Button size="sm" variant="ghost" onClick={() => setPrimaryMutation.mutate(d.id)}>Set primary</Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => removeMutation.mutate(d.id)}><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          </div>
        )}
        <div className="flex items-center gap-2 pt-2 border-t">
          <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="acme.pol263.app" className="max-w-xs" />
          <Button size="sm" disabled={!newDomain.trim() || addMutation.isPending} onClick={() => addMutation.mutate()}>Add domain</Button>
        </div>
      </div>
    </CardSection>
  );
}

// ── Database Routing ──────────────────────────────────────────────
function DatabaseTab({ tenantId, tenantName, database, onSaved }: { tenantId: string; tenantName: string; database: TenantConfig["database"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [databaseUrl, setDatabaseUrl] = useState("");
  const [databaseDirectUrl, setDatabaseDirectUrl] = useState("");
  const [confirmText, setConfirmText] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/platform/tenants/${tenantId}/database`, { databaseUrl: databaseUrl || null, databaseDirectUrl: databaseDirectUrl || null });
    },
    onSuccess: () => { setConfirmText(""); onSaved(); toast({ title: "Database routing updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const confirmed = confirmText.trim().toLowerCase() === tenantName.trim().toLowerCase();

  return (
    <CardSection title="Database Routing" description="Repoints this tenant's entire data plane. Handle with care." icon={Database}>
      <div className="p-6 space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 flex gap-2">
          <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          <span>Currently {database.hasDatabaseUrl ? "routed to a dedicated database" : "using the shared platform database"}. Migration state: <strong>{database.migrationState}</strong>.</span>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ptd-url">Database URL (pooler)</Label>
          <Input id="ptd-url" type="password" autoComplete="off" value={databaseUrl} onChange={(e) => setDatabaseUrl(e.target.value)}
            placeholder={database.hasDatabaseUrl ? "•••••••••••• (leave blank to keep)" : "postgresql://... (leave empty for shared database)"} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ptd-direct">Database Direct URL (migrations, optional)</Label>
          <Input id="ptd-direct" type="password" autoComplete="off" value={databaseDirectUrl} onChange={(e) => setDatabaseDirectUrl(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ptd-confirm">Type the tenant name (<span className="font-mono">{tenantName}</span>) to confirm</Label>
          <Input id="ptd-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
        </div>
        <Button variant="destructive" disabled={!confirmed || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Update database routing
        </Button>
      </div>
    </CardSection>
  );
}

// ── Storage Routing ────────────────────────────────────────────────
function StorageTab({ tenantId, storage, onSaved }: { tenantId: string; storage: TenantConfig["storage"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [prefix, setPrefix] = useState(storage.prefix || "");
  const [bucket, setBucket] = useState(storage.bucket || "");
  const [region, setRegion] = useState(storage.region || "");
  const [endpoint, setEndpoint] = useState(storage.endpoint || "");
  const [accessKeyId, setAccessKeyId] = useState(storage.accessKeyId || "");
  const [secretAccessKey, setSecretAccessKey] = useState("");

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PUT", `/api/platform/tenants/${tenantId}/storage`, {
        prefix: prefix || undefined, bucket: bucket || null, region: region || null,
        endpoint: endpoint || null, accessKeyId: accessKeyId || null,
        secretAccessKey: secretAccessKey || undefined,
      });
    },
    onSuccess: () => { setSecretAccessKey(""); onSaved(); toast({ title: "Storage routing saved" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CardSection title="Storage Routing" description="Object storage bucket/credentials for this tenant." icon={HardDrive}>
      <div className="p-6 space-y-4">
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Not wired up yet — the app currently uploads every tenant's files to the shared platform
          bucket regardless of what's saved here. Values are stored for when per-tenant storage is
          needed later; they have no effect today.
        </div>
        <div className="space-y-2">
          <Label htmlFor="pts-prefix">Path prefix</Label>
          <Input id="pts-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pts-bucket">Bucket (optional)</Label>
            <Input id="pts-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} placeholder="Shared bucket if empty" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pts-region">Region (optional)</Label>
            <Input id="pts-region" value={region} onChange={(e) => setRegion(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pts-endpoint">Endpoint (optional)</Label>
          <Input id="pts-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="pts-accessKeyId">Access Key ID (optional)</Label>
            <Input id="pts-accessKeyId" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pts-secret">Secret Access Key (optional)</Label>
            <Input id="pts-secret" type="password" autoComplete="off" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder={storage.hasSecretAccessKey ? "Leave blank to keep existing" : "Stored encrypted, server-side only"} />
          </div>
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Save Storage Routing
        </Button>
      </div>
    </CardSection>
  );
}

// ── Lifecycle ──────────────────────────────────────────────────────
const LICENSE_STATUSES = ["trial", "active", "suspended", "expired"] as const;

function LifecycleTab({ tenantId, lifecycle, onSaved }: { tenantId: string; lifecycle: TenantConfig["lifecycle"]; onSaved: () => void }) {
  const { toast } = useToast();
  const [suspendReason, setSuspendReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [licenseStatus, setLicenseStatus] = useState(lifecycle.licenseStatus);

  useEffect(() => { setLicenseStatus(lifecycle.licenseStatus); }, [lifecycle.licenseStatus]);

  const lifecycleMutation = useMutation({
    mutationFn: async (body: { action: string; reason?: string; licenseStatus?: string }) => {
      await apiRequest("PUT", `/api/platform/tenants/${tenantId}/lifecycle`, body);
    },
    onSuccess: () => { onSaved(); toast({ title: "Tenant status updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CardSection title="Tenant Lifecycle" description="Access status and license state for this tenant." icon={ShieldAlert}>
      <div className="p-6 space-y-6">
        <div className="rounded-md border p-4 space-y-1 text-sm">
          <p><span className="text-muted-foreground">Slug:</span> <span className="font-mono">{lifecycle.slug ?? "—"}</span></p>
          <p><span className="text-muted-foreground">Access:</span> {lifecycle.isActive ? "Active" : "Suspended"}</p>
          <p><span className="text-muted-foreground">Provisioning:</span> <span className="capitalize">{lifecycle.provisioningState}</span></p>
          {lifecycle.suspendedAt && (
            <p><span className="text-muted-foreground">Suspended at:</span> {new Date(lifecycle.suspendedAt).toLocaleString()}</p>
          )}
          {lifecycle.suspendReason && (
            <p><span className="text-muted-foreground">Reason:</span> {lifecycle.suspendReason}</p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="pt-license">License status</Label>
          <div className="flex items-center gap-2">
            <select id="pt-license" value={licenseStatus} onChange={(e) => setLicenseStatus(e.target.value)}
              className="flex h-10 rounded-md border border-input bg-background px-3 py-2 text-sm capitalize">
              {LICENSE_STATUSES.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
            </select>
            <Button
              variant="outline"
              disabled={licenseStatus === lifecycle.licenseStatus || lifecycleMutation.isPending}
              onClick={() => lifecycleMutation.mutate({ action: "setLicenseStatus", licenseStatus })}
            >
              Save
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Billing/trial state — a record, not an access gate.</p>
        </div>

        {lifecycle.isActive ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
            <div>
              <p className="font-medium text-amber-900">Suspend this tenant</p>
              <p className="text-xs text-amber-800">
                Blocks staff sign-in for this tenant (takes effect on each user's next request, typically
                within a few seconds). Does not yet block the client/policyholder portal — that's a separate
                login system not covered by this yet. Reversible.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="pt-suspend-reason">Reason (shown in tenant status)</Label>
              <Input id="pt-suspend-reason" value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)} placeholder="e.g. Overdue invoice" />
            </div>
            <Button variant="destructive" onClick={() => setConfirmOpen(true)}>
              <PauseCircle className="h-4 w-4 mr-2" /> Suspend tenant
            </Button>
          </div>
        ) : (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
            <div>
              <p className="font-medium text-emerald-900">Reactivate this tenant</p>
              <p className="text-xs text-emerald-800">Restores staff sign-in and clears the suspension reason.</p>
            </div>
            <Button
              onClick={() => lifecycleMutation.mutate({ action: "reactivate" })}
              disabled={lifecycleMutation.isPending}
            >
              {lifecycleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PlayCircle className="h-4 w-4 mr-2" />}
              Reactivate tenant
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Suspend this tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              All staff users at this tenant will be signed out on their next request and unable to log
              back in until reactivated. The client/policyholder portal is not affected. You can reactivate
              at any time from this page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { lifecycleMutation.mutate({ action: "suspend", reason: suspendReason || undefined }); setConfirmOpen(false); }}
              disabled={lifecycleMutation.isPending}
            >
              {lifecycleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Suspend
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardSection>
  );
}

// ── Danger Zone ────────────────────────────────────────────────────
function DangerZoneTab({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: async () => { await apiRequest("DELETE", `/api/organizations/${tenantId}`); },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/platform/dashboard"] });
      toast({ title: "Tenant removed" });
      setLocation("/staff");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CardSection title="Danger Zone" description="Irreversible actions." icon={ShieldAlert}>
      <div className="p-6 space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4">
          <div>
            <p className="font-medium">Delete tenant</p>
            <p className="text-xs text-muted-foreground">Soft-deletes {tenantName}. The tenant must have no active users.</p>
          </div>
          <Button variant="destructive" onClick={() => setConfirmOpen(true)}>Delete tenant</Button>
        </div>
      </div>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tenant?</AlertDialogTitle>
            <AlertDialogDescription>
              This will soft-delete <strong>{tenantName}</strong>. The tenant must have no active users. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}>
              {deleteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CardSection>
  );
}
