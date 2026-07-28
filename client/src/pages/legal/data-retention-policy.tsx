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

export default function DataRetentionPolicyPage() {
  return (
    <AppChrome center={false} mainClassName="max-w-3xl mx-auto">
      <Card>
        <CardContent className="p-6 sm:p-10">
          <div className="flex items-center gap-2 flex-wrap mb-4">
            <Badge variant="outline" className="font-mono text-[0.68rem] uppercase tracking-wide">
              Pending Sign-off
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">POL-DATA-01 · v1.1</span>
          </div>

          <h1 className="font-display text-2xl sm:text-3xl font-semibold tracking-tight text-balance mb-2">
            Client Data Handling &amp; Retention Policy
          </h1>
          <p className="text-muted-foreground max-w-[58ch] mb-6">
            What tenants running on POL263 collect about their clients, why, how long it is kept, and how a client
            can request what is held about them.
          </p>

          <Clause num="1" title="Whose data this is">
            <p>
              <strong>POL263 is the engine, not the owner.</strong> Each tenant — a funeral parlour, burial society,
              or insurer — owns its own client relationships and its own products; POL263 does not sell insurance and
              does not own any client relationship itself. POL263 stores and processes that data on each tenant's
              behalf, as the platform their business runs on. In the language data-protection law usually uses: the
              tenant is the <em>controller</em> of its clients' data, and POL263 is the <em>processor</em>. This
              policy is the shared baseline POL263 operates under as processor, and the default every tenant inherits
              as controller unless it adopts something stricter of its own.
            </p>
          </Clause>

          <Clause num="2" title="What's collected, and why">
            <div className="overflow-x-auto not-prose">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2 pr-3">Data</th>
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2">Purpose</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Name, national ID, date of birth", "Identity verification; required to underwrite and pay claims correctly."],
                    ["Phone, address, next of kin", "Contact for policy servicing and claims notification."],
                    ["KYC documents (ID copies, proof of address)", "Identity verification — reviewed through the existing document-verification workflow."],
                    ["Payment records", "Premium collection, receipting, and financial reporting."],
                    ["Policy & dependent details", "Determining cover and processing claims."],
                  ].map(([label, purpose]) => (
                    <tr key={label} className="border-b align-top last:border-b-0">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{label}</td>
                      <td className="py-2">{purpose}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Clause>

          <Clause num="3" title="How long it's kept">
            <p>
              Insurance records generally need to survive well past a policy's end — a claim can be raised, or
              disputed, years later. POL263 applies a conservative <strong>10-year</strong> retention period across
              the board, favouring protection against a late claim or audit over minimizing how long data is held.
            </p>
            <div className="overflow-x-auto not-prose">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-left">
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2 pr-3">Record</th>
                    <th className="font-mono text-[0.68rem] uppercase tracking-wide text-muted-foreground font-semibold border-b py-2">Retention</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Active policy & client record", "For the life of the policy"],
                    ["Lapsed / cancelled policy record", "10 years after termination"],
                    ["Payment & receipt history", "10 years after the transaction"],
                    ["Claim file (approved or declined)", "10 years after closure"],
                    ["KYC documents", "Same as the client record they support"],
                    ["Audit log entries", "Not deleted — retained as the system's own record of who did what"],
                  ].map(([label, retention]) => (
                    <tr key={label} className="border-b align-top last:border-b-0">
                      <td className="py-2 pr-3 font-medium whitespace-nowrap">{label}</td>
                      <td className="py-2 whitespace-nowrap">{retention}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Clause>

          <Clause num="4" title="Requests from clients">
            <p>A client (or someone acting for them, once identity is confirmed) can ask:</p>
            <ul className="list-disc pl-5 space-y-2">
              <li><strong>What's held about them</strong> — staff can pull their client record, policy history, and documents on request.</li>
              <li><strong>To correct something</strong> — handled the same way any other client-detail update already is.</li>
              <li><strong>To delete their data</strong> — only once there's no active policy, no open claim, and the record has passed the retention period in §3. A live policyholder's data can't be deleted out from under an active or recently-closed contract.</li>
            </ul>
            <p>Requests should go to <strong>compliance@pol263.com</strong> and get a response within <strong>14 days</strong>.</p>
          </Clause>

          <Clause num="5" title="Where it's kept">
            <p>
              Client records live in each tenant's own database — shared with other tenants by default, or fully
              dedicated once a tenant's volume or license conditions call for it. Uploaded documents (KYC copies,
              signatures) are stored in DigitalOcean Spaces, served over a CDN rather than sitting in a
              publicly-listable location. POL263 processes this data only to run the platform tenants use — it isn't
              sold or shared with third parties outside of what's needed to service the policy (e.g. an underwriter,
              where one is involved), and POL263 doesn't use one tenant's client data for another tenant's benefit.
            </p>
          </Clause>

          <Clause num="6" title="Review">
            <p>Review this policy annually, and whenever Zimbabwe's data-protection regulatory landscape changes materially.</p>
          </Clause>

          <div className="mt-10 rounded-lg border bg-muted/30 p-5">
            <h2 className="font-display font-semibold mb-3">Sign-off</h2>
            <div className="grid gap-4 sm:grid-cols-2 text-sm">
              {["Approved by", "Date", "Data contact named", "Next review date"].map((k) => (
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
