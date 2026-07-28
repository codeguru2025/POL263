import { storage } from "./storage";
import { structuredLog } from "./logger";
import { pushToClient } from "./push";
import { sendEmail } from "./email-service";
import { hasModule } from "./module-gate";

/** Best-effort PDF attachment for the events that have a document worth attaching. Never throws. */
async function resolveEmailAttachment(
  orgId: string,
  eventType: string,
  ctx: NotificationContext,
): Promise<{ filename: string; content: Buffer; contentType: string }[] | undefined> {
  try {
    if (eventType === "payment_receipt" && ctx.receiptId) {
      const { buildReceiptPdfBuffer } = await import("./receipt-pdf");
      const result = await buildReceiptPdfBuffer(ctx.receiptId);
      if (result) return [{ filename: result.filename, content: result.buffer, contentType: "application/pdf" }];
    } else if ((eventType === "policy_activated" || eventType === "policy_capture") && ctx.policyId) {
      const { buildPolicyDocumentPdfBuffer } = await import("./policy-document");
      const result = await buildPolicyDocumentPdfBuffer(ctx.policyId, orgId);
      if (result) return [{ filename: result.filename, content: result.buffer, contentType: "application/pdf" }];
    }
  } catch (err) {
    structuredLog("error", "Failed to build notification email attachment", { error: (err as Error).message, eventType });
  }
  return undefined;
}

/** All supported merge tags with descriptions for the admin UI */
export const MERGE_TAGS: { tag: string; description: string; example: string }[] = [
  { tag: "{client_name}", description: "Client full name", example: "John Doe" },
  { tag: "{first_name}", description: "Client first name", example: "John" },
  { tag: "{last_name}", description: "Client last name", example: "Doe" },
  { tag: "{policy_number}", description: "Policy number", example: "FLK00011" },
  { tag: "{product_name}", description: "Product name", example: "Family Cover Plan" },
  { tag: "{premium_amount}", description: "Premium amount with currency", example: "USD 25.00" },
  { tag: "{currency}", description: "Policy currency code", example: "USD" },
  { tag: "{payment_schedule}", description: "Payment frequency", example: "Monthly" },
  { tag: "{effective_date}", description: "Policy effective date", example: "2025-01-15" },
  { tag: "{inception_date}", description: "Policy inception date", example: "2025-01-15" },
  { tag: "{status}", description: "Current policy status", example: "Active" },
  { tag: "{grace_end}", description: "Grace period end date", example: "2025-06-30" },
  { tag: "{waiting_end}", description: "Waiting period end date", example: "2025-04-15" },
  { tag: "{payment_amount}", description: "Payment amount received", example: "USD 25.00" },
  { tag: "{payment_date}", description: "Date payment was received", example: "2025-03-05" },
  { tag: "{payment_method}", description: "Payment method used", example: "EcoCash" },
  { tag: "{org_name}", description: "Organisation name", example: "Falakhe Funeral" },
  { tag: "{member_name}", description: "Policy member name (for member events)", example: "Jane Doe" },
  { tag: "{birthday_name}", description: "Birthday person name", example: "Jane Doe" },
  { tag: "{birthday_date}", description: "Birthday date", example: "March 6" },
  { tag: "{anniversary_years}", description: "Policy anniversary years", example: "2" },
  { tag: "{balance}", description: "Policy account balance", example: "USD 50.00" },
  { tag: "{outstanding}", description: "Outstanding premium amount", example: "USD 25.00" },
  { tag: "{cycle_end}", description: "Current billing cycle end date", example: "2025-03-31" },
  { tag: "{claim_number}", description: "Claim reference number", example: "CLM-000123" },
  { tag: "{activation_code}", description: "Client portal activation code", example: "ACT-4F8B2C1A" },
  { tag: "{document_label}", description: "Uploaded document name/type", example: "National ID" },
];

export const EVENT_TYPES = [
  { value: "policy_capture", label: "Policy Created" },
  { value: "policy_activated", label: "Policy Activated" },
  { value: "payment_received", label: "Payment Received" },
  { value: "payment_receipt", label: "Payment Receipted" },
  { value: "premium_due", label: "Premium Due" },
  { value: "grace_start", label: "Grace Period Started" },
  { value: "pre_lapse_warning", label: "Pre-Lapse Warning" },
  { value: "policy_lapsed", label: "Policy Lapsed" },
  { value: "policy_cancelled", label: "Policy Cancelled" },
  { value: "reinstatement", label: "Policy Reinstated" },
  { value: "status_change", label: "Policy Status Changed" },
  { value: "member_added", label: "Member Added to Policy" },
  { value: "member_removed", label: "Member Removed from Policy" },
  { value: "birthday", label: "Member Birthday" },
  { value: "anniversary", label: "Policy Anniversary" },
  { value: "policy_update", label: "Policy Updated" },
  { value: "general_notice", label: "General Notice (Broadcast)" },
  { value: "activation", label: "Client Activation" },
  { value: "claim_status_change", label: "Claim Status Changed" },
  { value: "kyc_status_change", label: "KYC Document Reviewed" },
];

