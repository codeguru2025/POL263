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
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { DollarSign, Plus, Receipt, Wallet, TrendingUp, Loader2, Search, CheckCircle2, AlertCircle, FileText } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";

export default function StaffFinance() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPaymentDialog, setShowPaymentDialog] = useState(false);
  const [policySearch, setPolicySearch] = useState("");
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentCurrency, setPaymentCurrency] = useState("USD");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [receiptResult, setReceiptResult] = useState<any>(null);
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);

  const { data: payments = [], isLoading: loadingPayments } = useQuery<any[]>({ queryKey: ["/api/payments"] });
  const { data: cashups = [] } = useQuery<any[]>({ queryKey: ["/api/cashups"] });
  const { data: commissionPlans = [] } = useQuery<any[]>({ queryKey: ["/api/commission-plans"] });
  const { data: expenditures = [] } = useQuery<any[]>({ queryKey: ["/api/expenditures"] });
  const { data: policies = [] } = useQuery<any[]>({ queryKey: ["/api/policies"] });
  const { data: clients = [] } = useQuery<any[]>({ queryKey: ["/api/clients"] });

  const clientMap = useMemo(() => {
    const map: Record<string, any> = {};
    clients.forEach((c: any) => { map[c.id] = c; });
    return map;
  }, [clients]);

  const filteredPolicies = useMemo(() => {
    if (!policySearch.trim()) return [];
    const q = policySearch.toLowerCase();
    return policies.filter((p: any) => {
      const client = clientMap[p.clientId];
      const clientName = client ? `${client.firstName} ${client.lastName}`.toLowerCase() : "";
      return (
        (p.policyNumber || "").toLowerCase().includes(q) ||
        clientName.includes(q)
      );
    }).slice(0, 8);
  }, [policySearch, policies, clientMap]);

  const totalCleared = useMemo(() => {
    return payments
      .filter((p: any) => p.status === "cleared")
      .reduce((sum: number, p: any) => sum + parseFloat(p.amount || "0"), 0);
  }, [payments]);

  const createPaymentMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/payments", data);
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      setShowPaymentDialog(false);
      resetPaymentForm();
      setReceiptResult(result);
      setShowReceiptDialog(true);
      toast({ title: "Payment recorded & receipt generated", description: `Receipt for ${selectedPolicy?.policyNumber || "policy"}` });
    },
    onError: (err: any) => toast({ title: "Payment failed", description: err.message, variant: "destructive" }),
  });

  const resetPaymentForm = () => {
    setPolicySearch("");
    setSelectedPolicy(null);
    setPaymentAmount("");
    setPaymentCurrency("USD");
    setPaymentMethod("cash");
    setPaymentReference("");
    setPaymentNotes("");
  };

  const handleOpenPaymentDialog = () => {
    resetPaymentForm();
    setShowPaymentDialog(true);
  };

  const handleSubmitPayment = () => {
    if (!selectedPolicy) {
      toast({ title: "Select a policy", description: "Search and select the policy you're receipting.", variant: "destructive" });
      return;
    }
    if (!paymentAmount || parseFloat(paymentAmount) <= 0) {
      toast({ title: "Enter amount", description: "Payment amount must be greater than zero.", variant: "destructive" });
      return;
    }
    createPaymentMutation.mutate({
      policyId: selectedPolicy.id,
      clientId: selectedPolicy.clientId,
      amount: paymentAmount,
      currency: paymentCurrency,
      paymentMethod: paymentMethod,
      status: "cleared",
      reference: paymentReference || undefined,
      notes: paymentNotes || undefined,
    });
  };

  const getClient = (clientId: string) => clientMap[clientId];
  const getPolicyNumber = (policyId: string) => {
    const pol = policies.find((p: any) => p.id === policyId);
    return pol?.policyNumber || policyId?.slice(0, 8);
  };

  return (
    <StaffLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-finance-title">Finance</h1>
            <p className="text-muted-foreground">Payments, receipts, cashups, and commissions</p>
          </div>
          <Button onClick={handleOpenPaymentDialog} data-testid="button-new-payment">
            <Plus className="h-4 w-4 mr-2" />Receipt a Policy
          </Button>
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
                <CheckCircle2 className="h-8 w-8 text-green-600" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Receipted</p>
                  <p className="text-2xl font-bold" data-testid="text-total-cleared">{paymentCurrency} {totalCleared.toFixed(2)}</p>
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
            <TabsTrigger value="payments" data-testid="tab-payments">Payments & Receipts</TabsTrigger>
            <TabsTrigger value="cashups" data-testid="tab-cashups">Cashups</TabsTrigger>
            <TabsTrigger value="commissions" data-testid="tab-commissions">Commissions</TabsTrigger>
            <TabsTrigger value="expenditures" data-testid="tab-expenditures">Expenditures</TabsTrigger>
          </TabsList>

          <TabsContent value="payments">
            <Card>
              <CardHeader>
                <CardTitle>Payment Transactions</CardTitle>
              </CardHeader>
              <CardContent>
                {loadingPayments ? (
                  <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : payments.length === 0 ? (
                  <div className="text-center py-12">
                    <Receipt className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-muted-foreground mb-1">No payments recorded yet</p>
                    <p className="text-sm text-muted-foreground/70 mb-4">Click "Receipt a Policy" to record the first payment</p>
                    <Button variant="outline" size="sm" onClick={handleOpenPaymentDialog}>
                      <Plus className="h-4 w-4 mr-2" />Record First Payment
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Policy</TableHead>
                        <TableHead>Client</TableHead>
                        <TableHead>Amount</TableHead>
                        <TableHead>Method</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Reference</TableHead>
                        <TableHead>Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payments.map((p: any) => {
                        const client = p.clientId ? getClient(p.clientId) : null;
                        return (
                          <TableRow key={p.id} data-testid={`row-payment-${p.id}`}>
                            <TableCell className="font-mono text-sm">{p.policyId ? getPolicyNumber(p.policyId) : "—"}</TableCell>
                            <TableCell>{client ? `${client.firstName} ${client.lastName}` : "—"}</TableCell>
                            <TableCell className="font-semibold">{p.currency} {parseFloat(p.amount).toFixed(2)}</TableCell>
                            <TableCell><Badge variant="outline">{p.paymentMethod}</Badge></TableCell>
                            <TableCell>
                              <Badge variant={p.status === "cleared" ? "default" : p.status === "reversed" ? "destructive" : "secondary"}>
                                {p.status}
                              </Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs text-muted-foreground">{p.reference || "—"}</TableCell>
                            <TableCell className="text-sm text-muted-foreground">{new Date(p.receivedAt).toLocaleDateString()}</TableCell>
                          </TableRow>
                        );
                      })}
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

      <Dialog open={showPaymentDialog} onOpenChange={setShowPaymentDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Receipt a Policy Payment</DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            <div>
              <Label className="text-sm font-medium">Search Policy</Label>
              <div className="relative mt-1.5">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Type policy number or client name..."
                  value={policySearch}
                  onChange={(e) => { setPolicySearch(e.target.value); setSelectedPolicy(null); }}
                  className="pl-10"
                  data-testid="input-policy-search"
                />
              </div>

              {policySearch && !selectedPolicy && filteredPolicies.length > 0 && (
                <div className="mt-1 border rounded-md shadow-sm max-h-48 overflow-y-auto bg-popover">
                  {filteredPolicies.map((p: any) => {
                    const client = getClient(p.clientId);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className="w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center justify-between"
                        onClick={() => { setSelectedPolicy(p); setPolicySearch(p.policyNumber); }}
                        data-testid={`option-policy-${p.id}`}
                      >
                        <div>
                          <span className="font-mono text-sm font-medium">{p.policyNumber}</span>
                          {client && (
                            <span className="text-sm text-muted-foreground ml-2">
                              — {client.firstName} {client.lastName}
                            </span>
                          )}
                        </div>
                        <Badge variant={p.status === "active" ? "default" : "secondary"} className="text-xs">
                          {p.status}
                        </Badge>
                      </button>
                    );
                  })}
                </div>
              )}

              {policySearch && !selectedPolicy && filteredPolicies.length === 0 && (
                <p className="mt-2 text-sm text-muted-foreground flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> No matching policies found
                </p>
              )}
            </div>

            {selectedPolicy && (
              <Card className="bg-muted/40 border-dashed">
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-mono font-semibold text-sm" data-testid="text-selected-policy">{selectedPolicy.policyNumber}</p>
                      {getClient(selectedPolicy.clientId) && (
                        <p className="text-sm text-muted-foreground">
                          {getClient(selectedPolicy.clientId).firstName} {getClient(selectedPolicy.clientId).lastName}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <Badge variant={selectedPolicy.status === "active" ? "default" : "secondary"}>{selectedPolicy.status}</Badge>
                      {selectedPolicy.premiumAmount && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Premium: {selectedPolicy.premiumCurrency || "USD"} {parseFloat(selectedPolicy.premiumAmount).toFixed(2)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            <Separator />

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0.01"
                  placeholder={selectedPolicy?.premiumAmount ? parseFloat(selectedPolicy.premiumAmount).toFixed(2) : "0.00"}
                  value={paymentAmount}
                  onChange={(e) => setPaymentAmount(e.target.value)}
                  data-testid="input-payment-amount"
                />
                {selectedPolicy?.premiumAmount && !paymentAmount && (
                  <button
                    type="button"
                    className="text-xs text-primary mt-1 hover:underline"
                    onClick={() => setPaymentAmount(parseFloat(selectedPolicy.premiumAmount).toFixed(2))}
                    data-testid="button-use-premium"
                  >
                    Use premium amount ({parseFloat(selectedPolicy.premiumAmount).toFixed(2)})
                  </button>
                )}
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={paymentCurrency} onValueChange={setPaymentCurrency}>
                  <SelectTrigger data-testid="select-currency"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="ZAR">ZAR</SelectItem>
                    <SelectItem value="ZWL">ZWL</SelectItem>
                    <SelectItem value="BWP">BWP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger data-testid="select-payment-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank">Bank Transfer</SelectItem>
                  <SelectItem value="paynow">Paynow</SelectItem>
                  <SelectItem value="ecocash">EcoCash</SelectItem>
                  <SelectItem value="innbucks">InnBucks</SelectItem>
                  <SelectItem value="mukuru">Mukuru</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Reference (optional)</Label>
              <Input
                placeholder="Transaction reference, receipt number, etc."
                value={paymentReference}
                onChange={(e) => setPaymentReference(e.target.value)}
                data-testid="input-payment-reference"
              />
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                placeholder="Additional notes..."
                value={paymentNotes}
                onChange={(e) => setPaymentNotes(e.target.value)}
                data-testid="input-payment-notes"
              />
            </div>
          </div>

          <DialogFooter className="mt-2">
            <Button variant="outline" onClick={() => setShowPaymentDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSubmitPayment}
              disabled={!selectedPolicy || !paymentAmount || createPaymentMutation.isPending}
              data-testid="button-submit-payment"
            >
              {createPaymentMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              <Receipt className="h-4 w-4 mr-2" />
              Record Payment & Generate Receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Payment Receipted Successfully
            </DialogTitle>
          </DialogHeader>
          {receiptResult && (
            <div className="space-y-4">
              <Card className="bg-green-50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
                <CardContent className="pt-4 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Policy</span>
                    <span className="font-mono text-sm font-medium" data-testid="text-receipt-policy">
                      {receiptResult.policyId ? getPolicyNumber(receiptResult.policyId) : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Amount</span>
                    <span className="font-semibold" data-testid="text-receipt-amount">
                      {receiptResult.currency} {parseFloat(receiptResult.amount).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Method</span>
                    <Badge variant="outline">{receiptResult.paymentMethod}</Badge>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Status</span>
                    <Badge variant="default">Cleared</Badge>
                  </div>
                  {receiptResult.reference && (
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">Reference</span>
                      <span className="font-mono text-xs">{receiptResult.reference}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Date</span>
                    <span className="text-sm">{new Date(receiptResult.receivedAt).toLocaleString()}</span>
                  </div>
                </CardContent>
              </Card>
              <p className="text-xs text-muted-foreground text-center">
                An immutable receipt has been generated automatically. This entry cannot be edited — corrections must be made via reversal entries.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setShowReceiptDialog(false)} data-testid="button-close-receipt">
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaffLayout>
  );
}
