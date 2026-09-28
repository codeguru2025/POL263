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

/** How the client proves who they are: the emailed link, the texted code, or the security question. */
type Mode = "request" | "code" | "security";

export default function ClientResetPassword() {
  const token = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("token") : null;
  const [mode, setMode] = useState<Mode>("request");
  const [policyNumber, setPolicyNumber] = useState("");
  const [code, setCode] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const requestMutation = useMutation({
    mutationFn: () => postJson("/api/client-auth/forgot-password", { policyNumber: policyNumber.trim() }),
    onSuccess: () => setMode("code"),
  });

  const resetMutation = useMutation({
    mutationFn: (body: Record<string, string>) => postJson("/api/client-auth/reset-password", body),
  });

  const passwordOk = !validatePasswordPolicy(newPassword) && newPassword === confirmPassword;

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordOk) return;
    if (token) resetMutation.mutate({ token, newPassword });
    else if (mode === "code") resetMutation.mutate({ policyNumber: policyNumber.trim(), code: code.trim(), newPassword });
    else resetMutation.mutate({ policyNumber: policyNumber.trim(), securityAnswer: securityAnswer.trim(), newPassword });
  };

  const proofOk = token
    ? true
    : mode === "code"
      ? /^\d{6}$/.test(code.trim())
      : policyNumber.trim().length > 0 && securityAnswer.trim().length > 0;

  const description = token
    ? "Choose a new password for your account."
    : mode === "request"
      ? "Enter your policy number. We'll send a reset link to your email and a code to your phone, if we have them on file."
      : mode === "code"
        ? "Enter the 6-digit code we texted you, or open the link in the email we sent."
        : "Enter your policy number and the answer to your security question.";

  const passwordFields = (
    <>
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
    </>
  );

  return (
    <AppChrome center>
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <KeyRound className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">Reset password</CardTitle>
          <CardDescription className="text-base mt-2">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {resetMutation.isSuccess ? (
            <div className="space-y-4">
              <p className="text-sm text-emerald-600 text-center font-medium">
                Your password has been reset. You can now sign in with your new password.
              </p>
              <Link href="/client/login">
                <Button variant="default" className="w-full">
                  Sign in
                </Button>
              </Link>
            </div>
          ) : !token && mode === "request" ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (policyNumber.trim()) requestMutation.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="policyNumber">Policy number</Label>
                <Input
                  id="policyNumber"
                  type="text"
                  value={policyNumber}
                  onChange={(e) => setPolicyNumber(e.target.value)}
                  placeholder="e.g. 00001"
                  autoComplete="off"
                  data-testid="input-reset-policy-number"
                />
              </div>
              {requestMutation.isError && (
                <p className="text-sm text-destructive">{(requestMutation.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={!policyNumber.trim() || requestMutation.isPending} data-testid="button-send-reset">
                {requestMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Sending...
                  </>
                ) : (
                  "Send reset link or code"
                )}
              </Button>
              <Button type="button" variant="link" className="w-full text-xs text-muted-foreground" onClick={() => setMode("security")}>
                Use my security question instead
              </Button>
            </form>
          ) : (
            <form onSubmit={handleReset} className="space-y-4">
              {!token && mode === "code" && (
                <>
                  {requestMutation.data?.message && (
                    <p className="text-sm text-muted-foreground bg-muted p-3 rounded">{requestMutation.data.message}</p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="resetCode">6-digit code from SMS</Label>
                    <Input
                      id="resetCode"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      value={code}
                      onChange={(e) => setCode(e.target.value)}
                      placeholder="123456"
                      className="text-center tracking-widest"
                      data-testid="input-reset-code"
                    />
                  </div>
                </>
              )}
              {!token && mode === "security" && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="policyNumber">Policy number</Label>
                    <Input
                      id="policyNumber"
                      type="text"
                      value={policyNumber}
                      onChange={(e) => setPolicyNumber(e.target.value)}
                      placeholder="e.g. 00001"
                      autoComplete="off"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="securityAnswer">Answer to your security question</Label>
                    <Input
                      id="securityAnswer"
                      type="text"
                      value={securityAnswer}
                      onChange={(e) => setSecurityAnswer(e.target.value)}
                      placeholder="Your answer"
                      autoComplete="off"
                    />
                  </div>
                </>
              )}
              {passwordFields}
              {resetMutation.isError && (
                <p className="text-sm text-destructive">{(resetMutation.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={!proofOk || !passwordOk || resetMutation.isPending} data-testid="button-reset-password">
                {resetMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
              {!token && (
                <Button
                  type="button"
                  variant="link"
                  className="w-full text-xs text-muted-foreground"
                  onClick={() => {
                    resetMutation.reset();
                    setMode(mode === "security" ? "request" : "security");
                  }}
                >
                  {mode === "security" ? "Send me a reset link or code instead" : "Use my security question instead"}
                </Button>
              )}
            </form>
          )}
          <div className="text-center pt-2">
            <Link href="/client/login">
              <Button variant="link" className="text-muted-foreground">
                Back to sign in
              </Button>
            </Link>
          </div>
          <div className="text-center">
            <Link href="/">
              <Button variant="link" className="text-muted-foreground text-xs">
                &larr; Back to Home
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
