/**
 * Income statement & cash-flow statement (cash basis), multi-currency with a
 * consolidated USD total.
 *
 * Income  = issued premium + service receipts (cash received).
 * Expenses = payment_disbursements (single cash-out ledger, covering requisitions
 *            and expenditures) + paid commission ledger entries.
 *
 * Amounts are kept per-currency (no implicit conversion). The consolidated block
 * converts to USD using fx_rates; currencies without a rate are listed as
 * unconvertible and excluded from that total.
 */
import { and, eq, gte, lte, sql, inArray, desc } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { todayInHarare } from "./date-utils";
import {
  paymentReceipts,
  serviceReceipts,
  paymentDisbursements,
  commissionLedgerEntries,
  platformReceivables,
  claims,
  policies,
  requisitions,
  expenditures,
  clients,
  users,
  branches,
  funeralCases,
} from "@shared/schema";

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

export async function fxMapFor(orgId: string): Promise<Record<string, number>> {
  const rates = await storage.getFxRates(orgId);
  const map: Record<string, number> = { USD: 1 };
  for (const r of rates) map[r.currency.toUpperCase()] = parseFloat(String(r.rateToUsd));
  return map;
}

/** Consolidate a per-currency map into a USD total; report currencies with no rate. Exported for tests. */
export function consolidateToUsd(map: AmountMap, fx: Record<string, number>): { usd: number; unconvertible: string[] } {
  return consolidate(map, fx);
}

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

// ─── Shared query helpers ──────────────────────────────────────────────────

