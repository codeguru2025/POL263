import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDot,
  Clock,
  Ban,
  XCircle,
  AlertTriangle,
  Loader2,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export type PolicyStatusKey = "inactive" | "active" | "grace" | "lapsed" | "cancelled" | "removed" | string;

const POLICY: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  inactive: { label: "Inactive", className: "bg-sky-500/12 text-sky-800 border-sky-200/80 dark:text-sky-200", Icon: CircleDot },
  active: { label: "Active", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80 dark:text-emerald-200", Icon: CheckCircle2 },
  grace: { label: "Grace", className: "bg-amber-500/12 text-amber-900 border-amber-200/80 dark:text-amber-100", Icon: Clock },
  lapsed: { label: "Lapsed", className: "bg-rose-500/12 text-rose-900 border-rose-200/80 dark:text-rose-100", Icon: XCircle },
  cancelled: { label: "Cancelled", className: "bg-slate-500/12 text-slate-800 border-slate-200/70 dark:text-slate-200", Icon: Ban },
  removed: { label: "Removed", className: "bg-slate-500/12 text-slate-700 border-slate-200/70 dark:text-slate-300", Icon: Ban },
};

const PAYMENT: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  cleared: { label: "Cleared", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80", Icon: CheckCircle2 },
  pending: { label: "Pending", className: "bg-amber-500/12 text-amber-900 border-amber-200/80", Icon: Loader2 },
  reversed: { label: "Reversed", className: "bg-slate-500/12 text-slate-800 border-slate-200/70", Icon: Ban },
  failed: { label: "Failed", className: "bg-rose-500/12 text-rose-900 border-rose-200/80", Icon: AlertTriangle },
};

const RECEIPT: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  paid: { label: "Paid", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80", Icon: Wallet },
  pending: { label: "Pending", className: "bg-amber-500/12 text-amber-900 border-amber-200/80", Icon: Clock },
};

/** Claim / workflow statuses (staff claims register) */
const CLAIM: Record<string, { label: string; className: string; Icon: LucideIcon }> = {
  submitted: { label: "Submitted", className: "bg-sky-500/12 text-sky-900 border-sky-200/80 dark:text-sky-100", Icon: CircleDot },
  verified: { label: "Verified", className: "bg-amber-500/12 text-amber-900 border-amber-200/80 dark:text-amber-100", Icon: Clock },
  approved: { label: "Approved", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80 dark:text-emerald-100", Icon: CheckCircle2 },
  scheduled: { label: "Scheduled", className: "bg-amber-500/12 text-amber-900 border-amber-200/80", Icon: Clock },
  payable: { label: "Payable", className: "bg-amber-500/12 text-amber-900 border-amber-200/80", Icon: Wallet },
  completed: { label: "Completed", className: "bg-amber-500/12 text-amber-900 border-amber-200/80", Icon: CheckCircle2 },
  paid: { label: "Paid", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80", Icon: CheckCircle2 },
  closed: { label: "Closed", className: "bg-emerald-500/12 text-emerald-800 border-emerald-200/80", Icon: CheckCircle2 },
  rejected: { label: "Rejected", className: "bg-rose-500/12 text-rose-900 border-rose-200/80", Icon: XCircle },
};

export type StatusBadgeVariant = "policy" | "payment" | "receipt" | "claim";

export interface StatusBadgeProps {
  status: string;
  variant?: StatusBadgeVariant;
  label?: string;
  className?: string;
}

export function StatusBadge({ status, variant = "policy", label, className }: StatusBadgeProps) {
  const key = (status || "").toLowerCase();
  const map =
    variant === "payment" ? PAYMENT : variant === "receipt" ? RECEIPT : variant === "claim" ? CLAIM : POLICY;
  const cfg = map[key] ?? {
    label: label || status || "—",
    className: "bg-muted text-muted-foreground border-border",
    Icon: CircleDot,
  };
  const Icon = cfg.Icon;
  const text = label ?? cfg.label;

  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-xs font-medium tabular-nums",
        "focus-within:outline-none",
        cfg.className,
        className,
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", key === "pending" && variant === "payment" && "animate-spin")} aria-hidden />
      <span>{text}</span>
    </span>
  );
}
