import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
  dataTestId?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className, dataTestId }: EmptyStateProps) {
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "flex flex-col items-center justify-center text-center px-6 py-14 rounded-xl border border-dashed border-border/80 bg-muted/10",
        className,
      )}
    >
      {Icon ? (
        <div className="mb-4 rounded-full bg-primary/10 p-3">
          <Icon className="h-6 w-6 text-primary" aria-hidden />
        </div>
      ) : null}
      <p className="text-base font-medium text-foreground">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted-foreground max-w-md leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