/** Premium + service receipts in the period, grouped by currency and payment channel. */
async function queryReceipts(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const prConds: any[] = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    gte(paymentReceipts.issuedAt, fromTs(from)),
    lte(paymentReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) prConds.push(eq(paymentReceipts.branchId, branchId));

  const premiumRows = await tdb
    .select({
      currency: paymentReceipts.currency,
      channel: paymentReceipts.paymentChannel,
      isGroup: sql<boolean>`${policies.groupId} IS NOT NULL`,
      total: sql<string>`COALESCE(SUM(${paymentReceipts.amount}), '0')`,
    })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .where(and(...prConds))
    .groupBy(paymentReceipts.currency, paymentReceipts.paymentChannel, sql`${policies.groupId} IS NOT NULL`);

  const srConds: any[] = [
    eq(serviceReceipts.organizationId, orgId),
    eq(serviceReceipts.status, "issued"),
    gte(serviceReceipts.issuedAt, fromTs(from)),
    lte(serviceReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) srConds.push(eq(serviceReceipts.branchId, branchId));
  const serviceRows = await tdb
    .select({
      currency: serviceReceipts.currency,
      channel: serviceReceipts.paymentChannel,
      total: sql<string>`COALESCE(SUM(${serviceReceipts.amount}), '0')`,
    })
    .from(serviceReceipts).where(and(...srConds))
    .groupBy(serviceReceipts.currency, serviceReceipts.paymentChannel);

  return { premiumRows, serviceRows };
}

/** Cash-out disbursements in the period (from payment_disbursements ledger). */
async function queryDisbursements(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const conds: any[] = [
    eq(paymentDisbursements.organizationId, orgId),
    sql`${paymentDisbursements.paidDate} >= ${from}`,
    sql`${paymentDisbursements.paidDate} <= ${to}`,
  ];
  if (branchId) conds.push(eq(paymentDisbursements.branchId, branchId));

  return tdb
    .select({
      entityType: paymentDisbursements.entityType,
      entityId: paymentDisbursements.entityId,
      currency: paymentDisbursements.currency,
      total: sql<string>`COALESCE(SUM(${paymentDisbursements.amount}), '0')`,
    })
    .from(paymentDisbursements)
    .where(and(...conds))
    .groupBy(paymentDisbursements.entityType, paymentDisbursements.entityId, paymentDisbursements.currency);
}

/** Commission ledger entries with status='paid' in the period. */
async function queryCommissions(tdb: any, orgId: string, from: string, to: string) {
  return tdb
    .select({
      currency: commissionLedgerEntries.currency,
      total: sql<string>`COALESCE(SUM(${commissionLedgerEntries.amount}), '0')`,
    })
    .from(commissionLedgerEntries)
    .where(and(
      eq(commissionLedgerEntries.organizationId, orgId),
      eq(commissionLedgerEntries.status, "paid"),
      sql`${commissionLedgerEntries.createdAt} >= ${fromTs(from)}`,
      sql`${commissionLedgerEntries.createdAt} <= ${toTs(to)}`,
    ))
    .groupBy(commissionLedgerEntries.currency);
}

// ─── Legacy group receipts (no policy — cash subscriptions) ───────────────

async function queryLegacyGroupReceipts(tdb: any, orgId: string, from: string, to: string) {
  try {
    const rows = await tdb.execute(
      sql`SELECT currency, SUM(amount)::text AS total
          FROM legacy_group_receipts
          WHERE organization_id = ${orgId}
            AND payment_date >= ${from}::date
            AND payment_date <= ${to}::date
          GROUP BY currency`
    );
    return (rows.rows ?? rows) as { currency: string; total: string }[];
  } catch {
    return [];
  }
}

// ─── Income Statement ──────────────────────────────────────────────────────

export async function buildIncomeStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const fx = await fxMapFor(orgId);

  const { premiumRows, serviceRows } = await queryReceipts(tdb, orgId, from, to, branchId);
  const legacyRows = await queryLegacyGroupReceipts(tdb, orgId, from, to);
  const disbRows = await queryDisbursements(tdb, orgId, from, to, branchId);
  const commRows = await queryCommissions(tdb, orgId, from, to);

  // ── Income ──
  const premiumIndividual: AmountMap = {};
  const premiumGroup: AmountMap = {};
  for (const r of premiumRows) {
    if (r.isGroup) add(premiumGroup, r.currency, parseFloat(r.total));
    else add(premiumIndividual, r.currency, parseFloat(r.total));
  }
  const cashServices: AmountMap = {};
  for (const r of serviceRows) add(cashServices, r.currency, parseFloat(r.total));
  const legacyGroupIncome: AmountMap = {};
  for (const r of legacyRows) add(legacyGroupIncome, r.currency, parseFloat(r.total));

  // ── Expenses — look up entity categories in bulk ──
  // Collect unique entity IDs per type so we can join category labels.
  const reqIds = disbRows.filter((d: any) => d.entityType === "requisition").map((d: any) => d.entityId as string);
  const expIds = disbRows.filter((d: any) => d.entityType === "expenditure").map((d: any) => d.entityId as string);

  // Fetch categories for requisitions and expenditures in one query each.
  const reqCategoryMap: Record<string, string> = {};
  if (reqIds.length) {
    const rows = await tdb.select({ id: requisitions.id, category: requisitions.category })
      .from(requisitions).where(inArray(requisitions.id, reqIds));
    for (const r of rows) reqCategoryMap[r.id] = r.category || "Uncategorised";
  }
  const expCategoryMap: Record<string, string> = {};
  if (expIds.length) {
    const rows = await tdb.select({ id: expenditures.id, category: expenditures.category })
      .from(expenditures).where(inArray(expenditures.id, expIds));
    for (const r of rows) expCategoryMap[r.id] = r.category || "Uncategorised";
  }

  const expenseLines: { label: string; source: "requisition" | "expenditure" | "commission"; amounts: AmountMap }[] = [];
  const expenseByKey: Record<string, { label: string; source: "requisition" | "expenditure" | "commission"; amounts: AmountMap }> = {};
  const pushExpense = (label: string, source: "requisition" | "expenditure" | "commission", currency: string, amount: number) => {
    const key = `${source}:${label}`;
    if (!expenseByKey[key]) {
      expenseByKey[key] = { label, source, amounts: {} };
      expenseLines.push(expenseByKey[key]);
    }
    add(expenseByKey[key].amounts, currency, amount);
  };

  for (const d of disbRows) {
    const type = d.entityType as "requisition" | "expenditure";
    const cat = type === "requisition" ? (reqCategoryMap[d.entityId] || "Uncategorised") : (expCategoryMap[d.entityId] || "Uncategorised");
    pushExpense(cat, type, d.currency, parseFloat(d.total));
  }
  for (const r of commRows) {
    pushExpense("Agent commissions", "commission", r.currency, parseFloat(r.total));
  }

  // ── Totals ──
  const incomeTotal: AmountMap = {};
  for (const m of [premiumIndividual, premiumGroup, cashServices, legacyGroupIncome]) for (const [c, v] of Object.entries(m)) add(incomeTotal, c, v);
  const expenseTotal: AmountMap = {};
  for (const line of expenseLines) for (const [c, v] of Object.entries(line.amounts)) add(expenseTotal, c, v);
  const net: AmountMap = {};
  for (const [c, v] of Object.entries(incomeTotal)) add(net, c, v);
  for (const [c, v] of Object.entries(expenseTotal)) add(net, c, -v);

  const allCurrencies = Object.keys(incomeTotal).concat(Object.keys(expenseTotal));
  const currencies = allCurrencies.filter((c, i) => allCurrencies.indexOf(c) === i).sort();
  const cIncome = consolidate(incomeTotal, fx);
  const cExpense = consolidate(expenseTotal, fx);

  return {
    from, to, branchId: branchId ?? null, currencies, fxRates: fx,
    income: {
      premiumIndividual: round2(premiumIndividual),
      premiumGroup: round2(premiumGroup),
      cashServices: round2(cashServices),
      legacyGroupIncome: round2(legacyGroupIncome),
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
      unconvertible: Array.from(new Set([...cIncome.unconvertible, ...cExpense.unconvertible])),
    },
  };
}

// ─── Cash Flow Statement ───────────────────────────────────────────────────

