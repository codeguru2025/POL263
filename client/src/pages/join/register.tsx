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
import { UserPlus, CheckCircle2, Loader2, ArrowRight, Plus, Trash2, Users, Star } from "lucide-react";
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
  const [loadError, setLoadError] = useState<string | null>(null);
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
    premiumCurrency: "USD",
  });

  interface DependentEntry { firstName: string; lastName: string; relationship: string; dateOfBirth: string; nationalId: string }
  const [dependentsList, setDependentsList] = useState<DependentEntry[]>([]);
  const [showDepForm, setShowDepForm] = useState(false);
  const [depDraft, setDepDraft] = useState<DependentEntry>({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "" });

  const [beneficiary, setBeneficiary] = useState<{ firstName: string; lastName: string; relationship: string; nationalId: string; phone: string; fromDependentIndex: number | null }>({
    firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null,
  });
  const [showBenForm, setShowBenForm] = useState(false);

  useEffect(() => {
    if (!refCode) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    sessionStorage.setItem("agent_referral_code", refCode);
    fetch(getApiBase() + `/api/public/registration-options?ref=${encodeURIComponent(refCode)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.products?.length) {
          setOptions(data);
          setLoadError(null);
          const first = data.products[0];
          const firstVersion = first?.versions?.[0];
          setForm((f) => ({
            ...f,
            productId: first?.id || "",
            productVersionId: firstVersion?.id || "",
            premiumAmount: firstVersion?.premiumMonthlyUsd || firstVersion?.premiumMonthlyZar || "",
            premiumCurrency: firstVersion?.premiumMonthlyUsd ? "USD" : firstVersion?.premiumMonthlyZar ? "ZAR" : "USD",
          }));
        } else {
          setOptions(null);
          setLoadError(data?.message || "Invalid or expired referral link.");
        }
      })
      .catch(() => {
        setOptions(null);
        setLoadError("Could not load registration options. Please check the link and try again.");
        toast({ title: "Error", description: "Could not load options.", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [refCode, toast]);

  const selectedProduct = options?.products?.find((p) => p.id === form.productId);
  const versions = selectedProduct?.versions || [];

  useEffect(() => {
    if (!versions.length) return;
    const currentValid = versions.some((v) => v.id === form.productVersionId);
    if (!currentValid) {
      const first = versions[0];
      setForm((f) => ({
        ...f,
        productVersionId: first?.id || "",
        premiumAmount: first?.premiumMonthlyUsd || first?.premiumMonthlyZar || "",
        premiumCurrency: first?.premiumMonthlyUsd ? "USD" : first?.premiumMonthlyZar ? "ZAR" : "USD",
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!refCode || !options) return;
    const missing: string[] = [];
    if (!form.firstName.trim()) missing.push("First name");
    if (!form.lastName.trim()) missing.push("Last name");
    if (!form.productVersionId) missing.push("Product");
    if (missing.length > 0) {
      toast({ title: "Missing fields", description: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`, variant: "destructive" });
      return;
    }
    setSubmitLoading(true);
    try {
      const payload: Record<string, unknown> = {
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
        currency: form.premiumCurrency || undefined,
      };
      if (dependentsList.length > 0) {
        payload.dependents = dependentsList;
      }
      if (beneficiary.firstName && beneficiary.lastName) {
        payload.beneficiary = {
          firstName: beneficiary.firstName.trim(),
          lastName: beneficiary.lastName.trim(),
          relationship: beneficiary.relationship.trim() || undefined,
          nationalId: beneficiary.nationalId.trim() || undefined,
          phone: beneficiary.phone.trim() || undefined,
        };
      }
      const res = await fetch(getApiBase() + "/api/public/register-policy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Registration failed", description: (data as { error?: string }).error || "Please try again.", variant: "destructive" });
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

  if (loading || (!options && !loadError)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Unable to load registration</CardTitle>
            <CardDescription>{loadError}</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => setLocation("/join")}>Back to Join</Button>
            <Button onClick={() => { setLoadError(null); setLoading(true); window.location.reload(); }}>Try again</Button>
          </CardFooter>
        </Card>
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

  if (!options) return null;

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
                required
                data-testid="select-product"
              >
                {options.products.length === 0 && (
                  <option value="">No products available</option>
                )}
                {options.products.length > 1 && (
                  <option value="">Select a product</option>
                )}
                {options.products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
                ))}
              </select>
            </div>
            {versions.length > 0 && (
              <div>
                <Label>Plan / version *</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.productVersionId}
                  onChange={(e) => {
                    const v = versions.find((x) => x.id === e.target.value);
                    setForm((f) => ({
                      ...f,
                      productVersionId: e.target.value,
                      premiumAmount: v?.premiumMonthlyUsd || v?.premiumMonthlyZar || "",
                      premiumCurrency: v?.premiumMonthlyUsd ? "USD" : v?.premiumMonthlyZar ? "ZAR" : "USD",
                    }));
                  }}
                  required
                  data-testid="select-version"
                >
                  {versions.length > 1 && (
                    <option value="">Select a plan</option>
                  )}
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Version {v.version}
                      {([["USD", v.premiumMonthlyUsd], ["ZAR", v.premiumMonthlyZar]] as const)
                        .filter(([, val]) => val)
                        .map(([cur, val]) => ` — ${val} ${cur}/mo`)
                        .join("")}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.premiumAmount && (
              <div>
                <Label htmlFor="premiumAmount">Monthly premium</Label>
                <Input
                  id="premiumAmount"
                  type="text"
                  value={`${form.premiumAmount} ${form.premiumCurrency}/mo`}
                  readOnly
                  disabled
                  className="bg-muted"
                  data-testid="input-premium"
                />
                <p className="text-xs text-muted-foreground mt-1">Automatically set from the selected product.</p>
              </div>
            )}
            {/* ── Dependents ────────────────────────────── */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <Label className="text-sm font-medium">Dependents (optional)</Label>
                </div>
                <Button type="button" size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setShowDepForm(true)}>
                  <Plus className="h-3 w-3" /> Add
                </Button>
              </div>
              {dependentsList.map((dep, i) => (
                <div key={i} className="flex items-center gap-2 p-2 border rounded-md bg-muted/30 text-sm">
                  <span className="flex-1">{dep.firstName} {dep.lastName} <span className="text-muted-foreground capitalize">({dep.relationship})</span></span>
                  {beneficiary.fromDependentIndex !== i ? (
                    <Button type="button" size="sm" variant="ghost" className="h-6 text-xs text-primary" onClick={() => {
                      setBeneficiary({ firstName: dep.firstName, lastName: dep.lastName, relationship: dep.relationship, nationalId: dep.nationalId, phone: "", fromDependentIndex: i });
                      setShowBenForm(false);
                    }}>
                      <Star className="h-3 w-3 mr-1" /> Appoint
                    </Button>
                  ) : (
                    <span className="text-xs text-amber-600 font-medium">Beneficiary</span>
                  )}
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => {
                    setDependentsList((prev) => prev.filter((_, idx) => idx !== i));
                    if (beneficiary.fromDependentIndex === i) setBeneficiary({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null });
                  }}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
              {showDepForm && (
                <div className="p-3 border rounded-md bg-muted/20 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">First Name *</Label>
                      <Input className="h-8 text-sm" value={depDraft.firstName} onChange={(e) => setDepDraft({ ...depDraft, firstName: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Last Name *</Label>
                      <Input className="h-8 text-sm" value={depDraft.lastName} onChange={(e) => setDepDraft({ ...depDraft, lastName: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Relationship *</Label>
                    <select className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" value={depDraft.relationship} onChange={(e) => setDepDraft({ ...depDraft, relationship: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="parent">Parent</option>
                      <option value="sibling">Sibling</option>
                      <option value="extended">Extended Family</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Date of Birth</Label>
                      <Input className="h-8 text-sm" type="date" value={depDraft.dateOfBirth} onChange={(e) => setDepDraft({ ...depDraft, dateOfBirth: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">National ID</Label>
                      <Input className="h-8 text-sm" value={depDraft.nationalId} onChange={(e) => setDepDraft({ ...depDraft, nationalId: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="h-7 text-xs" disabled={!depDraft.firstName || !depDraft.lastName || !depDraft.relationship} onClick={() => {
                      setDependentsList((prev) => [...prev, { ...depDraft }]);
                      setDepDraft({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "" });
                      setShowDepForm(false);
                    }}>
                      Add Dependent
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowDepForm(false)}>Cancel</Button>
                  </div>
                </div>
              )}
            </div>

            {/* ── Beneficiary ─────────────────────────────── */}
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-500" />
                <Label className="text-sm font-medium">Beneficiary (optional, max 1)</Label>
              </div>
              {beneficiary.firstName && beneficiary.lastName ? (
                <div className="flex items-center gap-2 p-3 border rounded-md bg-amber-50/50 border-amber-200 text-sm">
                  <span className="flex-1 font-medium">{beneficiary.firstName} {beneficiary.lastName} <span className="text-muted-foreground capitalize">({beneficiary.relationship || "Beneficiary"})</span></span>
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => setBeneficiary({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null })}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ) : !showBenForm ? (
                <Button type="button" size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setShowBenForm(true)}>
                  <Plus className="h-3 w-3" /> Enter beneficiary details
                </Button>
              ) : (
                <div className="p-3 border rounded-md bg-muted/20 space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">First Name *</Label>
                      <Input className="h-8 text-sm" value={beneficiary.firstName} onChange={(e) => setBeneficiary({ ...beneficiary, firstName: e.target.value, fromDependentIndex: null })} />
                    </div>
                    <div>
                      <Label className="text-xs">Last Name *</Label>
                      <Input className="h-8 text-sm" value={beneficiary.lastName} onChange={(e) => setBeneficiary({ ...beneficiary, lastName: e.target.value, fromDependentIndex: null })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Relationship</Label>
                    <select className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" value={beneficiary.relationship} onChange={(e) => setBeneficiary({ ...beneficiary, relationship: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="parent">Parent</option>
                      <option value="sibling">Sibling</option>
                      <option value="extended">Extended Family</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">National ID</Label>
                      <Input className="h-8 text-sm" value={beneficiary.nationalId} onChange={(e) => setBeneficiary({ ...beneficiary, nationalId: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input className="h-8 text-sm" value={beneficiary.phone} onChange={(e) => setBeneficiary({ ...beneficiary, phone: e.target.value })} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" className="h-7 text-xs" disabled={!beneficiary.firstName || !beneficiary.lastName} onClick={() => setShowBenForm(false)}>
                      Confirm Beneficiary
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setShowBenForm(false); setBeneficiary({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null }); }}>Cancel</Button>
                  </div>
                </div>
              )}
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
