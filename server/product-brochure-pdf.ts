import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import {
  A4_W, A4_H, MARGIN, COL, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER, C_LIGHT_BG,
  buildLetterheadHeader,
} from "./pdf-utils";
import type { Product, ProductVersion } from "@shared/schema";

const FOOTER_H = 46;
const PAGE_BOTTOM = A4_H - MARGIN - FOOTER_H;

function fmtMoney(v: string | number | null | undefined, currency: string): string | null {
  if (v == null) return null;
  const n = parseFloat(String(v));
  if (isNaN(n) || n === 0) return null;
  return `${currency} ${n.toFixed(2)}`;
}

/** All non-null rate cells for a schedule (Monthly/Weekly/Bi-weekly), across currencies. */
function rateRow(pv: ProductVersion, label: string, usdKey: keyof ProductVersion, zarKey: keyof ProductVersion, zigKey: keyof ProductVersion): string | null {
  const cells = [
    fmtMoney(pv[usdKey] as any, "USD"),
    fmtMoney(pv[zarKey] as any, "ZAR"),
    fmtMoney(pv[zigKey] as any, "ZiG"),
  ].filter((c): c is string => !!c);
  if (cells.length === 0) return null;
  return `${label}: ${cells.join("  ·  ")}`;
}

function drawContactFooter(doc: InstanceType<typeof PDFDocument>, org: { name: string | null; phone?: string | null; email?: string | null; website?: string | null }): void {
  const y = A4_H - MARGIN - FOOTER_H + 8;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  const contactParts = [org.phone, org.email, org.website].filter(Boolean).join("   ·   ");
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY)
    .text(contactParts || org.name || "", MARGIN, y + 8, { width: COL, align: "center", lineBreak: false });
  doc.font("Helvetica").fontSize(6.5).fillColor(C_MUTED)
    .text("Rates shown are current as of publication and subject to change. Contact us for a personalised quote.",
      MARGIN, y + 20, { width: COL, align: "center", lineBreak: false });
}

function ensureRoom(doc: InstanceType<typeof PDFDocument>, y: number, needed: number, org: any): number {
  if (y + needed > PAGE_BOTTOM) {
    drawContactFooter(doc, org);
    doc.addPage();
    return MARGIN;
  }
  return y;
}

export async function streamProductBrochurePDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const allProducts = await storage.getProductsByOrg(orgId);
  const products = allProducts.filter((p) => p.isActive).sort((a, b) => a.name.localeCompare(b.name));

  const productSections: { product: Product; version: ProductVersion }[] = [];
  for (const product of products) {
    const versions = await storage.getProductVersions(product.id, orgId);
    const active = versions.filter((v) => v.isActive).sort((a, b) => b.version - a.version)[0];
    if (active) productSections.push({ product, version: active });
  }

  const filename = `${(org.name || "Product").replace(/[^a-z0-9]+/gi, "-")}-Brochure.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `${org.name} — Product Brochure`, Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = await buildLetterheadHeader(doc, org, "Our Cover Plans", "A guide to our funeral cover products, benefits, and rates");

  if (productSections.length === 0) {
    doc.font("Helvetica").fontSize(10).fillColor(C_MUTED)
      .text("No active products with configured pricing are available yet.", MARGIN, y, { width: COL, align: "center" });
  }

  for (const { product, version: pv } of productSections) {
    const logoImg = product.casketImageUrl ? await resolveImage(product.casketImageUrl) : null;
    const IMG_W = 90, IMG_H = 90;
    const textX = logoImg ? MARGIN + IMG_W + 14 : MARGIN;
    const textW = logoImg ? COL - IMG_W - 14 : COL;

    y = ensureRoom(doc, y, 130, org);
    const sectionTop = y;

    if (logoImg) {
      try { doc.image(logoImg, MARGIN, y, { width: IMG_W, height: IMG_H, fit: [IMG_W, IMG_H] }); } catch { /* skip */ }
    }

    doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
      .text(product.name, textX, y, { width: textW });
    let ty = doc.y + 2;
    if (product.description) {
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(product.description, textX, ty, { width: textW });
      ty = doc.y + 2;
    }

    const facts: string[] = [];
    if (product.casketType) facts.push(`Casket: ${product.casketType}`);
    const cover = fmtMoney(product.coverAmount, product.coverCurrency || "USD");
    if (cover) facts.push(`Cover amount: ${cover}`);
    const members: string[] = [];
    if (product.maxAdults) members.push(`${product.maxAdults} adult${product.maxAdults === 1 ? "" : "s"}`);
    if (product.maxChildren) members.push(`${product.maxChildren} child${product.maxChildren === 1 ? "" : "ren"}`);
    if (product.maxExtendedMembers) members.push(`${product.maxExtendedMembers} extended`);
    if (members.length) facts.push(`Included members: ${members.join(", ")}`);
    if (pv.eligibilityMinAge != null || pv.eligibilityMaxAge != null) {
      facts.push(`Eligibility: ${pv.eligibilityMinAge ?? "—"}–${pv.eligibilityMaxAge ?? "—"} years`);
    }
    if (pv.waitingPeriodDays != null) facts.push(`Waiting period: ${pv.waitingPeriodDays} days`);
    if (pv.gracePeriodDays != null) facts.push(`Grace period: ${pv.gracePeriodDays} days`);

    if (facts.length) {
      doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
        .text(facts.join("   ·   "), textX, ty, { width: textW });
      ty = doc.y + 4;
    }

    y = Math.max(sectionTop + IMG_H, ty) + 6;

    const rateLines = [
      rateRow(pv, "Monthly", "premiumMonthlyUsd", "premiumMonthlyZar", "premiumMonthlyZig"),
      rateRow(pv, "Weekly", "premiumWeeklyUsd", "premiumWeeklyZar", "premiumWeeklyZig"),
      rateRow(pv, "Bi-weekly", "premiumBiweeklyUsd", "premiumBiweeklyZar", "premiumBiweeklyZig"),
    ].filter((r): r is string => !!r);

    if (rateLines.length) {
      y = ensureRoom(doc, y, 14 * rateLines.length + 12, org);
      doc.rect(MARGIN, y, COL, 14 * rateLines.length + 8).fillColor(C_LIGHT_BG).fill();
      doc.fillColor(C_TEXT);
      let ry = y + 4;
      for (const line of rateLines) {
        doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_PRIMARY)
          .text(line, MARGIN + 8, ry, { width: COL - 16, lineBreak: false });
        ry += 14;
      }
      y = ry + 8;
    }

    doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 14;
  }

  drawContactFooter(doc, org);
  doc.end();
}
