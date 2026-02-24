import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="mb-12 flex flex-col items-center">
        <img src="/assets/logo.png" alt="Falakhe PMS Logo" className="h-16 w-16 mb-4 rounded-xl shadow-sm" />
        <h1 className="text-4xl font-display font-bold text-foreground">Falakhe PMS</h1>
        <p className="text-muted-foreground mt-2 text-lg">Property Management System</p>
      </div>

      <div className="grid md:grid-cols-2 gap-6 w-full max-w-4xl">
        <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
          <CardHeader>
            <div className="h-12 w-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Building2 size={24} />
            </div>
            <CardTitle className="text-2xl font-display">Staff Portal</CardTitle>
            <CardDescription className="text-base">
              Manage properties, view audit logs, and configure tenant settings.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/staff/login">
              <Button className="w-full" size="lg" data-testid="link-staff-portal">
                Access Staff Portal
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card className="hover:border-primary/50 transition-colors cursor-pointer group">
          <CardHeader>
            <div className="h-12 w-12 bg-primary/10 text-primary rounded-lg flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <Users size={24} />
            </div>
            <CardTitle className="text-2xl font-display">Client Portal</CardTitle>
            <CardDescription className="text-base">
              View your properties, leases, and communications.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/client">
              <Button variant="outline" className="w-full" size="lg" data-testid="link-client-portal">
                Access Client Portal
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}