import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, KpiStatCard, CardSection, EmptyState } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Users, Plus, Loader2, Banknote, Calendar, FileSpreadsheet, Play } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function StaffPayroll() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [showEmployeeDialog, setShowEmployeeDialog] = useState(false);
  const [showRunDialog, setShowRunDialog] = useState(false);
  const [selectedRun, setSelectedRun] = useState<any>(null);

  const [empFirstName, setEmpFirstName] = useState("");
  const [empLastName, setEmpLastName] = useState("");
  const [empNumber, setEmpNumber] = useState("");
  const [empPosition, setEmpPosition] = useState("");
  const [empDepartment, setEmpDepartment] = useState("");
  const [empBaseSalary, setEmpBaseSalary] = useState("");
  const [empCurrency, setEmpCurrency] = useState("USD");

  const [runPeriodStart, setRunPeriodStart] = useState("");
  const [runPeriodEnd, setRunPeriodEnd] = useState("");

  const { data: employees = [], isLoading: loadingEmployees } = useQuery<any[]>({
    queryKey: ["/api/payroll/employees"],
  });

  const { data: runs = [], isLoading: loadingRuns } = useQuery<any[]>({
    queryKey: ["/api/payroll/runs"],
  });

  const activeEmployees = useMemo(() => employees.filter((e: any) => e.isActive), [employees]);

  const totalSalaryBill = useMemo(() => {
    return activeEmployees.reduce((sum: number, e: any) => sum + parseFloat(e.baseSalary || "0"), 0);
  }, [activeEmployees]);

  const createEmployeeMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payroll/employees", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/employees"] });
      setShowEmployeeDialog(false);
      resetEmployeeForm();
      toast({ title: "Employee added", description: "New employee has been added to payroll." });
    },
    onError: (err: any) => toast({ title: "Failed to add employee", description: err.message, variant: "destructive" }),
  });

  const createRunMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payroll/runs", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payroll/runs"] });
      setShowRunDialog(false);
      setRunPeriodStart("");
      setRunPeriodEnd("");
      toast({ title: "Payroll run created", description: "New payroll run has been created as draft." });
    },
    onError: (err: any) => toast({ title: "Failed to create run", description: err.message, variant: "destructive" }),
  });

  const resetEmployeeForm = () => {
    setEmpFirstName("");
    setEmpLastName("");
    setEmpNumber("");
    setEmpPosition("");
    setEmpDepartment("");
    setEmpBaseSalary("");
    setEmpCurrency("USD");
  };

  const handleAddEmployee = () => {
    if (!empFirstName || !empLastName || !empNumber) {
      toast({ title: "Missing fields", description: "First name, last name, and employee number are required.", variant: "destructive" });
      return;
    }
    createEmployeeMutation.mutate({
      firstName: empFirstName,
      lastName: empLastName,
      employeeNumber: empNumber,
      position: empPosition || undefined,
      department: empDepartment || undefined,
      baseSalary: empBaseSalary || undefined,
      currency: empCurrency,
    });
  };

  const handleCreateRun = () => {
    if (!runPeriodStart || !runPeriodEnd) {
      toast({ title: "Missing dates", description: "Both period start and end dates are required.", variant: "destructive" });
      return;
    }
    createRunMutation.mutate({
      periodStart: runPeriodStart,
      periodEnd: runPeriodEnd,
    });
  };

  const employeeMap = useMemo(() => {
    const map: Record<string, any> = {};
    employees.forEach((e: any) => { map[e.id] = e; });
    return map;
  }, [employees]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "draft": return "secondary";
      case "processed": return "default";
      case "approved": return "default";
      case "paid": return "default";
      default: return "secondary";
    }
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
          <KpiStatCard label="Monthly salary bill" value={<span className="tabular-nums" data-testid="text-salary-bill">{totalSalaryBill.toFixed(2)}</span>} icon={Banknote} />
          <KpiStatCard label="Payroll runs" value={<span data-testid="text-run-count">{runs.length}</span>} icon={Calendar} />
        </div>

        <Tabs defaultValue="employees">
          <TabsList>
            <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
            <TabsTrigger value="runs" data-testid="tab-runs">Payroll Runs</TabsTrigger>
            <TabsTrigger value="payslips" data-testid="tab-payslips">Payslips</TabsTrigger>
          </TabsList>

          <TabsContent value="employees">
            <CardSection title="Employee List" icon={Users}>
              {loadingEmployees ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : employees.length === 0 ? (
                <EmptyState
                  title="No employees added yet"
                  description="Add employees to start managing payroll."
                  action={<Button variant="outline" size="sm" onClick={() => { resetEmployeeForm(); setShowEmployeeDialog(true); }} data-testid="button-add-first-employee"><Plus className="h-4 w-4 mr-2" />Add First Employee</Button>}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employee #</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Position</TableHead>
                      <TableHead>Department</TableHead>
                      <TableHead>Base Salary</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map((emp: any) => (
                      <TableRow key={emp.id} data-testid={`row-employee-${emp.id}`}>
                        <TableCell className="font-mono text-sm">{emp.employeeNumber}</TableCell>
                        <TableCell className="font-medium">{emp.firstName} {emp.lastName}</TableCell>
                        <TableCell>{emp.position || "—"}</TableCell>
                        <TableCell>{emp.department || "—"}</TableCell>
                        <TableCell className="font-semibold">{emp.currency} {parseFloat(emp.baseSalary || "0").toFixed(2)}</TableCell>
                        <TableCell>
                          <Badge variant={emp.isActive ? "default" : "secondary"}>
                            {emp.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardSection>
          </TabsContent>

          <TabsContent value="runs">
            <CardSection title="Payroll Runs" icon={Calendar}>
              {loadingRuns ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
              ) : runs.length === 0 ? (
                <EmptyState
                  title="No payroll runs yet"
                  description="Create a payroll run to process employee salaries."
                  action={<Button variant="outline" size="sm" onClick={() => setShowRunDialog(true)} data-testid="button-create-first-run"><Plus className="h-4 w-4 mr-2" />Create First Run</Button>}
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Period</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Total Gross</TableHead>
                      <TableHead>Total Deductions</TableHead>
                      <TableHead>Total Net</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run: any) => (
                      <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                        <TableCell className="font-medium">
                          {run.periodStart} — {run.periodEnd}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusColor(run.status)}>{run.status}</Badge>
                        </TableCell>
                        <TableCell className="font-semibold">{run.totalGross ? parseFloat(run.totalGross).toFixed(2) : "—"}</TableCell>
                        <TableCell>{run.totalDeductions ? parseFloat(run.totalDeductions).toFixed(2) : "—"}</TableCell>
                        <TableCell className="font-semibold">{run.totalNet ? parseFloat(run.totalNet).toFixed(2) : "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{new Date(run.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedRun(selectedRun?.id === run.id ? null : run)}
                            data-testid={`button-view-run-${run.id}`}
                          >
                            <FileSpreadsheet className="h-4 w-4 mr-1" />View
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
                title={`Payslips for ${selectedRun.periodStart} — ${selectedRun.periodEnd}`}
                icon={FileSpreadsheet}
                className="mt-4"
              >
                <p className="text-sm text-muted-foreground py-4">
                  Payslip generation is available when the run is processed. Current status: <Badge variant={getStatusColor(selectedRun.status)}>{selectedRun.status}</Badge>
                </p>
              </CardSection>
            )}
          </TabsContent>

          <TabsContent value="payslips">
            <CardSection title="Payslip Data" icon={FileSpreadsheet}>
              {runs.length === 0 ? (
                <EmptyState
                  title="No payslips available"
                  description="Create and process a payroll run to generate payslips."
                  className="border-0 rounded-none bg-transparent py-10"
                />
              ) : (
                <div className="space-y-3">
                  {runs.map((run: any) => (
                    <div key={run.id} className="flex items-center justify-between p-4 border rounded-lg">
                      <div>
                        <p className="font-medium">Period: {run.periodStart} — {run.periodEnd}</p>
                        <p className="text-sm text-muted-foreground">
                          Status: <Badge variant={getStatusColor(run.status)} className="ml-1">{run.status}</Badge>
                        </p>
                      </div>
                      <div className="text-right">
                        {run.totalNet && (
                          <p className="font-semibold text-lg">Net: {run.currency} {parseFloat(run.totalNet).toFixed(2)}</p>
                        )}
                        <p className="text-xs text-muted-foreground">Created {new Date(run.createdAt).toLocaleDateString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardSection>
          </TabsContent>
        </Tabs>
      </PageShell>

      <Dialog open={showEmployeeDialog} onOpenChange={setShowEmployeeDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Employee</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>First Name</Label>
                <Input
                  value={empFirstName}
                  onChange={(e) => setEmpFirstName(e.target.value)}
                  placeholder="John"
                  data-testid="input-emp-firstname"
                />
              </div>
              <div>
                <Label>Last Name</Label>
                <Input
                  value={empLastName}
                  onChange={(e) => setEmpLastName(e.target.value)}
                  placeholder="Doe"
                  data-testid="input-emp-lastname"
                />
              </div>
            </div>
            <div>
              <Label>Employee Number</Label>
              <Input
                value={empNumber}
                onChange={(e) => setEmpNumber(e.target.value)}
                placeholder="EMP-001"
                data-testid="input-emp-number"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Position</Label>
                <Input
                  value={empPosition}
                  onChange={(e) => setEmpPosition(e.target.value)}
                  placeholder="Sales Agent"
                  data-testid="input-emp-position"
                />
              </div>
              <div>
                <Label>Department</Label>
                <Input
                  value={empDepartment}
                  onChange={(e) => setEmpDepartment(e.target.value)}
                  placeholder="Sales"
                  data-testid="input-emp-department"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Base Salary</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={empBaseSalary}
                  onChange={(e) => setEmpBaseSalary(e.target.value)}
                  placeholder="0.00"
                  data-testid="input-emp-salary"
                />
              </div>
              <div>
                <Label>Currency</Label>
                <CurrencySelect value={empCurrency} onValueChange={setEmpCurrency} />
              </div>
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowEmployeeDialog(false)}>Cancel</Button>
            <Button
              onClick={handleAddEmployee}
              disabled={createEmployeeMutation.isPending}
              data-testid="button-submit-employee"
            >
              {createEmployeeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add Employee
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showRunDialog} onOpenChange={setShowRunDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create Payroll Run</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Period Start</Label>
              <Input
                type="date"
                value={runPeriodStart}
                onChange={(e) => setRunPeriodStart(e.target.value)}
                data-testid="input-run-start"
              />
            </div>
            <div>
              <Label>Period End</Label>
              <Input
                type="date"
                value={runPeriodEnd}
                onChange={(e) => setRunPeriodEnd(e.target.value)}
                data-testid="input-run-end"
              />
            </div>
          </div>
          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowRunDialog(false)}>Cancel</Button>
            <Button
              onClick={handleCreateRun}
              disabled={createRunMutation.isPending}
              data-testid="button-submit-run"
            >
              {createRunMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Run
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
