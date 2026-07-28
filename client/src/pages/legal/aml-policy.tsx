import { AppChrome } from "@/components/layout/app-chrome";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Clause({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="flex items-baseline gap-3 border-b pb-2 mb-3">
        <span className="font-mono text-sm font-bold text-primary">{num}</span>
        <h2 className="font-display font-semibold text-lg">{title}</h2>
      </div>
      <div className="space-y-3 text-sm leading-relaxed max-w-[66ch] [&_strong]:text-foreground [&_strong]:font-semibold">
        {children}
      </div>
    </section>
  );
}

export default function AmlPolicyPage() {
  return (
    <AppChrome center={false} mainClassName="max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-6 sm:p-10">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <Badge variant="outline" className="font-mono text-[0.68rem] uppercase tracking-wide">
              Pending Sign-off
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">POL-AML-01 · v1.1</span>
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-balance mb-2">
            Anti-Money Laundering &amp; Suspicious Transaction Policy
          </h1>
          <p className="text-muted-foreground max-w-[58ch] mb-6">
            Governs how staff at the funeral parlours and insurers running on POL263 review and escalate unusual
            premium payments, claims payouts, and account activity, pending an automated screening capability.
          </p>

          <Clause num="1" title="Purpose & scope">
            <p>
              <strong>POL263 is the engine, not the insurer.</strong> It is the technology platform that powers each
              tenant's own branded funeral-assurance or insurance operation. POL263 does not underwrite, sell, or own
              any insurance product — each tenant (a funeral parlour, burial society, or insurer running on POL263)
              does, under its own registration or license, with its own clients and its own regulatory standing. What
              POL263 owns is the infrastructure those transactions run on, and this policy: a shared baseline every
              tenant's business operates under by default.
            </p>
            <p>
              This policy governs manual review of activity in the absence of an automated AML or sanctions-screening
              capability. Every premium payment, claim payout, and refund across every tenant is subject to the review
              procedure set out below.
            </p>
            <p>
              It applies to every payment channel POL263 tenants use: EcoCash, OneMoney, InnBucks, O'Mari, card
              payments via PayNow, and cash receipted in person — across every tenant on the platform, not one
              specific business.
            </p>
          </Clause>

          <Clause num="2" title="What counts as suspicious">
            <p>No single indicator proves wrongdoing — each is a reason to look closer, not a reason to refuse service on its own.</p>
            <div className="grid gap-3 sm:grid-cols-2 not-prose">
              {[
                ["Amount", "A single payment, or a policy's cumulative payments in 24 hours, exceeding $1,000 USD-equivalent — well above the $3-$20 monthly premiums typical across POL263 products."],
                ["Structuring", "Several payments just under the threshold above, made in quick succession on the same policy."],
                ["Mismatch", "Payer phone/name on the transaction doesn't match the policyholder or any registered dependent."],
                ["Pattern break", "A lump-sum payment inconsistent with the policy's normal premium and payment schedule."],
                ["Rapid reversal", "Payment followed shortly by a cancellation and refund request, especially on a newly-issued policy."],
                ["Identity", "National ID or KYC document that fails verification, or is flagged during the existing document-verification workflow."],
              ].map(([label, text]) => (
                <div key={label} className="rounded-lg border bg-card p-3">
                  <div className="font-mono text-[0.68rem] uppercase tracking-wide text-primary font-bold mb-1">{label}</div>
                  <p className="text-xs text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </Clause>

          <Clause num="3" title="Roles">
            <p>
              Two different things sit under "AML compliance" here: the <strong>regulatory obligation</strong>, which
              belongs to each tenant as the licensed business; and the <strong>review function</strong>, which POL263
              performs as a shared service across every tenant, by default. This table keeps those separate on
              purpose.
            </p>
            <div className="overflow-x-auto not-prose">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2 pr-3">Role</th>
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2">Responsibility</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b align-top">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">Tenant (funeral parlour / insurer)</td>
                    <td className="py-2">The regulated entity. Owns its clients, its products, and ultimate accountability for AML compliance on its own transactions — this policy is a baseline it operates under, not a transfer of that accountability to POL263.</td>
                  </tr>
                  <tr className="border-b align-top">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">Receipting / finance staff</td>
                    <td className="py-2">Recognise the indicators in §2 during normal payment processing, for whichever tenant they work under; escalate, don't decide.</td>
                  </tr>
                  <tr className="border-b align-top">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">AML Officer</td>
                    <td className="py-2">Reviews every escalation across every tenant within <strong>1 business day</strong>, decides accept / hold / decline / report, acting on tenants' behalf under this shared arrangement. May be delegated to a named lead per tenant as the platform grows, or where a tenant's own license conditions require it.</td>
                  </tr>
                  <tr className="align-top">
                    <td className="py-2 pr-3 font-medium whitespace-nowrap">POL263 (the platform)</td>
                    <td className="py-2">Provides the tooling this policy runs on — payment processing, the audit log, escalation routing — and performs the AML Officer function above as a service to tenants. Providing that service doesn't make POL263 the insurer, and doesn't remove each tenant's own regulatory standing.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Clause>

          <Clause num="4" title="Escalation procedure">
            <ol className="list-decimal pl-5 space-y-2">
              <li>Staff member notices an indicator from §2 and does <strong>not</strong> process the transaction as routine.</li>
              <li>Staff member records the client, policy number, amount, and reason for concern, and emails it to <strong>compliance@pol263.com</strong>.</li>
              <li>AML Officer reviews within the timeframe set in §3 and records a decision: accept, place on hold pending more information, decline the transaction, or report externally.</li>
              <li>
                If reported externally, the report goes to Zimbabwe's <strong>Financial Intelligence Unit (FIU)</strong>,
                under the Reserve Bank of Zimbabwe (
                <a href="https://www.fiu.co.zw/" target="_blank" rel="noreferrer" className="text-primary underline underline-offset-2">
                  fiu.co.zw
                </a>
                ), per the Money Laundering and Proceeds of Crime Act (Chapter 9:24). Because POL263 is one platform
                behind several separately-licensed tenants, whether a report is filed in the affected tenant's name
                (as the regulated entity) or by POL263 acting as its appointed agent is confirmed with legal counsel
                and set out in each tenant's services agreement.
              </li>
              <li>The decision and its reasoning are logged against the client/policy record so a later reviewer or auditor can see what happened and why.</li>
            </ol>
          </Clause>

          <Clause num="5" title="Record-keeping">
            <p>
              Every escalation, decision, and outcome should be retained for at least <strong>10 years</strong>,
              matching the retention period set in the companion{" "}
              <a href="/legal/data-retention-policy" className="text-primary underline underline-offset-2">
                Client Data Handling &amp; Retention Policy
              </a>
              . POL263's existing audit log (every data mutation is recorded with a before/after state and a
              staff-facing viewer) already gives a running start here — escalations should be logged the same way,
              not in a side channel that isn't backed up or reviewable.
            </p>
          </Clause>

          <Clause num="6" title="Review">
            <p>
              This policy is reviewed at least annually, and immediately after any escalation that exposes a gap in
              it. Automating any part of §2's indicators is a planned future improvement and does not affect this
              policy's current effect.
            </p>
          </Clause>

          <div className="mt-10 rounded-lg border bg-muted/30 p-5">
            <h2 className="font-display font-semibold mb-3">Sign-off</h2>
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              {["Approved by", "Date", "AML Officer named", "Next review date"].map((k) => (
                <div key={k} className="border-b pb-2">
                  <div className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground">{k}</div>
                  <div className="min-h-5 mt-1 text-muted-foreground">&nbsp;</div>
                </div>
              ))}
            </div>
          </div>

          <footer className="mt-8 pt-4 border-t text-xs text-muted-foreground">
            This policy takes effect upon signature in the block above.
          </footer>
        </CardContent>
      </Card>
    </AppChrome>
  );
}
