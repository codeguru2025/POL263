/**
 * Generates a branded A4 PDF funeral service notification card.
 * Sent to the family; contains all case details, logistics, and contacts.
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { structuredLog } from "./logger";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#e5e7eb";
const C_LIGHT_BG = "#f9fafb";

function fmt(v: string | null | undefined): string {
  return v?.trim() || "—";
}

function fmtDate(v: string | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return v;
  }
}

export async function streamFuneralDocumentToResponse(
  caseId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const fc = await storage.getFuneralCase(caseId, orgId);
  if (!fc || fc.organizationId !== orgId) {
    res.status(404).json({ message: "Funeral case not found" });
    return;
  }

  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  // Resolve linked records
  const [removalVehicle, burialVehicle] = await Promise.all([
    fc.removalVehicleId ? storage.getFleetVehicleById(fc.removalVehicleId, orgId) : null,
    fc.burialVehicleId ? storage.getFleetVehicleById(fc.burialVehicleId, orgId) : null,
  ]);

  const userIds = [fc.removalDriverId, fc.burialDriverId, fc.attendingAgentId, fc.assignedTo]
    .filter((id): id is string => !!id);
  const uniqueUserIds = Array.from(new Set(userIds));
  const usersMap: Record<string, { displayName: string | null; phone: string | null; gender: string | null; email: string | null }> = {};
  await Promise.all(
    uniqueUserIds.map(async (id) => {
      const u = await storage.getUser(id);
      if (u) usersMap[id] = { displayName: u.displayName, phone: u.phone, gender: u.gender, email: u.email };
    })
  );

  const removalDriver = fc.removalDriverId ? usersMap[fc.removalDriverId] : null;
  const burialDriver = fc.burialDriverId ? usersMap[fc.burialDriverId] : null;
  const attendingAgent = fc.attendingAgentId ? usersMap[fc.attendingAgentId] : null;

  const logoData = await resolveImage(org.logoUrl);

  const filename = `Funeral-${fc.caseNumber}.pdf`;

  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Funeral Service — ${fc.caseNumber}`, Author: org.name || "POL263" } });
  doc.pipe(res);

  let y = MARGIN;

  // ── Header ──────────────────────────────────────────────────
  if (logoData) {
    try {
      doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] });
    } catch { /* skip */ }
  }

  // Company name + contact block (right-aligned)
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Funeral Parlour", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const contactParts: string[] = [];
  if (org.phone) contactParts.push(org.phone);
  if (org.email) contactParts.push(org.email);
  if (org.address) contactParts.push(org.address);
  if (org.website) contactParts.push(org.website);
  contactParts.forEach((part) => {
    doc.text(part, MARGIN + 130, y, { width: COL - 130, align: "right" });
    y += 11;
  });

  y = Math.max(y, MARGIN + 56) + 12;

  // ── Rule ────────────────────────────────────────────────────
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;

  // ── Title ───────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C_TEXT)
    .text("FUNERAL SERVICE NOTIFICATION", MARGIN, y, { width: COL, align: "center" });
  y += 22;
  doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
    .text(`Case No: ${fc.caseNumber}  ·  Generated: ${fmtDate(new Date().toISOString())}`, MARGIN, y, { width: COL, align: "center" });
  y += 20;

  // ── Section helper ──────────────────────────────────────────
  function sectionHeader(title: string) {
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
    y += 22;
    doc.fillColor(C_TEXT);
  }

  function row(label: string, value: string, colWidth?: number) {
    const lw = colWidth ?? 140;
    const vw = COL - lw - 8;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text(label, MARGIN, y, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
      .text(value, MARGIN + lw + 8, startY, { width: vw });
    y += 14;
  }

  function twoRows(
    l1: string, v1: string,
    l2: string, v2: string
  ) {
    const half = COL / 2 - 4;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text(l1, MARGIN, startY, { width: 100 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
      .text(v1, MARGIN + 104, startY, { width: half - 104 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text(l2, MARGIN + half + 8, startY, { width: 100 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
      .text(v2, MARGIN + half + 112, startY, { width: half - 104 });
    y += 14;
  }

  function lightBox(contentFn: () => void) {
    const boxStartY = y;
    contentFn();
    const boxH = y - boxStartY + 6;
    doc.rect(MARGIN, boxStartY - 4, COL, boxH).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.rect(MARGIN, boxStartY - 4, COL, boxH).fillOpacity(0.4).fill(C_LIGHT_BG).fillOpacity(1);
    // Re-draw content on top (PDF layers already rendered; this trick won't work in PDFKit — skip fill)
  }

  const gap = () => { y += 8; };

  try {
  // ── 1. Deceased ─────────────────────────────────────────────
  sectionHeader("1. Deceased Details");
  const deceasedGenderLabel = fc.deceasedGender
    ? fc.deceasedGender.charAt(0).toUpperCase() + fc.deceasedGender.slice(1)
    : "";
  twoRows("Full Name", fmt(fc.deceasedName), "Date of Birth", fmtDate(fc.deceasedDob));
  twoRows("Gender", fmt(deceasedGenderLabel), "National ID", fmt(fc.deceasedNationalId));
  if (fc.serviceType === "claim") {
    twoRows("Relationship to Policyholder", fmt(fc.deceasedRelationship), "Date of Death", fmtDate(fc.dateOfDeath));
  } else {
    row("Date of Death", fmtDate(fc.dateOfDeath));
  }
  twoRows("Cause of Death", fmt(fc.causeOfDeath), "Place of Death", fmt(fc.placeOfDeath));
  gap();

  // ── 2. Informant ────────────────────────────────────────────
  sectionHeader("2. Informant (Next of Kin)");
  twoRows("Name", fmt(fc.informantName), "Relationship", fmt(fc.informantRelationship));
  row("Contact Phone", fmt(fc.informantPhone));
  gap();

  // ── 3. Service Details ──────────────────────────────────────
  sectionHeader("3. Service Details");
  const serviceLabel = fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : "—";
  twoRows("Service Type", serviceLabel, "Policy / Ref", fc.policyId ? `Linked (${fc.policyId.slice(0, 8)}…)` : fc.claimId ? `Claim linked` : "—");
  twoRows("Date of Burial", fmtDate(fc.funeralDate), "Place of Burial", fmt(fc.funeralLocation));
  gap();

  // ── 4. Body Removal ─────────────────────────────────────────
  sectionHeader("4. Body Removal");
  row("Removal Location", fmt(fc.removalLocation));
  const remVehicleStr = removalVehicle ? `${removalVehicle.registration}${removalVehicle.make ? ` — ${removalVehicle.make} ${removalVehicle.model || ""}`.trim() : ""}` : "—";
  const remDriverStr = removalDriver ? `${fmt(removalDriver.displayName)}${removalDriver.phone ? `  ·  ${removalDriver.phone}` : ""}` : "—";
  twoRows("Vehicle (Reg)", remVehicleStr, "Driver", remDriverStr);
  gap();

  // ── 5. Burial Logistics ─────────────────────────────────────
  sectionHeader("5. Burial Logistics");
  const burVehicleStr = burialVehicle ? `${burialVehicle.registration}${burialVehicle.make ? ` — ${burialVehicle.make} ${burialVehicle.model || ""}`.trim() : ""}` : "—";
  const burDriverStr = burialDriver ? `${fmt(burialDriver.displayName)}${burialDriver.phone ? `  ·  ${burialDriver.phone}` : ""}` : "—";
  twoRows("Vehicle (Reg)", burVehicleStr, "Driver", burDriverStr);
  gap();

  // ── 6. Attending Agent ──────────────────────────────────────
  sectionHeader("6. Attending Agent");
  if (attendingAgent) {
    twoRows("Name", fmt(attendingAgent.displayName), "Gender", fmt(attendingAgent.gender));
    twoRows("Phone", fmt(attendingAgent.phone), "Email", fmt(attendingAgent.email));
  } else {
    row("Assigned Agent", "—");
  }
  gap();

  // ── 7. Notes ────────────────────────────────────────────────
  if (fc.notes) {
    sectionHeader("7. Notes");
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
      .text(fc.notes, MARGIN, y, { width: COL });
    y += doc.heightOfString(fc.notes, { width: COL }) + 8;
  }

  // ── Footer ──────────────────────────────────────────────────
  const footerY = A4_H - MARGIN - 28;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(
      `This document was generated by ${org.name || "POL263"} · Case ${fc.caseNumber} · Status: ${fc.status.replace("_", " ").toUpperCase()}`,
      MARGIN, footerY + 6, { width: COL, align: "center" }
    );

    doc.end();
  } catch (err: any) {
    structuredLog("error", "Funeral document PDF generation failed", { caseId, error: err?.message });
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}
