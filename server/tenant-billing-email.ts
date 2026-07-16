/**
 * Tenant billing notification emails: reminders, grace-period warnings,
 * suspension, and restoration. Same SMTP/env-var shape as server/payslip-email.ts
 * (graceful no-op if SMTP isn't configured).
 *
 * A leaf module deliberately kept free of any import from tenant-billing-service.ts,
 * so that module can safely import from here without a circular dependency.
 */
import nodemailer from "nodemailer";
import { eq, and } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, tenantInvoices, type TenantInvoice } from "@shared/control-plane-schema";
import { getDbForOrg } from "./tenant-db";
import { users, userRoles, roles } from "@shared/schema";
import { structuredLog } from "./logger";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: parseInt(process.env.SMTP_PORT || "587"),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

/**
 * Every org's de-facto owner/billing-contact is whoever holds the "administrator"
 * role (auto-assigned to adminEmail at tenant creation) — there is no dedicated
 * billingEmail column anywhere, so this is resolved fresh each time from that
 * tenant's own database rather than cached/stored in the control plane.
 */
export async function resolveTenantBillingRecipients(orgId: string): Promise<string[]> {
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

async function send(orgId: string, subject: string, html: string, text: string): Promise<void> {
  const transporter = getTransporter();
  if (!transporter) {
    structuredLog("info", "Tenant billing email skipped — SMTP not configured", { orgId, subject });
    return;
  }
  const recipients = await resolveTenantBillingRecipients(orgId);
  if (recipients.length === 0) {
    structuredLog("warn", "Tenant billing email skipped — no administrator recipient found", { orgId, subject });
    return;
  }
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  try {
    await transporter.sendMail({ from: `"POL263 Billing" <${from}>`, to: recipients.join(","), subject, text, html });
    structuredLog("info", "Tenant billing email sent", { orgId, subject, to: recipients });
  } catch (err: any) {
    structuredLog("error", "Tenant billing email failed", { orgId, subject, error: err?.message });
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
  await send(
    invoice.tenantId,
    `${name}: subscription renewal due ${due}`,
    `<p>Your POL263 subscription renews on <strong>${due}</strong> — amount due: <strong>${invoice.currency} ${invoice.amount}</strong>.</p>
     <p><a href="${link}">Pay now</a> to renew without interruption.</p>`,
    `Your POL263 subscription renews on ${due} — amount due: ${invoice.currency} ${invoice.amount}.\nPay now: ${link}`,
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
     <p><a href="${link}">Pay now</a> to avoid interruption — amount due: <strong>${invoice.currency} ${invoice.amount}</strong>.</p>`,
    `Your POL263 subscription payment is overdue. Access will be suspended on ${deadline} if payment isn't received.\nPay now: ${link}`,
  );
}

export async function sendSuspendedEmail(invoice: TenantInvoice): Promise<void> {
  const name = await tenantName(invoice.tenantId);
  const link = payLink(invoice.paymentToken);
  await send(
    invoice.tenantId,
    `${name}: access suspended — payment required`,
    `<p>Your POL263 access has been suspended because payment wasn't received within the grace period.</p>
     <p><a href="${link}">Pay now</a> to restore access instantly — amount due: <strong>${invoice.currency} ${invoice.amount}</strong>.</p>`,
    `Your POL263 access has been suspended — payment wasn't received within the grace period.\nPay now to restore access instantly: ${link}`,
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

/** Resolves the latest open invoice for a tenant, used by sweep steps that only have a subscription/tenantId in hand. */
export async function getLatestOpenInvoice(tenantId: string): Promise<TenantInvoice | undefined> {
  const [row] = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.tenantId, tenantId), eq(tenantInvoices.status, "open"))).limit(1);
  return row;
}
