import { useEffect, useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PolicySearchInput } from "@/components/policy-search-input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { Loader2, CreditCard, Eye, Download, QrCode } from "lucide-react";

interface MemberCardSettings {
  cardTitle: string;
  showLogo: boolean;
  showPhotoBox: boolean;
  showPolicyNumber: boolean;
  showMemberSince: boolean;
  showValidUntil: boolean;
  showQrCode: boolean;
  footerNote: string | null;
}

interface OrgBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
}

export default function MemberCardAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<MemberCardSettings>({
    cardTitle: "Membership Card",
    showLogo: true,
    showPhotoBox: true,
    showPolicyNumber: true,
    showMemberSince: true,
    showValidUntil: true,
    showQrCode: true,
    footerNote: "",
  });
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState<{ policyNumber: string } | null>(null);

  const { data: settings, isLoading } = useQuery<MemberCardSettings>({ queryKey: ["/api/member-card-settings"] });
  const { data: org } = useQuery<OrgBranding>({
    queryKey: ["/api/organizations", user?.organizationId],
    enabled: !!user?.organizationId,
  });

  useEffect(() => {
    if (settings) setForm({ ...settings, footerNote: settings.footerNote ?? "" });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/member-card-settings", { ...form, footerNote: form.footerNote?.trim() || null });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/member-card-settings"] });
      toast({ title: "Template saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const set = <K extends keyof MemberCardSettings>(key: K, value: MemberCardSettings[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const primaryColor = org?.primaryColor || "#0d9488";

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Member Card Admin" description="Configure the membership card template and issue cards for individual policies." />

        {isLoading ? (
          <div className="py-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            <CardSection title="Template" icon={CreditCard}>
              <div className="space-y-4 max-w-md">
                <div>
                  <Label>Card title</Label>
                  <Input value={form.cardTitle} onChange={(e) => set("cardTitle", e.target.value)} placeholder="Membership Card" />
                </div>

                {([
                  ["showLogo", "Show organization logo"],
                  ["showPhotoBox", "Show photo box"],
                  ["showPolicyNumber", "Show policy number"],
                  ["showMemberSince", "Show member since date"],
                  ["showValidUntil", "Show valid-until / status"],
                  ["showQrCode", "Show verification QR code"],
                ] as [keyof MemberCardSettings, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="font-normal">{label}</Label>
                    <Switch checked={!!form[key]} onCheckedChange={(v) => set(key, v as any)} />
                  </div>
                ))}

                <div>
                  <Label>Footer note (optional)</Label>
                  <Textarea
                    value={form.footerNote ?? ""}
                    onChange={(e) => set("footerNote", e.target.value)}
                    placeholder="e.g. This card remains the property of..."
                    rows={2}
                  />
                </div>

                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save template
                </Button>
              </div>
            </CardSection>

            <CardSection title="Preview" icon={Eye}>
              <div className="rounded-xl border overflow-hidden shadow-sm max-w-md">
                <div className="flex items-center justify-between px-4 py-3 text-white" style={{ backgroundColor: primaryColor }}>
                  <div className="flex items-center gap-2">
                    {form.showLogo && org?.logoUrl && (
                      <img src={org.logoUrl} alt="" className="h-8 max-w-[70px] object-contain" />
                    )}
                    <span className="font-semibold text-sm">{org?.name || "Your Organization"}</span>
                  </div>
                </div>
                <div className="px-4 py-1.5 bg-black/5 text-[11px] font-medium uppercase tracking-wide" style={{ color: primaryColor }}>
                  {form.cardTitle || "Membership Card"}
                </div>
                <div className="p-4 flex gap-4">
                  {form.showPhotoBox && (
                    <div className="h-20 w-16 border rounded flex items-center justify-center text-[10px] text-muted-foreground shrink-0">
                      PHOTO
                    </div>
                  )}
                  <div className="flex-1 space-y-1.5 text-sm">
                    <div>
                      <p className="text-[10px] uppercase text-muted-foreground">Member Name</p>
                      <p className="font-semibold">Jane Sample Doe</p>
                    </div>
                    {form.showPolicyNumber && (
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground">Policy Number</p>
                        <p className="font-mono">POL-00123</p>
                      </div>
                    )}
                    {form.showMemberSince && (
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground">Member Since</p>
                        <p>01 Jan 2024</p>
                      </div>
                    )}
                    {form.showValidUntil && (
                      <div>
                        <p className="text-[10px] uppercase text-muted-foreground">Valid Until</p>
                        <p>31 Aug 2026</p>
                      </div>
                    )}
                  </div>
                  {form.showQrCode && (
                    <div className="h-16 w-16 border rounded flex items-center justify-center shrink-0 self-end">
                      <QrCode className="h-8 w-8 text-muted-foreground" />
                    </div>
                  )}
                </div>
                {form.footerNote && (
                  <div className="px-4 pb-3 text-[10px] text-muted-foreground text-center">{form.footerNote}</div>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3 max-w-md">
                This is an approximate on-screen preview. The printed card (see "Issue a Card" below) uses the same fields with a print-ready layout.
              </p>
            </CardSection>

            <CardSection title="Issue a Card" icon={CreditCard} className="lg:col-span-2">
              <div className="max-w-md space-y-3">
                <Label>Find a policy</Label>
                <PolicySearchInput
                  value={selectedPolicyId}
                  onChange={(id, policy) => { setSelectedPolicyId(id); setSelectedPolicy(policy); }}
                  data-testid="input-member-card-policy-search"
                />
                {selectedPolicyId && (
                  <div className="flex items-center gap-2 pt-1">
                    <Button variant="outline" size="sm" className="gap-1.5"
                      onClick={() => window.open(getApiBase() + `/api/policies/${selectedPolicyId}/member-card/view`, "_blank", "noopener")}>
                      <Eye className="h-3.5 w-3.5" /> View card{selectedPolicy ? ` — ${selectedPolicy.policyNumber}` : ""}
                    </Button>
                    <Button variant="outline" size="sm" className="gap-1.5"
                      onClick={() => window.open(getApiBase() + `/api/policies/${selectedPolicyId}/member-card/download`, "_blank", "noopener")}>
                      <Download className="h-3.5 w-3.5" /> Download
                    </Button>
                  </div>
                )}
              </div>
            </CardSection>
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}
