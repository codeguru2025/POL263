import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/error-boundary";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";

import StaffLogin from "@/pages/staff/login";
import AgentLogin from "@/pages/agent/login";
import StaffDashboard from "@/pages/staff/dashboard";
import AuditLogs from "@/pages/staff/audit";
import StaffSettings from "@/pages/staff/settings";
import ProductBuilder from "@/pages/staff/products";
import StaffPolicies from "@/pages/staff/policies";
import StaffClients from "@/pages/staff/clients";
import StaffClaims from "@/pages/staff/claims";
import StaffFunerals from "@/pages/staff/funerals";
import StaffFinance from "@/pages/staff/finance";
import StaffReports from "@/pages/staff/reports";
import StaffLeads from "@/pages/staff/leads";
import StaffNotifications from "@/pages/staff/notifications";
import StaffGroups from "@/pages/staff/groups";
import StaffApprovals from "@/pages/staff/approvals";
import StaffDiagnostics from "@/pages/staff/diagnostics";
import StaffPriceBook from "@/pages/staff/pricebook";
import StaffPayroll from "@/pages/staff/payroll";
import StaffUsers from "@/pages/staff/users";
import StaffTenants from "@/pages/staff/tenants";

import ClientLogin from "@/pages/client/login";
import ClientClaim from "@/pages/client/claim";
import ClientResetPassword from "@/pages/client/reset-password";
import ClientDashboard from "@/pages/client/dashboard";
import ClientPayments from "@/pages/client/payments";
import ClientDocuments from "@/pages/client/documents";
import ClientDocumentView from "@/pages/client/document-view";
import ClientClaims from "@/pages/client/claims";
import ClientFeedback from "@/pages/client/feedback";
import JoinPage from "@/pages/join";
import JoinRegisterPage from "@/pages/join/register";
import { useLocation } from "wouter";
import { useEffect } from "react";

function PaynowReturnRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation("/client/payments?returned=1"); }, [setLocation]);
  return null;
}

function Router() {
  return (
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
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
