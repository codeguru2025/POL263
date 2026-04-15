import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface KpiStatCardProps {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  className?: string;
}

export function KpiStatCard({ label, value, hint, icon: Icon, className }: KpiStatCardProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border/70 bg-card p-5 shadow-sm",
        "flex flex-col gap-2 min-h-[108px]",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {Icon ? <Icon className="h-4 w-4 text-primary/80 shrink-0" aria-hidden /> : null}
      </div>
      <p className="text-2xl sm:text-3xl font-semibold tabular-nums tracking-tight text-foreground">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground leading-snug">{hint}</p> : null}
    </div>
  );
}
