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
  /** Optional full-bleed photo alongside the centered content (login/register pages) — hidden
   *  below md, since a login form needs the vertical space more than the photo on a small screen. */
  sideImage?: { src: string; alt: string };
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
  sideImage,
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
          !sideImage && center && "flex flex-col items-center justify-center px-3 py-8 sm:px-6",
          !sideImage && !center && "px-3 py-6 sm:px-6",
          sideImage && "flex",
          mainClassName,
        )}
      >
        {sideImage ? (
          <>
            <div className="hidden md:block md:w-[42%] lg:w-1/2 relative shrink-0 overflow-hidden">
              <img src={sideImage.src} alt={sideImage.alt} className="absolute inset-0 h-full w-full object-cover" />
              {/* Brand color-multiply pass first (tints the photo toward the active theme's
                  primary hue, so it reads as designed rather than a raw stock photo), then the
                  usual dark gradient on top for depth/contrast at the edges. */}
              <div aria-hidden className="absolute inset-0 bg-primary/35 mix-blend-multiply" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-black/10" />
              <div aria-hidden className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-background/25" />
            </div>
            <div className="flex-1 min-w-0 flex flex-col items-center justify-center px-3 py-8 sm:px-6 overflow-y-auto">
              {children}
            </div>
          </>
        ) : (
          children
        )}
      </main>
      {!hideFooter && <AppFooter />}
    </div>
  );
}
