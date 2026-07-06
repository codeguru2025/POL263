import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, DataTable, dataTableStickyHeaderClass, EmptyState } from "@/components/ds";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, getApiBase } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useBranding } from "@/hooks/use-branding";
import { useAuth } from "@/hooks/use-auth";
import { Loader2, Printer, FileDown, Download } from "lucide-react";

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function currencyLines(m: Record<string, number> | undefined) {
  if (!m || Object.keys(m).length === 0) return "—";
  return Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004).map(([c, v]) => `${c} ${money(v)}`).join(" · ") || "—";
}

export default function DailyReport() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { branding, displayName, displayLogo } = useBranding(user?.organizationId ?? null);
  const [, setLocation] = useLocation();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const today = new Date().toISOString().slice(0, 10);
  const date = params.get("date") || today;
  const [noteText, setNoteText] = useState("");
  const queryClient = useQueryClient();

  const { data: report, isLoading } = useQuery<any>({
    queryKey: ["/api/reports/daily", date],
    queryFn: async () => {
      const res = await fetch(getApiBase() + `/api/reports/daily?date=${date}`, { credentials: "include" });
      if (!res.ok) return null;
      return res.json();
    },
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/reports/daily/notes", { date, note: noteText.trim() });
    },
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["/api/reports/daily", date] });
      toast({ title: "Note added" });
    },
    onError: (err: any) => toast({ title: "Couldn't add note", description: err?.message, variant: "destructive" }),
  });

  const changeDate = (d: string) => setLocation(`/staff/daily-report?date=${d}`);

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Daily Report"
          description="Every financial statement and operational event for the day, auto-fetched, plus your own notes."
          actions={
            <div className="flex items-center gap-2">
              <Input type="date" value={date} max={today} onChange={(e) => changeDate(e.target.value)} className="w-40 h-9" />
              <Button variant="outline" size="sm" onClick={() => window.print()} className="gap-1.5">
                <Printer className="h-3.5 w-3.5" /> Print
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.open(`${getApiBase()}/api/reports/daily/pdf?date=${date}`, "_blank")} className="gap-1.5">
                <FileDown className="h-3.5 w-3.5" /> Preview PDF
              </Button>
              <Button size="sm" onClick={() => window.open(`${getApiBase()}/api/reports/daily/pdf?date=${date}&download=1`, "_blank")} className="gap-1.5">
                <Download className="h-3.5 w-3.5" /> Download PDF
              </Button>
            </div>
          }
        />

        {isLoading || !report ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : (
          <div className="space-y-6">
            {/* Letterhead */}
            <div className="flex items-center gap-4 border-b-2 pb-4" style={{ borderColor: branding?.primaryColor || undefined }}>
              <img src={displayLogo} alt="" className="h-12 w-12 object-contain shrink-0" />
              <div>
                <p className="text-lg font-serif font-semibold leading-tight">{displayName}</p>
                <p className="text-xs text-muted-foreground">{[branding?.address, branding?.phone, branding?.email].filter(Boolean).join(" · ")}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="text-sm font-semibold tabular-nums">{new Date(date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
                <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Daily report</p>
              </div>
            </div>

            {/* Income statement */}
            <CardSection title="Income Statement" description="Cash-basis income and expenses for the day.">
              {(() => {
                const is = report.financials.incomeStatement;
                const curs: string[] = is.currencies?.length ? is.currencies : ["USD"];
                return (
                  <div className="space-y-2 text-sm">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Income</p>
                        <p className="tabular-nums font-medium">{currencyLines(is.income.total)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Expenses</p>
                        <p className="tabular-nums font-medium">{currencyLines(is.expenses.total)}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Net</p>
                      <p className={`tabular-nums font-semibold ${(is.consolidatedUsd?.net ?? 0) >= 0 ? "text-emerald-600" : "text-destructive"}`}>
                        {currencyLines(is.net)} <span className="text-xs text-muted-foreground font-normal">(≈ USD {money(is.consolidatedUsd?.net)} consolidated)</span>
                      </p>
                    </div>
                    {is.expenses.lines?.length > 0 && (
                      <div className="pt-2">
                        <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">Expense breakdown</p>
                        <ul className="text-xs space-y-0.5">
                          {is.expenses.lines.map((l: any, i: number) => (
                            <li key={i} className="flex justify-between max-w-sm"><span>{l.label}</span><span className="tabular-nums">{currencyLines(l.amounts)}</span></li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })()}
            </CardSection>

            {/* Cash flow */}
            <CardSection title="Cash Flow" description="Cash in vs. cash out for the day.">
              {(() => {
                const cf = report.financials.cashFlow;
                return (
                  <div className="grid grid-cols-3 gap-3 text-sm">
                    <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash in</p><p className="font-semibold tabular-nums text-emerald-600">{currencyLines(cf.cashIn)}</p></div>
                    <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Cash out</p><p className="font-semibold tabular-nums text-destructive">{currencyLines(cf.outflows.total)}</p></div>
                    <div className="rounded-md border p-3"><p className="text-xs text-muted-foreground">Net cash</p><p className="font-semibold tabular-nums">{currencyLines(cf.netCash)}</p></div>
                  </div>
                );
              })()}
            </CardSection>

            {/* Ledger */}
            <CardSection title="Transaction Ledger" description={`${report.financials.ledger.total} transaction(s) today.`} flush>
              {report.financials.ledger.entries.length === 0 ? (
                <EmptyState title="No transactions today" className="border-0 rounded-none bg-transparent py-8" />
              ) : (
                <div className="overflow-x-auto">
                  <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent min-w-[820px]">
                    <TableHeader className={dataTableStickyHeaderClass}>
                      <TableRow>
                        <TableHead>Type</TableHead><TableHead>Description</TableHead><TableHead>Reference</TableHead>
                        <TableHead>Person</TableHead><TableHead>Dept / cost centre</TableHead><TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.financials.ledger.entries.map((e: any, i: number) => (
                        <TableRow key={i}>
                          <TableCell className={e.type === "income" ? "text-emerald-600 font-medium" : "text-destructive font-medium"}>{e.type === "income" ? "Income" : "Expense"}</TableCell>
                          <TableCell className="max-w-[280px] truncate" title={e.description}>{e.description}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.reference || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.person || "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{e.department || "—"}</TableCell>
                          <TableCell className={`text-right tabular-nums whitespace-nowrap ${e.type === "income" ? "text-emerald-600" : "text-destructive"}`}>
                            {e.type === "expense" ? "-" : ""}{e.currency} {money(e.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </DataTable>
                </div>
              )}
            </CardSection>

            {/* Operations summary */}
            <CardSection title="Operations" description="Funeral, mortuary, and policy activity fetched automatically for the day.">
              <div className="grid gap-5 sm:grid-cols-2">
                <OpsList title={`Funeral cases opened (${report.operations.funeralCasesOpened.length})`}>
                  {report.operations.funeralCasesOpened.map((c: any) => (
                    <li key={c.id}>{c.caseNumber} — {c.deceasedName} <span className="text-muted-foreground">({c.serviceType || "—"}, {c.status})</span></li>
                  ))}
                </OpsList>
                <OpsList title={`Mortuary intakes (${report.operations.mortuaryIntakes.length})`}>
                  {report.operations.mortuaryIntakes.map((m: any) => (
                    <li key={m.id}>{m.intakeNumber} — {m.deceasedName} <span className="text-muted-foreground">({m.serviceScope})</span></li>
                  ))}
                </OpsList>
                <OpsList title={`Mortuary dispatches (${report.operations.mortuaryDispatches.length})`}>
                  {report.operations.mortuaryDispatches.map((d: any) => (
                    <li key={d.id}>{d.destination || "—"} <span className="text-muted-foreground">collected by {d.collectedByName || "—"}</span></li>
                  ))}
                </OpsList>
                <OpsList title={`Quotations created (${report.operations.quotationsCreated.length})`}>
                  {report.operations.quotationsCreated.map((q: any) => (
                    <li key={q.id}>{q.quotationNumber} — {q.deceasedName || "—"} <span className="text-muted-foreground">({q.currency} {money(q.grandTotal)}, {q.status})</span></li>
                  ))}
                </OpsList>
                <OpsList title={`Policies activated (${report.operations.policiesActivated.length})`}>
                  {report.operations.policiesActivated.map((p: any) => (
                    <li key={p.id}>{p.policyNumber} — {[p.clientFirstName, p.clientLastName].filter(Boolean).join(" ")} <span className="text-muted-foreground">({p.currency} {money(p.premiumAmount)}{p.isLegacy ? ", legacy" : ""})</span></li>
                  ))}
                </OpsList>
                <OpsList title={`Claims submitted (${report.operations.claimsSubmitted.length})`}>
                  {report.operations.claimsSubmitted.map((c: any) => (
                    <li key={c.id}>{c.claimNumber} — {c.deceasedName || c.claimType} <span className="text-muted-foreground">({c.status})</span></li>
                  ))}
                </OpsList>
              </div>
            </CardSection>

            {/* Notes */}
            <CardSection title="Notes" description="Add operational context, decisions, or insights for the day — shown here for anyone reviewing this report.">
              <div className="space-y-3">
                {report.notes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No notes added yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {report.notes.map((n: any) => (
                      <li key={n.id} className="text-sm border rounded-md p-3">
                        <p className="whitespace-pre-wrap">{n.note}</p>
                        <p className="text-xs text-muted-foreground mt-1">{n.authorName || "Unknown"} · {new Date(n.createdAt).toLocaleString()}</p>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2 items-start pt-2">
                  <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="Add a note for today's report…" rows={3} className="flex-1" />
                  <Button onClick={() => addNoteMutation.mutate()} disabled={!noteText.trim() || addNoteMutation.isPending}>
                    {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add note"}
                  </Button>
                </div>
              </div>
            </CardSection>
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}

function OpsList({ title, children }: { title: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : !!children;
  return (
    <div>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1.5">{title}</p>
      {hasItems ? <ul className="text-sm space-y-1 list-disc list-inside">{children}</ul> : <p className="text-sm text-muted-foreground">None today.</p>}
    </div>
  );
}
