import { useEffect, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getApiBase } from "@/lib/queryClient";
import { getDefaultLogoUrl } from "@/lib/assetUrl";
import { UserPlus, Shield, CheckCircle2, ArrowRight } from "lucide-react";
import AppFooter from "@/components/app-footer";

export default function JoinPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(search);
  const refCode = params.get("ref");
  const [agentName, setAgentName] = useState<string | null>(null);

  useEffect(() => {
    if (refCode) {
      sessionStorage.setItem("agent_referral_code", refCode);
      fetch(getApiBase() + `/api/agents/by-referral/${refCode}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.name) setAgentName(data.name);
        })
        .catch(() => {});
    }
  }, [refCode]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div className="mb-8 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <img src={getDefaultLogoUrl()} alt="POL263" className="h-12 sm:h-14 w-auto max-w-[min(320px,90vw)] mb-4 object-contain object-center" />
        <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Join</h1>
        <p className="text-muted-foreground mt-2 text-lg">Secure your family's future with comprehensive funeral cover</p>
      </div>

      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
            <UserPlus size={28} />
          </div>
          <CardTitle className="text-2xl">Get Started</CardTitle>
          <CardDescription>
            {agentName ? (
              <span>Referred by agent <strong>{agentName}</strong></span>
            ) : refCode ? (
              <span>Referral code: <Badge variant="outline" data-testid="text-ref-code">{refCode}</Badge></span>
            ) : (
              <span>Begin your policy application</span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            {["Affordable funeral cover plans", "Family and extended member coverage", "Fast claims processing", "Nationwide service delivery"].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
                <span className="text-sm">{item}</span>
              </div>
            ))}
          </div>

          <div className="border-t pt-6 space-y-3">
            <p className="text-sm text-muted-foreground text-center">
              Already have a policy? Sign in to manage your account.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Button variant="outline" className="gap-2" onClick={() => setLocation("/client/login")} data-testid="btn-client-login">
                <Shield className="h-4 w-4" />
                Client Login
              </Button>
              <Button className="gap-2" onClick={() => setLocation("/client/claim")} data-testid="btn-claim-policy">
                <ArrowRight className="h-4 w-4" />
                Claim Policy
              </Button>
            </div>
            {refCode && (
              <Button
                variant="secondary"
                className="w-full gap-2"
                onClick={() => setLocation(`/join/register?ref=${encodeURIComponent(refCode)}`)}
                data-testid="btn-register-policy"
              >
                <UserPlus className="h-4 w-4" />
                Register for a new policy
              </Button>
            )}
          </div>

          <p className="text-xs text-center text-muted-foreground">
            Visit your nearest POL263 branch or contact your agent to begin your application.
          </p>
        </CardContent>
      </Card>
      </div>
      <AppFooter />
    </div>
  );
}
