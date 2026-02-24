import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-payroll-title">Payroll</h1>
            <p className="text-muted-foreground">Manage employees, payroll runs, and payslips</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { resetEmployeeForm(); setShowEmployeeDialog(true); }} data-testid="button-add-employee">
              <Plus className="h-4 w-4 mr-2" />Add Employee
            </Button>
            <Button onClick={() => setShowRunDialog(true)} data-testid="button-create-run">
              <Play className="h-4 w-4 mr-2" />New Payroll Run
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Employees</p>
                  <p className="text-2xl font-bold" data-testid="text-employee-count">{employees.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Users className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Active Employees</p>
                  <p className="text-2xl font-bold" data-testid="text-active-count">{activeEmployees.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Banknote className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Monthly Salary Bill</p>
                  <p className="text-2xl font-bold" data-testid="text-salary-bill">USD {totalSalaryBill.toFixed(2)}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Calendar className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Payroll Runs</p>
                  <p className="text-2xl font-bold" data-testid="text-run-count">{runs.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="employees">
          <TabsList>
            <TabsTrigger value="employees" data-testid="tab-employees">Employees</TabsTrigger>
            <TabsTrigger value="runs" data-testid="tab-runs">Payroll Runs</TabsTrigger>
            <TabsTrigger value="payslips" data-testid="tab-payslips">Payslips</TabsTrigger>
          </TabsList>

          <TabsContent value="employees">
            <Card>
              <CardHeader>
                <CardTitle>Employee List</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingEmployees ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : employees.length === 0 ? (
                  <div className="text-center py-12">
                    <Users className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground mb-1">No employees added yet</p>
                    <p className="text-sm text-muted-foreground/70 mb-4">Add employees to start managing payroll</p>
                    <Button variant="outline" size="sm" onClick={() => { resetEmployeeForm(); setShowEmployeeDialog(true); }} data-testid="button-add-first-employee">
                      <Plus className="h-4 w-4 mr-2" />Add First Employee
                    </Button>
                  </div>
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
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="runs">
            <Card>
              <CardHeader>
                <CardTitle>Payroll Runs</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingRuns ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : runs.length === 0 ? (
                  <div className="text-center py-12">
                    <Calendar className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground mb-1">No payroll runs yet</p>
                    <p className="text-sm text-muted-foreground/70 mb-4">Create a payroll run to process employee salaries</p>
                    <Button variant="outline" size="sm" onClick={() => setShowRunDialog(true)} data-testid="button-create-first-run">
                      <Plus className="h-4 w-4 mr-2" />Create First Run
                    </Button>
                  </div>
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
              </CardContent>
            </Card>

            {selectedRun && (
              <Card className="mt-4">
                <CardHeader>
                  <CardTitle>Payslips for {selectedRun.periodStart} — {selectedRun.periodEnd}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground py-4">
                    Payslip generation is available when the run is processed. Current status: <Badge variant={getStatusColor(selectedRun.status)}>{selectedRun.status}</Badge>
                  </p>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="payslips">
            <Card>
              <CardHeader>
                <CardTitle>Payslip Data</CardTitle>
              </CardHeader>
              <CardContent>
                {runs.length === 0 ? (
                  <div className="text-center py-12">
                    <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground mb-1">No payslips available</p>
                    <p className="text-sm text-muted-foreground/70">Create and process a payroll run to generate payslips</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {runs.map((run: any) => (
                      <Card key={run.id} className="border-dashed">
                        <CardContent className="pt-4">
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium">Period: {run.periodStart} — {run.periodEnd}</p>
                              <p className="text-sm text-muted-foreground">
                                Status: <Badge variant={getStatusColor(run.status)} className="ml-1">{run.status}</Badge>
                              </p>
                            </div>
                            <div className="text-right">
                              {run.totalNet && (
                                <p className="font-semibold text-lg">Net: USD {parseFloat(run.totalNet).toFixed(2)}</p>
                              )}
                              <p className="text-xs text-muted-foreground">Created {new Date(run.createdAt).toLocaleDateString()}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

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
                <Select value={empCurrency} onValueChange={setEmpCurrency}>
                  <SelectTrigger data-testid="select-emp-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZWL">ZWL</SelectItem>
                    <SelectItem value="BWP">BWP</SelectItem>
                  </SelectContent>
                </Select>
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
