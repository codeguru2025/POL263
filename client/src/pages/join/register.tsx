/**
 * Public policy registration from agent referral link.
 * User enters details → save → get policy number + activation code → redirect to client login.
 */

import { useState, useEffect } from "react";
import { useLocation, useSearch } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase } from "@/lib/queryClient";
import { UserPlus, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProductWithVersions {
  id: string;
  name: string;
  code: string;
  versions: { id: string; version: number; premiumMonthlyUsd?: string; premiumMonthlyZar?: string }[];
}

interface RegistrationOptions {
  agentName: string;
  referralCode: string;
  products: ProductWithVersions[];
  branches: { id: string; name: string }[];
}

export default function JoinRegisterPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(search || "");
  const refCode = params.get("ref") || "";

  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [loading, setLoading] = useState(!!refCode);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [result, setResult] = useState<{ policyNumber: string; activationCode: string } | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    dateOfBirth: "",
    nationalId: "",
    productId: "",
    productVersionId: "",
    branchId: "",
    premiumAmount: "",
  });

  useEffect(() => {
    if (!refCode) {
      setLoading(false);
      return;
    }
    sessionStorage.setItem("agent_referral_code", refCode);
    fetch(getApiBase() + `/api/public/registration-options?ref=${encodeURIComponent(refCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        setOptions(data);
        if (data?.products?.length) {
          const first = data.products[0];
          const firstVersion = first?.versions?.[0];
          setForm((f) => ({
            ...f,
            productId: first?.id || "",
            productVersionId: firstVersion?.id || "",
            premiumAmount: firstVersion?.premiumMonthlyUsd || firstVersion?.premiumMonthlyZar || "",
          }));
        }
      })
      .catch(() => toast({ title: "Error", description: "Could not load options.", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [refCode, toast]);

  const selectedProduct = options?.products?.find((p) => p.id === form.productId);
  const versions = selectedProduct?.versions || [];

  useEffect(() => {
    if (versions.length && !versions.some((v) => v.id === form.productVersionId)) {
      setForm((f) => ({
        ...f,
        productVersionId: versions[0]?.id || "",
        premiumAmount: versions[0]?.premiumMonthlyUsd || versions[0]?.premiumMonthlyZar || "",
      }));
    }
  }, [form.productId, form.productVersionId, versions]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refCode || !options) return;
    if (!form.firstName.trim() || !form.lastName.trim() || !form.productVersionId) {
      toast({ title: "Missing fields", description: "First name, last name, and product are required.", variant: "destructive" });
      return;
    }
    setSubmitLoading(true);
    try {
      const res = await fetch(getApiBase() + "/api/public/register-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referralCode: options.referralCode,
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim() || undefined,
          phone: form.phone.trim() || undefined,
          dateOfBirth: form.dateOfBirth || undefined,
          nationalId: form.nationalId.trim() || undefined,
          productVersionId: form.productVersionId,
          branchId: form.branchId || undefined,
          premiumAmount: form.premiumAmount ? String(form.premiumAmount) : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: "Registration failed", description: data?.error || "Please try again.", variant: "destructive" });
        return;
      }
      setResult({ policyNumber: data.policyNumber, activationCode: data.activationCode });
      toast({ title: "Policy registered", description: "Use your policy number and activation code to claim your account." });
    } finally {
      setSubmitLoading(false);
    }
  };

  const goToLogin = () => {
    setLocation("/client/login");
  };

  if (!refCode) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid link</CardTitle>
            <CardDescription>Use the link shared by your agent to register for a policy.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => setLocation("/join")}>Back to Join</Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (loading || !options) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-lg shadow-lg">
          <CardHeader className="text-center">
            <div className="mx-auto h-14 w-14 bg-green-100 text-green-600 rounded-xl flex items-center justify-center mb-4">
              <CheckCircle2 size={28} />
            </div>
            <CardTitle className="text-2xl">Policy registered</CardTitle>
            <CardDescription>
              Save your policy number and activation code. Use them to claim your account and sign in.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-4">
              <div>
                <p className="text-sm text-muted-foreground">Policy number</p>
                <p className="font-mono font-semibold text-lg" data-testid="text-policy-number">{result.policyNumber}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Activation code</p>
                <p className="font-mono font-semibold text-lg" data-testid="text-activation-code">{result.activationCode}</p>
              </div>
            </div>
            <p className="text-sm text-muted-foreground text-center">
              Go to client login, then use &quot;Claim Policy&quot; to set your password with this policy number and activation code. After that you can sign in anytime.
            </p>
          </CardContent>
          <CardFooter>
            <Button className="w-full gap-2" onClick={goToLogin} data-testid="btn-go-to-login">
              Go to client login <ArrowRight className="h-4 w-4" />
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
            <UserPlus size={28} />
          </div>
          <CardTitle className="text-2xl">Register for a policy</CardTitle>
          <CardDescription>
            Referred by <strong>{options.agentName}</strong>. Enter your details to get a policy number and activation code.
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="firstName">First name *</Label>
                <Input
                  id="firstName"
                  value={form.firstName}
                  onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                  required
                  data-testid="input-first-name"
                />
              </div>
              <div>
                <Label htmlFor="lastName">Last name *</Label>
                <Input
                  id="lastName"
                  value={form.lastName}
                  onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                  required
                  data-testid="input-last-name"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                data-testid="input-email"
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. 0771234567"
                data-testid="input-phone"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dateOfBirth">Date of birth</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  data-testid="input-dob"
                />
              </div>
              <div>
                <Label htmlFor="nationalId">National ID</Label>
                <Input
                  id="nationalId"
                  value={form.nationalId}
                  onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))}
                  data-testid="input-national-id"
                />
              </div>
            </div>
            <div>
              <Label>Product *</Label>
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.productId}
                onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                data-testid="select-product"
              >
                {options.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
            {versions.length > 1 && (
              <div>
                <Label>Plan / version</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.productVersionId}
                  onChange={(e) => {
                    const v = versions.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      productVersionId: e.target.value,
                      premiumAmount: v?.premiumMonthlyUsd || v?.premiumMonthlyZar || "",
                    }));
                  }}
                  data-testid="select-version"
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>Version {v.version} {v.premiumMonthlyUsd ? `— ${v.premiumMonthlyUsd} USD/mo` : ""} {v.premiumMonthlyZar ? `— ${v.premiumMonthlyZar} ZAR/mo` : ""}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label htmlFor="premiumAmount">Premium amount (optional)</Label>
              <Input
                id="premiumAmount"
                type="number"
                step="0.01"
                value={form.premiumAmount}
                onChange={(e) => setForm((f) => ({ ...f, premiumAmount: e.target.value }))}
                placeholder="Leave blank to use default"
                data-testid="input-premium"
              />
            </div>
            {options.branches.length > 0 && (
              <div>
                <Label>Branch (optional)</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.branchId}
                  onChange={(e) => setForm((f) => ({ ...f, branchId: e.target.value }))}
                  data-testid="select-branch"
                >
                  <option value="">Default</option>
                  {options.branches.map((b) => (
                    <option key={b.id} value={b.id}>{b.name}</option>
                  ))}
                </select>
              </div>
            )}
          </CardContent>
          <CardFooter className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setLocation("/join" + (refCode ? `?ref=${refCode}` : ""))}>
              Back
            </Button>
            <Button type="submit" disabled={submitLoading} className="gap-2" data-testid="btn-save-registration">
              {submitLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save & get policy number
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
