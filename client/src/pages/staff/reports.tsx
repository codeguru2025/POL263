import { useQuery } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BarChart3, FileText, Loader2, Download, Truck, DollarSign, Users, Percent, Building } from "lucide-react";

function ExportButton({ reportType }: { reportType: string }) {
  const handleExport = () => {
    window.open(`/api/reports/export/${reportType}`, "_blank");
  };
  return (
    <Button variant="outline" size="sm" onClick={handleExport} data-testid={`button-export-${reportType}`}>
      <Download className="h-4 w-4 mr-1" />
      Export CSV
    </Button>
  );
}

export default function StaffReports() {
  const { data: stats } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: policies = [], isLoading: loadingPolicies } = useQuery<any[]>({ queryKey: ["/api/policies"] });
  const { data: claims = [], isLoading: loadingClaims } = useQuery<any[]>({ queryKey: ["/api/claims"] });
  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({ queryKey: ["/api/payments"] });
  const { data: funeralCases = [] } = useQuery<any[]>({ queryKey: ["/api/funeral-cases"] });
  const { data: fleet = [], isLoading: loadingFleet } = useQuery<any[]>({ queryKey: ["/api/fleet"] });
  const { data: expenditures = [], isLoading: loadingExpenditures } = useQuery<any[]>({ queryKey: ["/api/expenditures"] });
  const { data: payrollEmployees = [], isLoading: loadingPayroll } = useQuery<any[]>({ queryKey: ["/api/payroll/employees"] });
  const { data: commissionPlans = [], isLoading: loadingCommissions } = useQuery<any[]>({ queryKey: ["/api/commission-plans"] });
  const { data: chibikhuluReceivables = [], isLoading: loadingChibikhulu } = useQuery<any[]>({ queryKey: ["/api/chibikhulu/receivables"] });

  const policySummary = {
    draft: policies.filter((p: any) => p.status === "draft").length,
    pending: policies.filter((p: any) => p.status === "pending").length,
    active: policies.filter((p: any) => p.status === "active").length,
    grace: policies.filter((p: any) => p.status === "grace").length,
    lapsed: policies.filter((p: any) => p.status === "lapsed").length,
    cancelled: policies.filter((p: any) => p.status === "cancelled").length,
  };

  const claimSummary = {
    submitted: claims.filter((c: any) => c.status === "submitted").length,
    verified: claims.filter((c: any) => c.status === "verified").length,
    approved: claims.filter((c: any) => c.status === "approved").length,
    paid: claims.filter((c: any) => c.status === "paid").length,
    closed: claims.filter((c: any) => c.status === "closed").length,
    rejected: claims.filter((c: any) => c.status === "rejected").length,
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-reports-title">Reports</h1>
          <p className="text-muted-foreground">Date-filtered reports and analytics</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold" data-testid="text-total-policies">{stats?.totalPolicies || 0}</p>
              <p className="text-sm text-muted-foreground">Total Policies</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-green-600">{stats?.activePolicies || 0}</p>
              <p className="text-sm text-muted-foreground">Active Policies</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-blue-600">{stats?.totalClaims || 0}</p>
              <p className="text-sm text-muted-foreground">Total Claims</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-3xl font-bold text-orange-600">{stats?.totalTransactions || 0}</p>
              <p className="text-sm text-muted-foreground">Transactions</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="policies">
          <TabsList className="flex-wrap h-auto gap-1">
            <TabsTrigger value="policies" data-testid="tab-policies-report">Policies</TabsTrigger>
            <TabsTrigger value="claims" data-testid="tab-claims-report">Claims</TabsTrigger>
            <TabsTrigger value="payments" data-testid="tab-payments-report">Payments</TabsTrigger>
            <TabsTrigger value="funerals" data-testid="tab-funerals-report">Funerals</TabsTrigger>
            <TabsTrigger value="fleet" data-testid="tab-fleet-report">Fleet</TabsTrigger>
            <TabsTrigger value="expenditures" data-testid="tab-expenditures-report">Expenditure</TabsTrigger>
            <TabsTrigger value="payroll" data-testid="tab-payroll-report">Payroll</TabsTrigger>
            <TabsTrigger value="commissions" data-testid="tab-commissions-report">Commissions</TabsTrigger>
            <TabsTrigger value="chibikhulu" data-testid="tab-chibikhulu-report">Chibikhulu</TabsTrigger>
          </TabsList>

          <TabsContent value="policies">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5" />Policy Summary</CardTitle>
                  <ExportButton reportType="policies" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                  {Object.entries(policySummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status}</p>
                    </div>
                  ))}
                </div>
                {loadingPolicies ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy #</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Premium</TableHead>
                        <TableHead>Schedule</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {policies.slice(0, 20).map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm">{p.policyNumber}</TableCell>
                          <TableCell><Badge variant={p.status === "active" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                          <TableCell>{p.currency} {p.premiumAmount}</TableCell>
                          <TableCell>{p.paymentSchedule}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="claims">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" />Claims Summary</CardTitle>
                  <ExportButton reportType="claims" />
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
                  {Object.entries(claimSummary).map(([status, count]) => (
                    <div key={status} className="text-center p-3 rounded-lg bg-muted">
                      <p className="text-xl font-bold">{count}</p>
                      <p className="text-xs text-muted-foreground capitalize">{status}</p>
                    </div>
                  ))}
                </div>
                {loadingClaims ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Claim #</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {claims.slice(0, 20).map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell className="font-mono text-sm">{c.claimNumber}</TableCell>
                          <TableCell><Badge variant="outline">{c.claimType}</Badge></TableCell>
                          <TableCell><Badge>{c.status}</Badge></TableCell>
                          <TableCell>{c.deceasedName || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(c.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Payment Transactions</CardTitle>
                  <ExportButton reportType="payments" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPayments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No payments recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Received</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.slice(0, 20).map((p: any) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-sm">{p.reference || "—"}</TableCell>
                          <TableCell className="font-semibold">{p.currency} {p.amount}</TableCell>
                          <TableCell>{p.paymentMethod}</TableCell>
                          <TableCell><Badge>{p.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="funerals">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Funeral Cases</CardTitle>
                  <ExportButton reportType="funerals" />
                </div>
              </CardHeader>
              <CardContent>
                {funeralCases.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No funeral cases recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Case #</TableHead>
                        <TableHead>Deceased</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Funeral Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {funeralCases.slice(0, 20).map((fc: any) => (
                        <TableRow key={fc.id}>
                          <TableCell className="font-mono text-sm">{fc.caseNumber}</TableCell>
                          <TableCell>{fc.deceasedName}</TableCell>
                          <TableCell><Badge>{fc.status}</Badge></TableCell>
                          <TableCell>{fc.funeralDate || "TBD"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="fleet">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5" />Fleet Vehicles</CardTitle>
                  <ExportButton reportType="fleet" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingFleet ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : fleet.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-fleet">No fleet vehicles recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Registration</TableHead>
                        <TableHead>Make</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead>Year</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Mileage</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {fleet.slice(0, 20).map((v: any) => (
                        <TableRow key={v.id} data-testid={`row-fleet-${v.id}`}>
                          <TableCell className="font-mono text-sm">{v.registration}</TableCell>
                          <TableCell>{v.make}</TableCell>
                          <TableCell>{v.model}</TableCell>
                          <TableCell>{v.year}</TableCell>
                          <TableCell><Badge variant={v.status === "active" ? "default" : "secondary"}>{v.status}</Badge></TableCell>
                          <TableCell>{v.currentMileage || "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="expenditures">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><DollarSign className="h-5 w-5" />Expenditure Report</CardTitle>
                  <ExportButton reportType="expenditures" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingExpenditures ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : expenditures.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-expenditures">No expenditures recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenditures.slice(0, 20).map((e: any) => (
                        <TableRow key={e.id} data-testid={`row-expenditure-${e.id}`}>
                          <TableCell>{e.description}</TableCell>
                          <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                          <TableCell className="font-semibold">{e.currency} {e.amount}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.expenseDate}</TableCell>
                          <TableCell><Badge>{e.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="payroll">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Payroll Report</CardTitle>
                  <ExportButton reportType="payroll" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingPayroll ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payrollEmployees.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-payroll">No payroll employees recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Employee Name</TableHead>
                        <TableHead>ID Number</TableHead>
                        <TableHead>Position</TableHead>
                        <TableHead>Department</TableHead>
                        <TableHead>Basic Salary</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollEmployees.slice(0, 20).map((emp: any) => (
                        <TableRow key={emp.id} data-testid={`row-payroll-${emp.id}`}>
                          <TableCell className="font-medium">{emp.employeeName}</TableCell>
                          <TableCell className="font-mono text-sm">{emp.idNumber}</TableCell>
                          <TableCell>{emp.position}</TableCell>
                          <TableCell>{emp.department}</TableCell>
                          <TableCell className="font-semibold">{emp.basicSalary}</TableCell>
                          <TableCell><Badge variant={emp.status === "active" ? "default" : "secondary"}>{emp.status}</Badge></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="commissions">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Percent className="h-5 w-5" />Commission Plans</CardTitle>
                  <ExportButton reportType="commissions" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingCommissions ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : commissionPlans.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-commissions">No commission plans recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plan Name</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Rate (%)</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionPlans.slice(0, 20).map((cp: any) => (
                        <TableRow key={cp.id} data-testid={`row-commission-${cp.id}`}>
                          <TableCell className="font-medium">{cp.name}</TableCell>
                          <TableCell><Badge variant="outline">{cp.commissionType}</Badge></TableCell>
                          <TableCell>{cp.ratePercent}%</TableCell>
                          <TableCell><Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(cp.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chibikhulu">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2"><Building className="h-5 w-5" />Chibikhulu Revenue Share</CardTitle>
                  <ExportButton reportType="chibikhulu" />
                </div>
              </CardHeader>
              <CardContent>
                {loadingChibikhulu ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : chibikhuluReceivables.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8" data-testid="text-no-chibikhulu">No Chibikhulu receivables recorded</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Currency</TableHead>
                        <TableHead>Settled</TableHead>
                        <TableHead>Created</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chibikhuluReceivables.slice(0, 20).map((cr: any) => (
                        <TableRow key={cr.id} data-testid={`row-chibikhulu-${cr.id}`}>
                          <TableCell>{cr.description}</TableCell>
                          <TableCell className="font-semibold">{cr.amount}</TableCell>
                          <TableCell>{cr.currency}</TableCell>
                          <TableCell><Badge variant={cr.isSettled ? "default" : "secondary"}>{cr.isSettled ? "Settled" : "Pending"}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(cr.createdAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </StaffLayout>
  );
}