const DEFAULT_MESSAGES: Record<string, { subject: string; body: string }> = {
  policy_capture: {
    subject: "Welcome! Your Policy Has Been Created",
    body: "Dear {client_name}, your policy {policy_number} for {product_name} has been created. Premium: {premium_amount} ({payment_schedule}). Welcome to {org_name}!",
  },
  policy_activated: {
    subject: "Policy Activated",
    body: "Dear {client_name}, your policy {policy_number} is now active. Effective date: {effective_date}.",
  },
  payment_received: {
    subject: "Payment Received",
    body: "Dear {client_name}, we received your payment of {payment_amount} for policy {policy_number} via {payment_method} on {payment_date}. Thank you!",
  },
  payment_receipt: {
    subject: "Payment Receipted",
    body: "Dear {client_name}, your payment of {payment_amount} for policy {policy_number} has been receipted. Thank you for staying current.",
  },
  premium_due: {
    subject: "Premium Due Reminder",
    body: "Dear {client_name}, your premium of {premium_amount} for policy {policy_number} is due. Please make payment to stay covered.",
  },
  grace_start: {
    subject: "Grace Period Notice",
    body: "Dear {client_name}, your policy {policy_number} has entered the grace period. Please pay before {grace_end} to avoid lapsing.",
  },
  pre_lapse_warning: {
    subject: "Urgent: Policy At Risk of Lapsing",
    body: "Dear {client_name}, your policy {policy_number} will lapse soon. Grace period ends {grace_end}. Please make payment immediately.",
  },
  policy_lapsed: {
    subject: "Policy Lapsed",
    body: "Dear {client_name}, your policy {policy_number} has lapsed due to non-payment. Contact us to discuss reinstatement.",
  },
  policy_cancelled: {
    subject: "Policy Cancelled",
    body: "Dear {client_name}, your policy {policy_number} has been cancelled. Contact us if you have any questions.",
  },
  reinstatement: {
    subject: "Policy Reinstated",
    body: "Dear {client_name}, your policy {policy_number} has been reinstated and is now active again. Thank you for returning!",
  },
  status_change: {
    subject: "Policy Status Updated",
    body: "Dear {client_name}, your policy {policy_number} status has been changed to {status}.",
  },
  member_added: {
    subject: "Member Added to Your Policy",
    body: "Dear {client_name}, {member_name} has been added to your policy {policy_number}.",
  },
  member_removed: {
    subject: "Member Removed from Your Policy",
    body: "Dear {client_name}, {member_name} has been removed from your policy {policy_number}.",
  },
  birthday: {
    subject: "Happy Birthday!",
    body: "Dear {birthday_name}, wishing you a wonderful birthday from {org_name}! We value you as part of our family.",
  },
  anniversary: {
    subject: "Policy Anniversary",
    body: "Dear {client_name}, congratulations on {anniversary_years} year(s) with {org_name}! Your policy {policy_number} anniversary is today.",
  },
  policy_update: {
    subject: "Policy Updated",
    body: "Dear {client_name}, your policy {policy_number} has been updated. Please review the changes in your portal.",
  },
  general_notice: {
    subject: "Notice from {org_name}",
    body: "{client_name}, you have a new notice from {org_name}. Please check your portal for details.",
  },
  activation: {
    subject: "Welcome to {org_name}!",
    body: "Dear {client_name}, welcome to {org_name}. Your client portal activation code is {activation_code}. Use it to claim your account and view your policies, make payments, and more.",
  },
  claim_status_change: {
    subject: "Claim {claim_number} — Status Update",
    body: "Dear {client_name}, your claim {claim_number} status has been changed to {status}.",
  },
  kyc_status_change: {
    subject: "Document Review Update",
    body: "Dear {client_name}, your submitted {document_label} has been {status}. Please contact us if you have any questions.",
  },
};

