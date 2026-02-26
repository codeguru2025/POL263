import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function ClientLogin() {
  const [policyNumber, setPolicyNumber] = useState("");
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const loginMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/client-auth/login", { policyNumber, password });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/me"] });
      setLocation("/client");
    },
    onError: (error: Error) => {
      const msg = error.message.includes("429")
        ? "Account temporarily locked. Please try again later."
        : error.message.includes("401")
          ? "Invalid policy number or password."
          : "Login failed. Please try again.";
      toast({ title: "Login Failed", description: msg, variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!policyNumber || !password) return;
    loginMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center pb-6">
          <div className="mx-auto bg-primary/20 w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ring-1 ring-primary/30">
            <img src="/assets/logo.png" alt="POL263" className="w-10 h-10 rounded-lg object-contain" />
          </div>
          <CardTitle className="text-2xl font-display">POL263 — Client Portal</CardTitle>
          <CardDescription className="text-base mt-2">
            Sign in to manage your policy and payments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="space-y-4" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="policyNumber">Policy Number</Label>
              <Input
                id="policyNumber"
                placeholder="e.g. POL-12345678"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                required
                data-testid="input-policy-number"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/client/reset-password">
                  <span className="text-sm font-medium text-primary hover:underline cursor-pointer">
                    Forgot password?
                  </span>
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>

            <Button
              className="w-full h-11 text-base mt-4"
              type="submit"
              disabled={loginMutation.isPending}
              data-testid="btn-client-login"
            >
              {loginMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Signing In...
                </>
              ) : (
                "Sign In"
              )}
            </Button>
          </form>

          <div className="pt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground bg-muted/30 p-3 rounded-lg border">
            <ShieldCheck className="w-4 h-4 text-primary" />
            <span>Secure, encrypted login.</span>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col border-t pt-6 gap-4">
          <div className="text-center text-sm text-muted-foreground">
            Don't have an account yet?{" "}
            <Link href="/client/claim">
              <span className="text-primary font-medium hover:underline cursor-pointer">
                Claim your policy
              </span>
            </Link>
          </div>
          <Link href="/">
            <Button variant="link" className="text-muted-foreground p-0 h-auto" data-testid="link-back-home">
              &larr; Back to Home
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  );
}
