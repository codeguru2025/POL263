/**
 * Payslip email sender.
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in environment.
 * Falls back gracefully if SMTP is not configured.
 */

import { buildPayslipPdf } from "./payslip-pdf";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { sendEmail, isEmailConfigured, escapeHtml } from "./email-service";
import type { Organization } from "@shared/schema";

export async function sendPayslipEmail(
  runId: string,
  employeeId: string,
  orgId: string,
  // Callers sending to a whole run's worth of employees (POST .../send-all) already have this —
  // passing it in avoids re-fetching the same org row once per employee.
  preloadedOrg?: Organization,
): Promise<{ ok: boolean; message: string; sentTo?: string }> {
  if (!isEmailConfigured()) {
    return { ok: false, message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT and EMAIL_FROM in your environment variables." };
  }

  const result = await buildPayslipPdf(runId, employeeId, orgId);
  if (!result) {
    return { ok: false, message: "Payslip not found — save the payslip first before sending." };
  }

  const { buffer, filename, employee, run } = result;
  const org = preloadedOrg ?? await storage.getOrganization(orgId);

  // Resolve recipient email — from linked user account, or stored directly
  let recipientEmail: string | null = null;
  if (employee.userId) {
    const user = await storage.getUser(employee.userId);
    if (user?.email) recipientEmail = user.email;
  }

  if (!recipientEmail) {
    return { ok: false, message: `No email address found for ${employee.firstName} ${employee.lastName}. Link their payroll record to a user account with an email.` };
  }

  const periodLabel = `${run.periodStart} to ${run.periodEnd}`;

  const sendResult = await sendEmail({
    to: recipientEmail,
    fromName: org?.name || "HR Department",
    subject: `Your Payslip for ${periodLabel}`,
    text: `Dear ${employee.firstName},\n\nPlease find attached your payslip for the period ${periodLabel}.\n\nIf you have any queries, please contact the HR department.\n\nThis is a confidential document.\n\n${org?.name || ""}`,
    html: `
      <p>Dear <strong>${escapeHtml(employee.firstName)}</strong>,</p>
      <p>Please find attached your payslip for the period <strong>${escapeHtml(periodLabel)}</strong>.</p>
      <p>Employee Number: <strong>${escapeHtml(employee.employeeNumber)}</strong></p>
      <p>If you have any queries, please contact the HR department.</p>
      <hr/>
      <p style="color:#888;font-size:12px;">This is a confidential document. ${escapeHtml(org?.name || "")}</p>
    `,
    attachments: [{ filename, content: buffer, contentType: "application/pdf" }],
  });

  if (!sendResult.ok) return sendResult;
  structuredLog("info", "Payslip email sent", { employeeId, runId, to: recipientEmail });
  return { ok: true, message: `Payslip sent to ${recipientEmail}`, sentTo: recipientEmail };
}
