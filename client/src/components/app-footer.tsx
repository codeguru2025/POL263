import { Link } from "wouter";

/**
 * App-wide footer: CHIBIKHULU logo (gold/black) + "Infinite Versatility" in cursive italics.
 * Shown across the app next to the main POL263 branding.
 */
export default function AppFooter() {
  return (
    <footer className="border-t bg-muted/20 py-3 px-4 shrink-0">
      <div className="max-w-6xl mx-auto flex flex-col items-center justify-center gap-2">
        <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-muted-foreground">
          <img
            src="/assets/chibikhulu-logo.png"
            alt="CHIBIKHULU"
            className="h-6 w-auto object-contain"
            loading="lazy"
          />
          <span
            className="text-sm sm:text-base italic"
            style={{ fontFamily: "'Great Vibes', cursive" }}
          >
            Infinite Versatility
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <Link href="/legal/aml-policy" className="hover:text-foreground hover:underline underline-offset-2">
            AML Policy
          </Link>
          <span aria-hidden="true">·</span>
          <Link href="/legal/data-retention-policy" className="hover:text-foreground hover:underline underline-offset-2">
            Data Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
