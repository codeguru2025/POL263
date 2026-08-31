/**
 * Tenant billing notification emails: reminders, grace-period warnings,
 * suspension, and restoration. Same SMTP/env-var shape as server/payslip-email.ts
 * (graceful no-op if SMTP isn't configured).
 *
 * A leaf module deliberately kept free of any import from tenant-billing-service.ts,
 * so that module can safely import from here without a circular dependency.
 */
import { eq, and } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, tenantInvoices, billingPlans, type TenantInvoice } from "@shared/control-plane-schema";
import { getDbForOrg } from "./tenant-db";
import { users, userRoles, roles } from "@shared/schema";
import { structuredLog } from "./logger";
import { sendEmail, isEmailConfigured } from "./email-service";
import { buildTenantBillingPdf } from "./tenant-billing-pdf";

type Attachment = { filename: string; content: Buffer; contentType?: string };

/** Render the POL263-branded PDF for an invoice (or its receipt) — best-effort, never throws. */
async function billingPdfAttachment(invoice: TenantInvoice, variant: "invoice" | "receipt"): Promise<Attachment[]> {
  try {
    const name = await tenantName(invoice.tenantId);
    const [plan] = invoice.planId
      ? await cpDb.select({ name: billingPlans.name }).from(billingPlans).where(eq(billingPlans.id, invoice.planId)).limit(1)
      : [undefined];
    const { buffer, filename } = await buildTenantBillingPdf({ invoice, tenantName: name, planName: plan?.name, variant });
    return [{ filename, content: buffer, contentType: "application/pdf" }];
  } catch (err) {
    structuredLog("error", "billing PDF render failed", { invoiceId: invoice.id, error: (err as Error).message });
    return [];
  }
}

/**
 * Every org's de-facto owner/billing-contact is whoever holds the "administrator"
 * role (auto-assigned to adminEmail at tenant creation) — there is no dedicated
 * If tenants.billing_email is set (platform-owner console), that ONE address is used. Otherwise
 * it falls back to every active administrator-role user, resolved fresh from the tenant's own DB.
 */
export async function resolveTenantBillingRecipients(orgId: string): Promise<string[]> {
  try {
    const [t] = await cpDb.select({ billingEmail: cpTenants.billingEmail }).from(cpTenants).where(eq(cpTenants.id, orgId)).limit(1);
    if (t?.billingEmail && t.billingEmail.trim()) return [t.billingEmail.trim()];
  } catch (err) {
    structuredLog("error", "billing_email lookup failed, falling back to administrators", { orgId, error: (err as Error).message });
  }
  try {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb
      .select({ email: users.email })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(roles.organizationId, orgId), eq(roles.name, "administrator"), eq(users.isActive, true)));
    return Array.from(new Set(rows.map((r) => r.email).filter((e): e is string => !!e)));
  } catch (err) {
    structuredLog("error", "resolveTenantBillingRecipients failed", { orgId, error: (err as Error).message });
    return [];
  }
}

function payLink(token: string): string {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  return `${base}/pay/${token}`;
}

async function send(orgId: string, subject: string, html: string, text: string, attachments?: Attachment[]): Promise<void> {
  if (!isEmailConfigured()) {
    structuredLog("info", "Tenant billing email skipped — SMTP not configured", { orgId, subject });
    return;
  }
  const recipients = await resolveTenantBillingRecipients(orgId);
  if (recipients.length === 0) {
    structuredLog("warn", "Tenant billing email skipped — no administrator recipient found", { orgId, subject });
    return;
  }
  const result = await sendEmail({ to: recipients.join(","), fromName: "POL263 Billing", subject, text, html, attachments });
  if (result.ok) {
    structuredLog("info", "Tenant billing email sent", { orgId, subject, to: recipients });
  } else {
    structuredLog("error", "Tenant billing email failed", { orgId, subject, error: result.message });
  }
}

async function tenantName(orgId: string): Promise<string> {
  const [row] = await cpDb.select({ name: cpTenants.name }).from(cpTenants).where(eq(cpTenants.id, orgId)).limit(1);
  return row?.name || "Your organization";
}

