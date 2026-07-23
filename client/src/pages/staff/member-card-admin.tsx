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
import { Loader2, CreditCard, Eye, Download, QrCode, User, IdCard, Calendar, Users, Hash, ShieldCheck, Phone, Globe } from "lucide-react";

interface MemberCardSettings {
  cardTitle: string;
  showLogo: boolean;
  showPolicyNumber: boolean;
  showSurname: boolean;
  showIdNumber: boolean;
  showDateOfBirth: boolean;
  showPlan: boolean;
  showQrCode: boolean;
  tagline: string | null;
  footerNote: string | null;
  footerSlogan: string | null;
}

interface OrgBranding {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  phone: string | null;
  website: string | null;
}

const GOLD = "#c9a962";
const CREAM = "#fbf9f4";

/** Diagonal navy panel boundary (top-right corner), as % of the card's content area
 *  (i.e. excluding the footer bar) — mirrors the SWOOSH points in server/member-card-pdf.ts. */
const GOLD_CLIP = "polygon(71% 0%, 57% 21%, 61.5% 39%, 100% 39%, 100% 0%)";
const NAVY_CLIP = "polygon(70% 0%, 58% 20%, 62% 38%, 100% 38%, 100% 0%)";

export default function MemberCardAdmin() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [form, setForm] = useState<MemberCardSettings>({
    cardTitle: "Membership Card",
    showLogo: true,
    showPolicyNumber: true,
    showSurname: true,
    showIdNumber: true,
    showDateOfBirth: true,
    showPlan: true,
    showQrCode: true,
    tagline: "",
    footerNote: "",
    footerSlogan: "",
  });
  const [selectedPolicyId, setSelectedPolicyId] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState<{ policyNumber: string } | null>(null);

  const { data: settings, isLoading } = useQuery<MemberCardSettings>({ queryKey: ["/api/member-card-settings"] });
  const { data: org } = useQuery<OrgBranding>({
    queryKey: ["/api/organizations", user?.organizationId],
    enabled: !!user?.organizationId,
  });

  useEffect(() => {
    if (settings) setForm({
      ...settings,
      tagline: settings.tagline ?? "",
      footerNote: settings.footerNote ?? "",
      footerSlogan: settings.footerSlogan ?? "",
    });
  }, [settings]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/member-card-settings", {
        ...form,
        tagline: form.tagline?.trim() || null,
        footerNote: form.footerNote?.trim() || null,
        footerSlogan: form.footerSlogan?.trim() || null,
      });
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
                  <Label htmlFor="form-card-title">Card title</Label>
                  <Input id="form-card-title" value={form.cardTitle} onChange={(e) => set("cardTitle", e.target.value)} placeholder="Membership Card" />
                </div>

                {([
                  ["showLogo", "Show organization logo"],
                  ["showPolicyNumber", "Show policy number"],
                  ["showSurname", "Show surname"],
                  ["showIdNumber", "Show ID number"],
                  ["showDateOfBirth", "Show date of birth"],
                  ["showPlan", "Show plan"],
                  ["showQrCode", "Show verification QR code"],
                ] as [keyof MemberCardSettings, string][]).map(([key, label]) => (
                  <div key={key} className="flex items-center justify-between">
                    <Label className="font-normal">{label}</Label>
                    <Switch checked={!!form[key]} onCheckedChange={(v) => set(key, v as any)} />
                  </div>
                ))}

                <div>
                  <Label>Tagline (optional)</Label>
                  <Input
                    value={form.tagline ?? ""}
                    onChange={(e) => set("tagline", e.target.value)}
                    placeholder="e.g. For a Service Beyond Ubuntu"
                  />
                </div>

                <div>
                  <Label>Footer note (optional)</Label>
                  <Textarea
                    value={form.footerNote ?? ""}
                    onChange={(e) => set("footerNote", e.target.value)}
                    placeholder="e.g. You are not just a client, you are family."
                    rows={2}
                  />
                </div>

                <div>
                  <Label htmlFor="footer-slogan-optional">Footer slogan (optional)</Label>
                  <Input id="footer-slogan-optional"
                    value={form.footerSlogan ?? ""}
                    onChange={(e) => set("footerSlogan", e.target.value)}
                    placeholder="e.g. With Dignity. With Care. With Ubuntu."
                  />
                </div>

                <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
                  {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Save template
                </Button>
              </div>
            </CardSection>

            <CardSection title="Preview" icon={Eye}>
              <div
                className="rounded-xl border overflow-hidden shadow-sm max-w-md w-full flex flex-col"
                style={{ aspectRatio: "480 / 300", background: CREAM }}
              >
                <div className="relative flex-1 min-h-0">
                  <div className="absolute inset-0" style={{ clipPath: GOLD_CLIP, background: GOLD }} />
                  <div className="absolute inset-0" style={{ clipPath: NAVY_CLIP, background: primaryColor }} />

                  {/* Logo */}
                  <div
                    className="absolute rounded-full border-2 flex items-center justify-center overflow-hidden bg-white"
                    style={{ left: "4%", top: "6%", width: "14%", aspectRatio: "1 / 1", borderColor: primaryColor }}
                  >
                    {form.showLogo && org?.logoUrl && <img src={org.logoUrl} alt="" className="h-full w-full object-contain" />}
                  </div>

                  {/* Org name */}
                  <div className="absolute" style={{ left: "22%", top: "5%", width: "40%" }}>
                    <p className="font-extrabold leading-none uppercase" style={{ color: primaryColor, fontSize: "clamp(10px, 3.6vw, 20px)" }}>
                      {(org?.name || "Membership").split(" ")[0]}
                    </p>
                    {(org?.name || "").split(" ").slice(1).length > 0 && (
                      <p className="font-bold leading-tight uppercase mt-0.5" style={{ color: "#2f6fb0", fontSize: "clamp(7px, 2vw, 11px)" }}>
                        {(org?.name || "").split(" ").slice(1).join(" ")}
                      </p>
                    )}
                    <div className="mt-1 mb-0.5 h-[1.5px]" style={{ background: GOLD, width: "70%" }} />
                    {form.tagline && (
                      <p className="uppercase font-bold tracking-wide" style={{ color: GOLD, fontSize: "clamp(6px, 1.5vw, 8px)" }}>
                        {form.tagline}
                      </p>
                    )}
                  </div>

                  {/* Membership card pill */}
                  <div
                    className="absolute rounded-md flex items-center justify-center text-center font-bold text-white uppercase px-2"
                    style={{ right: "4%", top: "5%", width: "26%", height: "12%", background: primaryColor, filter: "brightness(0.85)", fontSize: "clamp(6px, 1.8vw, 9px)" }}
                  >
                    {form.cardTitle || "Membership Card"}
                  </div>

                  {/* Field rows */}
                  <div className="absolute space-y-1" style={{ left: "4%", top: "37%", width: form.showQrCode ? "58%" : "92%" }}>
                    {[
                      { Icon: User, label: "Policy Holder Name", value: "Jane" },
                      form.showSurname && { Icon: User, label: "Surname", value: "Sample" },
                      form.showIdNumber && { Icon: IdCard, label: "ID Number", value: "00-000000-X-00" },
                      form.showDateOfBirth && { Icon: Calendar, label: "Date of Birth", value: "01 Jan 1988" },
                      form.showPlan && { Icon: Users, label: "Plan", value: "Standard Gold" },
                      form.showPolicyNumber && { Icon: Hash, label: "Policy Number", value: "POL-00123" },
                    ].filter(Boolean).map((row: any, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <span className="rounded-full flex items-center justify-center shrink-0 text-white" style={{ background: primaryColor, width: "16px", height: "16px" }}>
                          <row.Icon style={{ width: "9px", height: "9px" }} />
                        </span>
                        <span className="uppercase text-muted-foreground truncate" style={{ fontSize: "clamp(5.5px, 1.4vw, 7.5px)" }}>{row.label}</span>
                        <span className="font-bold truncate" style={{ fontSize: "clamp(5.5px, 1.4vw, 7.5px)" }}>: {row.value}</span>
                      </div>
                    ))}
                  </div>

                  {/* QR box */}
                  {form.showQrCode && (
                    <div className="absolute flex flex-col items-center" style={{ right: "6%", top: "37%", width: "18%" }}>
                      <div className="border-2 rounded flex items-center justify-center w-full aspect-square bg-white" style={{ borderColor: primaryColor }}>
                        <QrCode className="w-3/4 h-3/4 text-muted-foreground" />
                      </div>
                      <p className="font-bold text-center leading-tight mt-1" style={{ color: primaryColor, fontSize: "clamp(5px, 1.3vw, 7px)" }}>SCAN TO VERIFY</p>
                      <p className="font-bold text-center leading-tight" style={{ color: GOLD, fontSize: "clamp(5px, 1.3vw, 7px)" }}>MEMBERSHIP</p>
                    </div>
                  )}
                </div>

                {/* Footer bar */}
                <div
                  className="flex items-center justify-between px-3 gap-2 text-white"
                  style={{ flex: "0 0 14.7%", background: primaryColor, filter: "brightness(0.85)", borderTop: `2px solid ${GOLD}` }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <ShieldCheck className="shrink-0" style={{ width: "14px", height: "14px" }} />
                    {form.footerNote && (
                      <span className="font-bold uppercase leading-tight truncate" style={{ fontSize: "clamp(5.5px, 1.4vw, 7.5px)" }}>{form.footerNote}</span>
                    )}
                  </div>
                  <div className="hidden sm:flex items-center gap-2 shrink-0" style={{ fontSize: "clamp(5.5px, 1.4vw, 7px)" }}>
                    {org?.phone && (
                      <span className="flex items-center gap-1"><Phone style={{ width: "9px", height: "9px" }} />{org.phone}</span>
                    )}
                    {org?.website && (
                      <span className="flex items-center gap-1"><Globe style={{ width: "9px", height: "9px" }} />{org.website}</span>
                    )}
                  </div>
                  {form.footerSlogan && (
                    <span className="italic font-semibold text-right truncate" style={{ color: GOLD, fontSize: "clamp(5.5px, 1.4vw, 7.5px)" }}>{form.footerSlogan}</span>
                  )}
                </div>
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
