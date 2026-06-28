import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildVerifyUrl, buildVerifyQrBuffer, drawDocumentFooter, A4_W, A4_H, MARGIN, COL, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER } from "./pdf-utils";

// ── Helpers ───────────────────────────────────────────────────

function fmt(v: string | number | null | undefined): string {
  return v != null && String(v).trim() ? String(v).trim() : "—";
}

function fmtDate(v: string | Date | null | undefined): string {
  if (!v) return "—";
  try { return new Date(v).toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" }); }
  catch { return String(v); }
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
    .text(org.name || "Organisation", MARGIN + 130, y, { width: COL - 130, align: "right" });
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

function blankLine(doc: InstanceType<typeof PDFDocument>, label: string, y: number, lineWidth = COL - 168): number {
  const lw = 160;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: lw });
  doc.moveTo(MARGIN + lw + 8, y + 10).lineTo(MARGIN + lw + 8 + lineWidth, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  return y + 18;
}

function sigBlock(doc: InstanceType<typeof PDFDocument>, label: string, xStart: number, width: number, y: number): void {
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED).text(label, xStart, y, { width });
  doc.moveTo(xStart, y + 30).lineTo(xStart + width, y + 30).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Signature", xStart, y + 33, { width });
  doc.moveTo(xStart, y + 55).lineTo(xStart + width, y + 55).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("Printed Name & Date", xStart, y + 58, { width });
}

function footer(
  doc: InstanceType<typeof PDFDocument>,
  orgName: string | null,
  docType: string,
  refNo: string,
  signatureBuffer: Buffer | null = null,
  qrBuffer: Buffer | null = null,
): void {
  const footerTop = A4_H - MARGIN - 115;
  drawDocumentFooter(
    doc,
    signatureBuffer,
    qrBuffer,
    orgName || "POL263",
    `${orgName || "POL263"} — ${docType} · Ref: ${refNo} · For official use only`,
    footerTop,
  );
}

function checkboxRow(doc: InstanceType<typeof PDFDocument>, label: string, checked: boolean | null | undefined, y: number): number {
  const size = 8;
  doc.rect(MARGIN + 8, y, size, size).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  if (checked) {
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_PRIMARY)
      .text("✓", MARGIN + 9, y + 0.5, { width: size });
  }
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(label, MARGIN + 22, y, { width: COL - 22 });
  return y + 14;
}

// ── FORM 20: ATTENDANCE LOG ───────────────────────────────────

