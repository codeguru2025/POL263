import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildVerifyUrl, buildVerifyQrBuffer, drawDocumentFooter, buildLetterheadHeader, A4_W, A4_H, MARGIN, COL, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER, C_LIGHT_BG } from "./pdf-utils";

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

function footer(
  doc: InstanceType<typeof PDFDocument>,
  orgName: string | null,
  docType: string,
  refNo: string,
  signatureBuffer: Buffer | null = null,
  qrBuffer: Buffer | null = null,
): void {
  const footerTop = A4_H - MARGIN - 130;
  drawDocumentFooter(
    doc,
    signatureBuffer,
    qrBuffer,
    orgName || "POL263",
    `${orgName || "POL263"} — ${docType} · Ref: ${refNo} · For official use only`,
    footerTop,
  );
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

  const [sigBufMR, qrBufMR] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", intake.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Mortuary Receipt", intake.intakeNumber, sigBufMR, qrBufMR);
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
  if (dispatch?.chapelWashBayUsed) {
    const feeStatus = dispatch.chapelWashBayFeeStatus === "paid" ? "Paid" : "Unpaid";
    y = infoRow(doc, "Chapel & Wash Bay Fee:", `USD ${parseFloat(String(dispatch.chapelWashBayFeeAmount ?? "20.00")).toFixed(2)} (${feeStatus})`, y);
  }
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

  const [sigBufMD, qrBufMD] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", intake.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Mortuary Dispatch Note", intake.intakeNumber, sigBufMD, qrBufMD);
  doc.end();
}

// ── BLANK HELPERS ─────────────────────────────────────────────

function blankHeader(doc: InstanceType<typeof PDFDocument>, title: string, subtitle: string): number {
  let y = MARGIN;
  doc.font("Helvetica-Bold").fontSize(16).fillColor(C_TEXT)
    .text(title, MARGIN, y, { width: COL, align: "center" });
  y += 22;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text(subtitle, MARGIN, y, { width: COL, align: "center" });
  y += 18;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 12;
  return y;
}

function blankField(doc: InstanceType<typeof PDFDocument>, label: string, x: number, y: number, width: number): number {
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED).text(label, x, y, { width });
  y += 12;
  doc.moveTo(x, y).lineTo(x + width, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  return y + 10;
}

function blankCheck(doc: InstanceType<typeof PDFDocument>, label: string, x: number, y: number, checked: boolean | null | undefined): number {
  doc.rect(x, y, 10, 10).lineWidth(0.5).strokeColor(C_TEXT).stroke();
  if (checked) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("✓", x + 1, y, { width: 10 });
  }
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(label, x + 16, y + 1, { width: 180 });
  return y + 18;
}

function tableRow(
  doc: InstanceType<typeof PDFDocument>,
  cols: { text: string; width: number }[],
  y: number,
  isHeader = false,
): number {
  const ROW_H = 18;
  if (isHeader) doc.rect(MARGIN, y, COL, ROW_H).fill(C_PRIMARY);
  else doc.rect(MARGIN, y, COL, ROW_H).fillOpacity(0.03).fill(C_LIGHT_BG).fillOpacity(1);
  let x = MARGIN + 4;
  cols.forEach(({ text, width }) => {
    const color = isHeader ? "#ffffff" : C_TEXT;
    doc.font(isHeader ? "Helvetica-Bold" : "Helvetica").fontSize(7.5).fillColor(color)
      .text(text, x, y + 5, { width: width - 4, ellipsis: true });
    x += width;
  });
  doc.rect(MARGIN, y, COL, ROW_H).lineWidth(0.3).strokeColor(C_BORDER).stroke();
  return y + ROW_H;
}

// ── BLANK: MORTUARY INTAKE ────────────────────────────────────

