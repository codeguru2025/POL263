import { useState, useEffect } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Eye, MessageSquareText, Users, ExternalLink, Copy, Check, Share2 } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";

interface VCardStats {
  pageViews: number;
  quoteRequests: number;
}

interface VCardLead {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  stage: string;
  createdAt: string;
  quoteId: string | null;
}

export default function StaffMyVCard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: stats, isLoading: statsLoading } = useQuery<VCardStats>({
    queryKey: ["/api/my-vcard/stats"],
    queryFn: async () => (await apiRequest("GET", "/api/my-vcard/stats")).json(),
  });
  const { data: leads, isLoading: leadsLoading } = useQuery<VCardLead[]>({
    queryKey: ["/api/my-vcard/leads"],
    queryFn: async () => (await apiRequest("GET", "/api/my-vcard/leads")).json(),
  });

  const [phone, setPhone] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [facebookUrl, setFacebookUrl] = useState("");
  const [instagramUrl, setInstagramUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [bio, setBio] = useState("");

  useEffect(() => {
    if (!user) return;
    setPhone(user.phone || "");
    setWhatsapp(user.whatsapp || "");
    setFacebookUrl(user.facebookUrl || "");
    setInstagramUrl(user.instagramUrl || "");
    setWebsiteUrl(user.websiteUrl || "");
    setBio(user.bio || "");
  }, [user]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/auth/me", { phone, whatsapp, facebookUrl, instagramUrl, websiteUrl, bio });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "vCard updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
    onError: () => toast({ title: "Failed to update", variant: "destructive" }),
  });

  const referralCode = user?.referralCode;
  const cardUrl = referralCode ? `${window.location.origin}/card/${referralCode}` : "";

  const [linkCopied, setLinkCopied] = useState(false);
  const copyLink = async () => {
    await navigator.clipboard.writeText(cardUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
    toast({ title: "Link copied" });
  };
  const shareLink = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: "My vCard", url: cardUrl });
        return;
      } catch {
        // Cancelled the native share sheet, or the browser doesn't really support it — fall
        // through to the clipboard copy either way.
      }
    }
    copyLink();
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="My vCard"
          description="Usage analytics for your public vCard page, and the contact details you control on it."
          actions={
            referralCode ? (
              <Button variant="outline" size="sm" asChild className="gap-2">
                <a href={`/card/${referralCode}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-4 w-4" /> View my vCard
                </a>
              </Button>
            ) : undefined
          }
        />

        {referralCode && (
          <CardSection title="Share your vCard" description="Give this link or QR code to a prospect — they land on your public vCard page and can save your contact or request a quote." icon={Share2}>
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-1 space-y-3 max-w-lg">
                <div className="flex items-center gap-2">
                  <Input readOnly value={cardUrl} className="font-mono text-xs" data-testid="input-vcard-link" />
                  <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={copyLink} aria-label="Copy link" data-testid="button-copy-vcard-link">
                    {linkCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                <Button type="button" variant="outline" size="sm" className="gap-2" onClick={shareLink} data-testid="button-share-vcard-link">
                  <Share2 className="h-4 w-4" /> Share
                </Button>
                <p className="text-xs text-muted-foreground">Or have them scan the QR code — it opens the same page.</p>
              </div>
              <div className="shrink-0 rounded-lg border p-3 bg-white w-fit">
                <img src={getApiBase() + "/api/my-vcard/qr"} alt="QR code to your vCard" className="h-32 w-32" data-testid="img-vcard-qr" />
              </div>
            </div>
          </CardSection>
        )}

        <CardSection title="Usage" description="Distinct from your client list — this is how your public vCard page itself is performing." icon={Eye}>
          {statsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-md">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><Eye className="h-3.5 w-3.5" /> Page views</div>
                <p className="text-2xl font-bold tabular-nums">{stats?.pageViews ?? 0}</p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1"><MessageSquareText className="h-3.5 w-3.5" /> Quotes requested</div>
                <p className="text-2xl font-bold tabular-nums">{stats?.quoteRequests ?? 0}</p>
              </div>
            </div>
          )}
        </CardSection>

        <CardSection title="Leads from your vCard" description="People who requested a quote through your vCard page." icon={Users}>
          {leadsLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : !leads?.length ? (
            <p className="text-sm text-muted-foreground">No quote requests yet.</p>
          ) : (
            <div className="space-y-2">
              {leads.map((l) => (
                <div key={l.id} className="flex items-center justify-between rounded-lg border p-3 text-sm">
                  <div>
                    <p className="font-medium">{l.firstName} {l.lastName}</p>
                    <p className="text-xs text-muted-foreground">{l.phone}{l.email ? ` · ${l.email}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs capitalize">{l.stage}</Badge>
                    {l.quoteId && (
                      <Link href={`/staff/policies?create=1&leadId=${l.id}`} className="text-xs text-primary hover:underline" data-testid={`link-convert-lead-${l.id}`}>
                        Convert to policy
                      </Link>
                    )}
                    <Link href="/staff/leads" className="text-xs text-primary hover:underline">Open in Leads</Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardSection>

        <CardSection title="Your contact details" description="These are yours to edit — everything else on your vCard (branding, content) is managed centrally." icon={MessageSquareText}>
          <div className="space-y-4 max-w-md">
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} data-testid="input-vcard-phone" />
            </div>
            <div className="space-y-1.5">
              <Label>WhatsApp number</Label>
              <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="If different from phone" data-testid="input-vcard-whatsapp" />
            </div>
            <div className="space-y-1.5">
              <Label>Facebook link</Label>
              <Input value={facebookUrl} onChange={(e) => setFacebookUrl(e.target.value)} data-testid="input-vcard-facebook" />
            </div>
            <div className="space-y-1.5">
              <Label>Instagram link</Label>
              <Input value={instagramUrl} onChange={(e) => setInstagramUrl(e.target.value)} data-testid="input-vcard-instagram" />
            </div>
            <div className="space-y-1.5">
              <Label>Website link</Label>
              <Input value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} data-testid="input-vcard-website" />
            </div>
            <div className="space-y-1.5">
              <Label>Bio</Label>
              <Input value={bio} onChange={(e) => setBio(e.target.value)} data-testid="input-vcard-bio" />
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} data-testid="button-save-vcard">
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </div>
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
