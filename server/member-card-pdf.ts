/**
 * Member Card — a single printable membership/ID card for a policyholder, rendered on an
 * A4 page (print & cut). Layout and field visibility come from `member_card_settings`
 * (Member Card Admin); anything not yet configured falls back to sensible defaults
 * (see `storage.getMemberCardSettings`).
 */
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildVerifyUrl, buildVerifyQrBuffer } from "./pdf-utils";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#d1d5db";

const TZ = "Africa/Harare";
function fmtDate(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: TZ });
}

// Card geometry — roughly CR80 proportions scaled up for a legible printed card.
const CARD_W = 460;
const CARD_H = 280;

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
  const [client, org] = await Promise.all([
    storage.getClient(policy.clientId, orgId),
    storage.getOrganization(orgId),
  ]);
  if (!client || !org) {
    res.status(404).json({ message: "Card data incomplete" });
    return;
  }

  const filename = `Member-Card-${policy.policyNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", opts?.attachment
    ? `attachment; filename="${filename}"`
    : `inline; filename="${filename}"`);

  const primaryColor = org.primaryColor || "#0d9488";
  const logoData = settings.showLogo ? await resolveImage(org.logoUrl) : null;
  let qrBuffer: Buffer | null = null;
  if (settings.showQrCode) {
    const verifyUrl = buildVerifyUrl("policy", policy.id, orgId);
    if (verifyUrl) qrBuffer = await buildVerifyQrBuffer(verifyUrl, 100);
  }

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  try {
    const cardX = MARGIN + (COL - CARD_W) / 2;
    const cardY = MARGIN + 20;

    doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
      .text("Print, cut along the border, and laminate for a durable membership card.", MARGIN, MARGIN, { width: COL, align: "center" });

    // Card outline
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 12).lineWidth(1.5).strokeColor(C_BORDER).stroke();
    doc.save();
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 12).clip();

    // Header band
    const bandH = 54;
    doc.rect(cardX, cardY, CARD_W, bandH).fill(primaryColor);
    if (logoData) {
      try { doc.image(logoData, cardX + 14, cardY + 8, { height: bandH - 16, fit: [90, bandH - 16] }); } catch { /* skip */ }
    }
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#ffffff")
      .text(org.name || "POL263", cardX + (logoData ? 110 : 16), cardY + 12, { width: CARD_W - (logoData ? 124 : 30), align: logoData ? "right" : "left" });
    doc.font("Helvetica").fontSize(9).fillColor("#ffffff")
      .text(settings.cardTitle.toUpperCase(), cardX + (logoData ? 110 : 16), cardY + 30, { width: CARD_W - (logoData ? 124 : 30), align: logoData ? "right" : "left" });

    let y = cardY + bandH + 16;
    const photoW = 82;
    const detailX = settings.showPhotoBox ? cardX + 16 + photoW + 16 : cardX + 16;
    const detailW = CARD_W - (detailX - cardX) - 16;

    if (settings.showPhotoBox) {
      doc.rect(cardX + 16, y, photoW, 100).lineWidth(1).strokeColor(C_BORDER).stroke();
      doc.font("Helvetica").fontSize(7).fillColor(C_MUTED)
        .text("PHOTO", cardX + 16, y + 46, { width: photoW, align: "center" });
    }

    const field = (label: string, value: string) => {
      doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text(label.toUpperCase(), detailX, y, { width: detailW });
      y += 10;
      doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT).text(value, detailX, y, { width: detailW, lineBreak: false });
      y += 18;
    };

    field("Member Name", `${client.firstName} ${client.lastName}`.trim());
    if (settings.showPolicyNumber) field("Policy Number", policy.policyNumber);
    if (settings.showMemberSince && policy.inceptionDate) field("Member Since", fmtDate(policy.inceptionDate));
    if (settings.showValidUntil) {
      const inGoodStanding = policy.status === "active" || policy.status === "grace";
      if (inGoodStanding && policy.currentCycleEnd) {
        field("Valid Until", fmtDate(policy.currentCycleEnd));
      } else if (!inGoodStanding) {
        field("Status", policy.status.toUpperCase());
      }
    }

    if (qrBuffer) {
      try { doc.image(qrBuffer, cardX + CARD_W - 90, cardY + CARD_H - 90, { width: 74, height: 74 }); } catch { /* skip */ }
    }

    doc.restore();
    doc.roundedRect(cardX, cardY, CARD_W, CARD_H, 12).lineWidth(1.5).strokeColor(C_BORDER).stroke();

    const noteY = cardY + CARD_H + 16;
    if (settings.footerNote) {
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
        .text(settings.footerNote, MARGIN, noteY, { width: COL, align: "center" });
    }
    if (qrBuffer) {
      doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
        .text("Scan the QR code to verify this membership is active.", MARGIN, noteY + (settings.footerNote ? 14 : 0), { width: COL, align: "center" });
    }

    doc.end();
  } catch (err: any) {
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}
