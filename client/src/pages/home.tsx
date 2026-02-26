import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, UserCircle } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-12 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <img src="/assets/logo.png" alt="Logo" className="h-24 w-24 mb-6 rounded-2xl object-contain" />
        <p className="text-muted-foreground text-lg font-medium">Core Administration Platform</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 w-full max-w-4xl">
        <Card className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer group border-border">
          <CardHeader>
            <div className="h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
              <Building2 size={28} />
            </div>
            <CardTitle className="text-2xl font-display">Staff Portal</CardTitle>
            <CardDescription className="text-base">
              Manage policies, claims, funeral operations, and configure the tenant policy engine.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/staff/login">
              <Button className="w-full h-12 text-md shadow-sm group-hover:shadow transition-all bg-primary text-primary-foreground hover:bg-primary/90" size="lg" data-testid="link-staff-portal">
                Access Staff Portal
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer group border-border">
          <CardHeader>
            <div className="h-14 w-14 bg-secondary text-secondary-foreground border rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <UserCircle size={28} />
            </div>
            <CardTitle className="text-2xl font-display">Agent Portal</CardTitle>
            <CardDescription className="text-base">
              Agents sign in with email and password to access the staff portal and use referral links.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/agent/login">
              <Button variant="outline" className="w-full h-12 text-md" size="lg" data-testid="link-agent-portal">
                Agent Login
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 hover:shadow-lg hover:shadow-primary/5 transition-all duration-300 cursor-pointer group border-border">
          <CardHeader>
            <div className="h-14 w-14 bg-secondary text-secondary-foreground border rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
              <Users size={28} />
            </div>
            <CardTitle className="text-2xl font-display">Client Portal</CardTitle>
            <CardDescription className="text-base">
              Secure access for policyholders to view coverage, pay premiums, and update details.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/client/login">
              <Button variant="outline" className="w-full h-12 text-md border-primary/40 text-primary hover:bg-primary/10" size="lg" data-testid="link-client-portal">
                Access Client Portal
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
      
      <div className="mt-16 text-center text-sm text-muted-foreground max-w-md">
        <p>Phase 0-1 Foundation: Multi-Tenant Architecture & RBAC</p>
      </div>
    </div>
  );
}