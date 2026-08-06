import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, StatusBadge } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { TabsContent } from "@/components/ui/tabs";
import { Wallet, ChevronDown, ChevronRight, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ExpenditurePaymentHistory } from "./payment-history-table";
import { QK_EXPENDITURES, QK_PAYMENT_DISBURSEMENTS } from "./query-keys";

interface ExpendituresTabProps {
  canWriteFinance: boolean;
  canDeleteExpenditure: boolean;
  openPayDialog: (type: "requisition" | "expenditure", item: any) => void;
}

export function ExpendituresTab({ canWriteFinance, canDeleteExpenditure, openPayDialog }: ExpendituresTabProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: rawExpenditures } = useQuery<any[]>({ queryKey: QK_EXPENDITURES });
  const expenditures = Array.isArray(rawExpenditures) ? rawExpenditures : [];

  const [confirmDeleteExpenditure, setConfirmDeleteExpenditure] = useState<any | null>(null);
  const [expandedExpId, setExpandedExpId] = useState<string | null>(null);

  const deleteExpenditureMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/expenditures/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QK_EXPENDITURES });
      queryClient.invalidateQueries({ queryKey: QK_PAYMENT_DISBURSEMENTS });
      setConfirmDeleteExpenditure(null);
      toast({ title: "Expenditure deleted" });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <>
    <TabsContent value="expenditures">
      <CardSection title="Expenditures" description="Direct operational spend. Click a row to view payment history. Record payments to move items from pending to paid." icon={Wallet} flush>
          {expenditures.length === 0 ? (
            <EmptyState title="No expenditures yet" className="border-0 rounded-none bg-transparent py-8" />
          ) : (
            <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
              <TableHeader className={dataTableStickyHeaderClass}>
                <TableRow>
                  <TableHead className="pl-6">Category</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right pr-6">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {expenditures.map((e: any) => {
                  const amountPaid = Number(e.amountPaid ?? 0);
                  const outstanding = Number(e.amount) - amountPaid;
                  const isExpExp = expandedExpId === e.id;
                  return (
                    <>
                    <TableRow key={e.id} className={`hover:bg-muted/40 cursor-pointer ${isExpExp ? "bg-muted/20" : ""}`} onClick={() => setExpandedExpId(isExpExp ? null : e.id)}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-1">
                          {isExpExp ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          <Badge variant="outline">{e.category}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm">{e.description}</TableCell>
                      <TableCell className="text-right">
                        <div className="tabular-nums font-semibold text-sm">{e.currency} {Number(e.amount).toFixed(2)}</div>
                        {e.status === "partial" && (
                          <div className="text-[10px] text-amber-600 dark:text-amber-400 tabular-nums">
                            Paid: {e.currency} {amountPaid.toFixed(2)} · Due: {outstanding.toFixed(2)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground tabular-nums">{e.spentAt || e.paidDate || "—"}</TableCell>
                      <TableCell><StatusBadge status={e.status || "pending"} /></TableCell>
                      <TableCell className="text-right pr-6" onClick={(ev) => ev.stopPropagation()}>
                        <div className="flex justify-end gap-1.5 flex-wrap">
                          {(e.status === "pending" || e.status === "partial") && canWriteFinance && (
                            <Button size="sm" variant="outline" onClick={() => openPayDialog("expenditure", e)} data-testid={`btn-pay-exp-${e.id}`}>
                              {e.status === "partial" ? "Pay Balance" : "Record Payment"}
                            </Button>
                          )}
                          {e.status === "paid" && <span className="text-xs text-muted-foreground self-center">Paid ✓</span>}
                          {canDeleteExpenditure && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Delete expenditure" onClick={() => setConfirmDeleteExpenditure(e)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isExpExp && (
                      <TableRow key={`${e.id}-detail`} className="hover:bg-transparent">
                        <TableCell colSpan={6} className="px-4 pb-4 pt-0 bg-muted/10">
                          <ExpenditurePaymentHistory expenditureId={e.id} currency={e.currency} />
                        </TableCell>
                      </TableRow>
                    )}
                    </>
                  );
                })}
              </TableBody>
            </DataTable>
          )}
      </CardSection>
    </TabsContent>

      <AlertDialog open={!!confirmDeleteExpenditure} onOpenChange={(v) => !v && setConfirmDeleteExpenditure(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete expenditure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this <strong>{confirmDeleteExpenditure?.description}</strong> expenditure and any
              disbursement recorded against it (currently {confirmDeleteExpenditure?.currency}{" "}
              {Number(confirmDeleteExpenditure?.amount ?? 0).toFixed(2)}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteExpenditureMutation.mutate(confirmDeleteExpenditure.id)}
              disabled={deleteExpenditureMutation.isPending}
            >
              {deleteExpenditureMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
