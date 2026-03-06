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
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { resolveAssetUrl, getDefaultLogoUrl } from "@/lib/assetUrl";
import { getApiBase, apiRequest } from "@/lib/queryClient";
import AppFooter from "@/components/app-footer";

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

export default function ClientLayout({ children, clientName = "Client", onLogout }: ClientLayoutProps) {
  const [location] = useLocation();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
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
    { href: "/client/feedback", label: "Complaints & feedback", icon: MessageSquare },
  ];

  const handleLogout = () => {
    if (onLogout) {
      onLogout();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-14 sm:h-16 border-b bg-card flex items-center justify-between px-4 sm:px-6 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-2 min-w-0">
          <img
            src={tenant?.logoUrl ? resolveAssetUrl(tenant.logoUrl) : getDefaultLogoUrl()}
            alt={tenant?.name || "Logo"}
            className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain shrink-0"
            loading="lazy"
          />
          {tenant?.name && (
            <span className="font-semibold text-sm truncate hidden sm:inline max-w-[140px] md:max-w-none">{tenant.name}</span>
          )}
        </div>

        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <span className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground" title="Current date and time">
            <Clock className="h-3.5 w-3.5" />
            {dateTimeStr}
          </span>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <NotificationBell />
          <div className="h-4 w-px bg-border hidden sm:block" />
          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <UserCircle className="h-4 w-4 sm:h-5 sm:w-5 text-muted-foreground shrink-0" />
            <span className="text-xs sm:text-sm font-medium truncate max-w-[80px] sm:max-w-[180px]" data-testid="text-client-name">{clientName}</span>
          </div>
          <div className="h-4 w-px bg-border hidden sm:block" />
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground shrink-0 text-xs sm:text-sm px-2 sm:px-3"
            onClick={handleLogout}
            data-testid="btn-client-logout"
          >
            <LogOut className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </header>

      <div className="border-b bg-muted/20 overflow-x-auto">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 flex gap-4 sm:gap-6 min-w-max sm:min-w-0">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={`py-3 sm:py-4 px-2 border-b-2 transition-colors cursor-pointer text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 whitespace-nowrap ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  <item.icon className="h-3.5 w-3.5 sm:h-4 sm:w-4 shrink-0" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <main className="flex-1 overflow-auto p-4 sm:p-6">
        <div className="max-w-5xl mx-auto min-w-0">
          {children}
        </div>
      </main>

      <AppFooter />

      {(tenant?.address || tenant?.phone || tenant?.email || tenant?.website) && (
        <footer className="border-t bg-muted/30 py-4 px-4 sm:px-6 shrink-0">
          <div className="max-w-5xl mx-auto text-center text-sm text-muted-foreground space-y-1">
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
