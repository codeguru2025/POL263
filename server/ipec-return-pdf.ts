/**
 * IPEC statutory return (indicative) — PDF. Letterhead, the return sections as key/value blocks,
 * a prominent "working draft — needs actuarial sign-off" banner, and clear (manual) / (estimate)
 * tags on every figure the system does not hold.
 */
import type { Response } from "express";
import { storage } from "./storage";
import { resolveImage } from "./object-storage";
import { buildIpecReturn, type IpecReturnParams } from "./ipec-return";
import { makeDoc, newPage, sectionBand, kv, finish, fmtDate, money, ensureSpace, M, COL } from "./financial-statement-pdf";

const C_MUTED = "#6b7280";
const C_WARN = "#b45309";
const C_OK = "#15803d";
const C_BAD = "#b91c1c";

export async function streamIpecReturnPdf(orgId: string, params: IpecReturnParams, res: Response, opts?: { attachment?: boolean }) {
  const org = await storage.getOrganization(orgId);
  if (!org) { res.status(404).json({ message: "Organisation not found" }); return; }
  const logoData = await resolveImage(org.logoUrl);
  const r = await buildIpecReturn(orgId, params);
  const U = (n: number) => `USD ${money(n)}`;

  const ctx = makeDoc(org, logoData, "IPEC Return — Life / Funeral Assurer (Indicative)",
    `${r.meta.insurerClass.toUpperCase()}  ·  Period: ${fmtDate(r.meta.period.from)} to ${fmtDate(r.meta.period.to)}  ·  As of: ${fmtDate(r.meta.asOf)}  ·  Generated: ${new Date().toLocaleString("en-ZA")}`);
  newPage(ctx);

  ensureSpace(ctx, 30);
  ctx.doc.rect(M, ctx.y, COL, 24).fill("#fef3c7");
  ctx.doc.font("Helvetica-Bold").fontSize(7.5).fillColor(C_WARN)
    .text(r.meta.disclaimer, M + 6, ctx.y + 4, { width: COL - 12 });
  ctx.y += 30;

  sectionBand(ctx, "1. Business summary");
  kv(ctx, "Policies in force", String(r.businessSummary.policiesInForce));
  kv(ctx, "New policies in period", String(r.businessSummary.newPoliciesInPeriod));
  kv(ctx, "Lapses in period", String(r.businessSummary.lapsesInPeriod));
  kv(ctx, "Lives covered", String(r.businessSummary.livesCovered));

  sectionBand(ctx, "2. Revenue account (USD, cash basis)");
  const ra = r.revenueAccount;
  kv(ctx, "Gross premium written", U(ra.grossPremiumWritten));
  kv(ctx, "Reinsurance premium ceded  (estimate)", U(ra.reinsurancePremiumCeded));
  kv(ctx, "Net premium written", U(ra.netPremiumWritten));
  kv(ctx, "Investment income  (manual)", U(ra.investmentIncome));
  kv(ctx, "Claims incurred", U(ra.claimsIncurred));
  kv(ctx, "Commission", U(ra.commission));
  kv(ctx, "Management expenses", U(ra.managementExpenses));
  kv(ctx, "Underwriting result", U(ra.underwritingResult), ra.underwritingResult >= 0 ? C_OK : C_BAD);

  sectionBand(ctx, "3. Statement of financial position (USD)");
  const fp = r.financialPosition;
  kv(ctx, "Total assets", U(fp.totalAssets));
  kv(ctx, "  of which prescribed assets  (manual)", U(fp.prescribedAssetsHeld));
  kv(ctx, "Technical provisions  (manual)", U(fp.technicalProvisions));
  kv(ctx, "Other liabilities", U(fp.otherLiabilities));
  kv(ctx, "Total liabilities", U(fp.totalLiabilities));
  kv(ctx, "Shareholders' funds", U(fp.shareholdersFunds), fp.shareholdersFunds >= 0 ? C_OK : C_BAD);

  sectionBand(ctx, "4. Prescribed asset compliance");
  const pa = r.prescribedAssets;
  kv(ctx, "Prescribed assets held", U(pa.held));
  kv(ctx, "Adjusted assets", U(pa.adjustedAssets));
  kv(ctx, "Prescribed asset ratio", `${pa.ratio}%  (minimum ${pa.minimumRatio}%)`, pa.compliant ? C_OK : C_BAD);
  kv(ctx, "Shortfall", U(pa.shortfall), pa.shortfall > 0 ? C_BAD : C_OK);
  kv(ctx, "Compliant", pa.compliant ? "Yes" : "No", pa.compliant ? C_OK : C_BAD);

  sectionBand(ctx, "5. Capital adequacy (ZICARP — indicative)");
  const ca = r.capitalAdequacy;
  kv(ctx, "Available capital", U(ca.availableCapital));
  kv(ctx, `Minimum capital requirement  (${ca.minimumCapitalSource})`, U(ca.minimumCapitalRequirement));
  kv(ctx, "Capital adequacy ratio", `${ca.capitalAdequacyRatio}%`, ca.compliant ? C_OK : C_BAD);
  kv(ctx, "Compliant", ca.compliant ? "Yes" : "No", ca.compliant ? C_OK : C_BAD);

  sectionBand(ctx, "6. Claims analysis");
  kv(ctx, "Reported", String(r.claimsAnalysis.reported));
  kv(ctx, "Settled", String(r.claimsAnalysis.settled));
  kv(ctx, "Repudiated", String(r.claimsAnalysis.repudiated));
  kv(ctx, "Outstanding", String(r.claimsAnalysis.outstanding));
  kv(ctx, "Average settlement (days)", String(r.claimsAnalysis.averageSettlementDays));

  sectionBand(ctx, "7. Complaints");
  kv(ctx, "Received", String(r.complaints.received));
  kv(ctx, "Resolved", String(r.complaints.resolved));
  kv(ctx, "Outstanding", String(r.complaints.outstanding));

  if (r.unconvertibleCurrencies.length) {
    ensureSpace(ctx, 14);
    ctx.doc.font("Helvetica-Oblique").fontSize(7).fillColor(C_MUTED)
      .text(`No FX rate set for ${r.unconvertibleCurrencies.join(", ")} — those balances are excluded from the USD figures above.`, M, ctx.y, { width: COL });
    ctx.y += 12;
  }

  finish(ctx, res, `ipec-return-${r.meta.period.from}-to-${r.meta.period.to}.pdf`, !!opts?.attachment);
}
