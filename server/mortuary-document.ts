import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";

const A4_W = 595.28;
const A4_H = 841.89;
const MARGIN = 48;
const COL = A4_W - MARGIN * 2;

const C_PRIMARY = "#0f766e";
const C_TEXT = "#111827";
const C_MUTED = "#6b7280";
const C_BORDER = "#e5e7eb";
const C_LIGHT_BG = "#f9fafb";

function fmt(v: string | number | null | undefined): string {
  return v != null && String(v).trim() ? String(v).trim() : "—";
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

async function buildHeader(
  doc: InstanceType<typeof PDFDocument>,
  org: { name: string | null; phone: string | null; email: string | null; address: string | null; logoUrl: string | null },
  title: string,
  subtitle: string
): Promise<number> {
  let y = MARGIN;
  const logoData = await resolveImage(org.logoUrl);

  if (logoData) {
    try { doc.image(logoData, MARGIN, y, { height: 50, fit: [120, 50] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Funeral Parlour", MARGIN + 130, y, { width: COL - 130, align: "right" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED);
  const parts: string[] = [];
  if (org.phone) parts.push(org.phone);
  if (org.email) parts.push(org.email);
  if (org.address) parts.push(org.address);
  parts.forEach((p) => { doc.text(p, MARGIN + 130, y, { width: COL - 130, align: "right" }); y += 11; });
  y = Math.max(y, MARGIN + 56) + 12;

  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 8;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 20;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(subtitle, MARGIN, y, { width: COL, align: "center" });
  y += 20;
  return y;
}

function sectionHeader(doc: InstanceType<typeof PDFDocument>, title: string, y: number): number {
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text(title.toUpperCase(), MARGIN + 8, y + 4, { width: COL - 16 });
  doc.fillColor(C_TEXT);
  return y + 26;
}

function infoRow(doc: InstanceType<typeof PDFDocument>, label: string, value: string, y: number): number {
  const lw = 160;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, y, { width: COL - lw - 16 });
  return y + 14;
}

function sigBlock(doc: InstanceType<typeof PDFDocument>, label: string, xStart: number, width: number, y: number): void {
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(label, xStart, y, { width });
  doc.moveTo(xStart, y + 30).lineTo(xStart + width, y + 30).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Signature", xStart, y + 33, { width });
  doc.moveTo(xStart, y + 55).lineTo(xStart + width, y + 55).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Printed Name & ID", xStart, y + 58, { width });
  doc.moveTo(xStart, y + 80).lineTo(xStart + width, y + 80).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date & Time", xStart, y + 83, { width });
}

function footer(doc: InstanceType<typeof PDFDocument>, orgName: string | null, docType: string, refNo: string): void {
  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text(`${orgName || "POL263"} — ${docType} · Ref: ${refNo} · For official use only`, MARGIN, footerY + 6, { width: COL, align: "center" });
}

// ── MORTUARY RECEIPT PDF ──────────────────────────────────────

export async function streamMortuaryReceiptPDF(
  intakeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const intake = await storage.getMortuaryIntake(intakeId, orgId);
  if (!intake) { res.status(404).json({ message: "Mortuary intake not found" }); return; }

  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const removalVehicle = intake.removalVehicleId ? await storage.getFleetVehicleById(intake.removalVehicleId, orgId) : null;
  const usersMap: Record<string, { displayName: string | null; phone: string | null }> = {};
  const userIds = [intake.removalDriverId, intake.receivedByUserId].filter((id): id is string => !!id);
  await Promise.all(Array.from(new Set(userIds)).map(async (id) => {
    const u = await storage.getUser(id);
    if (u) usersMap[id] = { displayName: u.displayName, phone: u.phone };
  }));
  const removalDriver = intake.removalDriverId ? usersMap[intake.removalDriverId] : null;
  const receivedBy = intake.receivedByUserId ? usersMap[intake.receivedByUserId] : null;

  const filename = `Mortuary-Receipt-${intake.intakeNumber}.pdf`;
  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "MORTUARY RECEIPT",
    `Intake No: ${intake.intakeNumber}  ·  Generated: ${fmtDate(new Date())}`
  );

  y = sectionHeader(doc, "1. Deceased Details", y);
  y = infoRow(doc, "Full Name:", fmt(intake.deceasedName), y);
  y = infoRow(doc, "Gender:", fmt(intake.deceasedGender), y);
  y = infoRow(doc, "Age:", fmt(intake.deceasedAge), y);
  y = infoRow(doc, "National ID:", fmt(intake.deceasedNationalId), y);
  y = infoRow(doc, "Date of Death:", fmtDate(intake.dateOfDeath), y);
  y = infoRow(doc, "Cause of Death:", fmt(intake.causeOfDeath), y);
  y = infoRow(doc, "Place of Death:", fmt(intake.placeOfDeath), y);
  y += 8;

  y = sectionHeader(doc, "2. Referring Party / Next of Kin", y);
  y = infoRow(doc, "Informant Name:", fmt(intake.informantName), y);
  y = infoRow(doc, "Informant Phone:", fmt(intake.informantPhone), y);
  y = infoRow(doc, "Relationship:", fmt(intake.informantRelationship), y);
  if (intake.clientOrganizationName) y = infoRow(doc, "Referring Organisation:", fmt(intake.clientOrganizationName), y);
  y += 8;

  y = sectionHeader(doc, "3. Removal Details", y);
  y = infoRow(doc, "Removal Location:", fmt(intake.removalLocation), y);
  y = infoRow(doc, "Date & Time of Removal:", fmtDateTime(intake.removalDateTime), y);
  const driverStr = removalDriver ? `${fmt(removalDriver.displayName)}${removalDriver.phone ? ` · ${removalDriver.phone}` : ""}` : "—";
  y = infoRow(doc, "Driver:", driverStr, y);
  const vehicleStr = removalVehicle ? `${removalVehicle.registration}${removalVehicle.make ? ` — ${removalVehicle.make} ${removalVehicle.model || ""}` : ""}` : "—";
  y = infoRow(doc, "Vehicle:", vehicleStr, y);
  y += 8;

  y = sectionHeader(doc, "4. Mortuary Receipt", y);
  y = infoRow(doc, "Received By (Staff):", receivedBy ? fmt(receivedBy.displayName) : "—", y);
  y = infoRow(doc, "Received At:", fmtDateTime(intake.receivedAt), y);
  y = infoRow(doc, "Service Scope:", fmt(intake.serviceScope?.replace(/_/g, " ")), y);
  if (intake.notes) y = infoRow(doc, "Notes:", fmt(intake.notes), y);
  y += 16;

  // Sign-off blocks
  y = sectionHeader(doc, "5. Sign-Off", y);
  y += 8;
  const half = COL / 2 - 8;
  sigBlock(doc, "Received By (Mortuary Staff)", MARGIN, half, y);
  sigBlock(doc, "Handed Over By (Family / Referring Party)", MARGIN + half + 16, half, y);
  y += 100;

  footer(doc, org.name, "Mortuary Receipt", intake.intakeNumber);
  doc.end();
}

// ── MORTUARY DISPATCH PDF ─────────────────────────────────────

export async function streamMortuaryDispatchPDF(
  intakeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const intake = await storage.getMortuaryIntake(intakeId, orgId);
  if (!intake) { res.status(404).json({ message: "Mortuary intake not found" }); return; }

  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const dispatch = await storage.getMortuaryDispatch(intakeId, orgId);

  const dispatchedByUser = dispatch?.dispatchedByUserId ? await storage.getUser(dispatch.dispatchedByUserId) : null;

  const filename = `Mortuary-Dispatch-${intake.intakeNumber}.pdf`;
  if (opts?.attachment) {
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  } else {
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  }
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "MORTUARY DISPATCH NOTE",
    `Intake No: ${intake.intakeNumber}  ·  Generated: ${fmtDate(new Date())}`
  );

  y = sectionHeader(doc, "1. Deceased Details", y);
  y = infoRow(doc, "Full Name:", fmt(intake.deceasedName), y);
  y = infoRow(doc, "National ID:", fmt(intake.deceasedNationalId), y);
  y = infoRow(doc, "Intake No:", fmt(intake.intakeNumber), y);
  y += 8;

  y = sectionHeader(doc, "2. Dispatch Details", y);
  y = infoRow(doc, "Dispatched By (Staff):", dispatchedByUser ? fmt(dispatchedByUser.displayName) : "—", y);
  y = infoRow(doc, "Date & Time of Dispatch:", fmtDateTime(dispatch?.dispatchedAt), y);
  y = infoRow(doc, "Destination:", fmt(dispatch?.destination), y);
  y += 8;

  y = sectionHeader(doc, "3. Collector Details", y);
  y = infoRow(doc, "Collected By (Name):", fmt(dispatch?.collectedByName), y);
  y = infoRow(doc, "Collector ID Number:", fmt(dispatch?.collectedByIdNumber), y);
  if (dispatch?.collectedByOrganization) y = infoRow(doc, "Collector Organisation:", fmt(dispatch.collectedByOrganization), y);
  if (dispatch?.notes) y = infoRow(doc, "Notes:", fmt(dispatch.notes), y);
  y += 16;

  // Sign-off blocks
  y = sectionHeader(doc, "4. Sign-Off", y);
  y += 8;
  const half = COL / 2 - 8;
  sigBlock(doc, "Dispatched By (Mortuary Staff)", MARGIN, half, y);
  sigBlock(doc, "Collected By (Receiving Party)", MARGIN + half + 16, half, y);
  y += 100;

  footer(doc, org.name, "Mortuary Dispatch Note", intake.intakeNumber);
  doc.end();
}
