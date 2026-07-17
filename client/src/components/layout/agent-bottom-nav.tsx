import { Link, useLocation } from "wouter";
import { LayoutDashboard, Target, FileStack, Users, ClipboardList, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/staff", label: "Home", icon: LayoutDashboard },
  { href: "/staff/leads", label: "Leads", icon: Target },
  { href: "/staff/policies", label: "Policies", icon: FileStack },
  { href: "/staff/clients", label: "Clients", icon: Users },
  { href: "/staff/attendance", label: "Attendance", icon: ClipboardList },
] as const;

/**
 * Fixed bottom tab bar for the agent-in-native-app experience. Only rendered by
 * StaffLayout when isAgent && isNativeMobile() — never shown to non-agent staff or in a
 * mobile browser/PWA (there the existing hamburger+Sheet nav still applies). "More" opens
 * the same Sheet drawer the header hamburger uses, so the full nav (incl. anything not in
 * these 5 tabs) stays reachable without duplicating its contents here.
 */
export function AgentBottomNav({ onMoreClick }: { onMoreClick: () => void }) {
  const [location] = useLocation();

  const isActive = (href: string) =>
    href === "/staff" ? location === "/staff" || location === "/staff/" : location.startsWith(href);

  return (
    <nav
      aria-label="Primary"
      className="md:hidden fixed bottom-0 inset-x-0 z-30 flex items-stretch border-t bg-background"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] touch-target",
              active ? "text-primary font-medium" : "text-muted-foreground",
            )}
          >
            <tab.icon className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate max-w-full">{tab.label}</span>
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMoreClick}
        className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 py-1.5 text-[11px] text-muted-foreground touch-target"
      >
        <Menu className="h-5 w-5 shrink-0" aria-hidden />
        <span className="truncate max-w-full">More</span>
      </button>
    </nav>
  );
}
