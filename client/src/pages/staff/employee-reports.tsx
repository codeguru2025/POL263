import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageShell } from "@/components/ds/page-shell";
import { PageHeader } from "@/components/ds/page-header";
import { CardSection } from "@/components/ds/card-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getApiBase } from "@/lib/queryClient";
import {
  Users,
  BarChart2,
  UserCheck,
  LineChart,
  Briefcase,
  Shield,
  MapPin,
  Download,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type ReportFilters = {
  fromDate?: string;
  toDate?: string;
  agentId?: string;
  branchId?: string;
};

function buildReportUrl(type: string, filters: ReportFilters): string {
  const params = new URLSearchParams();
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  if (filters.agentId) params.set("agentId", filters.agentId);
  if (filters.branchId) params.set("branchId", filters.branchId);
  const q = params.toString();
  return getApiBase() + `/api/reports/export/${type}` + (q ? `?${q}` : "");
}

function ReportRow({
  label,
  type,
  filters,
}: {
  label: string;
  type: string;
  filters: ReportFilters;
}) {
  return (
    <div className="flex items-center justify-between py-2.5 px-3 rounded-md hover:bg-muted/50 group">
      <span className="text-sm text-foreground leading-snug">{label}</span>
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 shrink-0 opacity-60 group-hover:opacity-100 ml-4"
        onClick={() => window.open(buildReportUrl(type, filters), "_blank")}
        data-testid={`btn-report-${type}`}
      >
        <Download className="h-3.5 w-3.5" />
        CSV
      </Button>
    </div>
  );
}

type ReportItem = { label: string; type: string };
type ReportGroup = {
  id: string;
  label: string;
  icon: LucideIcon;
  items: ReportItem[];
};

const REPORT_GROUPS: ReportGroup[] = [
  {
    id: "payroll",
    label: "Agents, Cashier, Audit and Payroll Reports",
    icon: Users,
    items: [
      { label: "Prepare All Policies Per Agent", type: "policies-per-agent" },
      { label: "Prepare All New Joinings Per Agent", type: "new-joinings" },
      { label: "New Joinings Per Agent Summary", type: "new-joinings-summary" },
      { label: "Agent Productivity — All Agents", type: "agent-productivity" },
      { label: "Prepare Cashiers Detailed", type: "cashups" },
      { label: "Prepare Cashiers Summary", type: "cashiers-summary" },
      { label: "Prepare Audit Trail", type: "audit-trail" },
      { label: "Prepare Payslips", type: "payroll" },
      { label: "Employer IRP5 Reconciliation", type: "irp5-reconciliation" },
      { label: "Deleted Receipts", type: "deleted-receipts" },
      { label: "Edited Receipts", type: "edited-receipts" },
      { label: "Moved Receipts", type: "moved-receipts" },
      { label: "Back Dated Receipts", type: "backdated-receipts" },
      { label: "Employee Summary", type: "employee-summary" },
      { label: "All Policies Arrears Breakdown", type: "arrears-breakdown" },
      { label: "Agent Clients with Outstanding Payments", type: "outstanding-payments" },
      { label: "Policy Receipts Report (by Receipts Branch)", type: "receipts" },
      { label: "Captured Policies Per Employee", type: "captured-per-employee" },
      { label: "Complaint Report", type: "complaint-report" },
    ],
  },
  {
    id: "static-commission",
    label: "Agent Static Commission Reports",
    icon: BarChart2,
    items: [
      { label: "Monthly Commission Reports", type: "commissions" },
      { label: "Agent Commission", type: "agent-commission" },
      { label: "Agent Commission (MM+Ext)", type: "agent-commission-mm-ext" },
      { label: "Agent Commission (MM+Ext) Summary", type: "agent-commission-summary" },
      { label: "Agent Commission By Receipt Count", type: "agent-commission-by-count" },
      { label: "Agent Total Commission Summary (CaptureDT)", type: "agent-total-commission" },
      { label: "Prepare Manager Commission", type: "manager-commission" },
      { label: "Select Count", type: "select-count" },
    ],
  },
  {
    id: "joining-commission",
    label: "Joining Commission Reports",
    icon: UserCheck,
    items: [
      { label: "Agent Joining Commission", type: "joining-commission" },
      { label: "Agent Joining Comms (W/WOut Join Rec)", type: "joining-comms-detail" },
      { label: "Agent Joining Comms (W/WOut Join Rec) Summary", type: "joining-comms-summary" },
      { label: "Base on Member IncepD (show once, ignore duplicate)", type: "joining-comm-inception" },
    ],
  },
  {
    id: "dynamic-commission",
    label: "Agent Dynamic Commission Reports",
    icon: LineChart,
    items: [
      { label: "Agent Commission With Group Override", type: "commission-group-override" },
      { label: "Agent Dynamic Comm Summary (With G/Override)", type: "dynamic-comm-summary" },
      { label: "Agent Commission with Group Override (Benefits)", type: "commission-group-benefits" },
    ],
  },
  {
    id: "broker-commission",
    label: "Broker Commission Reports",
    icon: Briefcase,
    items: [
      { label: "Broker Commission (MM Only)", type: "broker-commission-mm" },
      { label: "Broker Commission 2 (MM Only)", type: "broker-commission-2" },
      { label: "Broker Commission (MM+Ext)", type: "broker-commission-ext" },
      { label: "Broker Policies", type: "broker-policies" },
    ],
  },
  {
    id: "referrer-commission",
    label: "Policy Referrer Commission Reports",
    icon: Shield,
    items: [
      { label: "Prepare Policy Tier Commission", type: "tier-commission" },
      { label: "Prepare Policy Tier Commission Breakdown", type: "tier-commission-breakdown" },
    ],
  },
  {
    id: "branch",
    label: "Branch Reports",
    icon: MapPin,
    items: [{ label: "Branch Report", type: "branch-report" }],
  },
];

export default function EmployeeReports() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [agentId, setAgentId] = useState("");
  const [branchId, setBranchId] = useState("");

  const filters: ReportFilters = {
    fromDate: fromDate || undefined,
    toDate: toDate || undefined,
    agentId: agentId || undefined,
    branchId: branchId || undefined,
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Employee Reports"
          description="Generate and download agent, cashier, commission, and payroll reports. Use the filters below to narrow results before downloading."
        />

        <CardSection title="Report Filters" icon={SlidersHorizontal}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="er-from-date">From Date</Label>
              <Input
                id="er-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er-to-date">To Date</Label>
              <Input
                id="er-to-date"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er-agent-id">Agent ID</Label>
              <Input
                id="er-agent-id"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="Filter by agent…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="er-branch-id">Branch ID</Label>
              <Input
                id="er-branch-id"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                placeholder="Filter by branch…"
              />
            </div>
          </div>
        </CardSection>

        {REPORT_GROUPS.map((group) => (
          <CardSection key={group.id} title={group.label} icon={group.icon}>
            <div className="divide-y divide-border/40">
              {group.items.map((item) => (
                <ReportRow
                  key={item.type}
                  label={item.label}
                  type={item.type}
                  filters={filters}
                />
              ))}
            </div>
          </CardSection>
        ))}
      </PageShell>
    </StaffLayout>
  );
}
