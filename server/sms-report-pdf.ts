/**
 * Pure SMS usage report PDF renderer — plain data in, PDF bytes out. No DB or server-module
 * imports, so it runs inside the CPU worker pool (server/cpu-pool.ts): a 50,000-message report
 * is several seconds of pdfkit layout that would otherwise block every other request.
 * server/sms-report.ts builds the input (labels, tiles) on the main thread.
 */
import PDFDocument from "pdfkit";

export interface SmsReportPdfRow {
  createdAt: string;
  recipient: string;
  clientName: string | null;
  typeLabel: string;
  status: string;
  statusLabel: string;
  creditsCharged: number;
  message: string;
  failureReason: string | null;
}

export interface SmsReportPdfInput {
  orgName: string;
  timezone: string;
  periodLabel: string;
  generatedBy: string;
  generatedAt: string;
  metered: boolean;
  tiles: [string, string][];
  rows: SmsReportPdfRow[];
}

// Intl.DateTimeFormat construction is expensive; a 50k-row report would build 50k of them.
const formatterCache = new Map<string, Intl.DateTimeFormat>();

export function formatInTimezone(d: Date | string, tz: string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  try {
    let fmt = formatterCache.get(tz);
    if (!fmt) {
      fmt = new Intl.DateTimeFormat("en-GB", {
        timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
      });
      formatterCache.set(tz, fmt);
    }
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
  } catch {
    return date.toISOString().slice(0, 16).replace("T", " ");
  }
}

const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_ROW_ALT = "#f9fafb";

export function renderSmsReportPdf(input: SmsReportPdfInput): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 36, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.fillColor(C_PRIMARY).font("Helvetica-Bold").fontSize(16).text(input.orgName, left, 36, { width });
  doc.fillColor(C_TEXT).fontSize(12).text("SMS usage report", { width });
  doc.fillColor(C_MUTED).font("Helvetica").fontSize(9)
    .text(`Period: ${input.periodLabel}   ·   Generated ${formatInTimezone(input.generatedAt, input.timezone)} by ${input.generatedBy}`, { width });
  doc.moveDown(0.6);

  // Summary tiles
  const tiles = input.tiles;
  const tileW = width / tiles.length;
  const tileY = doc.y;
  tiles.forEach(([label, value], i) => {
    const x = left + i * tileW;
    doc.rect(x + 2, tileY, tileW - 4, 40).fill("#f0fdfa");
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(7.5).text(label.toUpperCase(), x + 8, tileY + 6, { width: tileW - 16 });
    doc.fillColor(C_TEXT).font("Helvetica-Bold").fontSize(13).text(value, x + 8, tileY + 18, { width: tileW - 16 });
  });
  doc.y = tileY + 50;
  if (input.metered) {
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

  if (input.rows.length === 0) {
    doc.fillColor(C_MUTED).font("Helvetica").fontSize(9).text("No text messages in this period.", left, doc.y + 8, { width });
  }

  doc.font("Helvetica").fontSize(7.5);
  input.rows.forEach((r, i) => {
    // Plain "Reason:" — the built-in Helvetica has no arrow glyph (renders as garbage).
    const msg = r.status === "sent" ? r.message : `${r.message}\nReason: ${r.failureReason ?? ""}`;
    const cells: Record<string, string> = {
      when: formatInTimezone(r.createdAt, input.timezone),
      to: r.recipient,
      client: r.clientName ?? "—",
      type: r.typeLabel,
      status: r.statusLabel,
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
  return done;
}
