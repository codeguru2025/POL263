import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { AppChrome } from "@/components/layout/app-chrome";
import { validatePasswordPolicy, MIN_PASSWORD_LENGTH } from "@shared/validation";

async function postJson(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const csrf = getCsrfToken();
  if (csrf) headers["X-XSRF-TOKEN"] = csrf;
  const res = await fetch(getApiBase() + path, {
    method: "POST",
    headers,
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "Something went wrong. Please try again.");
  return data as { message?: string };
}

/** Without ?token: ask for a reset link by email. With ?token (the emailed link): set the new password. */
export default function AgentResetPassword() {
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") : null;
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const requestMutation = useMutation({
    mutationFn: () => postJson("/api/agent-auth/forgot-password", { email: email.trim() }),
  });
  const resetMutation = useMutation({
    mutationFn: () => postJson("/api/agent-auth/reset-password", { token, newPassword }),
  });

  const passwordOk = !validatePasswordPolicy(newPassword) && newPassword === confirmPassword;

  return (
    <AppChrome center>
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <KeyRound className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">Reset agent password</CardTitle>
          <CardDescription className="text-base mt-2">
            {token ? "Choose a new password for your agent account." : "Enter your agent email and we'll send you a link to reset your password."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resetMutation.isSuccess ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-600 text-center font-medium">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <Link href="/agent/login">
                <Button className="w-full">Sign in</Button>
              </Link>
            </div>
          ) : token ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (passwordOk) resetMutation.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password (min {MIN_PASSWORD_LENGTH} characters, with a letter and a number)</Label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                />
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>
              {resetMutation.isError && <p className="text-sm text-destructive">{(resetMutation.error as Error).message}</p>}
              <Button type="submit" className="w-full" disabled={!passwordOk || resetMutation.isPending} data-testid="button-agent-reset-password">
                {resetMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
              {resetMutation.isError && (
                <Link href="/agent/reset-password">
                  <Button type="button" variant="link" className="w-full text-xs text-muted-foreground">
                    Request a new link
                  </Button>
                </Link>
              )}
            </form>
          ) : requestMutation.isSuccess ? (
            <p className="text-sm text-muted-foreground bg-muted p-3 rounded text-center">{requestMutation.data?.message}</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (email.trim()) requestMutation.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="agent-reset-email">Email</Label>
                <Input
                  id="agent-reset-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  data-testid="input-agent-reset-email"
                />
              </div>
              {requestMutation.isError && <p className="text-sm text-destructive">{(requestMutation.error as Error).message}</p>}
              <Button type="submit" className="w-full" disabled={!email.trim() || requestMutation.isPending} data-testid="button-agent-send-reset">
                {requestMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                  </>
                ) : (
                  "Send reset link"
                )}
              </Button>
            </form>
          )}
          <div className="text-center pt-2">
            <Link href="/agent/login">
              <Button variant="link" className="text-muted-foreground">
                Back to sign in
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
