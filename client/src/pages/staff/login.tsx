import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { getApiBase } from "@/lib/queryClient";
import { Loader2 } from "lucide-react";
import { useBranding } from "@/hooks/use-branding";
import { resolveAssetUrl } from "@/lib/assetUrl";

export default function StaffLogin() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { displayName, displayLogo } = useBranding();

  useEffect(() => {
    if (isAuthenticated) {
      setLocation("/staff");
    }
  }, [isAuthenticated, setLocation]);

  if (isLoading || isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const params = new URLSearchParams(window.location.search);
  const authError = params.get("error");
  const sessionError = authError === "session";

  const handleGoogleLogin = () => {
    try {
      const base = getApiBase() || window.location.origin;
      const returnTo = "/staff";
      const path = base ? `${base.replace(/\/$/, "")}/api/auth/google` : `${window.location.origin}/api/auth/google`;
      const url = new URL(path);
      url.searchParams.set("returnTo", returnTo);
      url.searchParams.set("origin", window.location.origin);
      window.location.href = url.toString();
    } catch (e) {
      console.error("Invalid API base URL", e);
      const url = new URL("/api/auth/google", window.location.origin);
      url.searchParams.set("returnTo", "/staff");
      url.searchParams.set("origin", window.location.origin);
      window.location.href = url.toString();
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <img src={resolveAssetUrl(displayLogo)} alt={displayName} className="w-10 h-10 rounded-lg object-contain" />
          </div>
          <CardTitle className="text-3xl font-display">{displayName} — Staff Portal</CardTitle>
          <CardDescription className="text-base mt-2">
            Sign in with your corporate Google account. Your email must be added by an administrator first.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authError && (
            <p className="text-sm text-destructive bg-destructive/10 p-3 rounded text-center" data-testid="text-auth-error">
              {sessionError
                ? "Could not load your session after sign-in. Please try again or reload the page."
                : decodeURIComponent(authError)}
            </p>
          )}

          <Button
            className="w-full h-12 text-base font-medium bg-primary text-primary-foreground hover:bg-primary/90 border-0 shadow-md flex items-center gap-3"
            data-testid="btn-google-login"
            onClick={handleGoogleLogin}
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </Button>

          <p className="text-xs text-center text-muted-foreground pt-4">
            Only authorized staff can sign in. Contact your administrator to add your email.{" "}
            <Link href="/agent/login">
              <Button variant="link" className="p-0 h-auto text-xs">
                Agent? Sign in here
              </Button>
            </Link>
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
    </div>
  );
}
