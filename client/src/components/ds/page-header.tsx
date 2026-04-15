import { cn } from "@/lib/utils";

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  /** For E2E / analytics hooks on the page title element */
  titleDataTestId?: string;
}

export function PageHeader({ title, description, breadcrumbs, actions, className, titleDataTestId }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-0 min-w-0", className)}>
      <div className="min-w-0 space-y-1">
        {breadcrumbs ? (
          <nav className="text-xs text-muted-foreground mb-0.5" aria-label="Breadcrumb">
            {breadcrumbs}
          </nav>
        ) : null}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground" data-testid={titleDataTestId}>{title}</h1>
        {description ? (
          <p className="text-muted-foreground text-sm sm:text-base max-w-2xl leading-relaxed">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </header>
  );
}
