/**
 * Downloadable SMS usage report (CSV + PDF) for a tenant's admins — every text sent, failed or
 * held back, with what it cost against the platform-granted allowance.
 */
import type { Response } from "express";
import type { SmsMessage } from "@shared/schema";
import type { SmsMessageStats } from "./storage";
import type { SmsAllowance } from "./sms-allocation";
import { EVENT_TYPES } from "./notifications";
import { formatInTimezone, type SmsReportPdfInput } from "./sms-report-pdf";
import { runCpuTask } from "./cpu-pool";

export interface SmsReportRow extends SmsMessage {
  clientName: string | null;
}

export interface SmsReportContext {
  orgName: string;
  timezone: string;
  periodLabel: string;
  allowance: SmsAllowance;
  stats: SmsMessageStats;
  generatedBy: string;
}

const SOURCE_LABELS: Record<string, string> = {
  notification: "Client notification",
  test: "Test message",
  mfa: "Staff login code",
  broadcast: "Broadcast",
  other: "Other",
};
const STATUS_LABELS: Record<string, string> = { sent: "Sent", failed: "Failed", blocked: "Not sent (allowance)" };
// Same labels staff see on the Notifications page.
const EVENT_LABELS: Record<string, string> = Object.fromEntries(EVENT_TYPES.map((e) => [e.value, e.label]));

export function smsTypeLabel(row: Pick<SmsMessage, "source" | "eventType">): string {
  if (row.source === "notification" && row.eventType) {
    return EVENT_LABELS[row.eventType] ?? row.eventType.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  }
  return SOURCE_LABELS[row.source] ?? row.source;
}

export function smsStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export { formatInTimezone };

/** Spreadsheet-safe CSV cell: quotes when needed and neutralises formula injection (a cell a
 *  client controls — e.g. a message containing their name — must never run as a formula). */
export function csvCell(value: unknown): string {
  let str = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function buildSmsReportCsv(rows: SmsReportRow[], ctx: SmsReportContext): string {
  const lines: string[] = [];
  lines.push(["SMS usage report", ctx.orgName].map(csvCell).join(","));
  lines.push(["Period", ctx.periodLabel].map(csvCell).join(","));
  if (ctx.allowance.metered) {
    lines.push(["Allowance given (all time)", ctx.allowance.allocated].map(csvCell).join(","));
    lines.push(["Used (all time)", ctx.allowance.used].map(csvCell).join(","));
    lines.push(["Remaining now", ctx.allowance.remaining].map(csvCell).join(","));
  } else {
    lines.push(["Allowance", "Not metered (no allowance set by the platform)"].map(csvCell).join(","));
  }
  lines.push(["Sent in period", ctx.stats.sent].map(csvCell).join(","));
  lines.push(["Failed in period", ctx.stats.failed].map(csvCell).join(","));
  lines.push(["Not sent (allowance) in period", ctx.stats.blocked].map(csvCell).join(","));
  lines.push(["Credits used in period", ctx.stats.creditsCharged].map(csvCell).join(","));
  lines.push("");
  lines.push([
    "Date/time", "Recipient", "Client", "Type", "Status", "SMS parts", "Credits used", "Message", "Reason (if not sent)", "Provider reference",
  ].map(csvCell).join(","));
  for (const r of rows) {
    lines.push([
      formatInTimezone(r.createdAt, ctx.timezone), r.recipient, r.clientName ?? "", smsTypeLabel(r), smsStatusLabel(r.status),
      r.segments, r.creditsCharged, r.message, r.failureReason ?? "", r.providerMessageId ?? "",
    ].map(csvCell).join(","));
  }
  // BOM so Excel opens the UTF-8 (names, "•" masks) correctly; CRLF per RFC 4180.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ── PDF ─────────────────────────────────────────────────────────────────────

/** Plain, structured-clone-friendly input for the pure renderer (server/sms-report-pdf.ts). */
export function buildSmsReportPdfInput(rows: SmsReportRow[], ctx: SmsReportContext): SmsReportPdfInput {
  const tiles: [string, string][] = ctx.allowance.metered
    ? [
        ["Allowance given", ctx.allowance.allocated.toLocaleString("en-US")],
        ["Used (all time)", ctx.allowance.used.toLocaleString("en-US")],
        ["Remaining now", ctx.allowance.remaining.toLocaleString("en-US")],
        ["Sent in period", ctx.stats.sent.toLocaleString("en-US")],
        ["Credits used in period", ctx.stats.creditsCharged.toLocaleString("en-US")],
        ["Failed / not sent", `${ctx.stats.failed} / ${ctx.stats.blocked}`],
      ]
    : [
        ["Allowance", "Not metered"],
        ["Sent in period", ctx.stats.sent.toLocaleString("en-US")],
        ["SMS parts sent", ctx.stats.segmentsSent.toLocaleString("en-US")],
        ["Failed / not sent", `${ctx.stats.failed} / ${ctx.stats.blocked}`],
      ];
  return {
    orgName: ctx.orgName,
    timezone: ctx.timezone,
    periodLabel: ctx.periodLabel,
    generatedBy: ctx.generatedBy,
    generatedAt: new Date().toISOString(),
    metered: ctx.allowance.metered,
    tiles,
    rows: rows.map((r) => ({
      createdAt: new Date(r.createdAt).toISOString(),
      recipient: r.recipient,
      clientName: r.clientName,
      typeLabel: smsTypeLabel(r),
      status: r.status,
      statusLabel: smsStatusLabel(r.status),
      creditsCharged: r.creditsCharged,
      message: r.message,
      failureReason: r.failureReason ?? null,
    })),
  };
}

/** Renders on the CPU worker pool (up to 50,000 rows is seconds of layout work). */
export async function streamSmsReportPdf(res: Response, rows: SmsReportRow[], ctx: SmsReportContext, filename: string): Promise<void> {
  const pdf = await runCpuTask("smsReportPdf", buildSmsReportPdfInput(rows, ctx));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(pdf);
}
