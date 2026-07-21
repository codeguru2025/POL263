import { Link } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, KpiStatCard, EmptyState } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Loader2, Stethoscope, Building2, Users, AlertTriangle, DollarSign } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface TenantHealthIssue {
  severity: "critical" | "warning";
  code: string;
  message: string;
}

interface TenantHealthRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  licenseStatus: string;
  subscription: { status: string | null; planName: string | null; currentPeriodEnd: string | null };
  policies: { active: number; grace: number; lapsed: number };
  fees: { due: Record<string, string>; settled: Record<string, string> };
  paynowConfigured: boolean;
  automationFailuresLast7d: number;
  issues: TenantHealthIssue[];
  loadError: string | null;
}

interface TenantHealthResponse {
  summary: { tenants: number; activeSubscriptions: number; pastDue: number; feesDue: Record<string, string>; feesSettled: Record<string, string> };
  tenants: TenantHealthRow[];
}

const SUBSCRIPTION_STATUS_VARIANT: Record<string, "default" | "outline" | "destructive" | "secondary"> = {
  trialing: "outline", active: "default", past_due: "secondary", suspended: "destructive", cancelled: "secondary",
};

function formatCurrencyMap(rec: Record<string, string>): string {
  const entries = Object.entries(rec).filter(([, amt]) => parseFloat(amt) !== 0);
  if (entries.length === 0) return "—";
  return entries.map(([cur, amt]) => `${cur} ${amt}`).join(" · ");
}

export default function PlatformTenantHealth() {
  const { data, isLoading, isError } = useQuery<TenantHealthResponse>({ queryKey: ["/api/platform/tenant-health"] });

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title="Tenant Health" description="Cross-tenant overview: active policies, platform fees due/settled, and flagged issues that need attention." />

        {isLoading ? (
          <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : isError || !data ? (
          <EmptyState title="Couldn't load tenant health" description="Try refreshing the page." />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <KpiStatCard label="Tenants" value={data.summary.tenants} icon={Building2} />
              <KpiStatCard label="Active subscriptions" value={data.summary.activeSubscriptions} icon={Users} />
              <KpiStatCard label="Past due / suspended" value={data.summary.pastDue} icon={AlertTriangle} className={data.summary.pastDue > 0 ? "border-destructive/40" : undefined} />
              <KpiStatCard label="Platform fees due" value={formatCurrencyMap(data.summary.feesDue)} hint={`Settled: ${formatCurrencyMap(data.summary.feesSettled)}`} icon={DollarSign} />
            </div>

            <CardSection title="Tenants" description="Flagged tenants are sorted first — critical issues, then warnings." icon={Stethoscope}>
              {data.tenants.length === 0 ? (
                <EmptyState title="No active tenants" description="Nothing to show yet." />
              ) : (
                <div className="overflow-x-auto">
                  <TooltipProvider>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tenant</TableHead>
                          <TableHead>Subscription</TableHead>
                          <TableHead>Policies</TableHead>
                          <TableHead>Fees due</TableHead>
                          <TableHead>Fees settled</TableHead>
                          <TableHead>Issues</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.tenants.map((t) => (
                          <TableRow key={t.id} data-testid={`row-tenant-health-${t.slug}`}>
                            <TableCell>
                              <Link href={`/staff/platform/tenants/${t.id}`} className="font-medium hover:underline">{t.name}</Link>
                              {!t.isActive && <Badge variant="outline" className="ml-2 text-[10px]">inactive</Badge>}
                            </TableCell>
                            <TableCell>
                              {t.subscription.status ? (
                                <div className="space-y-0.5">
                                  <Badge variant={SUBSCRIPTION_STATUS_VARIANT[t.subscription.status] ?? "outline"} className="capitalize">{t.subscription.status.replace("_", " ")}</Badge>
                                  {t.subscription.planName && <p className="text-xs text-muted-foreground">{t.subscription.planName}</p>}
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground">No subscription</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm tabular-nums">
                              {t.policies.active} active
                              {t.policies.grace > 0 && <span className="text-amber-600 dark:text-amber-400"> · {t.policies.grace} grace</span>}
                              {t.policies.lapsed > 0 && <span className="text-destructive"> · {t.policies.lapsed} lapsed</span>}
                            </TableCell>
                            <TableCell className="font-mono text-sm">{formatCurrencyMap(t.fees.due)}</TableCell>
                            <TableCell className="font-mono text-sm">{formatCurrencyMap(t.fees.settled)}</TableCell>
                            <TableCell>
                              {t.issues.length === 0 ? (
                                <span className="text-xs text-muted-foreground">No issues</span>
                              ) : (
                                <div className="flex flex-wrap gap-1">
                                  {t.issues.map((issue) => (
                                    <Tooltip key={issue.code}>
                                      <TooltipTrigger asChild>
                                        <Badge variant={issue.severity === "critical" ? "destructive" : "secondary"} className="text-[10px] cursor-default">
                                          {issue.code.replace(/_/g, " ")}
                                        </Badge>
                                      </TooltipTrigger>
                                      <TooltipContent>{issue.message}</TooltipContent>
                                    </Tooltip>
                                  ))}
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TooltipProvider>
                </div>
              )}
            </CardSection>
          </div>
        )}
      </PageShell>
    </StaffLayout>
  );
}