export async function streamMortuaryIntakeBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Mortuary-Intake-Form-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "MORTUARY INTAKE FORM", "Complete in full. All starred fields (*) are required.");

  y = sectionHeader(doc, "1. Service Details", y);
  y = blankField(doc, "Intake Number *", MARGIN + 8, y, 200);
  y = blankField(doc, "Service Scope *  (circle one):  Full Service  /  Storage Only  /  Removal Only", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Partner Parlour (if Storage/Removal Only)", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "2. Deceased Details", y);
  const half = (COL - 16) / 2;
  y = blankField(doc, "Full Name *", MARGIN + 8, y, COL - 16);
  const row2y = y;
  blankField(doc, "Gender  (M / F / Other)", MARGIN + 8, y, half);
  y = blankField(doc, "Age", MARGIN + 8 + half + 8, row2y, half);
  const row3y = y;
  blankField(doc, "National ID / Passport", MARGIN + 8, y, half);
  y = blankField(doc, "Date of Death", MARGIN + 8 + half + 8, row3y, half);
  y = blankField(doc, "Cause of Death", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Place of Death", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "3. Storage Category & Fee (Partner Parlour Bodies Only)", y);
  const catY = y;
  blankCheck(doc, "Adult — USD 20.00", MARGIN + 8, catY, null);
  blankCheck(doc, "Child — USD 10.00", MARGIN + 8 + 200, catY, null);
  y = catY + 24;
  const payY = y;
  blankCheck(doc, "Paid at Admission", MARGIN + 8, payY, null);
  blankCheck(doc, "Pay on Collection", MARGIN + 8 + 200, payY, null);
  y = payY + 24;
  y = blankField(doc, "Received From (Name, if paid now)", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "4. Next of Kin / Informant", y);
  const nokY = y;
  blankField(doc, "Informant Full Name", MARGIN + 8, nokY, half);
  y = blankField(doc, "Phone", MARGIN + 8 + half + 8, nokY, half);
  y = blankField(doc, "Relationship to Deceased", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "5. Removal Details", y);
  y = blankField(doc, "Removal Location", MARGIN + 8, y, COL - 16);
  const remY = y;
  blankField(doc, "Date & Time of Removal", MARGIN + 8, y, half);
  y = blankField(doc, "Vehicle Registration", MARGIN + 8 + half + 8, remY, half);
  y = blankField(doc, "Driver Name", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "6. Mortuary Receipt", y);
  const recY = y;
  blankField(doc, "Received By (Staff Name)", MARGIN + 8, recY, half);
  y = blankField(doc, "Received At (Date & Time)", MARGIN + 8 + half + 8, recY, half);
  y = blankField(doc, "Receiver Printed Name", MARGIN + 8, y, half);
  blankField(doc, "Receiver ID Number", MARGIN + 8 + half + 8, y - 22, half);
  y = blankField(doc, "Notes", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "7. Sign-Off", y);
  y += 8;
  sigBlock(doc, "Received By (Mortuary Staff)", MARGIN, half - 8, y);
  sigBlock(doc, "Handed Over By (Informant / Referring Party)", MARGIN + half + 16, half - 8, y);
  y += 100;

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text("Mortuary Intake Form — For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}

// ── BLANK: MORTUARY DISPATCH ──────────────────────────────────

export async function streamMortuaryDispatchBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Mortuary-Dispatch-Form-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "MORTUARY DISPATCH / BODY RELEASE FORM", "No body may be released until this form is fully completed and signed.");

  y = sectionHeader(doc, "1. Deceased Details", y);
  const half = (COL - 16) / 2;
  y = blankField(doc, "Intake Number", MARGIN + 8, y, half);
  y = blankField(doc, "Deceased Full Name", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "2. Storage Fee (Partner Parlour Bodies)", y);
  y = blankField(doc, "Fee Amount", MARGIN + 8, y, half);
  y = blankField(doc, "Paid By (Name)", MARGIN + 8, y, half);
  y = blankField(doc, "Date Paid", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "3. Dispatch Details", y);
  y = blankField(doc, "Date & Time of Dispatch", MARGIN + 8, y, half);
  y = blankField(doc, "Destination", MARGIN + 8, y, COL - 16);
  y = blankCheck(doc, "Chapel & wash bay used (USD 20.00 fee — partner parlours)", MARGIN + 8, y, false);
  y = blankField(doc, "Chapel/Wash Bay Fee Paid By & Date", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "4. Collector Details", y);
  const colY = y;
  blankField(doc, "Collected By (Full Name) *", MARGIN + 8, colY, half);
  y = blankField(doc, "Collector ID Number", MARGIN + 8 + half + 8, colY, half);
  const colY2 = y;
  blankField(doc, "Collector Organisation", MARGIN + 8, colY2, half);
  y = blankField(doc, "Collector Printed Name", MARGIN + 8 + half + 8, colY2, half);
  y = blankField(doc, "Notes", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "5. Sign-Off", y);
  y += 8;
  sigBlock(doc, "Dispatched By (Mortuary Staff)", MARGIN, half - 8, y);
  sigBlock(doc, "Collected By (Receiving Party)", MARGIN + half + 16, half - 8, y);
  y += 100;

  const footerY = A4_H - MARGIN - 24;
  doc.moveTo(MARGIN, footerY).lineTo(A4_W - MARGIN, footerY).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED)
    .text("Mortuary Dispatch Form — For official use only", MARGIN, footerY + 6, { width: COL, align: "center" });
  doc.end();
}

// ── FORM 3: BELONGINGS REGISTER ───────────────────────────────