export async function streamAttendanceLogPDF(
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean; dateFrom?: string; dateTo?: string }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logs = await storage.getAttendanceLogs(orgId, {
    dateFrom: opts?.dateFrom,
    dateTo: opts?.dateTo,
  } as any);

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `attendance-log-${new Date().toISOString().slice(0, 10)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Attendance Log", `Period: ${opts?.dateFrom || "All"} – ${opts?.dateTo || "All"}`);

  y = sectionHeader(doc, "Attendance Records", y);

  // Table header
  const cols = { date: MARGIN, name: MARGIN + 70, clockIn: MARGIN + 260, clockOut: MARGIN + 340, status: MARGIN + 420, hrs: MARGIN + 480 };
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  doc.text("Date", cols.date, y, { width: 70 });
  doc.text("Employee", cols.name, y, { width: 180 });
  doc.text("Clock In", cols.clockIn, y, { width: 80 });
  doc.text("Clock Out", cols.clockOut, y, { width: 80 });
  doc.text("Status", cols.status, y, { width: 60 });
  y += 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (const log of logs as any[]) {
    if (y > A4_H - MARGIN - 60) { doc.addPage(); y = MARGIN + 20; }
    doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT);
    doc.text(fmtDate(log.logDate || log.date), cols.date, y, { width: 70 });
    const empName = log.employee ? `${log.employee.firstName || ""} ${log.employee.lastName || ""}`.trim() : "—";
    doc.text(empName, cols.name, y, { width: 180 });
    doc.text(fmt(log.clockIn), cols.clockIn, y, { width: 80 });
    doc.text(fmt(log.clockOut), cols.clockOut, y, { width: 80 });
    doc.text(fmt(log.status), cols.status, y, { width: 60 });
    y += 12;
  }

  if (logs.length === 0) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("No attendance records found for the selected period.", MARGIN, y);
    y += 20;
  }

  y += 20;
  sigBlock(doc, "Prepared by (HR / Manager)", MARGIN, 220, y);
  sigBlock(doc, "Approved by", MARGIN + 270, 220, y);

  const [sigBufAtt, qrBufAtt] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", `att-${orgId}-${new Date().getFullYear()}`); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Attendance Log", `ATT-${new Date().getFullYear()}`, sigBufAtt, qrBufAtt);
  doc.end();
}

// ── FORM 20 BLANK ─────────────────────────────────────────────

export async function streamAttendanceLogBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="attendance-log-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Attendance Log", "Month / Period: ______________________");

  y = sectionHeader(doc, "Attendance Records", y);

  const cols = { date: MARGIN, name: MARGIN + 70, clockIn: MARGIN + 260, clockOut: MARGIN + 340, status: MARGIN + 420, sig: MARGIN + 480 };
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  doc.text("Date", cols.date, y, { width: 70 });
  doc.text("Employee Name", cols.name, y, { width: 180 });
  doc.text("Clock In", cols.clockIn, y, { width: 80 });
  doc.text("Clock Out", cols.clockOut, y, { width: 80 });
  doc.text("Status", cols.status, y, { width: 60 });
  doc.text("Initials", cols.sig, y, { width: 50 });
  y += 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (let i = 0; i < 20; i++) {
    doc.moveTo(MARGIN, y + 11).lineTo(A4_W - MARGIN, y + 11).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 14;
  }

  y += 20;
  sigBlock(doc, "Prepared by", MARGIN, 220, y);
  sigBlock(doc, "Approved by", MARGIN + 270, 220, y);

  footer(doc, org.name, "Attendance Log", "BLANK");
  doc.end();
}

// ── FORM 21: EMPLOYEE ENROLLMENT FORM ────────────────────────

export async function streamEmployeeEnrollmentPDF(
  employeeId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const employees = await storage.getPayrollEmployees(orgId);
  const emp = employees.find((e) => e.id === employeeId) as any;
  if (!emp) { res.status(404).json({ message: "Employee not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `employee-enrollment-${emp.employeeNumber || employeeId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Employee Enrollment Form", `Ref: ${emp.employeeNumber || employeeId}`);

  y = sectionHeader(doc, "Personal Details", y);
  y = infoRow(doc, "Full Name", `${emp.firstName || ""} ${emp.lastName || ""}`.trim(), y);
  y = infoRow(doc, "National ID", fmt(emp.nationalId), y);
  y = infoRow(doc, "Date of Birth", fmtDate(emp.dateOfBirth), y);
  y = infoRow(doc, "Gender", fmt(emp.gender), y);
  y = infoRow(doc, "Phone", fmt(emp.phone), y);
  y = infoRow(doc, "Email", fmt(emp.email), y);
  y = infoRow(doc, "Address", fmt(emp.address), y);
  y += 6;

  y = sectionHeader(doc, "Employment Details", y);
  y = infoRow(doc, "Employee Number", fmt(emp.employeeNumber), y);
  y = infoRow(doc, "Job Title", fmt(emp.jobTitle), y);
  y = infoRow(doc, "Department", fmt(emp.department), y);
  y = infoRow(doc, "Employment Type", fmt(emp.employmentType), y);
  y = infoRow(doc, "Start Date", fmtDate(emp.startDate), y);
  y = infoRow(doc, "Base Salary", emp.baseSalary ? `${emp.currency || "USD"} ${emp.baseSalary}` : "—", y);
  y += 6;

  y = sectionHeader(doc, "Bank Details", y);
  y = infoRow(doc, "Bank Name", fmt(emp.bankName), y);
  y = infoRow(doc, "Account Number", fmt(emp.bankAccountNumber), y);
  y += 6;

  y = sectionHeader(doc, "Emergency Contact", y);
  y = infoRow(doc, "Name", fmt(emp.emergencyContactName), y);
  y = infoRow(doc, "Phone", fmt(emp.emergencyContactPhone), y);
  y = infoRow(doc, "Relationship", fmt(emp.emergencyContactRelation), y);
  y += 30;

  sigBlock(doc, "Employee Signature", MARGIN, 220, y);
  sigBlock(doc, "HR Officer", MARGIN + 270, 220, y);

  const [sigBufEmp, qrBufEmp] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", employeeId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Employee Enrollment Form", emp.employeeNumber || employeeId, sigBufEmp, qrBufEmp);
  doc.end();
}

// ── FORM 21 BLANK ─────────────────────────────────────────────

export async function streamEmployeeEnrollmentBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="employee-enrollment-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Employee Enrollment Form", "New Employee Registration");

  y = sectionHeader(doc, "Personal Details", y);
  y = blankLine(doc, "Full Name", y);
  y = blankLine(doc, "National ID", y);
  y = blankLine(doc, "Date of Birth", y);
  y = blankLine(doc, "Gender", y);
  y = blankLine(doc, "Phone Number", y);
  y = blankLine(doc, "Email", y);
  y = blankLine(doc, "Home Address", y);
  y += 6;

  y = sectionHeader(doc, "Employment Details", y);
  y = blankLine(doc, "Employee Number", y);
  y = blankLine(doc, "Job Title", y);
  y = blankLine(doc, "Department", y);
  y = blankLine(doc, "Employment Type", y);
  y = blankLine(doc, "Start Date", y);
  y = blankLine(doc, "Base Salary (USD)", y);
  y += 6;

  y = sectionHeader(doc, "Bank Details", y);
  y = blankLine(doc, "Bank Name", y);
  y = blankLine(doc, "Account Number", y);
  y += 6;

  y = sectionHeader(doc, "Emergency Contact", y);
  y = blankLine(doc, "Name", y);
  y = blankLine(doc, "Phone", y);
  y = blankLine(doc, "Relationship", y);
  y += 30;

  sigBlock(doc, "Employee Signature", MARGIN, 220, y);
  sigBlock(doc, "HR Officer", MARGIN + 270, 220, y);

  footer(doc, org.name, "Employee Enrollment Form", "BLANK");
  doc.end();
}

