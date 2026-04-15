import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useBranding } from "@/hooks/use-branding";
import { resolveAssetUrl } from "@/lib/assetUrl";
import { AppChrome } from "@/components/layout/app-chrome";

export default function AgentLogin() {
  const [, setLocation] = useLocation();
  const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const orgIdFromUrl = params.get("orgId") || undefined;
  const { isAuthenticated, isLoading } = useAuth();
  const { displayName, displayLogo, isWhitelabeled } = useBranding(orgIdFromUrl);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/staff");
    }
  }, [isAuthenticated, setLocation]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password) {
      setError("Email and password are required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest("POST", "/api/agent-auth/login", { email: email.trim(), password });
      const data = await res.json().catch(() => ({}));
      if (data.redirect) {
        const base = getApiBase();
        const path = typeof data.redirect === "string" && data.redirect.startsWith("/") ? data.redirect : "/staff";
        const homeWithReturn = base ? `${base.replace(/\/$/, "")}/?returnTo=${encodeURIComponent(path)}` : `/?returnTo=${encodeURIComponent(path)}`;
        window.location.href = homeWithReturn;
      } else {
        setLocation("/staff");
      }
    } catch (err: any) {
      const msg = err.message || "Login failed";
      if (msg.includes("401")) {
        setError("Invalid email or password. Use the email and password set by your administrator.");
      } else if (msg.includes("403")) {
        const jsonMatch = msg.match(/\d+:\s*(.+)/);
        let parsed: any = {};
        if (jsonMatch) try { parsed = JSON.parse(jsonMatch[1]); } catch {}
        setError(parsed.message || "Access denied. Please contact your administrator.");
      } else {
        setError("Network error. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AppChrome center>
        <Card className="w-full max-w-md rounded-xl border-border/70 shadow-lg shadow-primary/5">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto px-4 py-3 bg-primary/15 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/25 max-w-full">
            <img src={resolveAssetUrl(displayLogo)} alt={displayName} className="h-10 w-auto max-w-[min(280px,85vw)] object-contain object-center" fetchPriority="high" />
          </div>
          <CardTitle className="text-2xl font-display">
            {isWhitelabeled ? `${displayName} — Agent Login` : "Agent Login"}
          </CardTitle>
          <CardDescription className="text-base mt-2">
            Sign in with the email and password set by your administrator. Agents cannot use Google sign-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded text-center" data-testid="text-agent-login-error">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="agent-email">Email</Label>
              <Input
                id="agent-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                className="h-11"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={submitting}
                data-testid="input-agent-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="agent-password">Password</Label>
              <Input
                id="agent-password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                className="h-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                data-testid="input-agent-password"
              />
            </div>
            <Button type="submit" className="w-full h-11 touch-target sm:h-10" disabled={submitting} data-testid="button-agent-login">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Sign in
            </Button>
          </form>

          <p className="text-xs text-center text-muted-foreground pt-2">
            Staff with Google accounts should use the{" "}
            <Link href="/staff/login">
              <Button variant="link" className="p-0 h-auto text-xs">
                staff login
              </Button>
            </Link>{" "}
            instead.
          </p>

          <div className="text-center pt-2">
            <Link href="/">
              <Button variant="link" className="text-muted-foreground" data-testid="link-back-home">
                &larr; Back to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
