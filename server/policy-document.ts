import type { Express, Request, Response } from "express";
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import { storage } from "./storage";

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

export function registerPolicyDocumentRoute(app: Express) {
  app.get("/api/policies/:id/document", async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user?.organizationId) {
      return res.status(403).json({ message: "Tenant scope required" });
    }

    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "Policy not found" });
    }

    const org = await storage.getOrganization(policy.organizationId);
    const client = await storage.getClient(policy.clientId);
    const dependentsList = await storage.getDependentsByClient(policy.clientId);
    const terms = await storage.getTermsByOrg(policy.organizationId);

    let productName = "N/A";
    let productVersion: any = null;
    if (policy.productVersionId) {
      const pv = await storage.getProductVersion(policy.productVersionId);
      if (pv) {
        productVersion = pv;
        const prod = await storage.getProduct(pv.productId);
        if (prod) productName = `${prod.name} (${prod.code})`;
      }
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="Policy-${policy.policyNumber}.pdf"`);
    doc.pipe(res);

    const primaryColor = org?.primaryColor || "#D4AF37";

    // Logo (tenant branding): if logoUrl is a path like /uploads/xxx, resolve to disk
    let logoPath: string | null = null;
    if (org?.logoUrl) {
      if (org.logoUrl.startsWith("/")) {
        logoPath = path.join(process.cwd(), org.logoUrl);
      }
    }

    doc.rect(0, 0, doc.page.width, 100).fill(primaryColor);
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 50, 15, { width: 70, height: 70 });
      } catch (_) {}
    }
    const headerLeft = logoPath && fs.existsSync(logoPath) ? 130 : 50;
    doc
      .fillColor("#FFFFFF")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(org?.name || "Falakhe PMS", headerLeft, 25, { align: "left" });
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
      doc.fontSize(8).text(headerRight.join(" | "), 50, 75, {
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
      .text(`Date Issued: ${new Date().toLocaleDateString("en-GB")}`, 50, y);
    y += 20;

    doc
      .fillColor(primaryColor)
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("Policy Details", 50, y);
    y += 5;
    doc
      .moveTo(50, y + 12)
      .lineTo(545, y + 12)
      .strokeColor(primaryColor)
      .lineWidth(1)
      .stroke();
    y += 20;

    const policyFields = [
      ["Policy Number", policy.policyNumber],
      ["Status", (policy.status || "draft").toUpperCase()],
      ["Product", productName],
      ["Currency", policy.currency],
      ["Premium Amount", `${policy.currency} ${parseFloat(policy.premiumAmount).toFixed(2)}`],
      [
        "Payment Schedule",
        (policy.paymentSchedule || "monthly").charAt(0).toUpperCase() +
          (policy.paymentSchedule || "monthly").slice(1),
      ],
      ["Effective Date", policy.effectiveDate || "Not set"],
      ["Waiting Period End", policy.waitingPeriodEndDate || "N/A"],
    ];

    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of policyFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 150 });
      doc.font("Helvetica").text(`  ${value}`, { width: 350 });
      y += 15;
    }
    y += 10;

    if (client) {
      doc
        .fillColor(primaryColor)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Principal Member", 50, y);
      y += 5;
      doc
        .moveTo(50, y + 12)
        .lineTo(545, y + 12)
        .strokeColor(primaryColor)
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

    if (dependentsList.length > 0) {
      if (y > 620) {
        doc.addPage();
        y = 50;
      }
      doc
        .fillColor(primaryColor)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Dependents / Beneficiaries", 50, y);
      y += 5;
      doc
        .moveTo(50, y + 12)
        .lineTo(545, y + 12)
        .strokeColor(primaryColor)
        .lineWidth(1)
        .stroke();
      y += 20;

      doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333");
      doc.text("Name", 50, y, { width: 120 });
      doc.text("Relationship", 175, y, { width: 70 });
      doc.text("National ID", 250, y, { width: 75 });
      doc.text("DOB", 330, y, { width: 65 });
      doc.text("Age", 400, y, { width: 35 });
      doc.text("Gender", 440, y, { width: 60 });
      y += 14;
      doc
        .moveTo(50, y)
        .lineTo(545, y)
        .strokeColor("#CCCCCC")
        .lineWidth(0.5)
        .stroke();
      y += 4;

      doc.font("Helvetica").fontSize(8).fillColor("#000000");
      for (const dep of dependentsList) {
        if (y > 750) {
          doc.addPage();
          y = 50;
        }
        const depAge = ageFromDob(dep.dateOfBirth);
        doc.text(`${dep.firstName} ${dep.lastName}`, 50, y, { width: 120 });
        doc.text(dep.relationship, 175, y, { width: 70 });
        doc.text(dep.nationalId || "—", 250, y, { width: 75 });
        doc.text(dep.dateOfBirth || "—", 330, y, { width: 65 });
        doc.text(depAge != null ? String(depAge) : "—", 400, y, { width: 35 });
        doc.text(
          dep.gender ? dep.gender.charAt(0).toUpperCase() + dep.gender.slice(1) : "—",
          440,
          y,
          { width: 60 },
        );
        y += 14;
      }
      y += 10;
    }

    if (productVersion) {
      if (y > 620) {
        doc.addPage();
        y = 50;
      }
      doc
        .fillColor(primaryColor)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Coverage Details", 50, y);
      y += 5;
      doc
        .moveTo(50, y + 12)
        .lineTo(545, y + 12)
        .strokeColor(primaryColor)
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
      doc
        .fillColor(primaryColor)
        .fontSize(12)
        .font("Helvetica-Bold")
        .text("Terms and Conditions", 50, y);
      y += 5;
      doc
        .moveTo(50, y + 12)
        .lineTo(545, y + 12)
        .strokeColor(primaryColor)
        .lineWidth(1)
        .stroke();
      y += 20;

      for (const term of terms) {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc
          .font("Helvetica-Bold")
          .fontSize(9)
          .fillColor("#000000")
          .text(term.title, 50, y);
        y += 14;
        doc
          .font("Helvetica")
          .fontSize(8)
          .fillColor("#333333")
          .text(term.content, 50, y, {
            width: 495,
            lineGap: 3,
          });
        y = doc.y + 12;
      }
    }

    if (y > 700) {
      doc.addPage();
      y = 50;
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
    let sigPath: string | null = null;
    if (org?.signatureUrl && org.signatureUrl.startsWith("/")) {
      sigPath = path.join(process.cwd(), org.signatureUrl);
    }
    if (sigPath && fs.existsSync(sigPath)) {
      try {
        doc.image(sigPath, 50, y, { width: 120, height: 50 });
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
      .text(org?.footerText || `${org?.name || "Falakhe PMS"} — All rights reserved`, 50, y, {
        align: "center",
        width: 495,
      });

    doc.end();
  });

  // E-Statement PDF: premium summary + payment history (optionally date-filtered)
  app.get("/api/policies/:id/estatement", async (req: Request, res: Response) => {
    const user = req.user as any;
    if (!user?.organizationId) {
      return res.status(403).json({ message: "Tenant scope required" });
    }

    const policy = await storage.getPolicy(req.params.id as string);
    if (!policy || policy.organizationId !== user.organizationId) {
      return res.status(404).json({ message: "Policy not found" });
    }

    const org = await storage.getOrganization(policy.organizationId);
    const client = await storage.getClient(policy.clientId);
    const payments = await storage.getPaymentsByPolicy(policy.id);
    const policyReceipts = await storage.getReceiptsByPolicy(policy.id);

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

    const receiptMap: Record<string, { receiptNumber: string }> = {};
    policyReceipts.forEach((r) => {
      receiptMap[r.transactionId] = { receiptNumber: r.receiptNumber };
    });

    const primaryColor = org?.primaryColor || "#D4AF37";
    let logoPath: string | null = null;
    if (org?.logoUrl && org.logoUrl.startsWith("/")) {
      logoPath = path.join(process.cwd(), org.logoUrl);
    }

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    res.setHeader("Content-Type", "application/pdf");
    const statementDate = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Disposition", `attachment; filename="Statement-${policy.policyNumber}-${statementDate}.pdf"`);
    doc.pipe(res);

    doc.rect(0, 0, doc.page.width, 100).fill(primaryColor);
    if (logoPath && fs.existsSync(logoPath)) {
      try {
        doc.image(logoPath, 50, 15, { width: 70, height: 70 });
      } catch (_) {}
    }
    const headerLeft = logoPath && fs.existsSync(logoPath) ? 130 : 50;
    doc
      .fillColor("#FFFFFF")
      .fontSize(22)
      .font("Helvetica-Bold")
      .text(org?.name || "Falakhe PMS", headerLeft, 25, { align: "left" });
    doc.fontSize(10).font("Helvetica").text("E-STATEMENT", headerLeft, 55, { align: "left" });
    const headerRight: string[] = [];
    if (org?.address) headerRight.push(org.address);
    if (org?.phone) headerRight.push(`Tel: ${org.phone}`);
    if (org?.email) headerRight.push(org.email);
    if (headerRight.length > 0) {
      doc.fontSize(8).text(headerRight.join(" | "), 50, 75, { align: "right", width: doc.page.width - 100 });
    }

    let y = 120;
    doc.fillColor("#000000").fontSize(16).font("Helvetica-Bold").text("Policy Statement", 50, y);
    y += 22;
    doc.fontSize(9).font("Helvetica").fillColor("#666666");
    doc.text(`Statement date: ${new Date().toLocaleDateString("en-GB")}`, 50, y);
    if (dateFrom || dateTo) {
      doc.text(`Period: ${dateFrom || "—"} to ${dateTo || "—"}`, 50, y + 12);
      y += 24;
    } else {
      y += 16;
    }

    doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Policy Summary", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
    y += 20;

    const clientName = client ? [client.title, client.firstName, client.lastName].filter(Boolean).join(" ") : "—";
    const summaryFields = [
      ["Policy Number", policy.policyNumber],
      ["Policyholder", clientName],
      ["Status", (policy.status || "").toUpperCase()],
      ["Premium", `${policy.currency} ${parseFloat(policy.premiumAmount).toFixed(2)} (${policy.paymentSchedule || "monthly"})`],
      ["Effective Date", policy.effectiveDate || "—"],
    ];
    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    for (const [label, value] of summaryFields) {
      doc.font("Helvetica-Bold").text(`${label}:`, 50, y, { continued: true, width: 120 });
      doc.font("Helvetica").text(`  ${value}`, { width: 380 });
      y += 14;
    }
    y += 8;

    const totalPaid = filteredPayments
      .filter((p) => p.status === "cleared")
      .reduce((sum, p) => sum + parseFloat(p.amount || "0"), 0);
    doc.font("Helvetica-Bold").text(`Total paid in period:`, 50, y, { continued: true, width: 150 });
    doc.font("Helvetica").text(`  ${policy.currency} ${totalPaid.toFixed(2)}`, { width: 200 });
    y += 20;

    doc.fillColor(primaryColor).fontSize(12).font("Helvetica-Bold").text("Payment History", 50, y);
    y += 5;
    doc.moveTo(50, y + 12).lineTo(545, y + 12).strokeColor(primaryColor).lineWidth(1).stroke();
    y += 20;

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333");
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
      for (const p of filteredPayments) {
        if (y > 720) {
          doc.addPage();
          y = 50;
        }
        const dateStr = p.postedDate || (p.receivedAt && new Date(p.receivedAt).toLocaleDateString("en-GB")) || "—";
        const rec = receiptMap[p.id];
        doc.text(dateStr, 50, y, { width: 75 });
        doc.text(`${p.currency} ${parseFloat(p.amount || "0").toFixed(2)}`, 130, y, { width: 70 });
        doc.text(p.paymentMethod || "—", 205, y, { width: 60 });
        doc.text(p.status || "—", 270, y, { width: 55 });
        doc.text(rec ? rec.receiptNumber : "—", 330, y, { width: 70 });
        doc.text((p.reference || "—").slice(0, 25), 405, y, { width: 120 });
        y += 14;
      }
    }
    y += 16;

    y = Math.max(y, 680);
    doc.moveTo(50, y).lineTo(545, y).strokeColor("#CCCCCC").lineWidth(0.5).stroke();
    y += 16;
    doc.font("Helvetica").fontSize(8).fillColor("#666666").text("Authorized signature", 50, y);
    y += 4;
    let sigPath: string | null = null;
    if (org?.signatureUrl && org.signatureUrl.startsWith("/")) {
      sigPath = path.join(process.cwd(), org.signatureUrl);
    }
    if (sigPath && fs.existsSync(sigPath)) {
      try {
        doc.image(sigPath, 50, y, { width: 120, height: 50 });
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
      .text(org?.footerText || `${org?.name || "Falakhe PMS"} — All rights reserved`, 50, y, {
        align: "center",
        width: 495,
      });

    doc.end();
  });
}

