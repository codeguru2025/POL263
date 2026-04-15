import StaffLayout from "@/components/layout/staff-layout";
import { PageShell } from "@/components/ds/page-shell";
import { PageHeader } from "@/components/ds/page-header";
import { EmptyState } from "@/components/ds/empty-state";
import { useLocation } from "wouter";
import { Construction } from "lucide-react";

const PAGE_TITLES: Record<string, string> = {
  // Transactions
  "/staff/transactions/society": "Society Transactions",
  "/staff/transactions/tombstone": "Tombstone Transactions",
  "/staff/transactions/credit-notes": "Credit Notes",
  "/staff/transactions/invoices": "Invoices",
  "/staff/transactions/petty-cash": "Petty Cash",
  "/staff/transactions/bank-deposits": "Bank Deposits",
  "/staff/transactions/debit-orders": "Debit Orders",
  "/staff/transactions/fax": "Fax",
  // Reports
  "/staff/reports/dynamic-generic": "Dynamic Reports (Generic)",
  // Tools
  "/staff/tools/easypay": "Manage EasyPay",
  "/staff/tools/print-policy-cards": "Print Policy Cards",
  "/staff/tools/statistics": "Statistics",
  "/staff/tools/statistical-graphs": "Statistical Graphs",
  "/staff/tools/claims-form": "Manage Online Claims Form",
  "/staff/tools/transport-companies": "Transport Companies",
  "/staff/tools/contacts": "Contacts Manager",
  // Administration
  "/staff/admin/society": "Society Admin",
  "/staff/admin/tombstones": "Tombstones Admin",
  "/staff/admin/invoice-items": "Invoice Items Admin",
  "/staff/admin/agents": "Agent Admin",
  "/staff/admin/brokers": "Broker Admin",
  "/staff/admin/member-cards": "Member Card Admin",
  "/staff/admin/terminals": "Terminals + Cards Admin",
  "/staff/admin/branches": "Branch Admin",
  "/staff/admin/sub-groups": "Sub Group Admin",
  "/staff/admin/underwriters": "Underwriter Admin",
  "/staff/admin/undertakers": "Undertaker Admin",
};

export default function ComingSoon() {
  const [location] = useLocation();
  const title = PAGE_TITLES[location] ?? "Coming Soon";

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title={title} description="This module is under development." />
        <EmptyState
          icon={Construction}
          title="Coming Soon"
          description="This feature is being built and will be available in a future release."
        />
      </PageShell>
    </StaffLayout>
  );
}
