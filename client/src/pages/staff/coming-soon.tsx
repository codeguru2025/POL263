import StaffLayout from "@/components/layout/staff-layout";
import { PageShell } from "@/components/ds/page-shell";
import { PageHeader } from "@/components/ds/page-header";
import { CardSection } from "@/components/ds/card-section";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { Construction, ArrowRight } from "lucide-react";

interface StubInfo {
  title: string;
  blurb: string;
  related?: { label: string; href: string }[];
}

const STUBS: Record<string, StubInfo> = {
  // Transactions / Collections
  "/staff/transactions/society": { title: "Society Transactions", blurb: "Record contributions and transactions for burial societies. Society membership is managed today under Schemes.", related: [{ label: "Schemes", href: "/staff/groups" }] },
  "/staff/transactions/tombstone": { title: "Tombstone Transactions", blurb: "Capture tombstone orders and related transactions." },
  "/staff/transactions/credit-notes": { title: "Credit Notes", blurb: "Issue and track credit notes against policies and invoices.", related: [{ label: "Finance", href: "/staff/finance" }] },
  "/staff/transactions/invoices": { title: "Invoices", blurb: "Generate and manage customer invoices.", related: [{ label: "Finance", href: "/staff/finance" }] },
  "/staff/transactions/petty-cash": { title: "Petty Cash", blurb: "Log petty-cash disbursements and reconcile the float.", related: [{ label: "Collections", href: "/staff/finance?tab=payments" }, { label: "Requisitions", href: "/staff/finance?tab=requisitions" }] },
  "/staff/transactions/bank-deposits": { title: "Bank Deposits", blurb: "Record banking of collected cash and reconcile against receipts.", related: [{ label: "Cash-up", href: "/staff/finance?tab=cashups" }] },
  "/staff/transactions/debit-orders": { title: "Debit Orders", blurb: "Manage recurring debit-order collections for premiums.", related: [{ label: "Collections", href: "/staff/finance?tab=payments" }] },
  "/staff/transactions/fax": { title: "Fax", blurb: "Send and archive fax correspondence." },
  // Reports
  "/staff/reports/dynamic-generic": { title: "Dynamic Reports (Generic)", blurb: "Build ad-hoc reports across any data set.", related: [{ label: "Reports", href: "/staff/reports" }] },
  // Tools
  "/staff/tools/easypay": { title: "Manage EasyPay", blurb: "Configure EasyPay biller references and reconciliation." },
  "/staff/tools/print-policy-cards": { title: "Print Policy Cards", blurb: "Batch-print membership / policy cards.", related: [{ label: "Policies", href: "/staff/policies" }] },
  "/staff/tools/statistics": { title: "Statistics", blurb: "Operational statistics and KPIs.", related: [{ label: "Reports", href: "/staff/reports" }, { label: "Dashboard", href: "/staff" }] },
  "/staff/tools/statistical-graphs": { title: "Statistical Graphs", blurb: "Visual trend analysis.", related: [{ label: "Dashboard", href: "/staff" }] },
  "/staff/tools/claims-form": { title: "Manage Online Claims Form", blurb: "Configure the public online claims-intake form.", related: [{ label: "Claims", href: "/staff/claims" }] },
  "/staff/tools/transport-companies": { title: "Transport Companies", blurb: "Maintain transport / hearse provider directory used in funeral dispatch.", related: [{ label: "Funeral Cases", href: "/staff/funerals" }] },
  "/staff/tools/contacts": { title: "Contacts Manager", blurb: "Central directory of contacts.", related: [{ label: "Clients", href: "/staff/clients" }] },
  // Administration / Setup
  "/staff/admin/society": { title: "Society Admin", blurb: "Configure burial-society schemes, rules and membership.", related: [{ label: "Schemes", href: "/staff/groups" }] },
  "/staff/admin/tombstones": { title: "Tombstones Admin", blurb: "Manage the tombstone product catalogue." },
  "/staff/admin/invoice-items": { title: "Invoice Items Admin", blurb: "Define billable line items used on invoices.", related: [{ label: "Products", href: "/staff/products" }] },
  "/staff/admin/agents": { title: "Agent Admin", blurb: "Manage sales agents. Agent accounts are currently managed under Users.", related: [{ label: "Users", href: "/staff/users" }] },
  "/staff/admin/brokers": { title: "Broker Admin", blurb: "Manage broker partners and their distribution agreements.", related: [{ label: "Users", href: "/staff/users" }] },
  "/staff/admin/terminals": { title: "Terminals + Cards Admin", blurb: "Manage POS terminals and card stock." },
  "/staff/admin/sub-groups": { title: "Sub Group Admin", blurb: "Manage sub-groups within a scheme.", related: [{ label: "Schemes", href: "/staff/groups" }] },
  "/staff/admin/underwriters": { title: "Underwriter Admin", blurb: "Maintain underwriter partners and payable terms.", related: [{ label: "Products", href: "/staff/products" }] },
  "/staff/admin/undertakers": { title: "Undertaker Admin", blurb: "Maintain undertaker / funeral-parlour partners.", related: [{ label: "Funeral Cases", href: "/staff/funerals" }] },
};

export default function ComingSoon() {
  const [location] = useLocation();
  const info = STUBS[location] ?? { title: "Coming Soon", blurb: "This feature is being built and will be available in a future release." };

  return (
    <StaffLayout>
      <PageShell>
        <PageHeader title={info.title} description="Planned module — not yet available." />
        <CardSection title="What this will do" icon={Construction}>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">{info.blurb}</p>
          {info.related && info.related.length > 0 && (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">In the meantime, use</p>
              <div className="flex flex-wrap gap-2">
                {info.related.map((r) => (
                  <Link key={r.href} href={r.href}>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      {r.label}
                      <ArrowRight className="h-3.5 w-3.5 opacity-70" />
                    </Button>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
