/**
 * Branded PDF for a persisted insurance premium quote (shared/schema.ts `quotes`) — emailed
 * automatically once a visitor completes the public quote-lead capture (see server/routes.ts
 * POST /api/public/agent-vcard/:refCode/quote-lead). Not a legal/verified document like a
 * receipt or policy certificate — no stamp or verify QR, just the estimate and a call to action.
 */
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { MARGIN, COL, A4_W, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER, fmtDateShort } from "./pdf-utils";
import type { Quote } from "@shared/schema";

function formatMoney(amount: string | number | null | undefined, currency: string): string {
  if (amount == null) return "—";
  const n = typeof amount === "string" ? parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  return `${currency} ${n.toFixed(2)}`;
}

function ageAt(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(dateOfBirth);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

/** Where the PDF's "Join" call to action points — the org's own marketing site if it has one
 *  (e.g. a tenant like Diaspora with its own public site), else POL263's own hosted join page. */
export function resolveJoinUrl(org: { website?: string | null }, refCode: string | null, quoteId: string): string {
  if (org.website) {
    // organizations.website is free-text (set via the product/org settings form) — an admin may
    // save it without a protocol (e.g. "diasporafuneralservices.com"), which would otherwise
    // produce a relative link that resolves against whatever page the email/PDF is opened in,
    // not the tenant's actual site.
    const withProtocol = /^https?:\/\//i.test(org.website) ? org.website : `https://${org.website}`;
    const base = withProtocol.replace(/\/$/, "");
    return `${base}/join?quoteId=${encodeURIComponent(quoteId)}`;
  }
  const appBase = (process.env.APP_BASE_URL || "").replace(/\/$/, "");
  const ref = refCode ? `/${encodeURIComponent(refCode)}` : "";
  return `${appBase}/join${ref}?quoteId=${encodeURIComponent(quoteId)}`;
}

export async function buildQuotePdfBuffer(quoteId: string, orgId: string): Promise<{ buffer: Buffer; filename: string; quote: Quote } | null> {
  const quote = await storage.getQuote(quoteId, orgId);
  if (!quote) return null;
  const org = await storage.getOrganization(orgId);
  const orgName = org?.name || "Insurance";

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let y = MARGIN;
  const logoData = await resolveImage(org?.logoUrl ?? null);
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(orgName, MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  [org?.phone, org?.email, org?.address].filter(Boolean).forEach((p) => {
    doc.text(String(p), MARGIN + 130, y, { width: COL - 130, align: "right" });
    y += 11;
  });
  y = Math.max(y, MARGIN + 56) + 8;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 14;

  doc.font("Helvetica-Bold").fontSize(18).fillColor(C_TEXT)
    .text("Your Personalised Quote", MARGIN, y, { width: COL, align: "center" });
  y += 24;
  doc.font("Helvetica").fontSize(9.5).fillColor(C_MUTED)
    .text(`Prepared for ${quote.policyholderName}`, MARGIN, y, { width: COL, align: "center" });
  y += 28;

  // ── Recommended plan panel ──────────────────────────────────
  const panelH = 88;
  doc.rect(MARGIN, y, COL, panelH).fillColor("#f9fafb").fill();
  doc.rect(MARGIN, y, 5, panelH).fillColor(C_PRIMARY).fill();
  doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
    .text("RECOMMENDED PLAN", MARGIN + 20, y + 14, { width: COL - 40 });
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_TEXT)
    .text(quote.recommendedProductName || "—", MARGIN + 20, y + 30, { width: COL - 40 });
  doc.font("Helvetica-Bold").fontSize(20).fillColor(C_PRIMARY)
    .text(
      quote.recommendedPremium ? `${formatMoney(quote.recommendedPremium, quote.currency)} / ${quote.paymentSchedule}` : "Ask us for pricing",
      MARGIN + 20, y + 54, { width: COL - 40 },
    );
  y += panelH + 20;

  // ── Household ────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT).text("Who's covered", MARGIN, y);
  y += 16;
  const holderAge = ageAt(quote.policyholderDateOfBirth);
  const rows: string[] = [`${quote.policyholderName}${holderAge != null ? ` (age ${holderAge})` : ""} — Policyholder`];
  for (const dep of quote.dependentsJson || []) {
    const depAge = ageAt(dep.dateOfBirth);
    rows.push(`${dep.firstName} ${dep.lastName}${depAge != null ? ` (age ${depAge})` : ""} — Dependant`);
  }
  doc.font("Helvetica").fontSize(9).fillColor(C_TEXT);
  for (const r of rows) {
    doc.text(`•  ${r}`, MARGIN, y, { width: COL });
    y += 14;
  }
  y += 10;

  // ── Alternatives ─────────────────────────────────────────────
  const alternatives = quote.alternativesJson || [];
  if (alternatives.length > 0) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(C_TEXT).text("Other options", MARGIN, y);
    y += 16;
    doc.font("Helvetica").fontSize(9).fillColor(C_TEXT);
    for (const alt of alternatives) {
      doc.text(`•  ${alt.productName} — ${formatMoney(alt.premium, alt.currency)} / ${alt.paymentSchedule}`, MARGIN, y, { width: COL });
      y += 14;
    }
    y += 10;
  }

  // ── Call to action ───────────────────────────────────────────
  const joinUrl = resolveJoinUrl({ website: org?.website ?? null }, quote.refCode, quote.id);
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 16;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY).text("Ready to proceed?", MARGIN, y, { width: COL, align: "center" });
  y += 16;
  const linkText = "Click here to join";
  const linkWidth = doc.font("Helvetica-Bold").fontSize(10).widthOfString(linkText);
  const linkX = MARGIN + (COL - linkWidth) / 2;
  doc.fillColor(C_PRIMARY).text(linkText, linkX, y);
  doc.link(linkX, y, linkWidth, 14, joinUrl);
  y += 24;

  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(
      `This is an estimate based on the details provided and is not a binding offer of cover. The final premium is confirmed at application, subject to the product's terms. Valid until ${fmtDateShort(quote.expiresAt)}.`,
      MARGIN, y, { width: COL, align: "center" },
    );

  doc.end();
  const buffer = await done;
  return { buffer, filename: `Quote-${quote.policyholderName.replace(/\s+/g, "-")}.pdf`, quote };
}
