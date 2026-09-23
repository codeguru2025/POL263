import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { MessageSquare, Loader2 } from "lucide-react";

interface EventType { value: string; label: string }

/** Plain-language "when does this text go out". `auto` = fired by the daily sweep with no staff
 *  action, so it can text many clients at once — flagged so nobody switches it on by accident. */
const WHEN: Record<string, { when: string; auto?: boolean; notWired?: boolean }> = {
  policy_capture: { when: "When a policy is created" },
  policy_activated: { when: "When a policy becomes active" },
  payment_received: { when: "When a payment clears — same moment as “Payment Receipted”" },
  payment_receipt: { when: "When a payment is receipted" },
  premium_due: { when: "3 days before the premium is due", auto: true },
  grace_start: { when: "When a policy enters its grace period" },
  pre_lapse_warning: { when: "7, 3 and 1 day before the grace period ends", auto: true },
  policy_lapsed: { when: "When a policy lapses" },
  policy_cancelled: { when: "When a policy is cancelled" },
  reinstatement: { when: "When a lapsed policy is reinstated" },
  status_change: { when: "Any other policy status change" },
  member_added: { when: "When a member is added to a policy" },
  member_removed: { when: "Not triggered by the system yet", notWired: true },
  birthday: { when: "On the client’s or a dependent’s birthday", auto: true },
  anniversary: { when: "On the policy anniversary", auto: true },
  policy_update: { when: "Not triggered by the system yet", notWired: true },
  general_notice: { when: "Not triggered by the system yet", notWired: true },
  activation: { when: "When a client portal activation code is sent" },
  claim_status_change: { when: "When a claim’s status changes" },
  kyc_status_change: { when: "When a KYC document is reviewed" },
};

export function SmsEventToggles({
  templates,
  eventTypes,
  onSetup,
}: {
  templates: any[];
  eventTypes: EventType[];
  /** Opens the template dialog pre-filled for an event that has no SMS template yet. */
  onSetup: (eventType: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const smsFor = (eventType: string) => templates.filter((t) => t.channel === "sms" && t.eventType === eventType);

  const setActive = useMutation({
    mutationFn: async ({ ids, isActive }: { ids: string[]; isActive: boolean }) => {
      // allSettled: one failed PUT must not hide the others that succeeded.
      const results = await Promise.allSettled(ids.map((id) => apiRequest("PUT", `/api/notification-templates/${id}`, { isActive })));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed) throw new Error(`${failed} of ${ids.length} update(s) failed`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["/api/notification-templates"] }),
    onError: (err: any) => toast({ title: "Couldn't update SMS setting", description: err.message, variant: "destructive" }),
  });

  const rows = eventTypes.map((e) => ({ ...e, sms: smsFor(e.value) }));
  const configured = rows.filter((r) => r.sms.length > 0);
  const activeCount = configured.filter((r) => r.sms.some((t) => t.isActive)).length;
  const bothPaymentTextsOn = ["payment_received", "payment_receipt"].every((ev) => smsFor(ev).some((t) => t.isActive));

  const bulk = (isActive: boolean) => {
    // "All on" leaves Payment Received alone: it fires together with Payment Receipted, so
    // switching both on texts the client twice for one payment.
    const ids = configured
      .filter((r) => !(isActive && r.value === "payment_received"))
      .flatMap((r) => r.sms.filter((t) => t.isActive !== isActive).map((t) => t.id as string));
    if (!ids.length) return;
    setActive.mutate({ ids, isActive });
  };

  return (
    <CardSection
      title="SMS messages"
      description="Choose which events send a text message to the client. Turning one off stops it straight away; nothing is deleted."
      icon={MessageSquare}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
        <p className="text-sm text-muted-foreground" data-testid="text-sms-active-count">
          {activeCount} of {rows.length} events currently send SMS
        </p>
        <div className="flex gap-2">
          <Button
            size="sm" variant="outline" disabled={setActive.isPending || activeCount === 0}
            onClick={() => { if (confirm("Turn OFF SMS for every event? You can switch them back on one by one.")) bulk(false); }}
            data-testid="button-sms-all-off"
          >
            Turn all off
          </Button>
          <Button size="sm" variant="outline" disabled={setActive.isPending} onClick={() => bulk(true)} data-testid="button-sms-all-on">
            Turn all on
          </Button>
        </div>
      </div>

      {bothPaymentTextsOn && (
        <p className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          “Payment Received” and “Payment Receipted” are both on — clients will get two texts for every payment. Turn one off.
        </p>
      )}

      <ul className="divide-y">
        {rows.map((r) => {
          const info = WHEN[r.value];
          const isOn = r.sms.some((t) => t.isActive);
          return (
            <li key={r.value} className="flex items-center justify-between gap-3 py-2.5" data-testid={`row-sms-${r.value}`}>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{r.label}</span>
                  {info?.auto && <Badge variant="secondary">Automatic daily</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{info?.when ?? r.value.replace(/_/g, " ")}</p>
              </div>
              {r.sms.length === 0 ? (
                <Button size="sm" variant="outline" onClick={() => onSetup(r.value)} data-testid={`button-sms-setup-${r.value}`}>
                  Set up
                </Button>
              ) : (
                <div className="flex items-center gap-2 shrink-0">
                  {setActive.isPending && setActive.variables?.ids.some((id) => r.sms.some((t) => t.id === id)) && (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                  )}
                  <Switch
                    checked={isOn}
                    disabled={setActive.isPending}
                    aria-label={`Send SMS for ${r.label}`}
                    onCheckedChange={(v) => setActive.mutate({ ids: r.sms.map((t) => t.id as string), isActive: v })}
                    data-testid={`switch-sms-${r.value}`}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </CardSection>
  );
}
