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
// Retry chunk load on failure (e.g. transient network) to avoid "error then loads" when navigating
function retryLazy<T>(
  importFn: () => Promise<{ default: T }>,
  retries = 3,
  delay = 500
): Promise<{ default: T }> {
  return importFn().catch((err) => {
    const isChunkError =
      err?.name === "ChunkLoadError" ||
      err?.message?.includes("Loading chunk") ||
      err?.message?.includes("Failed to fetch dynamically imported module");
    if (isChunkError && retries > 0) {
      return new Promise((resolve, reject) => {
        setTimeout(() => retryLazy(importFn, retries - 1, delay).then(resolve).catch(reject), delay);
      });
    }
    throw err;
  });
}
const StaffLogin = lazy(() => retryLazy(() => import("@/pages/staff/login")));
const AgentLogin = lazy(() => retryLazy(() => import("@/pages/agent/login")));
const StaffDashboard = lazy(() => retryLazy(() => import("@/pages/staff/dashboard")));
const AuditLogs = lazy(() => retryLazy(() => import("@/pages/staff/audit")));
const StaffSettings = lazy(() => retryLazy(() => import("@/pages/staff/settings")));
const ProductBuilder = lazy(() => retryLazy(() => import("@/pages/staff/products")));
const StaffPolicies = lazy(() => retryLazy(() => import("@/pages/staff/policies")));
const StaffClients = lazy(() => retryLazy(() => import("@/pages/staff/clients")));
const StaffClaims = lazy(() => retryLazy(() => import("@/pages/staff/claims")));
const StaffFunerals = lazy(() => retryLazy(() => import("@/pages/staff/funerals")));
const StaffFinance = lazy(() => retryLazy(() => import("@/pages/staff/finance")));
const StaffReports = lazy(() => retryLazy(() => import("@/pages/staff/reports")));
const StaffLeads = lazy(() => retryLazy(() => import("@/pages/staff/leads")));
const StaffNotifications = lazy(() => retryLazy(() => import("@/pages/staff/notifications")));
const StaffGroups = lazy(() => retryLazy(() => import("@/pages/staff/groups")));
const StaffApprovals = lazy(() => retryLazy(() => import("@/pages/staff/approvals")));
const StaffDiagnostics = lazy(() => retryLazy(() => import("@/pages/staff/diagnostics")));
const StaffPriceBook = lazy(() => retryLazy(() => import("@/pages/staff/pricebook")));
const StaffPayroll = lazy(() => retryLazy(() => import("@/pages/staff/payroll")));
const StaffUsers = lazy(() => retryLazy(() => import("@/pages/staff/users")));
const StaffTenants = lazy(() => retryLazy(() => import("@/pages/staff/tenants")));
const StaffHelpCenter = lazy(() => retryLazy(() => import("@/pages/staff/help-center")));
const StaffReminders = lazy(() => retryLazy(() => import("@/pages/staff/reminders")));
const StaffOrderServices = lazy(() => retryLazy(() => import("@/pages/staff/order-services")));
const StaffAssetsRegister = lazy(() => retryLazy(() => import("@/pages/staff/assets-register")));
const StaffComingSoon = lazy(() => retryLazy(() => import("@/pages/staff/coming-soon")));
const StaffEmployeeReports = lazy(() => retryLazy(() => import("@/pages/staff/employee-reports")));

const ClientLogin = lazy(() => retryLazy(() => import("@/pages/client/login")));
const ClientClaim = lazy(() => retryLazy(() => import("@/pages/client/claim")));
const ClientResetPassword = lazy(() => retryLazy(() => import("@/pages/client/reset-password")));
const ClientDashboard = lazy(() => retryLazy(() => import("@/pages/client/dashboard")));
const ClientPayments = lazy(() => retryLazy(() => import("@/pages/client/payments")));
const ClientDocuments = lazy(() => retryLazy(() => import("@/pages/client/documents")));
const ClientDocumentView = lazy(() => retryLazy(() => import("@/pages/client/document-view")));
const ClientClaims = lazy(() => retryLazy(() => import("@/pages/client/claims")));
const ClientFeedback = lazy(() => retryLazy(() => import("@/pages/client/feedback")));
const JoinPage = lazy(() => retryLazy(() => import("@/pages/join")));
const JoinRegisterPage = lazy(() => retryLazy(() => import("@/pages/join/register")));

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

