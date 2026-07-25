import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";
import { getDefaultLogoUrl, resolveAssetUrl } from "@/lib/assetUrl";
import { getApiBase } from "@/lib/queryClient";
import {
  FileText, Users, CreditCard, ClipboardCheck, UserCircle, Zap, Globe2,
  ShieldCheck, ArrowRight, Building2, Landmark, Sparkles, Cloud, Lock,
  Blocks, MessageCircle, Wifi, ChevronDown,
} from "lucide-react";

interface PublicPlan {
  id: string; key: string; name: string; description: string | null;
  priceMonthlyUsd: string; modules: string[]; sortOrder: number;
}

const SOLVES = [
  {
    icon: FileText,
    title: "Policy Management",
    description: "Create, store, and manage policies digitally with real-time tracking across the full lifecycle — draft through active, grace, lapsed, and cancelled.",
  },
  {
    icon: Users,
    title: "Client Management (CRM)",
    description: "A centralized customer database with engagement tracking and full history — every touchpoint in one place.",
  },
  {
    icon: CreditCard,
    title: "Payments Integration",
    description: "PayNow integration with mobile money (EcoCash, OneMoney, Innbucks, Omari) and card payments, plus automated payment requests and instant receipting.",
  },
  {
    icon: ClipboardCheck,
    title: "Claims Processing",
    description: "Digital claims submission with status tracking and SLA deadlines, cutting turnaround time on every case.",
  },
  {
    icon: UserCircle,
    title: "Agent & Team Management",
    description: "Performance dashboards, sales monitoring, and commission tracking for every agent and team.",
  },
  {
    icon: Zap,
    title: "Automations",
    description: "Payment reminders, policy alerts, and renewal notifications that fire on their own.",
  },
];

const ALSO_BUILT_IN = [
  "Burial society & cash-club pool management",
  "KYC / document verification",
  "Fleet tracking",
  "Payroll & HR",
  "Full finance suite — cashups, month-end, FX, credit notes, debit orders",
  "Reporting, audit trail & maker-checker approvals",
  "Multi-currency (USD, ZAR, ZIG)",
  "QR member cards",
  "Legacy book onboarding",
  "Per-tenant white-label branding",
];