export async function buildCashFlowStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const fx = await fxMapFor(orgId);

  const { premiumRows, serviceRows } = await queryReceipts(tdb, orgId, from, to, branchId);
  const legacyRows = await queryLegacyGroupReceipts(tdb, orgId, from, to);
  const disbRows = await queryDisbursements(tdb, orgId, from, to, branchId);
  const commRows = await queryCommissions(tdb, orgId, from, to);

  // ── Cash IN by channel ──
  const inByChannel: Record<string, AmountMap> = {};
  const addIn = (channel: string, currency: string, amt: number) => {
    const ch = channel || "other";
    inByChannel[ch] = inByChannel[ch] || {};
    add(inByChannel[ch], currency, amt);
  };
  for (const r of premiumRows) addIn(r.channel, r.currency, parseFloat(r.total));
  for (const r of serviceRows) addIn(r.channel, r.currency, parseFloat(r.total));
  for (const r of legacyRows) addIn("cash", r.currency, parseFloat(r.total));

  // ── Cash OUT — from payment_disbursements ledger + commissions ──
  const requisitionsOut: AmountMap = {};
  const expendituresOut: AmountMap = {};
  const commissionsOut: AmountMap = {};
  for (const d of disbRows) {
    if (d.entityType === "requisition") add(requisitionsOut, d.currency, parseFloat(d.total));
    else add(expendituresOut, d.currency, parseFloat(d.total));
  }
  for (const r of commRows) add(commissionsOut, r.currency, parseFloat(r.total));

  const cashIn: AmountMap = {};
  for (const ch of Object.values(inByChannel)) for (const [c, v] of Object.entries(ch)) add(cashIn, c, v);
  const cashOut: AmountMap = {};
  for (const m of [requisitionsOut, expendituresOut, commissionsOut]) for (const [c, v] of Object.entries(m)) add(cashOut, c, v);
  const netCash: AmountMap = {};
  for (const [c, v] of Object.entries(cashIn)) add(netCash, c, v);
  for (const [c, v] of Object.entries(cashOut)) add(netCash, c, -v);

  const allCurrencies = Object.keys(cashIn).concat(Object.keys(cashOut));
  const currencies = allCurrencies.filter((c, i) => allCurrencies.indexOf(c) === i).sort();
  const cIn = consolidate(cashIn, fx);
  const cOut = consolidate(cashOut, fx);

  // Cash-up reconciliation for the period.
  const cashups = await storage.getCashups(orgId, 200, { fromDate: from, toDate: to });

  // Bank deposits in the period (cash banked by admins).
  const deposits = await storage.getBankDeposits(orgId, { fromDate: from, toDate: to });
  const depositsByMethod: AmountMap = {};
  for (const d of deposits) add(depositsByMethod, d.currency, parseFloat(String(d.amount)));

  return {
    from, to, branchId: branchId ?? null, currencies, fxRates: fx,
    inflowsByChannel: Object.fromEntries(Object.entries(inByChannel).map(([k, v]) => [k, round2(v)])),
    cashIn: round2(cashIn),
    outflows: {
      requisitions: round2(requisitionsOut),
      expenditures: round2(expendituresOut),
      commissions: round2(commissionsOut),
      total: round2(cashOut),
    },
    netCash: round2(netCash),
    consolidatedUsd: {
      cashIn: cIn.usd,
      cashOut: cOut.usd,
      netCash: Number((cIn.usd - cOut.usd).toFixed(2)),
      unconvertible: Array.from(new Set([...cIn.unconvertible, ...cOut.unconvertible])),
    },
    bankDeposits: {
      total: round2(depositsByMethod),
      count: deposits.length,
    },
    cashups: cashups.map((c: any) => ({
      id: c.id, cashupDate: c.cashupDate, currency: c.currency, status: c.status,
      totalAmount: c.totalAmount, countedTotal: c.countedTotal, discrepancyAmount: c.discrepancyAmount,
    })),
  };
}

// ─── Transaction Ledger ─────────────────────────────────────────────────────
// Row-level detail behind the income statement / cash flow totals above —
// every individual transaction in the period, with who recorded it and which
// department / cost-centre it belongs to.

export interface LedgerEntry {
  date: string;          // YYYY-MM-DD
  type: "income" | "expense";
  source: "premium" | "cash_service" | "legacy_group" | "requisition" | "expenditure" | "commission";
  description: string;
  reference: string | null;
  person: string | null;
  department: string | null;
  amount: number;
  currency: string;
}

export interface LedgerParams extends StatementParams {
  limit?: number;
  offset?: number;
}

function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || null;
}

