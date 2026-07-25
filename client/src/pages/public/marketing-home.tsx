import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppChrome, APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { cn } from "@/lib/utils";
import { getDefaultLogoUrl, resolveAssetUrl } from "@/lib/assetUrl";
import { getApiBase } from "@/lib/queryClient";
import {
  FileText, Users, CreditCard, ClipboardCheck, UserCircle, Zap, Globe2,
  ShieldCheck, ArrowRight, Building2, Landmark, Sparkles, Cloud, Lock,
  Blocks, MessageCircle, Wifi, ChevronDown, Phone, Mail, MapPin, Check,
} from "lucide-react";

interface PublicPlan {
  id: string; key: string; name: string; description: string | null;
  priceMonthlyUsd: string; modules: string[]; sortOrder: number;
}

// Fixed brand palette (navy + gold), independent of the app's own light/dark theme —
// this page is a public-facing brand surface, not an authenticated app screen.
const NAVY_DARK = "#050e24";
const NAVY = "#0b1f4d";
const NAVY_LIGHT = "#123875";
const NAVY_ACCENT = "#1e4c96";
const GOLD = "#e3b23c";
const GOLD_DARK = "#c99a2e";

const heroBg = "bg-[linear-gradient(135deg,#050e24_0%,#0b1f4d_45%,#163f86_100%)]";
const navyBandBg = "bg-[linear-gradient(180deg,#0b1f4d_0%,#081733_100%)]";
const goldBandBg = "bg-[linear-gradient(120deg,#0b1f4d_0%,#163f86_60%,#8a6a2a_100%)]";

