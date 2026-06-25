import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Loader2, Banknote, Calendar, FileSpreadsheet, Play, Pencil, ChevronDown, ChevronUp } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

// ── Payroll calculation (mirrored server-side in the PUT route) ──────────────
interface EmpDefaults {
  baseSalary?: string | null;
  housingAllowance?: string | null;
  transportAllowance?: string | null;
  otherAllowances?: { name: string; amount: string }[] | null;
  funeralPolicyDeduction?: string | null;
  otherInsuranceDeduction?: string | null;
  nssaEnabled?: boolean;
  payeEnabled?: boolean;
  aidsLevyEnabled?: boolean;
}

interface PayslipInput {
  daysWorked: number | null; // null = full month
  totalDays: number;
  nssaAmount: string;
  payeAmount: string;
  aidsLevyAmount: string;
}

function calcPayslip(emp: EmpDefaults, input: PayslipInput) {
  const factor = input.daysWorked != null && input.totalDays > 0
    ? Math.min(input.daysWorked / input.totalDays, 1)
    : 1;

  const n = (v?: string | null) => parseFloat(v || "0") || 0;

  const base = n(emp.baseSalary) * factor;
  const housing = n(emp.housingAllowance) * factor;
  const transport = n(emp.transportAllowance) * factor;
  const otherAmt = (emp.otherAllowances || []).reduce((s, a) => s + n(a.amount), 0) * factor;
  const totalGross = base + housing + transport + otherAmt;

  const funeralPolicy = n(emp.funeralPolicyDeduction);
  const otherInsurance = n(emp.otherInsuranceDeduction);
  const nssa = emp.nssaEnabled ? n(input.nssaAmount) : 0;
  const paye = emp.payeEnabled ? n(input.payeAmount) : 0;
  const aidsLevy = emp.aidsLevyEnabled ? n(input.aidsLevyAmount) : 0;
  const totalDeductions = funeralPolicy + otherInsurance + nssa + paye + aidsLevy;
  const netPay = totalGross - totalDeductions;

  return { factor, base, housing, transport, otherAmt, totalGross, funeralPolicy, otherInsurance, nssa, paye, aidsLevy, totalDeductions, netPay };
}

// ── Days in a period ──────────────────────────────────────────────────────────
function workingDaysInPeriod(start: string, end: string): number {
  if (!start || !end) return 30;
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T23:59:59");
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count || 1;
}

