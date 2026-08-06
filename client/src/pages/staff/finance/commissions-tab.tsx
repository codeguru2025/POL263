import { useQuery } from "@tanstack/react-query";
import { CardSection, DataTable, dataTableStickyHeaderClass, EmptyState, KpiStatCard } from "@/components/ds";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { FileText, TrendingUp } from "lucide-react";

export function CommissionsTab() {
  const { data: rawProducts } = useQuery<any[]>({ queryKey: ["/api/products"] });
  const { data: rawCommissionLedger } = useQuery<any[]>({ queryKey: ["/api/commission-ledger"] });
  const { data: rawProductVersions } = useQuery<any[]>({ queryKey: ["/api/product-versions"] });

  const products = Array.isArray(rawProducts) ? rawProducts : [];
  const productVersions = Array.isArray(rawProductVersions) ? rawProductVersions : [];
  const commissionConfigs = productVersions
    .filter((v: any) => v.commissionFirstMonthsRate || v.commissionRecurringRate)
    .map((v: any) => {
      const product = products.find((p: any) => p.id === v.productId);
      return { ...v, productName: product?.name || "Unknown" };
    });
  const commissionLedger = Array.isArray(rawCommissionLedger) ? rawCommissionLedger : [];

  return (
    <TabsContent value="commissions">
      <div className="space-y-6">
        {(() => {
          const newBusiness = commissionLedger.filter((e: any) => e.entryType === "first_months");
          const existingBusiness = commissionLedger.filter((e: any) => e.entryType === "recurring");
          const clawbacks = commissionLedger.filter((e: any) => e.entryType === "clawback");
          const rollbacks = commissionLedger.filter((e: any) => e.entryType === "rollback");
          const sumOf = (arr: any[]) => arr.reduce((s: number, e: any) => s + parseFloat(e.amount || "0"), 0);
          const newBizTotal = sumOf(newBusiness);
          const existBizTotal = sumOf(existingBusiness);
          const clawbackTotal = sumOf(clawbacks);
          const rollbackTotal = sumOf(rollbacks);
          const netTotal = newBizTotal + existBizTotal + clawbackTotal + rollbackTotal;
          const defaultCurrency = commissionLedger[0]?.currency || "USD";
          const fmt = (v: number) => `${defaultCurrency} ${Math.abs(v).toFixed(2)}`;

          return (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <KpiStatCard label="New Business" value={<span className="text-blue-700" data-testid="stat-comm-new-biz">{fmt(newBizTotal)}</span>} hint={`${newBusiness.length} entries`} className="bg-blue-50 dark:bg-blue-950/20 border-blue-200" />
                <KpiStatCard label="Existing Business" value={<span className="text-emerald-700" data-testid="stat-comm-existing-biz">{fmt(existBizTotal)}</span>} hint={`${existingBusiness.length} entries`} className="bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200" />
                <KpiStatCard label="Clawbacks" value={<span className="text-red-700" data-testid="stat-comm-clawbacks">{clawbackTotal !== 0 ? `−${fmt(clawbackTotal)}` : fmt(0)}</span>} hint={`${clawbacks.length} entries`} className="bg-red-50 dark:bg-red-950/20 border-red-200" />
                <KpiStatCard label="Rollbacks" value={<span className="text-amber-700" data-testid="stat-comm-rollbacks">{fmt(rollbackTotal)}</span>} hint={`${rollbacks.length} entries`} className="bg-amber-50 dark:bg-amber-950/20 border-amber-200" />
                <KpiStatCard label="Total Commissions" value={<span className={netTotal < 0 ? "text-red-600" : "text-indigo-700"} data-testid="stat-comm-total">{netTotal < 0 ? `−${fmt(netTotal)}` : fmt(netTotal)}</span>} hint={`${commissionLedger.length} entries`} className="bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200" />
              </div>
            </>
          );
        })()}

        <CardSection
          title="Commission rates (from product versions)"
          description="Commission rates are configured when creating product versions in the Products section."
          icon={FileText}
          flush
        >
            {commissionConfigs.length === 0 ? (
              <EmptyState title="No commission rates yet" description="Go to Products to set commission rates on a product version." className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead>New Business Rate</TableHead>
                    <TableHead>Recurring Rate</TableHead>
                    <TableHead>Clawback Threshold</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionConfigs.map((v: any) => (
                    <TableRow key={v.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">{v.productName}</TableCell>
                      <TableCell>v{v.version}</TableCell>
                      <TableCell>{v.commissionFirstMonthsRate}% for {v.commissionFirstMonthsCount ?? "—"} months</TableCell>
                      <TableCell>{v.commissionRecurringRate}% from month {v.commissionRecurringStartMonth ?? "—"}</TableCell>
                      <TableCell>{v.commissionClawbackThreshold ?? "—"} payments</TableCell>
                      <TableCell><Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </DataTable>
            )}
        </CardSection>

        <CardSection title="Commission ledger" description="Auto-calculated when payments are receipted for policies with agents." icon={TrendingUp} flush>
            {commissionLedger.length === 0 ? (
              <EmptyState title="No commission entries yet" description="Commissions appear here after receipted payments on agent-linked policies." className="border-0 rounded-none bg-transparent py-8" />
            ) : (
              <DataTable containerClassName="border-0 shadow-none rounded-none bg-transparent">
                <TableHeader className={dataTableStickyHeaderClass}>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Client</TableHead>
                    <TableHead>Policy</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Payment Date</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissionLedger.map((entry: any) => {
                    const typeLabel =
                      entry.entryType === "first_months" ? "New Business" :
                      entry.entryType === "recurring" ? "Existing Business" :
                      entry.entryType === "clawback" ? "Clawback" :
                      entry.entryType === "rollback" ? "Rollback" :
                      entry.entryType;
                    const typeBadgeVariant =
                      entry.entryType === "clawback" ? "destructive" as const :
                      entry.entryType === "rollback" ? "secondary" as const :
                      "outline" as const;
                    const amountVal = parseFloat(entry.amount || "0");
                    const isNegative = amountVal < 0;
                    return (
                      <TableRow key={entry.id} className="hover:bg-muted/40">
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString()}</TableCell>
                        <TableCell>
                          {entry.clientFirstName ? (
                            <div>
                              <p className="text-sm font-medium">{entry.clientFirstName} {entry.clientLastName}</p>
                              {entry.clientPhone && <p className="text-[10px] text-muted-foreground">{entry.clientPhone}</p>}
                            </div>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{entry.policyNumber || (entry.policyId ? entry.policyId.slice(0, 8) : "—")}</TableCell>
                        <TableCell className="text-sm">{entry.agentDisplayName || entry.agentEmail || "—"}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                          {entry.paymentDate ? new Date(entry.paymentDate).toLocaleDateString() : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={typeBadgeVariant}>{typeLabel}</Badge>
                        </TableCell>
                        <TableCell className={`font-semibold tabular-nums text-right ${isNegative ? "text-red-600" : ""}`}>
                          {isNegative ? "−" : ""}{entry.currency} {Math.abs(amountVal).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-sm max-w-[200px] truncate">{entry.description || "—"}</TableCell>
                        <TableCell>
                          <Badge variant={entry.status === "earned" ? "default" : entry.status === "paid" ? "default" : "secondary"}>
                            {entry.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </DataTable>
            )}
        </CardSection>
      </div>
    </TabsContent>
  );
}
