import { useQuery } from "@tanstack/react-query";
import { CardSection, EnhancedDataTable, type EdtColumn, KpiStatCard } from "@/components/ds";
import { Badge } from "@/components/ui/badge";
import { TabsContent } from "@/components/ui/tabs";
import { FileText, TrendingUp } from "lucide-react";

const commissionRatesColumns: EdtColumn<any>[] = [
  { id: "product", header: "Product", accessor: (v) => v.productName, cell: (v) => <span className="font-medium">{v.productName}</span> },
  { id: "version", header: "Version", accessor: (v) => v.version, cell: (v) => <span>v{v.version}</span> },
  { id: "newBusinessRate", header: "New Business Rate", accessor: (v) => v.commissionFirstMonthsRate, cell: (v) => <span>{v.commissionFirstMonthsRate}% for {v.commissionFirstMonthsCount ?? "—"} months</span> },
  { id: "recurringRate", header: "Recurring Rate", accessor: (v) => v.commissionRecurringRate, cell: (v) => <span>{v.commissionRecurringRate}% from month {v.commissionRecurringStartMonth ?? "—"}</span> },
  { id: "clawbackThreshold", header: "Clawback Threshold", accessor: (v) => v.commissionClawbackThreshold ?? "", cell: (v) => <span>{v.commissionClawbackThreshold ?? "—"} payments</span> },
  { id: "status", header: "Status", accessor: (v) => (v.isActive ? "Active" : "Inactive"), cell: (v) => <Badge variant={v.isActive ? "default" : "secondary"}>{v.isActive ? "Active" : "Inactive"}</Badge> },
];

const commissionLedgerColumns: EdtColumn<any>[] = [
  { id: "date", header: "Date", accessor: (entry) => new Date(entry.createdAt), cell: (entry) => <span className="text-sm text-muted-foreground whitespace-nowrap">{new Date(entry.createdAt).toLocaleDateString()}</span> },
  {
    id: "client",
    header: "Client",
    accessor: (entry) => entry.clientFirstName ? `${entry.clientFirstName} ${entry.clientLastName}` : "",
    cell: (entry) =>
      entry.clientFirstName ? (
        <div>
          <p className="text-sm font-medium">{entry.clientFirstName} {entry.clientLastName}</p>
          {entry.clientPhone && <p className="text-[10px] text-muted-foreground">{entry.clientPhone}</p>}
        </div>
      ) : "—",
  },
  { id: "policy", header: "Policy", accessor: (entry) => entry.policyNumber || entry.policyId || "", cell: (entry) => <span className="font-mono text-sm">{entry.policyNumber || (entry.policyId ? entry.policyId.slice(0, 8) : "—")}</span> },
  { id: "agent", header: "Agent", accessor: (entry) => entry.agentDisplayName || entry.agentEmail || "", cell: (entry) => <span className="text-sm">{entry.agentDisplayName || entry.agentEmail || "—"}</span> },
  { id: "paymentDate", header: "Payment Date", accessor: (entry) => entry.paymentDate ? new Date(entry.paymentDate) : "", cell: (entry) => <span className="text-sm text-muted-foreground whitespace-nowrap">{entry.paymentDate ? new Date(entry.paymentDate).toLocaleDateString() : "—"}</span> },
  {
    id: "type",
    header: "Type",
    accessor: (entry) =>
      entry.entryType === "first_months" ? "New Business" :
      entry.entryType === "recurring" ? "Existing Business" :
      entry.entryType === "clawback" ? "Clawback" :
      entry.entryType === "rollback" ? "Rollback" :
      entry.entryType,
    cell: (entry) => {
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
      return <Badge variant={typeBadgeVariant}>{typeLabel}</Badge>;
    },
  },
  {
    id: "amount",
    header: "Amount",
    align: "right",
    accessor: (entry) => parseFloat(entry.amount || "0"),
    cell: (entry) => {
      const amountVal = parseFloat(entry.amount || "0");
      const isNegative = amountVal < 0;
      return (
        <span className={`font-semibold tabular-nums ${isNegative ? "text-red-600" : ""}`}>
          {isNegative ? "−" : ""}{entry.currency} {Math.abs(amountVal).toFixed(2)}
        </span>
      );
    },
  },
  { id: "description", header: "Description", accessor: (entry) => entry.description || "", cell: (entry) => <span className="text-sm max-w-[200px] truncate block" title={entry.description}>{entry.description || "—"}</span> },
  {
    id: "status",
    header: "Status",
    accessor: (entry) => entry.status,
    cell: (entry) => <Badge variant={entry.status === "earned" ? "default" : entry.status === "paid" ? "default" : "secondary"}>{entry.status}</Badge>,
  },
];

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
        >
          <EnhancedDataTable
            columns={commissionRatesColumns}
            rows={commissionConfigs}
            getRowKey={(v: any) => v.id}
            exportFilename="commission-rates"
            storageKey="finance-commission-rates"
            emptyMessage="No commission rates yet. Go to Products to set commission rates on a product version."
          />
        </CardSection>

        <CardSection title="Commission ledger" description="Auto-calculated when payments are receipted for policies with agents." icon={TrendingUp}>
          <EnhancedDataTable
            columns={commissionLedgerColumns}
            rows={commissionLedger}
            getRowKey={(entry: any) => entry.id}
            exportFilename="commission-ledger"
            storageKey="finance-commission-ledger"
            emptyMessage="No commission entries yet. Commissions appear here after receipted payments on agent-linked policies."
          />
        </CardSection>
      </div>
    </TabsContent>
  );
}
