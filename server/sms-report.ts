/**
 * Downloadable SMS usage report (CSV + PDF) for a tenant's admins — every text sent, failed or
 * held back, with what it cost against the platform-granted allowance.
 */
import PDFDocument from "pdfkit";
import type { Response } from "express";
import type { SmsMessage } from "@shared/schema";
import type { SmsMessageStats } from "./storage";
import type { SmsAllowance } from "./sms-allocation";
import { EVENT_TYPES } from "./notifications";

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

export function formatInTimezone(d: Date | string, tz: string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

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
const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_ROW_ALT = "#f9fafb";

export function streamSmsReportPdf(res: Response, rows: SmsReportRow[], ctx: SmsReportContext, filename: string): void {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fillColor(C_PRIMARY).font("Helvetica-Bold").fontSize(16).text(ctx.orgName, left, 36, { width });
  doc.fillColor(C_TEXT).fontSize(12).text("SMS usage report", { width });
  doc.fillColor(C_MUTED).font("Helvetica").fontSize(9)
    .text(`Period: ${ctx.periodLabel}   ·   Generated ${formatInTimezone(new Date(), ctx.timezone)} by ${ctx.generatedBy}`, { width });
  doc.moveDown(0.6);

  // Summary tiles
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
  const tileW = width / tiles.length;
  const tileY = doc.y;
  tiles.forEach(([label, value], i) => {
    const x = left + i * tileW;
    doc.rect(x + 2, tileY, tileW - 4, 40).fill("#f0fdfa");
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x + 8, tileY + 6, { width: tileW - 16 });
    doc.fillColor(C_TEXT).font("Helvetica-Bold").fontSize(13).text(value, x + 8, tileY + 18, { width: tileW - 16 });
  });
  doc.y = tileY + 50;
  if (ctx.allowance.metered) {
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(7.5).text(
      "One credit = one SMS part. A text of up to 160 plain characters is one part; longer texts, or texts with emoji or special characters (70 per part), use more.",
      left, doc.y, { width },
    );
    doc.moveDown(0.5);
  }

  // Table
  const cols = [
    { key: "when", label: "Date/time", w: 78 },
    { key: "to", label: "Recipient", w: 82 },
    { key: "client", label: "Client", w: 100 },
    { key: "type", label: "Type", w: 90 },
    { key: "status", label: "Status", w: 72 },
    { key: "parts", label: "Credits", w: 38 },
    { key: "msg", label: "Message / reason", w: 0 },
  ];
  const fixed = cols.reduce((s, c) => s + c.w, 0);
  cols[cols.length - 1].w = width - fixed;

  const drawHeader = () => {
    const y = doc.y;
    doc.rect(left, y, width, 16).fill(C_PRIMARY);
    let x = left;
    doc.fillColor("#ffffff").font("Helvetica-Bold").fontSize(7.5);
    for (const c of cols) {
      doc.text(c.label, x + 3, y + 4.5, { width: c.w - 6, lineBreak: false });
      x += c.w;
    }
    doc.y = y + 16;
  };
  drawHeader();

  if (rows.length === 0) {
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(9).text("No text messages in this period.", left, doc.y + 8, { width });
  }

  doc.font("Helvetica").fontSize(7.5);
  rows.forEach((r, i) => {
    // Plain "Reason:" — the built-in Helvetica has no arrow glyph (renders as garbage).
    const msg = r.status === "sent" ? r.message : `${r.message}\nReason: ${r.failureReason ?? ""}`;
    const cells: Record<string, string> = {
      when: formatInTimezone(r.createdAt, ctx.timezone),
      to: r.recipient,
      client: r.clientName ?? "—",
      type: smsTypeLabel(r),
      status: smsStatusLabel(r.status),
      parts: String(r.creditsCharged),
      msg: msg.length > 400 ? msg.slice(0, 397) + "…" : msg,
    };
    const rowH = Math.max(
      14,
      ...cols.map((c) => doc.heightOfString(cells[c.key], { width: c.w - 6 }) + 6),
    );
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 14) {
      doc.addPage();
      doc.y = doc.page.margins.top;
      drawHeader();
      doc.font("Helvetica").fontSize(7.5);
    }
    const y = doc.y;
    if (i % 2 === 1) doc.rect(left, y, width, rowH).fill(C_ROW_ALT);
    let x = left;
    for (const c of cols) {
      doc.fillColor(c.key === "status" && r.status !== "sent" ? "#b91c1c" : C_TEXT)
        .text(cells[c.key], x + 3, y + 3, { width: c.w - 6 });
      x += c.w;
    }
    doc.y = y + rowH;
  });

  const range = doc.bufferedPageRange();
  for (let p = range.start; p < range.start + range.count; p++) {
    doc.switchToPage(p);
    // Writing below the bottom margin would otherwise make pdfkit start a new (blank) page.
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(7).text(
      `Page ${p - range.start + 1} of ${range.count}`,
      left, doc.page.height - bottom + 8, { width, align: "right", lineBreak: false },
    );
    doc.page.margins.bottom = bottom;
  }
  doc.end();
}