export interface NotificationContext {
  clientId?: string;
  clientName?: string;
  firstName?: string;
  lastName?: string;
  policyId?: string;
  policyNumber?: string;
  productName?: string;
  premiumAmount?: string;
  currency?: string;
  paymentSchedule?: string;
  effectiveDate?: string;
  inceptionDate?: string;
  status?: string;
  graceEnd?: string;
  waitingEnd?: string;
  paymentAmount?: string;
  paymentDate?: string;
  paymentMethod?: string;
  orgName?: string;
  memberName?: string;
  birthdayName?: string;
  birthdayDate?: string;
  anniversaryYears?: string;
  balance?: string;
  outstanding?: string;
  cycleEnd?: string;
  claimNumber?: string;
  activationCode?: string;
  receiptId?: string;
  documentLabel?: string;
}

function renderTemplate(template: string, ctx: NotificationContext): string {
  let result = template;
  const replacements: Record<string, string | undefined> = {
    "{client_name}": ctx.clientName,
    "{first_name}": ctx.firstName,
    "{last_name}": ctx.lastName,
    "{policy_number}": ctx.policyNumber,
    "{product_name}": ctx.productName,
    "{premium_amount}": ctx.premiumAmount,
    "{currency}": ctx.currency,
    "{payment_schedule}": ctx.paymentSchedule,
    "{effective_date}": ctx.effectiveDate,
    "{inception_date}": ctx.inceptionDate,
    "{status}": ctx.status,
    "{grace_end}": ctx.graceEnd,
    "{waiting_end}": ctx.waitingEnd,
    "{payment_amount}": ctx.paymentAmount,
    "{payment_date}": ctx.paymentDate,
    "{payment_method}": ctx.paymentMethod,
    "{org_name}": ctx.orgName,
    "{member_name}": ctx.memberName,
    "{birthday_name}": ctx.birthdayName,
    "{birthday_date}": ctx.birthdayDate,
    "{anniversary_years}": ctx.anniversaryYears,
    "{balance}": ctx.balance,
    "{outstanding}": ctx.outstanding,
    "{cycle_end}": ctx.cycleEnd,
    "{claim_number}": ctx.claimNumber,
    "{activation_code}": ctx.activationCode,
    "{document_label}": ctx.documentLabel,
    // Legacy compat
    "{name}": ctx.clientName,
  };
  for (const [tag, value] of Object.entries(replacements)) {
    if (value !== undefined) {
      result = result.split(tag).join(value);
    }
  }
  return result;
}

/** Low-level: write a notification log directly */
export async function notifyClient(orgId: string, clientId: string, subject: string, body: string, channel = "in_app", policyId?: string) {
  try {
    await storage.createNotificationLog(orgId, {
      recipientType: "client",
      recipientId: clientId,
      channel,
      subject,
      body,
      policyId: policyId ?? null,
      status: "sent",
    });
  } catch (err) {
    structuredLog("error", "Failed to create notification log", { error: (err as Error).message, orgId, clientId });
  }
}

/** Dispatch a real Expo push notification to all of a client's registered devices. */
export async function notifyClientPush(orgId: string, clientId: string, subject: string, body: string, policyId?: string) {
  try {
    await pushToClient(orgId, clientId, { title: subject, body, data: { policyId } });
    await storage.createNotificationLog(orgId, {
      recipientType: "client",
      recipientId: clientId,
      channel: "push",
      subject,
      body,
      policyId: policyId ?? null,
      status: "sent",
    });
  } catch (err) {
    structuredLog("error", "Failed to dispatch client push", { error: (err as Error).message, orgId, clientId });
  }
}

/**
 * Dispatch a notification for a specific event.
 * Uses admin-configured templates if available, otherwise falls back to defaults.
 */
