import { useState } from "react";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { getApiBase } from "@/lib/queryClient";
import { CalendarDays, Download, FileText, Building2, DollarSign, Users, Bed, BarChart3, ShieldCheck } from "lucide-react";

const DEPARTMENTS = [
  { id: "funeral",  label: "Operations — Funeral Services", icon: FileText,    desc: "Active cases, upcoming services, status breakdown." },
  { id: "finance",  label: "Finance Department",            icon: DollarSign,   desc: "Receipts collected, payment totals by currency." },
  { id: "hr",       label: "Human Resources & Payroll",     icon: Users,        desc: "Employee register, attendance summary for period." },
  { id: "mortuary", label: "Mortuary Department",           icon: Bed,          desc: "Current occupants, full intake register." },
  { id: "sales",    label: "Sales & Policy Administration", icon: BarChart3,    desc: "Policies issued, status breakdown, premium totals." },
  { id: "claims",   label: "Claims Department",             icon: ShieldCheck,  desc: "Claims filed, status breakdown, cash-in-lieu totals." },
] as const;

type DeptId = typeof DEPARTMENTS[number]["id"];

function tomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function firstOfMonth() {
  return new Date().toISOString().slice(0, 8) + "01";
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export default function StaffScheduleReports() {
  // Daily schedule state
  const [scheduleDate, setScheduleDate] = useState(tomorrowDate);

  // Department report state
  const [dept, setDept] = useState<DeptId>("funeral");
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(todayDate);

  const handleScheduleDownload = (inline = false) => {
    const params = new URLSearchParams({ date: scheduleDate });
    if (!inline) params.set("download", "1");
    window.open(`${getApiBase()}/api/schedule/pdf?${params}`, "_blank");
  };

  const handleReportDownload = (inline = false) => {
    const params = new URLSearchParams({ dept, from: fromDate, to: toDate });
    if (!inline) params.set("download", "1");
    window.open(`${getApiBase()}/api/department-report/pdf?${params}`, "_blank");
  };

  const selectedDept = DEPARTMENTS.find(d => d.id === dept)!;
  const DeptIcon = selectedDept.icon;

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Schedule & Reports"
          description="Generate daily schedules of service and department reports on company letterhead"
          titleDataTestId="text-schedule-reports-title"
        />

        {/* ── Daily Schedule of Service ── */}
        <CardSection title="Daily Schedule of Service" icon={CalendarDays}>
          <p className="text-sm text-muted-foreground mb-5">
            Generates a full schedule of all funeral cases assigned for a given date — including
            service timelines, assigned drivers, agents, vehicles and emergency contacts.
            Printed on company letterhead. Intended to be distributed to staff at the start of each day.
          </p>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label>Service Date</Label>
              <Input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
                className="w-48"
              />
              <p className="text-xs text-muted-foreground">Defaults to tomorrow</p>
            </div>

            <div className="flex gap-2">
              <Button onClick={() => handleScheduleDownload(false)}>
                <Download className="h-4 w-4 mr-2" />
                Download PDF
              </Button>
              <Button variant="outline" onClick={() => handleScheduleDownload(true)}>
                <FileText className="h-4 w-4 mr-2" />
                Preview
              </Button>
            </div>
          </div>

          <div className="mt-5 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">What's included in the schedule:</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              <li>All funeral cases with a service date matching the selected date</li>
              <li>Body wash time, burial departure, and memorial service times</li>
              <li>Removal and burial drivers — name, phone, email, address, next-of-kin</li>
              <li>Removal and burial vehicles — make, model, registration</li>
              <li>Attending agent and case manager contact details</li>
              <li>Informant / next-of-kin details</li>
              <li>Special notes and instructions per case</li>
            </ul>
          </div>
        </CardSection>

        <Separator />

        {/* ── Department Reports ── */}
        <CardSection title="Department Reports" icon={Building2}>
          <p className="text-sm text-muted-foreground mb-5">
            Generate a detailed report for any department, covering the selected date range,
            on company letterhead with summary statistics and data tables.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
            {/* Department selector */}
            <div className="md:col-span-3 space-y-2">
              <Label>Department</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {DEPARTMENTS.map((d) => {
                  const Icon = d.icon;
                  const active = dept === d.id;
                  return (
                    <button
                      key={d.id}
                      onClick={() => setDept(d.id)}
                      className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors ${
                        active
                          ? "border-primary bg-primary/5 ring-1 ring-primary"
                          : "border-border hover:border-primary/40 hover:bg-muted/50"
                      }`}
                    >
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                      <div>
                        <p className={`text-xs font-semibold leading-tight ${active ? "text-primary" : "text-foreground"}`}>{d.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{d.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Date range */}
            <div className="space-y-1.5">
              <Label>From Date</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>To Date</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="space-y-1.5">
                <Label className="invisible">Quick range</Label>
                <div className="flex gap-1 flex-wrap">
                  <Button size="sm" variant="outline" className="text-xs h-9"
                    onClick={() => { setFromDate(firstOfMonth()); setToDate(todayDate()); }}>
                    This Month
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-9"
                    onClick={() => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - 1);
                      const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0");
                      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
                      setFromDate(`${y}-${m}-01`); setToDate(`${y}-${m}-${last}`);
                    }}>
                    Last Month
                  </Button>
                </div>
              </div>
            </div>
          </div>

          {/* Selected dept summary */}
          <div className="flex items-center gap-3 rounded-md border border-primary/20 bg-primary/5 px-4 py-3 mb-4">
            <DeptIcon className="h-5 w-5 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-primary">{selectedDept.label}</p>
              <p className="text-xs text-muted-foreground">{selectedDept.desc}</p>
            </div>
            <Badge variant="outline" className="text-xs shrink-0">
              {fromDate} → {toDate}
            </Badge>
          </div>

          <div className="flex gap-2">
            <Button onClick={() => handleReportDownload(false)}>
              <Download className="h-4 w-4 mr-2" />
              Download Report PDF
            </Button>
            <Button variant="outline" onClick={() => handleReportDownload(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Preview
            </Button>
          </div>

          <div className="mt-5 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">All reports include:</p>
            <ul className="list-disc pl-5 space-y-0.5 text-xs">
              <li>Company letterhead with logo, name, address, phone and email</li>
              <li>Department name, date range, and generation timestamp</li>
              <li>Summary statistics panel</li>
              <li>Detailed data tables with alternating rows for readability</li>
              <li>Page numbers and confidentiality footer on every page</li>
            </ul>
          </div>
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
