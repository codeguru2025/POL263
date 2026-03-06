import type { Express, Request, Response } from "express";
import PDFDocument from "pdfkit";
import { storage } from "./storage";
import { requireAuth } from "./auth";

const SUPPORTED_LANGUAGES: Record<string, string> = {
  en: "English", sn: "Shona", nd: "Ndebele", zu: "Zulu", xh: "Xhosa",
  af: "Afrikaans", fr: "French", pt: "Portuguese", sw: "Swahili",
  st: "Sesotho", tn: "Setswana", ny: "Chichewa", es: "Spanish",
};

async function translateText(text: string, targetLang: string): Promise<string> {
  if (!targetLang || targetLang === "en") return text;
  try {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(text)}`;
    const res = await fetch(url, { headers: { "User-Agent": "POL263" } });
    if (!res.ok) return text;
    const data = await res.json() as any[];
    if (!data?.[0]) return text;
    return data[0].map((s: any) => s?.[0] || "").join("");
  } catch {
    return text;
  }
}

async function translateBatch(texts: string[], targetLang: string): Promise<string[]> {
  if (!targetLang || targetLang === "en") return texts;
  const results = await Promise.all(texts.map((t) => translateText(t, targetLang)));
  return results;
}

import { resolveImage } from "./object-storage";

/** Resolve logo or signature image for PDF embedding. Delegates to the centralized object-storage resolver. */
async function resolveImageForPdf(url: string | null | undefined): Promise<Buffer | null> {
  return resolveImage(url);
}

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  if (isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age--;
  return age;
}

export async function streamPolicyDocumentToResponse(policyId: string, orgId: string, res: Response, options?: { inline?: boolean; lang?: string }): Promise<void> {
  const policy = await storage.getPolicy(policyId, orgId);
  if (!policy || policy.organizationId !== orgId) {
    res.status(404).json({ message: "Policy not found" });
    return;
  }
  const org = await storage.getOrganization(policy.organizationId);
  const client = await storage.getClient(policy.clientId, policy.organizationId);
  const lang = options?.lang || "en";
  let terms = await storage.getTermsByOrg(policy.organizationId);
  const policyMemberRows = await storage.getPolicyMembers(policy.id, policy.organizationId);
  let productName = "N/A";
  let productVersion: any = null;
  let waitingPeriodDays = 90;
  if (policy.productVersionId) {
    const pv = await storage.getProductVersion(policy.productVersionId, policy.organizationId);
    if (pv) {
      productVersion = pv;
      waitingPeriodDays = pv.waitingPeriodDays ?? 90;
      const prod = await storage.getProduct(pv.productId, policy.organizationId);
      if (prod) productName = `${prod.name} (${prod.code})`;
      const pvTerms = await storage.getTermsByProductVersion(pv.id, policy.organizationId);
      if (pvTerms.length > 0) terms = pvTerms;
    }
  }

  const today = new Date().toISOString().split("T")[0];
  const policyStatusOk = policy.status === "active" || policy.status === "grace";

  interface EnrichedMember {
    name: string; relationship: string; nationalId: string;
    dateOfBirth: string; age: number | null; gender: string;
    captureDate: string; inceptionDate: string; coverDate: string;
    waitingDays: number; claimable: boolean; claimableReason: string;
  }
  const enrichedMembers: EnrichedMember[] = [];
  for (const m of policyMemberRows as any[]) {
    let name = ""; let relationship = ""; let dateOfBirth = "";
    let gender = ""; let nationalId = "";
    if (m.dependentId) {
      const dep = await storage.getDependent(m.dependentId, policy.organizationId);
      if (dep) { name = `${dep.firstName} ${dep.lastName}`; relationship = dep.relationship; dateOfBirth = dep.dateOfBirth || ""; gender = dep.gender || ""; nationalId = dep.nationalId || ""; }
    } else if (m.clientId) {
      const cl = await storage.getClient(m.clientId, policy.organizationId);
      if (cl) { name = `${cl.firstName} ${cl.lastName}`; relationship = "Policy Holder"; dateOfBirth = cl.dateOfBirth || ""; gender = cl.gender || ""; nationalId = cl.nationalId || ""; }
    }
    const age = ageFromDob(dateOfBirth);
    const captureDate = m.createdAt ? new Date(m.createdAt).toISOString().split("T")[0] : "";
    const inceptionDate = policy.inceptionDate || policy.effectiveDate || captureDate;
    let coverDate = "";
    if (inceptionDate) { const d = new Date(inceptionDate); d.setDate(d.getDate() + waitingPeriodDays); coverDate = d.toISOString().split("T")[0]; }
    const waitingOver = !coverDate || coverDate <= today;
    const claimable = policyStatusOk && waitingOver;
    const claimableReason = !policyStatusOk ? `Policy ${policy.status}` : !waitingOver ? `Waiting until ${coverDate}` : "Eligible";
    enrichedMembers.push({ name, relationship, nationalId, dateOfBirth, age, gender, captureDate, inceptionDate: inceptionDate || "", coverDate, waitingDays: waitingPeriodDays, claimable, claimableReason });
  }
  const doc = new PDFDocument({ size: "A4", margin: 50 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", options?.inline ? `inline; filename="Policy-${policy.policyNumber}.pdf"` : `attachment; filename="Policy-${policy.policyNumber}.pdf"`);
  doc.pipe(res);
  const docBlack = "#000000";
  const logoBuffer = await resolveImageForPdf(org?.logoUrl);
  const signatureBuffer = await resolveImageForPdf(org?.signatureUrl);
  doc.rect(0, 0, doc.page.width, 100).fill("#FFFFFF");
  doc.moveTo(0, 100).lineTo(doc.page.width, 100).strokeColor(docBlack).lineWidth(2).stroke();
  if (logoBuffer) {
    try {
      doc.image(logoBuffer, 50, 15, { width: 70, height: 70 });
    } catch (_) {}
  }
  const headerLeft = logoBuffer ? 130 : 50;
  doc
    .fillColor(docBlack)
    .fontSize(22)
    .font("Helvetica-Bold")
    .text(org?.name || "POL263", headerLeft, 25, { align: "left" });
  doc
    .fontSize(10)
    .font("Helvetica")
    .text("POLICY SCHEDULE", headerLeft, 55, { align: "left" });
  const headerRight: string[] = [];
  if (org?.address) headerRight.push(org.address);
  if (org?.phone) headerRight.push(`Tel: ${org.phone}`);
  if (org?.email) headerRight.push(org.email);
  if (org?.website) headerRight.push(org.website);
  if (headerRight.length > 0) {
    doc.fillColor(docBlack).fontSize(8).text(headerRight.join(" | "), 50, 75, {
      align: "right",
      width: doc.page.width - 100,
    });
  }
  let y = 120;
  doc
    .fillColor("#000000")
    .fontSize(16)
    .font("Helvetica-Bold")
    .text("Policy Certificate", 50, y);
  y += 25;
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#666666")
    .text(`Date Issued: ${new Date().toLocaleDateString("en-GB")} at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, 50, y);
  y += 20;
  doc
    .fillColor(docBlack)
    .fontSize(12)
    .font("Helvetica-Bold")
    .text("Policy Details", 50, y);
  y += 5;
  doc
    .moveTo(50, y + 12)
    .lineTo(545, y + 12)
    .strokeColor(docBlack)
    .lineWidth(1)
    .stroke();
  y += 20;
  const policyFields = [
    ["Policy Number", policy.policyNumber],
    ["Status", (policy.status || "inactive").toUpperCase()],
    ["Product", productName],
    ["Currency", policy.currency],
    ["Premium Amount", `${policy.currency} ${parseFloat(policy.premiumAmount).toFixed(2)}`],
    [
      "Payment Schedule",
      (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() +
        (policy.paymentSchedule || "monthly").slice(1),
    ],
    ["Capture Date", policy.createdAt ? new Date(policy.createdAt).toLocaleDateString("en-GB") : "—"],
    ["Effective Date", policy.effectiveDate || "Not set"],
    ["Inception Date", policy.inceptionDate || "Not set"],
    ["Waiting Period", `${waitingPeriodDays} days`],
    ["Waiting Period End", policy.waitingPeriodEndDate || "N/A"],
  ];
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  for (const [label, value] of policyFields) {
    doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${value}`, { width: 350 });
    y += 15;
  }
  y += 10;
  const agentId = (policy as any).agentId;
  if (agentId) {
    const agent = await storage.getUser(agentId);
    if (agent) {
      if (y > 620) {
        doc.addPage();
        y = 50;
      }
      doc
        .fillColor(docBlack)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Agent", 50, y);
      y += 5;
      doc
        .moveTo(50, y + 12)
        .lineTo(545, y + 12)
        .strokeColor(docBlack)
        .lineWidth(1)
        .stroke();
      y += 20;
      const agentFields = [
        ["Name", agent.displayName || agent.email || "—"],
        ["Email", agent.email || "—"],
      ];
      doc.font("Helvetica").fontSize(9).fillColor("#000000");
      for (const [label, value] of agentFields) {
        doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
        doc.font("Helvetica").text(`  ${value}`, { width: 350 });
        y += 15;
      }
      y += 10;
    }
  }
  if (client) {
    doc
      .fillColor(docBlack)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Principal Member", 50, y);
    y += 5;
    doc
      .moveTo(50, y + 12)
      .lineTo(545, y + 12)
      .strokeColor(docBlack)
      .lineWidth(1)
      .stroke();
    y += 20;
    const fullName = [client.title, client.firstName, client.lastName]
      .filter(Boolean)
      .join(" ");
    const clientFields = [
      ["Full Name", fullName],
      ["National ID", client.nationalId || "—"],
      ["Date of Birth", client.dateOfBirth || "—"],
      ["Age", ageFromDob(client.dateOfBirth) != null ? String(ageFromDob(client.dateOfBirth)) : "—"],
      [
        "Gender",
        client.gender
          ? client.gender.charAt(0).toUpperCase() + client.gender.slice(1)
          : "—",
      ],
      ["Marital Status", client.maritalStatus || "—"],
      ["Phone", client.phone || "—"],
      ["Email", client.email || "—"],
      ["Address", client.address || "—"],
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of clientFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font("Helvetica").text(`  ${value}`, { width: 350 });
      y += 15;
    }
    y += 10;
  }
  if (enrichedMembers.length > 0) {
    if (y > 550) {
      doc.addPage();
      y = 50;
    }
    doc
      .fillColor(docBlack)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Policy Members", 50, y);
    y += 5;
    doc
      .moveTo(50, y + 12)
      .lineTo(545, y + 12)
      .strokeColor(docBlack)
      .lineWidth(1)
      .stroke();
    y += 20;
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#333333");
    doc.text("Name", 50, y, { width: 85 });
    doc.text("Role", 138, y, { width: 55 });
    doc.text("ID No.", 196, y, { width: 60 });
    doc.text("DOB", 259, y, { width: 52 });
    doc.text("Age", 314, y, { width: 22 });
    doc.text("Cover Date", 339, y, { width: 58 });
    doc.text("Wait", 400, y, { width: 30 });
    doc.text("Claimable", 433, y, { width: 48 });
    doc.text("Status", 484, y, { width: 55 });
    y += 12;
    doc
      .moveTo(50, y)
      .lineTo(545, y)
      .strokeColor("#CCCCCC")
      .lineWidth(0.5)
      .stroke();
    y += 4;
    doc.font("Helvetica").fontSize(7).fillColor("#000000");
    for (const mem of enrichedMembers) {
      if (y > 740) {
        doc.addPage();
        y = 50;
      }
      doc.text(mem.name || "—", 50, y, { width: 85 });
      doc.text(mem.relationship || "—", 138, y, { width: 55 });
      doc.text(mem.nationalId || "—", 196, y, { width: 60 });
      doc.text(mem.dateOfBirth || "—", 259, y, { width: 52 });
      doc.text(mem.age != null ? String(mem.age) : "—", 314, y, { width: 22 });
      doc.text(mem.coverDate || "—", 339, y, { width: 58 });
      doc.text(`${mem.waitingDays}d`, 400, y, { width: 30 });
      doc.text(mem.claimable ? "Yes" : "No", 433, y, { width: 48 });
      doc.fillColor("#000000").text(mem.claimableReason, 484, y, { width: 55 });
      y += 13;
    }
    y += 10;
  }
  const bp = policy as any;
  if (bp.beneficiaryFirstName) {
    if (y > 680) { doc.addPage(); y = 50; }
    doc.fillColor(docBlack).fontSize(12).font("Helvetica-Bold").text("Designated Beneficiary", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(docBlack).lineWidth(1).stroke();
    y += 20;
    const bFields = [
      ["Name", `${bp.beneficiaryFirstName} ${bp.beneficiaryLastName || ""}`],
      ["Relationship", bp.beneficiaryRelationship || "—"],
      ["National ID", bp.beneficiaryNationalId || "—"],
      ["Phone", bp.beneficiaryPhone || "—"],
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of bFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font("Helvetica").text(`  ${value}`, { width: 350 });
      y += 15;
    }
    y += 10;
  }
  if (productVersion) {
    if (y > 620) {
      doc.addPage();
      y = 50;
    }
    doc
      .fillColor(docBlack)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Coverage Details", 50, y);
    y += 5;
    doc
      .moveTo(50, y + 12)
      .lineTo(545, y + 12)
      .strokeColor(docBlack)
      .lineWidth(1)
      .stroke();
    y += 20;
    const covFields = [
      ["Waiting Period", `${productVersion.waitingPeriodDays} days`],
      ["Grace Period", `${productVersion.gracePeriodDays} days`],
      [
        "Eligible Age Range",
        `${productVersion.eligibilityMinAge} - ${productVersion.eligibilityMaxAge} years`,
      ],
      ["Dependent Max Age", `${productVersion.dependentMaxAge} years`],
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of covFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font("Helvetica").text(`  ${value}`, { width: 350 });
      y += 15;
    }
    y += 10;
  }
  if (terms.length > 0) {
    if (y > 500) {
      doc.addPage();
      y = 50;
    }

    const allTitles = terms.map((t) => t.title);
    const allContents = terms.map((t) => t.content);
    const [translatedTitles, translatedContents, sectionHeader] = await Promise.all([
      translateBatch(allTitles, lang),
      translateBatch(allContents, lang),
      translateText("Terms and Conditions", lang),
    ]);

    doc
      .fillColor(docBlack)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text(sectionHeader, 50, y);
    y += 5;
    doc
      .moveTo(50, y + 12)
      .lineTo(545, y + 12)
      .strokeColor(docBlack)
      .lineWidth(1)
      .stroke();
    y += 20;

    if (lang !== "en") {
      doc.font("Helvetica").fontSize(7).fillColor("#888888").text(`Translated to ${SUPPORTED_LANGUAGES[lang] || lang} from English`, 50, y);
      y += 12;
    }

    for (let i = 0; i < terms.length; i++) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .fillColor("#000000")
        .text(translatedTitles[i], 50, y);
      y += 14;
      doc
        .font("Helvetica")
        .fontSize(8)
        .fillColor("#333333")
        .text(translatedContents[i], 50, y, {
          width: 495,
          lineGap: 3,
        });
      y = doc.y + 12;
    }
  }
  y = Math.max(y, 680);
  doc
    .moveTo(50, y)
    .lineTo(545, y)
    .strokeColor("#CCCCCC")
    .lineWidth(0.5)
    .stroke();
  y += 16;
  doc.font("Helvetica").fontSize(8).fillColor("#666666").text("Authorized signature", 50, y);
  y += 4;
  if (signatureBuffer) {
    try {
      doc.image(signatureBuffer, 50, y, { width: 120, height: 50 });
      y += 55;
    } catch (_) {
      y += 20;
    }
  } else {
    y += 20;
  }
  doc
    .font("Helvetica")
    .fontSize(7)
    .fillColor("#999999")
    .text(org?.footerText || `${org?.name || "POL263"} — All rights reserved`, 50, y, {
      align: "center",
      width: 495,
    });
  doc.end();
}

export { SUPPORTED_LANGUAGES };

export function registerPolicyDocumentRoute(app: Express) {
  app.get("/api/languages", (_req: Request, res: Response) => {
    return res.json(Object.entries(SUPPORTED_LANGUAGES).map(([code, name]) => ({ code, name })));
  });

  app.get("/api/policies/:id/document", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user?.organizationId) {
      return res.status(403).json({ message: "Tenant scope required" });
    }

    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "Policy not found" });
    }

    const lang = (req.query.lang as string || "en").toLowerCase();
    await streamPolicyDocumentToResponse(policy.id, policy.organizationId, res, { lang });
  });

  // E-Statement PDF: premium summary + payment history (optionally date-filtered)
  app.get("/api/policies/:id/estatement", requireAuth, async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user?.organizationId) {
      return res.status(403).json({ message: "Tenant scope required" });
    }

    const policy = await storage.getPolicy(req.params.id as string, user.organizationId);
    if (!policy || policy.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "Policy not found" });
    }

    const org = await storage.getOrganization(policy.organizationId);
    const client = await storage.getClient(policy.clientId, policy.organizationId);
    const payments = await storage.getPaymentsByPolicy(policy.id, policy.organizationId);
    const policyReceipts = await storage.getPaymentReceiptsByPolicy(policy.id, policy.organizationId);

    const dateFrom = req.query.dateFrom as string | undefined;
    const dateTo = req.query.dateTo as string | undefined;
    let filteredPayments = payments;
    if (dateFrom || dateTo) {
      filteredPayments = payments.filter((p) => {
        const d = p.postedDate || (p.receivedAt && new Date(p.receivedAt).toISOString().slice(0, 10));
        if (!d) return true;
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        return true;
      });
    }

    // Map payment transaction id -> receipt number (from payment_receipts.metadata_json.transactionId)
    const receiptMap: Record<string, { receiptNumber: string }> = {};
    for (const r of policyReceipts) {
      const meta = r.metadataJson as { transactionId?: string } | null;
      const txId = meta?.transactionId;
      if (txId) receiptMap[txId] = { receiptNumber: r.receiptNumber };
    }

    const docBlack = "#000000";
    const logoBufferEstatement = await resolveImageForPdf(org?.logoUrl);
    const signatureBufferEstatement = await resolveImageForPdf(org?.signatureUrl);

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    const statementDate = new Date().toISOString().slice(0, 10);
    const inline = req.query.inline === "1" || req.query.inline === "true";
    res.setHeader("Content-Disposition", inline ? `inline; filename="Statement-${policy.policyNumber}-${statementDate}.pdf"` : `attachment; filename="Statement-${policy.policyNumber}-${statementDate}.pdf"`);
    doc.pipe(res);

    const headerHeight = 110;
    doc.rect(0, 0, doc.page.width, headerHeight).fill("#FFFFFF");
    doc.moveTo(0, headerHeight).lineTo(doc.page.width, headerHeight).strokeColor(docBlack).lineWidth(2).stroke();
    if (logoBufferEstatement) {
      try {
        doc.image(logoBufferEstatement, 50, 15, { width: 70, height: 70 });
      } catch (_) {}
    }
    const headerLeft = logoBufferEstatement ? 130 : 50;
    const headerTextWidth = 280;
    let hy = 20;
    doc
      .fillColor(docBlack)
      .fontSize(18)
      .font("Helvetica-Bold")
      .text(org?.name || "POL263", headerLeft, hy, { width: headerTextWidth });
    hy = Math.max(hy + 24, (doc as any).y + 4);
    doc.fillColor(docBlack).fontSize(10).font("Helvetica").text("E-STATEMENT", headerLeft, hy);
    hy += 16;
    const headerRight: string[] = [];
    if (org?.address) headerRight.push(org.address);
    if (org?.phone) headerRight.push(`Tel: ${org.phone}`);
    if (org?.email) headerRight.push(org.email);
    if (headerRight.length > 0) {
      doc.fillColor(docBlack).fontSize(8).text(headerRight.join("  |  "), 300, 25, { align: "right", width: doc.page.width - 350 });
    }

    let y = headerHeight + 10;
    doc.fillColor(docBlack).fontSize(16).font("Helvetica-Bold").text("Policy Statement", 50, y);
    y += 22;
    doc.fontSize(9).font("Helvetica").fillColor(docBlack);
    doc.text(`Statement date: ${new Date().toLocaleDateString("en-GB")} at ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`, 50, y);
    if (dateFrom || dateTo) {
      doc.text(`Period: ${dateFrom || "—"} to ${dateTo || "—"}`, 50, y + 12);
      y += 24;
    } else {
      y += 16;
    }

    doc.fillColor(docBlack).fontSize(12).font("Helvetica-Bold").text("Policy Summary", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(docBlack).lineWidth(1).stroke();
    y += 20;

    const clientName = client ? [client.title, client.firstName, client.lastName].filter(Boolean).join(" ") : "—";
    const summaryFields = [
      ["Policy Number", policy.policyNumber],
      ["Policyholder", clientName],
      ["Status", (policy.status || "").toUpperCase()],
      ["Premium", `${policy.currency} ${parseFloat(policy.premiumAmount).toFixed(2)} (${policy.paymentSchedule || "monthly"})`],
      ["Effective Date", policy.effectiveDate || "—"],
    ];
    doc.font("Helvetica").fontSize(9).fillColor(docBlack);
    for (const [label, value] of summaryFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { width: 120 });
      doc.font("Helvetica").text(String(value).slice(0, 120), 175, y, { width: 370 });
      y += 14;
    }
    y += 8;

    const totalPaid = filteredPayments
      .filter((p) => p.status === "cleared")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);

    const allCleared = payments
      .filter((p) => p.status === "cleared")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    const premium = parseFloat(policy.premiumAmount || "0");
    const startDate = policy.inceptionDate || policy.effectiveDate;
    let totalDue = 0;
    if (startDate && premium > 0) {
      const start = new Date(startDate);
      const now = new Date();
      if (!isNaN(start.getTime()) && start <= now) {
        const daysElapsed = (now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000);
        const schedule = policy.paymentSchedule || "monthly";
        const periodDays = schedule === "weekly" ? 7 : schedule === "biweekly" ? 14 : schedule === "quarterly" ? 91.31 : schedule === "annually" ? 365.25 : 30.44;
        const periodsElapsed = Math.ceil(daysElapsed / periodDays);
        totalDue = periodsElapsed * premium;
      }
    }
    const accountBalance = allCleared - totalDue;

    doc.font("Helvetica-Bold").text(`Total paid in period:`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${policy.currency} ${totalPaid.toFixed(2)}`, { width: 200 });
    y += 14;
    doc.font("Helvetica-Bold").text(`Total paid (all time):`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${policy.currency} ${allCleared.toFixed(2)}`, { width: 200 });
    y += 14;
    doc.font("Helvetica-Bold").text(`Total premiums due:`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${policy.currency} ${totalDue.toFixed(2)}`, { width: 200 });
    y += 14;
    doc.font("Helvetica-Bold").text(`Account Balance:`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${policy.currency} ${accountBalance.toFixed(2)} ${accountBalance > 0 ? "(Advance)" : accountBalance < 0 ? "(Arrears)" : "(Up to date)"}`, { width: 300 });
    y += 20;

    doc.fillColor(docBlack).fontSize(12).font("Helvetica-Bold").text("Payment History", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(docBlack).lineWidth(1).stroke();
    y += 20;

    doc.font("Helvetica-Bold").fontSize(8).fillColor(docBlack);
    doc.text("Date", 50, y, { width: 75 });
    doc.text("Amount", 130, y, { width: 70 });
    doc.text("Method", 205, y, { width: 60 });
    doc.text("Status", 270, y, { width: 55 });
    doc.text("Receipt", 330, y, { width: 70 });
    doc.text("Reference", 405, y, { width: 120 });
    y += 14;
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
    y += 6;

    doc.font("Helvetica").fontSize(8).fillColor("#000000");
    if (filteredPayments.length === 0) {
      doc.text("No payments in this period.", 50, y);
      y += 16;
    } else {
      const rowHeight = 16;
      for (const p of filteredPayments) {
        if (y > 700) {
          doc.addPage();
          y = 50;
          doc.font("Helvetica-Bold").fontSize(8).fillColor(docBlack);
          doc.text("Date", 50, y, { width: 75 });
          doc.text("Amount", 130, y, { width: 70 });
          doc.text("Method", 205, y, { width: 60 });
          doc.text("Status", 270, y, { width: 55 });
          doc.text("Receipt", 330, y, { width: 70 });
          doc.text("Reference", 405, y, { width: 120 });
          y += 14;
          doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
          y += 6;
          doc.font("Helvetica").fontSize(8).fillColor("#000000");
        }
        const dateStr = p.postedDate || (p.receivedAt && new Date(p.receivedAt).toLocaleDateString("en-GB")) || "—";
        const rec = receiptMap[p.id];
        doc.text(dateStr, 50, y, { width: 75 });
        doc.text(`${p.currency} ${parseFloat(p.amount || "0").toFixed(2)}`, 130, y, { width: 70 });
        doc.text(p.paymentMethod || "—", 205, y, { width: 60 });
        doc.text(p.status || "—", 270, y, { width: 55 });
        doc.text(rec ? rec.receiptNumber : "—", 330, y, { width: 70 });
        const refStr = (p.reference || (p as any).paynowReference || "—").toString().slice(0, 25);
        doc.text(refStr, 405, y, { width: 120 });
        y += rowHeight;
      }
    }
    y += 16;

    y = Math.max(y, 680);
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor(docBlack).text("Authorized signature", 50, y);
    y += 4;
    if (signatureBufferEstatement) {
      try {
        doc.image(signatureBufferEstatement, 50, y, { width: 120, height: 50 });
        y += 55;
      } catch (_) {
        y += 20;
      }
    } else {
      y += 20;
    }
    doc
      .font("Helvetica")
      .fontSize(7)
      .fillColor(docBlack)
      .text(org?.footerText || `${org?.name || "POL263"} — All rights reserved`, 50, y, {
        align: "center",
        width: 495,
      });

    doc.end();
  });
}

