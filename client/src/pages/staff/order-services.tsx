import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { MessageSquare, WalletCards, Puzzle } from "lucide-react";

export default function StaffOrderServices() {
  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Order services"
          description="SMS credits, prepaid balances, and add-on products. POL263 routes financial work through Finance and configuration through Settings."
        />
        <div className="grid gap-4 md:grid-cols-3">
          <CardSection title="SMS & messaging" icon={MessageSquare}>
            <p className="text-sm text-muted-foreground mb-3">
              Configure SMS-style notifications and templates under Notifications.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/notifications">Open notifications</Link>
            </Button>
          </CardSection>
          <CardSection title="Prepaid & receipts" icon={WalletCards}>
            <p className="text-sm text-muted-foreground mb-3">
              Record receipts, balances, and payment activity in Finance.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/finance">Open finance</Link>
            </Button>
          </CardSection>
          <CardSection title="Products & add-ons" icon={Puzzle}>
            <p className="text-sm text-muted-foreground mb-3">
              Manage catalogues and pricing from Products and the price book.
            </p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/products">Product builder</Link>
            </Button>
          </CardSection>
        </div>
      </PageShell>
    </StaffLayout>
  );
}
