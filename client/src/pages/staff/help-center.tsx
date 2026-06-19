import StaffLayout from "@/components/layout/staff-layout";
import { PageHeader, PageShell, CardSection } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { BookOpen, HelpCircle, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How do I issue a new policy?",
    a: "Go to Policies and click 'Issue New Policy'. Fill in the client details (or search for an existing client by National ID), choose a product, set the payment schedule and premium amount, then confirm. The system assigns a policy number automatically.",
  },
  {
    q: "How do I receipt a payment (collect a premium)?",
    a: "Use the Receipt button in the top toolbar or press Ctrl+K and type 'Receipt a Payment'. Search for the client's policy, enter the amount collected and the payment method (cash, bank transfer, EcoCash, etc.), then confirm. A receipt is generated immediately and you can print it or send it by SMS.",
  },
  {
    q: "What happens when a policy lapses?",
    a: "A policy lapses when premiums are overdue past the grace period. The system marks it as 'Lapsed' automatically. To reinstate it, open the policy detail page and use the 'Reinstate' action — you will need to collect the outstanding arrears first.",
  },
  {
    q: "How do I process a claim?",
    a: "Go to Claims and click 'New Claim'. Search for the policy, select the claim type (death, disability, etc.), upload supporting documents (death certificate, ID, etc.), and submit. The claim moves through an approval workflow before settlement.",
  },
  {
    q: "How do I add a new client?",
    a: "Go to Clients and click 'Add client'. Enter their National ID first — if they already exist in the system, their details will auto-fill. Otherwise fill in their personal details and save.",
  },
  {
    q: "How do I add dependants to a policy?",
    a: "Open the policy detail page and go to the Members tab. Click 'Add member' to add a spouse, children, or extended family depending on the product's rules.",
  },
  {
    q: "How do I create a burial society / scheme?",
    a: "Go to Schemes (side menu). Click 'Create scheme', fill in the group name, chairperson details, and treasurer. Then assign individual policies to the group from the Policies page.",
  },
  {
    q: "How do I generate a report?",
    a: "Go to Reports and choose the report type: Policy list, Payment collections, Claims, or Commissions. Set the date range, filter by branch or agent if needed, and click Download CSV or Print.",
  },
  {
    q: "How do I set up a new agent or staff user?",
    a: "Go to Users and click 'Invite user'. Enter their email address and assign the appropriate role (Admin, Manager, Agent, Cashier, etc.). They will receive a Google login invitation.",
  },
  {
    q: "How do I configure a new product?",
    a: "Go to Products and click 'New product'. Define the product name, benefit amounts (death cover, funeral cover), age band rules, add-ons, and premium schedule. Publish the product when ready.",
  },
  {
    q: "How do I process a group payment for a burial society?",
    a: "Go to Schemes, open the society, and use the 'Bulk payment' action. This lets a group executive pay premiums for all society members in one transaction via EcoCash or bank transfer.",
  },
  {
    q: "Can clients pay online themselves?",
    a: "Yes. Clients can log in at the client portal and pay their premiums using EcoCash, OneMoney, InnBucks, or Visa/Mastercard via the PayNow gateway. They receive automatic confirmation and a receipt.",
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-0">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 py-3 text-left text-sm font-medium hover:text-foreground/80 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{q}</span>
        {open ? <ChevronUp className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />}
      </button>
      {open && <p className="pb-3 text-sm text-muted-foreground leading-relaxed">{a}</p>}
    </div>
  );
}

export default function StaffHelpCenter() {
  return (
    <StaffLayout>
      <PageShell>
        <PageHeader
          title={<span className="font-display font-bold">Help Centre</span>}
          description="Common questions and how-to guides for POL263 staff."
        />

        <CardSection title="Frequently asked questions" icon={HelpCircle}>
          <div>
            {FAQ.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </CardSection>

        <CardSection title="Quick links" icon={BookOpen}>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild><Link href="/staff/settings">Organization settings</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/staff/notifications">SMS templates</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/staff/users">User accounts</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/staff/products">Products</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/staff/reports">Reports</Link></Button>
            <Button variant="outline" size="sm" asChild><Link href="/staff/reminders">My reminders</Link></Button>
          </div>
        </CardSection>
      </PageShell>
    </StaffLayout>
  );
}
