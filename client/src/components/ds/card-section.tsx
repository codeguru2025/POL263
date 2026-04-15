import { cn } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { LucideIcon } from "lucide-react";

export interface CardSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  /** When true, CardContent has no top padding (e.g. tables flush to edges). */
  flush?: boolean;
}

export function CardSection({
  title,
  description,
  icon: Icon,
  headerRight,
  children,
  className,
  contentClassName,
  flush,
}: CardSectionProps) {
  return (
    <Card
      className={cn(
        "rounded-xl border border-border/70 bg-card shadow-sm overflow-hidden",
        className,
      )}
    >
      <CardHeader className="border-b border-border/50 bg-muted/15 pb-4 space-y-0">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base font-semibold tracking-tight flex items-center gap-2">
              {Icon ? <Icon className="h-4 w-4 text-primary shrink-0" aria-hidden /> : null}
              {title}
            </CardTitle>
            {description ? (
              <CardDescription className="text-sm leading-relaxed max-w-3xl">{description}</CardDescription>
            ) : null}
          </div>
          {headerRight ? <div className="shrink-0 flex flex-wrap gap-2 justify-end">{headerRight}</div> : null}
        </div>
      </CardHeader>
      <CardContent className={cn(flush ? "p-0" : "pt-6", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
