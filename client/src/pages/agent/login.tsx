import { useState } from "react";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { getApiBase } from "@/lib/queryClient";
import { Loader2, UserCircle } from "lucide-react";
import { useEffect } from "react";

export default function AgentLogin() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
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
      const res = await fetch(getApiBase() + "/api/agent-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message || "Login failed");
        return;
      }
      if (data.redirect) {
        window.location.href = getApiBase() ? new URL(data.redirect, getApiBase()).href : data.redirect;
      } else {
        setLocation("/staff");
      }
    } catch {
      setError("Network error. Please try again.");
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
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <UserCircle className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">Agent Login</CardTitle>
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                data-testid="input-agent-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={submitting} data-testid="button-agent-login">
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
    </div>
  );
}