// ── FORM 22: PAYSLIP BLANK ────────────────────────────────────

export async function streamPayslipBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="payslip-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Employee Payslip", "Pay Period: ______________________");

  y = sectionHeader(doc, "Employee Information", y);
  y = blankLine(doc, "Employee Name", y);
  y = blankLine(doc, "Employee Number", y);
  y = blankLine(doc, "Job Title / Department", y);
  y = blankLine(doc, "Pay Period", y);
  y = blankLine(doc, "Days Worked", y);
  y += 6;

  y = sectionHeader(doc, "Earnings", y);
  y = blankLine(doc, "Basic Salary", y);
  y = blankLine(doc, "Housing Allowance", y);
  y = blankLine(doc, "Transport Allowance", y);
  y = blankLine(doc, "Other Allowances", y);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_TEXT)
    .text("GROSS PAY:", MARGIN + 8, y, { width: 160 });
  doc.moveTo(MARGIN + 168, y + 10).lineTo(A4_W - MARGIN, y + 10).lineWidth(0.8).strokeColor(C_TEXT).stroke();
  y += 18;
  y += 6;

  y = sectionHeader(doc, "Deductions", y);
  y = blankLine(doc, "NSSA", y);
  y = blankLine(doc, "PAYE", y);
  y = blankLine(doc, "AIDS Levy", y);
  y = blankLine(doc, "Funeral Policy", y);
  y = blankLine(doc, "Other", y);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_TEXT)
    .text("TOTAL DEDUCTIONS:", MARGIN + 8, y, { width: 160 });
  doc.moveTo(MARGIN + 168, y + 10).lineTo(A4_W - MARGIN, y + 10).lineWidth(0.8).strokeColor(C_TEXT).stroke();
  y += 18;

  doc.rect(MARGIN, y + 6, COL, 22).fill("#ecfdf5");
  doc.font("Helvetica-Bold").fontSize(11).fillColor(C_PRIMARY)
    .text("NET PAY:", MARGIN + 8, y + 10, { width: 160 });
  doc.moveTo(MARGIN + 168, y + 16).lineTo(A4_W - MARGIN - 8, y + 16).lineWidth(1).strokeColor(C_PRIMARY).stroke();
  y += 40;

  y += 20;
  sigBlock(doc, "Prepared by (Payroll)", MARGIN, 220, y);
  sigBlock(doc, "Employee Acknowledgement", MARGIN + 270, 220, y);

  footer(doc, org.name, "Payslip", "BLANK");
  doc.end();
}

// ── FORM 23: VEHICLE REGISTRATION RECORD ──────────────────────

export async function streamVehicleRegistrationPDF(
  vehicleId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const vehicle = await storage.getFleetVehicleById(vehicleId, orgId) as any;
  if (!vehicle) { res.status(404).json({ message: "Vehicle not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `vehicle-${vehicle.registration || vehicleId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Vehicle Registration Record", `Ref: ${vehicle.registration || vehicleId}`);

  y = sectionHeader(doc, "Vehicle Details", y);
  y = infoRow(doc, "Registration Number", fmt(vehicle.registration), y);
  y = infoRow(doc, "Make", fmt(vehicle.make), y);
  y = infoRow(doc, "Model", fmt(vehicle.model), y);
  y = infoRow(doc, "Year", fmt(vehicle.year), y);
  y = infoRow(doc, "Colour", fmt(vehicle.colour), y);
  y = infoRow(doc, "Type", fmt(vehicle.vehicleType), y);
  y = infoRow(doc, "VIN / Chassis No.", fmt(vehicle.vin), y);
  y = infoRow(doc, "Engine No.", fmt(vehicle.engineNumber), y);
  y = infoRow(doc, "Fuel Type", fmt(vehicle.fuelType), y);
  y = infoRow(doc, "Status", fmt(vehicle.status), y);
  y += 6;

  y = sectionHeader(doc, "Compliance & Insurance", y);
  y = infoRow(doc, "Insurance Policy No.", fmt(vehicle.insurancePolicyNumber), y);
  y = infoRow(doc, "Insurance Expiry", fmtDate(vehicle.insuranceExpiry), y);
  y = infoRow(doc, "Licence Expiry", fmtDate(vehicle.licenceExpiry), y);
  y = infoRow(doc, "COF Expiry", fmtDate(vehicle.cofExpiry), y);
  y = infoRow(doc, "Last Service Date", fmtDate(vehicle.lastServiceDate), y);
  y = infoRow(doc, "Next Service Odometer", vehicle.nextServiceOdometer ? `${vehicle.nextServiceOdometer} km` : "—", y);
  y += 30;

  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  sigBlock(doc, "Authorised by", MARGIN + 270, 220, y);

  const [sigBufVR, qrBufVR] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", vehicleId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Vehicle Registration Record", vehicle.registration || vehicleId, sigBufVR, qrBufVR);
  doc.end();
}

// ── FORM 23 BLANK ─────────────────────────────────────────────

export async function streamVehicleRegistrationBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="vehicle-registration-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Vehicle Registration Record", "Fleet Management");

  y = sectionHeader(doc, "Vehicle Details", y);
  y = blankLine(doc, "Registration Number", y);
  y = blankLine(doc, "Make", y);
  y = blankLine(doc, "Model", y);
  y = blankLine(doc, "Year", y);
  y = blankLine(doc, "Colour", y);
  y = blankLine(doc, "Vehicle Type", y);
  y = blankLine(doc, "VIN / Chassis No.", y);
  y = blankLine(doc, "Engine No.", y);
  y = blankLine(doc, "Fuel Type", y);
  y += 6;

  y = sectionHeader(doc, "Compliance & Insurance", y);
  y = blankLine(doc, "Insurance Policy No.", y);
  y = blankLine(doc, "Insurance Expiry Date", y);
  y = blankLine(doc, "Licence Expiry Date", y);
  y = blankLine(doc, "COF Expiry Date", y);
  y = blankLine(doc, "Last Service Date", y);
  y = blankLine(doc, "Next Service Odometer (km)", y);
  y += 30;

  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  sigBlock(doc, "Authorised by", MARGIN + 270, 220, y);

  footer(doc, org.name, "Vehicle Registration Record", "BLANK");
  doc.end();
}

