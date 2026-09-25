import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CardSection, EmptyState, KpiStatCard } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { AlertTriangle, Download, FileText, Loader2, MessageSquareText } from "lucide-react";

interface SmsAllowance {
  metered: boolean;
  enforced: boolean;
  allocated: number;
  used: number;
  remaining: number;
  lowBalanceThreshold: number;
}
interface SmsStats { sent: number; failed: number; blocked: number; creditsCharged: number; segmentsSent: number }
interface UsageResponse {
  allowance: SmsAllowance;
  thisMonth: SmsStats & { from: string; to: string };
  history: { id: string; type: string; credits: number; balanceAfter: number | null; note: string | null; createdAt: string }[];
}
interface SmsRow {
  id: string;
  recipient: string;
  clientName: string | null;
  message: string;
  segments: number;
  creditsCharged: number;
  status: "sent" | "failed" | "blocked";
  failureReason: string | null;
  typeLabel: string;
  createdAt: string;
}
interface MessagesResponse { from: string; to: string; total: number; stats: SmsStats; rows: SmsRow[] }

const PAGE_SIZE = 50;
const fmt = (n: number) => n.toLocaleString("en-US");

function monthStart(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_BADGE: Record<SmsRow["status"], { label: string; className: string }> = {
  sent: { label: "Sent", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200" },
  blocked: { label: "Not sent — allowance", className: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" },
};

/**
 * SMS allowance (granted by the platform owner) + the detailed, downloadable log of every text
 * sent for this organization.
 */
export function SmsUsagePanel() {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const usage = useQuery<UsageResponse>({
    queryKey: ["/api/sms/usage"],
    queryFn: () => apiRequest("GET", "/api/sms/usage").then((r) => r.json()),
  });

  const params = new URLSearchParams({ from, to });
  if (status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const listParams = new URLSearchParams(params);
  listParams.set("limit", String(PAGE_SIZE));
  listParams.set("offset", String(page * PAGE_SIZE));

  const messages = useQuery<MessagesResponse>({
    queryKey: ["/api/sms/messages", listParams.toString()],
    queryFn: () => apiRequest("GET", `/api/sms/messages?${listParams}`).then((r) => r.json()),
  });

  const download = (format: "csv" | "pdf") => {
    const q = new URLSearchParams(params);
    q.set("format", format);
    const a = document.createElement("a");
    a.href = `${getApiBase()}/api/sms/messages/export?${q}`;
    a.download = `sms-report-${from}-to-${to}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const a = usage.data?.allowance;
  const month = usage.data?.thisMonth;
  const pctUsed = a && a.metered && a.allocated > 0 ? Math.min(100, Math.round((a.used / a.allocated) * 100)) : 0;
  const low = !!a && a.metered && a.remaining <= a.lowBalanceThreshold;
  const total = messages.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6">
      <CardSection
        title="SMS allowance"
        description="Text messages available to your organization, as allocated by the platform administrator. Each text uses one credit per 160 characters (70 if it contains emoji or special characters)."
        icon={MessageSquareText}
      >
        {usage.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : usage.isError || !a ? (
          <p className="text-sm text-destructive">Couldn't load your SMS allowance. Please refresh the page.</p>
        ) : (
          <div className="space-y-4">
            {a.metered ? (
              <>
                {low && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200" role="alert">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      {a.remaining <= 0
                        ? "Your SMS allowance is used up, so text messages to clients are on hold. They will go out automatically once the platform administrator adds more credits."
                        : `Only ${fmt(a.remaining)} SMS credits left. Ask the platform administrator to top up before they run out.`}
                    </span>
                  </div>
                )}
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
                  <KpiStatCard label="Remaining" value={fmt(a.remaining)} hint={a.enforced ? "Texts stop when this reaches zero" : "Texts continue past zero"} />
                  <KpiStatCard label="Used" value={fmt(a.used)} hint="Since your allowance started" />
                  <KpiStatCard label="Allocated" value={fmt(a.allocated)} hint="Total given by the platform" />
                </div>
                <div className="space-y-1">
                  <Progress value={pctUsed} aria-label={`${pctUsed}% of SMS allowance used`} />
                  <p className="text-xs text-muted-foreground">{pctUsed}% used</p>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No SMS allowance has been set for your organization, so texts aren't counted against a limit. Usage is still recorded below.
              </p>
            )}
            {month && (
              <p className="text-sm text-muted-foreground">
                This month: <strong className="text-foreground">{fmt(month.sent)}</strong> sent
                {a.metered && <> using <strong className="text-foreground">{fmt(month.creditsCharged)}</strong> credits</>}
                {month.failed > 0 && <>, {fmt(month.failed)} failed</>}
                {month.blocked > 0 && <>, {fmt(month.blocked)} held back (allowance)</>}.
              </p>
            )}
            {usage.data!.history.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Allowance history</summary>
                <ul className="mt-2 space-y-1">
                  {usage.data!.history.map((h) => (
                    <li key={h.id} className="flex flex-wrap gap-x-2">
                      <span className="text-muted-foreground">{new Date(h.createdAt).toLocaleDateString()}</span>
                      <span>
                        {h.type === "grant" && <>+{fmt(h.credits)} credits added</>}
                        {h.type === "correction" && <>{fmt(h.credits)} credits (correction)</>}
                        {h.type === "settings" && <>Settings changed</>}
                        {h.note ? ` — ${h.note}` : ""}
                      </span>
                      {h.balanceAfter != null && <span className="text-muted-foreground">(balance {fmt(h.balanceAfter)})</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </CardSection>

      <CardSection
        title="SMS report"
        description="Every text sent, failed or held back — with who it went to, what it said and what it cost. Download it as a spreadsheet (CSV) or PDF."
        icon={FileText}
      >
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="space-y-1">
            <Label htmlFor="sms-from">From</Label>
            <Input id="sms-from" type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sms-to">To</Label>
            <Input id="sms-to" type="date" value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="w-40" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sms-status">Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); setPage(0); }}>
              <SelectTrigger id="sms-status" className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="blocked">Not sent — allowance</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 flex-1 min-w-[180px]">
            <Label htmlFor="sms-search">Search number or text</Label>
            <Input id="sms-search" value={search} placeholder="e.g. 0772…" onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => download("csv")} disabled={total === 0} data-testid="button-sms-export-csv">
              <Download className="h-4 w-4 mr-1" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => download("pdf")} disabled={total === 0} data-testid="button-sms-export-pdf">
              <Download className="h-4 w-4 mr-1" /> PDF
            </Button>
          </div>
        </div>

        {messages.data && (
          <p className="text-sm text-muted-foreground mb-3">
            {fmt(messages.data.total)} message{messages.data.total === 1 ? "" : "s"} · {fmt(messages.data.stats.sent)} sent
            · {fmt(messages.data.stats.creditsCharged)} credits used
            {messages.data.stats.failed > 0 && <> · {fmt(messages.data.stats.failed)} failed</>}
            {messages.data.stats.blocked > 0 && <> · {fmt(messages.data.stats.blocked)} held back</>}
          </p>
        )}

        {messages.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading messages…</div>
        ) : messages.isError ? (
          <p className="text-sm text-destructive">Couldn't load the SMS report. Please try again.</p>
        ) : total === 0 ? (
          <EmptyState title="No text messages" description="No texts match these dates and filters." />
        ) : (
          <>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="whitespace-nowrap">Date / time</TableHead>
                    <TableHead>Recipient</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Credits</TableHead>
                    <TableHead className="min-w-[260px]">Message</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.data!.rows.map((r) => (
                    <TableRow key={r.id} data-testid={`row-sms-${r.id}`}>
                      <TableCell className="whitespace-nowrap text-sm">{new Date(r.createdAt).toLocaleString()}</TableCell>
                      <TableCell className="text-sm">
                        <div className="font-mono">{r.recipient}</div>
                        {r.clientName && <div className="text-xs text-muted-foreground">{r.clientName}</div>}
                      </TableCell>
                      <TableCell className="text-sm">{r.typeLabel}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_BADGE[r.status]?.className}>{STATUS_BADGE[r.status]?.label ?? r.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">{r.creditsCharged}</TableCell>
                      <TableCell className="text-sm">
                        <div className="whitespace-pre-wrap break-words">{r.message}</div>
                        {r.failureReason && <div className="text-xs text-destructive mt-1">{r.failureReason}</div>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between mt-3 text-sm">
                <span className="text-muted-foreground">Page {page + 1} of {pages}</span>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardSection>
    </div>
  );
}