export async function streamBelongingsFormPDF(
  intakeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const intake = await storage.getMortuaryIntake(intakeId, orgId);
  if (!intake) { res.status(404).json({ message: "Mortuary intake not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const items = await storage.getDeceasedBelongings(intakeId, orgId);

  const filename = `Belongings-Register-${intake.intakeNumber}.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "DECEASED BELONGINGS REGISTER",
    `Intake No: ${intake.intakeNumber}  ·  Deceased: ${intake.deceasedName}  ·  Date: ${fmtDate(new Date())}`,
  );

  y = sectionHeader(doc, "Items Submitted With Deceased", y);
  const cols = [
    { text: "Item Description", width: 160 },
    { text: "Qty", width: 40 },
    { text: "Condition", width: 80 },
    { text: "Submitted By", width: 110 },
    { text: "Received By", width: 109 },
  ];
  y = tableRow(doc, cols, y, true);
  items.forEach((item) => {
    y = tableRow(doc, [
      { text: item.itemDescription, width: 160 },
      { text: String(item.quantity ?? 1), width: 40 },
      { text: "—", width: 80 },
      { text: item.submittedByName ?? "—", width: 110 },
      { text: "—", width: 109 },
    ], y);
  });
  // blank rows
  const blankCols = cols.map((c) => ({ text: "", width: c.width }));
  for (let i = 0; i < 6; i++) y = tableRow(doc, blankCols, y);
  y += 20;

  y = sectionHeader(doc, "Sign-Off", y);
  y += 8;
  const half = COL / 2 - 8;
  sigBlock(doc, "Submitter (Family / Referring Party)", MARGIN, half, y);
  sigBlock(doc, "Receiving Staff Member", MARGIN + half + 16, half, y);
  y += 100;

  const [sigBufBR, qrBufBR] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", intake.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Belongings Register", intake.intakeNumber, sigBufBR, qrBufBR);
  doc.end();
}

export async function streamBelongingsBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Deceased-Belongings-Register-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "DECEASED BELONGINGS REGISTER", "Complete for every body received. Each item must be signed for.");
  const half = (COL - 16) / 2;
  y = blankField(doc, "Intake Number", MARGIN + 8, y, half);
  y = blankField(doc, "Deceased Full Name", MARGIN + 8, y, COL - 16);
  y += 4;

  const cols = [
    { text: "Item Description", width: 160 },
    { text: "Qty", width: 40 },
    { text: "Condition", width: 80 },
    { text: "Submitted By", width: 110 },
    { text: "Received By", width: 109 },
  ];
  y = tableRow(doc, cols, y, true);
  const empty = cols.map((c) => ({ text: "", width: c.width }));
  for (let i = 0; i < 12; i++) y = tableRow(doc, empty, y);
  y += 16;

  y = sectionHeader(doc, "Sign-Off", y);
  y += 8;
  sigBlock(doc, "Submitter", MARGIN, (COL - 16) / 2, y);
  sigBlock(doc, "Receiving Staff Member", MARGIN + (COL - 16) / 2 + 16, (COL - 16) / 2, y);
  doc.end();
}

// ── FORM 4: BODY WASH REQUIREMENTS ───────────────────────────

export async function streamBodyWashFormPDF(
  intakeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const intake = await storage.getMortuaryIntake(intakeId, orgId);
  if (!intake) { res.status(404).json({ message: "Mortuary intake not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const bw = await storage.getBodyWashRequirements(intakeId, orgId);

  const filename = `Body-Wash-${intake.intakeNumber}.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "BODY WASH REQUIREMENTS FORM",
    `Intake No: ${intake.intakeNumber}  ·  Deceased: ${intake.deceasedName}`,
  );

  y = sectionHeader(doc, "1. Intake Reference", y);
  y = infoRow(doc, "Intake Number:", fmt(intake.intakeNumber), y);
  y = infoRow(doc, "Deceased Name:", fmt(intake.deceasedName), y);
  y += 8;

  y = sectionHeader(doc, "2. Items Provided", y);
  y += 6;
  y = blankCheck(doc, "Clothes Provided", MARGIN + 8, y, bw?.clothesProvided);
  y = blankCheck(doc, "Blanket Provided", MARGIN + 8, y, bw?.blanketProvided);
  y = blankCheck(doc, "Wreath Provided", MARGIN + 8, y, bw?.wreathProvided);
  y += 4;
  y = infoRow(doc, "Other Items:", bw?.otherItems ? fmt(bw.otherItems) : "—", y);
  y += 8;

  y = sectionHeader(doc, "3. Wash Record", y);
  y = infoRow(doc, "Washed By (Name):", bw?.washedByName ? fmt(bw.washedByName) : "—", y);
  y = infoRow(doc, "Completed At:", bw?.completedAt ? fmtDateTime(bw.completedAt) : "—", y);
  y += 16;

  y = sectionHeader(doc, "4. Sign-Off", y);
  y += 8;
  const half = COL / 2 - 8;
  sigBlock(doc, "Completed By (Staff)", MARGIN, half, y);
  sigBlock(doc, "Date", MARGIN + half + 16, half, y);
  y += 100;

  const [sigBufBW, qrBufBW] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", intake.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Body Wash Requirements", intake.intakeNumber, sigBufBW, qrBufBW);
  doc.end();
}

export async function streamBodyWashBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Body-Wash-Form-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "BODY WASH REQUIREMENTS FORM", "Complete and retain for each body washed.");
  const half = (COL - 16) / 2;
  y = blankField(doc, "Intake Number", MARGIN + 8, y, half);
  y = blankField(doc, "Deceased Full Name", MARGIN + 8, y, COL - 16);
  y += 4;
  y = sectionHeader(doc, "Items Provided", y); y += 6;
  y = blankCheck(doc, "Clothes Provided", MARGIN + 8, y, null);
  y = blankCheck(doc, "Blanket Provided", MARGIN + 8, y, null);
  y = blankCheck(doc, "Wreath Provided", MARGIN + 8, y, null);
  y += 4;
  y = blankField(doc, "Other Items", MARGIN + 8, y, COL - 16);
  y += 4;
  y = sectionHeader(doc, "Wash Record", y);
  const washY = y;
  blankField(doc, "Washed By (Name)", MARGIN + 8, washY, half);
  y = blankField(doc, "Completed At (Date & Time)", MARGIN + 8 + half + 8, washY, half);
  y += 8;
  y = sectionHeader(doc, "Sign-Off", y); y += 8;
  sigBlock(doc, "Completed By (Staff)", MARGIN, half, y);
  sigBlock(doc, "Date", MARGIN + half + 16, half, y);
  doc.end();
}

