/**
 * Income statement & cash-flow statement (cash basis), multi-currency with a
 * consolidated USD total. Income = issued receipts (premium individual/group +
 * cash-service); expenses = paid requisitions + expenditures. Amounts are kept
 * per-currency (no implicit conversion); the consolidated block converts to the
 * USD base using fx_rates (USD = 1; currencies without a rate are listed as
 * unconvertible and excluded from the consolidated total).
 */
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { paymentReceipts, serviceReceipts, requisitions, expenditures, policies } from "@shared/schema";

export interface StatementParams {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  branchId?: string;
}

type AmountMap = Record<string, number>;

function add(map: AmountMap, currency: string, amount: number) {
  const c = (currency || "USD").toUpperCase();
  map[c] = (map[c] || 0) + amount;
}

function fromTs(date: string) { return new Date(date + "T00:00:00.000Z"); }
function toTs(date: string) { return new Date(date + "T23:59:59.999Z"); }

async function fxMapFor(orgId: string): Promise<Record<string, number>> {
  const rates = await storage.getFxRates(orgId);
  const map: Record<string, number> = { USD: 1 };
  for (const r of rates) map[r.currency.toUpperCase()] = parseFloat(String(r.rateToUsd));
  return map;
}

/** Consolidate a per-currency map into a USD total; report currencies with no rate. Exported for tests. */
export function consolidateToUsd(map: AmountMap, fx: Record<string, number>): { usd: number; unconvertible: string[] } {
  return consolidate(map, fx);
}

/** Consolidate a per-currency map into a USD total; report currencies with no rate. */
function consolidate(map: AmountMap, fx: Record<string, number>): { usd: number; unconvertible: string[] } {
  let usd = 0;
  const unconvertible: string[] = [];
  for (const [currency, amount] of Object.entries(map)) {
    if (Math.abs(amount) < 0.005) continue;
    const rate = fx[currency];
    if (rate == null) { if (!unconvertible.includes(currency)) unconvertible.push(currency); continue; }
    usd += amount * rate;
  }
  return { usd: Number(usd.toFixed(2)), unconvertible };
}

const round2 = (m: AmountMap): AmountMap =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed(2))]));