// ── FORM 24: FUEL LOG ─────────────────────────────────────────

export async function streamFuelLogPDF(
  vehicleId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const vehicle = await storage.getFleetVehicleById(vehicleId, orgId) as any;
  if (!vehicle) { res.status(404).json({ message: "Vehicle not found" }); return; }
  const fuelLogs = await storage.getFuelLogs(orgId, vehicleId);

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `fuel-log-${vehicle.registration || vehicleId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Fleet Fuel Log", `Vehicle: ${vehicle.registration || vehicleId} — ${vehicle.make || ""} ${vehicle.model || ""}`.trim());

  y = sectionHeader(doc, "Fuel Records", y);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  doc.text("Date", MARGIN, y, { width: 70 });
  doc.text("Odometer", MARGIN + 70, y, { width: 70 });
  doc.text("Litres", MARGIN + 140, y, { width: 55 });
  doc.text("Cost", MARGIN + 195, y, { width: 65 });
  doc.text("Station", MARGIN + 260, y, { width: 120 });
  doc.text("Driver", MARGIN + 380, y, { width: 119 });
  y += 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (const log of fuelLogs as any[]) {
    if (y > A4_H - MARGIN - 60) { doc.addPage(); y = MARGIN + 20; }
    doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT);
    doc.text(fmtDate(log.fuelDate), MARGIN, y, { width: 70 });
    doc.text(fmt(log.odometerReading), MARGIN + 70, y, { width: 70 });
    doc.text(fmt(log.litresFilled), MARGIN + 140, y, { width: 55 });
    doc.text(log.totalCost ? `${log.currency || "USD"} ${log.totalCost}` : "—", MARGIN + 195, y, { width: 65 });
    doc.text(fmt(log.fuelStation), MARGIN + 260, y, { width: 120 });
    doc.text(fmt(log.driverName), MARGIN + 380, y, { width: 119 });
    y += 12;
  }

  if (fuelLogs.length === 0) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("No fuel records found.", MARGIN, y);
    y += 20;
  }

  y += 20;
  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  const [sigBufFL, qrBufFL] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", vehicleId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Fuel Log", vehicle.registration || vehicleId, sigBufFL, qrBufFL);
  doc.end();
}

export async function streamFuelLogBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="fuel-log-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Fleet Fuel Log", "Vehicle Reg: ____________   Make/Model: ____________________");

  y = sectionHeader(doc, "Fuel Records", y);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  doc.text("Date", MARGIN, y, { width: 65 });
  doc.text("Odometer", MARGIN + 65, y, { width: 65 });
  doc.text("Litres", MARGIN + 130, y, { width: 55 });
  doc.text("Cost", MARGIN + 185, y, { width: 65 });
  doc.text("Station", MARGIN + 250, y, { width: 110 });
  doc.text("Driver", MARGIN + 360, y, { width: 80 });
  doc.text("Sign", MARGIN + 440, y, { width: 59 });
  y += 12;
  doc.moveTo(MARGIN, y).lineTo(A4_W - MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (let i = 0; i < 22; i++) {
    doc.moveTo(MARGIN, y + 11).lineTo(A4_W - MARGIN, y + 11).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 14;
  }

  y += 20;
  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  footer(doc, org.name, "Fuel Log", "BLANK");
  doc.end();
}

// ── FORM 25: MAINTENANCE RECORD ────────────────────────────────

export async function streamMaintenanceRecordPDF(
  vehicleId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const vehicle = await storage.getFleetVehicleById(vehicleId, orgId) as any;
  if (!vehicle) { res.status(404).json({ message: "Vehicle not found" }); return; }
  const records = await storage.getMaintenanceRecords(orgId, vehicleId);

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `maintenance-${vehicle.registration || vehicleId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Vehicle Maintenance Record", `Vehicle: ${vehicle.registration || ""} — ${vehicle.make || ""} ${vehicle.model || ""}`.trim());

  y = sectionHeader(doc, "Vehicle Details", y);
  y = infoRow(doc, "Registration", fmt(vehicle.registration), y);
  y = infoRow(doc, "Make / Model", `${vehicle.make || ""} ${vehicle.model || ""}`.trim() || "—", y);
  y = infoRow(doc, "Year", fmt(vehicle.year), y);
  y += 6;

  y = sectionHeader(doc, "Maintenance History", y);

  for (const rec of records as any[]) {
    if (y > A4_H - MARGIN - 100) { doc.addPage(); y = MARGIN + 20; }
    doc.rect(MARGIN, y, COL, 14).fill("#f3f4f6");
    doc.font("Helvetica-Bold").fontSize(8).fillColor(C_TEXT)
      .text(`${fmtDate(rec.serviceDate)}  —  ${rec.serviceType || "Service"}`, MARGIN + 8, y + 2, { width: COL - 16 });
    y += 16;
    y = infoRow(doc, "Workshop / Provider", fmt(rec.serviceProvider), y);
    y = infoRow(doc, "Odometer at Service", rec.odometerAtService ? `${rec.odometerAtService} km` : "—", y);
    y = infoRow(doc, "Cost", rec.cost ? `${rec.currency || "USD"} ${rec.cost}` : "—", y);
    y = infoRow(doc, "Work Done", fmt(rec.description), y);
    y = infoRow(doc, "Next Service Date", fmtDate(rec.nextServiceDate), y);
    y += 6;
  }

  if (records.length === 0) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("No maintenance records found.", MARGIN, y);
    y += 20;
  }

  y += 20;
  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  const [sigBufMaint, qrBufMaint] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", vehicleId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Maintenance Record", vehicle.registration || vehicleId, sigBufMaint, qrBufMaint);
  doc.end();
}

