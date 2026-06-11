import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { isAgentScoped } from "@shared/roles";
import { CardSection, KpiStatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import {
  Receipt, Wallet2, Target, FileStack, FileText, ShieldCheck, AlertTriangle,
  Plus, ArrowRight, TrendingUp, Truck,
} from "lucide-react";

/**
 * Role-based command center shown on Home (behind the `commandCenters` flag).
 * Answers "what needs my attention now?" with primary actions + work-queue
 * widgets. Every query reads an EXISTING endpoint and is permission-gated.
 */
export function CommandCenter() {
  const [, setLocation] = useLocation();
  const { user, roles, permissions } = useAuth();
  const isAgent = isAgentScoped(roles);
  const has = (p: string) => permissions.includes(p);

  const canFinance = has("read:finance") || has("read:commission");
  const canApprovals = has("manage:approvals");
  const canClaims = has("read:claim");
  const canLeads = has("read:lead");
  const canFuneral = has("read:funeral_ops");
  const canCommission = has("read:commission");

  // ── Work-queue data (small, gated, fault-tolerant) ──
  const { data: approvals } = useQuery<any[]>({ queryKey: ["/api/approvals"], enabled: canApprovals, staleTime: 60_000 });
  const { data: unallocated } = useQuery<any[]>({ queryKey: ["/api/diagnostics/unallocated-payments"], enabled: has("read:finance"), staleTime: 60_000 });
  const { data: requisitions } = useQuery<any[]>({ queryKey: ["/api/requisitions"], enabled: has("read:finance"), staleTime: 60_000 });
  const { data: claims } = useQuery<any[]>({ queryKey: ["/api/claims"], enabled: canClaims, staleTime: 60_000 });
  const { data: leads } = useQuery<any[]>({ queryKey: ["/api/leads"], enabled: canLeads, staleTime: 60_000 });
  const { data: funerals } = useQuery<any[]>({ queryKey: ["/api/funeral-cases"], enabled: canFuneral, staleTime: 60_000 });

  const arr = (x: any): any[] => (Array.isArray(x) ? x : []);
  const submittedReqs = arr(requisitions).filter((r) => r?.status === "submitted").length;
  const openClaims = arr(claims).filter((c) => !["closed", "paid", "rejected", "completed"].includes(c?.status)).length;
  const reviewClaims = arr(claims).filter((c) => c?.status === "submitted" || c?.status === "verified").length;
  const openPipeline = arr(leads).filter((l) => !["lost", "activated"].includes(l?.stage)).length;
  const activeFunerals = arr(funerals).filter((f) => f?.status !== "closed" && f?.status !== "completed").length;
  const pendingApprovals = arr(approvals).length;
  const unallocatedCount = arr(unallocated).length;

  // ── Primary actions per role ──
  type Action = { label: string; icon: typeof Receipt; href: string; show: boolean };
  const actions: Action[] = [
    { label: "Receipt a Payment", icon: Receipt, href: "/staff/finance?tab=payments", show: has("write:finance") || has("receipt:cash") || has("receipt:mobile") || has("receipt:transfer") },
    { label: "New Lead", icon: Target, href: "/staff/leads?create=1", show: has("write:lead") },
    { label: "New Policy", icon: FileStack, href: "/staff/policies?create=1", show: has("write:policy") },
    { label: "New Claim", icon: FileText, href: "/staff/claims?create=1", show: has("write:claim") },
    { label: "Cash-up", icon: Wallet2, href: "/staff/finance?tab=cashups", show: canFinance },
    { label: "Approvals", icon: ShieldCheck, href: "/staff/approvals", show: canApprovals },
  ].filter((a) => a.show).slice(0, 4);

  // ── Widgets per role ──
  type Widget = { label: string; value: number; icon: typeof Receipt; href: string; tone?: string; show: boolean };
  const widgets: Widget[] = [
    { label: "Pending Approvals", value: pendingApprovals, icon: ShieldCheck, href: "/staff/approvals", tone: pendingApprovals > 0 ? "alert" : undefined, show: canApprovals },
    { label: "Requisitions to Approve", value: submittedReqs, icon: ShieldCheck, href: "/staff/finance?tab=requisitions", tone: submittedReqs > 0 ? "alert" : undefined, show: has("read:finance") },
    { label: "Unallocated Payments", value: unallocatedCount, icon: AlertTriangle, href: "/staff/diagnostics", tone: unallocatedCount > 0 ? "alert" : undefined, show: has("read:finance") },
    { label: "Claims to Review", value: reviewClaims, icon: FileText, href: "/staff/claims", tone: reviewClaims > 0 ? "alert" : undefined, show: canClaims },
    { label: "Open Claims", value: openClaims, icon: FileText, href: "/staff/claims", tone: undefined, show: canClaims },
    { label: "Active Funeral Cases", value: activeFunerals, icon: Truck, href: "/staff/funerals", tone: undefined, show: canFuneral },
    { label: isAgent ? "My Pipeline" : "Open Pipeline", value: openPipeline, icon: TrendingUp, href: "/staff/leads", tone: undefined, show: canLeads },
  ].filter((w) => w.show).slice(0, 6);

  const firstName = (user?.displayName || user?.email || "").split(/[@\s]/)[0];

  return (
    <div className="space-y-4">
      {actions.length > 0 && (
        <CardSection title={`Welcome${firstName ? `, ${firstName}` : ""} — what needs you now`} icon={Plus} contentClassName="pt-2">
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
            {actions.map((a) => (
              <Button
                key={a.label}
                variant="outline"
                className="h-auto py-4 flex-col gap-2 items-start text-left"
                onClick={() => setLocation(a.href)}
                data-testid={`cc-action-${a.label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <a.icon className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium leading-tight">{a.label}</span>
              </Button>
            ))}
          </div>
        </CardSection>
      )}

      {widgets.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {widgets.map((w) => (
            <button key={w.label} type="button" onClick={() => setLocation(w.href)} className="text-left">
              <KpiStatCard
                className={w.tone === "alert" ? "border-destructive/40 hover:border-destructive shadow-sm" : "hover:shadow-md transition-shadow"}
                label={w.label}
                icon={w.icon}
                value={<span className={w.tone === "alert" ? "text-destructive font-display" : "font-display"}>{w.value}</span>}
                hint={<span className="inline-flex items-center gap-1 text-xs">Open <ArrowRight className="h-3 w-3" /></span>}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