export async function buildTransactionLedger(orgId: string, params: LedgerParams): Promise<{ from: string; to: string; branchId: string | null; total: number; entries: LedgerEntry[] }> {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const limit = Math.min(params.limit ?? 500, 2000);
  const offset = params.offset ?? 0;

  const entries: LedgerEntry[] = [];

  // ── Premium receipts (individual + group policies) ──
  const prConds: any[] = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    gte(paymentReceipts.issuedAt, fromTs(from)),
    lte(paymentReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) prConds.push(eq(paymentReceipts.branchId, branchId));
  const premiumRows = await tdb
    .select({
      issuedAt: paymentReceipts.issuedAt,
      receiptNumber: paymentReceipts.receiptNumber,
      amount: paymentReceipts.amount,
      currency: paymentReceipts.currency,
      policyNumber: policies.policyNumber,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
      branchName: branches.name,
      issuerFirstName: users.displayName,
    })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .leftJoin(clients, eq(paymentReceipts.clientId, clients.id))
    .leftJoin(branches, eq(paymentReceipts.branchId, branches.id))
    .leftJoin(users, eq(paymentReceipts.issuedByUserId, users.id))
    .where(and(...prConds));
  for (const r of premiumRows) {
    entries.push({
      date: new Date(r.issuedAt).toISOString().slice(0, 10),
      type: "income",
      source: "premium",
      description: `Premium — ${r.policyNumber}${r.clientFirstName ? ` (${fullName(r.clientFirstName, r.clientLastName)})` : ""}`,
      reference: r.receiptNumber,
      person: r.issuerFirstName ?? null,
      department: r.branchName ?? null,
      amount: parseFloat(r.amount),
      currency: r.currency,
    });
  }

  // ── Cash-service receipts (funeral cases) ──
  const srConds: any[] = [
    eq(serviceReceipts.organizationId, orgId),
    eq(serviceReceipts.status, "issued"),
    gte(serviceReceipts.issuedAt, fromTs(from)),
    lte(serviceReceipts.issuedAt, toTs(to)),
  ];
  if (branchId) srConds.push(eq(serviceReceipts.branchId, branchId));
  const serviceRows = await tdb
    .select({
      issuedAt: serviceReceipts.issuedAt,
      receiptNumber: serviceReceipts.receiptNumber,
      amount: serviceReceipts.amount,
      currency: serviceReceipts.currency,
      deceasedName: funeralCases.deceasedName,
      issuerName: users.displayName,
    })
    .from(serviceReceipts)
    .leftJoin(funeralCases, eq(serviceReceipts.funeralCaseId, funeralCases.id))
    .leftJoin(users, eq(serviceReceipts.issuedByUserId, users.id))
    .where(and(...srConds));
  for (const r of serviceRows) {
    entries.push({
      date: new Date(r.issuedAt).toISOString().slice(0, 10),
      type: "income",
      source: "cash_service",
      description: `Cash service${r.deceasedName ? ` — ${r.deceasedName}` : ""}`,
      reference: r.receiptNumber,
      person: r.issuerName ?? null,
      department: "Funeral Services",
      amount: parseFloat(r.amount),
      currency: r.currency,
    });
  }

  // ── Legacy group receipts (Falakhe-style tenants only — table may not exist elsewhere) ──
  try {
    const rows = await tdb.execute(sql`
      SELECT receipt_number, amount, currency, group_name, payment_date
      FROM legacy_group_receipts
      WHERE organization_id = ${orgId}
        AND payment_date >= ${from}::date
        AND payment_date <= ${to}::date
    `);
    const legacyRows = (rows.rows ?? rows) as { receipt_number: string; amount: string; currency: string; group_name: string; payment_date: string }[];
    for (const r of legacyRows) {
      entries.push({
        date: new Date(r.payment_date).toISOString().slice(0, 10),
        type: "income",
        source: "legacy_group",
        description: `Legacy group receipt — ${r.group_name}`,
        reference: r.receipt_number,
        person: null,
        department: r.group_name,
        amount: parseFloat(r.amount),
        currency: r.currency,
      });
    }
  } catch { /* legacy_group_receipts table doesn't exist for this org — skip */ }

  // ── Disbursements (requisitions + expenditures paid out) ──
  const disbConds: any[] = [
    eq(paymentDisbursements.organizationId, orgId),
    sql`${paymentDisbursements.paidDate} >= ${from}`,
    sql`${paymentDisbursements.paidDate} <= ${to}`,
  ];
  if (branchId) disbConds.push(eq(paymentDisbursements.branchId, branchId));
  const disbRows = await tdb
    .select({
      paidDate: paymentDisbursements.paidDate,
      voucherNumber: paymentDisbursements.voucherNumber,
      entityType: paymentDisbursements.entityType,
      entityId: paymentDisbursements.entityId,
      amount: paymentDisbursements.amount,
      currency: paymentDisbursements.currency,
      paidByUserId: paymentDisbursements.paidByUserId,
    })
    .from(paymentDisbursements)
    .where(and(...disbConds));

  const reqIds = disbRows.filter((d: any) => d.entityType === "requisition").map((d: any) => d.entityId as string);
  const expIds = disbRows.filter((d: any) => d.entityType === "expenditure").map((d: any) => d.entityId as string);
  const reqMap: Record<string, { description: string; category: string; department: string | null }> = {};
  if (reqIds.length) {
    const rows = await tdb.select({
      id: requisitions.id, description: requisitions.description, category: requisitions.category, department: requisitions.department,
    }).from(requisitions).where(inArray(requisitions.id, reqIds));
    for (const r of rows) reqMap[r.id] = { description: r.description, category: r.category, department: r.department };
  }
  const expMap: Record<string, { description: string; category: string }> = {};
  if (expIds.length) {
    const rows = await tdb.select({
      id: expenditures.id, description: expenditures.description, category: expenditures.category,
    }).from(expenditures).where(inArray(expenditures.id, expIds));
    for (const r of rows) expMap[r.id] = { description: r.description, category: r.category };
  }
  const payerIds = Array.from(new Set(disbRows.map((d: any) => d.paidByUserId).filter(Boolean))) as string[];
  const payerMap: Record<string, string | null> = {};
  if (payerIds.length) {
    const rows = await tdb.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, payerIds));
    for (const r of rows) payerMap[r.id] = r.displayName;
  }
  for (const d of disbRows) {
    const isReq = d.entityType === "requisition";
    const info = isReq ? reqMap[d.entityId] : expMap[d.entityId];
    entries.push({
      date: String(d.paidDate),
      type: "expense",
      source: isReq ? "requisition" : "expenditure",
      description: info?.description || (isReq ? "Requisition" : "Expenditure"),
      reference: d.voucherNumber ?? null,
      person: d.paidByUserId ? (payerMap[d.paidByUserId] ?? null) : null,
      department: (isReq ? (info as any)?.department : null) || info?.category || "Uncategorised",
      amount: parseFloat(d.amount),
      currency: d.currency,
    });
  }

  // ── Paid agent commissions ──
  const commRows = await tdb
    .select({
      createdAt: commissionLedgerEntries.createdAt,
      amount: commissionLedgerEntries.amount,
      currency: commissionLedgerEntries.currency,
      description: commissionLedgerEntries.description,
      agentName: users.displayName,
    })
    .from(commissionLedgerEntries)
    .leftJoin(users, eq(commissionLedgerEntries.agentId, users.id))
    .where(and(
      eq(commissionLedgerEntries.organizationId, orgId),
      eq(commissionLedgerEntries.status, "paid"),
      gte(commissionLedgerEntries.createdAt, fromTs(from)),
      lte(commissionLedgerEntries.createdAt, toTs(to)),
    ));
  for (const r of commRows) {
    entries.push({
      date: new Date(r.createdAt).toISOString().slice(0, 10),
      type: "expense",
      source: "commission",
      description: r.description || "Agent commission",
      reference: null,
      person: r.agentName ?? null,
      department: "Commissions",
      amount: parseFloat(r.amount),
      currency: r.currency,
    });
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = entries.length;
  return { from, to, branchId: branchId ?? null, total, entries: entries.slice(offset, offset + limit) };
}

