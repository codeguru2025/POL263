import { Link, useLocation } from "wouter";
import { 
  Home, 
  FileText, 
  MessageSquare,
  LogOut,
  UserCircle
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/client", label: "Overview", icon: Home },
    { href: "/client/leases", label: "My Leases", icon: FileText },
    { href: "/client/messages", label: "Messages", icon: MessageSquare },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Navbar for Client Portal */}
      <header className="h-16 border-b bg-card flex items-center justify-between px-6 shrink-0 sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src="/assets/logo.png" alt="Logo" className="h-8 w-8 rounded" />
          <span className="font-display font-bold text-lg">Acme Corp Resident Portal</span>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <UserCircle className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium">Jane Doe</span>
          </div>
          <div className="h-4 w-px bg-border"></div>
          <Link href="/">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4 mr-2" />
              Logout
            </Button>
          </Link>
        </div>
      </header>

      {/* Client Sub-navigation */}
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
            )
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