export async function streamMaintenanceRecordBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="maintenance-record-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Vehicle Maintenance Record", "Vehicle Reg: ____________   Make/Model: ____________________");

  y = sectionHeader(doc, "Vehicle Details", y);
  y = blankLine(doc, "Registration Number", y);
  y = blankLine(doc, "Make / Model", y);
  y = blankLine(doc, "Year", y);
  y += 6;

  for (let i = 0; i < 4; i++) {
    y = sectionHeader(doc, `Service Entry ${i + 1}`, y);
    y = blankLine(doc, "Service Date", y);
    y = blankLine(doc, "Workshop / Provider", y);
    y = blankLine(doc, "Odometer (km)", y);
    y = blankLine(doc, "Cost", y);
    y = blankLine(doc, "Work Done", y);
    y = blankLine(doc, "Next Service Date", y);
    y += 4;
  }

  y += 20;
  sigBlock(doc, "Fleet Manager", MARGIN, 220, y);
  footer(doc, org.name, "Maintenance Record", "BLANK");
  doc.end();
}

// ── FORM 26: DRIVER ASSIGNMENT SLIP ───────────────────────────

export async function streamDriverAssignmentPDF(
  assignmentId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const assignments = await storage.getDriverAssignments(orgId);
  const asgn = (assignments as any[]).find((a) => a.id === assignmentId);
  if (!asgn) { res.status(404).json({ message: "Assignment not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="driver-assignment-${assignmentId.slice(0, 8)}.pdf"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Driver Assignment Slip", `Assignment Ref: DA-${assignmentId.slice(0, 8).toUpperCase()}`);

  y = sectionHeader(doc, "Assignment Details", y);
  y = infoRow(doc, "Driver Name", fmt(asgn.driverName || asgn.driver?.name), y);
  y = infoRow(doc, "Vehicle Reg.", fmt(asgn.vehicleReg || asgn.vehicle?.registrationNumber), y);
  y = infoRow(doc, "Vehicle Make/Model", `${asgn.vehicle?.make || ""} ${asgn.vehicle?.model || ""}`.trim() || "—", y);
  y = infoRow(doc, "Assignment Date", fmtDate(asgn.assignmentDate || asgn.startDate), y);
  y = infoRow(doc, "Purpose / Route", fmt(asgn.purpose || asgn.notes), y);
  y = infoRow(doc, "Start Odometer (km)", fmt(asgn.startOdometer), y);
  y = infoRow(doc, "End Odometer (km)", fmt(asgn.endOdometer), y);
  y = infoRow(doc, "Notes", fmt(asgn.notes), y);
  y += 30;

  y = sectionHeader(doc, "Pre-Trip Vehicle Inspection", y);
  const items = ["Tyres & Pressure", "Fuel Level", "Oil Level", "Brakes", "Lights", "Windscreen", "Documents on Board"];
  for (const item of items) {
    y = checkboxRow(doc, item, null, y);
  }

  y += 20;
  sigBlock(doc, "Driver Signature", MARGIN, 220, y);
  sigBlock(doc, "Authorised by", MARGIN + 270, 220, y);

  const [sigBufDA, qrBufDA] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", assignmentId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Driver Assignment Slip", `DA-${assignmentId.slice(0, 8).toUpperCase()}`, sigBufDA, qrBufDA);
  doc.end();
}

export async function streamDriverAssignmentBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="driver-assignment-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Driver Assignment Slip", "Fleet Management");

  y = sectionHeader(doc, "Assignment Details", y);
  y = blankLine(doc, "Driver Name", y);
  y = blankLine(doc, "Vehicle Reg.", y);
  y = blankLine(doc, "Vehicle Make/Model", y);
  y = blankLine(doc, "Assignment Date", y);
  y = blankLine(doc, "Purpose / Route", y);
  y = blankLine(doc, "Start Odometer (km)", y);
  y = blankLine(doc, "End Odometer (km)", y);
  y = blankLine(doc, "Notes", y);
  y += 14;

  y = sectionHeader(doc, "Pre-Trip Vehicle Inspection", y);
  const items = ["Tyres & Pressure", "Fuel Level", "Oil Level", "Brakes", "Lights", "Windscreen", "Documents on Board"];
  for (const item of items) {
    y = checkboxRow(doc, item, null, y);
  }

  y += 20;
  sigBlock(doc, "Driver Signature", MARGIN, 220, y);
  sigBlock(doc, "Authorised by", MARGIN + 270, 220, y);

  footer(doc, org.name, "Driver Assignment Slip", "BLANK");
  doc.end();
}

