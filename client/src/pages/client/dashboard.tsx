import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import ClientLayout from "@/components/layout/client-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
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

function ClientNotificationsList() {
  const { data: notifications = [] } = useQuery<any[]>({
    queryKey: ["/api/client-auth/notifications"],
    queryFn: async () => {
      const res = await fetch(getApiBase() + "/api/client-auth/notifications", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    retry: false,
  });
  if (!notifications.length) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-muted-foreground">Recent notifications</p>
      {notifications.slice(0, 10).map((n) => (
        <div key={n.id} className="p-3 border rounded-lg bg-muted/50">
          <p className="text-sm font-medium">{n.subject || "Notification"}</p>
          <p className="text-xs text-muted-foreground mt-1">{n.body}</p>
          <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>
        </div>
      ))}
    </div>
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

interface PolicyMember {
  id: string;
  role: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | null;
  relationship: string | null;
  isActive: boolean;
}

const statusColors: Record<string, string> = {
  active: "bg-green-100 text-green-700 border-green-200",
  draft: "bg-gray-100 text-gray-700 border-gray-200",
  pending: "bg-yellow-100 text-yellow-700 border-yellow-200",
  grace: "bg-orange-100 text-orange-700 border-orange-200",
  lapsed: "bg-red-100 text-red-700 border-red-200",
  cancelled: "bg-red-100 text-red-700 border-red-200",
  reinstatement_pending: "bg-blue-100 text-blue-700 border-blue-200",
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
  const [depRequestOpen, setDepRequestOpen] = useState(false);
  const [depForm, setDepForm] = useState({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "", notes: "" });

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
  const gracePolicy = policies?.find((p) => p.status === "grace");
  const lapsedPolicies = policies?.filter((p) => p.status === "lapsed") || [];

  return (
    <ClientLayout clientName={`${client.firstName} ${client.lastName}`} onLogout={() => logoutMutation.mutate()}>
      <div className="space-y-8">
        <div>
          <h1 className="text-3xl font-display font-bold" data-testid="text-welcome">
            Welcome back, {client.firstName}!
          </h1>
          <p className="text-muted-foreground mt-1">
            Manage your policies, view payments, and stay up to date.
          </p>
        </div>

        {gracePolicy && (
          <Card className="border-orange-300 bg-orange-50 shadow-sm">
            <CardContent className="pt-4 flex items-start gap-3">
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
            </CardContent>
          </Card>
        )}

        {lapsedPolicies.length > 0 && (
          <Card className="border-red-300 bg-red-50 shadow-sm">
            <CardContent className="pt-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-red-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-red-800">Lapsed Policy</p>
                <p className="text-sm text-red-700 mt-1">
                  {lapsedPolicies.length} {lapsedPolicies.length === 1 ? "policy has" : "policies have"} lapsed. Contact your agent or branch to discuss reinstatement.
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-4">
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
          </TabsList>

          <TabsContent value="overview" className="space-y-6 mt-6">
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
                    <span className="text-sm text-muted-foreground">Grace</span>
                    <span className="font-medium text-orange-600">{policies?.filter((p) => p.status === "grace").length ?? 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-muted-foreground">Lapsed</span>
                    <span className="font-medium text-red-600">{lapsedPolicies.length}</span>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5" />
                  All Policies
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
          </TabsContent>

          <TabsContent value="payments" className="space-y-6 mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Receipt className="h-5 w-5" />
                  Payment History
                </CardTitle>
              </CardHeader>
              <CardContent>
                {policies?.map((policy) => (
                  <PaymentSection key={policy.id} policy={policy} />
                ))}
                {(!policies || policies.length === 0) && (
                  <p className="text-muted-foreground text-center py-8">No policies found.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="members" className="space-y-6 mt-6">
            <Card className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Covered Members
                </CardTitle>
                <Button size="sm" variant="outline" className="gap-2" onClick={() => setDepRequestOpen(true)} data-testid="btn-add-dependent">
                  <UserPlus className="h-4 w-4" />
                  Request to Add Dependent
                </Button>
              </CardHeader>
              <CardContent>
                {policies?.map((policy) => (
                  <MemberSection key={policy.id} policy={policy} />
                ))}
                {(!policies || policies.length === 0) && (
                  <p className="text-muted-foreground text-center py-8">No policies found.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notifications" className="space-y-6 mt-6">
            <Card className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Bell className="h-5 w-5" />
                  Notifications & Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      <Dialog open={depRequestOpen} onOpenChange={setDepRequestOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Request to Add Dependent</DialogTitle>
            <DialogDescription>Submit a request to add a new dependent. An administrator will review and approve your request.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={depForm.firstName} onChange={(e) => setDepForm({ ...depForm, firstName: e.target.value })} data-testid="input-dep-first-name" />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input value={depForm.lastName} onChange={(e) => setDepForm({ ...depForm, lastName: e.target.value })} data-testid="input-dep-last-name" />
              </div>
            </div>
            <div>
              <Label>Relationship</Label>
              <Select value={depForm.relationship} onValueChange={(v) => setDepForm({ ...depForm, relationship: v })}>
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
                <Input type="date" value={depForm.dateOfBirth} onChange={(e) => setDepForm({ ...depForm, dateOfBirth: e.target.value })} data-testid="input-dep-dob" />
              </div>
              <div>
                <Label>National ID</Label>
                <Input value={depForm.nationalId} onChange={(e) => setDepForm({ ...depForm, nationalId: e.target.value })} data-testid="input-dep-national-id" />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={depForm.notes} onChange={(e) => setDepForm({ ...depForm, notes: e.target.value })} placeholder="Any additional information..." data-testid="input-dep-notes" />
            </div>
            <Button className="w-full" data-testid="btn-submit-dep-request" onClick={() => {
              toast({ title: "Request Submitted", description: "Your dependent request has been submitted for review." });
              setDepRequestOpen(false);
              setDepForm({ firstName: "", lastName: "", relationship: "", dateOfBirth: "", nationalId: "", notes: "" });
            }}>
              Submit Request
            </Button>
          </div>
        </DialogContent>
      </Dialog>
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

function MemberSection({ policy }: { policy: Policy }) {
  const { data: members, isLoading } = useQuery<PolicyMember[]>({
    queryKey: [`/api/client-auth/policies/${policy.id}/members`],
    retry: false,
  });

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Badge variant="outline" className={statusColors[policy.status] || "bg-gray-100"}>{formatStatus(policy.status)}</Badge>
        <span className="font-medium text-sm">{policy.policyNumber}</span>
      </div>
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !members || members.length === 0 ? (
        <p className="text-muted-foreground text-sm py-4 text-center">No members on this policy.</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {members.map((m) => (
            <div key={m.id} className="p-3 border rounded-lg flex items-center gap-3" data-testid={`member-${m.id}`}>
              <div className={`p-2 rounded-full ${m.role === "primary" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                <Users className="h-4 w-4" />
              </div>
              <div>
                <p className="font-medium text-sm">{m.firstName} {m.lastName}</p>
                <p className="text-xs text-muted-foreground capitalize">{m.role}{m.relationship ? ` — ${m.relationship}` : ""}</p>
                {m.dateOfBirth && <p className="text-xs text-muted-foreground">DOB: {formatDate(m.dateOfBirth)}</p>}
              </div>
              {!m.isActive && <Badge variant="outline" className="ml-auto text-xs bg-red-50 text-red-600">Inactive</Badge>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
