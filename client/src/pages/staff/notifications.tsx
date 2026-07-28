import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Bell, Plus, Loader2, Pencil, Trash2, Send, Tag } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

interface MergeTag { tag: string; description: string; example: string }
interface EventType { value: string; label: string }
interface PaymentAutomationSettings {
  isEnabled: boolean;
  daysAfterLastPayment: number;
  repeatEveryDays: number;
  sendPushNotifications: boolean;
  autoRunPayments: boolean;
}

function MergeTagPicker({ tags, onInsert }: { tags: MergeTag[]; onInsert: (tag: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setOpen(!open)}>
        <Tag className="h-3 w-3" /> Insert Tag
      </Button>
      {open && (
        <div className="absolute z-50 mt-1 w-80 max-h-64 overflow-y-auto bg-popover border rounded-md shadow-lg p-1">
          {tags.map((t) => (
            <button
              key={t.tag}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted rounded-sm text-sm flex justify-between items-center gap-2"
              onClick={() => { onInsert(t.tag); setOpen(false); }}
            >
              <div>
                <code className="text-xs font-mono bg-muted px-1 rounded">{t.tag}</code>
                <span className="ml-2 text-muted-foreground text-xs">{t.description}</span>
              </div>
              <span className="text-xs text-muted-foreground italic shrink-0">{t.example}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function StaffNotifications() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showDialog, setShowDialog] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  const [formName, setFormName] = useState("");
  const [formEvent, setFormEvent] = useState("policy_capture");
  const [formChannel, setFormChannel] = useState("in_app");
  const [formSubject, setFormSubject] = useState("");
  const [formBody, setFormBody] = useState("");

  const [bcSubject, setBcSubject] = useState("");
  const [bcBody, setBcBody] = useState("");
  const [autoSettings, setAutoSettings] = useState<PaymentAutomationSettings>({
    isEnabled: false,
    daysAfterLastPayment: 0,
    repeatEveryDays: 30,
    sendPushNotifications: true,
    autoRunPayments: true,
  });

  const { data: templates = [], isLoading } = useQuery<any[]>({ queryKey: ["/api/notification-templates"] });
  const { data: automationRuns = [] } = useQuery<any[]>({ queryKey: ["/api/payment-automation-runs"] });
  const { data: paymentAutomationSettings } = useQuery<PaymentAutomationSettings>({
    queryKey: ["/api/payment-automation-settings"],
    queryFn: async () => {
      const res = await fetch("/api/payment-automation-settings", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load automation settings");
      return res.json();
    },
  });
  useEffect(() => {
    if (!paymentAutomationSettings) return;
    setAutoSettings({
      isEnabled: !!paymentAutomationSettings.isEnabled,
      daysAfterLastPayment: Number(paymentAutomationSettings.daysAfterLastPayment ?? 0),
      repeatEveryDays: Number(paymentAutomationSettings.repeatEveryDays || 30),
      sendPushNotifications: paymentAutomationSettings.sendPushNotifications !== false,
      autoRunPayments: paymentAutomationSettings.autoRunPayments !== false,
    });
  }, [paymentAutomationSettings]);
  const { data: meta } = useQuery<{ mergeTags: MergeTag[]; eventTypes: EventType[] }>({
    queryKey: ["/api/notification-merge-tags"],
  });

  const mergeTags = meta?.mergeTags || [];
  const eventTypes = meta?.eventTypes || [];

  const resetForm = () => {
    setFormName(""); setFormEvent("policy_capture"); setFormChannel("in_app");
    setFormSubject(""); setFormBody(""); setEditId(null);
  };

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      if (editId) {
        const res = await apiRequest("PUT", `/api/notification-templates/${editId}`, data);
        return res.json();
      }
      const res = await apiRequest("POST", "/api/notification-templates", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] });
      setShowDialog(false);
      resetForm();
      toast({ title: editId ? "Template updated" : "Template created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/notification-templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] });
      toast({ title: "Template deleted" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const res = await apiRequest("PUT", `/api/notification-templates/${id}`, { isActive });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] }),
  });

  const broadcastMutation = useMutation({
    mutationFn: async (data: { subject: string; body: string }) => {
      const res = await apiRequest("POST", "/api/admin/notifications/broadcast", data);
      return res.json();
    },
    onSuccess: (data) => {
      setShowBroadcast(false);
      setBcSubject(""); setBcBody("");
      toast({ title: "Broadcast sent", description: `Sent to ${data.sent} clients` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const saveAutomationMutation = useMutation({
    mutationFn: async (data: PaymentAutomationSettings) => {
      const res = await apiRequest("PUT", "/api/payment-automation-settings", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payment-automation-settings"] });
      toast({ title: "Automation settings saved" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const runAutomationNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/run-payment-automation", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Automation run complete",
        description: `Scanned ${data.scanned}, reminded ${data.reminded}, mobile payment prompts started ${data.attempted}, skipped ${data.skipped ?? 0}`,
      });
    },
    onError: (err: any) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const runLapseSweepNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/run-policy-lapse-sweep", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({
        title: "Policy lapse sweep complete",
        description: `${data.movedToGrace} moved to grace, ${data.movedToLapsed} moved to lapsed${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`,
      });
    },
    onError: (err: any) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const runNotificationDigestNowMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/run-notifications", {});
      return res.json();
    },
    onSuccess: (data: any) => {
      if (data.orgsAlreadyRanToday) {
        toast({
          title: "Already sent today",
          description: "Today's digest already went out (scheduled run or an earlier click) — skipped to avoid double-sending the same birthday/anniversary/premium-due emails. It'll run again tomorrow, or automatically at 05:00 UTC.",
        });
        return;
      }
      toast({
        title: "Notification digest complete",
        description: `${data.birthdayCount} birthday, ${data.anniversaryCount} anniversary, ${data.premiumDueCount} premium-due, ${data.preLapseCount} pre-lapse, ${data.lapseCount} lapsed${data.errors?.length ? `, ${data.errors.length} error(s)` : ""}`,
      });
    },
    onError: (err: any) => toast({ title: "Run failed", description: err.message, variant: "destructive" }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name: formName, eventType: formEvent, channel: formChannel,
      subject: formSubject || undefined, bodyTemplate: formBody,
    });
  };

  const openEdit = (t: any) => {
    setEditId(t.id); setFormName(t.name); setFormEvent(t.eventType);
    setFormChannel(t.channel); setFormSubject(t.subject || "");
    setFormBody(t.bodyTemplate); setShowDialog(true);
  };

  const insertTag = (tag: string) => {
    if (bodyRef.current) {
      const ta = bodyRef.current;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const newVal = formBody.substring(0, start) + tag + formBody.substring(end);
      setFormBody(newVal);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(start + tag.length, start + tag.length); }, 50);
    } else {
      setFormBody(formBody + tag);
    }
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Notifications"
          description="Configure message templates with dynamic content for all policy events"
          titleDataTestId="text-notifications-title"
          actions={(
          <div className="flex flex-wrap gap-2">
            <Dialog open={showBroadcast} onOpenChange={setShowBroadcast}>
              <DialogTrigger asChild>
                <Button variant="outline" className="gap-2"><Send className="h-4 w-4" />Broadcast</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Send Broadcast</DialogTitle>
                  <DialogDescription>Send a notification to all clients. Use merge tags for dynamic content.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div><Label>Subject</Label><Input value={bcSubject} onChange={e => setBcSubject(e.target.value)} placeholder="Important notice from {org_name}" /></div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Message</Label>
                      <MergeTagPicker tags={mergeTags} onInsert={(t) => setBcBody(bcBody + t)} />
                    </div>
                    <Textarea value={bcBody} onChange={e => setBcBody(e.target.value)} rows={5} placeholder="Dear {client_name}, ..." />
                  </div>
                  <Button onClick={() => broadcastMutation.mutate({ subject: bcSubject, body: bcBody })} disabled={broadcastMutation.isPending || !bcSubject || !bcBody}>
                    {broadcastMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Send to All Clients
                  </Button>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showDialog} onOpenChange={(v) => { setShowDialog(v); if (!v) resetForm(); }}>
              <DialogTrigger asChild>
                <Button data-testid="button-new-template"><Plus className="h-4 w-4 mr-2" />{editId ? "Edit" : "New"} Template</Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>{editId ? "Edit" : "Create"} Notification Template</DialogTitle>
                  <DialogDescription>Configure when and what messages are sent to clients.</DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div><Label>Template Name</Label><Input value={formName} onChange={e => setFormName(e.target.value)} required placeholder="e.g. Payment Receipt SMS" data-testid="input-template-name" /></div>
                  <div><Label>Event Trigger</Label>
                    <Select value={formEvent} onValueChange={setFormEvent}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {eventTypes.map(t => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Channel</Label>
                    <Select value={formChannel} onValueChange={setFormChannel}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="in_app">In-App</SelectItem>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Subject</Label><Input ref={subjectRef} value={formSubject} onChange={e => setFormSubject(e.target.value)} placeholder="e.g. Payment of {payment_amount} received" data-testid="input-template-subject" /></div>
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <Label>Message Body</Label>
                      <MergeTagPicker tags={mergeTags} onInsert={insertTag} />
                    </div>
                    <Textarea ref={bodyRef} value={formBody} onChange={e => setFormBody(e.target.value)} rows={6} required placeholder="Dear {client_name}, your payment of {payment_amount} for policy {policy_number} has been received..." data-testid="input-template-body" />
                    <p className="text-xs text-muted-foreground mt-1">Click "Insert Tag" above to add dynamic placeholders that auto-fill from policy data.</p>
                  </div>

                  {formBody && (
                    <div className="p-3 border rounded-lg bg-muted/30">
                      <p className="text-xs font-medium text-muted-foreground mb-1">Preview (with sample data):</p>
                      <p className="text-sm whitespace-pre-wrap">{
                        formBody
                          .replace(/\{client_name\}/g, "John Doe")
                          .replace(/\{first_name\}/g, "John")
                          .replace(/\{last_name\}/g, "Doe")
                          .replace(/\{policy_number\}/g, "FLK00011")
                          .replace(/\{product_name\}/g, "Family Cover Plan")
                          .replace(/\{premium_amount\}/g, "USD 25.00")
                          .replace(/\{currency\}/g, "USD")
                          .replace(/\{payment_schedule\}/g, "Monthly")
                          .replace(/\{payment_amount\}/g, "USD 25.00")
                          .replace(/\{payment_date\}/g, "06/03/2026")
                          .replace(/\{payment_method\}/g, "EcoCash")
                          .replace(/\{org_name\}/g, "Falakhe Funeral")
                          .replace(/\{status\}/g, "Active")
                          .replace(/\{grace_end\}/g, "2026-03-31")
                          .replace(/\{effective_date\}/g, "2025-01-15")
                          .replace(/\{inception_date\}/g, "2025-01-15")
                          .replace(/\{member_name\}/g, "Jane Doe")
                          .replace(/\{birthday_name\}/g, "Jane Doe")
                          .replace(/\{birthday_date\}/g, "March 6")
                          .replace(/\{anniversary_years\}/g, "2")
                          .replace(/\{balance\}/g, "USD 50.00")
                          .replace(/\{outstanding\}/g, "USD 0.00")
                          .replace(/\{cycle_end\}/g, "2026-03-31")
                          .replace(/\{waiting_end\}/g, "2025-04-15")
                          .replace(/\{name\}/g, "John Doe")
                      }</p>
                    </div>
                  )}

                  <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-template">
                    {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}{editId ? "Update" : "Create"} Template
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
          )}
        />

        <CardSection
          title="Payment Automation Triggers"
          description="Triggers off each policy's actual due date (its own billing-cycle date — weekly, monthly, or yearly, whatever that client's policy runs on), not a generic days-since-last-payment guess. After the thresholds below, clients get reminders and (if enabled) a mobile wallet payment prompt is sent to their saved number so they can approve with their PIN on the phone. Card is not used for automation."
          icon={Bell}
        >
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>Enable automation</Label>
              <Switch checked={autoSettings.isEnabled} onCheckedChange={(v) => setAutoSettings((s) => ({ ...s, isEnabled: v }))} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="start-after-days-since-last-payment">Start after days past due date</Label>
                <Input id="start-after-days-since-last-payment"
                  type="number"
                  min={0}
                  value={String(autoSettings.daysAfterLastPayment)}
                  onChange={(e) => setAutoSettings((s) => ({ ...s, daysAfterLastPayment: Math.max(0, Number(e.target.value || 0)) }))}
                />
                <p className="text-xs text-muted-foreground mt-1">0 = charge exactly on the due date.</p>
              </div>
              <div>
                <Label htmlFor="repeat-every-days">Repeat every (days)</Label>
                <Input id="repeat-every-days"
                  type="number"
                  min={1}
                  value={String(autoSettings.repeatEveryDays)}
                  onChange={(e) => setAutoSettings((s) => ({ ...s, repeatEveryDays: Math.max(1, Number(e.target.value || 1)) }))}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label>Prompt payment on saved mobile number</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Opens the wallet payment flow; the client authorises on their phone (PIN). This is not unattended card billing.</p>
              </div>
              <Switch checked={autoSettings.autoRunPayments} onCheckedChange={(v) => setAutoSettings((s) => ({ ...s, autoRunPayments: v }))} />
            </div>
            <div className="flex items-center justify-between">
              <Label>Send push reminders</Label>
              <Switch checked={autoSettings.sendPushNotifications} onCheckedChange={(v) => setAutoSettings((s) => ({ ...s, sendPushNotifications: v }))} />
            </div>
            <div className="flex gap-2">
              <Button onClick={() => saveAutomationMutation.mutate(autoSettings)} disabled={saveAutomationMutation.isPending}>
                {saveAutomationMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Save Triggers
              </Button>
              <Button variant="outline" onClick={() => runAutomationNowMutation.mutate()} disabled={runAutomationNowMutation.isPending}>
                {runAutomationNowMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Run Now
              </Button>
            </div>
          </div>
        </CardSection>

        <CardSection
          title="Other Scheduled Digests"
          description="Both of these already run automatically once a day (policy lapse sweep at 04:00 UTC, notification digest at 05:00 UTC). Use these to run them on demand — e.g. after changing a template, or to check today's results without waiting."
          icon={Bell}
        >
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => runLapseSweepNowMutation.mutate()} disabled={runLapseSweepNowMutation.isPending}>
              {runLapseSweepNowMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Run policy lapse sweep now
            </Button>
            <Button variant="outline" onClick={() => runNotificationDigestNowMutation.mutate()} disabled={runNotificationDigestNowMutation.isPending}>
              {runNotificationDigestNowMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Run notification digest now
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Policy lapse sweep sends grace-period-started and policy-lapsed emails for overdue policies — safe to run repeatedly, it only acts on policies that are still overdue. Notification digest sends birthday, policy anniversary, premium-due (3 days out), and pre-lapse warning emails for today, and only ever sends once per day even if you click it after the scheduled run already fired.
          </p>
        </CardSection>

        <CardSection title="Automation Activity" description="Recent automation runs: mobile payment prompts, skips, and reminder dispatches." icon={Bell}>
          {automationRuns.length === 0 ? (
            <EmptyState
              title="No automation activity"
              description="No runs have been recorded yet."
              className="border-0 rounded-none bg-transparent py-6"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {automationRuns.slice(0, 30).map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="capitalize">{String(r.actionType || "—").replace(/_/g, " ")}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{r.status || "—"}</Badge></TableCell>
                    <TableCell className="capitalize">{r.methodType || "—"}</TableCell>
                    <TableCell className="max-w-[420px] truncate" title={r.message || ""}>{r.message || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardSection>

        <CardSection title="Message Templates" description="Each template triggers automatically when its event occurs. Dynamic tags are replaced with real policy data." icon={Bell}>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : templates.length === 0 ? (
            <EmptyState
              title="No notification templates"
              description="Default messages will be used for each event. Create templates to customize them."
              className="border-0 rounded-none bg-transparent py-8"
            />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Event Trigger</TableHead>
                    <TableHead>Channel</TableHead>
                    <TableHead>Subject</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {templates.map((t: any) => (
                    <TableRow key={t.id} data-testid={`row-template-${t.id}`}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell><Badge variant="outline">{(eventTypes.find(e => e.value === t.eventType)?.label) || t.eventType.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell><Badge variant="secondary">{t.channel}</Badge></TableCell>
                      <TableCell className="text-sm max-w-48 truncate">{t.subject || "—"}</TableCell>
                      <TableCell>
                        <Switch checked={t.isActive} onCheckedChange={(v) => toggleMutation.mutate({ id: t.id, isActive: v })} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" aria-label="Edit template" onClick={() => openEdit(t)}><Pencil className="h-4 w-4" aria-hidden="true" /></Button>
                          <Button variant="ghost" size="icon" aria-label="Delete template" onClick={() => { if (confirm("Delete this template?")) deleteMutation.mutate(t.id); }}><Trash2 className="h-4 w-4 text-destructive" aria-hidden="true" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