// ── FORM 27: LEAD CAPTURE FORM ────────────────────────────────

export async function streamLeadCapturePDF(
  leadId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const lead = await storage.getLead(leadId, orgId);
  if (!lead) { res.status(404).json({ message: "Lead not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  const filename = `lead-${leadId.slice(0, 8)}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Lead Capture Form", `Ref: LEAD-${leadId.slice(0, 8).toUpperCase()}`);

  y = sectionHeader(doc, "Prospect Information", y);
  y = infoRow(doc, "Full Name", fmt((lead as any).name || `${(lead as any).firstName || ""} ${(lead as any).lastName || ""}`.trim()), y);
  y = infoRow(doc, "Phone", fmt((lead as any).phone), y);
  y = infoRow(doc, "Email", fmt((lead as any).email), y);
  y = infoRow(doc, "ID Number", fmt((lead as any).nationalId || (lead as any).idNumber), y);
  y = infoRow(doc, "Address", fmt((lead as any).address), y);
  y += 6;

  y = sectionHeader(doc, "Lead Details", y);
  y = infoRow(doc, "Stage", fmt((lead as any).stage || (lead as any).status), y);
  y = infoRow(doc, "Source", fmt((lead as any).source), y);
  y = infoRow(doc, "Product Interest", fmt((lead as any).productInterest || (lead as any).productId), y);
  y = infoRow(doc, "Assigned Agent", fmt((lead as any).agentName || (lead as any).agentId), y);
  y = infoRow(doc, "Date Captured", fmtDate((lead as any).createdAt), y);
  y = infoRow(doc, "Next Follow-up", fmtDate((lead as any).nextFollowUp || (lead as any).followUpDate), y);
  y += 6;

  y = sectionHeader(doc, "Notes", y);
  const notes = (lead as any).notes || "";
  if (notes) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(notes, MARGIN + 8, y, { width: COL - 16 });
    y += doc.heightOfString(notes, { width: COL - 16 }) + 10;
  } else {
    for (let i = 0; i < 4; i++) {
      doc.moveTo(MARGIN, y + 13).lineTo(A4_W - MARGIN, y + 13).lineWidth(0.3).strokeColor(C_BORDER).stroke();
      y += 16;
    }
  }

  y += 30;
  sigBlock(doc, "Agent Signature", MARGIN, 220, y);
  sigBlock(doc, "Supervisor", MARGIN + 270, 220, y);

  const [sigBufLead, qrBufLead] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", leadId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Lead Capture Form", `LEAD-${leadId.slice(0, 8).toUpperCase()}`, sigBufLead, qrBufLead);
  doc.end();
}

