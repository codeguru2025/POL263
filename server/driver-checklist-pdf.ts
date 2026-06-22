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

  const burialVehicle = fc.burialVehicleId ? await storage.getFleetVehicleById(fc.burialVehicleId, orgId) : null;
  const userIds = [fc.burialDriverId, checklist?.driverId, checklist?.preparedByUserId].filter((id): id is string => !!id);
  const uniqueIds = Array.from(new Set(userIds));
  const usersMap: Record<string, { displayName: string | null; phone: string | null }> = {};
  await Promise.all(uniqueIds.map(async (id) => {
    const u = await storage.getUser(id);
    if (u) usersMap[id] = { displayName: u.displayName, phone: u.phone };
  }));

  const driver = (checklist?.driverId ? usersMap[checklist.driverId] : null)
    ?? (fc.burialDriverId ? usersMap[fc.burialDriverId] : null);
  const preparedBy = checklist?.preparedByUserId ? usersMap[checklist.preparedByUserId] : null;

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
  y += 20;

  // ── Top box: Case summary ─────────────────────────────────
  const boxTop = y;
  doc.rect(MARGIN, y, COL, 72).fillColor(C_LIGHT_BG).fill();
  doc.rect(MARGIN, y, COL, 72).lineWidth(0.8).strokeColor(C_BORDER).stroke();
  doc.fillColor(C_TEXT);
  y += 8;

  function summaryRow(label: string, value: string) {
    const lw = 130;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 4, y, { width: COL - lw - 16 });
    y += 13;
  }

  summaryRow("Deceased Name:", fmt(fc.deceasedName));
  summaryRow("Date of Burial:", fmtDate(fc.funeralDate));
  summaryRow("Burial Location:", fmt(fc.funeralLocation));
  const driverStr = driver ? `${fmt(driver.displayName)}${driver.phone ? `  ·  ${driver.phone}` : ""}` : "—";
  summaryRow("Driver Allocated:", driverStr);
  const vehicleStr = burialVehicle ? `${burialVehicle.registration}${burialVehicle.make ? ` — ${burialVehicle.make} ${burialVehicle.model || ""}`.trim() : ""}` : "—";
  summaryRow("Vehicle:", vehicleStr);
  y = boxTop + 72 + 16;

  // ── Section: Checklist ────────────────────────────────────
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("PRE-DEPARTURE CHECKLIST", MARGIN + 8, y + 4);
  y += 26;
  doc.fillColor(C_TEXT);

  function checkRow(label: string, ticked: boolean | null | undefined, detail?: string) {
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
  }

  checkRow("Grave Tent", checklist?.graveTent);
  checkRow("Lowering Device", checklist?.loweringDevice);
  checkRow("Gloves", checklist?.gloves);
  checkRow("Masks", checklist?.masks);

  // Fuel gauge row
  const fuelLabel = checklist?.fuelGauge
    ? { full: "Full", three_quarter: "Three-Quarter (¾)", half: "Half (½)", quarter: "Quarter (¼)" }[checklist.fuelGauge] ?? checklist.fuelGauge
    : "Not recorded";
  checkRow("Fuel Gauge", !!checklist?.fuelGauge, fuelLabel);

  // Toll gate
  const tollDetail = checklist?.tollGateRequired
    ? `Yes — Amount: ${checklist.tollGateAmount ? `$${checklist.tollGateAmount}` : "TBD"}`
    : (checklist ? "Not required" : "—");
  checkRow("Toll Gate Fees", checklist?.tollGateRequired, tollDetail);

  y += 4;

  // ── Section: Financial ────────────────────────────────────
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("FINANCIAL / ADMIN", MARGIN + 8, y + 4);
  y += 26;
  doc.fillColor(C_TEXT);

  function adminRow(label: string, value: string) {
    const lw = 180;
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value, MARGIN + lw + 8, y, { width: COL - lw - 16 });
    y += 14;
  }

  adminRow("Driver Allowance:", checklist?.driverAllowance ? `$${checklist.driverAllowance}` : "—");
  adminRow("Burial Order Ref:", fmt(checklist?.burialOrderRef));
  adminRow("Funeral Case No:", fc.caseNumber);
  adminRow("Departure Time:", fmtDateTime(fc.burialDepartureTime));
  adminRow("Memorial Service Start:", fmtDateTime(fc.memorialServiceStart));
  adminRow("Memorial Service End:", fmtDateTime(fc.memorialServiceEnd));

  if (checklist?.completedAt) {
    adminRow("Checklist Prepared At:", fmtDateTime(checklist.completedAt));
  }
  if (preparedBy) {
    adminRow("Prepared By:", fmt(preparedBy.displayName));
  }

  y += 16;

  // ── Section: Signatures ───────────────────────────────────
  doc.rect(MARGIN, y, COL, 18).fill(C_PRIMARY);
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#ffffff").text("SIGN-OFF", MARGIN + 8, y + 4);
  y += 26;
  doc.fillColor(C_TEXT);

  const half = COL / 2 - 8;

  function sigBlock(label: string, xStart: number, width: number) {
    doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(label, xStart, y, { width });
    doc.moveTo(xStart, y + 30).lineTo(xStart + width, y + 30).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Signature", xStart, y + 33, { width });
    doc.moveTo(xStart, y + 55).lineTo(xStart + width, y + 55).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Printed Name", xStart, y + 58, { width });
    doc.moveTo(xStart, y + 78).lineTo(xStart + width, y + 78).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Date", xStart, y + 81, { width });
  }

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
