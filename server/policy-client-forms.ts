import PDFDocument from "pdfkit";
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildVerifyUrl, buildVerifyQrBuffer, drawDocumentFooter, C_PRIMARY, C_TEXT, C_MUTED, C_BORDER, C_LIGHT_BG, A4_W, A4_H, MARGIN, COL } from "./pdf-utils";

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

function buildBlankHeader(
  doc: InstanceType<typeof PDFDocument>,
  title: string,
  subtitle: string
): number {
  let y = MARGIN;
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

function fieldLine(doc: InstanceType<typeof PDFDocument>, label: string, y: number, lineWidth = 300): number {
  doc.font("Helvetica-Bold").fontSize(8).fillColor(C_MUTED).text(label, MARGIN + 8, y, { width: 140 });
  doc.moveTo(MARGIN + 152, y + 10).lineTo(MARGIN + 152 + lineWidth, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  return y + 22;
}

function checkBoxField(doc: InstanceType<typeof PDFDocument>, label: string, checked: boolean | null | undefined, x: number, y: number): void {
  doc.rect(x, y + 1, 9, 9).lineWidth(0.5).strokeColor(C_TEXT).stroke();
  if (checked) {
    doc.font("Helvetica-Bold").fontSize(9).fillColor(C_TEXT).text("✓", x + 1, y);
  }
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(label, x + 14, y + 1, { width: 80 });
}

function twoColRow(doc: InstanceType<typeof PDFDocument>, label1: string, value1: string, label2: string, value2: string, y: number): number {
  const halfCOL = COL / 2 - 10;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label1, MARGIN + 8, y, { width: 80 });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value1, MARGIN + 92, y, { width: halfCOL - 92 });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text(label2, MARGIN + halfCOL + 20, y, { width: 80 });
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(value2, MARGIN + halfCOL + 104, y, { width: halfCOL - 84 });
  return y + 14;
}

// ── FORM 10: CLIENT REGISTRATION ────────────────────────────

