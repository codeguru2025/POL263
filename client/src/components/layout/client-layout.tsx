import { Link, useLocation } from "wouter";
import {
  Home,
  LogOut,
  UserCircle,
  CreditCard,
  FileText,
  ClipboardList,
  MessageSquare
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface ClientLayoutProps {
  children: React.ReactNode;
  clientName?: string;
  onLogout?: () => void;
}

export default function ClientLayout({ children, clientName = "Client", onLogout }: ClientLayoutProps) {
  const [location] = useLocation();

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
      <header className="h-16 border-b bg-card flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src="/assets/logo.png" alt="POL263 Logo" className="h-8 w-8 rounded" />
          <span className="font-display font-bold text-lg">Client Portal</span>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium" data-testid="text-client-name">{clientName}</span>
          </div>
          <div className="h-4 w-px bg-border"></div>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={handleLogout}
            data-testid="btn-client-logout"
          >
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </header>

      <div className="border-b bg-muted/20">
        <div className="max-w-5xl mx-auto px-6 flex gap-6">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <div className={`py-4 px-2 border-b-2 transition-colors cursor-pointer text-sm font-medium flex items-center gap-2 ${isActive ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                  <item.icon className="h-4 w-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      <main className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto">
          {children}
        </div>
      </main>
    </div>
  );
}
