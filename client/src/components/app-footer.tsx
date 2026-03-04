/**
 * App-wide footer: CHIBIKHULU logo (gold/black) + "Infinite Versatility" in cursive italics.
 * Shown across the app next to the main POL263 branding.
 */
export default function AppFooter() {
  return (
    <footer className="border-t bg-muted/20 py-3 px-4 shrink-0">
      <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-center gap-2 sm:gap-3 text-muted-foreground">
        <img
          src="/assets/chibikhulu-logo.png"
          alt="CHIBIKHULU"
          className="h-6 w-auto object-contain"
        />
        <span
          className="text-sm sm:text-base italic"
          style={{ fontFamily: "'Great Vibes', cursive" }}
        >
          Infinite Versatility
        </span>
      </div>
    </footer>
  );
}
