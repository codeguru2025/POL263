import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Settings, 
  History, 
  Building,
  LogOut,
  ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/staff", label: "Dashboard", icon: LayoutDashboard },
    { href: "/staff/audit", label: "Audit Logs", icon: History },
    { href: "/staff/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen flex bg-background">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="h-16 flex items-center px-6 border-b">
          <img src="/assets/logo.png" alt="Logo" className="h-8 w-8 rounded mr-3" />
          <span className="font-display font-bold text-lg">Falakhe Staff</span>
        </div>
        
        <div className="p-4 flex-1 flex flex-col gap-2">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href}>
                <Button 
                  variant={isActive ? "secondary" : "ghost"} 
                  className={`w-full justify-start ${isActive ? 'font-semibold' : 'text-muted-foreground'}`}
                  data-testid={`nav-link-${item.label.toLowerCase()}`}
                >
                  <item.icon className="mr-3 h-5 w-5" />
                  {item.label}
                </Button>
              </Link>
            )
          })}
        </div>

        <div className="p-4 border-t">
          <div className="flex items-center gap-3 px-2 py-2">
            <Avatar className="h-9 w-9">
              <AvatarImage src="https://i.pravatar.cc/150?u=ausiziba" />
              <AvatarFallback>AU</AvatarFallback>
            </Avatar>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">ausiziba@gmail.com</p>
              <p className="text-xs text-muted-foreground">Superuser</p>
            </div>
          </div>
          <Link href="/">
            <Button variant="ghost" className="w-full justify-start text-destructive hover:text-destructive hover:bg-destructive/10 mt-2" data-testid="btn-logout">
              <LogOut className="mr-3 h-5 w-5" />
              Sign out
            </Button>
          </Link>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Topbar for tenant selection */}
        <header className="h-16 border-b bg-card flex items-center px-8 justify-between shrink-0">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-sm">
              <Building className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">Organization:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                Acme Corp <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </div>
            <div className="h-4 w-px bg-border"></div>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Branch:</span>
              <Button variant="outline" size="sm" className="h-8 gap-2">
                HQ - New York <ChevronDown className="h-3 w-3 opacity-50" />
              </Button>
            </div>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-6xl mx-auto">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}