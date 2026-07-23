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
import { Users, Plus, Loader2, Banknote, Calendar, FileSpreadsheet, Play, Pencil, ChevronDown, ChevronUp, Printer, Download, Send, Mail } from "lucide-react";
import { apiRequest, getApiBase } from "@/lib/queryClient";

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
          <Input value={a.name} onChange={(e) => { const v = [...value]; v[i] = { ...v[i], name: e.target.value }; onChange(v); }} className="flex-1" />
          <Input type="number" step="0.01" min="0" value={a.amount} onChange={(e) => { const v = [...value]; v[i] = { ...v[i], amount: e.target.value }; onChange(v); }} className="w-28" />
          <Button type="button" size="icon" variant="ghost" className="text-destructive h-8 w-8" aria-label="Remove allowance" onClick={() => onChange(value.filter((_, j) => j !== i))}>×</Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...value, { name: "", amount: "" }])}>
        <Plus className="h-3.5 w-3.5 mr-1" />Add Allowance
      </Button>
    </div>
  );
}

// ── Send all payslips in a run ─────────────────────────────────────────────
function SendAllPayslipsButton({ runId }: { runId: string }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const handleSendAll = async () => {
    if (!confirm("Send payslips by email to all employees in this run? Only employees with a linked user account and email address will receive theirs.")) return;
    setSending(true);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/send-all`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      toast({ title: `Sent ${data.sent}, failed ${data.failed}`, description: data.failed > 0 ? "Some payslips could not be delivered — check employee email addresses." : "All payslips delivered." });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  };
  return (
    <Button size="sm" variant="outline" className="text-xs" onClick={handleSendAll} disabled={sending}>
      {sending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Mail className="h-3.5 w-3.5 mr-1" />}
      {sending ? "Sending…" : "Send All"}
    </Button>
  );
}

// ── Send payslip button (per employee) ───────────────────────────────────────
function SendPayslipButton({ runId, employeeId }: { runId: string; employeeId: string }) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const handleSend = async () => {
    setSending(true);
    try {
      const res = await fetch(`/api/payroll/runs/${runId}/payslips/${employeeId}/send`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok) toast({ title: "Payslip sent", description: data.message });
      else toast({ title: "Could not send", description: data.message, variant: "destructive" });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally { setSending(false); }
  };
  return (
    <Button size="sm" variant="outline" className="text-xs h-8" onClick={handleSend} disabled={sending}>
      {sending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
      {sending ? "Sending…" : "Send Email"}
    </Button>
  );
}

// ── Payslip row (one employee in a run) ───────────────────────────────────────
function PayslipRow({ emp, run, existing, onSave, saving }: {
  emp: any; run: any; existing: any | null;
  onSave: (employeeId: string, data: any) => void;
  saving: boolean;
}) {
  const { toast } = useToast();
  const totalDays = workingDaysInPeriod(run.periodStart, run.periodEnd);
  const [fullMonth, setFullMonth] = useState(existing ? existing.daysWorked == null : true);
  const [daysWorked, setDaysWorked] = useState(existing?.daysWorked != null ? String(existing.daysWorked) : "");
  const [nssaAmount, setNssaAmount] = useState(existing?.deductionsDetail?.nssa != null ? String(existing.deductionsDetail.nssa) : "");
  const [payeAmount, setPayeAmount] = useState(existing?.deductionsDetail?.paye != null ? String(existing.deductionsDetail.paye) : "");
  const [aidsLevyAmount, setAidsLevyAmount] = useState(existing?.deductionsDetail?.aidsLevy != null ? String(existing.deductionsDetail.aidsLevy) : "");
  const [expanded, setExpanded] = useState(!existing);

  // Sync state when existing payslip is saved/updated
  useEffect(() => {
    if (existing) {
      setFullMonth(existing.daysWorked == null);
      setDaysWorked(existing.daysWorked != null ? String(existing.daysWorked) : "");
      setNssaAmount(existing.deductionsDetail?.nssa != null ? String(existing.deductionsDetail.nssa) : "");
      setPayeAmount(existing.deductionsDetail?.paye != null ? String(existing.deductionsDetail.paye) : "");
      setAidsLevyAmount(existing.deductionsDetail?.aidsLevy != null ? String(existing.deductionsDetail.aidsLevy) : "");
    }
  }, [existing]);

  const input: PayslipInput = {
    daysWorked: fullMonth ? null : (parseInt(daysWorked) || 0),
    totalDays,
    nssaAmount, payeAmount, aidsLevyAmount,
  };
  const calc = calcPayslip(emp, input);

  const handleSave = () => {
    if (!fullMonth) {
      const dw = parseInt(daysWorked) || 0;
      if (dw <= 0) { toast({ title: "Days worked must be at least 1", variant: "destructive" }); return; }
      if (dw > totalDays) { toast({ title: `Days worked cannot exceed ${totalDays} working days in this period`, variant: "destructive" }); return; }
    }
    const netPay = Math.max(0, calc.netPay);
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
      netAmount: netPay.toFixed(2),
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
            <div className="text-right">
              <span className="text-xl font-bold text-emerald-700 font-mono">{emp.currency} {Math.max(0, calc.netPay).toFixed(2)}</span>
              {calc.netPay < 0 && <p className="text-xs text-amber-600 mt-0.5">Deductions exceed gross — floored at 0</p>}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex gap-2">
              {existing && (
                <>
                  <Button size="sm" variant="outline" className="text-xs h-8"
                    onClick={() => window.open(`/api/payroll/runs/${run.id}/payslips/${emp.id}/pdf`, "_blank")}>
                    <Printer className="h-3.5 w-3.5 mr-1" />Print / Preview
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs h-8"
                    onClick={() => window.open(`/api/payroll/runs/${run.id}/payslips/${emp.id}/pdf?download=1`, "_blank")}>
                    <Download className="h-3.5 w-3.5 mr-1" />Download PDF
                  </Button>
                  <SendPayslipButton runId={run.id} employeeId={emp.id} />
                </>
              )}
            </div>
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
  const [empUserId, setEmpUserId] = useState<string>("");
  const [empFirstName, setEmpFirstName] = useState("");
  const [empLastName, setEmpLastName] = useState("");
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
  // Employment details
  const [empEmploymentType, setEmpEmploymentType] = useState("permanent");
  const [empContractStart, setEmpContractStart] = useState("");
  const [empContractEnd, setEmpContractEnd] = useState("");
  // Banking details
  const [empBankName, setEmpBankName] = useState("");
  const [empBankBranch, setEmpBankBranch] = useState("");
  const [empBankAccount, setEmpBankAccount] = useState("");
  const [empBankAccountType, setEmpBankAccountType] = useState("current");
  const [empBankBranchCode, setEmpBankBranchCode] = useState("");
  const [empBankSwift, setEmpBankSwift] = useState("");

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

  const { data: staffUsers = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
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
    setEmpUserId("");
    setEmpFirstName(""); setEmpLastName("");
    setEmpPosition(""); setEmpDepartment(""); setEmpBaseSalary("");
    setEmpHousing(""); setEmpTransport(""); setEmpOtherAllowances([]);
    setEmpFuneralPolicy(""); setEmpOtherInsurance("");
    setEmpNssa(false); setEmpPaye(false); setEmpAidsLevy(false);
    setEmpCurrency("USD");
    setEmpEmploymentType("permanent"); setEmpContractStart(""); setEmpContractEnd("");
    setEmpBankName(""); setEmpBankBranch(""); setEmpBankAccount("");
    setEmpBankAccountType("current"); setEmpBankBranchCode(""); setEmpBankSwift("");
  }, []);

  useEffect(() => {
    if (editingEmployee) {
      setEmpUserId(editingEmployee.userId || "");
      setEmpFirstName(editingEmployee.firstName || "");
      setEmpLastName(editingEmployee.lastName || "");
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
      setEmpEmploymentType(editingEmployee.employmentType || "permanent");
      setEmpContractStart(editingEmployee.contractStartDate || "");
      setEmpContractEnd(editingEmployee.contractEndDate || "");
      setEmpBankName(editingEmployee.bankName || "");
      setEmpBankBranch(editingEmployee.bankBranch || "");
      setEmpBankAccount(editingEmployee.bankAccountNumber || "");
      setEmpBankAccountType(editingEmployee.bankAccountType || "current");
      setEmpBankBranchCode(editingEmployee.bankBranchCode || "");
      setEmpBankSwift(editingEmployee.bankSwiftCode || "");
    }
  }, [editingEmployee]);

  const buildEmpPayload = () => ({
    userId: empUserId || undefined,
    firstName: empFirstName.trim(),
    lastName: empLastName.trim(),
    position: empPosition.trim() || undefined,
    department: empDepartment.trim() || undefined,
    baseSalary: empBaseSalary || undefined,
    housingAllowance: empHousing || undefined,
    transportAllowance: empTransport || undefined,
    otherAllowances: empOtherAllowances.filter((a) => a.name.trim() && a.amount),
    funeralPolicyDeduction: empFuneralPolicy || undefined,
    otherInsuranceDeduction: empOtherInsurance || undefined,
    nssaEnabled: empNssa,
    payeEnabled: empPaye,
    aidsLevyEnabled: empAidsLevy,
    currency: empCurrency,
    employmentType: empEmploymentType,
    contractStartDate: empContractStart || undefined,
    contractEndDate: empContractEnd || undefined,
    bankName: empBankName.trim() || undefined,
    bankBranch: empBankBranch.trim() || undefined,
    bankAccountNumber: empBankAccount.trim() || undefined,
    bankAccountType: empBankAccountType || undefined,
    bankBranchCode: empBankBranchCode.trim() || undefined,
    bankSwiftCode: empBankSwift.trim() || undefined,
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
    if (!empFirstName || !empLastName) {
      toast({ title: "Required fields missing", description: "First name and last name are required.", variant: "destructive" });
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
              <Button variant="outline" className="gap-1.5" asChild>
                <a href={getApiBase() + "/api/forms/blank/employee-enrollment"} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4" /> Blank Enrollment Form
                </a>
              </Button>
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
                <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Emp #</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Basic</TableHead>
                      <TableHead>Gross</TableHead>
                      <TableHead>Banking</TableHead>
                      <TableHead>Taxes</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map((emp: any) => {
                      const gross = parseFloat(emp.baseSalary || "0") + parseFloat(emp.housingAllowance || "0") + parseFloat(emp.transportAllowance || "0") + (emp.otherAllowances || []).reduce((s: number, a: any) => s + parseFloat(a.amount || "0"), 0);
                      const taxes = [emp.nssaEnabled && "NSSA", emp.payeEnabled && "PAYE", emp.aidsLevyEnabled && "Levy"].filter(Boolean).join(", ");
                      const hasBanking = !!(emp.bankName || emp.bankAccountNumber);
                      const typeLabel: Record<string, string> = { permanent: "Permanent", contract: "Contract", fixed_term: "Fixed Term", probation: "Probation", casual: "Casual" };
                      return (
                        <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                          <TableCell className="font-mono text-xs">{emp.employeeNumber}</TableCell>
                          <TableCell className="font-medium">
                            {emp.firstName} {emp.lastName}
                            {emp.department && <div className="text-xs text-muted-foreground">{emp.department}</div>}
                          </TableCell>
                          <TableCell className="text-sm">{emp.position || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="text-xs">{typeLabel[emp.employmentType] || emp.employmentType || "—"}</Badge>
                            {emp.contractEndDate && (() => {
                              const days = Math.ceil((new Date(emp.contractEndDate).getTime() - Date.now()) / 86_400_000);
                              if (days < 0) return <div className="text-xs text-red-600">Expired</div>;
                              if (days <= 30) return <div className="text-xs text-amber-600">{days}d left</div>;
                              return null;
                            })()}
                          </TableCell>
                          <TableCell className="tabular-nums text-sm">{emp.currency} {parseFloat(emp.baseSalary || "0").toFixed(2)}</TableCell>
                          <TableCell className="font-semibold tabular-nums text-sm">{emp.currency} {gross.toFixed(2)}</TableCell>
                          <TableCell>
                            {hasBanking
                              ? <span className="text-xs text-emerald-700">{emp.bankName || "Set"}</span>
                              : <span className="text-xs text-muted-foreground">Not set</span>}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">{taxes || "None"}</TableCell>
                          <TableCell><Badge variant={emp.isActive ? "default" : "secondary"}>{emp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell>
                            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label="Edit employee" onClick={() => { setEditingEmployee(emp); setShowEmployeeDialog(true); }}>
                              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
                </div>
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
                <div className="overflow-x-auto">
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
                          <div className="flex gap-1 flex-wrap">
                            <Button variant="ghost" size="sm" onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}>
                              <FileSpreadsheet className="h-4 w-4 mr-1" />{selectedRun?.id === run.id ? "Close" : "Enter Payslips"}
                            </Button>
                            <SendAllPayslipsButton runId={run.id} />
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </div>
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
            <DialogDescription>
              {editingEmployee
                ? `Employee No: ${editingEmployee.employeeNumber} — update salary, allowances, deductions, employment details and banking.`
                : "Employee number is auto-generated. Fill in personal details, salary, banking and contract information."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">

            {/* Auto-generated number badge (edit only) */}
            {editingEmployee && (
              <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-4 py-2">
                <span className="text-xs text-muted-foreground">Employee Number</span>
                <span className="font-mono font-semibold text-sm">{editingEmployee.employeeNumber}</span>
                <span className="text-xs text-muted-foreground ml-auto">(auto-generated, read-only)</span>
              </div>
            )}

            {/* Link to system user */}
            <div className="space-y-1.5">
              <Label htmlFor="system-user-account-optional-required-for-self-logging-attendance">System User Account <span className="text-muted-foreground text-xs">(optional — required for self-logging attendance)</span></Label>
              <Select value={empUserId || "__none__"} onValueChange={(v) => setEmpUserId(v === "__none__" ? "" : v)}>
                <SelectTrigger id="system-user-account-optional-required-for-self-logging-attendance"><SelectValue placeholder="Not linked to a user" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not linked to a user</SelectItem>
                  {(staffUsers as any[]).map((u: any) => (
                    <SelectItem key={u.id} value={u.id}>{u.displayName || u.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Personal & role */}
            <div>
              <p className="text-sm font-semibold mb-3">Personal Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>First Name *</Label><Input value={empFirstName} onChange={(e) => setEmpFirstName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Last Name *</Label><Input value={empLastName} onChange={(e) => setEmpLastName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Position / Job Title</Label><Input value={empPosition} onChange={(e) => setEmpPosition(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Department</Label><Input value={empDepartment} onChange={(e) => setEmpDepartment(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>Currency</Label><CurrencySelect value={empCurrency} onValueChange={setEmpCurrency} /></div>
              </div>
            </div>

            <Separator />

            {/* Employment type & contract */}
            <div>
              <p className="text-sm font-semibold mb-3">Employment Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="emp-employment-type">Employment Type</Label>
                  <Select value={empEmploymentType} onValueChange={setEmpEmploymentType}>
                    <SelectTrigger id="emp-employment-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="permanent">Permanent</SelectItem>
                      <SelectItem value="contract">Contract</SelectItem>
                      <SelectItem value="fixed_term">Fixed Term</SelectItem>
                      <SelectItem value="probation">Probation</SelectItem>
                      <SelectItem value="casual">Casual / Part-time</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div /> {/* spacer */}
                <div className="space-y-1.5">
                  <Label htmlFor="emp-contract-start">Contract Start Date</Label>
                  <Input id="emp-contract-start" type="date" value={empContractStart} onChange={(e) => setEmpContractStart(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-contract-end">Contract End Date <span className="text-muted-foreground text-xs">(if applicable)</span></Label>
                  <Input id="emp-contract-end" type="date" value={empContractEnd} onChange={(e) => setEmpContractEnd(e.target.value)} />
                </div>
              </div>
              {empEmploymentType !== "permanent" && empContractEnd && (() => {
                const days = Math.ceil((new Date(empContractEnd).getTime() - Date.now()) / 86_400_000);
                if (days < 0) return <p className="text-xs text-red-600 mt-1">Contract has expired ({Math.abs(days)} days ago)</p>;
                if (days <= 30) return <p className="text-xs text-amber-600 mt-1">Contract expires in {days} day{days !== 1 ? "s" : ""}</p>;
                return <p className="text-xs text-muted-foreground mt-1">{days} days remaining on contract</p>;
              })()}
            </div>

            <Separator />

            {/* Banking details */}
            <div>
              <p className="text-sm font-semibold mb-3">Banking Details</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Bank Name</Label><Input value={empBankName} onChange={(e) => setEmpBankName(e.target.value)} placeholder="e.g. CBZ Bank" /></div>
                <div className="space-y-1.5"><Label>Branch Name</Label><Input value={empBankBranch} onChange={(e) => setEmpBankBranch(e.target.value)} placeholder="e.g. Harare Main" /></div>
                <div className="space-y-1.5"><Label>Account Number</Label><Input value={empBankAccount} onChange={(e) => setEmpBankAccount(e.target.value)} placeholder="Account number" /></div>
                <div className="space-y-1.5">
                  <Label htmlFor="emp-bank-account-type">Account Type</Label>
                  <Select value={empBankAccountType} onValueChange={setEmpBankAccountType}>
                    <SelectTrigger id="emp-bank-account-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="current">Current</SelectItem>
                      <SelectItem value="savings">Savings</SelectItem>
                      <SelectItem value="cheque">Cheque</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Branch Code</Label><Input value={empBankBranchCode} onChange={(e) => setEmpBankBranchCode(e.target.value)} placeholder="Branch sort code" /></div>
                <div className="space-y-1.5"><Label>SWIFT Code <span className="text-muted-foreground text-xs">(optional)</span></Label><Input value={empBankSwift} onChange={(e) => setEmpBankSwift(e.target.value)} placeholder="e.g. CBZWZWHAXXX" /></div>
              </div>
            </div>

            <Separator />

            {/* Earnings */}
            <div>
              <p className="text-sm font-semibold mb-3">Earnings (monthly defaults)</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Basic Salary</Label><Input type="number" step="0.01" min="0" value={empBaseSalary} onChange={(e) => setEmpBaseSalary(e.target.value)} placeholder="0.00" /></div>
                <div className="space-y-1.5"><Label>Housing Allowance</Label><Input type="number" step="0.01" min="0" value={empHousing} onChange={(e) => setEmpHousing(e.target.value)} placeholder="0.00" /></div>
                <div className="space-y-1.5"><Label>Transport Allowance</Label><Input type="number" step="0.01" min="0" value={empTransport} onChange={(e) => setEmpTransport(e.target.value)} placeholder="0.00" /></div>
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Funeral Policy</Label><Input type="number" step="0.01" min="0" value={empFuneralPolicy} onChange={(e) => setEmpFuneralPolicy(e.target.value)} placeholder="0.00" /></div>
                <div className="space-y-1.5"><Label>Other Insurance</Label><Input type="number" step="0.01" min="0" value={empOtherInsurance} onChange={(e) => setEmpOtherInsurance(e.target.value)} placeholder="0.00" /></div>
              </div>
            </div>

            <Separator />

            {/* Zimbabwe statutory taxes */}
            <div>
              <p className="text-sm font-semibold mb-1">Zimbabwe Statutory Deductions</p>
              <p className="text-xs text-muted-foreground mb-3">Toggle on/off per employee. Amounts entered manually per payroll run.</p>
              <div className="space-y-3">
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div><p className="text-sm font-medium">NSSA</p><p className="text-xs text-muted-foreground">National Social Security Authority</p></div>
                  <Switch checked={empNssa} onCheckedChange={setEmpNssa} />
                </div>
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div><p className="text-sm font-medium">PAYE</p><p className="text-xs text-muted-foreground">Pay As You Earn income tax</p></div>
                  <Switch checked={empPaye} onCheckedChange={setEmpPaye} />
                </div>
                <div className="flex items-center justify-between rounded-md border px-4 py-3">
                  <div><p className="text-sm font-medium">AIDS Levy</p><p className="text-xs text-muted-foreground">3% surcharge on PAYE</p></div>
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