export async function streamLeadCaptureBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="lead-capture-blank.pdf"');
  doc.pipe(res);

  let y = await buildHeader(doc, org, "Lead Capture Form", "New Prospect Registration");

  y = sectionHeader(doc, "Prospect Information", y);
  y = blankLine(doc, "Full Name", y);
  y = blankLine(doc, "Phone Number", y);
  y = blankLine(doc, "Email Address", y);
  y = blankLine(doc, "National ID", y);
  y = blankLine(doc, "Physical Address", y);
  y += 6;

  y = sectionHeader(doc, "Lead Details", y);
  y = blankLine(doc, "Source (Referral / Walk-in / etc.)", y);
  y = blankLine(doc, "Product of Interest", y);
  y = blankLine(doc, "Assigned Agent", y);
  y = blankLine(doc, "Date Captured", y);
  y = blankLine(doc, "Next Follow-up Date", y);
  y += 6;

  y = sectionHeader(doc, "Notes", y);
  for (let i = 0; i < 5; i++) {
    doc.moveTo(MARGIN, y + 13).lineTo(A4_W - MARGIN, y + 13).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 16;
  }

  y += 30;
  sigBlock(doc, "Agent Signature", MARGIN, 220, y);
  sigBlock(doc, "Supervisor", MARGIN + 270, 220, y);

  footer(doc, org.name, "Lead Capture Form", "BLANK");
  doc.end();
}

// ── FORM 28: VEHICLE TRIP / MILEAGE LOG ──────────────────────