export async function dispatchNotification(
  orgId: string,
  eventType: string,
  clientId: string,
  ctx: NotificationContext,
): Promise<void> {
  try {
    const org = await storage.getOrganization(orgId);
    ctx.orgName = ctx.orgName || org?.name || "POL263";
    const emailAllowed = await hasModule(orgId, "email_notifications");

    const templates = await storage.getActiveTemplatesByEvent(orgId, eventType);

    if (templates.length > 0) {
      let clientEmail: string | null | undefined;
      for (const tmpl of templates) {
        const renderedSubject = renderTemplate(tmpl.subject || "", ctx);
        const renderedBody = renderTemplate(tmpl.bodyTemplate, ctx);
        await storage.createNotificationLog(orgId, {
          recipientType: "client",
          recipientId: clientId,
          channel: tmpl.channel,
          subject: renderedSubject,
          body: renderedBody,
          templateId: tmpl.id,
          policyId: ctx.policyId ?? null,
          status: "sent",
        });

        try {
          if (tmpl.channel === "email" && !emailAllowed) {
            structuredLog("info", "Notification email skipped — email_notifications module not enabled for this tenant", { orgId, clientId, eventType });
          } else if (tmpl.channel === "email") {
            if (clientEmail === undefined) {
              const client = await storage.getClient(clientId, orgId);
              clientEmail = client?.email ?? null;
            }
            if (clientEmail) {
              const attachments = await resolveEmailAttachment(orgId, eventType, ctx);
              await sendEmail({
                to: clientEmail,
                fromName: ctx.orgName,
                subject: renderedSubject,
                text: renderedBody,
                html: `<p>${renderedBody.replace(/\n/g, "<br/>")}</p>`,
                attachments,
              });
            } else {
              structuredLog("warn", "Notification email skipped — client has no email on file", { orgId, clientId, eventType });
            }
          } else if (tmpl.channel === "push") {
            await pushToClient(orgId, clientId, { title: renderedSubject, body: renderedBody, data: { policyId: ctx.policyId } });
          }
        } catch (err) {
          structuredLog("error", "Failed to deliver notification via channel", {
            error: (err as Error).message, orgId, clientId, eventType, channel: tmpl.channel,
          });
        }
      }
    } else {
      const defaults = DEFAULT_MESSAGES[eventType];
      if (defaults) {
        const renderedSubject = renderTemplate(defaults.subject, ctx);
        const renderedBody = renderTemplate(defaults.body, ctx);
        await notifyClient(orgId, clientId, renderedSubject, renderedBody, "in_app", ctx.policyId);

        // "activation" and "claim_status_change" are new event types with no pre-existing
        // per-org template to opt into yet, so also email by default where we have an
        // address — unlike the older event types, there's no established "in-app only
        // until an admin configures a channel" behavior here to preserve.
        if (emailAllowed && (eventType === "activation" || eventType === "claim_status_change" || eventType === "kyc_status_change")) {
          try {
            const client = await storage.getClient(clientId, orgId);
            if (client?.email) {
              await sendEmail({
                to: client.email,
                fromName: ctx.orgName,
                subject: renderedSubject,
                text: renderedBody,
                html: `<p>${renderedBody.replace(/\n/g, "<br/>")}</p>`,
              });
            }
          } catch (err) {
            structuredLog("error", "Failed to send default-channel notification email", {
              error: (err as Error).message, orgId, clientId, eventType,
            });
          }
        }
      }
    }
  } catch (err) {
    structuredLog("error", "Failed to dispatch notification", {
      error: (err as Error).message, orgId, clientId, eventType,
    });
  }
}

/** Build context from a policy object and optional client */
export async function buildPolicyContext(
  policy: any,
  orgId: string,
  extra?: Partial<NotificationContext>,
): Promise<NotificationContext> {
  const client = policy.clientId ? await storage.getClient(policy.clientId, orgId) : null;
  let productName = "";
  if (policy.productVersionId) {
    const pv = await storage.getProductVersion(policy.productVersionId, orgId);
    if (pv) {
      const prod = await storage.getProduct(pv.productId, orgId);
      if (prod) productName = prod.name;
    }
  }
  return {
    clientId: policy.clientId,
    clientName: client ? `${client.firstName} ${client.lastName}` : undefined,
    firstName: client?.firstName,
    lastName: client?.lastName,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    productName,
    premiumAmount: `${policy.currency} ${parseFloat(policy.premiumAmount || "0").toFixed(2)}`,
    currency: policy.currency,
    paymentSchedule: policy.paymentSchedule || "monthly",
    effectiveDate: policy.effectiveDate || undefined,
    inceptionDate: policy.inceptionDate || undefined,
    status: policy.status,
    graceEnd: policy.graceEndDate || undefined,
    waitingEnd: policy.waitingPeriodEndDate || undefined,
    cycleEnd: policy.currentCycleEnd || undefined,
    ...extra,
  };
}

/** Broadcast a notification to all clients of an org */
export async function broadcastNotification(
  orgId: string,
  subject: string,
  bodyTemplate: string,
): Promise<number> {
  const allClients = await storage.getClientsByOrg(orgId, 100000, 0);
  const org = await storage.getOrganization(orgId);
  let sent = 0;
  for (const c of allClients) {
    const ctx: NotificationContext = {
      clientName: `${c.firstName} ${c.lastName}`,
      firstName: c.firstName,
      lastName: c.lastName,
      orgName: org?.name || "POL263",
    };
    const renderedSubject = renderTemplate(subject, ctx);
    const renderedBody = renderTemplate(bodyTemplate, ctx);
    await notifyClient(orgId, c.id, renderedSubject, renderedBody);
    sent++;
  }
  return sent;
}
