/**
 * Member Card - a single printable membership/ID card for a policyholder, rendered on an
 * A4 page (print & cut). Layout, colors and field visibility come from `member_card_settings`
 * (Member Card Admin); anything not yet configured falls back to sensible defaults
 * (see `storage.getMemberCardSettings`). The organization's `primaryColor` drives the navy
 * panel; gold is a fixed trim color (not org-configurable - a deliberate "premium card" accent).
 */
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildVerifyUrl, buildVerifyQrBuffer } from "./pdf-utils";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

const C_GOLD = "#c9a962";
const C_CREAM = "#fbf9f4";
const C_TEXT = "#1f2937";
const C_MUTED = "#6b7280";
const C_BORDER = "#d1d5db";

const TZ = "Africa/Harare";
function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

// Card geometry - CR80-ish landscape proportions scaled up for a legible printed card.
const CARD_W = 480;
const CARD_H = 300;
const FOOTER_H = 44;

/** Boundary points (fractions of content width/height) for the diagonal navy panel, confined
 *  to the top-right corner so it never crosses under the org name/tagline or the field rows. */
const SWOOSH: [number, number][] = [
  [0.7, 0],
  [0.58, 0.2],
  [0.62, 0.38],
  [1, 0.38],
];

function darken(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, Math.round(((n >> 16) & 255) * (1 - amt)));
  const g = Math.max(0, Math.round(((n >> 8) & 255) * (1 - amt)));
  const b = Math.max(0, Math.round((n & 255) * (1 - amt)));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// ── Small vector icon glyphs, drawn inside a circular navy badge ──────────────
type IconFn = (doc: InstanceType<typeof PDFDocument>, cx: number, cy: number, r: number) => void;

const icons: Record<string, IconFn> = {
  user: (doc, cx, cy, r) => {
    doc.circle(cx, cy - r * 0.28, r * 0.32).fill("#ffffff");
    doc.moveTo(cx - r * 0.5, cy + r * 0.42)
      .bezierCurveTo(cx - r * 0.5, cy - r * 0.05, cx + r * 0.5, cy - r * 0.05, cx + r * 0.5, cy + r * 0.42)
      .fill("#ffffff");
  },
  idCard: (doc, cx, cy, r) => {
    const w = r * 1.15, h = r * 0.82;
    doc.roundedRect(cx - w / 2, cy - h / 2, w, h, 1.5).lineWidth(1.1).stroke("#ffffff");
    doc.circle(cx - w * 0.28, cy - h * 0.08, h * 0.2).fill("#ffffff");
    doc.rect(cx + w * 0.02, cy - h * 0.22, w * 0.38, 1.3).fill("#ffffff");
    doc.rect(cx + w * 0.02, cy - h * 0.02, w * 0.3, 1.3).fill("#ffffff");
  },
  calendar: (doc, cx, cy, r) => {
    const w = r * 1.1, h = r * 0.95;
    doc.roundedRect(cx - w / 2, cy - h / 2, w, h, 1.2).lineWidth(1.1).stroke("#ffffff");
    doc.moveTo(cx - w / 2, cy - h * 0.12).lineTo(cx + w / 2, cy - h * 0.12).lineWidth(1.1).stroke("#ffffff");
    doc.rect(cx - w * 0.22, cy + h * 0.02, w * 0.18, w * 0.18).fill("#ffffff");
  },
  users: (doc, cx, cy, r) => {
    doc.circle(cx - r * 0.28, cy - r * 0.18, r * 0.26).fill("#ffffff");
    doc.circle(cx + r * 0.28, cy - r * 0.18, r * 0.26).fill("#ffffff");
    doc.moveTo(cx - r * 0.62, cy + r * 0.42)
      .bezierCurveTo(cx - r * 0.62, cy, cx + r * 0.05, cy, cx + r * 0.05, cy + r * 0.42).fill("#ffffff");
    doc.moveTo(cx - r * 0.05, cy + r * 0.42)
      .bezierCurveTo(cx - r * 0.05, cy, cx + r * 0.62, cy, cx + r * 0.62, cy + r * 0.42).fill("#ffffff");
  },
  hash: (doc, cx, cy, r) => {
    doc.lineWidth(1.4).strokeColor("#ffffff");
    doc.moveTo(cx - r * 0.15, cy - r * 0.45).lineTo(cx - r * 0.32, cy + r * 0.45).stroke();
    doc.moveTo(cx + r * 0.32, cy - r * 0.45).lineTo(cx + r * 0.15, cy + r * 0.45).stroke();
    doc.moveTo(cx - r * 0.5, cy - r * 0.12).lineTo(cx + r * 0.5, cy - r * 0.12).stroke();
    doc.moveTo(cx - r * 0.5, cy + r * 0.2).lineTo(cx + r * 0.5, cy + r * 0.2).stroke();
  },
};

