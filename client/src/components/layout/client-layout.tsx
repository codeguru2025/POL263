import { Link, useLocation } from "wouter";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Home,
  LogOut,
  UserCircle,
  CreditCard,
  FileText,
  ClipboardList,
  MessageSquare,
  Clock,
  Bell,
  Check,
  Menu,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { resolveAssetUrl, getDefaultLogoUrl } from "@/lib/assetUrl";
import { getApiBase, apiRequest } from "@/lib/queryClient";
import AppFooter from "@/components/app-footer";
import { APP_SHELL_MAX } from "@/components/layout/app-chrome";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface ClientLayoutProps {
  children: React.ReactNode;
  clientName?: string;
  onLogout?: () => void;
}

interface TenantInfo {
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  isWhitelabeled: boolean;
}

const NOTIFICATION_SOUND_URL = "data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdH2LkZiYl5KMhoJ+fH5/g4mPk5aTjoeFgX57en6Dh4uOj4yJhYF+fHt8gIOHio2NjIiEgX9+fX5/goWIiouKiIWDgX9+fn+BhIeJioqIhoSDgYB/f4GDhYeIiIeGhIOBgH9/gIGDhYeHh4aFhIOCgYCAf4CBg4WHh4eGhYSDgoGA";

function NotificationBell() {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const prevCountRef = useRef(0);
  const bellRef = useRef<HTMLButtonElement>(null);

  const { data: unreadData } = useQuery<{ count: number }>({
    queryKey: ["/api/client-auth/notifications/unread-count"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/notifications/unread-count", { credentials: "include" });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    refetchInterval: 15000,
    retry: false,
  });

  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/client-auth/notifications"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/notifications", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open,
    retry: false,
  });

  const count = unreadData?.count ?? 0;

  useEffect(() => {
    if (count > prevCountRef.current && prevCountRef.current >= 0) {
      try {
        const audio = new Audio(NOTIFICATION_SOUND_URL);
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}
      if ("vibrate" in navigator) navigator.vibrate(200);
    }
    prevCountRef.current = count;
  }, [count]);

  const markAllRead = useCallback(async () => {
    try {
      await apiRequest("PATCH", "/api/client-auth/notifications/mark-all-read");
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/notifications"] });
    } catch {}
  }, [queryClient]);

  const markRead = useCallback(async (id: string) => {
    try {
      await apiRequest("PATCH", `/api/client-auth/notifications/${id}/read`);
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/notifications"] });
    } catch {}
  }, [queryClient]);

  return (
    <div className="relative">
      <button
        ref={bellRef}
        className="relative p-1.5 rounded-md hover:bg-muted transition-colors"
        onClick={() => setOpen(!open)}
        aria-label={`Notifications${count > 0 ? ` (${count} unread)` : ""}`}
      >
        <Bell className="h-5 w-5 text-muted-foreground" />
        {count > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full flex items-center justify-center px-1 animate-pulse">
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-80 sm:w-96 max-h-[70vh] bg-popover border rounded-lg shadow-xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <span className="font-semibold text-sm">Notifications</span>
              {count > 0 && (
                <button className="text-xs text-primary hover:underline flex items-center gap-1" onClick={markAllRead}>
                  <Check className="h-3 w-3" /> Mark all read
                </button>
              )}
            </div>
            <div className="overflow-y-auto flex-1">
              {notifications.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground text-sm">No notifications yet</div>
              ) : (
                notifications.slice(0, 30).map((n: any) => (
                  <div
                    key={n.id}
                    className={`px-4 py-3 border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors ${!n.readAt ? "bg-primary/5" : ""}`}
                    onClick={() => { if (!n.readAt) markRead(n.id); }}
                  >
                    <div className="flex items-start gap-2">
                      {!n.readAt && <span className="mt-1.5 w-2 h-2 rounded-full bg-primary shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm ${!n.readAt ? "font-semibold" : "font-medium"}`}>{n.subject || "Notification"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
                        <p className="text-[10px] text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function clientNavActive(href: string, loc: string) {
  if (href === "/client") return loc === "/client" || loc === "/client/";
  return loc === href || loc.startsWith(`${href}/`);
}

export default function ClientLayout({ children, clientName = "Client", onLogout }: ClientLayoutProps) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const dateTimeStr = now.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  const { data: tenant } = useQuery<TenantInfo>({
    queryKey: ["/api/client-auth/tenant"],
    retry: false,
  });

  const navItems = [
    { href: "/client", label: "Overview", icon: Home },
    { href: "/client/payments", label: "Pay", icon: CreditCard },
    { href: "/client/documents", label: "Documents", icon: FileText },
    { href: "/client/claims", label: "Claims", icon: ClipboardList },
    { href: "/client/feedback", label: "Feedback", icon: MessageSquare },
  ];

  const handleLogout = () => {
    if (onLogout) onLogout();
  };

  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground overflow-x-hidden max-w-[100vw]">
      <header className="border-b bg-card shrink-0 z-30">
        <div className={cn(APP_SHELL_MAX, "px-3 sm:px-4 py-2.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between")}>
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={resolveAssetUrl(tenant?.logoUrl?.trim() ? tenant.logoUrl : getDefaultLogoUrl())}
              alt={tenant?.name || "Logo"}
              className="h-8 w-auto max-w-[160px] sm:max-w-[220px] rounded-md object-contain object-left shrink-0"
              loading="lazy"
            />
            {tenant?.name && (
              <span className="font-semibold text-sm truncate hidden sm:inline max-w-[200px]">{tenant.name}</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs sm:text-sm text-muted-foreground justify-start sm:justify-end">
            <span className="hidden sm:inline-flex items-center gap-1.5 tabular-nums" title="Current date and time">
              <Clock className="h-3.5 w-3.5 shrink-0" />
              {dateTimeStr}
            </span>
            <NotificationBell />
            <div className="flex items-center gap-1.5 min-w-0">
              <UserCircle className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-foreground truncate max-w-[120px] sm:max-w-[200px]" data-testid="text-client-name">
                {clientName}
              </span>
            </div>
            <ThemeSwitcher />
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-8"
              onClick={handleLogout}
              data-testid="btn-client-logout"
            >
              <LogOut className="h-4 w-4 sm:mr-1.5" />
              <span className="hidden sm:inline">Log out</span>
            </Button>
          </div>
        </div>
      </header>

      <nav className="border-b bg-primary text-primary-foreground shrink-0 z-20" aria-label="Client navigation">
        <div className={cn(APP_SHELL_MAX, "px-1 sm:px-2 flex items-center justify-between gap-1 min-h-11")}>
          <div className="hidden md:flex items-center gap-0.5 flex-1 min-w-0 overflow-x-auto py-0.5">
            {navItems.map((item) => (
              <Link key={item.href} href={item.href}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-9 px-2 sm:px-3 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground gap-1.5 shrink-0",
                    clientNavActive(item.href, location) && "bg-primary-foreground/15 font-medium",
                  )}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  <span className="max-w-[120px] truncate">{item.label}</span>
                </Button>
              </Link>
            ))}
          </div>

          <div className="md:hidden flex items-center justify-between w-full gap-2 px-1 py-1">
            <span className="text-sm font-medium text-primary-foreground/95 truncate">Portal</span>
            <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
              <SheetTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-primary-foreground hover:bg-primary-foreground/15 shrink-0"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[min(100vw-1rem,20rem)] p-0 flex flex-col gap-0">
                <SheetHeader className="p-4 border-b text-left">
                  <SheetTitle>Menu</SheetTitle>
                  <p className="text-xs font-normal text-muted-foreground truncate">{tenant?.name || "Client portal"}</p>
                </SheetHeader>
                <div className="flex-1 overflow-y-auto p-3 space-y-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={cn(
                        "flex items-center gap-2 rounded-md px-2 py-2.5 text-sm hover:bg-muted transition-colors",
                        clientNavActive(item.href, location) && "bg-muted font-medium",
                      )}
                    >
                      <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      {item.label}
                    </Link>
                  ))}
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </nav>

      <main className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <div className={cn(APP_SHELL_MAX, "px-3 py-4 sm:px-6 sm:py-8 min-h-0 space-y-6")}>{children}</div>
      </main>

      <AppFooter />

      {(tenant?.address || tenant?.phone || tenant?.email || tenant?.website) && (
        <footer className="border-t bg-muted/30 py-4 px-4 sm:px-6 shrink-0">
          <div className={cn(APP_SHELL_MAX, "text-center text-sm text-muted-foreground space-y-1")}>
            {tenant?.address && <p>{tenant.address}</p>}
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
              {tenant?.phone && <span>Tel: {tenant.phone}</span>}
              {tenant?.email && (
                <a href={`mailto:${tenant.email}`} className="text-primary hover:underline">{tenant.email}</a>
              )}
              {tenant?.website && (
                <a href={tenant.website.startsWith("http") ? tenant.website : `https://${tenant.website}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{tenant.website}</a>
              )}
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
