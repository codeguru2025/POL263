import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import StaffLayout from "@/components/layout/staff-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Plus, Receipt, Wallet, TrendingUp, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function StaffFinance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);

  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({ queryKey: ["/api/payments"] });
  const { data: cashups = [] } = useQuery<any[]>({ queryKey: ["/api/cashups"] });
  const { data: commissionPlans = [] } = useQuery<any[]>({ queryKey: ["/api/commission-plans"] });
  const { data: expenditures = [] } = useQuery<any[]>({ queryKey: ["/api/expenditures"] });

  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setShowPaymentDialog(false);
      toast({ title: "Payment recorded" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const handleCreatePayment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    createPaymentMutation.mutate({
      policyId: formData.get("policyId") || undefined,
      amount: formData.get("amount"),
      currency: formData.get("currency") || "USD",
      paymentMethod: formData.get("paymentMethod"),
      status: "cleared",
      reference: formData.get("reference") || undefined,
    });
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-finance-title">Finance</h1>
            <p className="text-muted-foreground">Payments, receipts, cashups, and commissions</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <DollarSign className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Payments</p>
                  <p className="text-2xl font-bold" data-testid="text-payment-count">{payments.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Receipt className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Cashups</p>
                  <p className="text-2xl font-bold">{cashups.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-8 w-8 text-blue-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Commission Plans</p>
                  <p className="text-2xl font-bold">{commissionPlans.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <Wallet className="h-8 w-8 text-orange-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Expenditures</p>
                  <p className="text-2xl font-bold">{expenditures.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="payments">
          <TabsList>
            <TabsTrigger value="payments" data-testid="tab-payments">Payments</TabsTrigger>
            <TabsTrigger value="cashups" data-testid="tab-cashups">Cashups</TabsTrigger>
            <TabsTrigger value="commissions" data-testid="tab-commissions">Commissions</TabsTrigger>
            <TabsTrigger value="expenditures" data-testid="tab-expenditures">Expenditures</TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>Payment Transactions</CardTitle>
                <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
                  <DialogTrigger asChild>
                    <Button data-testid="button-new-payment"><Plus className="h-4 w-4 mr-2" />Record Payment</Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle>Record Payment</DialogTitle></DialogHeader>
                    <form onSubmit={handleCreatePayment} className="space-y-4">
                      <div><Label>Amount</Label><Input name="amount" type="number" step="0.01" required data-testid="input-payment-amount" /></div>
                      <div><Label>Currency</Label>
                        <Select name="currency" defaultValue="USD">
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="USD">USD</SelectItem>
                            <SelectItem value="ZAR">ZAR</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Payment Method</Label>
                        <Select name="paymentMethod" defaultValue="cash">
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="cash">Cash</SelectItem>
                            <SelectItem value="bank">Bank Transfer</SelectItem>
                            <SelectItem value="paynow">Paynow</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div><Label>Reference</Label><Input name="reference" data-testid="input-payment-reference" /></div>
                      <Button type="submit" disabled={createPaymentMutation.isPending} data-testid="button-submit-payment">
                        {createPaymentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}Record
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loadingPayments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payments.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No payments recorded yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p: any) => (
                        <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                          <TableCell className="font-mono text-sm">{p.reference || "—"}</TableCell>
                          <TableCell className="font-semibold">{p.currency} {p.amount}</TableCell>
                          <TableCell><Badge variant="outline">{p.paymentMethod}</Badge></TableCell>
                          <TableCell><Badge variant={p.status === "cleared" ? "default" : "secondary"}>{p.status}</Badge></TableCell>
                          <TableCell className="text-sm text-muted-foreground">{new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="cashups">
            <Card>
              <CardHeader><CardTitle>Daily Cashups</CardTitle></CardHeader>
              <CardContent>
                {cashups.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No cashups recorded yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Total</TableHead>
                        <TableHead>Transactions</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {cashups.map((c: any) => (
                        <TableRow key={c.id}>
                          <TableCell>{c.cashupDate}</TableCell>
                          <TableCell className="font-semibold">{c.totalAmount}</TableCell>
                          <TableCell>{c.transactionCount}</TableCell>
                          <TableCell><Badge variant={c.isLocked ? "default" : "secondary"}>{c.isLocked ? "Locked" : "Open"}</Badge></TableCell>
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
              <CardHeader><CardTitle>Commission Plans</CardTitle></CardHeader>
              <CardContent>
                {commissionPlans.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No commission plans configured yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Name</TableHead>
                        <TableHead>First Months Rate</TableHead>
                        <TableHead>Recurring Rate</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {commissionPlans.map((cp: any) => (
                        <TableRow key={cp.id}>
                          <TableCell className="font-medium">{cp.name}</TableCell>
                          <TableCell>{cp.firstMonthsRate}% for {cp.firstMonthsCount} months</TableCell>
                          <TableCell>{cp.recurringRate}% from month {cp.recurringStartMonth}</TableCell>
                          <TableCell><Badge variant={cp.isActive ? "default" : "secondary"}>{cp.isActive ? "Active" : "Inactive"}</Badge></TableCell>
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
              <CardHeader><CardTitle>Expenditures</CardTitle></CardHeader>
              <CardContent>
                {expenditures.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">No expenditures recorded yet</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenditures.map((e: any) => (
                        <TableRow key={e.id}>
                          <TableCell><Badge variant="outline">{e.category}</Badge></TableCell>
                          <TableCell>{e.description}</TableCell>
                          <TableCell className="font-semibold">{e.currency} {e.amount}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.spentAt || "—"}</TableCell>
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
