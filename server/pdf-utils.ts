/**
 * Shared PDF utilities — company stamp, verification QR, and common helpers.
 * Used by all document generators so stamp/QR placement is consistent.
 */
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

// ── A4 geometry ─────────────────────────────────────────────────
export const A4_W = 595.28;
export const A4_H = 841.89;
export const MARGIN = 48;
export const COL = A4_W - MARGIN * 2;

// ── Brand colours ────────────────────────────────────────────────
export const C_PRIMARY = "#0f766e";
export const C_TEXT = "#111827";
export const C_MUTED = "#6b7280";
export const C_BORDER = "#e5e7eb";
export const C_LIGHT_BG = "#f9fafb";

const TZ = "Africa/Harare";

export function fmtDateShort(d: Date | string): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

// ── Letterhead header for blank forms ────────────────────────────

/**
 * Draw a branded letterhead header on a blank form.
 * Logo (left) + org name / contact (right) + rule + centred title.
 * Returns the y position after the header.
 */
export async function buildLetterheadHeader(
  doc: InstanceType<typeof PDFDocument>,
  org: { name: string | null; phone?: string | null; email?: string | null; address?: string | null; logoUrl?: string | null },
  title: string,
  subtitle: string,
): Promise<number> {
  const { resolveImage } = await import("./object-storage");
  let y = MARGIN;
  const logoData = await resolveImage(org.logoUrl ?? null);

  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Organisation", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone) parts.push(org.phone);
  if (org.email) parts.push(org.email);
  if (org.address) parts.push(org.address);
  parts.forEach((p) => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 8;

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 10;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 20;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(subtitle, MARGIN, y, { width: COL, align: "center" });
  y += 18;
  return y;
}

// ── Document verification URL ────────────────────────────────────

/** Returns a public verification URL or null if APP_BASE_URL is not configured. */
export function buildVerifyUrl(type: "receipt" | "policy" | "form", id: string, orgId?: string | null): string | null {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!base) return null;
  const url = `${base}/verify?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
  return orgId ? `${url}&org=${encodeURIComponent(orgId)}` : url;
}

/**
 * Returns the org-level walk-in enrollment URL for a receipt QR code.
 * Clients who scan a receipt QR register as walk-in (no agent attribution).
 */
export function buildEnrollUrl(orgId: string): string | null {
  const base = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  if (!base) return null;
  return `${base}/join/register?org=${encodeURIComponent(orgId)}`;
}

/** Generate a B&W QR buffer pointing to a verification URL. B&W gives the best scan rate. */
export async function buildVerifyQrBuffer(url: string, size = 150): Promise<Buffer | null> {
  try {
    return await QRCode.toBuffer(url, {
      type: "png",
      width: size,
      margin: 2,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    });
  } catch {
    return null;
  }
}

// ── Company stamp ────────────────────────────────────────────────

/**
 * Draw a circular company stamp centred at (cx, cy).
 * Radius defaults to 38pt (~27mm diameter).
 */
export function drawCompanyStamp(
  doc: InstanceType<typeof PDFDocument>,
  orgName: string,
  cx: number,
  cy: number,
  radius = 38,
): void {
  doc.save();

  // Outer ring
  doc.circle(cx, cy, radius).lineWidth(2).strokeColor(C_PRIMARY).stroke();
  // Inner ring
  doc.circle(cx, cy, radius - 7).lineWidth(0.75).strokeColor(C_PRIMARY).stroke();

  const innerW = (radius - 9) * 2;
  const innerX = cx - (radius - 9);

  // Org name — split into two lines if long, sized to fit
  const words = orgName.split(" ");
  let line1 = orgName;
  let line2 = "";
  if (orgName.length > 16 && words.length > 1) {
    const mid = Math.ceil(words.length / 2);
    line1 = words.slice(0, mid).join(" ");
    line2 = words.slice(mid).join(" ");
  }
  const nameFontSize = orgName.length <= 10 ? 8 : orgName.length <= 16 ? 7 : 6;
  const nameTop = cy - radius + 10;
  doc.font("Helvetica-Bold").fontSize(nameFontSize).fillColor(C_PRIMARY)
    .text(line1, innerX, nameTop, { width: innerW, align: "center", lineBreak: false });
  if (line2) {
    doc.font("Helvetica-Bold").fontSize(nameFontSize).fillColor(C_PRIMARY)
      .text(line2, innerX, nameTop + nameFontSize + 1.5, { width: innerW, align: "center", lineBreak: false });
  }

  // "AUTHORIZED" in centre
  const authY = line2 ? cy - 4 : cy - 5;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_PRIMARY)
    .text("AUTHORIZED", innerX, authY, { width: innerW, align: "center", lineBreak: false });

  // Date below
  const today = fmtDateShort(new Date());
  doc.font("Helvetica").fontSize(5.5).fillColor(C_PRIMARY)
    .text(today, innerX, authY + 10, { width: innerW, align: "center", lineBreak: false });

  doc.restore();
}

// ── Verification QR panel ────────────────────────────────────────

/**
 * Draw the verification QR + label at (x, y). Returns the y after the panel.
 * Skips silently if qrBuffer is null.
 */
export function drawVerifyQrPanel(
  doc: InstanceType<typeof PDFDocument>,
  qrBuffer: Buffer | null,
  x: number,
  y: number,
  size = 90,
): number {
  if (!qrBuffer) return y;
  try {
    doc.image(qrBuffer, x, y, { width: size, height: size });
    doc.font("Helvetica-Bold").fontSize(6).fillColor(C_PRIMARY)
      .text("SCAN TO VERIFY", x, y + size + 3, { width: size, align: "center", height: 8, lineBreak: false });
    doc.font("Helvetica").fontSize(5).fillColor(C_MUTED)
      .text("Verify document authenticity", x, y + size + 12, { width: size, align: "center", height: 7, lineBreak: false });
  } catch { /* skip */ }
  return y + size + 20;
}

// ── Document footer with stamp + QR ─────────────────────────────

/**
 * Render the standardised footer zone at the bottom of an A4 page.
 *
 * Layout (from footerTop down):
 *   • thin divider
 *   • signature block (left) + company stamp (centre) + QR (right)
 *   • org footer text
 *   • "Generated by…" line
 *
 * @param signatureBuffer  Pre-loaded image buffer for the org signature (may be null).
 * @param qrBuffer         Pre-loaded QR buffer (may be null).
 * @param orgName          Organisation display name.
 * @param footerText       Custom footer tagline (falls back to org name).
 * @param footerTop        Y coordinate where the footer zone begins.
 */
export function drawDocumentFooter(
  doc: InstanceType<typeof PDFDocument>,
  signatureBuffer: Buffer | null,
  qrBuffer: Buffer | null,
  orgName: string,
  footerText: string,
  footerTop: number,
): void {
  // ── divider ──────────────────────────────────────────────────
  doc.moveTo(MARGIN, footerTop).lineTo(A4_W - MARGIN, footerTop)
    .lineWidth(0.5).strokeColor(C_BORDER).stroke();

  const STAMP_SIZE = 76;  // diameter (radius = 38)
  const QR_SIZE   = 90;
  const SIG_W     = 120;
  const SIG_H     = 45;

  const stampCx   = A4_W / 2;              // centre of page
  const stampCy   = footerTop + 18 + STAMP_SIZE / 2;

  const qrX       = A4_W - MARGIN - QR_SIZE;
  const qrY       = footerTop + 10;

  const sigY      = footerTop + 14;

  // ── signature (left) ─────────────────────────────────────────
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text("Authorised Signature", MARGIN, sigY, { width: SIG_W, height: 10, lineBreak: false });
  if (signatureBuffer) {
    try {
      doc.image(signatureBuffer, MARGIN, sigY + 12, { width: SIG_W, height: SIG_H, fit: [SIG_W, SIG_H] });
    } catch { /* skip */ }
  }
  doc.moveTo(MARGIN, sigY + 12 + SIG_H + 2).lineTo(MARGIN + SIG_W, sigY + 12 + SIG_H + 2)
    .lineWidth(0.5).strokeColor(C_BORDER).stroke();

  // ── stamp (centre) ───────────────────────────────────────────
  drawCompanyStamp(doc, orgName, stampCx, stampCy, STAMP_SIZE / 2);

  // ── QR code (right) ──────────────────────────────────────────
  drawVerifyQrPanel(doc, qrBuffer, qrX, qrY, QR_SIZE);

  // ── footer text ──────────────────────────────────────────────
  const textY = footerTop + STAMP_SIZE + 14;  // tightened to keep all text above the margin boundary
  doc.moveTo(MARGIN, textY).lineTo(A4_W - MARGIN, textY)
    .lineWidth(0.3).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_PRIMARY)
    .text(footerText, MARGIN, textY + 5, { width: COL, align: "center", height: 10, lineBreak: false });
  doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
    .text(
      `Generated by ${orgName} · ${fmtDateShort(new Date())} · This document is electronically verified`,
      MARGIN, textY + 16, { width: COL, align: "center", height: 9, lineBreak: false },
    );
}

// ── Proposal-form section helpers ───────────────────────────────

/**
 * Draw a T&C-style coloured section header bar and return the y after it.
 * Matches the styling used for Terms & Conditions section titles.
 */
export function drawSectionHeader(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  y: number,
): number {
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
    .text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16, lineBreak: false });
  doc.fillColor(C_TEXT);
  return y + 22;
}

/**
 * Render an array of [label, value] pairs in a two-column grid (like a
 * traditional proposal/application form).  Each pair occupies one row;
 * pairs are laid out two per row side by side.  Returns the y after the
 * last row.
 *
 * @param fields  Array of [label, value] tuples.
 * @param y       Starting y coordinate.
 * @param rowH    Row height in pt (default 16).
 */
export function drawTwoColFields(
  doc: InstanceType<typeof PDFDocument>,
  fields: [string, string][],
  y: number,
  rowH = 16,
): number {
  const colW = COL / 2 - 4;       // each half minus gap
  const labelW = 90;
  const valueW = colW - labelW - 4;

  for (let i = 0; i < fields.length; i += 2) {
    const left = fields[i];
    const right = fields[i + 1] ?? null;
    const rowY = y;

    // subtle alternating shading
    if ((i / 2) % 2 === 0) {
      doc.rect(MARGIN, rowY, COL, rowH).fillColor("#f8fafb").fill();
      doc.fillColor(C_TEXT);
    }

    // Left cell
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED)
      .text(left[0], MARGIN + 4, rowY + 3, { width: labelW, lineBreak: false });
    doc.font("Helvetica").fontSize(8).fillColor(C_TEXT)
      .text(String(left[1] ?? "—"), MARGIN + labelW + 6, rowY + 3, { width: valueW, lineBreak: false });

    // Right cell
    if (right) {
      const rx = MARGIN + COL / 2 + 4;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED)
        .text(right[0], rx, rowY + 3, { width: labelW, lineBreak: false });
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT)
        .text(String(right[1] ?? "—"), rx + labelW + 6, rowY + 3, { width: valueW, lineBreak: false });
    }

    // bottom border
    doc.moveTo(MARGIN, rowY + rowH).lineTo(MARGIN + COL, rowY + rowH)
      .lineWidth(0.3).strokeColor(C_BORDER).stroke();

    y += rowH;
  }
  return y + 4;
}

// ── Markdown-style T&C renderer ──────────────────────────────────

/**
 * Render a block of term content with basic formatting:
 *   # Heading      → 11pt bold primary
 *   ## Heading     → 10pt bold text
 *   ### Heading    → 9pt bold text
 *   - bullet       → 8pt body with indent
 *   blank line     → paragraph break
 *   everything else → 8pt body
 *
 * Uses PDFKit's text-flow (no explicit y) so it works correctly when
 * content spans multiple pages.
 */
export function renderFormattedTermContent(
  doc: InstanceType<typeof PDFDocument>,
  content: string,
  xLeft: number,
  width: number,
): void {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line) {
      doc.moveDown(0.4);
      continue;
    }
    if (line.startsWith("### ")) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_TEXT)
        .text(line.slice(4), xLeft, doc.y, { width });
    } else if (line.startsWith("## ")) {
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(C_PRIMARY)
        .text(line.slice(3), xLeft, doc.y, { width });
      doc.moveDown(0.2);
    } else if (line.startsWith("# ")) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
        .text(line.slice(2), xLeft, doc.y, { width });
      doc.moveDown(0.3);
    } else if (/^[-*] /.test(line)) {
      const bullet = line.slice(2);
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT)
        .text(`• ${bullet}`, xLeft + 8, doc.y, { width: width - 8 });
    } else {
      doc.font("Helvetica").fontSize(8).fillColor(C_TEXT)
        .text(line, xLeft, doc.y, { width, lineGap: 2 });
    }
  }
}
