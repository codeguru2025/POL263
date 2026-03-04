import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Building2, Users, UserCircle } from "lucide-react";
import { ThemeSwitcher } from "@/components/theme-switcher";
import AppFooter from "@/components/app-footer";

const portals = [
  {
    title: "Staff Portal",
    description: "Manage policies, claims, funeral operations, and configure the tenant policy engine.",
    icon: Building2,
    href: "/staff/login",
    buttonLabel: "Access Staff Portal",
    testId: "link-staff-portal",
  },
  {
    title: "Agent Portal",
    description: "Sign in to access your clients, issue policies, and manage your referral links.",
    icon: UserCircle,
    href: "/agent/login",
    buttonLabel: "Access Agent Portal",
    testId: "link-agent-portal",
  },
  {
    title: "Client Portal",
    description: "Secure access for policyholders to view coverage, pay premiums, and update details.",
    icon: Users,
    href: "/client/login",
    buttonLabel: "Access Client Portal",
    testId: "link-client-portal",
  },
];

export default function Home() {
  const displayName = "POL263";
  const displayLogo = "/assets/logo.png";

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-6 relative">
      <div className="absolute top-4 right-4">
        <ThemeSwitcher />
      </div>
      <div className="mb-14 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-500">
        <img src={displayLogo} alt={displayName} className="h-20 w-20 mb-5 rounded-2xl object-contain" />
        <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">{displayName}</h1>
        <p className="text-muted-foreground text-lg font-medium mt-2">Insurance Management Platform</p>
      </div>

      <div className="grid md:grid-cols-3 gap-6 w-full max-w-5xl">
        {portals.map((portal) => (
          <Link key={portal.href} href={portal.href} className="block">
            <Card className="h-full flex flex-col hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 cursor-pointer group border-border/60">
              <CardHeader className="flex-1">
                <div className="h-14 w-14 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 group-hover:bg-primary group-hover:text-primary-foreground transition-all duration-300">
                  <portal.icon size={28} />
                </div>
                <CardTitle className="text-xl font-display">{portal.title}</CardTitle>
                <CardDescription className="text-sm leading-relaxed min-h-[3rem]">
                  {portal.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <Button
                  className="w-full h-11 font-medium shadow-sm group-hover:shadow-md transition-all bg-primary text-primary-foreground hover:bg-primary/90"
                  size="lg"
                  data-testid={portal.testId}
                >
                  {portal.buttonLabel}
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <AppFooter />
    </div>
  );
}