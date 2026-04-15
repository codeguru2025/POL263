import { cn } from "@/lib/utils";
import { useId } from "react";

export interface FormSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function FormSection({ title, description, children, className }: FormSectionProps) {
  const titleId = useId();
  return (
    <section
      className={cn(
        "rounded-xl border border-border/60 bg-muted/10 p-5 sm:p-6 space-y-4",
        className,
      )}
      aria-labelledby={titleId}
    >
      <div className="space-y-1">
        <h3 id={titleId} className="text-sm font-semibold text-foreground tracking-tight">
          {title}
        </h3>
        {description ? <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">{description}</p> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
