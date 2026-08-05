import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, CheckCircle2, Receipt, Check, ArrowLeft, Copy, Clock, Building2, Sparkles, Rocket } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import {
  ORG_TYPES, ORG_TYPE_LABELS, PRODUCT_TYPES, PRODUCT_TYPE_LABELS,
  DISTRIBUTION_CHANNELS, DISTRIBUTION_CHANNEL_LABELS,
} from "@shared/org-profile";

interface PublicPlan {
  id: string; key: string; name: string; description: string | null;
  priceMonthlyUsd: string; modules: string[]; sortOrder: number;
}

const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

function moduleLabel(m: string): string {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TenantSignup() {
  const [step, setStep] = useState(1);

  // Step 1 — business questions
  const [businessName, setBusinessName] = useState("");
  const [orgType, setOrgType] = useState("");
  const [productTypes, setProductTypes] = useState<string[]>([]);
  const [distributionChannels, setDistributionChannels] = useState<string[]>([]);
  const [bookStatus, setBookStatus] = useState("");
  const [bookSizeCurrent, setBookSizeCurrent] = useState("");
  const [bookSizeProjected12mo, setBookSizeProjected12mo] = useState("");
  const [staffComplement, setStaffComplement] = useState("");
  const [phone, setPhone] = useState("");
  const [bizEmail, setBizEmail] = useState("");
  const [website, setWebsite] = useState("");

  // Step 2 — plan + billing cycle
  const [planId, setPlanId] = useState("");
  const [billingCycle, setBillingCycle] = useState<"monthly" | "annual">("monthly");

  // Step 3 — admin account
  const [adminDisplayName, setAdminDisplayName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");

  // Step 4 — $1 verification payment
  const [token, setToken] = useState("");
  const [method, setMethod] = useState("ecocash");
  const [payerPhone, setPayerPhone] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [polling, setPolling] = useState(false);
  const [provisioned, setProvisioned] = useState(false);
  const [tenantSlug, setTenantSlug] = useState("");
  const [domainCommissioned, setDomainCommissioned] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileMethods = ["ecocash", "onemoney"];

  const { data: plansData, isLoading: plansLoading } = useQuery<{ plans: PublicPlan[] }>({
    queryKey: ["/api/public/billing/plans"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/public/billing/plans");
      if (!res.ok) throw new Error("Could not load plans");
      return res.json();
    },
    enabled: step === 2,
  });
  const plans = plansData?.plans || [];

  const submitMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/public/tenant-signup", {
        businessName, phone, email: bizEmail, website,
        orgType: orgType || null, productTypes, distributionChannels,
        bookStatus: bookStatus || null,
        bookSizeCurrent: bookSizeCurrent || null,
        bookSizeProjected12mo: bookSizeProjected12mo || null,
        staffComplement: staffComplement || null,
        adminEmail, adminDisplayName, adminPassword,
        planId, billingCycle,
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.message || "Signup failed"); }
      return res.json() as Promise<{ token: string }>;
    },
    onSuccess: (data) => { setToken(data.token); setStep(4); },
  });

  const initiateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/public/tenant-signup/${token}/initiate`, {
        method,
        payerPhone: mobileMethods.includes(method) ? payerPhone : undefined,
        payerEmail: method === "visa_mastercard" ? payerEmail : undefined,
      });
      return res.json() as Promise<{ redirectUrl?: string }>;
    },
    onSuccess: (data) => {
      if (data.redirectUrl) { window.location.href = data.redirectUrl; return; }
      setPolling(true);
    },
  });

  const { data: pollData } = useQuery({
    queryKey: [`/api/public/tenant-signup/${token}/poll`, polling],
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/public/tenant-signup/${token}/poll`);
      return res.json() as Promise<{ status: string; provisioned?: boolean; slug?: string; domainCommissioned?: boolean }>;
    },
    enabled: !!token && polling,
    refetchInterval: 5000,
  });

  useEffect(() => {
    if (pollData?.provisioned) {
      setPolling(false);
      setProvisioned(true);
      if (pollData.slug) setTenantSlug(pollData.slug);
      setDomainCommissioned(!!pollData.domainCommissioned);
    }
  }, [pollData]);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const subdomain = tenantSlug ? `${tenantSlug}.${window.location.hostname}` : "";
  function copySubdomain() {
    if (!subdomain) return;
    navigator.clipboard.writeText(subdomain);
    setCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
  }

  const canInitiate = method === "visa_mastercard" ? payerEmail.trim().length > 3 : payerPhone.trim().length >= 9;
  const selectedPlan = plans.find((p) => p.id === planId);
  const monthlyPrice = selectedPlan ? parseFloat(selectedPlan.priceMonthlyUsd) : 0;
  const annualPrice = monthlyPrice * 12 * 0.8;

  const step1Valid = businessName.trim().length > 0;
  const step2Valid = !!planId;
  const step3Valid = adminDisplayName.trim().length > 0 && /\S+@\S+\.\S+/.test(adminEmail) && adminPassword.length >= 8 && adminPassword === adminPasswordConfirm;

  const signupHeroSteps = [
    { icon: Building2, label: "Tell us about your business" },
    { icon: Sparkles, label: "Pick a plan" },
    { icon: Rocket, label: "Start your trial instantly" },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-b from-teal-50 via-gray-50 to-gray-50 flex items-center justify-center p-4 relative overflow-hidden">
      {/* Decorative ambience — purely visual. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-24 -left-20 h-80 w-80 rounded-full bg-teal-300/25 blur-3xl" />
        <div className="absolute top-1/4 -right-24 h-96 w-96 rounded-full bg-emerald-300/20 blur-3xl" />
        <div className="absolute -bottom-28 left-1/3 h-72 w-72 rounded-full bg-cyan-300/20 blur-3xl" />
      </div>

      <div className="w-full max-w-xl space-y-5 relative">
        {step === 1 && (
          <div className="text-center space-y-3">
            <img
              src="/assets/signup-business-owner.jpg"
              alt="A small business owner running her book on POL263"
              className="mx-auto h-28 w-28 sm:h-32 sm:w-32 rounded-full object-cover shadow-lg ring-4 ring-white"
            />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-200 bg-white/80 backdrop-blur px-3 py-1 text-xs font-medium text-teal-800">
              <Clock className="h-3.5 w-3.5" /> 14-day free trial — no charge until it ends
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900">
              Run your book on POL263 in minutes
            </h1>
            {/* Animated "how it works" strip — stands in for a walkthrough video: each step
                highlights in sequence on a loop so the flow is legible at a glance. */}
            <div className="grid grid-cols-3 gap-2 sm:gap-3 pt-1">
              {signupHeroSteps.map((s, i) => (
                <div
                  key={s.label}
                  className="signup-hero-step rounded-xl border border-gray-200 bg-white/70 backdrop-blur px-2 py-3 flex flex-col items-center gap-1.5"
                  style={{ animationDelay: `${i * 1.1}s` }}
                >
                  <s.icon className="h-5 w-5 text-teal-700" aria-hidden="true" />
                  <span className="text-[11px] font-medium text-gray-600 leading-tight text-center">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="bg-teal-700 px-6 py-5 text-white">
          <p className="text-xs font-semibold uppercase tracking-widest opacity-80">Start your free trial</p>
          <p className="text-lg font-bold mt-0.5">POL263</p>
        </div>

        <div className="px-6 py-8">
          {step === 1 && (
            <div className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="ts-name">Business name</Label>
                <Input id="ts-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="Acme Funeral Services" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-org-type">Organisation type</Label>
                <Select value={orgType} onValueChange={setOrgType}>
                  <SelectTrigger id="ts-org-type"><SelectValue placeholder="Select organisation type…" /></SelectTrigger>
                  <SelectContent>
                    {ORG_TYPES.map((t) => <SelectItem key={t} value={t}>{ORG_TYPE_LABELS[t]}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Product types sold</Label>
                <div className="flex flex-wrap gap-2">
                  {PRODUCT_TYPES.map((t) => {
                    const selected = productTypes.includes(t);
                    return (
                      <Badge key={t} variant={selected ? "default" : "outline"}
                        className={`cursor-pointer select-none ${selected ? "" : "opacity-60 hover:opacity-100"}`}
                        onClick={() => setProductTypes((p) => toggle(p, t))}>
                        {selected ? <Check className="mr-1 h-3 w-3" /> : null}
                        {PRODUCT_TYPE_LABELS[t]}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-2">
                <Label>Distribution channels</Label>
                <div className="flex flex-wrap gap-2">
                  {DISTRIBUTION_CHANNELS.map((c) => {
                    const selected = distributionChannels.includes(c);
                    return (
                      <Badge key={c} variant={selected ? "default" : "outline"}
                        className={`cursor-pointer select-none ${selected ? "" : "opacity-60 hover:opacity-100"}`}
                        onClick={() => setDistributionChannels((p) => toggle(p, c))}>
                        {selected ? <Check className="mr-1 h-3 w-3" /> : null}
                        {DISTRIBUTION_CHANNEL_LABELS[c]}
                      </Badge>
                    );
                  })}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ts-book-status">Book status</Label>
                  <Select value={bookStatus} onValueChange={setBookStatus}>
                    <SelectTrigger id="ts-book-status"><SelectValue placeholder="Existing or new?" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="existing">Existing book</SelectItem>
                      <SelectItem value="new">New business</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ts-staff">Staff complement</Label>
                  <Input id="ts-staff" type="number" min={0} value={staffComplement} onChange={(e) => setStaffComplement(e.target.value)} />
                </div>
                {bookStatus === "existing" && (
                  <div className="space-y-2">
                    <Label htmlFor="ts-book-current">Current active policies/members</Label>
                    <Input id="ts-book-current" type="number" min={0} value={bookSizeCurrent} onChange={(e) => setBookSizeCurrent(e.target.value)} />
                  </div>
                )}
                {bookStatus === "new" && (
                  <div className="space-y-2">
                    <Label htmlFor="ts-book-projected">Projected book size (12mo)</Label>
                    <Input id="ts-book-projected" type="number" min={0} value={bookSizeProjected12mo} onChange={(e) => setBookSizeProjected12mo(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ts-phone">Business phone</Label>
                  <Input id="ts-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ts-biz-email">Business email</Label>
                  <Input id="ts-biz-email" type="email" value={bizEmail} onChange={(e) => setBizEmail(e.target.value)} />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-website">Website (optional)</Label>
                <Input id="ts-website" value={website} onChange={(e) => setWebsite(e.target.value)} />
              </div>
              <Button className="w-full" disabled={!step1Valid} onClick={() => setStep(2)}>Continue</Button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700" onClick={() => setStep(1)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              {plansLoading ? (
                <div className="flex flex-col items-center gap-3 text-gray-500 py-6">
                  <Loader2 className="w-8 h-8 animate-spin text-teal-600" />
                  <p className="text-sm">Loading plans…</p>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label>Choose a plan</Label>
                    <div className="space-y-2">
                      {plans.map((p) => (
                        <div key={p.id}
                          className={`rounded-xl border p-4 cursor-pointer ${planId === p.id ? "border-teal-600 ring-1 ring-teal-600" : "border-gray-200"}`}
                          onClick={() => setPlanId(p.id)}>
                          <div className="flex items-center justify-between">
                            <p className="font-semibold">{p.name}</p>
                            <p className="font-mono text-sm">${parseFloat(p.priceMonthlyUsd).toFixed(2)}/mo</p>
                          </div>
                          {p.description && <p className="text-sm text-gray-500 mt-1">{p.description}</p>}
                          {p.modules.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {p.modules.map((m) => <Badge key={m} variant="outline" className="text-xs">{moduleLabel(m)}</Badge>)}
                            </div>
                          )}
                        </div>
                      ))}
                      {plans.length === 0 && <p className="text-sm text-gray-500">No plans available yet — contact us directly.</p>}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Billing cycle</Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        className={`rounded-lg border px-4 py-3 text-left ${billingCycle === "monthly" ? "border-teal-600 ring-1 ring-teal-600" : "border-gray-200"}`}
                        onClick={() => setBillingCycle("monthly")}>
                        <p className="font-semibold text-sm">Monthly</p>
                        <p className="text-xs text-gray-500">{selectedPlan ? `$${monthlyPrice.toFixed(2)}/mo` : "Select a plan"}</p>
                      </button>
                      <button
                        className={`rounded-lg border px-4 py-3 text-left ${billingCycle === "annual" ? "border-teal-600 ring-1 ring-teal-600" : "border-gray-200"}`}
                        onClick={() => setBillingCycle("annual")}>
                        <p className="font-semibold text-sm">Annual <span className="text-emerald-600">(20% off)</span></p>
                        <p className="text-xs text-gray-500">{selectedPlan ? `$${annualPrice.toFixed(2)}/yr` : "Select a plan"}</p>
                      </button>
                    </div>
                  </div>

                  <Button className="w-full" disabled={!step2Valid} onClick={() => setStep(3)}>Continue</Button>
                </>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <button className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700" onClick={() => setStep(2)}>
                <ArrowLeft className="h-3.5 w-3.5" /> Back
              </button>
              <div className="space-y-2">
                <Label htmlFor="ts-admin-name">Your name</Label>
                <Input id="ts-admin-name" value={adminDisplayName} onChange={(e) => setAdminDisplayName(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-admin-email">Your email (this becomes your login)</Label>
                <Input id="ts-admin-email" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-admin-password">Password</Label>
                <Input id="ts-admin-password" type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                <p className="text-xs text-gray-500">At least 8 characters.</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ts-admin-password-confirm">Confirm password</Label>
                <Input id="ts-admin-password-confirm" type="password" value={adminPasswordConfirm} onChange={(e) => setAdminPasswordConfirm(e.target.value)} />
                {adminPasswordConfirm && adminPassword !== adminPasswordConfirm && (
                  <p className="text-xs text-destructive">Passwords don't match.</p>
                )}
              </div>
              {submitMutation.isError && <p className="text-sm text-destructive">{(submitMutation.error as Error).message}</p>}
              <Button className="w-full" disabled={!step3Valid || submitMutation.isPending} onClick={() => submitMutation.mutate()}>
                {submitMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Continue to verification
              </Button>
            </div>
          )}

          {step === 4 && (
            provisioned ? (
              <div className="flex flex-col items-center gap-4 text-center py-6">
                <CheckCircle2 className="w-10 h-10 text-emerald-600" />
                <p className="font-semibold">Your trial is live</p>
                <p className="text-sm text-gray-500">14 days, no further charge until it ends.</p>

                {subdomain && (
                  <div className={`w-full rounded-xl border-2 p-4 text-left space-y-3 ${domainCommissioned ? "border-emerald-400 bg-emerald-50" : "border-amber-400 bg-amber-50"}`}>
                    <div className={`flex items-center gap-2 ${domainCommissioned ? "text-emerald-800" : "text-amber-800"}`}>
                      {domainCommissioned ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <Clock className="h-4 w-4 shrink-0" />}
                      <p className="text-sm font-bold">
                        {domainCommissioned
                          ? "Your workspace is ready right now at this address."
                          : "Your workspace will be live at this address within 24 hours, after we verify your account."}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <input
                        readOnly
                        value={subdomain}
                        className={`flex-1 text-sm bg-white rounded px-2 py-1.5 font-mono truncate border ${domainCommissioned ? "border-emerald-300" : "border-amber-300"}`}
                        data-testid="input-tenant-subdomain"
                        aria-label="Your organisation's address"
                        onClick={(e) => (e.target as HTMLInputElement).select()}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 shrink-0"
                        onClick={copySubdomain}
                        data-testid="button-copy-tenant-subdomain"
                        aria-label={copied ? "Copied to clipboard" : "Copy address"}
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
                      </Button>
                    </div>
                    <p className={`text-xs ${domainCommissioned ? "text-emerald-700" : "text-amber-700"}`}>
                      Save this address — it's how you and your team will reach your dashboard.
                    </p>
                  </div>
                )}

                {domainCommissioned ? (
                  <Button className="mt-2 w-full" onClick={() => { window.location.href = "/staff"; }}>Go to login</Button>
                ) : (
                  <>
                    <Button className="mt-2 w-full" onClick={() => { window.location.href = "/"; }}>Done</Button>
                    <button
                      type="button"
                      className="text-xs text-gray-400 hover:text-gray-600 underline"
                      onClick={() => { window.location.href = "/staff"; }}
                    >
                      Already commissioned and want to try now? Go to login
                    </button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="font-medium">One last step — verify your payment details</p>
                  <p className="text-gray-500">We charge a small $1.00 verification fee to confirm your payment method works. Your 14-day free trial starts the instant it clears.</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ts-method">Payment method</Label>
                  <Select value={method} onValueChange={(v) => { setMethod(v); initiateMutation.reset(); }}>
                    <SelectTrigger id="ts-method"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ecocash">EcoCash</SelectItem>
                      <SelectItem value="onemoney">OneMoney</SelectItem>
                      <SelectItem value="visa_mastercard">Visa / Mastercard</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {mobileMethods.includes(method) && (
                  <div className="space-y-2">
                    <Label htmlFor="ts-phone2">Phone number</Label>
                    <Input id="ts-phone2" value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} placeholder="0771234567" />
                  </div>
                )}
                {method === "visa_mastercard" && (
                  <div className="space-y-2">
                    <Label htmlFor="ts-email2">Email</Label>
                    <Input id="ts-email2" type="email" value={payerEmail} onChange={(e) => setPayerEmail(e.target.value)} />
                  </div>
                )}

                {initiateMutation.isError && <p className="text-sm text-destructive">{(initiateMutation.error as Error).message}</p>}

                {polling ? (
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting for payment confirmation…
                  </div>
                ) : (
                  <Button className="w-full" disabled={!canInitiate || initiateMutation.isPending} onClick={() => initiateMutation.mutate()}>
                    {initiateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Receipt className="h-4 w-4 mr-2" />}
                    {method === "visa_mastercard" ? "Continue to PayNow" : "Send payment prompt"}
                  </Button>
                )}
              </div>
            )
          )}
        </div>
      </div>
      </div>

      <style>{`
        @keyframes signupHeroStepPulse {
          0%, 76%, 100% { box-shadow: none; border-color: rgb(229 231 235); transform: scale(1); }
          8%, 25% { box-shadow: 0 0 0 3px rgb(13 148 136 / 0.2); border-color: rgb(13 148 136 / 0.6); transform: scale(1.04); }
        }
        .signup-hero-step { animation: signupHeroStepPulse 3.3s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .signup-hero-step { animation: none; }
        }
      `}</style>
    </div>
  );
}
