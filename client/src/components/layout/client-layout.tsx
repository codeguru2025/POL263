import { Link, useLocation } from "wouter";
import { useState, useEffect } from "react";
import {
  Home,
  LogOut,
  UserCircle,
  CreditCard,
  FileText,
  ClipboardList,
  MessageSquare,
  Clock,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { resolveAssetUrl } from "@/lib/assetUrl";
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
            src={tenant?.logoUrl ? resolveAssetUrl(tenant.logoUrl) : "/assets/logo.png"}
            alt={tenant?.name || "Logo"}
            className="h-8 w-8 sm:h-9 sm:w-9 rounded-lg object-contain shrink-0"
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
