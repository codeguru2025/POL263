import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";

// Staff Portal
import StaffLogin from "@/pages/staff/login";
import StaffDashboard from "@/pages/staff/dashboard";
import AuditLogs from "@/pages/staff/audit";
import StaffSettings from "@/pages/staff/settings";
import ProductBuilder from "@/pages/staff/products";
import StaffPolicies from "@/pages/staff/policies";
import StaffClients from "@/pages/staff/clients";
import StaffClaims from "@/pages/staff/claims";
import StaffFunerals from "@/pages/staff/funerals";

// Client Portal
import ClientLogin from "@/pages/client/login";
import ClientClaim from "@/pages/client/claim";
import ClientDashboard from "@/pages/client/dashboard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      
      {/* Staff Routes */}
      <Route path="/staff/login" component={StaffLogin} />
      <Route path="/staff" component={StaffDashboard} />
      <Route path="/staff/audit" component={AuditLogs} />
      <Route path="/staff/settings" component={StaffSettings} />
      <Route path="/staff/products" component={ProductBuilder} />
      <Route path="/staff/policies" component={StaffPolicies} />
      <Route path="/staff/clients" component={StaffClients} />
      <Route path="/staff/claims" component={StaffClaims} />
      <Route path="/staff/funerals" component={StaffFunerals} />
      
      {/* Client Routes */}
      <Route path="/client/login" component={ClientLogin} />
      <Route path="/client/claim" component={ClientClaim} />
      <Route path="/client" component={ClientDashboard} />
      <Route path="/client/leases" component={ClientDashboard} />
      <Route path="/client/messages" component={ClientDashboard} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;