function drawIconBadge(doc: InstanceType<typeof PDFDocument>, name: keyof typeof icons, cx: number, cy: number, r: number, navy: string) {
  doc.circle(cx, cy, r).fill(navy);
  icons[name](doc, cx, cy, r);
}

function drawShieldCheck(doc: InstanceType<typeof PDFDocument>, x: number, y: number, size: number, color: string) {
  const w = size, h = size * 1.15;
  doc.moveTo(x + w / 2, y)
    .lineTo(x + w, y + h * 0.2)
    .lineTo(x + w, y + h * 0.55)
    .bezierCurveTo(x + w, y + h * 0.9, x + w * 0.7, y + h, x + w / 2, y + h)
    .bezierCurveTo(x + w * 0.3, y + h, x, y + h * 0.9, x, y + h * 0.55)
    .lineTo(x, y + h * 0.2)
    .closePath()
    .fill(color);
  doc.lineWidth(1.6).strokeColor(C_CREAM)
    .moveTo(x + w * 0.28, y + h * 0.5)
    .lineTo(x + w * 0.45, y + h * 0.68)
    .lineTo(x + w * 0.75, y + h * 0.32)
    .stroke();
}

function drawPhone(doc: InstanceType<typeof PDFDocument>, cx: number, cy: number, size: number, color: string) {
  doc.save();
  doc.rotate(-20, { origin: [cx, cy] });
  doc.roundedRect(cx - size * 0.28, cy - size * 0.5, size * 0.56, size, size * 0.28).fill(color);
  doc.restore();
}

function drawGlobe(doc: InstanceType<typeof PDFDocument>, cx: number, cy: number, r: number, color: string) {
  doc.lineWidth(1.3).strokeColor(color);
  doc.circle(cx, cy, r).stroke();
  doc.ellipse(cx, cy, r * 0.42, r).stroke();
  doc.moveTo(cx - r, cy).lineTo(cx + r, cy).stroke();
}