// ── Other allowances mini-editor ──────────────────────────────────────────────
function OtherAllowancesEditor({ value, onChange }: { value: { name: string; amount: string }[]; onChange: (v: { name: string; amount: string }[]) => void }) {
  return (
    <div className="space-y-2">
      {value.map((a, i) => (
        <div key={i} className="flex gap-2 items-center">
          <Input placeholder="Name" value={a.name} onChange={(e) => { const v = [...value]; v[i] = { ...v[i], name: e.target.value }; onChange(v); }} className="flex-1" />
          <Input type="number" placeholder="Amount" step="0.01" min="0" value={a.amount} onChange={(e) => { const v = [...value]; v[i] = { ...v[i], amount: e.target.value }; onChange(v); }} className="w-28" />
          <Button type="button" size="icon" variant="ghost" className="text-destructive h-8 w-8" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { name: "", amount: "" }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Allowance
      </Button>
    </div>
  );
}

// ── Payslip row (one employee in a run) ───────────────────────────────────────
function PayslipRow({ emp, run, existing, onSave, saving }: {
  emp: any; run: any; existing: any | null;
  onSave: (employeeId: string, data: any) => void;
  saving: boolean;
}) {
  const totalDays = workingDaysInPeriod(run.periodStart, run.periodEnd);
  const [fullMonth, setFullMonth] = useState(existing ? existing.daysWorked == null : true);
  const [daysWorked, setDaysWorked] = useState(existing?.daysWorked != null ? String(existing.daysWorked) : "");
  const [nssaAmount, setNssaAmount] = useState(existing?.deductionsDetail?.nssa != null ? String(existing.deductionsDetail.nssa) : "");
  const [payeAmount, setPayeAmount] = useState(existing?.deductionsDetail?.paye != null ? String(existing.deductionsDetail.paye) : "");
  const [aidsLevyAmount, setAidsLevyAmount] = useState(existing?.deductionsDetail?.aidsLevy != null ? String(existing.deductionsDetail.aidsLevy) : "");
  const [expanded, setExpanded] = useState(!existing);

  const input: PayslipInput = {
    daysWorked: fullMonth ? null : (parseInt(daysWorked) || 0),
    totalDays,
    nssaAmount, payeAmount, aidsLevyAmount,
  };
  const calc = calcPayslip(emp, input);

  const handleSave = () => {
    const earnings = {
      base: calc.base, housing: calc.housing, transport: calc.transport,
      otherAllowances: emp.otherAllowances || [], totalGross: calc.totalGross,
    };
    const deductionsDetail = {
      funeralPolicy: calc.funeralPolicy, otherInsurance: calc.otherInsurance,
      nssa: calc.nssa, paye: calc.paye, aidsLevy: calc.aidsLevy,
      totalDeductions: calc.totalDeductions,
    };
    onSave(emp.id, {
      daysWorked: fullMonth ? null : input.daysWorked,
      totalDays,
      earnings,
      deductionsDetail,
      grossAmount: calc.totalGross.toFixed(2),
      netAmount: calc.netPay.toFixed(2),
      currency: emp.currency || "USD",
    });
  };

  return (
    <div className="border rounded-lg overflow-hidden">
      <div
        className="flex items-center justify-between px-4 py-3 bg-muted/20 cursor-pointer"
        onClick={() => setExpanded((x) => !x)}
      >
        <div className="flex items-center gap-3">
          <span className="font-medium text-sm">{emp.firstName} {emp.lastName}</span>
          <span className="text-xs text-muted-foreground">{emp.employeeNumber}</span>
          {existing && <Badge variant="default" className="text-xs bg-emerald-600 text-white">Saved</Badge>}
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-muted-foreground">Gross</p>
            <p className="text-sm font-semibold">{emp.currency} {calc.totalGross.toFixed(2)}</p>
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs text-muted-foreground">Net</p>
            <p className="text-sm font-semibold text-emerald-700">{emp.currency} {calc.netPay.toFixed(2)}</p>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {expanded && (
        <div className="p-4 space-y-4">
          {/* Days worked */}
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch checked={fullMonth} onCheckedChange={setFullMonth} id={`fm-${emp.id}`} />
              <Label htmlFor={`fm-${emp.id}`} className="text-sm">Worked full month</Label>
            </div>
            {!fullMonth && (
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} max={totalDays} value={daysWorked}
                  onChange={(e) => setDaysWorked(e.target.value)}
                  className="w-20 h-8"
                  placeholder="Days"
                />
                <span className="text-xs text-muted-foreground">of {totalDays} working days ({(calc.factor * 100).toFixed(0)}% prorated)</span>
              </div>
            )}
          </div>

          {/* Earnings preview */}
          <div className="rounded-md border text-sm overflow-hidden">
            <div className="bg-muted/30 px-3 py-1.5 font-medium text-xs uppercase text-muted-foreground">Earnings</div>
            <div className="divide-y">
              <div className="flex justify-between px-3 py-1.5"><span>Basic Salary{!fullMonth ? ` (${(calc.factor * 100).toFixed(0)}%)` : ""}</span><span className="font-mono">{emp.currency} {calc.base.toFixed(2)}</span></div>
              {calc.housing > 0 && <div className="flex justify-between px-3 py-1.5"><span>Housing Allowance</span><span className="font-mono">{emp.currency} {calc.housing.toFixed(2)}</span></div>}
              {calc.transport > 0 && <div className="flex justify-between px-3 py-1.5"><span>Transport Allowance</span><span className="font-mono">{emp.currency} {calc.transport.toFixed(2)}</span></div>}
              {calc.otherAmt > 0 && (emp.otherAllowances || []).map((a: any, i: number) => (
                <div key={i} className="flex justify-between px-3 py-1.5"><span>{a.name || "Other Allowance"}</span><span className="font-mono">{emp.currency} {(parseFloat(a.amount || "0") * calc.factor).toFixed(2)}</span></div>
              ))}
              <div className="flex justify-between px-3 py-2 bg-muted/20 font-semibold"><span>Gross Pay</span><span className="font-mono">{emp.currency} {calc.totalGross.toFixed(2)}</span></div>
            </div>
          </div>

          {/* Deductions */}
          <div className="rounded-md border text-sm overflow-hidden">
            <div className="bg-muted/30 px-3 py-1.5 font-medium text-xs uppercase text-muted-foreground">Deductions</div>
            <div className="divide-y">
              {calc.funeralPolicy > 0 && <div className="flex justify-between px-3 py-1.5"><span>Funeral Policy</span><span className="font-mono text-red-600">-{emp.currency} {calc.funeralPolicy.toFixed(2)}</span></div>}
              {calc.otherInsurance > 0 && <div className="flex justify-between px-3 py-1.5"><span>Other Insurance</span><span className="font-mono text-red-600">-{emp.currency} {calc.otherInsurance.toFixed(2)}</span></div>}
              {emp.nssaEnabled && (
                <div className="flex items-center justify-between px-3 py-1.5 gap-2">
                  <span>NSSA</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" step="0.01" min="0" value={nssaAmount} onChange={(e) => setNssaAmount(e.target.value)} className="w-24 h-7 text-right font-mono" placeholder="0.00" />
                  </div>
                </div>
              )}
              {emp.payeEnabled && (
                <div className="flex items-center justify-between px-3 py-1.5 gap-2">
                  <span>PAYE</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" step="0.01" min="0" value={payeAmount} onChange={(e) => setPayeAmount(e.target.value)} className="w-24 h-7 text-right font-mono" placeholder="0.00" />
                  </div>
                </div>
              )}
              {emp.aidsLevyEnabled && (
                <div className="flex items-center justify-between px-3 py-1.5 gap-2">
                  <span>AIDS Levy</span>
                  <div className="flex items-center gap-1">
                    <Input type="number" step="0.01" min="0" value={aidsLevyAmount} onChange={(e) => setAidsLevyAmount(e.target.value)} className="w-24 h-7 text-right font-mono" placeholder="0.00" />
                  </div>
                </div>
              )}
              <div className="flex justify-between px-3 py-2 bg-muted/20 font-semibold"><span>Total Deductions</span><span className="font-mono text-red-600">-{emp.currency} {calc.totalDeductions.toFixed(2)}</span></div>
            </div>
          </div>

          {/* Net pay */}
          <div className="flex items-center justify-between rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3">
            <span className="font-semibold">Net Pay</span>
            <span className="text-xl font-bold text-emerald-700 font-mono">{emp.currency} {calc.netPay.toFixed(2)}</span>
          </div>

          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" />Saving…</> : "Save Payslip"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function StaffPayroll() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Employee form
  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState<any | null>(null);
  const [empFirstName, setEmpFirstName] = useState("");
  const [empLastName, setEmpLastName] = useState("");
  const [empNumber, setEmpNumber] = useState("");
  const [empPosition, setEmpPosition] = useState("");
  const [empDepartment, setEmpDepartment] = useState("");
  const [empBaseSalary, setEmpBaseSalary] = useState("");
  const [empHousing, setEmpHousing] = useState("");
  const [empTransport, setEmpTransport] = useState("");
  const [empOtherAllowances, setEmpOtherAllowances] = useState<{ name: string; amount: string }[]>([]);
  const [empFuneralPolicy, setEmpFuneralPolicy] = useState("");
  const [empOtherInsurance, setEmpOtherInsurance] = useState("");
  const [empNssa, setEmpNssa] = useState(false);
  const [empPaye, setEmpPaye] = useState(false);
  const [empAidsLevy, setEmpAidsLevy] = useState(false);
  const [empCurrency, setEmpCurrency] = useState("USD");

  // Run form
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [runPeriodStart, setRunPeriodStart] = useState("");
  const [runPeriodEnd, setRunPeriodEnd] = useState("");

  // Payslip entry
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [savingSlip, setSavingSlip] = useState<string | null>(null);

  const { data: employees = [], isLoading: loadingEmployees } = useQuery<any[]>({
    queryKey: ["/api/payroll/employees"],
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery<any[]>({
    queryKey: ["/api/payroll/runs"],
  });

  const { data: slips = [] } = useQuery<any[]>({
    queryKey: [`/api/payroll/runs/${selectedRun?.id}/payslips`],
    enabled: !!selectedRun?.id,
  });

  const activeEmployees = useMemo(() => employees.filter((e: any) => e.isActive), [employees]);

  const totalSalaryBill = useMemo(() => {
    return activeEmployees.reduce((sum: number, e: any) => {
      const base = parseFloat(e.baseSalary || "0");
      const housing = parseFloat(e.housingAllowance || "0");
      const transport = parseFloat(e.transportAllowance || "0");
      const other = (e.otherAllowances || []).reduce((s: number, a: any) => s + parseFloat(a.amount || "0"), 0);
      return sum + base + housing + transport + other;
    }, 0);
  }, [activeEmployees]);

  const slipsMap = useMemo(() => {
    const m: Record<string, any> = {};
    slips.forEach((s: any) => { m[s.employeeId] = s; });
    return m;
  }, [slips]);

  const resetEmployeeForm = useCallback(() => {
    setEditingEmployee(null);
    setEmpFirstName(""); setEmpLastName(""); setEmpNumber("");
    setEmpPosition(""); setEmpDepartment(""); setEmpBaseSalary("");
    setEmpHousing(""); setEmpTransport(""); setEmpOtherAllowances([]);
    setEmpFuneralPolicy(""); setEmpOtherInsurance("");
    setEmpNssa(false); setEmpPaye(false); setEmpAidsLevy(false);
    setEmpCurrency("USD");
  }, []);

  useEffect(() => {
    if (editingEmployee) {
      setEmpFirstName(editingEmployee.firstName || "");
      setEmpLastName(editingEmployee.lastName || "");
      setEmpNumber(editingEmployee.employeeNumber || "");
      setEmpPosition(editingEmployee.position || "");
      setEmpDepartment(editingEmployee.department || "");
      setEmpBaseSalary(editingEmployee.baseSalary || "");
      setEmpHousing(editingEmployee.housingAllowance || "");
      setEmpTransport(editingEmployee.transportAllowance || "");
      setEmpOtherAllowances(editingEmployee.otherAllowances || []);
      setEmpFuneralPolicy(editingEmployee.funeralPolicyDeduction || "");
      setEmpOtherInsurance(editingEmployee.otherInsuranceDeduction || "");
      setEmpNssa(!!editingEmployee.nssaEnabled);
      setEmpPaye(!!editingEmployee.payeEnabled);
      setEmpAidsLevy(!!editingEmployee.aidsLevyEnabled);
      setEmpCurrency(editingEmployee.currency || "USD");
    }
  }, [editingEmployee]);

  const buildEmpPayload = () => ({
    firstName: empFirstName.trim(),
    lastName: empLastName.trim(),
    employeeNumber: empNumber.trim(),
    position: empPosition.trim() || undefined,
    department: empDepartment.trim() || undefined,
    baseSalary: empBaseSalary || undefined,
    housingAllowance: empHousing || undefined,
    transportAllowance: empTransport || undefined,
    otherAllowances: empOtherAllowances.filter((a) => a.name || a.amount),
    funeralPolicyDeduction: empFuneralPolicy || undefined,
    otherInsuranceDeduction: empOtherInsurance || undefined,
    nssaEnabled: empNssa,
    payeEnabled: empPaye,
    aidsLevyEnabled: empAidsLevy,
    currency: empCurrency,
  });

  const createEmployeeMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/payroll/employees", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees"] });
      setShowEmployeeDialog(false); resetEmployeeForm();
      toast({ title: "Employee added" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateEmployeeMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => apiRequest("PATCH", `/api/payroll/employees/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees"] });
      setShowEmployeeDialog(false); resetEmployeeForm();
      toast({ title: "Employee updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const createRunMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/payroll/runs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      setShowRunDialog(false); setRunPeriodStart(""); setRunPeriodEnd("");
      toast({ title: "Payroll run created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleSaveEmployee = () => {
    if (!empFirstName || !empLastName || !empNumber) {
      toast({ title: "Required fields missing", description: "First name, last name and employee number are required.", variant: "destructive" });
      return;
    }
    const payload = buildEmpPayload();
    if (editingEmployee) updateEmployeeMutation.mutate({ id: editingEmployee.id, data: payload });
    else createEmployeeMutation.mutate(payload);
  };

  const handleSavePayslip = async (employeeId: string, data: any) => {
    if (!selectedRun) return;
    setSavingSlip(employeeId);
    try {
      await apiRequest("PUT", `/api/payroll/runs/${selectedRun.id}/payslips/${employeeId}`, data);
      queryClient.invalidateQueries({ queryKey: [`/api/payroll/runs/${selectedRun.id}/payslips`] });
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      toast({ title: "Payslip saved" });
    } catch (err: any) {
      toast({ title: "Failed to save payslip", description: err.message, variant: "destructive" });
    } finally {
      setSavingSlip(null);
    }
  };

  const getStatusColor = (status: string) => {
    if (status === "paid") return "default";
    if (status === "approved") return "default";
    if (status === "processed") return "default";
    return "secondary";
  };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Payroll"
          description="Manage employees, payroll runs, and payslips"
          titleDataTestId="text-payroll-title"
          actions={(
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => { resetEmployeeForm(); setShowEmployeeDialog(true); }} data-testid="button-add-employee">
                <Plus className="h-4 w-4 mr-2" />Add Employee
              </Button>
              <Button onClick={() => setShowRunDialog(true)} data-testid="button-create-run">
                <Play className="h-4 w-4 mr-2" />New Payroll Run
              </Button>
            </div>
          )}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiStatCard label="Total employees" value={<span data-testid="text-employee-count">{employees.length}</span>} icon={Users} />
          <KpiStatCard label="Active employees" value={<span className="text-emerald-600" data-testid="text-active-count">{activeEmployees.length}</span>} icon={Users} />
          <KpiStatCard label="Monthly gross bill" value={<span className="tabular-nums" data-testid="text-salary-bill">{totalSalaryBill.toFixed(2)}</span>} icon={Banknote} />
          <KpiStatCard label="Payroll runs" value={<span data-testid="text-run-count">{runs.length}</span>} icon={Calendar} />
        </div>

        <Tabs defaultValue="employees">
          <TabsList>
            <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
            <TabsTrigger value="runs" data-testid="tab-runs">Payroll Runs</TabsTrigger>
          </TabsList>

          {/* ── Employees tab ── */}
          <TabsContent value="employees">
            <CardSection title="Employee List" icon={Users}>
              {loadingEmployees ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : employees.length === 0 ? (
                <EmptyState
                  title="No employees added yet"
                  description="Add employees to start managing payroll."
                  action={<Button variant="outline" size="sm" onClick={() => { resetEmployeeForm(); setShowEmployeeDialog(true); }}><Plus className="h-4 w-4 mr-2" />Add First Employee</Button>}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emp #</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Basic</TableHead>
                      <TableHead>Housing</TableHead>
                      <TableHead>Transport</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Taxes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map((emp: any) => {
                      const gross = parseFloat(emp.baseSalary || "0") + parseFloat(emp.housingAllowance || "0") + parseFloat(emp.transportAllowance || "0") + (emp.otherAllowances || []).reduce((s: number, a: any) => s + parseFloat(a.amount || "0"), 0);
                      const taxes = [emp.nssaEnabled && "NSSA", emp.payeEnabled && "PAYE", emp.aidsLevyEnabled && "Aids Levy"].filter(Boolean).join(", ");
                      return (
                        <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                          <TableCell className="font-mono text-sm">{emp.employeeNumber}</TableCell>
                          <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                          <TableCell>{emp.position || "—"}</TableCell>
                          <TableCell className="tabular-nums">{emp.currency} {parseFloat(emp.baseSalary || "0").toFixed(2)}</TableCell>
                          <TableCell className="tabular-nums">{parseFloat(emp.housingAllowance || "0") > 0 ? `${emp.currency} ${parseFloat(emp.housingAllowance).toFixed(2)}` : "—"}</TableCell>
                          <TableCell className="tabular-nums">{parseFloat(emp.transportAllowance || "0") > 0 ? `${emp.currency} ${parseFloat(emp.transportAllowance).toFixed(2)}` : "—"}</TableCell>
                          <TableCell className="font-semibold tabular-nums">{emp.currency} {gross.toFixed(2)}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{taxes || "None"}</TableCell>
                          <TableCell><Badge variant={emp.isActive ? "default" : "secondary"}>{emp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => { setEditingEmployee(emp); setShowEmployeeDialog(true); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          {/* ── Payroll Runs tab ── */}
          <TabsContent value="runs">
            <CardSection title="Payroll Runs" icon={Calendar}>
              {loadingRuns ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : runs.length === 0 ? (
                <EmptyState
                  title="No payroll runs yet"
                  description="Create a payroll run to process employee salaries."
                  action={<Button variant="outline" size="sm" onClick={() => setShowRunDialog(true)}><Plus className="h-4 w-4 mr-2" />Create First Run</Button>}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total Gross</TableHead>
                      <TableHead>Deductions</TableHead>
                      <TableHead>Total Net</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run: any) => (
                      <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                        <TableCell className="font-medium">{run.periodStart} — {run.periodEnd}</TableCell>
                        <TableCell><Badge variant={getStatusColor(run.status)}>{run.status}</Badge></TableCell>
                        <TableCell className="tabular-nums">{run.totalGross ? parseFloat(run.totalGross).toFixed(2) : "—"}</TableCell>
                        <TableCell className="tabular-nums text-red-600">{run.totalDeductions ? parseFloat(run.totalDeductions).toFixed(2) : "—"}</TableCell>
                        <TableCell className="font-semibold tabular-nums text-emerald-700">{run.totalNet ? parseFloat(run.totalNet).toFixed(2) : "—"}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}>
                            <FileSpreadsheet className="h-4 w-4 mr-1" />{selectedRun?.id === run.id ? "Close" : "Enter Payslips"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>

            {selectedRun && (
              <CardSection
                title={`Payslips — ${selectedRun.periodStart} to ${selectedRun.periodEnd}`}
                icon={FileSpreadsheet}
                className="mt-4"
              >
                {activeEmployees.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No active employees to process.</p>
                ) : (
                  <div className="space-y-3">
                    {activeEmployees.map((emp: any) => (
                      <PayslipRow
                        key={emp.id}
                        emp={emp}
                        run={selectedRun}
                        existing={slipsMap[emp.id] ?? null}
                        onSave={handleSavePayslip}
                        saving={savingSlip === emp.id}
                      />
                    ))}
                  </div>
                )}
              </CardSection>
            )}
          </TabsContent>
        </Tabs>
      </PageShell>

      {/* ── Employee dialog ── */}
      <Dialog open={showEmployeeDialog} onOpenChange={(v) => { if (!v) { setShowEmployeeDialog(false); resetEmployeeForm(); } else setShowEmployeeDialog(true); }}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingEmployee ? "Edit Employee" : "Add Employee"}</DialogTitle>
            <DialogDescription>Configure salary, allowances, deductions, and statutory tax settings.</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {/* Basic info */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label>First Name *</Label><Input value={empFirstName} onChange={(e) => setEmpFirstName(e.target.value)} placeholder="John" /></div>
              <div className="space-y-1.5"><Label>Last Name *</Label><Input value={empLastName} onChange={(e) => setEmpLastName(e.target.value)} placeholder="Doe" /></div>
              <div className="space-y-1.5"><Label>Employee Number *</Label><Input value={empNumber} onChange={(e) => setEmpNumber(e.target.value)} placeholder="EMP-001" /></div>
              <div className="space-y-1.5"><Label>Currency</Label><CurrencySelect value={empCurrency} onValueChange={setEmpCurrency} /></div>
              <div className="space-y-1.5"><Label>Position</Label><Input value={empPosition} onChange={(e) => setEmpPosition(e.target.value)} placeholder="Sales Agent" /></div>
              <div className="space-y-1.5"><Label>Department</Label><Input value={empDepartment} onChange={(e) => setEmpDepartment(e.target.value)} placeholder="Sales" /></div>
            </div>

            <Separator />

            {/* Earnings */}
            <div>
              <p className="text-sm font-semibold mb-3">Earnings (monthly defaults)</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Basic Salary</Label>
                  <Input type="number" step="0.01" min="0" value={empBaseSalary} onChange={(e) => setEmpBaseSalary(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Housing Allowance</Label>
                  <Input type="number" step="0.01" min="0" value={empHousing} onChange={(e) => setEmpHousing(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Transport Allowance</Label>
                  <Input type="number" step="0.01" min="0" value={empTransport} onChange={(e) => setEmpTransport(e.target.value)} placeholder="0.00" />
                </div>
              </div>
              <div className="mt-3 space-y-1.5">
                <Label>Other Allowances</Label>
                <OtherAllowancesEditor value={empOtherAllowances} onChange={setEmpOtherAllowances} />
              </div>
            </div>

            <Separator />

            {/* Deductions */}
            <div>
              <p className="text-sm font-semibold mb-3">Fixed Monthly Deductions</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Funeral Policy</Label>
                  <Input type="number" step="0.01" min="0" value={empFuneralPolicy} onChange={(e) => setEmpFuneralPolicy(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-1.5">
                  <Label>Other Insurance</Label>
                  <Input type="number" step="0.01" min="0" value={empOtherInsurance} onChange={(e) => setEmpOtherInsurance(e.target.value)} placeholder="0.00" />
                </div>
              </div>
            </div>

            <Separator />

            {/* Zimbabwe statutory taxes */}
            <div>
              <p className="text-sm font-semibold mb-1">Zimbabwe Statutory Deductions</p>
              <p className="text-xs text-muted-foreground mb-3">Toggle on/off per employee. Amounts are entered manually when processing each payroll run.</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">NSSA</p>
                    <p className="text-xs text-muted-foreground">National Social Security Authority</p>
                  </div>
                  <Switch checked={empNssa} onCheckedChange={setEmpNssa} />
                </div>
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">PAYE</p>
                    <p className="text-xs text-muted-foreground">Pay As You Earn income tax</p>
                  </div>
                  <Switch checked={empPaye} onCheckedChange={setEmpPaye} />
                </div>
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div>
                    <p className="text-sm font-medium">AIDS Levy</p>
                    <p className="text-xs text-muted-foreground">3% surcharge on PAYE</p>
                  </div>
                  <Switch checked={empAidsLevy} onCheckedChange={setEmpAidsLevy} />
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowEmployeeDialog(false); resetEmployeeForm(); }}>Cancel</Button>
            <Button onClick={handleSaveEmployee} disabled={createEmployeeMutation.isPending || updateEmployeeMutation.isPending}>
              {(createEmployeeMutation.isPending || updateEmployeeMutation.isPending) ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : editingEmployee ? "Save Changes" : "Add Employee"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── New run dialog ── */}
      <Dialog open={showRunDialog} onOpenChange={setShowRunDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Payroll Run</DialogTitle>
            <DialogDescription>Set the pay period. Payslips are entered after the run is created.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>Period Start</Label><Input type="date" value={runPeriodStart} onChange={(e) => setRunPeriodStart(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Period End</Label><Input type="date" value={runPeriodEnd} onChange={(e) => setRunPeriodEnd(e.target.value)} /></div>
            {runPeriodStart && runPeriodEnd && (
              <p className="text-xs text-muted-foreground">{workingDaysInPeriod(runPeriodStart, runPeriodEnd)} working days in this period.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRunDialog(false)}>Cancel</Button>
            <Button onClick={() => { if (!runPeriodStart || !runPeriodEnd) { toast({ title: "Both dates required", variant: "destructive" }); return; } createRunMutation.mutate({ periodStart: runPeriodStart, periodEnd: runPeriodEnd }); }} disabled={createRunMutation.isPending}>
              {createRunMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating…</> : "Create Run"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
