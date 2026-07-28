import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ArrowRight } from "lucide-react";
import { getApiBase } from "@/lib/queryClient";
import { getDefaultLogoUrl } from "@/lib/assetUrl";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";

interface SharedQuote {
  policyholderName: string;
  recommended: { productVersionId: string; productName: string; premium: string; currency: string; paymentSchedule: string } | null;
  alternatives: { productId: string; productVersionId: string; productName: string; premium: string; currency: string; paymentSchedule: string }[];
  refCode: string | null;
  agentName: string | null;
  org: { name: string; logoUrl: string | null; primaryColor: string | null } | null;
  expiresAt: string;
}

export default function QuoteViewPage() {
  const [, params] = useRoute("/quote/:id");
  const id = params?.id as string;
  const [, setLocation] = useLocation();

  const [quote, setQuote] = useState<SharedQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetch(getApiBase() + `/api/public/quote/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data?.message || "This quote isn't available.");
        }
        return r.json();
      })
      .then(setQuote)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  const goToRegister = () => {
    if (quote?.recommended) {
      sessionStorage.setItem("vcard_selected_product_version_id", quote.recommended.productVersionId);
    }
    const ref = quote?.refCode ? `?ref=${encodeURIComponent(quote.refCode)}&quoteId=${encodeURIComponent(id)}` : `?quoteId=${encodeURIComponent(id)}`;
    setLocation(`/join/register${ref}`);
  };

  if (loading) {
    return (
      <AppChrome center mainClassName="flex flex-col flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </AppChrome>
    );
  }

  if (error || !quote) {
    return (
      <AppChrome center mainClassName="flex flex-col flex-1 items-center justify-center">
        <p className="text-muted-foreground">{error || "This quote isn't available."}</p>
      </AppChrome>
    );
  }

  return (
    <AppChrome center={false} mainClassName="flex flex-col flex-1">
      <div className={cn(APP_SHELL_MAX, "flex-1 flex flex-col items-center px-4 py-10 gap-6")}>
        <Card className="w-full max-w-lg shadow-lg overflow-hidden">
          <CardHeader className="text-center space-y-2 pb-4">
            <img src={quote.org?.logoUrl || getDefaultLogoUrl()} alt="" className="h-10 w-10 object-contain mx-auto" />
            <h1 className="text-lg font-display font-bold">Quote for {quote.policyholderName}</h1>
            {quote.agentName && <p className="text-sm text-muted-foreground">Prepared by {quote.agentName}{quote.org?.name ? ` · ${quote.org.name}` : ""}</p>}
          </CardHeader>
        </Card>

        {quote.recommended && (
          <Card className="w-full max-w-lg shadow-lg">
            <CardContent className="p-5 space-y-4">
              <div className="rounded-lg border bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Badge>Recommended</Badge>
                  <p className="font-semibold text-sm">{quote.recommended.productName}</p>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {quote.recommended.currency} {parseFloat(quote.recommended.premium).toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground"> / {quote.recommended.paymentSchedule}</span>
                </p>
                {quote.alternatives.length > 0 && (
                  <div className="space-y-1.5 pt-1 border-t">
                    <p className="text-xs text-muted-foreground pt-2">Compared to other plans:</p>
                    {quote.alternatives.map((alt) => (
                      <div key={alt.productVersionId} className="flex items-center justify-between text-xs">
                        <span>{alt.productName}</span>
                        <span className="tabular-nums text-muted-foreground">{alt.currency} {parseFloat(alt.premium).toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                <Button className="w-full gap-2" onClick={goToRegister} data-testid="btn-register-from-quote">
                  Register Now <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                This quote is an estimate and may be re-priced with exact details at registration.
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </AppChrome>
  );
}