export async function buildIncomeStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const fx = await fxMapFor(orgId);

  // ── Income: premium receipts split individual vs group ──
  const prConds = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    gte(paymentReceipts.issuedAt, fromTs(from)),
    lte(paymentReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) prConds.push(eq(paymentReceipts.branchId, branchId));
  const premiumRows = await tdb
    .select({
      currency: paymentReceipts.currency,
      isGroup: sql<boolean>`${policies.groupId} IS NOT NULL`,
      total: sql<string>`COALESCE(SUM(${paymentReceipts.amount}), '0')`,
    })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .where(and(...prConds))
    .groupBy(paymentReceipts.currency, sql`${policies.groupId} IS NOT NULL`);

  const premiumIndividual: AmountMap = {};
  const premiumGroup: AmountMap = {};
  for (const r of premiumRows) {
    const amt = parseFloat(r.total);
    if (r.isGroup) add(premiumGroup, r.currency, amt);
    else add(premiumIndividual, r.currency, amt);
  }

  // ── Income: cash-service receipts ──
  const srConds = [
    eq(serviceReceipts.organizationId, orgId),
    eq(serviceReceipts.status, "issued"),
    gte(serviceReceipts.issuedAt, fromTs(from)),
    lte(serviceReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) srConds.push(eq(serviceReceipts.branchId, branchId));
  const serviceRows = await tdb
    .select({ currency: serviceReceipts.currency, total: sql<string>`COALESCE(SUM(${serviceReceipts.amount}), '0')` })
    .from(serviceReceipts).where(and(...srConds)).groupBy(serviceReceipts.currency);
  const cashServices: AmountMap = {};
  for (const r of serviceRows) add(cashServices, r.currency, parseFloat(r.total));

  // ── Expenses: paid requisitions by category ──
  const reqConds = [
    eq(requisitions.organizationId, orgId),
    eq(requisitions.status, "paid"),
    gte(requisitions.paidDate, from),
    lte(requisitions.paidDate, to),
  ];
  if (branchId) reqConds.push(eq(requisitions.branchId, branchId));
  const reqRows = await tdb
    .select({ currency: requisitions.currency, category: requisitions.category, total: sql<string>`COALESCE(SUM(${requisitions.amount}), '0')` })
    .from(requisitions).where(and(...reqConds)).groupBy(requisitions.currency, requisitions.category);

  // ── Expenses: expenditures by category (cash basis on spent_at, fallback created_at) ──
  const expDateExpr = sql`COALESCE(${expenditures.spentAt}, ${expenditures.createdAt}::date)`;
  const expConds = [
    eq(expenditures.organizationId, orgId),
    sql`${expDateExpr} >= ${from}`,
    sql`${expDateExpr} <= ${to}`,
  ];
  if (branchId) expConds.push(eq(expenditures.branchId, branchId));
  const expRows = await tdb
    .select({ currency: expenditures.currency, category: expenditures.category, total: sql<string>`COALESCE(SUM(${expenditures.amount}), '0')` })
    .from(expenditures).where(and(...expConds)).groupBy(expenditures.currency, expenditures.category);

  // Assemble expense lines (category, source) and totals.
  const expenseLines: { label: string; source: "requisition" | "expenditure"; amounts: AmountMap }[] = [];
  const expenseByKey = new Map<string, { label: string; source: "requisition" | "expenditure"; amounts: AmountMap }>();
  const pushExpense = (label: string, source: "requisition" | "expenditure", currency: string, amount: number) => {
    const key = `${source}:${label}`;
    let line = expenseByKey.get(key);
    if (!line) { line = { label, source, amounts: {} }; expenseByKey.set(key, line); expenseLines.push(line); }
    add(line.amounts, currency, amount);
  };
  for (const r of reqRows) pushExpense(r.category || "Uncategorised", "requisition", r.currency, parseFloat(r.total));
  for (const r of expRows) pushExpense(r.category || "Uncategorised", "expenditure", r.currency, parseFloat(r.total));

  // Totals per currency.
  const incomeTotal: AmountMap = {};
  for (const m of [premiumIndividual, premiumGroup, cashServices]) for (const [c, v] of Object.entries(m)) add(incomeTotal, c, v);
  const expenseTotal: AmountMap = {};
  for (const line of expenseLines) for (const [c, v] of Object.entries(line.amounts)) add(expenseTotal, c, v);
  const net: AmountMap = {};
  for (const [c, v] of Object.entries(incomeTotal)) add(net, c, v);
  for (const [c, v] of Object.entries(expenseTotal)) add(net, c, -v);

  const currencies = Array.from(new Set([...Object.keys(incomeTotal), ...Object.keys(expenseTotal)])).sort();
  const cIncome = consolidate(incomeTotal, fx);
  const cExpense = consolidate(expenseTotal, fx);
  const cNet = consolidate(net, fx);

  return {
    from, to, branchId: branchId ?? null, currencies, fxRates: fx,
    income: {
      premiumIndividual: round2(premiumIndividual),
      premiumGroup: round2(premiumGroup),
      cashServices: round2(cashServices),
      total: round2(incomeTotal),
    },
    expenses: {
      lines: expenseLines.map((l) => ({ ...l, amounts: round2(l.amounts) })),
      total: round2(expenseTotal),
    },
    net: round2(net),
    consolidatedUsd: {
      income: cIncome.usd,
      expenses: cExpense.usd,
      net: Number((cIncome.usd - cExpense.usd).toFixed(2)),
      unconvertible: Array.from(new Set([...cIncome.unconvertible, ...cExpense.unconvertible, ...cNet.unconvertible])),
    },
  };
}