function SafeRoute({ path, component: Comp }: { path?: string; component: React.ComponentType<any> }) {
  return (
    <Route path={path}>
      <ErrorBoundary>
        <Comp />
      </ErrorBoundary>
    </Route>
  );
}

function Router() {
  return (
    <>
      <DeepLinkHandler />
    <Suspense fallback={<PageLoader />}>
    <Switch>
      <Route path="/" component={Home} />
      
      <SafeRoute path="/staff/login" component={StaffLogin} />
      <SafeRoute path="/agent/login" component={AgentLogin} />
      <SafeRoute path="/staff" component={StaffDashboard} />
      <SafeRoute path="/staff/" component={StaffDashboard} />
      <SafeRoute path="/staff/audit" component={AuditLogs} />
      <SafeRoute path="/staff/settings" component={StaffSettings} />
      <SafeRoute path="/staff/settings/" component={StaffSettings} />
      <SafeRoute path="/staff/products" component={ProductBuilder} />
      <SafeRoute path="/staff/policies" component={StaffPolicies} />
      <SafeRoute path="/staff/clients" component={StaffClients} />
      <SafeRoute path="/staff/claims" component={StaffClaims} />
      <SafeRoute path="/staff/funerals" component={StaffFunerals} />
      <SafeRoute path="/staff/finance" component={StaffFinance} />
      <SafeRoute path="/staff/reports" component={StaffReports} />
      <SafeRoute path="/staff/leads" component={StaffLeads} />
      <SafeRoute path="/staff/notifications" component={StaffNotifications} />
      <SafeRoute path="/staff/groups" component={StaffGroups} />
      <SafeRoute path="/staff/approvals" component={StaffApprovals} />
      <SafeRoute path="/staff/diagnostics" component={StaffDiagnostics} />
      <SafeRoute path="/staff/pricebook" component={StaffPriceBook} />
      <SafeRoute path="/staff/payroll" component={StaffPayroll} />
      <SafeRoute path="/staff/users" component={StaffUsers} />
      <SafeRoute path="/staff/tenants" component={StaffTenants} />
      <SafeRoute path="/staff/help" component={StaffHelpCenter} />
      <SafeRoute path="/staff/reminders" component={StaffReminders} />
      <SafeRoute path="/staff/order-services" component={StaffOrderServices} />
      <SafeRoute path="/staff/tools/assets" component={StaffAssetsRegister} />
      <SafeRoute path="/staff/employee-reports" component={StaffEmployeeReports} />

      {/* Stub pages — under construction */}
      <SafeRoute path="/staff/transactions/society" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/tombstone" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/credit-notes" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/invoices" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/petty-cash" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/bank-deposits" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/debit-orders" component={StaffComingSoon} />
      <SafeRoute path="/staff/transactions/fax" component={StaffComingSoon} />
      <SafeRoute path="/staff/reports/dynamic-generic" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/easypay" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/print-policy-cards" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/statistics" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/statistical-graphs" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/claims-form" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/transport-companies" component={StaffComingSoon} />
      <SafeRoute path="/staff/tools/contacts" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/society" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/tombstones" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/invoice-items" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/agents" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/brokers" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/member-cards" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/terminals" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/branches" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/sub-groups" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/underwriters" component={StaffComingSoon} />
      <SafeRoute path="/staff/admin/undertakers" component={StaffComingSoon} />

      <SafeRoute path="/join" component={JoinPage} />
      <SafeRoute path="/join/register" component={JoinRegisterPage} />
      
      <SafeRoute path="/client/login" component={ClientLogin} />
      <SafeRoute path="/client/claim" component={ClientClaim} />
      <SafeRoute path="/client/reset-password" component={ClientResetPassword} />
      <SafeRoute path="/client" component={ClientDashboard} />
      <SafeRoute path="/client/payments" component={ClientPayments} />
      <SafeRoute path="/client/documents" component={ClientDocuments} />
      <SafeRoute path="/client/documents/view/:policyId" component={ClientDocumentView} />
      <SafeRoute path="/client/claims" component={ClientClaims} />
      <SafeRoute path="/client/feedback" component={ClientFeedback} />
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
