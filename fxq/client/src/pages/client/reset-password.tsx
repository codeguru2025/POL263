import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KeyRound, Loader2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { getApiBase } from "@/lib/queryClient";

export default function ClientResetPassword() {
  const [policyNumber, setPolicyNumber] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const resetMutation = useMutation({
    mutationFn: async (body: { policyNumber: string; securityAnswer: string; newPassword: string }) => {
      const res = await fetch(getApiBase() + "/api/client-auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Reset failed");
      return data;
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8 || newPassword !== confirmPassword) return;
    resetMutation.mutate({
      policyNumber: policyNumber.trim(),
      securityAnswer: securityAnswer.trim(),
      newPassword,
    });
  };

  const canSubmit =
    policyNumber.trim().length > 0 &&
    securityAnswer.trim().length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirmPassword &&
    !resetMutation.isPending;

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <KeyRound className="w-10 h-10 text-primary" />
          </div>
          <CardTitle className="text-2xl font-display">Reset password</CardTitle>
          <CardDescription className="text-base mt-2">
            Enter your policy number and the answer to your security question to set a new password.
          </CardDescription>
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
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
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
              <div className="space-y-2">
                <Label htmlFor="newPassword">New password (min 8 characters)</Label>
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
              {resetMutation.isError && (
                <p className="text-sm text-destructive">{(resetMutation.error as Error).message}</p>
              )}
              <Button type="submit" className="w-full" disabled={!canSubmit}>
                {resetMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting...
                  </>
                ) : (
                  "Reset password"
                )}
              </Button>
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
    </div>
  );
}
