import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { BookOpen, LifeBuoy } from "lucide-react";

export default function StaffHelpCenter() {
  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title="Help centre"
          description="Training and documentation for staff. All styling uses your active theme."
        />
        <CardSection title="Get started" icon={BookOpen}>
          <p className="text-sm text-muted-foreground mb-4">
            For local setup, database configuration, and deployment, see the repository docs shipped with POL263.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/settings">Organization settings</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/staff/notifications">Notifications & templates</Link>
            </Button>
          </div>
        </CardSection>
        <CardSection title="Need help?" icon={LifeBuoy}>
          <p className="font-medium">Need something documented here?</p>
          <p className="text-sm text-muted-foreground mt-1">
            Ask your administrator to add org-specific procedures or video links to this page.
          </p>
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
