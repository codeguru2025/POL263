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
import { getApiBase, getCsrfToken } from "@/lib/queryClient";
import { isValidNationalId } from "@shared/validation";
import { UserPlus, CheckCircle2, Loader2, ArrowRight, Plus, Trash2, Users, Star, Clock } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { AppChrome } from "@/components/layout/app-chrome";

interface ProductWithVersions {
  id: string;
  name: string;
  code: string;
  versions: { id: string; version: number; premiumMonthlyUsd?: string; premiumMonthlyZar?: string; premiumMonthlyZig?: string }[];
}

/** First configured monthly premium for a version, USD > ZAR > ZiG priority (matches this
 *  page's pre-existing USD-first default when more than one currency is set). */
function pickPremium(v: { premiumMonthlyUsd?: string; premiumMonthlyZar?: string; premiumMonthlyZig?: string } | undefined): { amount: string; currency: "USD" | "ZAR" | "ZIG" } {
  if (v?.premiumMonthlyUsd) return { amount: v.premiumMonthlyUsd, currency: "USD" };
  if (v?.premiumMonthlyZar) return { amount: v.premiumMonthlyZar, currency: "ZAR" };
  if (v?.premiumMonthlyZig) return { amount: v.premiumMonthlyZig, currency: "ZIG" };
  return { amount: "", currency: "USD" };
}

interface RegistrationOptions {
  agentName?: string;
  referralCode?: string | null;
  orgId?: string;
  orgName?: string;
  isWalkIn?: boolean;
  products: ProductWithVersions[];
  branches: { id: string; name: string }[];
}