export async function buildCashFlowStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const fx = await fxMapFor(orgId);

  // Cash IN by channel (premium + service receipts).
  const inByChannel: Record<string, AmountMap> = {};
  const addIn = (channel: string, currency: string, amt: number) => {
    const ch = channel || "other";
    inByChannel[ch] = inByChannel[ch] || {};
    add(inByChannel[ch], currency, amt);
  };

  const prConds = [
    eq(paymentReceipts.organizationId, orgId), eq(paymentReceipts.status, "issued"),
    gte(paymentReceipts.issuedAt, fromTs(from)), lte(paymentReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) prConds.push(eq(paymentReceipts.branchId, branchId));
  const prRows = await tdb
    .select({ channel: paymentReceipts.paymentChannel, currency: paymentReceipts.currency, total: sql<string>`COALESCE(SUM(${paymentReceipts.amount}), '0')` })
    .from(paymentReceipts).where(and(...prConds)).groupBy(paymentReceipts.paymentChannel, paymentReceipts.currency);
  for (const r of prRows) addIn(r.channel, r.currency, parseFloat(r.total));

  const srConds = [
    eq(serviceReceipts.organizationId, orgId), eq(serviceReceipts.status, "issued"),
    gte(serviceReceipts.issuedAt, fromTs(from)), lte(serviceReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) srConds.push(eq(serviceReceipts.branchId, branchId));
  const srRows = await tdb
    .select({ channel: serviceReceipts.paymentChannel, currency: serviceReceipts.currency, total: sql<string>`COALESCE(SUM(${serviceReceipts.amount}), '0')` })
    .from(serviceReceipts).where(and(...srConds)).groupBy(serviceReceipts.paymentChannel, serviceReceipts.currency);
  for (const r of srRows) addIn(r.channel, r.currency, parseFloat(r.total));

  // Cash OUT (paid requisitions + expenditures).
  const reqConds = [
    eq(requisitions.organizationId, orgId), eq(requisitions.status, "paid"),
    gte(requisitions.paidDate, from), lte(requisitions.paidDate, to),
  ];
  if (branchId) reqConds.push(eq(requisitions.branchId, branchId));
  const reqRows = await tdb
    .select({ currency: requisitions.currency, total: sql<string>`COALESCE(SUM(${requisitions.amount}), '0')` })
    .from(requisitions).where(and(...reqConds)).groupBy(requisitions.currency);

  const expDateExpr = sql`COALESCE(${expenditures.spentAt}, ${expenditures.createdAt}::date)`;
  const expConds = [eq(expenditures.organizationId, orgId), sql`${expDateExpr} >= ${from}`, sql`${expDateExpr} <= ${to}`];
  if (branchId) expConds.push(eq(expenditures.branchId, branchId));
  const expRows = await tdb
    .select({ currency: expenditures.currency, total: sql<string>`COALESCE(SUM(${expenditures.amount}), '0')` })
    .from(expenditures).where(and(...expConds)).groupBy(expenditures.currency);

  const cashIn: AmountMap = {};
  for (const ch of Object.values(inByChannel)) for (const [c, v] of Object.entries(ch)) add(cashIn, c, v);
  const requisitionsOut: AmountMap = {};
  for (const r of reqRows) add(requisitionsOut, r.currency, parseFloat(r.total));
  const expendituresOut: AmountMap = {};
  for (const r of expRows) add(expendituresOut, r.currency, parseFloat(r.total));
  const cashOut: AmountMap = {};
  for (const m of [requisitionsOut, expendituresOut]) for (const [c, v] of Object.entries(m)) add(cashOut, c, v);
  const netCash: AmountMap = {};
  for (const [c, v] of Object.entries(cashIn)) add(netCash, c, v);
  for (const [c, v] of Object.entries(cashOut)) add(netCash, c, -v);

  const currencies = Array.from(new Set([...Object.keys(cashIn), ...Object.keys(cashOut)])).sort();
  const cIn = consolidate(cashIn, fx);
  const cOut = consolidate(cashOut, fx);

  // Cash-up reconciliation for the period (confirmed daily cash counts).
  const cashups = await storage.getCashups(orgId, 200, { fromDate: from, toDate: to, ...(branchId ? { } : {}) });

  return {
    from, to, branchId: branchId ?? null, currencies, fxRates: fx,
    inflowsByChannel: Object.fromEntries(Object.entries(inByChannel).map(([k, v]) => [k, round2(v)])),
    cashIn: round2(cashIn),
    outflows: {
      requisitions: round2(requisitionsOut),
      expenditures: round2(expendituresOut),
      total: round2(cashOut),
    },
    netCash: round2(netCash),
    consolidatedUsd: {
      cashIn: cIn.usd,
      cashOut: cOut.usd,
      netCash: Number((cIn.usd - cOut.usd).toFixed(2)),
      unconvertible: Array.from(new Set([...cIn.unconvertible, ...cOut.unconvertible])),
    },
    cashups: cashups.map((c: any) => ({
      id: c.id, cashupDate: c.cashupDate, currency: c.currency, status: c.status,
      totalAmount: c.totalAmount, countedTotal: c.countedTotal, discrepancyAmount: c.discrepancyAmount,
    })),
  };
}
