/**
 * Generates a branded A4 PDF funeral service notification card.
 * Sent to the family; contains all case details, logistics, and contacts.
 */

import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { structuredLog } from "./logger";
import { buildVerifyUrl, buildVerifyQrBuffer, drawDocumentFooter, A4_W, A4_H, MARGIN, COL, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER } from "./pdf-utils";

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

function fmtDateTime(v: Date | string | null | undefined): string {
  if (!v) return "—";
  try {
    const d = typeof v === "string" ? new Date(v) : v;
    return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }) +
      " at " + d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(v);
  }
}

type StaffUser = {
  displayName: string | null;
  phone: string | null;
  email: string | null;
  gender: string | null;
  address: string | null;
  nextOfKinName: string | null;
  nextOfKinPhone: string | null;
};

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

  const [removalVehicle, burialVehicle] = await Promise.all([
    fc.removalVehicleId ? storage.getFleetVehicleById(fc.removalVehicleId, orgId) : null,
    fc.burialVehicleId ? storage.getFleetVehicleById(fc.burialVehicleId, orgId) : null,
  ]);

  const userIds = [fc.removalDriverId, fc.burialDriverId, fc.attendingAgentId, fc.assignedTo]
    .filter((id): id is string => !!id);
  const uniqueUserIds = Array.from(new Set(userIds));
  const usersMap: Record<string, StaffUser> = {};
  await Promise.all(
    uniqueUserIds.map(async (id) => {
      const u = await storage.getUser(id);
      if (u) usersMap[id] = {
        displayName: u.displayName,
        phone: u.phone ?? null,
        email: u.email ?? null,
        gender: u.gender ?? null,
        address: (u as any).address ?? null,
        nextOfKinName: (u as any).nextOfKinName ?? null,
        nextOfKinPhone: (u as any).nextOfKinPhone ?? null,
      };
    })
  );

  const removalDriver = fc.removalDriverId ? usersMap[fc.removalDriverId] ?? null : null;
  const burialDriver = fc.burialDriverId ? usersMap[fc.burialDriverId] ?? null : null;
  const attendingAgent = fc.attendingAgentId ? usersMap[fc.attendingAgentId] ?? null : null;
  const assignedUser = fc.assignedTo ? usersMap[fc.assignedTo] ?? null : null;

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

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;

  // ── Title ───────────────────────────────────────────────────
  doc.font("Helvetica-Bold").fontSize(17).fillColor(C_TEXT)
    .text("FUNERAL SERVICE NOTIFICATION", MARGIN, y, { width: COL, align: "center" });
  y += 22;
  doc.font("Helvetica").fontSize(9).fillColor(C_MUTED)
    .text(`Case No: ${fc.caseNumber}  ·  Status: ${fmt(fc.status).replace(/_/g, " ").toUpperCase()}  ·  Generated: ${fmtDate(new Date().toISOString())}`, MARGIN, y, { width: COL, align: "center" });
  y += 20;

  // ── Helpers ─────────────────────────────────────────────────
  function sectionHeader(title: string) {
    if (y > A4_H - MARGIN - 80) { doc.addPage(); y = MARGIN; }
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff")
      .text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
    y += 22;
    doc.fillColor(C_TEXT);
  }

  function row(label: string, value: string, colWidth = 140) {
    if (y > A4_H - MARGIN - 30) { doc.addPage(); y = MARGIN; }
    const vw = COL - colWidth - 8;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
      .text(label, MARGIN, y, { width: colWidth });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
      .text(value, MARGIN + colWidth + 8, startY, { width: vw });
    y += 14;
  }

  function twoRows(l1: string, v1: string, l2: string, v2: string) {
    if (y > A4_H - MARGIN - 30) { doc.addPage(); y = MARGIN; }
    const half = COL / 2 - 4;
    const startY = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l1, MARGIN, startY, { width: 100 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v1, MARGIN + 104, startY, { width: half - 104 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l2, MARGIN + half + 8, startY, { width: 100 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v2, MARGIN + half + 112, startY, { width: half - 104 });
    y += 14;
  }

  function staffBlock(role: string, user: StaffUser | null) {
    if (!user) { row(role, "—"); return; }
    row(`${role} Name`, fmt(user.displayName));
    if (user.phone) row(`${role} Phone`, user.phone);
    if (user.email) row(`${role} Email`, user.email);
    if (user.address) row(`${role} Address`, user.address);
  }

  function emergencyBlock(role: string, user: StaffUser | null) {
    if (!user) return;
    if (user.nextOfKinName || user.nextOfKinPhone) {
      row(`${role} Emergency Contact`, fmt(user.nextOfKinName));
      if (user.nextOfKinPhone) row(`${role} Emergency Phone`, user.nextOfKinPhone);
    }
  }

  const gap = () => { y += 8; };

  try {
    // ── 1. Deceased ────────────────────────────────────────────
    sectionHeader("1. Deceased Details");
    const genderLabel = fc.deceasedGender
      ? fc.deceasedGender.charAt(0).toUpperCase() + fc.deceasedGender.slice(1)
      : "—";
    twoRows("Full Name", fmt(fc.deceasedName), "Date of Birth", fmtDate(fc.deceasedDob));
    twoRows("Gender", genderLabel, "National ID", fmt(fc.deceasedNationalId));
    if (fc.serviceType === "claim") {
      twoRows("Relationship to Policyholder", fmt(fc.deceasedRelationship), "Date of Death", fmtDate(fc.dateOfDeath));
    } else {
      row("Date of Death", fmtDate(fc.dateOfDeath));
    }
    twoRows("Cause of Death", fmt(fc.causeOfDeath), "Place of Death", fmt(fc.placeOfDeath));
    gap();

    // ── 2. Body Identification ─────────────────────────────────
    if (fc.bodyIdentifierName || fc.bodyIdentifierIdNumber) {
      sectionHeader("2. Body Identification");
      twoRows("Identified By", fmt(fc.bodyIdentifierName), "Identifier ID No.", fmt(fc.bodyIdentifierIdNumber));
      gap();
    }

    // ── 3. Informant / Emergency Contact ───────────────────────
    sectionHeader("3. Informant / Emergency Contact (Next of Kin)");
    twoRows("Name", fmt(fc.informantName), "Relationship", fmt(fc.informantRelationship));
    row("Contact Phone", fmt(fc.informantPhone));
    gap();

    // ── 4. Case Summary ────────────────────────────────────────
    sectionHeader("4. Case Summary");
    const serviceLabel = fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : "—";
    twoRows("Service Type", serviceLabel, "Case Status", fmt(fc.status).replace(/_/g, " ").toUpperCase());
    const refStr = fc.policyId ? `Policy linked` : fc.claimId ? `Claim linked` : "—";
    twoRows("Reference", refStr, "Assigned Staff", fmt(assignedUser?.displayName));
    if (fc.slaDeadline) row("SLA Deadline", fmtDateTime(fc.slaDeadline));
    if (fc.completedAt) row("Completed At", fmtDateTime(fc.completedAt));
    gap();

    // ── 5. Service Timeline (sequential) ──────────────────────
    sectionHeader("5. Service Timeline");
    row("Body Wash", fc.bodyWashTime ? fmtDateTime(fc.bodyWashTime) : "—");
    if (fc.memorialServiceStart || fc.memorialServiceEnd) {
      row("Memorial Service Start", fc.memorialServiceStart ? fmtDateTime(fc.memorialServiceStart) : "—");
      row("Memorial Service End", fc.memorialServiceEnd ? fmtDateTime(fc.memorialServiceEnd) : "—");
    }
    row("Burial Departure", fc.burialDepartureTime ? fmtDateTime(fc.burialDepartureTime) : "—");
    twoRows("Date of Burial", fmtDate(fc.funeralDate), "Place of Burial", fmt(fc.funeralLocation));
    gap();

    // ── 6. Body Removal ────────────────────────────────────────
    sectionHeader("6. Body Removal");
    row("Removal Location", fmt(fc.removalLocation));
    const remVehicleStr = removalVehicle
      ? `${removalVehicle.registration}${removalVehicle.make ? ` — ${removalVehicle.make} ${removalVehicle.model || ""}`.trim() : ""}`
      : "—";
    row("Vehicle (Reg)", remVehicleStr);
    staffBlock("Removal Driver", removalDriver);
    gap();

    // ── 7. Burial Logistics ────────────────────────────────────
    sectionHeader("7. Burial Logistics");
    const burVehicleStr = burialVehicle
      ? `${burialVehicle.registration}${burialVehicle.make ? ` — ${burialVehicle.make} ${burialVehicle.model || ""}`.trim() : ""}`
      : "—";
    row("Vehicle (Reg)", burVehicleStr);
    staffBlock("Burial Driver", burialDriver);
    gap();

    // ── 8. Attending Agent ─────────────────────────────────────
    sectionHeader("8. Attending Agent");
    if (attendingAgent) {
      row("Name", fmt(attendingAgent.displayName));
      if (attendingAgent.phone) row("Phone", attendingAgent.phone);
      if (attendingAgent.email) row("Email", attendingAgent.email);
      if (attendingAgent.address) row("Address", attendingAgent.address);
      if (attendingAgent.gender) row("Gender", fmt(attendingAgent.gender));
    } else {
      row("Attending Agent", "—");
    }
    gap();

    // ── 9. Emergency Contacts ──────────────────────────────────
    sectionHeader("9. Emergency Contacts");
    // Organisation contact
    row("Office / Parlour", fmt(org.name));
    if (org.phone) row("Office Phone", org.phone);
    if (org.email) row("Office Email", org.email);
    // Driver next of kin (operational emergency)
    if (removalDriver) emergencyBlock("Removal Driver", removalDriver);
    if (burialDriver && burialDriver !== removalDriver) emergencyBlock("Burial Driver", burialDriver);
    if (attendingAgent) emergencyBlock("Agent", attendingAgent);
    gap();

    // ── 10. Notes ───────────────────────────────────────────────
    if (fc.notes) {
      sectionHeader("10. Notes");
      doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
        .text(fc.notes, MARGIN, y, { width: COL });
      y += doc.heightOfString(fc.notes, { width: COL }) + 8;
    }

    // ── Footer ──────────────────────────────────────────────────
    const [sigBufFun, qrBufFun] = await Promise.all([
      resolveImage((org as any).signatureUrl),
      (async () => { const u = buildVerifyUrl("form", caseId); return u ? buildVerifyQrBuffer(u) : null; })(),
    ]);
    drawDocumentFooter(
      doc,
      sigBufFun,
      qrBufFun,
      org.name || "POL263",
      `This document was generated by ${org.name || "POL263"} · Case ${fc.caseNumber} · Status: ${fc.status.replace(/_/g, " ").toUpperCase()}`,
      A4_H - MARGIN - 125,
    );

    doc.end();
  } catch (err: any) {
    structuredLog("error", "Funeral document PDF generation failed", { caseId, error: err?.message });
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}
