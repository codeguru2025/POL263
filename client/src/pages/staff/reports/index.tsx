import { Link } from "wouter";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection, FilterBar } from "@/components/ds";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Filter } from "lucide-react";
import {
  buildStaffReportHref,
  reportContextLabel,
  SECTION_META,
  tabsForSection,
} from "@/lib/staff-reports-nav";
import { useReportFilters } from "./use-report-filters";
import { PoliciesSection } from "./sections/policies-section";
import { FinanceSection } from "./sections/finance-section";
import { AgentsSection } from "./sections/agents-section";
import { ClaimsSection } from "./sections/claims-section";
import { OperationsSection } from "./sections/operations-section";
import { PayrollSection } from "./sections/payroll-section";
import { QualitySection } from "./sections/quality-section";

export default function StaffReports() {
  const {
    canReadCommission,
    sectionOpts, visibleSections,
    reportSection, activeReport,
    fromDate, setFromDate, toDate, setToDate, userId, setUserId,
    branchId, setBranchId, productId, setProductId, agentId, setAgentId,
    statusFilter, setStatusFilter, setRunKey,
    filters, q, qAppend, fk, runKey, need,
    users, branches, products,
  } = useReportFilters();

  const sectionProps = { filters, q, qAppend, fk, runKey, need };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Reports"
          description={reportContextLabel(reportSection, activeReport)}
          titleDataTestId="text-reports-title"
          actions={
            <Button onClick={() => setRunKey((k) => k + 1)} data-testid="button-run-report" className="gap-2 shadow-sm">
              <Play className="h-4 w-4" /> Run report
            </Button>
          }
        />

        {/* Section navigation */}
        <div className="flex flex-wrap gap-1.5">
          {visibleSections.map((s) => {
            const meta = SECTION_META[s];
            const Icon = meta.icon;
            const isActive = s === reportSection;
            const firstTab = tabsForSection(s, sectionOpts)[0]?.value ?? "";
            return (
              <Link
                key={s}
                href={buildStaffReportHref(s, firstTab)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors border ${
                  isActive
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-card border-border/70 text-muted-foreground hover:text-foreground hover:bg-accent shadow-sm"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {meta.label}
              </Link>
            );
          })}
        </div>

        {/* Filters + tab nav in one card */}
        <CardSection title="" flush>
          <FilterBar className="border-b border-border/60 bg-muted/10 px-4 py-3 sm:px-6">
            <div className="space-y-1.5">
              <Label htmlFor="fromDate" className="text-xs text-muted-foreground">From</Label>
              <Input id="fromDate" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-36 h-9" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="toDate" className="text-xs text-muted-foreground">To</Label>
              <Input id="toDate" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-36 h-9" />
            </div>
            <Select value={branchId || "__all__"} onValueChange={(v) => setBranchId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <Filter className="h-3.5 w-3.5 mr-1.5 shrink-0 text-muted-foreground" />
                <SelectValue placeholder="All branches" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All branches</SelectItem>
                {(branches as any[]).map((b: any) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={productId || "__all__"} onValueChange={(v) => setProductId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="All products" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All products</SelectItem>
                {(products as any[]).map((p: any) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={agentId || "__all__"} onValueChange={(v) => setAgentId(v === "__all__" ? "" : v)}>
              <SelectTrigger className="w-44 h-9">
                <SelectValue placeholder="All agents" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All agents</SelectItem>
                {(users as any[]).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeReport === "claims" ? (
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="submitted">Submitted</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="approved">Approved</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="rejected">Rejected</SelectItem>
                </SelectContent>
              </Select>
            ) : !["fleet", "expenditures", "cashups", "payroll", "commissions", "commission-payments", "platform", "income-statement", "cash-flow", "ledger", "balance-sheet", "funerals", "payments", "actuarial", "data-integrity", "collection-efficiency"].includes(activeReport) ? (
              <Select value={statusFilter || "__all__"} onValueChange={(v) => setStatusFilter(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All statuses" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="grace">Grace</SelectItem>
                  <SelectItem value="lapsed">Lapsed</SelectItem>
                  <SelectItem value="reinstatement_pending">Reinstatement pending</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {activeReport === "cashups" && (
              <Select value={userId || "__all__"} onValueChange={(v) => setUserId(v === "__all__" ? "" : v)}>
                <SelectTrigger className="w-44 h-9"><SelectValue placeholder="All users" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All users</SelectItem>
                  {(users as any[]).map((u: any) => <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </FilterBar>

          {/* Tab nav */}
          <div className="flex overflow-x-auto px-4 sm:px-6 scrollbar-hide">
            {tabsForSection(reportSection, sectionOpts).map((t) => {
              const isActive = t.value === activeReport;
              return (
                <Link
                  key={t.value}
                  href={buildStaffReportHref(reportSection, t.value)}
                  data-testid={t.testId}
                  className={`shrink-0 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    isActive
                      ? "border-primary text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"
                  }`}
                >
                  {t.label}
                </Link>
              );
            })}
          </div>
        </CardSection>

        <div className="min-w-0 space-y-4">
          <Tabs value={activeReport}>
            <TabsList className="sr-only absolute h-px w-px overflow-hidden whitespace-nowrap p-0 -m-px border-0">
              {tabsForSection(reportSection, sectionOpts).map((t) => (
                <TabsTrigger key={t.value} value={t.value} data-testid={t.testId}>
                  {t.label}
                </TabsTrigger>
              ))}
            </TabsList>

            {reportSection === "policies" && <PoliciesSection {...sectionProps} />}
            {reportSection === "finance" && <FinanceSection {...sectionProps} userId={userId} users={users} />}
            {reportSection === "agents" && (
              <AgentsSection {...sectionProps} fromDate={fromDate} toDate={toDate} agentId={agentId} canReadCommission={canReadCommission} />
            )}
            {reportSection === "claims" && <ClaimsSection {...sectionProps} />}
            {reportSection === "operations" && <OperationsSection {...sectionProps} />}
            {reportSection === "payroll" && <PayrollSection {...sectionProps} />}
            {reportSection === "quality" && <QualitySection {...sectionProps} />}
          </Tabs>
        </div>
      </PageShell>
    </StaffLayout>
  );
}