export async function streamMemberCardToResponse(
  policyId: string,
  orgId: string,
  res: import("express").Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const [policy, settings] = await Promise.all([
    storage.getPolicy(policyId, orgId),
    storage.getMemberCardSettings(orgId),
  ]);
  if (!policy || policy.organizationId !== orgId) {
    res.status(404).json({ message: "Policy not found" });
    return;
  }
  const [client, org, productVersion] = await Promise.all([
    storage.getClient(policy.clientId, orgId),
    storage.getOrganization(orgId),
    storage.getProductVersion(policy.productVersionId, orgId),
  ]);
  if (!client || !org) {
    res.status(404).json({ message: "Card data incomplete" });
    return;
  }
  const product = productVersion ? await storage.getProduct(productVersion.productId, orgId) : undefined;

  const filename = `Member-Card-${policy.policyNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", opts?.attachment
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`);

  const navy = org.primaryColor || "#0f2a4d";
  const navyDark = darken(navy, 0.18);
  const logoData = settings.showLogo ? await resolveImage(org.logoUrl) : null;
  let qrBuffer: Buffer | null = null;
  if (settings.showQrCode) {
    const verifyUrl = buildVerifyUrl("policy", policy.id, orgId);
    if (verifyUrl) qrBuffer = await buildVerifyQrBuffer(verifyUrl, 200);
  }

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  try {
    const cardX = MARGIN + (COL - CARD_W) / 2;
    const cardY = MARGIN + 20;
    const contentH = CARD_H - FOOTER_H;

    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text("Print, cut along the border, and laminate for a durable membership card.", MARGIN, MARGIN, { width: COL, align: "center" });

    doc.save();
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 14).clip();

    // Base background
    doc.rect(cardX, cardY, CARD_W, CARD_H).fill(C_CREAM);

    // Diagonal navy swoosh (top-right), with a gold trim stroked along its boundary.
    const pt = (p: [number, number]): [number, number] => [cardX + p[0] * CARD_W, cardY + p[1] * contentH];
    const boundary = SWOOSH.map(pt);
    doc.moveTo(boundary[0][0], cardY).lineTo(...boundary[0]);
    for (let i = 1; i < boundary.length; i++) doc.lineTo(...boundary[i]);
    doc.lineWidth(6).strokeColor(C_GOLD).stroke();

    doc.moveTo(boundary[0][0], cardY);
    for (const p of boundary) doc.lineTo(...p);
    doc.lineTo(cardX + CARD_W, cardY).closePath().fill(navy);

    // Logo circle, top-left
    const logoR = 34;
    const logoCx = cardX + 20 + logoR;
    const logoCy = cardY + 18 + logoR;
    doc.circle(logoCx, logoCy, logoR).lineWidth(2).strokeColor(navy).fillAndStroke(C_CREAM, navy);
    if (logoData) {
      try {
        doc.save();
        doc.circle(logoCx, logoCy, logoR - 3).clip();
        doc.image(logoData, logoCx - logoR + 3, logoCy - logoR + 3, { fit: [(logoR - 3) * 2, (logoR - 3) * 2], align: "center", valign: "center" });
        doc.restore();
      } catch { /* skip */ }
    }

    // Org name block
    const nameX = logoCx + logoR + 16;
    const nameW = boundary[1][0] - nameX - 8;
    const orgName = (org.name || "Membership").trim();
    const spaceIdx = orgName.indexOf(" ");
    const firstWord = spaceIdx === -1 ? orgName : orgName.slice(0, spaceIdx);
    const restWords = spaceIdx === -1 ? "" : orgName.slice(spaceIdx + 1);

    let ny = cardY + 16;
    doc.font("Helvetica-Bold").fontSize(24).fillColor(navy)
      .text(firstWord.toUpperCase(), nameX, ny, { width: nameW, lineBreak: false });
    ny += 26;
    if (restWords) {
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#2f6fb0")
        .text(restWords.toUpperCase(), nameX, ny, { width: nameW, lineBreak: false });
      ny += 16;
    }
    doc.moveTo(nameX, ny + 2).lineTo(nameX + Math.min(nameW, 150), ny + 2).lineWidth(1.2).strokeColor(C_GOLD).stroke();
    ny += 8;
    if (settings.tagline) {
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C_GOLD)
        .text(settings.tagline.toUpperCase(), nameX, ny, { width: nameW, characterSpacing: 0.4, lineBreak: false });
    }

    // "MEMBERSHIP CARD" pill, top-right
    const pillW = 132, pillH = 34;
    const pillX = cardX + CARD_W - pillW - 16;
    const pillY = cardY + 14;
    doc.roundedRect(pillX, pillY, pillW, pillH, 8).fill(navyDark);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#ffffff")
      .text(settings.cardTitle.toUpperCase(), pillX + 8, pillY + (pillH / 2 - 12), { width: pillW - 16, align: "center", lineGap: 2 });

    // Field rows
    const rows: { icon: keyof typeof icons; label: string; value: string }[] = [];
    rows.push({ icon: "user", label: "Policy Holder Name", value: client.firstName });
    if (settings.showSurname) rows.push({ icon: "user", label: "Surname", value: client.lastName });
    if (settings.showIdNumber && client.nationalId) rows.push({ icon: "idCard", label: "ID Number", value: client.nationalId });
    if (settings.showDateOfBirth && client.dateOfBirth) rows.push({ icon: "calendar", label: "Date of Birth", value: fmtDate(client.dateOfBirth) });
    if (settings.showPlan && product?.name) rows.push({ icon: "users", label: "Plan", value: product.name });
    if (settings.showPolicyNumber) rows.push({ icon: "hash", label: "Policy Number", value: policy.policyNumber });

    let ry = cardY + 104;
    const badgeR = 9;
    const rowX = cardX + 20;
    const labelX = rowX + badgeR * 2 + 10;
    const rowW = (settings.showQrCode ? boundary[boundary.length - 1][0] - 118 : cardX + CARD_W - 20) - labelX;
    for (const row of rows) {
      drawIconBadge(doc, row.icon, rowX + badgeR, ry + badgeR, badgeR, navy);
      doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
        .text(row.label.toUpperCase(), labelX, ry, { width: rowW, lineBreak: false, continued: true });
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_TEXT).text(`  :  ${row.value}`, { lineBreak: false });
      ry += 24;
    }

    // QR box, right side
    if (qrBuffer) {
      const qrSize = 76;
      const qrX = cardX + CARD_W - qrSize - 26;
      const qrY = cardY + 110;
      doc.roundedRect(qrX - 6, qrY - 6, qrSize + 12, qrSize + 12, 4).lineWidth(1.5).strokeColor(navy).stroke();
      try { doc.image(qrBuffer, qrX, qrY, { width: qrSize, height: qrSize }); } catch { /* skip */ }
      doc.font("Helvetica-Bold").fontSize(7).fillColor(navy)
        .text("SCAN TO VERIFY", qrX - 6, qrY + qrSize + 10, { width: qrSize + 12, align: "center" });
      doc.font("Helvetica-Bold").fontSize(7).fillColor(C_GOLD)
        .text("MEMBERSHIP", qrX - 6, qrY + qrSize + 20, { width: qrSize + 12, align: "center" });
    }

    // Footer bar
    const footerY = cardY + contentH;
    doc.rect(cardX, footerY, CARD_W, FOOTER_H).fill(navyDark);
    doc.rect(cardX, footerY, CARD_W, 2).fill(C_GOLD);

    let fx = cardX + 16;
    const fMidY = footerY + FOOTER_H / 2;
    drawShieldCheck(doc, fx, fMidY - 10, 16, "#ffffff");
    fx += 24;
    if (settings.footerNote) {
      doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#ffffff")
        .text(settings.footerNote.toUpperCase(), fx, fMidY - 10, { width: 160, lineGap: 1 });
    }

    if (org.phone || org.website) {
      let cx = cardX + CARD_W * 0.46;
      if (org.phone) {
        drawPhone(doc, cx, fMidY, 9, "#ffffff");
        doc.font("Helvetica").fontSize(7).fillColor("#ffffff").text(org.phone, cx + 10, fMidY - 4, { lineBreak: false });
        cx += 10 + doc.widthOfString(org.phone) + 14;
      }
      if (org.website) {
        drawGlobe(doc, cx + 5, fMidY, 6, "#ffffff");
        doc.font("Helvetica").fontSize(7).fillColor("#ffffff").text(org.website, cx + 14, fMidY - 4, { lineBreak: false });
      }
    }

    if (settings.footerSlogan) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(C_GOLD)
        .text(settings.footerSlogan, cardX + CARD_W - 176, fMidY - 10, { width: 160, align: "right", lineGap: 1 });
    }

    doc.restore();
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 14).lineWidth(1.5).strokeColor(C_BORDER).stroke();

    doc.end();
  } catch (err: any) {
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}
