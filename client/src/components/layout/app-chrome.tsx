import { Link } from "wouter";
import { ThemeSwitcher } from "@/components/theme-switcher";
import AppFooter from "@/components/app-footer";
import { cn } from "@/lib/utils";

/** Same horizontal cap as staff layout — keeps all portals visually aligned. */
export const APP_SHELL_MAX = "max-w-[min(100%,1400px)] mx-auto w-full";

type AppChromeProps = {
  children: React.ReactNode;
  /** When true, main is a centered column (login / small cards). */
  center?: boolean;
  mainClassName?: string;
  /** Optional left side of the top bar (default: POL263 home link). */
  headerStart?: React.ReactNode;
  hideFooter?: boolean;
};

/**
 * Shared chrome for public and auth pages: card utility bar + theme + footer.
 * Authenticated staff/client use their respective layouts instead.
 */
export function AppChrome({
  children,
  center = true,
  mainClassName,
  headerStart,
  hideFooter,
}: AppChromeProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-hidden">
      <header className="border-b bg-card shrink-0 z-30">
        <div className={cn(APP_SHELL_MAX, "px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3")}>
          <div className="min-w-0 flex-1">
            {headerStart ?? (
              <Link
                href="/"
                className="font-display font-semibold text-foreground hover:opacity-90 inline-block truncate"
              >
                POL263
              </Link>
            )}
          </div>
          <ThemeSwitcher />
        </div>
      </header>
      <main
        className={cn(
          "flex-1 min-h-0 overflow-x-hidden overflow-y-auto",
          center && "flex flex-col items-center justify-center px-3 py-8 sm:px-6",
          !center && "px-3 py-6 sm:px-6",
          mainClassName,
        )}
      >
        {children}
      </main>
      {!hideFooter && <AppFooter />}
    </div>
  );
}