// ── BLANK: DRIVER CHECKLIST ───────────────────────────────────

export async function streamDriverChecklistBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Driver-Checklist-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "DRIVER CHECKLIST", "Complete before departure for each funeral. Driver must sign.");
  const half = (COL - 16) / 2;
  y = blankField(doc, "Funeral Case Number", MARGIN + 8, y, half);
  y = blankField(doc, "Driver Name", MARGIN + 8, y, half);
  const dateY = y;
  blankField(doc, "Date", MARGIN + 8, dateY, half);
  y = blankField(doc, "Prepared By", MARGIN + 8 + half + 8, dateY, half);
  y += 4;
  y = sectionHeader(doc, "Equipment Checklist", y); y += 6;
  const items = ["Grave Tent", "Lowering Device", "Gloves", "Masks", "Fire Extinguisher", "First Aid Kit"];
  items.forEach((item) => { y = blankCheck(doc, item, MARGIN + 8, y, null); });
  y += 4;
  y = sectionHeader(doc, "Vehicle & Fuel", y);
  y = blankField(doc, "Fuel Level  (circle):  Full  /  ¾  /  ½  /  ¼  /  Empty", MARGIN + 8, y, COL - 16);
  y = blankCheck(doc, "Toll Gate Required", MARGIN + 8, y, null);
  const moneyY = y;
  blankField(doc, "Toll Gate Amount (USD)", MARGIN + 8, moneyY, half);
  y = blankField(doc, "Driver Allowance (USD)", MARGIN + 8 + half + 8, moneyY, half);
  y = blankField(doc, "Burial Order Ref", MARGIN + 8, y, half);
  y = blankField(doc, "Completed At (Date & Time)", MARGIN + 8, y, half);
  y += 8;
  y = sectionHeader(doc, "Sign-Off", y); y += 8;
  sigBlock(doc, "Driver Signature", MARGIN, half, y);
  sigBlock(doc, "Prepared By Signature", MARGIN + half + 16, half, y);
  doc.end();
}

// ── FORM 6: FUNERAL CASE WORKSHEET ───────────────────────────