export async function sendInvoiceReminderEmail(invoice: TenantInvoice): Promise<void> {
  const name = await tenantName(invoice.tenantId);
  const link = payLink(invoice.paymentToken);
  const due = new Date(invoice.dueDate).toLocaleDateString();
  const isSetup = invoice.kind === "setup";
  const what = isSetup ? "one-time account setup fee" : "subscription renewal";
  await send(
    invoice.tenantId,
    isSetup ? `${name}: account setup fee — ${invoice.currency} ${invoice.amount}` : `${name}: subscription renewal due ${due}`,
    `<p>Your POL263 ${what} of <strong>${invoice.currency} ${invoice.amount}</strong> is ${isSetup ? "now payable" : `due on <strong>${due}</strong>`}.</p>
     <p><a href="${link}">Pay now</a>${isSetup ? " so we can finish setting up your account." : " to renew without interruption."}</p>
     <p>The invoice is attached as a PDF.</p>`,
    `Your POL263 ${what} of ${invoice.currency} ${invoice.amount} is ${isSetup ? "now payable" : `due on ${due}`}.\nPay now: ${link}`,
    await billingPdfAttachment(invoice, "invoice"),
  );
}

/** Sent after a tenant invoice is paid — the branded PDF receipt. */
export async function sendInvoicePaidReceiptEmail(invoice: TenantInvoice): Promise<void> {
  const name = await tenantName(invoice.tenantId);
  await send(
    invoice.tenantId,
    `${name}: payment received — ${invoice.currency} ${invoice.amount}`,
    `<p>Thank you — we've received your payment of <strong>${invoice.currency} ${invoice.amount}</strong>. Your receipt is attached.</p>`,
    `Thank you — we've received your payment of ${invoice.currency} ${invoice.amount}. Your receipt is attached.`,
    await billingPdfAttachment(invoice, "receipt"),
  );
}

export async function sendGracePeriodEmail(invoice: TenantInvoice, graceDeadline: Date): Promise<void> {
  const name = await tenantName(invoice.tenantId);
  const link = payLink(invoice.paymentToken);
  const deadline = graceDeadline.toLocaleDateString();
  await send(
    invoice.tenantId,
    `${name}: payment overdue — access suspends ${deadline}`,
    `<p>Your POL263 subscription payment is overdue. Access will be automatically suspended on <strong>${deadline}</strong> if payment isn't received.</p>
     <p><a href="${link}">Pay now</a> to avoid interruption — amount due: <strong>${invoice.currency} ${invoice.amount}</strong>. Invoice attached.</p>`,
    `Your POL263 subscription payment is overdue. Access will be suspended on ${deadline} if payment isn't received.\nPay now: ${link}`,
    await billingPdfAttachment(invoice, "invoice"),
  );
}

export async function sendSuspendedEmail(invoice: TenantInvoice): Promise<void> {
  const name = await tenantName(invoice.tenantId);
  const link = payLink(invoice.paymentToken);
  await send(
    invoice.tenantId,
    `${name}: access suspended — payment required`,
    `<p>Your POL263 access has been suspended because payment wasn't received within the grace period.</p>
     <p><a href="${link}">Pay now</a> to restore access instantly — amount due: <strong>${invoice.currency} ${invoice.amount}</strong>. Invoice attached.</p>`,
    `Your POL263 access has been suspended — payment wasn't received within the grace period.\nPay now to restore access instantly: ${link}`,
    await billingPdfAttachment(invoice, "invoice"),
  );
}

export async function sendRestoredEmail(orgId: string): Promise<void> {
  const name = await tenantName(orgId);
  await send(
    orgId,
    `${name}: payment received — access restored`,
    `<p>Thank you — your payment was received and your POL263 access has been restored.</p>`,
    `Thank you — your payment was received and your POL263 access has been restored.`,
  );
}

export async function sendInfrastructureReadyEmail(orgId: string): Promise<void> {
  const name = await tenantName(orgId);
  await send(
    orgId,
    `${name}: dedicated infrastructure provisioned`,
    `<p>Your POL263 account has been moved onto dedicated, isolated infrastructure — no action needed, everything continues to work exactly as before.</p>`,
    `Your POL263 account has been moved onto dedicated, isolated infrastructure — no action needed.`,
  );
}

/** Resolves the latest open invoice for a tenant, used by sweep steps that only have a subscription/tenantId in hand. */
export async function getLatestOpenInvoice(tenantId: string): Promise<TenantInvoice | undefined> {
  const [row] = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.tenantId, tenantId), eq(tenantInvoices.status, "open"))).limit(1);
  return row;
}
