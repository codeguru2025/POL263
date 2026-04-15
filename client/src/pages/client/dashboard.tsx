import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  FileText,
  AlertCircle,
  CheckCircle2,
  Shield,
  Calendar,
  DollarSign,
  Clock,
  ChevronDown,
  ChevronUp,
  Users,
  CreditCard,
  Bell,
  UserPlus,
  Receipt,
  AlertTriangle,
  Timer,
  Heart,
  KeyRound,
  Loader2,
  Trash2,
  Star,
  UserCheck,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getApiBase } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";

function ClientNotificationSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: settings } = useQuery<{ notificationTone: string; pushEnabled: boolean }>({
    queryKey: ["/api/client-auth/settings"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/settings", { credentials: "include" });
      if (!res.ok) return { notificationTone: "default", pushEnabled: false };
      return res.json();
    },
    retry: false,
  });
  const updateMutation = useMutation({
    mutationFn: async (patch: { notificationTone?: string; pushEnabled?: boolean }) => {
      await apiRequest("PATCH", "/api/client-auth/settings", patch);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/client-auth/settings"] });
      toast({ title: "Settings saved" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  if (!settings) return null;
  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <p className="text-sm font-medium text-muted-foreground">Notification preferences</p>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Label className="text-sm">Sound</Label>
          <Select
            value={settings.notificationTone}
            onValueChange={(v) => updateMutation.mutate({ notificationTone: v })}
          >
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="default">Default</SelectItem>
              <SelectItem value="silent">Silent</SelectItem>
              <SelectItem value="high">High</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-sm">Push notifications</Label>
          <Switch
            checked={settings.pushEnabled}
            onCheckedChange={(checked) => updateMutation.mutate({ pushEnabled: checked })}
          />
        </div>
      </div>
    </div>
  );
}

function ClientChangePassword() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const changeMutation = useMutation({
    mutationFn: async (body: { currentPassword: string; newPassword: string }) => {
      const res = await fetch(getApiBase() + "/api/client-auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || res.statusText || "Failed to change password");
      }
      return res.json();
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated successfully" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });
  return (
    <div className="space-y-4 p-4 border rounded-lg bg-muted/30">
      <p className="text-sm font-medium text-muted-foreground">Change your portal password</p>
      <div className="grid gap-3 max-w-sm">
        <div>
          <Label className="text-sm">Current password</Label>
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">New password (min 8 characters)</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1"
          />
        </div>
        <div>
          <Label className="text-sm">Confirm new password</Label>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="mt-1"
          />
        </div>
        <Button
          onClick={() => changeMutation.mutate({ currentPassword, newPassword })}
          disabled={
            !currentPassword ||
            newPassword.length < 8 ||
            newPassword !== confirmPassword ||
            changeMutation.isPending
          }
        >
          {changeMutation.isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...
            </>
          ) : (
            "Change password"
          )}
        </Button>
      </div>
    </div>
  );
}

function ClientNotificationsList() {
  const qc = useQueryClient();
  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/client-auth/notifications"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/notifications", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
  });

  const markRead = async (id: string) => {
    try {
      await apiRequest("PATCH", `/api/client-auth/notifications/${id}/read`);
      qc.invalidateQueries({ queryKey: ["/api/client-auth/notifications"] });
      qc.invalidateQueries({ queryKey: ["/api/client-auth/notifications/unread-count"] });
    } catch {}
  };

  if (!notifications.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Recent notifications</p>
      {notifications.slice(0, 15).map((n) => (
        <div
          key={n.id}
          className={`p-3 border rounded-lg cursor-pointer transition-colors ${!n.readAt ? "bg-primary/5 border-primary/20" : "bg-muted/50"}`}
          onClick={() => { if (!n.readAt) markRead(n.id); }}
        >
          <div className="flex items-start gap-2">
            {!n.readAt && <span className="mt-1 w-2 h-2 rounded-full bg-primary shrink-0" />}
            <div className="flex-1">
              <p className={`text-sm ${!n.readAt ? "font-semibold" : "font-medium"}`}>{n.subject || "Notification"}</p>
              <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
              <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface CreditBalance {
  policyId: string;
  policyNumber: string;
  balance: string;
  currency: string;
  premiumAmount: string;
  status: string;
}

function ClientCreditBalances() {
  const { data: balances = [] } = useQuery<CreditBalance[]>({
    queryKey: ["/api/client-auth/credit-balance"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/credit-balance", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
  });
  if (!balances.length) return null;
  return (
    <CardSection title="Policy Balances" icon={DollarSign}>
      <div className="space-y-3">
        {balances.map((b) => {
          const bal = parseFloat(b.balance);
          const premium = parseFloat(b.premiumAmount);
          return (
            <div key={b.policyId} className="p-3 border rounded-lg flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">{b.policyNumber}</p>
                <p className="text-xs text-muted-foreground capitalize">{b.status}</p>
              </div>
              <div className="text-right">
                {bal < 0 ? (
                  <p className="text-sm font-semibold text-red-600">
                    Owing: {b.currency} {Math.abs(bal).toFixed(2)}
                  </p>
                ) : bal > 0 ? (
                  <p className="text-sm font-semibold text-green-600">
                    Credit: {b.currency} {bal.toFixed(2)}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Balance: {b.currency} 0.00</p>
                )}
                <p className="text-xs text-muted-foreground">
                  Premium: {b.currency} {isNaN(premium) ? "—" : premium.toFixed(2)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </CardSection>
  );
}

function ClientCreditNotesList() {
  const { data: creditNotes = [] } = useQuery<any[]>({
    queryKey: ["/api/client-auth/credit-notes"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/credit-notes", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
  });
  if (!creditNotes.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Credit notes</p>
      {creditNotes.slice(0, 5).map((cn) => (
        <div key={cn.id} className="p-3 border rounded-lg bg-green-50 border-green-200">
          <p className="text-sm font-medium">Credit note #{cn.creditNoteNumber}</p>
          <p className="text-xs text-muted-foreground">{cn.currency} {cn.amount} — {cn.reason || "Credit to policy balance"}</p>
          <p className="text-xs text-muted-foreground mt-1">{new Date(cn.createdAt).toLocaleDateString()}</p>
        </div>
      ))}
    </div>
  );
}

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
  waitingPeriodEndDate: string | null;
  currentCycleStart: string | null;
  currentCycleEnd: string | null;
  graceEndDate: string | null;
  productVersionId: string | null;
  createdAt: string;
  balance?: string;
  totalPaid?: string;
  totalDue?: string;
  periodsElapsed?: number;
}

interface Payment {
  id: string;
  amount: string;
  currency: string;
  paymentMethod: string;
  status: string;
  reference: string | null;
  receivedAt: string;
  receiptNumber?: string;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  inactive: "bg-blue-100 text-blue-700 border-blue-200",
  grace: "bg-orange-100 text-orange-700 border-orange-200",
  lapsed: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-gray-100 text-gray-700 border-gray-200",
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

function isPolicyClaimable(policy: { status: string; waitingPeriodEndDate: string | null }): boolean {
  const today = new Date().toISOString().split("T")[0];
  const statusOk = policy.status === "active" || policy.status === "grace";
  const waitingOver = !policy.waitingPeriodEndDate || policy.waitingPeriodEndDate <= today;
  return !!(statusOk && waitingOver);
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function ClientDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expandedPolicy, setExpandedPolicy] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

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
        <PageShell>
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-6 w-96" />
          <div className="grid md:grid-cols-2 gap-6">
            <Skeleton className="h-48" />
            <Skeleton className="h-48" />
          </div>
        </PageShell>
      </ClientLayout>
    );
  }

  if (meError || !meData?.client) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
        <div className="text-center space-y-4">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto" />
          <h2 className="text-xl font-bold">Session Expired</h2>
          <p className="text-muted-foreground">Please sign in again to access your portal.</p>
          <Button onClick={() => setLocation("/client/login")} data-testid="btn-go-login">
            Sign In
          </Button>
        </div>
      </div>
    );
  }

  const client = meData.client;
  const activePolicy = policies?.find((p) => p.status === "active");
  const gracePolicy = policies?.find((p) => p.status === "grace");
  const lapsedPolicies = policies?.filter((p) => p.status === "lapsed") || [];

  return (
    <ClientLayout clientName={`${client.firstName} ${client.lastName}`} onLogout={() => logoutMutation.mutate()}>
      <PageShell className="gap-8">
        <PageHeader
          title={`Welcome back, ${client.firstName}!`}
          description="Manage your policies, view payments, and stay up to date."
          titleDataTestId="text-welcome"
        />

        {gracePolicy && (
          <div className="flex items-start gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4 shadow-sm">
            <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-orange-800">Grace Period Warning</p>
              <p className="text-sm text-orange-700 mt-1">
                Policy <strong>{gracePolicy.policyNumber}</strong> is in a grace period.
                {gracePolicy.graceEndDate && (
                  <> Grace ends {formatDate(gracePolicy.graceEndDate)} ({daysUntil(gracePolicy.graceEndDate)} days remaining).</>
                )}
                Please make a payment to avoid lapsing.
              </p>
            </div>
          </div>
        )}

        {lapsedPolicies.length > 0 && (
          <div className="flex items-start gap-3 rounded-xl border border-red-300 bg-red-50 p-4 shadow-sm">
            <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold text-red-800">Lapsed Policy</p>
              <p className="text-sm text-red-700 mt-1">
                {lapsedPolicies.length} {lapsedPolicies.length === 1 ? "policy has" : "policies have"} lapsed. Contact your agent or branch to discuss reinstatement.
              </p>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="overview" data-testid="tab-overview">
              <Shield className="h-4 w-4 mr-2" />Overview
            </TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments">
              <DollarSign className="h-4 w-4 mr-2" />Payments
            </TabsTrigger>
            <TabsTrigger value="members" data-testid="tab-members">
              <Users className="h-4 w-4 mr-2" />Members
            </TabsTrigger>
            <TabsTrigger value="notifications" data-testid="tab-notifications">
              <Bell className="h-4 w-4 mr-2" />Alerts
            </TabsTrigger>
            <TabsTrigger value="account" data-testid="tab-account">
              <KeyRound className="h-4 w-4 mr-2" />Account
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
            <div className="grid md:grid-cols-3 gap-6">
              {activePolicy ? (
                <CardSection title="Active Policy" icon={CheckCircle2} className="md:col-span-2">
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
                    {activePolicy.balance != null && (
                      <div>
                        <p className="text-sm text-muted-foreground">Balance</p>
                        <p className={`font-bold ${Number(activePolicy.balance) > 0 ? "text-emerald-600" : Number(activePolicy.balance) < 0 ? "text-red-600" : ""}`}>
                          {formatCurrency(Math.abs(Number(activePolicy.balance)).toFixed(2), activePolicy.currency)}
                          {Number(activePolicy.balance) > 0 ? " (Advance)" : Number(activePolicy.balance) < 0 ? " (Arrears)" : " (Up to date)"}
                        </p>
                      </div>
                    )}
                  </div>

                  {activePolicy.waitingPeriodEndDate && daysUntil(activePolicy.waitingPeriodEndDate) !== null && (daysUntil(activePolicy.waitingPeriodEndDate) ?? 0) > 0 && (
                    <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
                      <Timer className="h-5 w-5 text-blue-600" />
                      <div>
                        <p className="text-sm font-medium text-blue-800">Waiting Period Active</p>
                        <p className="text-xs text-blue-600">{daysUntil(activePolicy.waitingPeriodEndDate)} days remaining until {formatDate(activePolicy.waitingPeriodEndDate)}</p>
                      </div>
                    </div>
                  )}

                  <div className="mt-4">
                    <Button variant="outline" className="gap-2" data-testid="btn-pay-now" onClick={() => setLocation(`/client/payments?policyId=${activePolicy.id}`)}>
                      <CreditCard className="h-4 w-4" />
                      Pay Now
                    </Button>
                    <p className="text-xs text-muted-foreground mt-2">
                      Claimability: {isPolicyClaimable(activePolicy) ? (
                        <span className="text-emerald-600 font-medium">Eligible for claims</span>
                      ) : (
                        <span>Not yet eligible (check status or waiting period)</span>
                      )}
                    </p>
                  </div>
                </CardSection>
              ) : (
                <CardSection title="No Active Policy" icon={Shield} className="md:col-span-2">
                  <p className="text-muted-foreground">You don't have an active policy at the moment. Contact your agent for assistance.</p>
                </CardSection>
              )}

              <CardSection title="Summary" icon={FileText}>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Total Policies</span>
                    <span className="font-bold text-lg" data-testid="text-policy-count">{policies?.length ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Active</span>
                    <span className="font-medium text-green-600">{policies?.filter((p) => p.status === "active").length ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Grace</span>
                    <span className="font-medium text-orange-600">{policies?.filter((p) => p.status === "grace").length ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Lapsed</span>
                    <span className="font-medium text-red-600">{lapsedPolicies.length}</span>
                  </div>
                </div>
              </CardSection>
            </div>

            <ClientCreditBalances />

            <CardSection title="All Policies" icon={Shield}>
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
            </CardSection>
          </TabsContent>

          <TabsContent value="payments" className="space-y-6 mt-6">
            <CardSection title="Payment History" icon={Receipt}>
              {policies?.map((policy) => (
                <PaymentSection key={policy.id} policy={policy} />
              ))}
              {(!policies || policies.length === 0) && (
                <p className="text-muted-foreground text-center py-8">No policies found.</p>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="members" className="space-y-6 mt-6">
            <DependentsSection clientId={client.id} />
            {policies?.map((policy) => (
              <BeneficiarySection key={policy.id} policy={policy} clientId={client.id} />
            ))}
            {(!policies || policies.length === 0) && (
              <p className="text-muted-foreground text-center py-8">No policies found.</p>
            )}
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6 mt-6">
            <CardSection title="Notifications & Alerts" icon={Bell}>
              <div className="space-y-3">
                {gracePolicy && (
                  <div className="p-4 border rounded-lg bg-orange-50 border-orange-200 flex items-start gap-3" data-testid="alert-grace">
                    <AlertTriangle className="h-5 w-5 text-orange-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-orange-800">Grace Period - {gracePolicy.policyNumber}</p>
                      <p className="text-sm text-orange-700 mt-1">Your policy is in grace. Pay before {formatDate(gracePolicy.graceEndDate)} to avoid lapsing.</p>
                    </div>
                  </div>
                )}
                {activePolicy?.waitingPeriodEndDate && (daysUntil(activePolicy.waitingPeriodEndDate) ?? 0) > 0 && (
                  <div className="p-4 border rounded-lg bg-blue-50 border-blue-200 flex items-start gap-3" data-testid="alert-waiting">
                    <Timer className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-medium text-blue-800">Waiting Period Active</p>
                      <p className="text-sm text-blue-700 mt-1">{daysUntil(activePolicy.waitingPeriodEndDate)} days remaining on your waiting period.</p>
                    </div>
                  </div>
                )}
                <ClientNotificationsList />
                <ClientCreditNotesList />
                <ClientNotificationSettings />
                {!gracePolicy && !(activePolicy?.waitingPeriodEndDate && (daysUntil(activePolicy.waitingPeriodEndDate) ?? 0) > 0) && (
                  <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-3">
                    <Heart className="h-8 w-8 text-green-500" />
                    <p>All clear! You have no alerts at this time.</p>
                  </div>
                )}
              </div>
            </CardSection>
          </TabsContent>

          <TabsContent value="account" className="space-y-6 mt-6">
            <CardSection title="Account &amp; security" description="Change your client portal password." icon={KeyRound}>
              <ClientChangePassword />
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

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

          {policy.waitingPeriodEndDate && (daysUntil(policy.waitingPeriodEndDate) ?? 0) > 0 && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
              <Timer className="h-4 w-4 text-blue-600" />
              <p className="text-sm text-blue-700">Waiting period: {daysUntil(policy.waitingPeriodEndDate)} days remaining</p>
            </div>
          )}

          <div>
            <h4 className="font-medium text-sm mb-3 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Recent Payments
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
                    {payments.slice(0, 5).map((p) => (
                      <tr key={p.id} className="border-t" data-testid={`row-payment-${p.id}`}>
                        <td className="p-2">{formatDate(p.receivedAt)}</td>
                        <td className="p-2 font-medium">{formatCurrency(p.amount, p.currency)}</td>
                        <td className="p-2 capitalize">{p.paymentMethod?.replace(/_/g, " ") || "—"}</td>
                        <td className="p-2">
                          <Badge variant="outline" className={p.status === "cleared" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}>
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

function PaymentSection({ policy }: { policy: Policy }) {
  const { data: payments, isLoading } = useQuery<Payment[]>({
    queryKey: [`/api/client-auth/policies/${policy.id}/payments`],
    retry: false,
  });

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Badge variant="outline" className={statusColors[policy.status] || "bg-gray-100"}>{formatStatus(policy.status)}</Badge>
        <span className="font-medium text-sm">{policy.policyNumber}</span>
        <span className="text-xs text-muted-foreground">— {formatCurrency(policy.premiumAmount, policy.currency)} / {policy.paymentSchedule}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !payments || payments.length === 0 ? (
        <p className="text-muted-foreground text-sm py-4 text-center">No payments for this policy.</p>
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
                <tr key={p.id} className="border-t">
                  <td className="p-2">{formatDate(p.receivedAt)}</td>
                  <td className="p-2 font-medium">{formatCurrency(p.amount, p.currency)}</td>
                  <td className="p-2 capitalize">{p.paymentMethod?.replace(/_/g, " ") || "—"}</td>
                  <td className="p-2">
                    <Badge variant="outline" className={p.status === "cleared" ? "bg-green-50 text-green-700" : "bg-yellow-50 text-yellow-700"}>
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
  );
}

interface DependentItem {
  id: string;
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth: string | null;
  nationalId: string | null;
  gender: string | null;
  isActive: boolean;
}

interface Beneficiary {
  firstName: string;
  lastName: string;
  relationship: string | null;
  nationalId: string | null;
  phone: string | null;
  dependentId: string | null;
}

function DependentsSection({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "" });

  const { data: dependents = [], isLoading } = useQuery<DependentItem[]>({
    queryKey: ["/api/client-auth/dependents"],
    retry: false,
  });

  const addMutation = useMutation({
    mutationFn: async (body: typeof form) => {
      const res = await fetch(getApiBase() + "/api/client-auth/dependents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Failed to add dependent");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/client-auth/dependents"] });
      setShowForm(false);
      setForm({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "" });
      toast({ title: "Dependent added" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(getApiBase() + `/api/client-auth/dependents/${id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove dependent");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/client-auth/dependents"] });
      toast({ title: "Dependent removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <CardSection title="Dependents" description="People covered under your policies" icon={Users} headerRight={<Button size="sm" variant="outline" className="gap-2" onClick={() => setShowForm(!showForm)} data-testid="btn-add-dependent"><UserPlus className="h-4 w-4" />Add Dependent</Button>}>
      <div className="space-y-4">
        {showForm && (
          <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
            <p className="text-sm font-medium">Add a new dependent</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name *</Label>
                <Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} data-testid="input-dep-first-name" />
              </div>
              <div>
                <Label>Last Name *</Label>
                <Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} data-testid="input-dep-last-name" />
              </div>
            </div>
            <div>
              <Label>Relationship *</Label>
              <Select value={form.relationship} onValueChange={(v) => setForm({ ...form, relationship: v })}>
                <SelectTrigger data-testid="select-dep-relationship"><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="spouse">Spouse</SelectItem>
                  <SelectItem value="child">Child</SelectItem>
                  <SelectItem value="parent">Parent</SelectItem>
                  <SelectItem value="sibling">Sibling</SelectItem>
                  <SelectItem value="extended">Extended Family</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date of Birth</Label>
                <Input type="date" value={form.dateOfBirth} onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })} data-testid="input-dep-dob" />
              </div>
              <div>
                <Label>National ID</Label>
                <Input value={form.nationalId} onChange={(e) => setForm({ ...form, nationalId: e.target.value })} data-testid="input-dep-national-id" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!form.firstName || !form.lastName || !form.relationship || addMutation.isPending}
                onClick={() => addMutation.mutate(form)}
                data-testid="btn-save-dependent"
              >
                {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                Save Dependent
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <Skeleton className="h-20 w-full" />
        ) : dependents.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-6">No dependents added yet. Click "Add Dependent" to get started.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-3">
            {dependents.map((dep) => (
              <div key={dep.id} className="p-3 border rounded-lg flex items-center gap-3" data-testid={`dependent-${dep.id}`}>
                <div className="p-2 rounded-full bg-muted text-muted-foreground">
                  <Users className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{dep.firstName} {dep.lastName}</p>
                  <p className="text-xs text-muted-foreground capitalize">{dep.relationship}</p>
                  {dep.dateOfBirth && <p className="text-xs text-muted-foreground">DOB: {formatDate(dep.dateOfBirth)}</p>}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => removeMutation.mutate(dep.id)}
                  disabled={removeMutation.isPending}
                  data-testid={`btn-remove-dep-${dep.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </CardSection>
  );
}

function BeneficiarySection({ policy, clientId }: { policy: Policy; clientId: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [benForm, setBenForm] = useState({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" });

  const { data: beneficiary, isLoading: benLoading } = useQuery<Beneficiary | null>({
    queryKey: [`/api/client-auth/policies/${policy.id}/beneficiary`],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/client-auth/policies/${policy.id}/beneficiary`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
    retry: false,
  });

  const { data: dependents = [] } = useQuery<DependentItem[]>({
    queryKey: ["/api/client-auth/dependents"],
    retry: false,
  });

  const setBeneficiaryMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch(getApiBase() + `/api/client-auth/policies/${policy.id}/beneficiary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.message || "Failed to set beneficiary");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/client-auth/policies/${policy.id}/beneficiary`] });
      setShowForm(false);
      setBenForm({ firstName: "", lastName: "", relationship: "", nationalId: "", phone: "" });
      toast({ title: "Beneficiary updated" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const removeBeneficiaryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(getApiBase() + `/api/client-auth/policies/${policy.id}/beneficiary`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to remove beneficiary");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/client-auth/policies/${policy.id}/beneficiary`] });
      toast({ title: "Beneficiary removed" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const appointDependent = (depId: string) => {
    setBeneficiaryMutation.mutate({ dependentId: depId });
  };

  return (
    <CardSection title={`Beneficiary — ${policy.policyNumber}`} description="The person who receives the payout for this policy (max 1)" icon={Star} headerRight={<Badge variant="outline" className={statusColors[policy.status] || "bg-gray-100"}>{formatStatus(policy.status)}</Badge>}>
      <div className="space-y-4">
        {benLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : beneficiary ? (
          <div className="p-4 border rounded-lg bg-amber-50/50 border-amber-200 flex items-center gap-3">
            <div className="p-2 rounded-full bg-amber-100 text-amber-700">
              <UserCheck className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{beneficiary.firstName} {beneficiary.lastName}</p>
              <p className="text-sm text-muted-foreground capitalize">
                {beneficiary.relationship || "Beneficiary"}
                {beneficiary.dependentId ? " (from dependents)" : ""}
              </p>
              {beneficiary.nationalId && <p className="text-xs text-muted-foreground">ID: {beneficiary.nationalId}</p>}
              {beneficiary.phone && <p className="text-xs text-muted-foreground">Phone: {beneficiary.phone}</p>}
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => removeBeneficiaryMutation.mutate()}
              disabled={removeBeneficiaryMutation.isPending}
              data-testid={`btn-remove-beneficiary-${policy.id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm text-center py-4">No beneficiary set for this policy.</p>
        )}

        {!beneficiary && dependents.length > 0 && (
          <div>
            <p className="text-sm font-medium mb-2">Appoint a dependent as beneficiary</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {dependents.map((dep) => (
                <button
                  key={dep.id}
                  className="p-3 border rounded-lg text-left hover:bg-primary/5 hover:border-primary/30 transition-colors flex items-center gap-3"
                  onClick={() => appointDependent(dep.id)}
                  disabled={setBeneficiaryMutation.isPending}
                  data-testid={`btn-appoint-dep-${dep.id}`}
                >
                  <div className="p-1.5 rounded-full bg-muted text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{dep.firstName} {dep.lastName}</p>
                    <p className="text-xs text-muted-foreground capitalize">{dep.relationship}</p>
                  </div>
                  <span className="text-xs text-primary font-medium">Appoint</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {!beneficiary && (
          <>
            {!showForm ? (
              <Button size="sm" variant="outline" className="gap-2" onClick={() => setShowForm(true)} data-testid={`btn-add-beneficiary-${policy.id}`}>
                <UserPlus className="h-4 w-4" />
                {dependents.length > 0 ? "Or enter beneficiary manually" : "Add Beneficiary"}
              </Button>
            ) : (
              <div className="p-4 border rounded-lg bg-muted/30 space-y-3">
                <p className="text-sm font-medium">Enter beneficiary details</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>First Name *</Label>
                    <Input value={benForm.firstName} onChange={(e) => setBenForm({ ...benForm, firstName: e.target.value })} data-testid="input-ben-first-name" />
                  </div>
                  <div>
                    <Label>Last Name *</Label>
                    <Input value={benForm.lastName} onChange={(e) => setBenForm({ ...benForm, lastName: e.target.value })} data-testid="input-ben-last-name" />
                  </div>
                </div>
                <div>
                  <Label>Relationship</Label>
                  <Select value={benForm.relationship} onValueChange={(v) => setBenForm({ ...benForm, relationship: v })}>
                    <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="spouse">Spouse</SelectItem>
                      <SelectItem value="child">Child</SelectItem>
                      <SelectItem value="parent">Parent</SelectItem>
                      <SelectItem value="sibling">Sibling</SelectItem>
                      <SelectItem value="extended">Extended Family</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>National ID</Label>
                    <Input value={benForm.nationalId} onChange={(e) => setBenForm({ ...benForm, nationalId: e.target.value })} data-testid="input-ben-national-id" />
                  </div>
                  <div>
                    <Label>Phone</Label>
                    <Input value={benForm.phone} onChange={(e) => setBenForm({ ...benForm, phone: e.target.value })} data-testid="input-ben-phone" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    disabled={!benForm.firstName || !benForm.lastName || setBeneficiaryMutation.isPending}
                    onClick={() => setBeneficiaryMutation.mutate(benForm)}
                    data-testid="btn-save-beneficiary"
                  >
                    {setBeneficiaryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Save Beneficiary
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </CardSection>
  );
}