export async function streamFuneralCaseWorksheetPDF(
  caseId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const fc = await storage.getFuneralCase(caseId, orgId);
  if (!fc) { res.status(404).json({ message: "Funeral case not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const userIds = [fc.removalDriverId, fc.burialDriverId, fc.attendingAgentId, fc.assignedTo]
    .filter((id): id is string => !!id);
  const usersMap: Record<string, string> = {};
  await Promise.all(Array.from(new Set(userIds)).map(async (id) => {
    const u = await storage.getUser(id);
    if (u) usersMap[id] = u.displayName || u.email;
  }));
  const vehicleIds = [fc.removalVehicleId, fc.burialVehicleId].filter((id): id is string => !!id);
  const vehiclesMap: Record<string, string> = {};
  await Promise.all(Array.from(new Set(vehicleIds)).map(async (id) => {
    const v = await storage.getFleetVehicleById(id, orgId);
    if (v) vehiclesMap[id] = `${v.registration}${v.make ? ` (${v.make})` : ""}`;
  }));

  const filename = `Case-Worksheet-${fc.caseNumber}.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "FUNERAL CASE WORKSHEET",
    `Case No: ${fc.caseNumber}  ·  Generated: ${fmtDate(new Date())}`,
  );

  y = sectionHeader(doc, "1. Deceased Details", y);
  y = infoRow(doc, "Full Name:", fmt(fc.deceasedName), y);
  y = infoRow(doc, "Date of Birth:", fmtDate(fc.deceasedDob), y);
  y = infoRow(doc, "Gender:", fmt(fc.deceasedGender), y);
  y = infoRow(doc, "National ID:", fmt(fc.deceasedNationalId), y);
  y = infoRow(doc, "Date of Death:", fmtDate(fc.dateOfDeath), y);
  y = infoRow(doc, "Cause of Death:", fmt(fc.causeOfDeath), y);
  y = infoRow(doc, "Place of Death:", fmt(fc.placeOfDeath), y);
  if (fc.deceasedRelationship) y = infoRow(doc, "Relationship to Policyholder:", fmt(fc.deceasedRelationship), y);
  y += 8;

  y = sectionHeader(doc, "2. Service & Informant", y);
  y = infoRow(doc, "Service Type:", fc.serviceType === "claim" ? "Policy Claim" : fc.serviceType === "cash" ? "Cash Service" : "—", y);
  y = infoRow(doc, "Informant Name:", fmt(fc.informantName), y);
  y = infoRow(doc, "Informant Phone:", fmt(fc.informantPhone), y);
  y = infoRow(doc, "Relationship:", fmt(fc.informantRelationship), y);
  y += 8;

  y = sectionHeader(doc, "3. Funeral Logistics", y);
  y = infoRow(doc, "Funeral Date:", fmtDate(fc.funeralDate), y);
  y = infoRow(doc, "Funeral Location:", fmt(fc.funeralLocation), y);
  y = infoRow(doc, "Removal Location:", fmt(fc.removalLocation), y);
  y = infoRow(doc, "Removal Driver:", fc.removalDriverId ? usersMap[fc.removalDriverId] ?? "—" : "—", y);
  y = infoRow(doc, "Removal Vehicle:", fc.removalVehicleId ? vehiclesMap[fc.removalVehicleId] ?? "—" : "—", y);
  y = infoRow(doc, "Burial Driver:", fc.burialDriverId ? usersMap[fc.burialDriverId] ?? "—" : "—", y);
  y = infoRow(doc, "Burial Vehicle:", fc.burialVehicleId ? vehiclesMap[fc.burialVehicleId] ?? "—" : "—", y);
  y = infoRow(doc, "Attending Agent:", fc.attendingAgentId ? usersMap[fc.attendingAgentId] ?? "—" : "—", y);
  y += 8;

  y = sectionHeader(doc, "4. Timing", y);
  y = infoRow(doc, "Body Wash Time:", fmtDateTime(fc.bodyWashTime), y);
  y = infoRow(doc, "Burial Departure Time:", fmtDateTime(fc.burialDepartureTime), y);
  y = infoRow(doc, "Memorial Service Start:", fmtDateTime(fc.memorialServiceStart), y);
  y = infoRow(doc, "Memorial Service End:", fmtDateTime(fc.memorialServiceEnd), y);
  y += 8;

  y = sectionHeader(doc, "5. Body Identification", y);
  y = infoRow(doc, "Identifier Name:", fmt(fc.bodyIdentifierName), y);
  y = infoRow(doc, "Identifier ID Number:", fmt(fc.bodyIdentifierIdNumber), y);
  y += 8;

  y = sectionHeader(doc, "6. References", y);
  if ((fc as any).policyId) y = infoRow(doc, "Policy #:", fmt((fc as any).policyId), y);
  if ((fc as any).claimId) y = infoRow(doc, "Claim #:", fmt((fc as any).claimId), y);
  if (fc.notes) y = infoRow(doc, "Notes:", fmt(fc.notes), y);
  y += 16;

  y = sectionHeader(doc, "7. Sign-Off", y);
  y += 8;
  const half = COL / 2 - 8;
  sigBlock(doc, "Case Officer Signature", MARGIN, half, y);
  sigBlock(doc, "Date", MARGIN + half + 16, half, y);

  const [sigBufFC, qrBufFC] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", fc.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Funeral Case Worksheet", fc.caseNumber, sigBufFC, qrBufFC);
  doc.end();
}

export async function streamFuneralCaseWorksheetBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Funeral-Case-Worksheet-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "FUNERAL CASE WORKSHEET", "Complete for each new funeral case.");
  const half = (COL - 16) / 2;

  y = sectionHeader(doc, "1. Deceased Details", y);
  y = blankField(doc, "Case Number *", MARGIN + 8, y, half);
  y = blankField(doc, "Full Name *", MARGIN + 8, y, COL - 16);
  const r1 = y; blankField(doc, "Date of Birth", MARGIN + 8, r1, half); y = blankField(doc, "Gender  (M / F)", MARGIN + 8 + half + 8, r1, half);
  const r2 = y; blankField(doc, "National ID / Passport", MARGIN + 8, r2, half); y = blankField(doc, "Date of Death", MARGIN + 8 + half + 8, r2, half);
  y = blankField(doc, "Cause of Death", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Place of Death", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "2. Service & Informant", y);
  y = blankField(doc, "Service Type  (circle):  Policy Claim  /  Cash Service", MARGIN + 8, y, COL - 16);
  const r3 = y; blankField(doc, "Informant Name", MARGIN + 8, r3, half); y = blankField(doc, "Informant Phone", MARGIN + 8 + half + 8, r3, half);
  y = blankField(doc, "Relationship to Deceased", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "3. Logistics", y);
  y = blankField(doc, "Funeral Date", MARGIN + 8, y, half);
  y = blankField(doc, "Funeral Location", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Removal Location", MARGIN + 8, y, COL - 16);
  const r4 = y; blankField(doc, "Removal Driver", MARGIN + 8, r4, half); y = blankField(doc, "Removal Vehicle", MARGIN + 8 + half + 8, r4, half);
  const r5 = y; blankField(doc, "Burial Driver", MARGIN + 8, r5, half); y = blankField(doc, "Burial Vehicle", MARGIN + 8 + half + 8, r5, half);
  y = blankField(doc, "Attending Agent", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "4. Timing", y);
  const r6 = y; blankField(doc, "Body Wash Time", MARGIN + 8, r6, half); y = blankField(doc, "Burial Departure Time", MARGIN + 8 + half + 8, r6, half);
  const r7 = y; blankField(doc, "Memorial Start", MARGIN + 8, r7, half); y = blankField(doc, "Memorial End", MARGIN + 8 + half + 8, r7, half);
  y += 4;

  y = sectionHeader(doc, "5. Body ID & Notes", y);
  const r8 = y; blankField(doc, "Identified By (Name)", MARGIN + 8, r8, half); y = blankField(doc, "Identifier ID Number", MARGIN + 8 + half + 8, r8, half);
  y = blankField(doc, "Notes", MARGIN + 8, y, COL - 16);
  y += 8;

  y = sectionHeader(doc, "6. Sign-Off", y); y += 8;
  sigBlock(doc, "Case Officer", MARGIN, half, y);
  sigBlock(doc, "Date", MARGIN + half + 16, half, y);
  doc.end();
}

// ── FORM 7: FUNERAL TASK SHEET ────────────────────────────────

export async function streamFuneralTaskSheetPDF(
  caseId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const fc = await storage.getFuneralCase(caseId, orgId);
  if (!fc) { res.status(404).json({ message: "Funeral case not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const tasks = await storage.getFuneralTasks(caseId, orgId);

  const userIds = tasks.map((t) => t.assignedTo).filter((id): id is string => !!id);
  const usersMap: Record<string, string> = {};
  await Promise.all(Array.from(new Set(userIds)).map(async (id) => {
    const u = await storage.getUser(id);
    if (u) usersMap[id] = u.displayName || u.email;
  }));

  const filename = `Task-Sheet-${fc.caseNumber}.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "FUNERAL TASK SHEET",
    `Case No: ${fc.caseNumber}  ·  Deceased: ${fc.deceasedName}  ·  Generated: ${fmtDate(new Date())}`,
  );

  const cols = [
    { text: "Task Name", width: 130 },
    { text: "Assigned To", width: 100 },
    { text: "Due Date", width: 75 },
    { text: "Status", width: 65 },
    { text: "Completed At", width: 75 },
    { text: "Notes", width: 54 },
  ];
  y = tableRow(doc, cols, y, true);
  tasks.forEach((t) => {
    y = tableRow(doc, [
      { text: t.taskName, width: 130 },
      { text: t.assignedTo ? usersMap[t.assignedTo] ?? "—" : "—", width: 100 },
      { text: t.dueDate ? fmtDate(t.dueDate) : "—", width: 75 },
      { text: t.status.replace(/_/g, " "), width: 65 },
      { text: t.completedAt ? fmtDate(t.completedAt) : "—", width: 75 },
      { text: "—", width: 54 },
    ], y);
  });
  const blank = cols.map((c) => ({ text: "", width: c.width }));
  for (let i = 0; i < 5; i++) y = tableRow(doc, blank, y);
  y += 16;

  const half = COL / 2 - 8;
  y = sectionHeader(doc, "Sign-Off", y); y += 8;
  sigBlock(doc, "Case Officer", MARGIN, half, y);
  sigBlock(doc, "Date", MARGIN + half + 16, half, y);

  const [sigBufFT, qrBufFT] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", fc.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Funeral Task Sheet", fc.caseNumber, sigBufFT, qrBufFT);
  doc.end();
}

// ── FORM 8: PARTNER PARLOUR STORAGE RECEIPT ──────────────────

export async function streamStorageReceiptPDF(
  intakeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean },
): Promise<void> {
  const intake = await storage.getMortuaryIntake(intakeId, orgId);
  if (!intake) { res.status(404).json({ message: "Mortuary intake not found" }); return; }
  if (!intake.partnerParlourId) { res.status(400).json({ message: "Not a partner parlour intake" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const parlours = await storage.getPartnerParlours(orgId);
  const parlour = parlours.find((p) => p.id === intake.partnerParlourId);

  const filename = `Storage-Receipt-${intake.intakeNumber}.pdf`;
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);
  res.setHeader("Content-Type", "application/pdf");

  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(
    doc,
    { name: org.name, phone: org.phone, email: org.email, address: org.address, logoUrl: org.logoUrl },
    "MORTUARY STORAGE RECEIPT",
    `Receipt No: ${intake.intakeNumber}  ·  Date: ${fmtDate(intake.storageFeePaidAt ?? new Date())}`,
  );

  y = sectionHeader(doc, "Partner Parlour Details", y);
  y = infoRow(doc, "Parlour Name:", fmt(parlour?.name ?? intake.clientOrganizationName), y);
  if (parlour?.phone) y = infoRow(doc, "Phone:", fmt(parlour.phone), y);
  if (parlour?.contactPerson) y = infoRow(doc, "Contact Person:", fmt(parlour.contactPerson), y);
  y += 8;

  y = sectionHeader(doc, "Deceased Details", y);
  y = infoRow(doc, "Deceased Name:", fmt(intake.deceasedName), y);
  y = infoRow(doc, "Intake Number:", fmt(intake.intakeNumber), y);
  y = infoRow(doc, "Received At:", fmtDateTime(intake.receivedAt), y);
  y += 8;

  y = sectionHeader(doc, "Storage Fee", y);
  y += 6;
  // Category checkboxes
  blankCheck(doc, "Adult — USD 20.00", MARGIN + 8, y, intake.storageCategory === "adult");
  blankCheck(doc, "Child — USD 10.00", MARGIN + 8 + 200, y, intake.storageCategory === "child");
  y += 24;

  // Large fee display
  const feeAmt = intake.storageFeeAmount ? `USD ${parseFloat(String(intake.storageFeeAmount)).toFixed(2)}` : "USD —";
  doc.rect(MARGIN, y, COL, 36).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(20).fillColor(C_PRIMARY)
    .text(feeAmt, MARGIN, y + 8, { width: COL, align: "center" });
  doc.fillColor(C_TEXT);
  y += 44;

  y = infoRow(doc, "Payment Status:", intake.storageFeeStatus === "paid_at_admission" ? "PAID AT ADMISSION" : intake.storageFeeStatus === "paid_at_collection" ? "PAID AT COLLECTION" : "UNPAID", y);
  if (intake.storageFeePaidBy) y = infoRow(doc, "Received From:", fmt(intake.storageFeePaidBy), y);
  if (intake.storageFeePaidAt) y = infoRow(doc, "Date Paid:", fmtDateTime(intake.storageFeePaidAt), y);
  y += 16;

  y = sectionHeader(doc, "Sign-Off", y); y += 8;
  const third = (COL - 16) / 3;
  sigBlock(doc, "Cashier Signature", MARGIN, third, y);
  sigBlock(doc, "Payer Signature", MARGIN + third + 8, third, y);
  sigBlock(doc, "Date", MARGIN + (third + 8) * 2, third, y);
  y += 100;

  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
    .text("RECEIVED WITH THANKS", MARGIN, y, { width: COL, align: "center" });

  const [sigBufSR, qrBufSR] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", intake.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Storage Receipt", intake.intakeNumber, sigBufSR, qrBufSR);
  doc.end();
}

export async function streamStorageReceiptBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Storage-Receipt-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "MORTUARY STORAGE RECEIPT", "Issue to partner parlour on payment of storage fee.");
  const half = (COL - 16) / 2;
  const third = (COL - 16) / 3;
  y = blankField(doc, "Receipt No", MARGIN + 8, y, half);
  y = blankField(doc, "Parlour Name", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Contact Person / Phone", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Deceased Name", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Intake Number", MARGIN + 8, y, half);
  y = blankField(doc, "Received At", MARGIN + 8, y, half);
  y += 4;
  const catY = y;
  blankCheck(doc, "Adult — USD 20.00", MARGIN + 8, catY, null);
  blankCheck(doc, "Child — USD 10.00", MARGIN + 8 + 200, catY, null);
  y = catY + 26;
  y = blankField(doc, "Amount Paid  USD", MARGIN + 8, y, half);
  y = blankField(doc, "Received From (Name)", MARGIN + 8, y, COL - 16);
  y = blankField(doc, "Payment Method  (Cash / EcoCash / Card)", MARGIN + 8, y, COL - 16);
  y += 8;
  sigBlock(doc, "Cashier", MARGIN, third, y);
  sigBlock(doc, "Payer", MARGIN + third + 8, third, y);
  sigBlock(doc, "Date", MARGIN + (third + 8) * 2, third, y);
  y += 100;
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
    .text("RECEIVED WITH THANKS", MARGIN, y, { width: COL, align: "center" });
  doc.end();
}