export async function streamClientRegistrationPDF(
  clientId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const client = await storage.getClient(clientId, orgId);
  if (!client) { res.status(404).json({ message: "Client not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const agentUser = client.agentId ? await storage.getUser(client.agentId, orgId) : null;

  const filename = `client-registration-${(client.nationalId || client.id.slice(0, 8)).replace(/\//g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone ?? null, email: org.email ?? null, address: org.address ?? null, logoUrl: (org as any).logoUrl ?? null }, "CLIENT REGISTRATION FORM", `Ref: ${client.nationalId || client.id.slice(0, 8).toUpperCase()} · Printed: ${new Date().toLocaleDateString("en-ZA")}`);

  y = sectionHeader(doc, "Personal Details", y);
  y = twoColRow(doc, "Title", fmt(client.title), "Full Name", `${fmt(client.firstName)} ${fmt(client.lastName)}`, y);
  y = twoColRow(doc, "National ID", fmt(client.nationalId), "Date of Birth", fmtDate(client.dateOfBirth), y);
  y = twoColRow(doc, "Gender", fmt(client.gender), "Marital Status", fmt(client.maritalStatus), y);
  y = twoColRow(doc, "Phone", fmt(client.phone), "Email", fmt(client.email), y);
  y += 6;

  y = sectionHeader(doc, "Address & Contact", y);
  y = infoRow(doc, "Address", fmt(client.address), y);
  y = infoRow(doc, "Location / Area", fmt(client.location), y);
  y = infoRow(doc, "Preferred Contact", fmt(client.preferredCommMethod), y);
  y += 6;

  y = sectionHeader(doc, "Sales Information", y);
  y = infoRow(doc, "Agent", agentUser ? fmt(agentUser.displayName ?? agentUser.email) : "—", y);
  y = infoRow(doc, "Selling Point", fmt(client.sellingPoint), y);
  y = infoRow(doc, "Objections Faced", fmt(client.objectionsFaced), y);
  y = infoRow(doc, "Response to Objections", fmt(client.responseToObjections), y);
  y = infoRow(doc, "Client Feedback", fmt(client.clientFeedback), y);
  y += 12;

  y = sectionHeader(doc, "Declaration", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I confirm that the information provided above is true, accurate and complete to the best of my knowledge.", MARGIN + 8, y, { width: COL - 16 });
  y += 24;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Client Signature", MARGIN, sigW, y);
  sigBlock(doc, "Agent / Sales Rep Signature", MARGIN + sigW + 40, sigW, y);

  const [sigBuf, qrBuf] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", client.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Client Registration", client.id.slice(0, 8).toUpperCase(), sigBuf, qrBuf);
  doc.end();
}

export async function streamClientRegistrationBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="blank-client-registration.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "CLIENT REGISTRATION FORM", "Complete all fields in block capitals · For official use");

  y = sectionHeader(doc, "Personal Details", y);
  y = fieldLine(doc, "Title", y, 60);
  y = fieldLine(doc, "First Name", y, 200);
  y = fieldLine(doc, "Last Name", y, 200);
  y = fieldLine(doc, "National ID / Passport", y, 200);
  y = fieldLine(doc, "Date of Birth", y, 120);
  y = fieldLine(doc, "Gender", y, 100);
  y = fieldLine(doc, "Marital Status", y, 120);
  y = fieldLine(doc, "Phone", y, 160);
  y = fieldLine(doc, "Email", y, 200);
  y += 4;

  y = sectionHeader(doc, "Address & Contact", y);
  y = fieldLine(doc, "Address", y, 300);
  y = fieldLine(doc, "Location / Area", y, 200);
  y = fieldLine(doc, "Preferred Contact Method", y, 160);
  y += 4;

  y = sectionHeader(doc, "Sales Information", y);
  y = fieldLine(doc, "Agent Name", y, 200);
  y = fieldLine(doc, "Branch", y, 150);
  y = fieldLine(doc, "Selling Point", y, 280);
  y = fieldLine(doc, "Objections Faced", y, 280);
  y = fieldLine(doc, "Response to Objections", y, 280);
  y = fieldLine(doc, "Client Feedback", y, 280);
  y += 8;

  y = sectionHeader(doc, "Declaration", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I confirm that the information provided above is true, accurate and complete to the best of my knowledge.", MARGIN + 8, y, { width: COL - 16 });
  y += 24;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Client Signature", MARGIN, sigW, y);
  sigBlock(doc, "Agent / Sales Rep Signature", MARGIN + sigW + 40, sigW, y);

  footer(doc, org?.name ?? null, "Client Registration", "BLANK");
  doc.end();
}

// ── FORM 11: POLICY APPLICATION ─────────────────────────────

export async function streamPolicyApplicationPDF(
  policyId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const policy = await storage.getPolicy(policyId, orgId);
  if (!policy) { res.status(404).json({ message: "Policy not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const client = await storage.getClient(policy.clientId, orgId);
  const pv = policy.productVersionId ? await storage.getProductVersion(policy.productVersionId, orgId) : null;
  const agentUser = policy.agentId ? await storage.getUser(policy.agentId, orgId) : null;

  const filename = `policy-application-${policy.policyNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone ?? null, email: org.email ?? null, address: org.address ?? null, logoUrl: (org as any).logoUrl ?? null }, "POLICY APPLICATION FORM", `Policy: ${policy.policyNumber} · Printed: ${new Date().toLocaleDateString("en-ZA")}`);

  y = sectionHeader(doc, "Policy Details", y);
  y = twoColRow(doc, "Policy Number", fmt(policy.policyNumber), "Status", fmt(policy.status), y);
  y = twoColRow(doc, "Product", pv ? fmt((pv as any).productName || (pv as any).name) : "—", "Version", pv ? fmt(String((pv as any).versionNumber || pv.version || "")) : "—", y);
  y = twoColRow(doc, "Payment Schedule", fmt(policy.paymentSchedule), "Currency", fmt(policy.currency), y);
  y = twoColRow(doc, "Premium Amount", fmt(policy.premiumAmount), "Effective Date", fmtDate(policy.effectiveDate), y);
  y = infoRow(doc, "Agent", agentUser ? fmt(agentUser.displayName ?? agentUser.email) : "—", y);
  y += 6;

  y = sectionHeader(doc, "Policyholder", y);
  if (client) {
    y = twoColRow(doc, "Full Name", `${fmt(client.title)} ${fmt(client.firstName)} ${fmt(client.lastName)}`.trim(), "National ID", fmt(client.nationalId), y);
    y = twoColRow(doc, "Phone", fmt(client.phone), "Email", fmt(client.email), y);
  } else {
    y = infoRow(doc, "Client ID", fmt(policy.clientId), y);
  }
  y += 6;

  y = sectionHeader(doc, "Beneficiary", y);
  y = twoColRow(doc, "First Name", fmt(policy.beneficiaryFirstName), "Last Name", fmt(policy.beneficiaryLastName), y);
  y = twoColRow(doc, "Relationship", fmt(policy.beneficiaryRelationship), "National ID", fmt(policy.beneficiaryNationalId), y);
  y = infoRow(doc, "Phone", fmt(policy.beneficiaryPhone), y);
  y += 8;

  y = sectionHeader(doc, "Terms & Conditions", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I/We agree to be bound by the terms and conditions of this policy as communicated and confirmed by the insurer. I/We confirm the details above are true and correct.", MARGIN + 8, y, { width: COL - 16 });
  y += 28;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Client / Policyholder Signature", MARGIN, sigW, y);
  sigBlock(doc, "Agent / Issuing Officer Signature", MARGIN + sigW + 40, sigW, y);

  const [sigBuf2, qrBuf2] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("policy", policy.id, policy.organizationId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Policy Application", policy.policyNumber, sigBuf2, qrBuf2);
  doc.end();
}

export async function streamPolicyApplicationBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="blank-policy-application.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "POLICY APPLICATION FORM", "Complete all fields in block capitals · For official use");

  y = sectionHeader(doc, "Policy Details", y);
  y = fieldLine(doc, "Policy Number", y, 180);
  y = fieldLine(doc, "Product Name", y, 200);
  y = fieldLine(doc, "Product Version", y, 100);
  y = fieldLine(doc, "Payment Schedule", y, 160);
  y = fieldLine(doc, "Currency", y, 80);
  y = fieldLine(doc, "Premium Amount", y, 120);
  y = fieldLine(doc, "Effective Date", y, 120);
  y = fieldLine(doc, "Agent Name", y, 200);
  y += 4;

  y = sectionHeader(doc, "Policyholder", y);
  y = fieldLine(doc, "Full Name", y, 250);
  y = fieldLine(doc, "National ID / Passport", y, 200);
  y = fieldLine(doc, "Phone", y, 160);
  y = fieldLine(doc, "Email", y, 200);
  y += 4;

  y = sectionHeader(doc, "Beneficiary", y);
  y = fieldLine(doc, "First Name", y, 180);
  y = fieldLine(doc, "Last Name", y, 180);
  y = fieldLine(doc, "Relationship", y, 150);
  y = fieldLine(doc, "National ID", y, 180);
  y = fieldLine(doc, "Phone", y, 160);
  y += 8;

  y = sectionHeader(doc, "Terms & Conditions", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I/We agree to be bound by the terms and conditions of this policy as communicated and confirmed by the insurer. I/We confirm the details above are true and correct.", MARGIN + 8, y, { width: COL - 16 });
  y += 28;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Client / Policyholder Signature", MARGIN, sigW, y);
  sigBlock(doc, "Agent / Issuing Officer Signature", MARGIN + sigW + 40, sigW, y);

  footer(doc, org?.name ?? null, "Policy Application", "BLANK");
  doc.end();
}

// ── FORM 12: DEPENDENT REGISTRATION ─────────────────────────

export async function streamDependentRegistrationPDF(
  clientId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const client = await storage.getClient(clientId, orgId);
  if (!client) { res.status(404).json({ message: "Client not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const deps = await storage.getDependentsByClient(clientId, orgId);

  const filename = `dependents-${(client.nationalId || clientId.slice(0, 8)).replace(/\//g, "-")}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone ?? null, email: org.email ?? null, address: org.address ?? null, logoUrl: (org as any).logoUrl ?? null }, "DEPENDENT REGISTRATION FORM", `Policyholder: ${client.firstName} ${client.lastName} · ID: ${fmt(client.nationalId)}`);

  y = sectionHeader(doc, "Policyholder Details", y);
  y = twoColRow(doc, "Full Name", `${fmt(client.firstName)} ${fmt(client.lastName)}`, "National ID", fmt(client.nationalId), y);
  y = infoRow(doc, "Phone", fmt(client.phone), y);
  y += 6;

  y = sectionHeader(doc, "Dependents", y);
  const cols = [
    { label: "First Name", x: MARGIN + 8, w: 80 },
    { label: "Last Name", x: MARGIN + 92, w: 80 },
    { label: "National ID", x: MARGIN + 176, w: 90 },
    { label: "Date of Birth", x: MARGIN + 270, w: 80 },
    { label: "Gender", x: MARGIN + 354, w: 50 },
    { label: "Relationship", x: MARGIN + 408, w: 80 },
  ];
  doc.rect(MARGIN, y, COL, 16).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  cols.forEach((c) => doc.text(c.label, c.x, y + 4, { width: c.w }));
  doc.fillColor(C_TEXT);
  y += 18;

  const renderDepRow = (rowY: number, dep?: { firstName: string; lastName: string; nationalId: string | null; dateOfBirth: string | null; gender: string | null; relationship: string }) => {
    doc.rect(MARGIN, rowY, COL, 16).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    if (dep) {
      doc.font("Helvetica").fontSize(7.5).fillColor(C_TEXT);
      doc.text(fmt(dep.firstName), cols[0].x, rowY + 4, { width: cols[0].w });
      doc.text(fmt(dep.lastName), cols[1].x, rowY + 4, { width: cols[1].w });
      doc.text(fmt(dep.nationalId), cols[2].x, rowY + 4, { width: cols[2].w });
      doc.text(fmtDate(dep.dateOfBirth), cols[3].x, rowY + 4, { width: cols[3].w });
      doc.text(fmt(dep.gender), cols[4].x, rowY + 4, { width: cols[4].w });
      doc.text(fmt(dep.relationship), cols[5].x, rowY + 4, { width: cols[5].w });
    }
    return rowY + 18;
  };

  deps.forEach((dep) => { y = renderDepRow(y, dep); });
  const blankRows = Math.max(5, 10 - deps.length);
  for (let i = 0; i < blankRows; i++) { y = renderDepRow(y); }
  y += 12;

  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I confirm that the persons listed above are my dependants and are eligible for coverage under my policy.", MARGIN + 8, y, { width: COL - 16 });
  y += 20;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Policyholder Signature", MARGIN, sigW, y);
  sigBlock(doc, "Authorising Officer", MARGIN + sigW + 40, sigW, y);

  const [sigBuf3, qrBuf3] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", client.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Dependent Registration", client.id.slice(0, 8).toUpperCase(), sigBuf3, qrBuf3);
  doc.end();
}

export async function streamDependentRegistrationBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="blank-dependent-registration.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "DEPENDENT REGISTRATION FORM", "Complete all fields in block capitals · For official use");

  y = sectionHeader(doc, "Policyholder Details", y);
  y = fieldLine(doc, "Full Name", y, 250);
  y = fieldLine(doc, "Policy Number", y, 200);
  y = fieldLine(doc, "National ID", y, 180);
  y += 4;

  y = sectionHeader(doc, "Dependents", y);
  const cols = [
    { label: "First Name", x: MARGIN + 8, w: 80 },
    { label: "Last Name", x: MARGIN + 92, w: 80 },
    { label: "National ID", x: MARGIN + 176, w: 90 },
    { label: "Date of Birth", x: MARGIN + 270, w: 80 },
    { label: "Gender", x: MARGIN + 354, w: 50 },
    { label: "Relationship", x: MARGIN + 408, w: 80 },
  ];
  doc.rect(MARGIN, y, COL, 16).fill(C_LIGHT_BG);
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_MUTED);
  cols.forEach((c) => doc.text(c.label, c.x, y + 4, { width: c.w }));
  doc.fillColor(C_TEXT);
  y += 18;
  for (let i = 0; i < 10; i++) {
    doc.rect(MARGIN, y, COL, 18).lineWidth(0.3).strokeColor(C_BORDER).stroke();
    y += 18;
  }
  y += 12;

  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I confirm that the persons listed above are my dependants and are eligible for coverage under my policy.", MARGIN + 8, y, { width: COL - 16 });
  y += 20;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Policyholder Signature", MARGIN, sigW, y);
  sigBlock(doc, "Authorising Officer", MARGIN + sigW + 40, sigW, y);

  footer(doc, org?.name ?? null, "Dependent Registration", "BLANK");
  doc.end();
}

// ── FORM 13: WAITING PERIOD WAIVER REQUEST ───────────────────

export async function streamWaiverRequestPDF(
  waiverId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const waivers = await storage.getAllWaivers(orgId);
  const waiver = waivers.find((w) => w.id === waiverId);
  if (!waiver) { res.status(404).json({ message: "Waiver not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const policy = await storage.getPolicy(waiver.policyId, orgId);
  const client = policy ? await storage.getClient(policy.clientId, orgId) : null;
  const requestedByUser = waiver.requestedBy ? await storage.getUser(waiver.requestedBy, orgId) : null;
  const resolvedByUser = waiver.resolvedBy ? await storage.getUser(waiver.resolvedBy, orgId) : null;

  const filename = `waiver-request-${waiverId.slice(0, 8).toUpperCase()}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone ?? null, email: org.email ?? null, address: org.address ?? null, logoUrl: (org as any).logoUrl ?? null }, "WAITING PERIOD WAIVER REQUEST", `Ref: ${waiverId.slice(0, 8).toUpperCase()} · Printed: ${new Date().toLocaleDateString("en-ZA")}`);

  y = sectionHeader(doc, "Request Details", y);
  y = twoColRow(doc, "Policy Number", fmt(policy?.policyNumber), "Status", fmt(waiver.status).toUpperCase(), y);
  y = twoColRow(doc, "Client Name", client ? `${fmt(client.firstName)} ${fmt(client.lastName)}` : "—", "Client ID", fmt(client?.nationalId), y);
  y = infoRow(doc, "Date Submitted", fmtDate(waiver.createdAt), y);
  y += 6;

  y = sectionHeader(doc, "Reason & Supporting Notes", y);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Reason for Waiver:", MARGIN + 8, y, { width: 140 });
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(fmt(waiver.reason), MARGIN + 8, y, { width: COL - 16 });
  y += 28;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Supporting Notes:", MARGIN + 8, y, { width: 140 });
  y += 12;
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(fmt(waiver.supportingNotes), MARGIN + 8, y, { width: COL - 16 });
  y += 28;

  if (waiver.rejectionReason) {
    y = sectionHeader(doc, "Resolution Notes", y);
    y = infoRow(doc, "Resolved By", resolvedByUser ? fmt(resolvedByUser.displayName ?? resolvedByUser.email) : "—", y);
    y = infoRow(doc, "Resolved At", fmtDate(waiver.resolvedAt), y);
    y = infoRow(doc, "Rejection Reason", fmt(waiver.rejectionReason), y);
    y += 6;
  }

  y = sectionHeader(doc, "Documents Attached", y);
  for (let i = 0; i < 4; i++) {
    doc.moveTo(MARGIN + 8, y + 12).lineTo(MARGIN + 200, y + 12).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 20;
  }
  y += 4;

  const sigW = COL / 2 - 20;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED)
    .text(`Requested By: ${requestedByUser ? fmt(requestedByUser.displayName ?? requestedByUser.email) : "—"}`, MARGIN, y, { width: sigW });
  y += 12;
  sigBlock(doc, "Requester Signature", MARGIN, sigW, y);
  sigBlock(doc, "Approver / Manager Signature", MARGIN + sigW + 40, sigW, y);

  const [sigBuf4, qrBuf4] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", waiverId); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Waiting Period Waiver Request", waiverId.slice(0, 8).toUpperCase(), sigBuf4, qrBuf4);
  doc.end();
}

export async function streamWaiverRequestBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="blank-waiver-request.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "WAITING PERIOD WAIVER REQUEST", "For official use · Submit to authorised officer for approval");

  y = sectionHeader(doc, "Request Details", y);
  y = fieldLine(doc, "Policy Number", y, 200);
  y = fieldLine(doc, "Client Name", y, 250);
  y = fieldLine(doc, "Client National ID", y, 180);
  y = fieldLine(doc, "Date Submitted", y, 120);
  y += 4;

  y = sectionHeader(doc, "Reason & Supporting Notes", y);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Reason for Waiver:", MARGIN + 8, y, { width: 140 });
  y += 12;
  for (let i = 0; i < 3; i++) {
    doc.moveTo(MARGIN + 8, y + 12).lineTo(A4_W - MARGIN - 8, y + 12).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 20;
  }
  y += 4;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Supporting Notes:", MARGIN + 8, y, { width: 140 });
  y += 12;
  for (let i = 0; i < 3; i++) {
    doc.moveTo(MARGIN + 8, y + 12).lineTo(A4_W - MARGIN - 8, y + 12).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 20;
  }
  y += 4;

  y = sectionHeader(doc, "Documents Attached (list below)", y);
  for (let i = 0; i < 4; i++) {
    doc.moveTo(MARGIN + 8, y + 12).lineTo(MARGIN + 200, y + 12).lineWidth(0.5).strokeColor(C_BORDER).stroke();
    y += 20;
  }
  y += 8;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Requester Signature", MARGIN, sigW, y);
  sigBlock(doc, "Approver / Manager Signature", MARGIN + sigW + 40, sigW, y);

  footer(doc, org?.name ?? null, "Waiting Period Waiver Request", "BLANK");
  doc.end();
}

// ── FORM 14: DEBIT ORDER MANDATE (BLANK ONLY) ────────────────

export async function streamDebitOrderMandateBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="debit-order-mandate.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "DEBIT ORDER MANDATE", "Authority to debit bank account for recurring premium payments");

  y = sectionHeader(doc, "Account Holder Details", y);
  y = fieldLine(doc, "Client Name", y, 250);
  y = fieldLine(doc, "Policy Number", y, 200);
  y = fieldLine(doc, "National ID", y, 180);
  y += 4;

  y = sectionHeader(doc, "Bank Details", y);
  y = fieldLine(doc, "Account Name", y, 250);
  y = fieldLine(doc, "Bank Name", y, 200);
  y = fieldLine(doc, "Account Number", y, 200);
  y = fieldLine(doc, "Branch Code", y, 120);
  y = fieldLine(doc, "Account Type", y, 140);
  y += 4;

  y = sectionHeader(doc, "Debit Instructions", y);
  y = fieldLine(doc, "Debit Amount", y, 120);
  y = fieldLine(doc, "Currency", y, 80);
  y = fieldLine(doc, "Frequency", y, 140);
  y = fieldLine(doc, "Day of Month / Week", y, 100);
  y = fieldLine(doc, "Start Date", y, 120);
  y += 4;

  y = sectionHeader(doc, "Declaration", y);
  const orgDisplay = org?.name ? `"${org.name}"` : "the insurer";
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text(`I/We hereby authorise ${orgDisplay} to debit my/our account with the amount specified above at the frequency indicated, commencing on the date specified. This authority shall remain in force until cancelled in writing.`, MARGIN + 8, y, { width: COL - 16 });
  y += 36;

  const sigW = COL / 2 - 20;
  sigBlock(doc, "Account Holder Signature", MARGIN, sigW, y);
  doc.font("Helvetica").fontSize(7.5).fillColor(C_MUTED).text("ID Number", MARGIN + sigW + 40, y + 83, { width: sigW });
  doc.moveTo(MARGIN + sigW + 40, y + 80).lineTo(MARGIN + COL, y + 80).lineWidth(0.5).strokeColor(C_BORDER).stroke();

  footer(doc, org?.name ?? null, "Debit Order Mandate", "BLANK");
  doc.end();
}

// ── FORM 15: CLAIM SUBMISSION ────────────────────────────────

export async function streamClaimSubmissionPDF(
  claimId: string,
  orgId: string,
  res: Response,
  opts?: { attachment?: boolean }
): Promise<void> {
  const claim = await storage.getClaim(claimId, orgId);
  if (!claim) { res.status(404).json({ message: "Claim not found" }); return; }
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }

  const policy = await storage.getPolicy(claim.policyId, orgId);
  const client = await storage.getClient(claim.clientId, orgId);
  const submittedByUser = claim.submittedBy ? await storage.getUser(claim.submittedBy, orgId) : null;
  const verifiedByUser = claim.verifiedBy ? await storage.getUser(claim.verifiedBy, orgId) : null;

  const filename = `claim-${claim.claimNumber}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="${filename}"`);

  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org.name, phone: org.phone ?? null, email: org.email ?? null, address: org.address ?? null, logoUrl: (org as any).logoUrl ?? null }, "CLAIM SUBMISSION FORM", `Claim: ${claim.claimNumber} · Printed: ${new Date().toLocaleDateString("en-ZA")}`);

  y = sectionHeader(doc, "Claim Details", y);
  y = twoColRow(doc, "Claim Number", fmt(claim.claimNumber), "Status", fmt(claim.status).toUpperCase(), y);
  y = twoColRow(doc, "Policy Number", fmt(policy?.policyNumber), "Claim Type", fmt(claim.claimType).replace(/_/g, " "), y);
  y = twoColRow(doc, "Currency", fmt(claim.currency), "Date Filed", fmtDate(claim.createdAt as any), y);
  if (claim.cashInLieuAmount) {
    y = infoRow(doc, "Cash-in-Lieu Amount", fmt(claim.cashInLieuAmount), y);
  }
  y += 6;

  y = sectionHeader(doc, "Policyholder", y);
  if (client) {
    y = twoColRow(doc, "Full Name", `${fmt(client.firstName)} ${fmt(client.lastName)}`, "National ID", fmt(client.nationalId), y);
    y = infoRow(doc, "Phone", fmt(client.phone), y);
  }
  y += 6;

  y = sectionHeader(doc, "Deceased Details", y);
  y = infoRow(doc, "Deceased Name", fmt(claim.deceasedName), y);
  y = twoColRow(doc, "Relationship", fmt(claim.deceasedRelationship), "Date of Death", fmtDate(claim.dateOfDeath), y);
  y = infoRow(doc, "Cause of Death", fmt(claim.causeOfDeath), y);
  y = infoRow(doc, "Waiting Period Waived", claim.isWaitingPeriodWaived ? "Yes" : "No", y);
  y += 6;

  y = sectionHeader(doc, "Supporting Documents Checklist", y);
  const docs = [
    "Death Certificate",
    "National ID (Deceased)",
    "National ID (Claimant)",
    "Police Report (if applicable)",
    "Medical Report",
  ];
  let cbX = MARGIN + 8;
  let cbY = y;
  docs.forEach((d, i) => {
    checkBoxField(doc, d, false, cbX + (i % 2) * (COL / 2), cbY + Math.floor(i / 2) * 18);
  });
  y = cbY + Math.ceil(docs.length / 2) * 18 + 4;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Other:", MARGIN + 8, y, { width: 60 });
  doc.moveTo(MARGIN + 70, y + 10).lineTo(A4_W - MARGIN - 8, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 20;

  y = sectionHeader(doc, "Submitted By", y);
  y = infoRow(doc, "Staff Name", submittedByUser ? fmt(submittedByUser.displayName ?? submittedByUser.email) : "—", y);
  y = infoRow(doc, "Verified By", verifiedByUser ? fmt(verifiedByUser.displayName ?? verifiedByUser.email) : "—", y);
  if (claim.approvalNotes) y = infoRow(doc, "Approval Notes", fmt(claim.approvalNotes), y);
  y += 6;

  y = sectionHeader(doc, "Declaration", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I/We declare that the information provided in this claim is true and correct to the best of my/our knowledge.", MARGIN + 8, y, { width: COL - 16 });
  y += 24;

  const sigW = COL / 3 - 12;
  sigBlock(doc, "Claimant / Next of Kin", MARGIN, sigW, y);
  sigBlock(doc, "Submitting Staff", MARGIN + sigW + 18, sigW, y);
  sigBlock(doc, "Verifying Manager", MARGIN + (sigW + 18) * 2, sigW, y);

  const [sigBuf5, qrBuf5] = await Promise.all([
    resolveImage((org as any).signatureUrl),
    (async () => { const u = buildVerifyUrl("form", claim.id); return u ? buildVerifyQrBuffer(u) : null; })(),
  ]);
  footer(doc, org.name, "Claim Submission", claim.claimNumber, sigBuf5, qrBuf5);
  doc.end();
}

export async function streamClaimSubmissionBlankPDF(orgId: string, res: Response, opts?: { attachment?: boolean }): Promise<void> {
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${opts?.attachment ? "attachment" : "inline"}; filename="blank-claim-submission.pdf"`);

  const org = await storage.getOrganization(orgId);
  const doc = new PDFDocument({ size: "A4", margin: 0, bufferPages: true });
  doc.pipe(res);

  let y = await buildHeader(doc, { name: org?.name ?? null, phone: org?.phone ?? null, email: org?.email ?? null, address: org?.address ?? null, logoUrl: (org as any)?.logoUrl ?? null }, "CLAIM SUBMISSION FORM", "Complete all fields in block capitals · For official use");

  y = sectionHeader(doc, "Claim Details", y);
  y = fieldLine(doc, "Claim Number", y, 180);
  y = fieldLine(doc, "Policy Number", y, 200);
  y = fieldLine(doc, "Claim Type", y, 200);
  y = fieldLine(doc, "Currency", y, 80);
  y = fieldLine(doc, "Date Filed", y, 120);
  y += 4;

  y = sectionHeader(doc, "Policyholder", y);
  y = fieldLine(doc, "Full Name", y, 250);
  y = fieldLine(doc, "National ID / Passport", y, 200);
  y = fieldLine(doc, "Phone", y, 160);
  y += 4;

  y = sectionHeader(doc, "Deceased Details", y);
  y = fieldLine(doc, "Deceased Name", y, 250);
  y = fieldLine(doc, "Relationship", y, 150);
  y = fieldLine(doc, "Date of Death", y, 120);
  y = fieldLine(doc, "Cause of Death", y, 250);
  y += 4;

  y = sectionHeader(doc, "Supporting Documents Checklist", y);
  const docs = ["Death Certificate", "National ID (Deceased)", "National ID (Claimant)", "Police Report (if applicable)", "Medical Report"];
  let cbX = MARGIN + 8;
  let cbY = y;
  docs.forEach((d, i) => {
    doc.rect(cbX + (i % 2) * (COL / 2), cbY + Math.floor(i / 2) * 18 + 1, 9, 9).lineWidth(0.5).strokeColor(C_TEXT).stroke();
    doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT).text(d, cbX + (i % 2) * (COL / 2) + 14, cbY + Math.floor(i / 2) * 18 + 2, { width: 150 });
  });
  y = cbY + Math.ceil(docs.length / 2) * 18 + 4;
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(C_MUTED).text("Other:", MARGIN + 8, y, { width: 60 });
  doc.moveTo(MARGIN + 70, y + 10).lineTo(A4_W - MARGIN - 8, y + 10).lineWidth(0.5).strokeColor(C_BORDER).stroke();
  y += 24;

  y = sectionHeader(doc, "Declaration", y);
  doc.font("Helvetica").fontSize(8.5).fillColor(C_TEXT)
    .text("I/We declare that the information provided in this claim is true and correct to the best of my/our knowledge.", MARGIN + 8, y, { width: COL - 16 });
  y += 24;

  const sigW = COL / 3 - 12;
  sigBlock(doc, "Claimant / Next of Kin", MARGIN, sigW, y);
  sigBlock(doc, "Submitting Staff", MARGIN + sigW + 18, sigW, y);
  sigBlock(doc, "Verifying Manager", MARGIN + (sigW + 18) * 2, sigW, y);

  footer(doc, org?.name ?? null, "Claim Submission", "BLANK");
  doc.end();
}
