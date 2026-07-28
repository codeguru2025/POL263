import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Loader2, Phone, MessageCircle, Facebook, Instagram, Globe, ArrowRight, Play, Plus, X, Contact, Link2, Check } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";
import { getDefaultLogoUrl } from "@/lib/assetUrl";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";
import { resolveDobForQuote } from "@/lib/estimated-dob";

interface VCard {
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  whatsapp: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  websiteUrl: string | null;
  org: { name: string; logoUrl: string | null; primaryColor: string | null } | null;
  posts: { id: string; type: "video" | "post"; title: string; body: string | null; videoUrl: string | null; thumbnailUrl: string | null }[];
}

interface RankedCandidate {
  productId: string;
  productVersionId: string;
  productName: string;
  premium: string;
  currency: string;
  paymentSchedule: string;
  surchargedMemberCount: number;
  outsideEligibleAge: boolean;
  quoteToken: string;
}

interface DependentInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  /** Fallback when the exact DOB isn't known — converted to an approximate DOB for pricing only,
   *  never treated as a real date of birth (see client/src/lib/estimated-dob.ts). */
  estimatedAge: string;
}

function youtubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

function buildVCardFile(card: VCard): string {
  const phone = card.whatsapp || card.phone || "";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${card.displayName}`,
    card.org?.name ? `ORG:${card.org.name}` : "",
    phone ? `TEL;TYPE=CELL:${phone}` : "",
    card.websiteUrl ? `URL:${card.websiteUrl}` : "",
    "END:VCARD",
  ].filter(Boolean);
  // RFC 6350 requires CRLF line endings — most phone contact-import parsers tolerate bare \n,
  // but this is cheap to get right.
  return lines.join("\r\n");
}

function downloadVCard(card: VCard) {
  const blob = new Blob([buildVCardFile(card)], { type: "text/vcard" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${card.displayName.replace(/\s+/g, "-")}.vcf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AgentVCardPage() {
  const [, params] = useRoute("/card/:refCode");
  const refCode = params?.refCode as string;
  const [, setLocation] = useLocation();

  const [card, setCard] = useState<VCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!refCode) return;
    fetch(getApiBase() + `/api/public/agent-vcard/${refCode}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setCard(data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
    fetch(getApiBase() + `/api/public/agent-vcard/${refCode}/track`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType: "page_view" }),
    }).catch(() => {});
  }, [refCode]);

  // ── Quote & recommend ──────────────────────────────────────────
  const [policyholderName, setPolicyholderName] = useState("");
  const [policyholderDob, setPolicyholderDob] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [dependents, setDependents] = useState<DependentInput[]>([]);
  const [quoting, setQuoting] = useState(false);
  const [result, setResult] = useState<{ recommended: RankedCandidate | null; alternatives: RankedCandidate[] } | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [linkCopied, setLinkCopied] = useState(false);

  const addDependent = () => setDependents((d) => [...d, { firstName: "", lastName: "", dateOfBirth: "", estimatedAge: "" }]);
  const removeDependent = (i: number) => setDependents((d) => d.filter((_, idx) => idx !== i));
  const updateDependent = (i: number, field: keyof DependentInput, value: string) =>
    setDependents((d) => d.map((dep, idx) => (idx === i ? { ...dep, [field]: value } : dep)));

  // Exact DOB or an estimated age — either is enough to price a dependent. Not requiring exact
  // DOB here (a website visitor rarely has a dependent's exact birthdate on hand); the real DOB
  // is still required later, at actual registration.
  const canSubmit = policyholderName.trim() && policyholderDob && phone.trim()
    && dependents.every((d) => d.firstName.trim() && d.lastName.trim() && resolveDobForQuote(d.dateOfBirth, d.estimatedAge));
  const usedEstimatedAge = dependents.some((d) => !d.dateOfBirth && d.estimatedAge);

  const getRecommendation = async () => {
    if (!canSubmit) return;
    setQuoting(true);
    setQuoteError(null);
    setResult(null);
    try {
      const [firstName, ...rest] = policyholderName.trim().split(/\s+/);
      const res = await fetch(getApiBase() + "/api/public/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refCode,
          policyholderDateOfBirth: policyholderDob,
          dependentDateOfBirths: dependents.map((d) => resolveDobForQuote(d.dateOfBirth, d.estimatedAge)),
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setResult(data);
      // Capture the lead now that we have phone/name — quote-request analytics, lead creation,
      // and the shareable quote snapshot all happen together server-side (POST /quote-lead).
      const leadRes = await fetch(getApiBase() + `/api/public/agent-vcard/${refCode}/quote-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName,
          lastName: rest.join(" ") || firstName,
          phone,
          email: email.trim() || undefined,
          productInterest: data.recommended?.productName,
          quote: {
            policyholderName,
            policyholderDateOfBirth: policyholderDob,
            dependents,
            recommended: data.recommended,
            alternatives: data.alternatives,
          },
        }),
      }).catch(() => null);
      if (leadRes?.ok) {
        const leadData = await leadRes.json();
        setQuoteId(leadData.quoteId ?? null);
      }
    } catch {
      setQuoteError("Couldn't get a quote right now — please try again.");
    } finally {
      setQuoting(false);
    }
  };

  const goToRegister = () => {
    if (result?.recommended) {
      sessionStorage.setItem("vcard_selected_product_version_id", result.recommended.productVersionId);
      sessionStorage.setItem("vcard_prefill", JSON.stringify({
        policyholderName,
        policyholderDateOfBirth: policyholderDob,
        phone,
        email,
        dependents,
      }));
    }
    setLocation(`/join/register?ref=${encodeURIComponent(refCode)}`);
  };

  if (loading) {
    return (
      <AppChrome center mainClassName="flex flex-col flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </AppChrome>
    );
  }

  if (notFound || !card) {
    return (
      <AppChrome center mainClassName="flex flex-col flex-1 items-center justify-center">
        <p className="text-muted-foreground">This agent link isn't valid.</p>
      </AppChrome>
    );
  }

  const waLink = card.whatsapp ? `https://wa.me/${card.whatsapp.replace(/[^\d]/g, "")}` : null;

  return (
    <AppChrome center={false} mainClassName="flex flex-col flex-1">
      <div className={cn(APP_SHELL_MAX, "flex-1 flex flex-col items-center px-4 py-10 gap-6")}>
        <Card className="w-full max-w-lg shadow-lg overflow-hidden">
          <CardHeader className="text-center space-y-3 pb-4">
            <div className="mx-auto h-20 w-20 rounded-full overflow-hidden border-2 bg-muted flex items-center justify-center">
              {card.avatarUrl ? (
                <img src={card.avatarUrl} alt={card.displayName} className="h-full w-full object-cover" />
              ) : (
                <img src={card.org?.logoUrl || getDefaultLogoUrl()} alt="" className="h-10 w-10 object-contain" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">{card.displayName}</h1>
              <p className="text-sm text-muted-foreground">{card.org?.name}</p>
            </div>
            {card.bio && <p className="text-sm text-muted-foreground max-w-sm mx-auto">{card.bio}</p>}
            <div className="flex items-center justify-center gap-4 flex-wrap pt-1">
              {card.phone && (
                <a href={`tel:${card.phone}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline" data-testid="link-agent-phone">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
              )}
              {waLink && (
                <a href={waLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline" data-testid="link-agent-whatsapp">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              )}
              {card.facebookUrl && (
                <a href={card.facebookUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Facebook className="h-3.5 w-3.5" /> Facebook
                </a>
              )}
              {card.instagramUrl && (
                <a href={card.instagramUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Instagram className="h-3.5 w-3.5" /> Instagram
                </a>
              )}
              {card.websiteUrl && (
                <a href={card.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Globe className="h-3.5 w-3.5" /> Website
                </a>
              )}
            </div>
            <Button variant="outline" size="sm" className="gap-2 mx-auto" onClick={() => downloadVCard(card)} data-testid="button-save-contact">
              <Contact className="h-3.5 w-3.5" /> Save to Contacts
            </Button>
          </CardHeader>
        </Card>

        {/* Quote & Recommend */}
        <Card className="w-full max-w-lg shadow-lg">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold">Get a Quote</h2>
            <p className="text-xs text-muted-foreground">
              Tell us who needs cover — we'll suggest the most appropriate plan and price it for you.
            </p>
            <div className="space-y-1.5">
              <Label>Your full name</Label>
              <Input value={policyholderName} onChange={(e) => setPolicyholderName(e.target.value)} data-testid="input-policyholder-name" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date of birth</Label>
                <Input type="date" value={policyholderDob} onChange={(e) => setPolicyholderDob(e.target.value)} data-testid="input-policyholder-dob" />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07..." data-testid="input-lead-phone" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Email (optional)</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="input-lead-email" />
            </div>

            {dependents.map((dep, i) => (
              <div key={i} className="rounded-lg border p-3 space-y-2 relative">
                <Button type="button" variant="ghost" size="icon" className="h-6 w-6 absolute top-2 right-2" onClick={() => removeDependent(i)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
                <p className="text-xs font-medium text-muted-foreground">Dependant {i + 1}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Input placeholder="First name" value={dep.firstName} onChange={(e) => updateDependent(i, "firstName", e.target.value)} />
                  <Input placeholder="Last name" value={dep.lastName} onChange={(e) => updateDependent(i, "lastName", e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Date of birth</Label>
                  <Input type="date" value={dep.dateOfBirth} onChange={(e) => updateDependent(i, "dateOfBirth", e.target.value)} />
                </div>
                {!dep.dateOfBirth && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Don't know the exact date? Estimated age</Label>
                    <Input type="number" min="0" max="120" placeholder="e.g. 8" value={dep.estimatedAge} onChange={(e) => updateDependent(i, "estimatedAge", e.target.value)} />
                  </div>
                )}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={addDependent} data-testid="button-add-dependant">
              <Plus className="h-3.5 w-3.5" /> Add a dependant
            </Button>

            <Button className="w-full" disabled={!canSubmit || quoting} onClick={getRecommendation} data-testid="btn-get-quote">
              {quoting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Get My Recommendation
            </Button>
            {quoteError && <p className="text-xs text-destructive">{quoteError}</p>}
            {usedEstimatedAge && (
              <p className="text-xs text-muted-foreground">
                This estimate uses approximate ages for one or more dependants — it'll be re-priced exactly once real dates of birth are captured at registration.
              </p>
            )}

            {result?.recommended && (
              <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>Recommended</Badge>
                  <p className="font-semibold text-sm">{result.recommended.productName}</p>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {result.recommended.currency} {parseFloat(result.recommended.premium).toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground"> / {result.recommended.paymentSchedule}</span>
                </p>
                {result.alternatives.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t">
                    <p className="text-xs text-muted-foreground pt-2">Compared to other plans:</p>
                    {result.alternatives.map((alt) => (
                      <div key={alt.productVersionId} className="flex items-center justify-between text-xs">
                        <span>{alt.productName}</span>
                        <span className="tabular-nums text-muted-foreground">{alt.currency} {parseFloat(alt.premium).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Button className="w-full gap-2" onClick={goToRegister} data-testid="btn-register-now">
                  Register Now <ArrowRight className="h-4 w-4" />
                </Button>
                {quoteId && (
                  <Button
                    variant="outline"
                    className="w-full gap-2"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/quote/${quoteId}`);
                      setLinkCopied(true);
                      setTimeout(() => setLinkCopied(false), 2000);
                    }}
                    data-testid="btn-copy-quote-link"
                  >
                    {linkCopied ? <Check className="h-4 w-4" /> : <Link2 className="h-4 w-4" />}
                    {linkCopied ? "Link copied" : "Copy shareable link"}
                  </Button>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Marketing materials (org-wide, centrally controlled) */}
        {card.posts.length > 0 && (
          <div className="w-full max-w-lg space-y-3">
            <h2 className="font-semibold px-1">From {card.displayName.split(" ")[0]}</h2>
            {card.posts.map((post) => (
              <Card key={post.id} className="overflow-hidden">
                {post.type === "video" && post.videoUrl && youtubeEmbedUrl(post.videoUrl) ? (
                  <div className="aspect-video bg-black">
                    <iframe
                      src={youtubeEmbedUrl(post.videoUrl)!}
                      title={post.title}
                      className="w-full h-full"
                      allow="accelerate-compute; encrypted-media; picture-in-picture"
                      allowFullScreen
                    />
                  </div>
                ) : post.type === "video" && post.videoUrl ? (
                  <a href={post.videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 bg-muted aspect-video text-sm text-muted-foreground hover:bg-muted/70">
                    <Play className="h-5 w-5" /> Watch video
                  </a>
                ) : post.thumbnailUrl ? (
                  <img src={post.thumbnailUrl} alt="" className="w-full aspect-video object-cover" />
                ) : null}
                <CardContent className="p-4 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] capitalize">{post.type}</Badge>
                    <p className="font-medium text-sm">{post.title}</p>
                  </div>
                  {post.body && <p className="text-xs text-muted-foreground">{post.body}</p>}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </AppChrome>
  );
}