// ─── Balance Sheet ─────────────────────────────────────────────────────────
//
// Structure:
//   Assets     = Current (cash, bank, receivables) + Non-current (manual: fixed assets, investments)
//   Liabilities = Current (claims payable, platform fees, manual) + Non-current (loans, manual)
//   Equity      = Retained earnings (derived) + Capital contributions (manual)
//
// Accounting equation check: Assets = Liabilities + Equity
// (any gap is shown as "retained earnings adjustment")

export interface BalanceSheetParams {
  asOf: string;    // YYYY-MM-DD — point-in-time date
  branchId?: string;
}

export interface BsLine {
  id?: string;        // set for manual entries
  label: string;
  amounts: AmountMap;
  source: "derived" | "manual";
  notes?: string;
}

export async function buildBalanceSheet(orgId: string, params: BalanceSheetParams) {
  const { asOf, branchId } = params;
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);

  // ── ASSETS ──────────────────────────────────────────────────

  // 1. Cash on hand (unbanked cash held by admins) — scoped to asOf, not "now",
  // so a historical balance sheet doesn't mix a live cash position with a past date.
  const positions = await storage.getAdminCashPosition(orgId, asOf);
  const cashOnHand: AmountMap = {};
  for (const p of positions) {
    if (p.onHand > 0) add(cashOnHand, p.currency, p.onHand);
  }

  // 2. Bank balances — latest statement balance per account on or before asOf
  const allAccounts = await storage.getBankAccounts(orgId);
  const bankLines: BsLine[] = [];
  for (const acct of allAccounts.filter(a => a.isActive)) {
    const balances = await storage.getBankStatementBalances(orgId, acct.id);
    const latest = balances.find(b => b.statementDate <= asOf);
    if (latest) {
      bankLines.push({
        label: `Bank — ${acct.accountName}`,
        amounts: { [acct.currency]: parseFloat(String(latest.closingBalance)) },
        source: "derived",
      });
    }
  }

  // 3. Premium receivables — premiums owed by grace-period policyholders (one missed cycle)
  //    and active policies where the current cycle has ended (admin hasn't run month-end yet).
  //    Conservative estimate: 1 × premium_amount per overdue policy.
  const receivableRows = await tdb.execute(sql`
    SELECT currency,
           COALESCE(SUM(premium_amount::numeric), 0) AS total
    FROM policies
    WHERE organization_id = ${orgId}
      AND status IN ('grace')
      AND premium_amount IS NOT NULL
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    GROUP BY currency
  `);
  // Also include active policies whose cycle ended before today (haven't been moved to grace yet)
  const activeOverdueRows = await tdb.execute(sql`
    SELECT currency,
           COALESCE(SUM(premium_amount::numeric), 0) AS total
    FROM policies
    WHERE organization_id = ${orgId}
      AND status = 'active'
      AND current_cycle_end IS NOT NULL
      AND current_cycle_end < ${asOf}
      AND premium_amount IS NOT NULL
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    GROUP BY currency
  `);
  const premiumReceivable: AmountMap = {};
  for (const r of [...(receivableRows.rows ?? receivableRows) as any[], ...(activeOverdueRows.rows ?? activeOverdueRows) as any[]]) {
    const amt = parseFloat(r.total ?? 0);
    if (amt > 0.005) add(premiumReceivable, r.currency, amt);
  }

  // ── LIABILITIES ─────────────────────────────────────────────

  // 4. Outstanding claims payable (approved, not yet paid)
  const claimRows = await tdb
    .select({ currency: claims.currency, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}), '0')` })
    .from(claims)
    .where(and(
      eq(claims.organizationId, orgId),
      eq(claims.status, "approved"),
      sql`${claims.cashInLieuAmount} IS NOT NULL`,
    ))
    .groupBy(claims.currency);
  const claimsPayable: AmountMap = {};
  for (const r of claimRows) {
    const amt = parseFloat(r.total);
    if (amt > 0.005) add(claimsPayable, r.currency, amt);
  }

  // 5. Platform fees payable (unsettled receivables owed to POL263)
  const pfRows = await tdb
    .select({ currency: platformReceivables.currency, total: sql<string>`COALESCE(SUM(${platformReceivables.amount}), '0')` })
    .from(platformReceivables)
    .where(and(eq(platformReceivables.organizationId, orgId), eq(platformReceivables.isSettled, false)))
    .groupBy(platformReceivables.currency);
  const platformPayable: AmountMap = {};
  for (const r of pfRows) {
    const amt = parseFloat(r.total);
    if (amt > 0.005) add(platformPayable, r.currency, amt);
  }

  // ── EQUITY — Retained Earnings (derived from cumulative P&L) ──
  // Run income statement from inception to asOf.
  const is = await buildIncomeStatement(orgId, { from: "2000-01-01", to: asOf, branchId });
  const retainedEarnings: AmountMap = {};
  for (const [c, v] of Object.entries(is.net)) {
    if (Math.abs(v) > 0.005) retainedEarnings[c] = v;
  }

  // ── MANUAL ENTRIES ───────────────────────────────────────────
  const manualEntries = await storage.getBalanceSheetEntries(orgId, { asOfDate: asOf });
  const toLine = (e: any): BsLine => ({
    id: e.id,
    label: e.label,
    amounts: { [e.currency]: parseFloat(String(e.amount)) },
    source: "manual",
    notes: e.notes,
  });

  const manualAssetCurrent    = manualEntries.filter(e => e.section === "asset"     && e.subsection === "current").map(toLine);
  const manualAssetNonCurrent = manualEntries.filter(e => e.section === "asset"     && e.subsection === "non_current").map(toLine);
  const manualLiabCurrent     = manualEntries.filter(e => e.section === "liability" && e.subsection === "current").map(toLine);
  const manualLiabNonCurrent  = manualEntries.filter(e => e.section === "liability" && e.subsection === "non_current").map(toLine);
  const manualEquity          = manualEntries.filter(e => e.section === "equity").map(toLine);

  // ── TOTALS ───────────────────────────────────────────────────
  const sumLines = (lines: BsLine[]): AmountMap => {
    const t: AmountMap = {};
    for (const l of lines) for (const [c, v] of Object.entries(l.amounts)) add(t, c, v);
    return t;
  };

  const assetCurrentDerived: BsLine[] = [
    ...(Object.keys(cashOnHand).length ? [{ label: "Cash on hand (unbanked)", amounts: cashOnHand, source: "derived" as const }] : []),
    ...bankLines,
    ...(Object.keys(premiumReceivable).length ? [{ label: "Premium receivables", amounts: premiumReceivable, source: "derived" as const }] : []),
    ...manualAssetCurrent,
  ];
  const assetNonCurrentLines = manualAssetNonCurrent;

  const liabCurrentLines: BsLine[] = [
    ...(Object.keys(claimsPayable).length ? [{ label: "Claims payable (approved)", amounts: claimsPayable, source: "derived" as const }] : []),
    ...(Object.keys(platformPayable).length ? [{ label: "Platform fees payable", amounts: platformPayable, source: "derived" as const }] : []),
    ...manualLiabCurrent,
  ];
  const liabNonCurrentLines = manualLiabNonCurrent;

  const equityLines: BsLine[] = [
    ...(Object.keys(retainedEarnings).length ? [{ label: "Retained earnings", amounts: retainedEarnings, source: "derived" as const }] : []),
    ...manualEquity,
  ];

  const totalAssets: AmountMap = {};
  for (const m of [sumLines(assetCurrentDerived), sumLines(assetNonCurrentLines)]) for (const [c, v] of Object.entries(m)) add(totalAssets, c, v);
  const totalLiabilities: AmountMap = {};
  for (const m of [sumLines(liabCurrentLines), sumLines(liabNonCurrentLines)]) for (const [c, v] of Object.entries(m)) add(totalLiabilities, c, v);
  const totalEquity: AmountMap = sumLines(equityLines);
  const liabPlusEquity: AmountMap = {};
  for (const m of [totalLiabilities, totalEquity]) for (const [c, v] of Object.entries(m)) add(liabPlusEquity, c, v);

  const allCurrencies = [
    ...Object.keys(totalAssets),
    ...Object.keys(totalLiabilities),
    ...Object.keys(totalEquity),
  ].filter((c, i, a) => a.indexOf(c) === i).sort();

  const cAssets = consolidate(totalAssets, fx);
  const cLiab = consolidate(totalLiabilities, fx);
  const cEquity = consolidate(totalEquity, fx);

  return {
    asOf, branchId: branchId ?? null, currencies: allCurrencies, fxRates: fx,
    assets: {
      current:    assetCurrentDerived,
      nonCurrent: assetNonCurrentLines,
      total: round2(totalAssets),
    },
    liabilities: {
      current:    liabCurrentLines,
      nonCurrent: liabNonCurrentLines,
      total: round2(totalLiabilities),
    },
    equity: {
      lines: equityLines,
      total: round2(totalEquity),
    },
    liabilitiesAndEquity: round2(liabPlusEquity),
    consolidatedUsd: {
      totalAssets: cAssets.usd,
      totalLiabilities: cLiab.usd,
      totalEquity: cEquity.usd,
      unconvertible: Array.from(new Set([...cAssets.unconvertible, ...cLiab.unconvertible, ...cEquity.unconvertible])),
    },
  };
}

export interface ExecutiveSummaryParams {
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
  branchId?: string;
}

/** Default range for callers that don't have their own — month-to-date. */
export function defaultExecutiveSummaryRange(): { from: string; to: string } {
  const to = todayInHarare();
  const from = `${to.slice(0, 7)}-01`;
  return { from, to };
}

/** Extracted from GET /api/dashboard/executive-summary so it can also be called
 *  directly (e.g. from server/ai-service.ts) without an internal HTTP round-trip. */
export async function buildExecutiveSummary(orgId: string, params: ExecutiveSummaryParams) {
  const { from, to, branchId } = params;
  const tdb = await getDbForOrg(orgId);

  const is = await buildIncomeStatement(orgId, { from, to, branchId });

  // Cash position as of the end of the requested period, not "now" — matters when
  // viewing a past period rather than the current month-to-date default.
  const positions = await storage.getAdminCashPosition(orgId, to);
  const posUserIds = positions.map((p) => p.userId);
  const posUsers = posUserIds.length ? await storage.getUsersByIds(posUserIds, orgId) : [];
  const findU = (id: string) => posUsers.find((u: any) => u.id === id);
  // Never blend currencies into one number — an admin's ZAR float and USD float are not
  // interchangeable, and summing them raw produces a total with no real-world meaning.
  const totalOnHand: Record<string, number> = {};
  const totalDeposited: Record<string, number> = {};
  for (const p of positions) {
    totalOnHand[p.currency] = (totalOnHand[p.currency] || 0) + Math.max(0, p.onHand);
    totalDeposited[p.currency] = (totalDeposited[p.currency] || 0) + p.totalDeposited;
  }

  const branchRows = await tdb.execute(sql`
    SELECT
      pr.branch_id,
      b.name AS branch_name,
      pr.currency,
      COALESCE(SUM(pr.amount::numeric), 0) AS income,
      COUNT(DISTINCT pr.policy_id)          AS policy_count
    FROM payment_receipts pr
    LEFT JOIN branches b ON b.id = pr.branch_id
    WHERE pr.organization_id = ${orgId}
      AND pr.status = 'issued'
      AND pr.issued_at >= ${from + "T00:00:00.000Z"}
      AND pr.issued_at <= ${to + "T23:59:59.999Z"}
      ${branchId ? sql`AND pr.branch_id = ${branchId}` : sql``}
    GROUP BY pr.branch_id, b.name, pr.currency
    ORDER BY income DESC
  `);

  const claimStats = await tdb.execute(sql`
    SELECT
      status,
      COUNT(*)                                       AS count,
      COALESCE(SUM(cash_in_lieu_amount::numeric), 0) AS total_value,
      COALESCE(currency, 'USD')                      AS currency
    FROM claims
    WHERE organization_id = ${orgId}
      AND created_at >= ${from + "T00:00:00.000Z"}
      AND created_at <= ${to + "T23:59:59.999Z"}
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    GROUP BY status, COALESCE(currency, 'USD')
  `);

  const newPolicies = await tdb.execute(sql`
    SELECT COUNT(*) AS count
    FROM policies
    WHERE organization_id = ${orgId}
      AND created_at >= ${from + "T00:00:00.000Z"}
      AND created_at <= ${to + "T23:59:59.999Z"}
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
  `);

  // Tenant-configurable cross-border breakdown (see country_flag_settings) — off for
  // every org except the ones that opted in, so skip the extra queries entirely when unused.
  const countryFlagSettings = await storage.getCountryFlagSettings(orgId);
  let countryFlag: {
    flagLabel: string;
    homeLabel: string;
    revenueByCountry: { flagged: boolean; currency: string; income: number; policyCount: number }[];
    serviceCount: number;
    costByCurrency: { currency: string; cost: number; requisitionCount: number }[];
  } | null = null;
  if (countryFlagSettings.isEnabled) {
    const countryRevenueRows = await tdb.execute(sql`
      SELECT
        p.is_south_africa                     AS flagged,
        pr.currency,
        COALESCE(SUM(pr.amount::numeric), 0)  AS income,
        COUNT(DISTINCT pr.policy_id)          AS policy_count
      FROM payment_receipts pr
      JOIN policies p ON p.id = pr.policy_id
      WHERE pr.organization_id = ${orgId}
        AND pr.status = 'issued'
        AND pr.issued_at >= ${from + "T00:00:00.000Z"}
        AND pr.issued_at <= ${to + "T23:59:59.999Z"}
      GROUP BY p.is_south_africa, pr.currency
    `);
    const crossBorderCaseCount = await tdb.execute(sql`
      SELECT COUNT(*) AS count
      FROM funeral_cases
      WHERE organization_id = ${orgId}
        AND is_cross_border_flag = true
        AND created_at >= ${from + "T00:00:00.000Z"}
        AND created_at <= ${to + "T23:59:59.999Z"}
    `);
    // Cost = actual cash paid (requisitions.status = 'paid'), matching the cash-basis
    // approach used everywhere else in this file — not budgeted/unpaid cost-sheet lines.
    // Counted if either the linked case is flagged, or the requisition itself carries the
    // pre-existing 'SOUTH_AFRICA' cost_flag convention (a requisition need not be tied to
    // a flagged case to represent real cross-border spend, e.g. a standalone SA expense).
    const crossBorderCostRows = await tdb.execute(sql`
      SELECT
        r.currency,
        COALESCE(SUM(r.amount_paid::numeric), 0) AS cost,
        COUNT(*)                                 AS requisition_count
      FROM requisitions r
      LEFT JOIN funeral_cases fc ON fc.id = r.funeral_case_id
      WHERE r.organization_id = ${orgId}
        AND r.status = 'paid'
        AND r.paid_date >= ${from}
        AND r.paid_date <= ${to}
        AND (COALESCE(fc.is_cross_border_flag, false) = true OR r.cost_flag = 'SOUTH_AFRICA')
      GROUP BY r.currency
    `);
    countryFlag = {
      flagLabel: countryFlagSettings.flagLabel,
      homeLabel: countryFlagSettings.homeLabel,
      revenueByCountry: ((countryRevenueRows as any).rows ?? (countryRevenueRows as unknown as any[])).map((r: any) => ({
        flagged: r.flagged === true,
        currency: r.currency,
        income: parseFloat(r.income),
        policyCount: parseInt(r.policy_count),
      })),
      serviceCount: parseInt(
        (((crossBorderCaseCount as any).rows ?? (crossBorderCaseCount as unknown as any[]))[0] as any)?.count ?? 0,
      ),
      costByCurrency: ((crossBorderCostRows as any).rows ?? (crossBorderCostRows as unknown as any[])).map((r: any) => ({
        currency: r.currency,
        cost: parseFloat(r.cost),
        requisitionCount: parseInt(r.requisition_count),
      })),
    };
  }

  return {
    period: { from, to },
    income: {
      total: is.income.total,
      premiumIndividual: is.income.premiumIndividual,
      premiumGroup: is.income.premiumGroup,
      cashServices: is.income.cashServices,
    },
    expenses: { total: is.expenses.total },
    net: is.net,
    consolidatedUsd: is.consolidatedUsd,
    cashPosition: {
      totalOnHand: Object.fromEntries(Object.entries(totalOnHand).map(([c, v]) => [c, parseFloat(v.toFixed(2))])),
      totalDeposited: Object.fromEntries(Object.entries(totalDeposited).map(([c, v]) => [c, parseFloat(v.toFixed(2))])),
      admins: positions.map((p) => ({
        ...p,
        displayName: findU(p.userId)?.displayName || findU(p.userId)?.email || p.userId,
      })),
    },
    branchBreakdown: ((branchRows as any).rows ?? (branchRows as unknown as any[])).map((r: any) => ({
      branchId: r.branch_id,
      branchName: r.branch_name || "No branch",
      currency: r.currency,
      income: parseFloat(r.income),
      policyCount: parseInt(r.policy_count),
    })),
    claimStats: ((claimStats as any).rows ?? (claimStats as unknown as any[])).map((r: any) => ({
      status: r.status,
      count: parseInt(r.count),
      totalValue: parseFloat(r.total_value),
      currency: r.currency,
    })),
    newPoliciesCount: parseInt(
      (((newPolicies as any).rows ?? (newPolicies as unknown as any[]))[0] as any)?.count ?? 0,
    ),
    countryFlag,
  };
}
