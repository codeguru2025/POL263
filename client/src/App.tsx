import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Home from "@/pages/home";
import StaffLogin from "@/pages/staff/login";
import StaffDashboard from "@/pages/staff/dashboard";
import AuditLogs from "@/pages/staff/audit";
import StaffSettings from "@/pages/staff/settings";
import ClientDashboard from "@/pages/client/dashboard";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/staff/login" component={StaffLogin} />
      <Route path="/staff" component={StaffDashboard} />
      <Route path="/staff/audit" component={AuditLogs} />
      <Route path="/staff/settings" component={StaffSettings} />
      
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