export default function JoinRegisterPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const params = new URLSearchParams(search || "");
  const refCode = params.get("ref") || "";
  const orgCode = params.get("org") || "";
  const isWalkIn = !refCode && !!orgCode;

  const [options, setOptions] = useState<RegistrationOptions | null>(null);
  const [loading, setLoading] = useState(!!(refCode || orgCode));
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
    gender: "",
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
    if (!refCode && !orgCode) {
      setLoading(false);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    const url = orgCode && !refCode
      ? getApiBase() + `/api/public/walkin-options?org=${encodeURIComponent(orgCode)}`
      : getApiBase() + `/api/public/registration-options?ref=${encodeURIComponent(refCode)}`;
    if (refCode) sessionStorage.setItem("agent_referral_code", refCode);
    fetch(url)
      .then((r) => (r.ok ? r.json() : r.json().then((d: any) => { throw new Error(d?.message || "Failed"); })))
      .then((data) => {
        if (data?.products?.length) {
          setOptions(data);
          setLoadError(null);
          // Carry over a product picked on the agent's vCard "Get a Quote" panel, if any
          // (same handoff pattern as agent_referral_code above) — falls back to the first
          // product/version like before when nothing was pre-selected.
          const preselectedVersionId = sessionStorage.getItem("vcard_selected_product_version_id");
          sessionStorage.removeItem("vcard_selected_product_version_id");
          let preselected: { product: any; version: any } | null = null;
          if (preselectedVersionId) {
            for (const p of data.products) {
              const v = p.versions?.find((v: any) => v.id === preselectedVersionId);
              if (v) { preselected = { product: p, version: v }; break; }
            }
          }
          const first = preselected?.product || data.products[0];
          const firstVersion = preselected?.version || first?.versions?.[0];
          const firstPremium = pickPremium(firstVersion);
          setForm((f) => ({
            ...f,
            productId: first?.id || "",
            productVersionId: firstVersion?.id || "",
            premiumAmount: firstPremium.amount,
            premiumCurrency: firstPremium.currency,
          }));
        } else {
          setOptions(null);
          setLoadError(data?.message || (orgCode ? "No products available. Contact the office." : "Invalid or expired referral link."));
        }
      })
      .catch((err: any) => {
        setOptions(null);
        setLoadError(err?.message || "Could not load registration options. Please try again.");
        toast({ title: "Error", description: "Could not load options.", variant: "destructive" });
      })
      .finally(() => setLoading(false));
  }, [refCode, orgCode, toast]);

  // Carries over the name/DOB/contact/dependents already collected on the vCard's quote step
  // (client/src/pages/public/agent-vcard.tsx) so none of it has to be re-typed here — same-tab
  // handoff only (sessionStorage), since a quote opened fresh via its shareable /quote/:id link
  // on a different device has no prior session to read from and falls back to a normal blank form.
  useEffect(() => {
    const raw = sessionStorage.getItem("vcard_prefill");
    if (!raw) return;
    sessionStorage.removeItem("vcard_prefill");
    try {
      const data = JSON.parse(raw);
      const [firstName, ...rest] = String(data.policyholderName || "").trim().split(/\s+/);
      if (firstName) {
        setForm((f) => ({
          ...f,
          firstName,
          lastName: rest.join(" ") || f.lastName,
          dateOfBirth: data.policyholderDateOfBirth || f.dateOfBirth,
          phone: data.phone || f.phone,
          email: data.email || f.email,
        }));
      }
      if (Array.isArray(data.dependents) && data.dependents.length > 0) {
        setDependentsList(data.dependents
          .filter((d: any) => d.firstName?.trim() && d.lastName?.trim() && (d.dateOfBirth || d.estimatedAge))
          .map((d: any) => ({
            firstName: d.firstName,
            lastName: d.lastName,
            relationship: "",
            dateOfBirth: d.dateOfBirth || "",
            nationalId: "",
          })));
      }
    } catch {
      // Malformed/stale sessionStorage value — ignore, just leave the form blank as normal.
    }
  }, []);

  const selectedProduct = options?.products?.find((p) => p.id === form.productId);
  const versions = selectedProduct?.versions || [];

  useEffect(() => {
    if (!versions.length) return;
    const currentValid = versions.some((v) => v.id === form.productVersionId);
    if (!currentValid) {
      const first = versions[0];
      const premium = pickPremium(first);
      setForm((f) => ({
        ...f,
        productVersionId: first?.id || "",
        premiumAmount: premium.amount,
        premiumCurrency: premium.currency,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.productId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!options) return;
    if (!isWalkIn && !refCode) return;
    const missing: string[] = [];
    if (!form.firstName.trim()) missing.push("First name");
    if (!form.lastName.trim()) missing.push("Last name");
    if (!form.productVersionId) missing.push("Product");
    if (!form.phone.trim()) missing.push("Phone");
    if (!form.dateOfBirth) missing.push("Date of birth");
    if (!form.nationalId.trim()) missing.push("National ID");
    else if (!isValidNationalId(form.nationalId)) missing.push("Valid national ID (e.g. 08833089H38)");
    if (!form.gender.trim()) missing.push("Gender");
    if (missing.length > 0) {
      toast({ title: "Missing fields", description: `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`, variant: "destructive" });
      return;
    }
    setSubmitLoading(true);
    try {
      const commonFields = {
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        nationalId: form.nationalId.trim() || undefined,
        gender: form.gender.trim() || undefined,
        productVersionId: form.productVersionId,
        branchId: form.branchId || undefined,
        premiumAmount: form.premiumAmount ? String(form.premiumAmount) : undefined,
        currency: form.premiumCurrency || undefined,
      };
      const payload: Record<string, unknown> = isWalkIn
        ? { orgId: options.orgId, ...commonFields }
        : { referralCode: options.referralCode, ...commonFields };
      if (dependentsList.length > 0) payload.dependents = dependentsList;
      if (beneficiary.firstName && beneficiary.lastName) {
        payload.beneficiary = {
          firstName: beneficiary.firstName.trim(),
          lastName: beneficiary.lastName.trim(),
          relationship: beneficiary.relationship.trim() || undefined,
          nationalId: beneficiary.nationalId.trim() || undefined,
          phone: beneficiary.phone.trim() || undefined,
        };
      }
      const regHeaders: Record<string, string> = { "Content-Type": "application/json" };
      const csrf = getCsrfToken();
      if (csrf) regHeaders["X-XSRF-TOKEN"] = csrf;
      const endpoint = isWalkIn ? "/api/public/walkin-register" : "/api/public/register-policy";
      const res = await fetch(getApiBase() + endpoint, {
        method: "POST",
        headers: regHeaders,
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (data as { message?: string; error?: string }).message ?? (data as { error?: string }).error;
        toast({ title: "Registration failed", description: msg || "Please try again.", variant: "destructive" });
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

  if (!refCode && !orgCode) {
    return (
      <AppChrome center sideImage={{ src: "/assets/signup-advisor-meeting.jpg", alt: "A client meeting with their advisor" }}>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invalid link</CardTitle>
            <CardDescription>Use the link shared by your agent to register for a policy.</CardDescription>
          </CardHeader>
          <CardFooter>
            <Button variant="outline" onClick={() => setLocation("/join")}>Back to Join</Button>
          </CardFooter>
        </Card>
      </AppChrome>
    );
  }

  if (loading || (!options && !loadError)) {
    return (
      <AppChrome center sideImage={{ src: "/assets/signup-advisor-meeting.jpg", alt: "A client meeting with their advisor" }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </AppChrome>
    );
  }

  if (loadError) {
    return (
      <AppChrome center sideImage={{ src: "/assets/signup-advisor-meeting.jpg", alt: "A client meeting with their advisor" }}>
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
      </AppChrome>
    );
  }

  if (result) {
    return (
      <AppChrome center sideImage={{ src: "/assets/signup-advisor-meeting.jpg", alt: "A client meeting with their advisor" }}>
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
      </AppChrome>
    );
  }

  if (!options) return null;

  const heroSteps = [
    { icon: UserPlus, label: "Enter your details" },
    { icon: CheckCircle2, label: "Get your policy number" },
    { icon: Star, label: "You're covered" },
  ];

  return (
    <AppChrome center={false} mainClassName="py-6 sm:py-8 flex justify-center relative overflow-hidden">
      {/* Decorative ambience — purely visual, does not affect layout flow or the form below. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-72 w-72 rounded-full bg-primary/15 blur-3xl" />
        <div className="absolute top-1/3 -right-20 h-80 w-80 rounded-full bg-emerald-400/15 dark:bg-emerald-500/10 blur-3xl" />
        <div className="absolute -bottom-24 left-1/4 h-64 w-64 rounded-full bg-sky-400/15 dark:bg-sky-500/10 blur-3xl" />
      </div>

      <div className="w-full max-w-lg space-y-5">
        <div className="text-center space-y-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card/80 backdrop-blur px-3 py-1 text-xs font-medium text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Takes about 2 minutes
          </span>
          {/* Animated "how it works" strip — stands in for a walkthrough video: each step
              highlights in sequence on a loop so the flow is legible at a glance. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {heroSteps.map((s, i) => (
              <div
                key={s.label}
                className="register-hero-step rounded-xl border bg-card/70 backdrop-blur px-2 py-3 flex flex-col items-center gap-1.5"
                style={{ animationDelay: `${i * 1.1}s` }}
              >
                <s.icon className="h-5 w-5 text-primary" aria-hidden="true" />
                <span className="text-[11px] font-medium text-muted-foreground leading-tight text-center">{s.label}</span>
              </div>
            ))}
          </div>
        </div>

      <Card className="w-full shadow-lg">
        <CardHeader className="text-center">
          <div className="mx-auto h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
            <UserPlus size={28} />
          </div>
          <CardTitle className="text-2xl">{isWalkIn ? "Join a policy" : "Register for a policy"}</CardTitle>
          <CardDescription>
            {isWalkIn
              ? `${options.orgName || "Register"} — Enter your details to get a policy number and activation code.`
              : <>Referred by <strong>{options.agentName}</strong>. Enter your details to get a policy number and activation code.</>
            }
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <Label htmlFor="phone">Phone *</Label>
              <Input
                id="phone"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="e.g. 0771234567"
                data-testid="input-phone"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="dateOfBirth">Date of birth *</Label>
                <Input
                  id="dateOfBirth"
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))}
                  data-testid="input-dob"
                />
              </div>
              <div>
                <Label htmlFor="nationalId">National ID *</Label>
                <Input
                  id="nationalId"
                  value={form.nationalId}
                  onChange={(e) => setForm((f) => ({ ...f, nationalId: e.target.value }))}
                  data-testid="input-national-id"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="gender">Gender *</Label>
              <select
                id="gender"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.gender}
                onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}
                required
                data-testid="select-gender"
              >
                <option value="">Select gender</option>
                <option value="MALE">Male</option>
                <option value="FEMALE">Female</option>
              </select>
            </div>
            <div>
              <Label htmlFor="form-product-id">Product *</Label>
              <select id="form-product-id"
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
                    const premium = pickPremium(v);
                    setForm((f) => ({
                      ...f,
                      productVersionId: e.target.value,
                      premiumAmount: premium.amount,
                      premiumCurrency: premium.currency,
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
                      {([["USD", v.premiumMonthlyUsd], ["ZAR", v.premiumMonthlyZar], ["ZIG", v.premiumMonthlyZig]] as const)
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
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" aria-label="Remove dependent" onClick={() => {
                    setDependentsList((prev) => prev.filter((_, idx) => idx !== i));
                    if (beneficiary.fromDependentIndex === i) setBeneficiary({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null });
                  }}>
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {showDepForm && (
                <div className="p-3 border rounded-md bg-muted/20 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">First Name *</Label>
                      <Input className="h-8 text-sm" value={depDraft.firstName} onChange={(e) => setDepDraft({ ...depDraft, firstName: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="dep-draft-last-name">Last Name *</Label>
                      <Input id="dep-draft-last-name" className="h-8 text-sm" value={depDraft.lastName} onChange={(e) => setDepDraft({ ...depDraft, lastName: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="dep-draft-relationship">Relationship *</Label>
                    <select id="dep-draft-relationship" className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" value={depDraft.relationship} onChange={(e) => setDepDraft({ ...depDraft, relationship: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="parent">Parent</option>
                      <option value="sibling">Sibling</option>
                      <option value="extended">Extended Family</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs" htmlFor="dep-draft-date-of-birth">Date of Birth</Label>
                      <Input id="dep-draft-date-of-birth" className="h-8 text-sm" type="date" value={depDraft.dateOfBirth} onChange={(e) => setDepDraft({ ...depDraft, dateOfBirth: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="dep-draft-national-id">National ID</Label>
                      <Input id="dep-draft-national-id" className="h-8 text-sm" value={depDraft.nationalId} onChange={(e) => setDepDraft({ ...depDraft, nationalId: e.target.value })} />
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
                  <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-destructive" aria-label="Remove beneficiary" onClick={() => setBeneficiary({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "", fromDependentIndex: null })}>
                    <Trash2 className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              ) : !showBenForm ? (
                <Button type="button" size="sm" variant="outline" className="gap-1 h-7 text-xs" onClick={() => setShowBenForm(true)}>
                  <Plus className="h-3 w-3" /> Enter beneficiary details
                </Button>
              ) : (
                <div className="p-3 border rounded-md bg-muted/20 space-y-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs" htmlFor="beneficiary-first-name">First Name *</Label>
                      <Input id="beneficiary-first-name" className="h-8 text-sm" value={beneficiary.firstName} onChange={(e) => setBeneficiary({ ...beneficiary, firstName: e.target.value, fromDependentIndex: null })} />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="beneficiary-last-name">Last Name *</Label>
                      <Input id="beneficiary-last-name" className="h-8 text-sm" value={beneficiary.lastName} onChange={(e) => setBeneficiary({ ...beneficiary, lastName: e.target.value, fromDependentIndex: null })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs" htmlFor="beneficiary-relationship">Relationship</Label>
                    <select id="beneficiary-relationship" className="flex h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm" value={beneficiary.relationship} onChange={(e) => setBeneficiary({ ...beneficiary, relationship: e.target.value })}>
                      <option value="">Select...</option>
                      <option value="spouse">Spouse</option>
                      <option value="child">Child</option>
                      <option value="parent">Parent</option>
                      <option value="sibling">Sibling</option>
                      <option value="extended">Extended Family</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs" htmlFor="beneficiary-national-id">National ID</Label>
                      <Input id="beneficiary-national-id" className="h-8 text-sm" value={beneficiary.nationalId} onChange={(e) => setBeneficiary({ ...beneficiary, nationalId: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs" htmlFor="beneficiary-phone">Phone</Label>
                      <Input id="beneficiary-phone" className="h-8 text-sm" value={beneficiary.phone} onChange={(e) => setBeneficiary({ ...beneficiary, phone: e.target.value })} />
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
                <Label htmlFor="form-branch-id">Branch (optional)</Label>
                <select id="form-branch-id"
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

      <style>{`
        @keyframes registerHeroStepPulse {
          0%, 76%, 100% { box-shadow: none; border-color: hsl(var(--border)); transform: scale(1); }
          8%, 25% { box-shadow: 0 0 0 3px hsl(var(--primary) / 0.2); border-color: hsl(var(--primary) / 0.6); transform: scale(1.04); }
        }
        .register-hero-step { animation: registerHeroStepPulse 3.3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .register-hero-step { animation: none; }
        }
      `}</style>
    </AppChrome>
  );
}
