import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CardSection, KpiStatCard } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, MessageSquareText, Plus } from "lucide-react";

interface SmsAllowance {
  metered: boolean;
  enforced: boolean;
  allocated: number;
  used: number;
  remaining: number;
  lowBalanceThreshold: number;
}
interface AllowanceEvent {
  id: string;
  type: string;
  credits: number;
  balanceAfter: number | null;
  note: string | null;
  actorEmail: string | null;
  createdAt: string;
}
interface AllowanceResponse {
  allowance: SmsAllowance;
  events: AllowanceEvent[];
  thisMonth: { sent: number; failed: number; blocked: number; creditsCharged: number } | null;
}

const fmt = (n: number) => n.toLocaleString("en-US");

/** Platform owner: grant / correct a tenant's SMS credits and set how the allowance behaves. */
export function PlatformSmsAllowanceTab({ tenantId }: { tenantId: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const key = ["/api/platform/tenants", tenantId, "sms-allowance"];
  const { data, isLoading, isError } = useQuery<AllowanceResponse>({
    queryKey: key,
    queryFn: () => apiRequest("GET", `/api/platform/tenants/${tenantId}/sms-allowance`).then((r) => r.json()),
  });

  const [credits, setCredits] = useState("");
  const [note, setNote] = useState("");
  const [threshold, setThreshold] = useState<string | null>(null);

  const onError = (err: any) => toast({ title: "Couldn't save", description: err?.message || "Please try again.", variant: "destructive" });

  const grant = useMutation({
    mutationFn: (n: number) => apiRequest("POST", `/api/platform/tenants/${tenantId}/sms-allowance/grant`, { credits: n, note }).then((r) => r.json()),
    onSuccess: (a: SmsAllowance, n) => {
      toast({ title: n > 0 ? `${fmt(n)} SMS credits added` : `${fmt(Math.abs(n))} SMS credits removed`, description: `Balance is now ${fmt(a.remaining)}.` });
      setCredits("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError,
  });

  const settings = useMutation({
    mutationFn: (patch: { lowBalanceThreshold?: number; enforced?: boolean }) =>
      apiRequest("PATCH", `/api/platform/tenants/${tenantId}/sms-allowance`, patch).then((r) => r.json()),
    onSuccess: () => {
      toast({ title: "SMS allowance settings saved" });
      setThreshold(null);
      queryClient.invalidateQueries({ queryKey: key });
    },
    onError,
  });

  if (isLoading) return <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (isError || !data) return <p className="text-sm text-destructive">Couldn't load this tenant's SMS allowance.</p>;

  const a = data.allowance;
  const parsedCredits = Number(credits);
  const creditsValid = Number.isInteger(parsedCredits) && parsedCredits !== 0 && Math.abs(parsedCredits) <= 1_000_000;
  const pctUsed = a.metered && a.allocated > 0 ? Math.min(100, Math.round((a.used / a.allocated) * 100)) : 0;

  return (
    <div className="space-y-6">
      <CardSection
        title="SMS allowance"
        description="Credits this tenant can spend on text messages. One credit = one SMS part (160 plain characters, or 70 with emoji/special characters). Until credits are first granted, the tenant is not metered."
        icon={MessageSquareText}
      >
        {a.metered ? (
          <div className="space-y-4">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
              <KpiStatCard label="Remaining" value={fmt(a.remaining)} />
              <KpiStatCard label="Used" value={fmt(a.used)} />
              <KpiStatCard label="Allocated" value={fmt(a.allocated)} />
            </div>
            <Progress value={pctUsed} aria-label={`${pctUsed}% used`} />
            {data.thisMonth && (
              <p className="text-sm text-muted-foreground">
                This month: {fmt(data.thisMonth.sent)} sent, {fmt(data.thisMonth.creditsCharged)} credits used
                {data.thisMonth.failed > 0 && `, ${fmt(data.thisMonth.failed)} failed`}
                {data.thisMonth.blocked > 0 && `, ${fmt(data.thisMonth.blocked)} held back for lack of credits`}.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Not metered — this tenant's texts aren't limited. Granting credits below switches metering on.
          </p>
        )}
      </CardSection>

      <CardSection title="Add or remove credits" description="Use a negative number to correct an over-grant. Every change is recorded below and in the platform audit log.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="sms-credits">Credits</Label>
            <Input id="sms-credits" inputMode="numeric" value={credits} onChange={(e) => setCredits(e.target.value.trim())} placeholder="e.g. 1000" className="w-36" />
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label htmlFor="sms-note">Note (optional)</Label>
            <Input id="sms-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. September bundle, invoice INV-1042" />
          </div>
          <Button onClick={() => grant.mutate(parsedCredits)} disabled={!creditsValid || grant.isPending} data-testid="button-grant-sms-credits">
            {grant.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
            {creditsValid && parsedCredits < 0 ? "Remove credits" : "Add credits"}
          </Button>
        </div>
        {credits && !creditsValid && <p className="text-xs text-destructive mt-2">Enter a whole number (not 0), up to 1,000,000.</p>}
      </CardSection>

      {a.metered && (
        <CardSection title="Allowance rules">
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="sms-enforced">Stop texts when credits run out</Label>
                <p className="text-xs text-muted-foreground">
                  When on, client texts are held back at zero and sent automatically (within 24 hours) once credits are added. Staff login codes are never held back.
                </p>
              </div>
              <Switch id="sms-enforced" checked={a.enforced} disabled={settings.isPending} onCheckedChange={(v) => settings.mutate({ enforced: v })} />
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="sms-threshold">Warn tenant admins when this many credits are left</Label>
                <Input
                  id="sms-threshold"
                  inputMode="numeric"
                  className="w-36"
                  value={threshold ?? String(a.lowBalanceThreshold)}
                  onChange={(e) => setThreshold(e.target.value.trim())}
                />
              </div>
              <Button
                variant="outline"
                disabled={threshold === null || !Number.isInteger(Number(threshold)) || Number(threshold) < 0 || settings.isPending}
                onClick={() => settings.mutate({ lowBalanceThreshold: Number(threshold) })}
              >
                Save
              </Button>
            </div>
          </div>
        </CardSection>
      )}

      <CardSection title="History">
        {data.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No changes yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead className="text-right">Balance after</TableHead>
                  <TableHead>Note</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-sm">{new Date(e.createdAt).toLocaleString()}</TableCell>
                    <TableCell className="text-sm">
                      {e.type === "grant" ? `+${fmt(e.credits)} credits` : e.type === "correction" ? `${fmt(e.credits)} credits (correction)` : "Settings changed"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-sm">{e.balanceAfter != null ? fmt(e.balanceAfter) : "—"}</TableCell>
                    <TableCell className="text-sm">{e.note || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{e.actorEmail || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardSection>
    </div>
  );
}
