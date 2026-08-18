import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { Loader2, ShieldCheck } from "lucide-react";
import { AppChrome } from "@/components/layout/app-chrome";

/**
 * Reached via a full-page redirect from GET /api/auth/google/callback when the signing-in staff
 * member has MFA enabled (see beginStaffMfaChallenge, server/auth.ts) — the OAuth login isn't
 * complete yet, just pending on this code. On success the server hands back a redirectUrl (the
 * same destination the non-MFA callback would have redirected to directly) rather than doing the
 * redirect itself, since a fetch() response can't navigate the page.
 */
export default function StaffMfaVerify() {
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setSubmitting(true);
    setError("");
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) headers["X-XSRF-TOKEN"] = csrf;
      const res = await fetch(getApiBase() + "/api/auth/mfa/verify-login", {
        method: "POST",
        headers,
        credentials: "include",
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Invalid code. Please try again.");
        return;
      }
      window.location.href = data.redirectUrl || "/staff";
    } catch {
      setError("Connection error. Please check your internet and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppChrome center>
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
            <ShieldCheck size={28} />
          </div>
          <CardTitle className="text-2xl font-display">Two-factor verification</CardTitle>
          <CardDescription className="text-base mt-2">
            Enter the code from your authenticator app, or one of your backup codes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <p className="text-sm text-destructive bg-destructive/10 p-3 rounded text-center" data-testid="text-mfa-verify-error">
                {error}
              </p>
            )}
            <div className="space-y-2">
              <Label htmlFor="mfa-code">Authentication code</Label>
              <Input
                id="mfa-code"
                autoFocus
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="h-11 text-center text-lg tracking-widest"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={submitting}
                data-testid="input-mfa-code"
              />
            </div>
            <Button type="submit" className="w-full h-11" disabled={submitting || !code.trim()} data-testid="button-mfa-verify">
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Verify
            </Button>
          </form>
          <div className="text-center pt-2">
            <Link href="/staff/login">
              <Button variant="link" className="text-muted-foreground text-xs" data-testid="link-mfa-back-to-login">
                Not you? Back to login
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