function moduleLabel(m: string): string {
  return m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function MarketingHome() {
  const [showOrgLookup, setShowOrgLookup] = useState(false);
  const [orgSlug, setOrgSlug] = useState("");

  function goToOrg() {
    const value = orgSlug.trim().toLowerCase();
    if (!value || typeof window === "undefined") return;
    const target = value.includes(".") ? value : `${value}.${window.location.hostname}`;
    window.location.href = `${window.location.protocol}//${target}${window.location.port ? `:${window.location.port}` : ""}`;
  }

  const { data: plansData } = useQuery<{ plans: PublicPlan[] }>({
    queryKey: ["/api/public/billing/plans"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/public/billing/plans");
      if (!res.ok) throw new Error("Could not load plans");
      return res.json();
    },
  });
  const plans = plansData?.plans ?? [];

  return (
    <AppChrome center={false} mainClassName="flex flex-col flex-1">
      <div className={cn(APP_SHELL_MAX, "px-4 py-4 space-y-20")}>

        {/* ── Hero ───────────────────────────────────────────── */}
        <section className="flex flex-col items-center text-center pt-10 pb-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <img
            src={resolveAssetUrl(getDefaultLogoUrl())}
            alt="POL263"
            className="h-16 sm:h-20 w-auto max-w-[min(360px,90vw)] mb-6 object-contain object-center"
            fetchPriority="high"
          />
          <h1 className="text-2xl sm:text-4xl font-display font-bold max-w-3xl leading-tight text-balance">
            The operating system for insurance distribution and management in Africa
          </h1>
          <p className="text-muted-foreground text-base sm:text-lg mt-4 max-w-2xl">
            Built to scale access, automate operations, and unlock growth — for insurers, funeral
            service providers, brokers, and the agents who sell for them.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
            <Link href="/signup">
              <Button size="lg" className="text-base">
                Get started <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => setShowOrgLookup((v) => !v)}
              className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 px-3 py-2"
              data-testid="btn-toggle-org-lookup"
            >
              Existing customer? Enter your organisation <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showOrgLookup && "rotate-180")} />
            </button>
          </div>
          {showOrgLookup && (
            <form
              className="flex gap-2 mt-4 w-full max-w-sm animate-in fade-in slide-in-from-top-2 duration-200"
              onSubmit={(e) => { e.preventDefault(); goToOrg(); }}
            >
              <Input
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                placeholder="yourorg"
                aria-label="Organisation short name"
                data-testid="input-org-slug"
                className="font-mono"
              />
              <Button type="submit" disabled={!orgSlug.trim()} data-testid="btn-go-to-org">
                Go <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </form>
          )}
        </section>

        {/* ── About / Vision / Mission ───────────────────────── */}
        <section className="grid md:grid-cols-2 gap-8 items-start">
          <div>
            <h2 className="text-2xl font-display font-bold mb-3">About POL263</h2>
            <p className="text-muted-foreground leading-relaxed">
              POL263 is a digital insurance policy management platform designed to simplify,
              centralize, and modernize how insurance services are accessed, managed, and
              delivered across Zimbabwe and emerging markets. The platform bridges the gap
              between insurers, agents, and policyholders by providing a seamless,
              technology-driven ecosystem that enhances efficiency, transparency, and customer
              experience — built with a clear focus: to make insurance accessible, trackable,
              and actionable in real-time.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-display">Vision</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                To become Africa's leading digital infrastructure for insurance access,
                management, and distribution.
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-display">Mission</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                To empower individuals, insurance providers, and agents through a smart,
                scalable platform that simplifies policy management, enhances service delivery,
                and drives insurance penetration across underserved markets.
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── What POL263 Solves ─────────────────────────────── */}
        <section>
          <h2 className="text-2xl font-display font-bold mb-2 text-center">What POL263 Solves</h2>
          <p className="text-muted-foreground text-center max-w-2xl mx-auto mb-10">
            Insurance in Zimbabwe and similar markets faces fragmented systems, manual
            paper-based processes, delayed claims and payment tracking, and low trust from a
            lack of transparency. POL263 addresses this through automation, digitization, and
            intelligent integration.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SOLVES.map((s) => (
              <Card key={s.title} className="h-full border-border/60">
                <CardHeader>
                  <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4">
                    <s.icon size={24} />
                  </div>
                  <CardTitle className="text-lg font-display">{s.title}</CardTitle>
                  <CardDescription className="leading-relaxed">{s.description}</CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base font-display flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> Also built in
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {ALSO_BUILT_IN.map((item) => (
                    <Badge key={item} variant="secondary" className="font-normal">{item}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
            <Card className="border-border/60">
              <CardHeader>
                <CardTitle className="text-base font-display flex items-center gap-2">
                  <Wifi className="h-4 w-4 text-primary" /> Omnichannel access
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span>Web platform</span>
                  <Badge variant="default">Live</Badge>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp chatbot</span>
                  <Badge variant="outline">Planned</Badge>
                </div>
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>USSD (low-data environments)</span>
                  <Badge variant="outline">Planned</Badge>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* ── Target Market ──────────────────────────────────── */}
        <section className="grid md:grid-cols-2 gap-6">
          <Card className="border-border/60">
            <CardHeader>
              <div className="h-11 w-11 bg-primary/10 text-primary rounded-lg flex items-center justify-center mb-3">
                <Building2 size={22} />
              </div>
              <CardTitle className="font-display">Primary users</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>Insurance companies</li>
                <li>Funeral service providers</li>
                <li>Insurance brokers</li>
                <li>Sales agents and teams</li>
              </ul>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardHeader>
              <div className="h-11 w-11 bg-primary/10 text-primary rounded-lg flex items-center justify-center mb-3">
                <Globe2 size={22} />
              </div>
              <CardTitle className="font-display">Secondary users</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-sm text-muted-foreground space-y-1.5 list-disc list-inside">
                <li>Individuals and families</li>
                <li>Diaspora clients managing policies remotely</li>
              </ul>
            </CardContent>
          </Card>
        </section>

        {/* ── Value proposition ──────────────────────────────── */}
        <section className="text-center max-w-3xl mx-auto">
          <h2 className="text-2xl font-display font-bold mb-3">Not just software — insurance infrastructure</h2>
          <p className="text-muted-foreground leading-relaxed">
            Built for African market realities — low bandwidth, mobile-first — combining CRM,
            payments, and policy management in one system. Designed for scale across multiple
            insurance products, with real-time visibility for providers and clients alike, and
            distribution support through agents, networks, and diaspora channels.
          </p>
        </section>

        {/* ── Pricing teaser ─────────────────────────────────── */}
        {plans.length > 0 && (
          <section>
            <h2 className="text-2xl font-display font-bold mb-2 text-center">Plans</h2>
            <p className="text-muted-foreground text-center mb-8">Start free, upgrade as you grow.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl mx-auto">
              {plans.map((p) => (
                <Card key={p.id} className="border-border/60 flex flex-col">
                  <CardHeader>
                    <CardTitle className="font-display flex items-baseline justify-between gap-2">
                      <span>{p.name}</span>
                      <span className="font-mono text-base font-normal text-muted-foreground">
                        ${parseFloat(p.priceMonthlyUsd).toFixed(0)}/mo
                      </span>
                    </CardTitle>
                    {p.description && <CardDescription>{p.description}</CardDescription>}
                  </CardHeader>
                  {p.modules.length > 0 && (
                    <CardContent className="pt-0 mt-auto">
                      <div className="flex flex-wrap gap-1.5">
                        {p.modules.map((m) => (
                          <Badge key={m} variant="outline" className="text-xs font-normal">{moduleLabel(m)}</Badge>
                        ))}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
            <div className="flex justify-center mt-8">
              <Link href="/signup">
                <Button size="lg">Choose a plan <ArrowRight className="h-4 w-4 ml-1.5" /></Button>
              </Link>
            </div>
          </section>
        )}

        {/* ── Technology & trust ─────────────────────────────── */}
        <section className="grid sm:grid-cols-3 gap-5">
          <Card className="border-border/60">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
              <Cloud className="h-7 w-7 text-primary" />
              <p className="font-medium text-sm">Cloud-hosted</p>
              <p className="text-xs text-muted-foreground">Scalable infrastructure, built to grow with your book of business.</p>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
              <Lock className="h-7 w-7 text-primary" />
              <p className="font-medium text-sm">Secure by design</p>
              <p className="text-xs text-muted-foreground">Role-based access control and audited authentication throughout.</p>
            </CardContent>
          </Card>
          <Card className="border-border/60">
            <CardContent className="pt-6 flex flex-col items-center text-center gap-2">
              <Blocks className="h-7 w-7 text-primary" />
              <p className="font-medium text-sm">Modular</p>
              <p className="text-xs text-muted-foreground">Designed for continuous expansion across insurance products.</p>
            </CardContent>
          </Card>
        </section>

        {/* ── Contact ─────────────────────────────────────────── */}
        <section className="border-t border-border/60 pt-10 pb-6">
          <div className="grid sm:grid-cols-2 gap-6 items-start">
            <div>
              <h2 className="text-xl font-display font-bold mb-2 flex items-center gap-2">
                <Landmark className="h-5 w-5 text-primary" /> Get in touch
              </h2>
              <p className="text-sm text-muted-foreground">
                Office 12, 3rd Floor, Mership House, Bulawayo, Zimbabwe
              </p>
            </div>
            <div className="text-sm space-y-1.5 sm:text-right">
              <p><a href="tel:+263773665350" className="hover:text-primary">+263 77 366 5350</a></p>
              <p><a href="https://wa.me/263712171267" className="hover:text-primary" target="_blank" rel="noreferrer">WhatsApp: +263 71 217 1267</a></p>
              <p><a href="mailto:info@pol263.com" className="hover:text-primary">info@pol263.com</a></p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-8">
            <ShieldCheck className="h-4 w-4" />
            <span>Platform team? <Link href="/staff/login" className="underline hover:text-foreground">Sign in here</Link></span>
          </div>
        </section>
      </div>
    </AppChrome>
  );
}
