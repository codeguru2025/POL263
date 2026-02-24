import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FileText,
  AlertCircle,
  CheckCircle2,
  Shield,
  Calendar,
  DollarSign,
  Clock,
  LogOut,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ClientInfo {
  client: {
    id: string;
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
  };
}

interface Policy {
  id: string;
  policyNumber: string;
  status: string;
  premiumAmount: string;
  currency: string;
  paymentSchedule: string;
  effectiveDate: string | null;
  currentCycleStart: string | null;
  currentCycleEnd: string | null;
  graceEndDate: string | null;
  createdAt: string;
}

interface Payment {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  status: string;
  reference: string | null;
  receivedAt: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  pending_activation: "bg-yellow-100 text-yellow-700 border-yellow-200",
  in_waiting_period: "bg-blue-100 text-blue-700 border-blue-200",
  lapsed: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
  suspended: "bg-orange-100 text-orange-700 border-orange-200",
};

function formatStatus(status: string) {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-ZA", { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(amount: string, currency: string) {
  const num = parseFloat(amount);
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(num);
}

export default function ClientDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);

  const { data: meData, isLoading: meLoading, error: meError } = useQuery<ClientInfo>({
    queryKey: ["/api/client-auth/me"],
    retry: false,
  });

  const { data: policies, isLoading: policiesLoading } = useQuery<Policy[]>({
    queryKey: ["/api/client-auth/policies"],
    enabled: !!meData?.client,
    retry: false,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/client-auth/logout");
    },
    onSuccess: () => {
      qc.clear();
      setLocation("/client/login");
    },
  });

  if (meLoading) {
    return (
      <ClientLayout clientName="Loading...">
        <div className="space-y-6">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="grid md:grid-cols-2 gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </div>
      </ClientLayout>
    );
  }

  if (meError || !meData?.client) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-lg">
          <CardContent className="pt-6 text-center space-y-4">
            <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
            <h2 className="text-xl font-bold">Session Expired</h2>
            <p className="text-muted-foreground">Please sign in again to access your portal.</p>
            <Button onClick={() => setLocation("/client/login")} data-testid="btn-go-login">
              Sign In
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const client = meData.client;
  const activePolicy = policies?.find((p) => p.status === "active");

  return (
    <ClientLayout clientName={`${client.firstName} ${client.lastName}`} onLogout={() => logoutMutation.mutate()}>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold" data-testid="text-welcome">
            Welcome back, {client.firstName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Here is a quick overview of your policies and payments.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {activePolicy ? (
            <Card className="md:col-span-2 border-primary/20 bg-primary/5 shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                  Active Policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Policy Number</p>
                    <p className="font-medium" data-testid="text-active-policy-number">{activePolicy.policyNumber}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Premium</p>
                    <p className="font-medium">{formatCurrency(activePolicy.premiumAmount, activePolicy.currency)} / {activePolicy.paymentSchedule}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Effective Since</p>
                    <p className="font-medium">{formatDate(activePolicy.effectiveDate)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Current Cycle</p>
                    <p className="font-medium">{formatDate(activePolicy.currentCycleStart)} — {formatDate(activePolicy.currentCycleEnd)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="md:col-span-2 border-muted shadow-sm">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Shield className="h-5 w-5 text-muted-foreground" />
                  No Active Policy
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">You don't have an active policy at the moment. Contact your agent for assistance.</p>
              </CardContent>
            </Card>
          )}

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Total Policies</span>
                <span className="font-bold text-lg" data-testid="text-policy-count">{policies?.length ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Active</span>
                <span className="font-medium text-green-600">{policies?.filter((p) => p.status === "active").length ?? 0}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Other</span>
                <span className="font-medium">{policies?.filter((p) => p.status !== "active").length ?? 0}</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              My Policies
            </CardTitle>
          </CardHeader>
          <CardContent>
            {policiesLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : !policies || policies.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No policies found.</p>
            ) : (
              <div className="space-y-3">
                {policies.map((policy) => (
                  <PolicyCard
                    key={policy.id}
                    policy={policy}
                    isExpanded={expandedPolicy === policy.id}
                    onToggle={() => setExpandedPolicy(expandedPolicy === policy.id ? null : policy.id)}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </ClientLayout>
  );
}

function PolicyCard({ policy, isExpanded, onToggle }: { policy: Policy; isExpanded: boolean; onToggle: () => void }) {
  const { data: payments, isLoading: paymentsLoading } = useQuery<Payment[]>({
    queryKey: [`/api/client-auth/policies/${policy.id}/payments`],
    enabled: isExpanded,
    retry: false,
  });

  return (
    <div className="border rounded-lg" data-testid={`card-policy-${policy.id}`}>
      <button
        className="w-full flex items-center justify-between p-4 hover:bg-muted/50 transition-colors text-left"
        onClick={onToggle}
        data-testid={`btn-toggle-policy-${policy.id}`}
      >
        <div className="flex items-center gap-4">
          <div className="p-2 bg-primary/10 text-primary rounded-md">
            <Shield className="h-4 w-4" />
          </div>
          <div>
            <p className="font-medium text-sm">{policy.policyNumber}</p>
            <p className="text-xs text-muted-foreground">
              {formatCurrency(policy.premiumAmount, policy.currency)} / {policy.paymentSchedule}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className={statusColors[policy.status] || "bg-gray-100 text-gray-700"}>
            {formatStatus(policy.status)}
          </Badge>
          {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t p-4 space-y-4 animate-in fade-in slide-in-from-top-2">
          <div className="grid sm:grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Effective Date</p>
                <p className="font-medium">{formatDate(policy.effectiveDate)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Cycle End</p>
                <p className="font-medium">{formatDate(policy.currentCycleEnd)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
              <div>
                <p className="text-muted-foreground">Grace End</p>
                <p className="font-medium">{formatDate(policy.graceEndDate)}</p>
              </div>
            </div>
          </div>

          <div>
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Payment History
            </h4>
            {paymentsLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : !payments || payments.length === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-4">No payments recorded yet.</p>
            ) : (
              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Date</th>
                      <th className="text-left p-2 font-medium">Amount</th>
                      <th className="text-left p-2 font-medium">Method</th>
                      <th className="text-left p-2 font-medium">Status</th>
                      <th className="text-left p-2 font-medium">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((p) => (
                      <tr key={p.id} className="border-t" data-testid={`row-payment-${p.id}`}>
                        <td className="p-2">{formatDate(p.receivedAt)}</td>
                        <td className="p-2 font-medium">{formatCurrency(p.amount, p.currency)}</td>
                        <td className="p-2 capitalize">{p.paymentMethod.replace(/_/g, " ")}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={p.status === "completed" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}>
                            {formatStatus(p.status)}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground">{p.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
