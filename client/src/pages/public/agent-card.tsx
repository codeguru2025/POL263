import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Loader2, Phone, ArrowRight, Play, Plus, X } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";
import { getDefaultLogoUrl } from "@/lib/assetUrl";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";

interface AgentCard {
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
  org: { name: string; logoUrl: string | null; primaryColor: string | null } | null;
  posts: { id: string; type: "video" | "post"; title: string; body: string | null; videoUrl: string | null; thumbnailUrl: string | null }[];
}

interface RegistrationOptions {
  agentName: string;
  products: { id: string; name: string; versions: { id: string; premiumMonthlyUsd?: string; premiumMonthlyZar?: string }[] }[];
}

function youtubeEmbedUrl(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

export default function AgentCardPage() {
  const [, params] = useRoute("/join/:refCode");
  const refCode = params?.refCode as string;
  const [, setLocation] = useLocation();

  const [card, setCard] = useState<AgentCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!refCode) return;
    sessionStorage.setItem("agent_referral_code", refCode);
    fetch(getApiBase() + `/api/public/agent-card/${refCode}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setCard(data))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));

    // Best-effort per-agent PWA install icon/name — degrades gracefully on browsers
    // (notably iOS Safari) that don't support scoped multi-manifest per origin.
    let manifestLink = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null;
    if (!manifestLink) {
      manifestLink = document.createElement("link");
      manifestLink.rel = "manifest";
      document.head.appendChild(manifestLink);
    }
    const originalHref = manifestLink.href;
    manifestLink.href = getApiBase() + `/api/public/agent-card/${refCode}/manifest.json`;
    return () => { manifestLink!.href = originalHref; };
  }, [refCode]);

  // ── Quote calculator ──────────────────────────────────────────
  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [productVersionId, setProductVersionId] = useState("");
  const [memberCount, setMemberCount] = useState(1);
  const [quote, setQuote] = useState<{ premium: string; currency: string } | null>(null);
  const [quoting, setQuoting] = useState(false);

  useEffect(() => {
    if (!refCode) return;
    fetch(getApiBase() + `/api/public/registration-options?ref=${encodeURIComponent(refCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.products?.length) {
          setOptions(data);
          setProductVersionId(data.products[0]?.versions?.[0]?.id || "");
        }
      })
      .catch(() => {});
  }, [refCode]);

  const getQuote = async () => {
    if (!productVersionId) return;
    setQuoting(true);
    setQuote(null);
    try {
      const res = await fetch(getApiBase() + "/api/public/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refCode, productVersionId, memberCount }),
      });
      if (res.ok) setQuote(await res.json());
    } finally {
      setQuoting(false);
    }
  };

  const goToRegister = () => {
    if (productVersionId) sessionStorage.setItem("vcard_selected_product_version_id", productVersionId);
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
            {card.phone && (
              <a href={`tel:${card.phone}`} className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline" data-testid="link-agent-phone">
                <Phone className="h-3.5 w-3.5" /> {card.phone}
              </a>
            )}
          </CardHeader>
        </Card>

        {/* Get a Quote */}
        <Card className="w-full max-w-lg shadow-lg">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold">Get a Quote</h2>
            {options ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="product-version-id">Plan</Label>
                  <Select
                    value={productVersionId}
                    onValueChange={(v) => { setProductVersionId(v); setQuote(null); }}
                  >
                    <SelectTrigger id="product-version-id" data-testid="select-quote-product"><SelectValue placeholder="Select a plan" /></SelectTrigger>
                    <SelectContent>
                      {options.products.map((p) =>
                        p.versions.map((v) => (
                          <SelectItem key={v.id} value={v.id}>{p.name}</SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Covered members</Label>
                  <div className="flex items-center gap-3">
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setMemberCount((n) => Math.max(1, n - 1))}><X className="h-3.5 w-3.5" /></Button>
                    <Input className="w-16 text-center" value={memberCount} readOnly />
                    <Button type="button" variant="outline" size="icon" className="h-8 w-8" onClick={() => setMemberCount((n) => n + 1)}><Plus className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
                <Button className="w-full" disabled={!productVersionId || quoting} onClick={getQuote} data-testid="btn-get-quote">
                  {quoting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  Calculate Quote
                </Button>
                {quote && (
                  <div className="rounded-lg border bg-primary/5 p-4 text-center space-y-2">
                    <p className="text-xs text-muted-foreground">Estimated monthly premium</p>
                    <p className="text-2xl font-bold tabular-nums">{quote.currency} {parseFloat(quote.premium).toFixed(2)}</p>
                    <Button className="w-full gap-2" onClick={goToRegister} data-testid="btn-register-now">
                      Register Now <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            )}
          </CardContent>
        </Card>

        {/* Content feed */}
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
