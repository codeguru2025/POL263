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

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return String(v);
  }
}

function fmtDateTime(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try {
    return new Date(v).toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return String(v);
  }
}

export async function streamDriverChecklistPDF(
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

  const checklist = await storage.getDriverChecklist(caseId, orgId);

  const [removalVehicle, burialVehicle] = await Promise.all([
    fc.removalVehicleId ? storage.getFleetVehicleById(fc.removalVehicleId, orgId) : null,
    fc.burialVehicleId ? storage.getFleetVehicleById(fc.burialVehicleId, orgId) : null,
  ]);

  const userIds = [fc.removalDriverId, fc.burialDriverId, fc.attendingAgentId, fc.assignedTo, checklist?.driverId, checklist?.preparedByUserId]
    .filter((id): id is string => !!id);
  const uniqueIds = Array.from(new Set(userIds));
  const usersMap: Record<string, { displayName: string | null; phone: string | null; email: string | null; address: string | null; nextOfKinName: string | null; nextOfKinPhone: string | null }> = {};
  await Promise.all(uniqueIds.map(async (id) => {
    const u = await storage.getUser(id);
    if (u) usersMap[id] = {
      displayName: u.displayName,
      phone: u.phone ?? null,
      email: u.email ?? null,
      address: (u as any).address ?? null,
      nextOfKinName: (u as any).nextOfKinName ?? null,
      nextOfKinPhone: (u as any).nextOfKinPhone ?? null,
    };
  }));

  const removalDriver = fc.removalDriverId ? usersMap[fc.removalDriverId] ?? null : null;
  const burialDriver = (checklist?.driverId ? usersMap[checklist.driverId] : null)
    ?? (fc.burialDriverId ? usersMap[fc.burialDriverId] : null) ?? null;
  const attendingAgent = fc.attendingAgentId ? usersMap[fc.attendingAgentId] ?? null : null;
  const preparedBy = checklist?.preparedByUserId ? usersMap[checklist.preparedByUserId] ?? null : null;

  const logoData = await resolveImage(org.logoUrl);
  const filename = `Driver-Checklist-${fc.caseNumber}.pdf`;

  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, info: { Title: `Driver Checklist — ${fc.caseNumber}`, Author: org.name || "POL263" } });
  doc.pipe(res);

  try {
  let y = MARGIN;

  // ── Header ────────────────────────────────────────────────
  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Funeral Parlour", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const contactParts: string[] = [];
  if (org.phone) contactParts.push(org.phone);
  if (org.email) contactParts.push(org.email);
  if (org.address) contactParts.push(org.address);
  contactParts.forEach((p) => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 12;

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_TEXT)
    .text("BURIAL DRIVER CHECKLIST", MARGIN, y, { width: COL, align: "center" });
  y += 20;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(`Case No: ${fc.caseNumber}  ·  Generated: ${fmtDate(new Date())}`, MARGIN, y, { width: COL, align: "center" });
  y += 16;

  // ── Section helpers ───────────────────────────────────────
  const sectionHeader = (title: string) => {
    if (y > A4_H - MARGIN - 80) { doc.addPage(); y = MARGIN; }
    doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
    doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
    y += 22;
    doc.fillColor(C_TEXT);
  };

  const dataRow = (label: string, value: string, lw = 160) => {
    if (y > A4_H - MARGIN - 24) { doc.addPage(); y = MARGIN; }
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, y, { width: COL - lw - 24 });
    y += 13;
  };

  const twoCol = (l1: string, v1: string, l2: string, v2: string) => {
    if (y > A4_H - MARGIN - 24) { doc.addPage(); y = MARGIN; }
    const half = COL / 2 - 4;
    const sy = y;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l1, MARGIN + 8, sy, { width: 90 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v1, MARGIN + 100, sy, { width: half - 100 });
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(l2, MARGIN + half + 8, sy, { width: 90 });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(v2, MARGIN + half + 100, sy, { width: half - 100 });
    y += 13;
  };

  // ── 1. Funeral Case Summary ───────────────────────────────
  sectionHeader("1. Funeral Case Summary");

  // Deceased
  twoCol("Deceased Name:", fmt(fc.deceasedName), "Date of Death:", fmtDate(fc.dateOfDeath));
  twoCol("Date of Birth:", fmtDate(fc.deceasedDob), "Gender:", fc.deceasedGender ? fc.deceasedGender.charAt(0).toUpperCase() + fc.deceasedGender.slice(1) : "—");
  twoCol("National ID:", fmt(fc.deceasedNationalId), "Cause of Death:", fmt(fc.causeOfDeath));
  if (fc.placeOfDeath) dataRow("Place of Death:", fmt(fc.placeOfDeath));
  if (fc.deceasedRelationship && fc.serviceType === "claim") dataRow("Relationship:", fmt(fc.deceasedRelationship));
  y += 4;

  // Service details
  const serviceLabel = fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : "—";
  twoCol("Service Type:", serviceLabel, "Case Status:", fmt(fc.status).replace(/_/g, " ").toUpperCase());
  twoCol("Date of Burial:", fmtDate(fc.funeralDate), "Place of Burial:", fmt(fc.funeralLocation));
  y += 4;

  // ── 2. Informant / Next of Kin ────────────────────────────
  sectionHeader("2. Informant / Next of Kin (Emergency Contact)");
  twoCol("Name:", fmt(fc.informantName), "Relationship:", fmt(fc.informantRelationship));
  dataRow("Contact Phone:", fmt(fc.informantPhone));
  y += 4;

  // ── 3. Service Timeline ───────────────────────────────────
  sectionHeader("3. Service Timeline");
  dataRow("Body Wash Time:", fmtDateTime(fc.bodyWashTime));
  if (fc.memorialServiceStart || fc.memorialServiceEnd) {
    twoCol("Memorial Start:", fmtDateTime(fc.memorialServiceStart), "Memorial End:", fmtDateTime(fc.memorialServiceEnd));
  }
  dataRow("Burial Departure:", fmtDateTime(fc.burialDepartureTime));
  dataRow("Burial Date:", fmtDate(fc.funeralDate));
  if (fc.slaDeadline) dataRow("SLA Deadline:", fmtDateTime(fc.slaDeadline));
  y += 4;

  // ── 4. Body Removal ───────────────────────────────────────
  sectionHeader("4. Body Removal");
  dataRow("Removal Location:", fmt(fc.removalLocation));
  if (removalVehicle) {
    const remStr = `${removalVehicle.registration}${removalVehicle.make ? ` — ${removalVehicle.make} ${removalVehicle.model || ""}`.trim() : ""}`;
    dataRow("Removal Vehicle:", remStr);
  }
  if (removalDriver) {
    dataRow("Removal Driver:", fmt(removalDriver.displayName));
    if (removalDriver.phone) dataRow("Driver Phone:", removalDriver.phone);
    if (removalDriver.email) dataRow("Driver Email:", removalDriver.email);
    if (removalDriver.nextOfKinName) dataRow("Driver Emerg. Contact:", fmt(removalDriver.nextOfKinName));
    if (removalDriver.nextOfKinPhone) dataRow("Driver Emerg. Phone:", removalDriver.nextOfKinPhone);
  }
  y += 4;

  // ── 5. Burial Driver & Vehicle ────────────────────────────
  sectionHeader("5. Burial Driver & Vehicle");
  if (burialVehicle) {
    const burStr = `${burialVehicle.registration}${burialVehicle.make ? ` — ${burialVehicle.make} ${burialVehicle.model || ""}`.trim() : ""}`;
    dataRow("Vehicle:", burStr);
  } else {
    dataRow("Vehicle:", "—");
  }
  if (burialDriver) {
    dataRow("Driver Name:", fmt(burialDriver.displayName));
    if (burialDriver.phone) dataRow("Driver Phone:", burialDriver.phone);
    if (burialDriver.email) dataRow("Driver Email:", burialDriver.email);
    if (burialDriver.nextOfKinName) dataRow("Driver Emerg. Contact:", fmt(burialDriver.nextOfKinName));
    if (burialDriver.nextOfKinPhone) dataRow("Driver Emerg. Phone:", burialDriver.nextOfKinPhone);
  } else {
    dataRow("Driver:", "—");
  }
  y += 4;

  // ── 6. Attending Agent ────────────────────────────────────
  sectionHeader("6. Attending Agent");
  if (attendingAgent) {
    dataRow("Name:", fmt(attendingAgent.displayName));
    if (attendingAgent.phone) dataRow("Phone:", attendingAgent.phone);
    if (attendingAgent.email) dataRow("Email:", attendingAgent.email);
    if (attendingAgent.address) dataRow("Address:", attendingAgent.address);
    if (attendingAgent.nextOfKinName) dataRow("Emergency Contact:", fmt(attendingAgent.nextOfKinName));
    if (attendingAgent.nextOfKinPhone) dataRow("Emergency Phone:", attendingAgent.nextOfKinPhone);
  } else {
    dataRow("Attending Agent:", "—");
  }
  y += 4;

  // ── 7. Pre-Departure Checklist ────────────────────────────
  sectionHeader("7. Pre-Departure Checklist");

  const checkRow = (label: string, ticked: boolean | null | undefined, detail?: string) => {
    if (y > A4_H - MARGIN - 24) { doc.addPage(); y = MARGIN; }
    const boxSize = 10;
    doc.rect(MARGIN + 4, y, boxSize, boxSize).lineWidth(0.8).strokeColor(C_BORDER).stroke();
    if (ticked) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_PRIMARY)
        .text("✓", MARGIN + 5, y - 1, { width: boxSize, align: "center" });
    }
    doc.font("Helvetica").fontSize(9).fillColor(C_TEXT)
      .text(label, MARGIN + 20, y, { width: 200 });
    if (detail) {
      doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text(detail, MARGIN + 230, y, { width: COL - 230 });
    }
    y += 16;
  };

  checkRow("Grave Tent", checklist?.graveTent);
  checkRow("Lowering Device", checklist?.loweringDevice);
  checkRow("Gloves", checklist?.gloves);
  checkRow("Masks", checklist?.masks);

  const fuelLabel = checklist?.fuelGauge
    ? { full: "Full", three_quarter: "Three-Quarter (¾)", half: "Half (½)", quarter: "Quarter (¼)" }[checklist.fuelGauge] ?? checklist.fuelGauge
    : "Not recorded";
  checkRow("Fuel Gauge", !!checklist?.fuelGauge, fuelLabel);

  const tollDetail = checklist?.tollGateRequired
    ? `Yes — Amount: ${checklist.tollGateAmount ? `$${checklist.tollGateAmount}` : "TBD"}`
    : (checklist ? "Not required" : "—");
  checkRow("Toll Gate Fees", checklist?.tollGateRequired, tollDetail);

  y += 4;

  // ── 8. Financial / Admin ──────────────────────────────────
  sectionHeader("8. Financial / Admin");

  const adminRow = (label: string, value: string) => {
    if (y > A4_H - MARGIN - 24) { doc.addPage(); y = MARGIN; }
    const lw = 180;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, y, { width: COL - lw - 16 });
    y += 14;
  };

  adminRow("Driver Allowance:", checklist?.driverAllowance ? `$${checklist.driverAllowance}` : "—");
  adminRow("Burial Order Ref:", fmt(checklist?.burialOrderRef));
  adminRow("Funeral Case No:", fc.caseNumber);
  adminRow("Departure Time:", fmtDateTime(fc.burialDepartureTime));

  if (checklist?.completedAt) {
    adminRow("Checklist Prepared At:", fmtDateTime(checklist.completedAt));
  }
  if (preparedBy) {
    adminRow("Prepared By:", fmt(preparedBy.displayName));
  }

  y += 16;

  // ── 9. Sign-Off ───────────────────────────────────────────
  if (y > A4_H - MARGIN - 130) { doc.addPage(); y = MARGIN; }
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("SIGN-OFF", MARGIN + 8, y + 4);
  y += 26;
  doc.fillColor(C_TEXT);

  const half = COL / 2 - 8;

  const sigBlock = (label: string, xStart: number, width: number) => {
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(label, xStart, y, { width });
    doc.moveTo(xStart, y + 30).lineTo(xStart + width, y + 30).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Signature", xStart, y + 33, { width });
    doc.moveTo(xStart, y + 55).lineTo(xStart + width, y + 55).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Printed Name", xStart, y + 58, { width });
    doc.moveTo(xStart, y + 78).lineTo(xStart + width, y + 78).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date", xStart, y + 81, { width });
  };

  sigBlock("Driver", MARGIN, half);
  sigBlock("Dispatcher / Authorised By", MARGIN + half + 16, half);
  y += 100;

  // ── Footer ────────────────────────────────────────────────
  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(
      `${org.name || "POL263"} — Driver Checklist · Case ${fc.caseNumber} · For official use only`,
      MARGIN, footerY + 6, { width: COL, align: "center" }
    );

    doc.end();
  } catch (err: any) {
    structuredLog("error", "Driver checklist PDF generation failed", { caseId, error: err?.message });
    try { doc.end(); } catch { /* already ended */ }
    res.destroy();
  }
}