export async function streamVehicleTripLogPDF(
  vehicleId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const vehicle = await storage.getFleetVehicleById(vehicleId, orgId) as any;
  if (!vehicle) { res.status(404).json({ message: "Vehicle not found" }); return; }
  const trips = await storage.getVehicleTripLogs(orgId, vehicleId);

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true, layout: "landscape" });
  const filename = `trip-log-${vehicle.registration || vehicleId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  doc.pipe(res);

  const PAGE_W = A4_H; // landscape: height becomes width
  const PAGE_MARGIN = 36;
  const PAGE_COL = PAGE_W - PAGE_MARGIN * 2;

  const logoData = await resolveImage(org.logoUrl);
  let y = PAGE_MARGIN;
  if (logoData) {
    try { doc.image(logoData, PAGE_MARGIN, y, { height: 40, fit: [100, 40] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Organisation", PAGE_MARGIN + 110, y, { width: PAGE_COL - 110, align: "right" });
  y += 18;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(C_TEXT)
    .text("Vehicle Trip / Mileage Log", PAGE_MARGIN, y, { width: PAGE_COL, align: "center" });
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
    .text(`Vehicle: ${vehicle.registration || ""} — ${vehicle.make || ""} ${vehicle.model || ""}`.trim(), PAGE_MARGIN, y, { width: PAGE_COL, align: "center" });
  y += 14;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 10;

  // Table columns (landscape A4)
  const cDate = PAGE_MARGIN;
  const cDriver = PAGE_MARGIN + 65;
  const cFrom = PAGE_MARGIN + 170;
  const cTo = PAGE_MARGIN + 255;
  const cDep = PAGE_MARGIN + 340;
  const cRet = PAGE_MARGIN + 395;
  const cStart = PAGE_MARGIN + 450;
  const cEnd = PAGE_MARGIN + 505;
  const cDist = PAGE_MARGIN + 560;
  const cFuel = PAGE_MARGIN + 610;
  const cPurpose = PAGE_MARGIN + 660;

  doc.font("Helvetica-Bold").fontSize(7).fillColor(C_MUTED);
  doc.text("Date", cDate, y, { width: 65 });
  doc.text("Driver", cDriver, y, { width: 100 });
  doc.text("From", cFrom, y, { width: 85 });
  doc.text("To", cTo, y, { width: 85 });
  doc.text("Dep.", cDep, y, { width: 55 });
  doc.text("Ret.", cRet, y, { width: 55 });
  doc.text("Odo Start", cStart, y, { width: 55 });
  doc.text("Odo End", cEnd, y, { width: 55 });
  doc.text("Dist.", cDist, y, { width: 50 });
  doc.text("Fuel (L)", cFuel, y, { width: 50 });
  doc.text("Purpose", cPurpose, y, { width: PAGE_W - PAGE_MARGIN - cPurpose });
  y += 11;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (const trip of trips as any[]) {
    if (y > A4_W - PAGE_MARGIN - 50) { doc.addPage(); y = PAGE_MARGIN + 20; }
    doc.font("Helvetica").fontSize(7).fillColor(C_TEXT);
    doc.text(fmtDate(trip.tripDate), cDate, y, { width: 65 });
    doc.text(fmt(trip.driverName || trip.driverId), cDriver, y, { width: 100 });
    doc.text(fmt(trip.startLocation), cFrom, y, { width: 85 });
    doc.text(fmt(trip.destination), cTo, y, { width: 85 });
    doc.text(fmt(trip.timeDeparted), cDep, y, { width: 55 });
    doc.text(fmt(trip.timeReturned), cRet, y, { width: 55 });
    doc.text(fmt(trip.startOdometer), cStart, y, { width: 55 });
    doc.text(fmt(trip.endOdometer), cEnd, y, { width: 55 });
    doc.text(trip.distanceKm ? `${trip.distanceKm} km` : "—", cDist, y, { width: 50 });
    doc.text(fmt(trip.fuelUsedLitres), cFuel, y, { width: 50 });
    doc.text(fmt(trip.purpose), cPurpose, y, { width: PAGE_W - PAGE_MARGIN - cPurpose });
    y += 12;
  }

  if (trips.length === 0) {
    doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED).text("No trip records found.", PAGE_MARGIN, y);
    y += 20;
  }

  y += 20;
  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
    .text(`${org.name || "POL263"} — Vehicle Trip Log · For official use only`, PAGE_MARGIN, A4_W - PAGE_MARGIN - 12, { width: PAGE_COL, align: "center" });

  doc.end();
}

export async function streamVehicleTripLogBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const doc = new PDFDocument({ size: "A4", margin: 0, autoFirstPage: true, layout: "landscape" });
  res.setHeader("Content-Type", "application/pdf");
  if (opts?.attachment) res.setHeader("Content-Disposition", 'attachment; filename="vehicle-trip-log-blank.pdf"');
  doc.pipe(res);

  const PAGE_W = A4_H;
  const PAGE_MARGIN = 36;
  const PAGE_COL = PAGE_W - PAGE_MARGIN * 2;

  const logoData = await resolveImage(org.logoUrl);
  let y = PAGE_MARGIN;
  if (logoData) {
    try { doc.image(logoData, PAGE_MARGIN, y, { height: 40, fit: [100, 40] }); } catch { /* skip */ }
  }
  doc.font("Helvetica-Bold").fontSize(13).fillColor(C_PRIMARY)
    .text(org.name || "Organisation", PAGE_MARGIN + 110, y, { width: PAGE_COL - 110, align: "right" });
  y += 18;
  doc.font("Helvetica-Bold").fontSize(14).fillColor(C_TEXT)
    .text("Vehicle Trip / Mileage Log", PAGE_MARGIN, y, { width: PAGE_COL, align: "center" });
  y += 16;

  const lineW = 200;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_MUTED)
    .text("Vehicle Reg:", PAGE_MARGIN, y, { continued: true }).text("  ");
  doc.moveTo(PAGE_MARGIN + 75, y + 10).lineTo(PAGE_MARGIN + 75 + lineW, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  doc.text("   Month:", PAGE_MARGIN + 75 + lineW + 12, y, { continued: true }).text("  ");
  doc.moveTo(PAGE_MARGIN + 75 + lineW + 60, y + 10).lineTo(PAGE_MARGIN + 75 + lineW + 60 + 150, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 18;

  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(1.5).strokeColor(C_PRIMARY).stroke();
  y += 10;

  const cDate = PAGE_MARGIN;
  const cDriver = PAGE_MARGIN + 65;
  const cFrom = PAGE_MARGIN + 170;
  const cTo = PAGE_MARGIN + 255;
  const cDep = PAGE_MARGIN + 340;
  const cRet = PAGE_MARGIN + 395;
  const cStart = PAGE_MARGIN + 450;
  const cEnd = PAGE_MARGIN + 505;
  const cDist = PAGE_MARGIN + 560;
  const cFuel = PAGE_MARGIN + 610;
  const cSig = PAGE_MARGIN + 660;

  doc.font("Helvetica-Bold").fontSize(7).fillColor(C_MUTED);
  doc.text("Date", cDate, y, { width: 65 });
  doc.text("Driver Name", cDriver, y, { width: 100 });
  doc.text("From", cFrom, y, { width: 85 });
  doc.text("To", cTo, y, { width: 85 });
  doc.text("Dep.", cDep, y, { width: 55 });
  doc.text("Ret.", cRet, y, { width: 55 });
  doc.text("Odo Start", cStart, y, { width: 55 });
  doc.text("Odo End", cEnd, y, { width: 55 });
  doc.text("km", cDist, y, { width: 50 });
  doc.text("Fuel (L)", cFuel, y, { width: 50 });
  doc.text("Purpose/Sign", cSig, y, { width: PAGE_W - PAGE_MARGIN - cSig });
  y += 11;
  doc.moveTo(PAGE_MARGIN, y).lineTo(PAGE_W - PAGE_MARGIN, y).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 4;

  for (let i = 0; i < 20; i++) {
    doc.moveTo(PAGE_MARGIN, y + 13).lineTo(PAGE_W - PAGE_MARGIN, y + 13).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 16;
  }

  doc.font("Helvetica").fontSize(8).fillColor(C_MUTED)
    .text(`${org.name || "POL263"} — Vehicle Trip Log · BLANK FORM · For official use only`, PAGE_MARGIN, A4_W - PAGE_MARGIN - 12, { width: PAGE_COL, align: "center" });

  doc.end();
}
