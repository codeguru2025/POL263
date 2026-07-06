/**
 * The "Daily Report" — one page combining today's financial statements (income
 * statement, cash flow, transaction ledger) with an auto-fetched summary of
 * operational activity (funeral cases opened, mortuary intake/dispatch, quotations,
 * policies activated, claims submitted) plus free-text notes staff attach to the day.
 */
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { buildIncomeStatement, buildCashFlowStatement, buildTransactionLedger } from "./financial-statements";
import {
  funeralCases,
  mortuaryIntakes,
  mortuaryDispatches,
  funeralQuotations,
  policies,
  claims,
  clients,
} from "@shared/schema";

function dayStart(date: string) { return new Date(date + "T00:00:00.000Z"); }
function dayEnd(date: string) { return new Date(date + "T23:59:59.999Z"); }

export async function buildDailyReport(orgId: string, date: string) {
  const tdb = await getDbForOrg(orgId);

  const [incomeStatement, cashFlow, ledger] = await Promise.all([
    buildIncomeStatement(orgId, { from: date, to: date }),
    buildCashFlowStatement(orgId, { from: date, to: date }),
    buildTransactionLedger(orgId, { from: date, to: date, limit: 500 }),
  ]);

  const funeralCasesOpened = await tdb
    .select({
      id: funeralCases.id, caseNumber: funeralCases.caseNumber, deceasedName: funeralCases.deceasedName,
      status: funeralCases.status, serviceType: funeralCases.serviceType, funeralDate: funeralCases.funeralDate,
    })
    .from(funeralCases)
    .where(and(eq(funeralCases.organizationId, orgId), gte(funeralCases.createdAt, dayStart(date)), lte(funeralCases.createdAt, dayEnd(date))))
    .orderBy(desc(funeralCases.createdAt));

  const mortuaryIntakesToday = await tdb
    .select({
      id: mortuaryIntakes.id, intakeNumber: mortuaryIntakes.intakeNumber, deceasedName: mortuaryIntakes.deceasedName,
      serviceScope: mortuaryIntakes.serviceScope, status: mortuaryIntakes.status,
    })
    .from(mortuaryIntakes)
    .where(and(eq(mortuaryIntakes.organizationId, orgId), gte(mortuaryIntakes.createdAt, dayStart(date)), lte(mortuaryIntakes.createdAt, dayEnd(date))))
    .orderBy(desc(mortuaryIntakes.createdAt));

  const mortuaryDispatchesToday = await tdb
    .select({
      id: mortuaryDispatches.id, destination: mortuaryDispatches.destination,
      collectedByName: mortuaryDispatches.collectedByName, dispatchedAt: mortuaryDispatches.dispatchedAt,
    })
    .from(mortuaryDispatches)
    .where(and(eq(mortuaryDispatches.organizationId, orgId), gte(mortuaryDispatches.createdAt, dayStart(date)), lte(mortuaryDispatches.createdAt, dayEnd(date))))
    .orderBy(desc(mortuaryDispatches.createdAt));

  const quotationsCreated = await tdb
    .select({
      id: funeralQuotations.id, quotationNumber: funeralQuotations.quotationNumber, deceasedName: funeralQuotations.deceasedName,
      grandTotal: funeralQuotations.grandTotal, currency: funeralQuotations.currency, status: funeralQuotations.status,
      funeralCaseId: funeralQuotations.funeralCaseId,
    })
    .from(funeralQuotations)
    .where(and(eq(funeralQuotations.organizationId, orgId), gte(funeralQuotations.createdAt, dayStart(date)), lte(funeralQuotations.createdAt, dayEnd(date))))
    .orderBy(desc(funeralQuotations.createdAt));

  const policiesActivatedRaw = await tdb
    .select({
      id: policies.id, policyNumber: policies.policyNumber, premiumAmount: policies.premiumAmount,
      premiumOverride: policies.premiumOverride,
      currency: policies.currency, isLegacy: policies.isLegacy, clientFirstName: clients.firstName, clientLastName: clients.lastName,
    })
    .from(policies)
    .leftJoin(clients, eq(policies.clientId, clients.id))
    .where(and(eq(policies.organizationId, orgId), eq(policies.inceptionDate, date)))
    .orderBy(desc(policies.createdAt));

  // Effective premium: a manual override always wins over the raw stored premiumAmount
  // (which self-heals back to the product's base pricing — 0 for legacy/custom-premium products).
  const policiesActivated = policiesActivatedRaw.map((p) => ({
    ...p,
    premiumAmount: p.premiumOverride ?? p.premiumAmount,
  }));

  const claimsSubmitted = await tdb
    .select({
      id: claims.id, claimNumber: claims.claimNumber, claimType: claims.claimType,
      status: claims.status, deceasedName: claims.deceasedName,
    })
    .from(claims)
    .where(and(eq(claims.organizationId, orgId), gte(claims.createdAt, dayStart(date)), lte(claims.createdAt, dayEnd(date))))
    .orderBy(desc(claims.createdAt));

  const notes = await storage.getDailyReportNotes(orgId, date);

  return {
    date,
    financials: { incomeStatement, cashFlow, ledger },
    operations: {
      funeralCasesOpened,
      mortuaryIntakes: mortuaryIntakesToday,
      mortuaryDispatches: mortuaryDispatchesToday,
      quotationsCreated,
      policiesActivated,
      claimsSubmitted,
    },
    notes,
  };
}
