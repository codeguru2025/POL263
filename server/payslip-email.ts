/**
 * Payslip email sender.
 * Requires SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM in environment.
 * Falls back gracefully if SMTP is not configured.
 */

import nodemailer from "nodemailer";
import { buildPayslipPdf } from "./payslip-pdf";
import { storage } from "./storage";
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

export async function sendPayslipEmail(
  runId: string,
  employeeId: string,
  orgId: string
): Promise<{ ok: boolean; message: string; sentTo?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    return { ok: false, message: "SMTP is not configured. Set SMTP_HOST, SMTP_USER, SMTP_PASS, SMTP_PORT and EMAIL_FROM in your environment variables." };
  }

  const result = await buildPayslipPdf(runId, employeeId, orgId);
  if (!result) {
    return { ok: false, message: "Payslip not found — save the payslip first before sending." };
  }

  const { buffer, filename, employee, run } = result;
  const org = await storage.getOrganization(orgId);

  // Resolve recipient email — from linked user account, or stored directly
  let recipientEmail: string | null = null;
  if (employee.userId) {
    const user = await storage.getUser(employee.userId);
    if (user?.email) recipientEmail = user.email;
  }

  if (!recipientEmail) {
    return { ok: false, message: `No email address found for ${employee.firstName} ${employee.lastName}. Link their payroll record to a user account with an email.` };
  }

  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;
  const periodLabel = `${run.periodStart} to ${run.periodEnd}`;

  try {
    await transporter.sendMail({
      from: `"${org?.name || "HR Department"}" <${from}>`,
      to: recipientEmail,
      subject: `Your Payslip for ${periodLabel}`,
      text: `Dear ${employee.firstName},\n\nPlease find attached your payslip for the period ${periodLabel}.\n\nIf you have any queries, please contact the HR department.\n\nThis is a confidential document.\n\n${org?.name || ""}`,
      html: `
        <p>Dear <strong>${employee.firstName}</strong>,</p>
        <p>Please find attached your payslip for the period <strong>${periodLabel}</strong>.</p>
        <p>Employee Number: <strong>${employee.employeeNumber}</strong></p>
        <p>If you have any queries, please contact the HR department.</p>
        <hr/>
        <p style="color:#888;font-size:12px;">This is a confidential document. ${org?.name || ""}</p>
      `,
      attachments: [{ filename, content: buffer, contentType: "application/pdf" }],
    });

    structuredLog("info", "Payslip email sent", { employeeId, runId, to: recipientEmail });
    return { ok: true, message: `Payslip sent to ${recipientEmail}`, sentTo: recipientEmail };
  } catch (err: any) {
    structuredLog("error", "Payslip email failed", { error: err?.message, employeeId, runId });
    return { ok: false, message: `Email failed: ${err?.message}` };
  }
}