const SOLVES = [
  {
    icon: FileText,
    accent: "blue" as const,
    title: "Policy Management",
    description: "Create, store, and manage policies digitally with real-time tracking across the full lifecycle — draft through active, grace, lapsed, and cancelled.",
  },
  {
    icon: Users,
    accent: "gold" as const,
    title: "Client Management (CRM)",
    description: "A centralized customer database with engagement tracking and full history — every touchpoint in one place.",
  },
  {
    icon: CreditCard,
    accent: "blue" as const,
    title: "Payments Integration",
    description: "PayNow integration with mobile money (EcoCash, OneMoney, Innbucks, Omari) and card payments, plus automated payment requests and instant receipting.",
  },
  {
    icon: ClipboardCheck,
    accent: "gold" as const,
    title: "Claims Processing",
    description: "Digital claims submission with status tracking and SLA deadlines, cutting turnaround time on every case.",
  },
  {
    icon: UserCircle,
    accent: "blue" as const,
    title: "Agent & Team Management",
    description: "Performance dashboards, sales monitoring, and commission tracking for every agent and team.",
  },
  {
    icon: Zap,
    accent: "gold" as const,
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

function IconBadge({ icon: Icon, accent, dark }: { icon: typeof FileText; accent: "blue" | "gold"; dark?: boolean }) {
  const bg = accent === "gold" ? GOLD : NAVY_ACCENT;
  const iconColor = accent === "gold" ? NAVY_DARK : "#fff";
  return (
    <div
      className="h-12 w-12 rounded-full flex items-center justify-center mb-4 shrink-0"
      style={{ backgroundColor: dark ? "rgba(255,255,255,0.12)" : bg }}
    >
      <Icon size={22} color={dark ? "#fff" : iconColor} />
    </div>
  );
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
    <AppChrome center={false} mainClassName="flex flex-col flex-1 p-0">
      {/* ── Hero — navy gradient ─────────────────────────────── */}
      <section className={cn(heroBg, "w-full text-white relative overflow-hidden")}>
        <div
          aria-hidden
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, #fff 0, transparent 40%), radial-gradient(circle at 85% 60%, #fff 0, transparent 35%)",
          }}
        />
        <div className={cn(APP_SHELL_MAX, "relative px-4 py-16 sm:py-24 flex flex-col items-center text-center")}>
          <img
            src={resolveAssetUrl(getDefaultLogoUrl())}
            alt="POL263"
            className="h-16 sm:h-20 w-auto max-w-[min(360px,90vw)] mb-6 object-contain object-center mix-blend-screen"
            fetchPriority="high"
          />
          <span
            className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide uppercase mb-5"
            style={{ backgroundColor: GOLD, color: NAVY_DARK }}
          >
            Built in Zimbabwe · For Africa
          </span>
          <h1 className="text-3xl sm:text-5xl font-display font-bold max-w-3xl leading-tight text-balance">
            The operating system for insurance distribution and management in Africa
          </h1>
          <p className="text-blue-100/90 text-base sm:text-lg mt-5 max-w-2xl">
            Built to scale access, automate operations, and unlock growth — for insurers, funeral
            service providers, brokers, and the agents who sell for them.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-9">
            <Link href="/signup">
              <Button
                size="lg"
                className="text-base font-semibold border-0"
                style={{ backgroundColor: GOLD, color: NAVY_DARK }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = GOLD_DARK)}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = GOLD)}
              >
                Get started <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </Link>
            <button
              type="button"
              onClick={() => setShowOrgLookup((v) => !v)}
              className="text-sm text-blue-100/90 hover:text-white inline-flex items-center gap-1 px-3 py-2"
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
                className="font-mono bg-white/95 text-slate-900 border-0"
              />
              <Button type="submit" disabled={!orgSlug.trim()} data-testid="btn-go-to-org" className="bg-white/15 border border-white/30 text-white hover:bg-white/25">
                Go <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </form>
          )}
        </div>
      </section>

      {/* ── About / Vision / Mission — white section ────────── */}
      <section className="w-full bg-white">
        <div className={cn(APP_SHELL_MAX, "px-4 py-16 sm:py-20 grid md:grid-cols-2 gap-10 items-start")}>
          <div>
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4" style={{ color: NAVY }}>About POL263</h2>
            <p className="text-slate-600 leading-relaxed">
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
            <div className="rounded-2xl p-6 text-white" style={{ backgroundColor: NAVY }}>
              <h3 className="font-display font-semibold text-base mb-2" style={{ color: GOLD }}>Vision</h3>
              <p className="text-sm text-blue-100/90 leading-relaxed">
                To become Africa's leading digital infrastructure for insurance access,
                management, and distribution.
              </p>
            </div>
            <div className="rounded-2xl p-6 text-white" style={{ backgroundColor: NAVY_LIGHT }}>
              <h3 className="font-display font-semibold text-base mb-2" style={{ color: GOLD }}>Mission</h3>
              <p className="text-sm text-blue-100/90 leading-relaxed">
                To empower individuals, insurance providers, and agents through a smart,
                scalable platform that simplifies policy management, enhances service delivery,
                and drives insurance penetration across underserved markets.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── What POL263 Solves — navy band ──────────────────── */}
      <section className={cn(navyBandBg, "w-full text-white")}>
        <div className={cn(APP_SHELL_MAX, "px-4 py-16 sm:py-20")}>
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-3 text-center">What POL263 Solves</h2>
          <p className="text-blue-100/80 text-center max-w-2xl mx-auto mb-12">
            Insurance in Zimbabwe and similar markets faces fragmented systems, manual
            paper-based processes, delayed claims and payment tracking, and low trust from a
            lack of transparency. POL263 addresses this through automation, digitization, and
            intelligent integration.
          </p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {SOLVES.map((s) => (
              <div key={s.title} className="h-full rounded-2xl p-6 bg-white/[0.06] border border-white/10">
                <IconBadge icon={s.icon} accent={s.accent} />
                <h3 className="text-lg font-display font-semibold mb-1.5">{s.title}</h3>
                <p className="text-sm text-blue-100/80 leading-relaxed">{s.description}</p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid md:grid-cols-2 gap-6">
            <div className="rounded-2xl p-6 bg-white/[0.06] border border-white/10">
              <h3 className="text-base font-display font-semibold flex items-center gap-2 mb-4">
                <Sparkles className="h-4 w-4" style={{ color: GOLD }} /> Also built in
              </h3>
              <div className="flex flex-wrap gap-2">
                {ALSO_BUILT_IN.map((item) => (
                  <span key={item} className="text-xs font-medium rounded-full px-3 py-1 bg-white/10 text-blue-50 border border-white/10">
                    {item}
                  </span>
                ))}
              </div>
            </div>
            <div className="rounded-2xl p-6 bg-white/[0.06] border border-white/10">
              <h3 className="text-base font-display font-semibold flex items-center gap-2 mb-4">
                <Wifi className="h-4 w-4" style={{ color: GOLD }} /> Omnichannel access
              </h3>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span>Web platform</span>
                  <span className="text-xs font-semibold rounded-full px-2.5 py-0.5" style={{ backgroundColor: GOLD, color: NAVY_DARK }}>Live</span>
                </div>
                <div className="flex items-center justify-between text-blue-100/70">
                  <span className="inline-flex items-center gap-1.5"><MessageCircle className="h-3.5 w-3.5" /> WhatsApp chatbot</span>
                  <span className="text-xs font-medium rounded-full px-2.5 py-0.5 border border-white/25">Planned</span>
                </div>
                <div className="flex items-center justify-between text-blue-100/70">
                  <span>USSD (low-data environments)</span>
                  <span className="text-xs font-medium rounded-full px-2.5 py-0.5 border border-white/25">Planned</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Target Market — white section ───────────────────── */}
      <section className="w-full bg-white">
        <div className={cn(APP_SHELL_MAX, "px-4 py-16 sm:py-20 grid md:grid-cols-2 gap-6")}>
          <div className="rounded-2xl p-6 border-2" style={{ borderColor: `${NAVY_ACCENT}22` }}>
            <IconBadge icon={Building2} accent="blue" />
            <h3 className="font-display font-semibold text-lg mb-3" style={{ color: NAVY }}>Primary users</h3>
            <ul className="text-sm text-slate-600 space-y-2">
              {["Insurance companies", "Funeral service providers", "Insurance brokers", "Sales agents and teams"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0" style={{ color: NAVY_ACCENT }} /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl p-6 border-2" style={{ borderColor: `${GOLD}33` }}>
            <IconBadge icon={Globe2} accent="gold" />
            <h3 className="font-display font-semibold text-lg mb-3" style={{ color: NAVY }}>Secondary users</h3>
            <ul className="text-sm text-slate-600 space-y-2">
              {["Individuals and families", "Diaspora clients managing policies remotely"].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <Check className="h-4 w-4 shrink-0" style={{ color: GOLD_DARK }} /> {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Value proposition — gold/navy banner ────────────── */}
      <section className={cn(goldBandBg, "w-full text-white")}>
        <div className={cn(APP_SHELL_MAX, "px-4 py-16 sm:py-20 text-center max-w-3xl mx-auto")}>
          <h2 className="text-2xl sm:text-3xl font-display font-bold mb-4">
            Not just software — <span style={{ color: GOLD }}>insurance infrastructure</span>
          </h2>
          <p className="text-blue-50/90 leading-relaxed">
            Built for African market realities — low bandwidth, mobile-first — combining CRM,
            payments, and policy management in one system. Designed for scale across multiple
            insurance products, with real-time visibility for providers and clients alike, and
            distribution support through agents, networks, and diaspora channels.
          </p>
        </div>
      </section>

      {/* ── Pricing teaser — white section ──────────────────── */}
      {plans.length > 0 && (
        <section className="w-full bg-white">
          <div className={cn(APP_SHELL_MAX, "px-4 py-16 sm:py-20")}>
            <h2 className="text-2xl sm:text-3xl font-display font-bold mb-2 text-center" style={{ color: NAVY }}>Plans</h2>
            <p className="text-slate-500 text-center mb-10">Start free, upgrade as you grow.</p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 max-w-4xl mx-auto">
              {plans.map((p, i) => (
                <div
                  key={p.id}
                  className="rounded-2xl border-2 flex flex-col overflow-hidden bg-white"
                  style={{ borderColor: i === 1 ? GOLD : "#e2e8f0" }}
                >
                  <div className="h-1.5 w-full" style={{ backgroundColor: i === 1 ? GOLD : NAVY_ACCENT }} />
                  <div className="p-6 flex flex-col flex-1">
                    <div className="flex items-baseline justify-between gap-2 mb-1.5">
                      <h3 className="font-display font-semibold text-lg" style={{ color: NAVY }}>{p.name}</h3>
                      <span className="font-mono text-base font-semibold" style={{ color: NAVY }}>
                        ${parseFloat(p.priceMonthlyUsd).toFixed(0)}<span className="text-slate-400 font-normal text-sm">/mo</span>
                      </span>
                    </div>
                    {p.description && <p className="text-sm text-slate-500 mb-4">{p.description}</p>}
                    {p.modules.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
                        {p.modules.map((m) => (
                          <span key={m} className="text-xs font-medium rounded-full px-2.5 py-0.5 border border-slate-200 text-slate-600 bg-slate-50">
                            {moduleLabel(m)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-center mt-10">
              <Link href="/signup">
                <Button size="lg" className="font-semibold border-0" style={{ backgroundColor: NAVY, color: "#fff" }}>
                  Choose a plan <ArrowRight className="h-4 w-4 ml-1.5" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ── Technology & trust — light band ─────────────────── */}
      <section className="w-full" style={{ backgroundColor: "#f3f6fb" }}>
        <div className={cn(APP_SHELL_MAX, "px-4 py-14 grid sm:grid-cols-3 gap-5")}>
          {[
            { icon: Cloud, title: "Cloud-hosted", body: "Scalable infrastructure, built to grow with your book of business." },
            { icon: Lock, title: "Secure by design", body: "Role-based access control and audited authentication throughout." },
            { icon: Blocks, title: "Modular", body: "Designed for continuous expansion across insurance products." },
          ].map((t) => (
            <div key={t.title} className="rounded-2xl bg-white p-6 flex flex-col items-center text-center gap-2 shadow-sm">
              <t.icon className="h-7 w-7" style={{ color: NAVY_ACCENT }} />
              <p className="font-display font-semibold text-sm" style={{ color: NAVY }}>{t.title}</p>
              <p className="text-xs text-slate-500">{t.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Contact — navy footer band ──────────────────────── */}
      <section className="w-full text-white" style={{ backgroundColor: NAVY_DARK }}>
        <div className={cn(APP_SHELL_MAX, "px-4 py-14")}>
          <div className="grid sm:grid-cols-2 gap-8 items-start">
            <div>
              <h2 className="text-xl font-display font-bold mb-2 flex items-center gap-2">
                <Landmark className="h-5 w-5" style={{ color: GOLD }} /> Get in touch
              </h2>
              <p className="text-sm text-blue-100/70 flex items-start gap-2">
                <MapPin className="h-4 w-4 mt-0.5 shrink-0" style={{ color: GOLD }} />
                Office 12, 3rd Floor, Mership House, Bulawayo, Zimbabwe
              </p>
            </div>
            <div className="text-sm space-y-2 sm:text-right text-blue-100/80">
              <p className="flex items-center gap-2 sm:justify-end">
                <Phone className="h-3.5 w-3.5" style={{ color: GOLD }} />
                <a href="tel:+263773665350" className="hover:text-white">+263 77 366 5350</a>
              </p>
              <p className="flex items-center gap-2 sm:justify-end">
                <MessageCircle className="h-3.5 w-3.5" style={{ color: GOLD }} />
                <a href="https://wa.me/263712171267" className="hover:text-white" target="_blank" rel="noreferrer">WhatsApp: +263 71 217 1267</a>
              </p>
              <p className="flex items-center gap-2 sm:justify-end">
                <Mail className="h-3.5 w-3.5" style={{ color: GOLD }} />
                <a href="mailto:info@pol263.com" className="hover:text-white">info@pol263.com</a>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-blue-100/50 mt-8 pt-6 border-t border-white/10">
            <ShieldCheck className="h-4 w-4" />
            <span>Platform team? <Link href="/staff/login" className="underline hover:text-white">Sign in here</Link></span>
          </div>
        </div>
      </section>
    </AppChrome>
  );
}