// ── BLANK: FUNERAL QUOTATION ──────────────────────────────────

export async function streamFuneralQuotationBlankPDF(orgId: string, res: Response): Promise<void> {
  res.setHeader("Content-Disposition", 'attachment; filename="Funeral-Quotation-BLANK.pdf"');
  res.setHeader("Content-Type", "application/pdf");
  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  doc.pipe(res);
  let y = await buildLetterheadHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "FUNERAL QUOTATION / SERVICE AGREEMENT", "Obtain client signature to confirm acceptance of quoted services.");
  const half = (COL - 16) / 2;

  const r0 = y; blankField(doc, "Quotation Number", MARGIN + 8, r0, half); y = blankField(doc, "Date", MARGIN + 8 + half + 8, r0, half);
  y = blankField(doc, "Prepared By", MARGIN + 8, y, half);
  y += 4;

  y = sectionHeader(doc, "Informant / Client", y);
  y = blankField(doc, "Informant Full Name", MARGIN + 8, y, COL - 16);
  const r1 = y; blankField(doc, "Phone", MARGIN + 8, r1, half); y = blankField(doc, "Address", MARGIN + 8 + half + 8, r1, half);
  y += 4;

  y = sectionHeader(doc, "Deceased", y);
  const r2 = y; blankField(doc, "Deceased Full Name", MARGIN + 8, r2, half); blankField(doc, "Age", MARGIN + 8 + half + 8, r2, half - 60);
  y = blankField(doc, "Sex  (M / F)", MARGIN + 8 + half + 8 + half - 52, r2, 52);
  y = blankField(doc, "Casket Type", MARGIN + 8, y, COL - 16);
  y += 4;

  y = sectionHeader(doc, "Services Quoted", y);
  const lineCols = [
    { text: "Description", width: 250 },
    { text: "Qty", width: 40 },
    { text: "Unit Price", width: 80 },
    { text: "Total", width: 129 },
  ];
  y = tableRow(doc, lineCols, y, true);
  const emptyLine = lineCols.map((c) => ({ text: "", width: c.width }));
  for (let i = 0; i < 10; i++) y = tableRow(doc, emptyLine, y);
  y += 4;
  y = blankField(doc, "Subtotal", A4_W - MARGIN - 250, y, 250 - 8);
  y = blankField(doc, "VAT (%)", A4_W - MARGIN - 250, y, 250 - 8);
  y = blankField(doc, "Discount", A4_W - MARGIN - 250, y, 250 - 8);

  doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT)
    .text("GRAND TOTAL:", A4_W - MARGIN - 250, y, { width: 120 });
  doc.moveTo(A4_W - MARGIN - 120, y + 12).lineTo(A4_W - MARGIN - 8, y + 12).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 24;

  y = sectionHeader(doc, "Guarantor", y);
  const r3 = y; blankField(doc, "Guarantor Name", MARGIN + 8, r3, half); y = blankField(doc, "Phone", MARGIN + 8 + half + 8, r3, half);
  const r4 = y; blankField(doc, "Address", MARGIN + 8, r4, half); y = blankField(doc, "National ID", MARGIN + 8 + half + 8, r4, half);
  y += 4;

  y = sectionHeader(doc, "Collateral", y);
  const collCols = [
    { text: "Item Description", width: 160 },
    { text: "Condition", width: 80 },
    { text: "Value", width: 80 },
    { text: "Due Date", width: 80 },
    { text: "Forfeiture Date", width: 99 },
  ];
  y = tableRow(doc, collCols, y, true);
  const emptyCollRow = collCols.map((c) => ({ text: "", width: c.width }));
  for (let i = 0; i < 3; i++) y = tableRow(doc, emptyCollRow, y);
  y += 8;

  const third = (COL - 16) / 3;
  sigBlock(doc, "Prepared By", MARGIN, third, y);
  sigBlock(doc, "Client / Informant Acceptance", MARGIN + third + 8, third, y);
  sigBlock(doc, "Guarantor", MARGIN + (third + 8) * 2, third, y);
  doc.end();
}
