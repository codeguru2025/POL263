import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import { ThemeProvider } from "@/components/theme-provider";
import { lazy, Suspense } from "react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { isNativeMobile } from "@/lib/mobile-payment";
import { Loader2 } from "lucide-react";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";

// Eagerly loaded: landing + login pages (first paint)
import Home from "@/pages/home";
import NotFound from "@/pages/not-found";

// Lazily loaded: all other pages (route-based code splitting)
const StaffLogin = lazy(() => import("@/pages/staff/login"));
const AgentLogin = lazy(() => import("@/pages/agent/login"));
const StaffDashboard = lazy(() => import("@/pages/staff/dashboard"));
const AuditLogs = lazy(() => import("@/pages/staff/audit"));
const StaffSettings = lazy(() => import("@/pages/staff/settings"));
const ProductBuilder = lazy(() => import("@/pages/staff/products"));
const StaffPolicies = lazy(() => import("@/pages/staff/policies"));
const StaffClients = lazy(() => import("@/pages/staff/clients"));
const StaffClaims = lazy(() => import("@/pages/staff/claims"));
const StaffFunerals = lazy(() => import("@/pages/staff/funerals"));
const StaffFinance = lazy(() => import("@/pages/staff/finance"));
const StaffReports = lazy(() => import("@/pages/staff/reports"));
const StaffLeads = lazy(() => import("@/pages/staff/leads"));
const StaffNotifications = lazy(() => import("@/pages/staff/notifications"));
const StaffGroups = lazy(() => import("@/pages/staff/groups"));
const StaffApprovals = lazy(() => import("@/pages/staff/approvals"));
const StaffDiagnostics = lazy(() => import("@/pages/staff/diagnostics"));
const StaffPriceBook = lazy(() => import("@/pages/staff/pricebook"));
const StaffPayroll = lazy(() => import("@/pages/staff/payroll"));
const StaffUsers = lazy(() => import("@/pages/staff/users"));
const StaffTenants = lazy(() => import("@/pages/staff/tenants"));

const ClientLogin = lazy(() => import("@/pages/client/login"));
const ClientClaim = lazy(() => import("@/pages/client/claim"));
const ClientResetPassword = lazy(() => import("@/pages/client/reset-password"));
const ClientDashboard = lazy(() => import("@/pages/client/dashboard"));
const ClientPayments = lazy(() => import("@/pages/client/payments"));
const ClientDocuments = lazy(() => import("@/pages/client/documents"));
const ClientDocumentView = lazy(() => import("@/pages/client/document-view"));
const ClientClaims = lazy(() => import("@/pages/client/claims"));
const ClientFeedback = lazy(() => import("@/pages/client/feedback"));
const JoinPage = lazy(() => import("@/pages/join"));
const JoinRegisterPage = lazy(() => import("@/pages/join/register"));

function PageLoader() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

function PaynowReturnRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/client/payments?returned=1"); }, [setLocation]);
  return null;
}

function DeepLinkHandler() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    if (!isNativeMobile()) return;
    const parseSchemeUrl = (url: string): string | null => {
      try {
        const u = new URL(url);
        if (u.protocol !== "pol263:") return null;
        const path = u.host ? `/${u.host}${u.pathname || ""}` : u.pathname || "";
        const clean = path.replace(/\/+/g, "/").replace(/^\//, "/") || "/";
        const query = u.search ? u.search : "";
        return clean !== "/" ? `${clean}${query}` : null;
      } catch {
        return null;
      }
    };
    const go = (url: string) => {
      const path = parseSchemeUrl(url);
      if (path) setLocation(path);
    };
    let remove: (() => Promise<void>) | null = null;
    import("@capacitor/app").then(({ App }) => {
      App.getLaunchUrl().then((r) => { if (r?.url) go(r.url); });
      App.addListener("appUrlOpen", (e) => go(e.url)).then((handle) => { remove = handle.remove; });
    });
    return () => { remove?.(); };
  }, [setLocation]);
  return null;
}

function Router() {
  return (
    <>
      <DeepLinkHandler />
    <Suspense fallback={<PageLoader />}>
    <Switch>
      <Route path="/" component={Home} />
      
      <Route path="/staff/login" component={StaffLogin} />
      <Route path="/agent/login" component={AgentLogin} />
      <Route path="/staff" component={StaffDashboard} />
      <Route path="/staff/" component={StaffDashboard} />
      <Route path="/staff/audit" component={AuditLogs} />
      <Route path="/staff/settings" component={StaffSettings} />
      <Route path="/staff/products" component={ProductBuilder} />
      <Route path="/staff/policies" component={StaffPolicies} />
      <Route path="/staff/clients" component={StaffClients} />
      <Route path="/staff/claims" component={StaffClaims} />
      <Route path="/staff/funerals" component={StaffFunerals} />
      <Route path="/staff/finance" component={StaffFinance} />
      <Route path="/staff/reports" component={StaffReports} />
      <Route path="/staff/leads" component={StaffLeads} />
      <Route path="/staff/notifications" component={StaffNotifications} />
      <Route path="/staff/groups" component={StaffGroups} />
      <Route path="/staff/approvals" component={StaffApprovals} />
      <Route path="/staff/diagnostics" component={StaffDiagnostics} />
      <Route path="/staff/pricebook" component={StaffPriceBook} />
      <Route path="/staff/payroll" component={StaffPayroll} />
      <Route path="/staff/users" component={StaffUsers} />
      <Route path="/staff/tenants" component={StaffTenants} />
      
      <Route path="/join" component={JoinPage} />
      <Route path="/join/register" component={JoinRegisterPage} />
      
      <Route path="/client/login" component={ClientLogin} />
      <Route path="/client/claim" component={ClientClaim} />
      <Route path="/client/reset-password" component={ClientResetPassword} />
      <Route path="/client" component={ClientDashboard} />
      <Route path="/client/payments" component={ClientPayments} />
      <Route path="/client/documents" component={ClientDocuments} />
      <Route path="/client/documents/view/:policyId" component={ClientDocumentView} />
      <Route path="/client/claims" component={ClientClaims} />
      <Route path="/client/feedback" component={ClientFeedback} />
      <Route path="/client/payments/return">
        <PaynowReturnRedirect />
      </Route>
      
      <Route component={NotFound} />
    </Switch>
    </Suspense>
    </>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <PwaInstallPrompt />
            <Router />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
