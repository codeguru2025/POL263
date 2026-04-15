import { cn } from "@/lib/utils";

export interface AppShellProps {
  sidebar: React.ReactNode;
  topbar: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  overlay?: React.ReactNode;
  sidebarClassName?: string;
  mainClassName?: string;
  contentClassName?: string;
}

/**
 * Staff / ops shell: sidebar + sticky topbar + scrollable main + optional footer.
 * Layout only — navigation and page content are passed as slots.
 */
export function AppShell({
  sidebar,
  topbar,
  children,
  footer,
  overlay,
  sidebarClassName,
  mainClassName,
  contentClassName,
}: AppShellProps) {
  return (
    <div className="min-h-screen flex bg-background text-foreground overflow-x-hidden max-w-[100vw]">
      {overlay}
      <aside
        className={cn(
          "fixed lg:static inset-y-0 left-0 z-50 w-64 max-w-[85vw] lg:max-w-none",
          "border-r border-border/60 bg-card flex flex-col shadow-sm",
          "transform transition-transform duration-200 ease-out lg:translate-x-0",
          sidebarClassName,
        )}
      >
        {sidebar}
      </aside>
      <main
        className={cn(
          "flex-1 flex flex-col min-h-screen lg:min-h-screen overflow-hidden bg-background min-w-0",
          mainClassName,
        )}
      >
        {topbar}
        <div
          className={cn(
            "flex-1 overflow-auto px-4 py-6 sm:px-6 sm:py-8 md:px-10 md:py-9 relative",
            contentClassName,
          )}
        >
          <div className="absolute inset-0 bg-gradient-to-br from-primary/[0.04] via-transparent to-transparent pointer-events-none -z-10" />
          <div className="max-w-[min(100%,1400px)] mx-auto w-full min-w-0 relative z-0">{children}</div>
        </div>
        {footer}
      </main>
    </div>
  );
}
