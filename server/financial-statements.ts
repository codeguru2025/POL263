/**
 * Income statement & cash-flow statement (cash basis), multi-currency with a
 * consolidated USD total.
 *
 * Income  = premium receipts (issued, and approved where approval was needed) + service
 *           receipts + society lump sums.
 * Expenses (income statement) = payment_disbursements (requisitions and expenditures) + petty
 *           cash spending + agent commission earned + POL263 platform fees + approved payroll +
 *           cash-in-lieu claims. Commission and platform fees are recognised when incurred, not
 *           when paid out; the cash-flow statement still counts commission only when paid.
 * All periods are tenant-local days (dayRangeForOrg), never UTC midnight.
 *
 * Amounts are kept per-currency (no implicit conversion). The consolidated block
 * converts to USD using fx_rates; currencies without a rate are listed as
 * unconvertible and excluded from that total.
 */
import { and, eq, gte, lte, lt, sql, inArray, desc } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { todayForOrg, dayRangeForOrg, getOrgTimezone, dateInTimezone } from "./date-utils";
import { roundMoney, subMoney } from "@shared/money";
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
  return { usd: roundMoney(usd), unconvertible };
}

const round2 = (m: AmountMap): AmountMap =>
  Object.fromEntries(Object.entries(m).map(([k, v]) => [k, roundMoney(v)]));

// ─── Shared query helpers ──────────────────────────────────────────────────

/** The period as tenant-local days: [start, endExclusive) — never UTC midnight. */
async function periodBounds(orgId: string, from: string, to: string): Promise<{ start: Date; end: Date }> {
  const { start, endExclusive } = await dayRangeForOrg(orgId, from, to);
  return { start: start!, end: endExclusive! };
}

/** A receipt counts once it is issued and, if it needed approval, approved — a receipt still
 *  waiting for approval (or rejected) is not money the business has. */
const validPaymentReceipt = sql`(${paymentReceipts.approvalStatus} IS NULL OR ${paymentReceipts.approvalStatus} = 'approved')`;

/** Premium + service receipts in the period, grouped by currency and payment channel. */
async function queryReceipts(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  const prConds: any[] = [
    eq(paymentReceipts.organizationId, orgId),
    eq(paymentReceipts.status, "issued"),
    validPaymentReceipt,
    gte(paymentReceipts.issuedAt, start),
    lt(paymentReceipts.issuedAt, end),
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
    gte(serviceReceipts.issuedAt, start),
    lt(serviceReceipts.issuedAt, end),
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

/** Commission ledger entries marked paid in the period — cash actually paid to agents (cash flow). */
async function queryCommissions(tdb: any, orgId: string, from: string, to: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  return tdb
    .select({
      currency: commissionLedgerEntries.currency,
      total: sql<string>`COALESCE(SUM(${commissionLedgerEntries.amount}), '0')`,
    })
    .from(commissionLedgerEntries)
    .where(and(
      eq(commissionLedgerEntries.organizationId, orgId),
      eq(commissionLedgerEntries.status, "paid"),
      gte(commissionLedgerEntries.createdAt, start),
      lt(commissionLedgerEntries.createdAt, end),
    ))
    .groupBy(commissionLedgerEntries.currency);
}

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

/** Commission earned by agents in the period (clawbacks net off), whether or not it has been paid
 *  out yet — the cost is incurred when the premium comes in. Walk-in commission (agent_id NULL)
 *  goes to the company's own account and is paid to no one, so it is not a cost. */
async function queryCommissionsEarned(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  return rowsOf<{ currency: string; total: string }>(await tdb.execute(sql`
    SELECT e.currency, COALESCE(SUM(e.amount), 0)::text AS total
    FROM commission_ledger_entries e
    LEFT JOIN policies p ON p.id = e.policy_id
    WHERE e.organization_id = ${orgId} AND e.agent_id IS NOT NULL
      AND e.created_at >= ${start} AND e.created_at < ${end}
      ${branchId ? sql`AND p.branch_id = ${branchId}` : sql``}
    GROUP BY e.currency`));
}

/** POL263's per-payment platform fees charged in the period (settled or not — they're owed). */
async function queryPlatformFees(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  return rowsOf<{ currency: string; total: string }>(await tdb.execute(sql`
    SELECT f.currency, COALESCE(SUM(f.amount), 0)::text AS total
    FROM platform_receivables f
    LEFT JOIN payment_transactions t ON t.id = f.source_transaction_id
    LEFT JOIN policies p ON p.id = t.policy_id
    LEFT JOIN service_receipts s ON s.id = f.source_service_receipt_id
    WHERE f.organization_id = ${orgId}
      AND f.created_at >= ${start} AND f.created_at < ${end}
      ${branchId ? sql`AND COALESCE(p.branch_id, s.branch_id) = ${branchId}` : sql``}
    GROUP BY f.currency`));
}

/** Approved payroll whose pay period ends in the range (gross pay). Payroll isn't kept per branch
 *  or per currency, so it is left out of a single-branch statement. */
async function queryPayroll(tdb: any, orgId: string, from: string, to: string) {
  return rowsOf<{ total: string }>(await tdb.execute(sql`
    SELECT COALESCE(SUM(total_gross), 0)::text AS total
    FROM payroll_runs
    WHERE organization_id = ${orgId} AND status IN ('approved', 'processed', 'paid')
      AND period_end >= ${from}::date AND period_end <= ${to}::date`));
}

/** Petty cash spent in the period, by category. Top-ups and adjustments are movements of the
 *  float, not spending. */
async function queryPettyCash(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  return rowsOf<{ category: string | null; currency: string; total: string }>(await tdb.execute(sql`
    SELECT t.category, f.currency, COALESCE(SUM(t.amount), 0)::text AS total
    FROM petty_cash_transactions t JOIN petty_cash_floats f ON f.id = t.float_id
    WHERE t.organization_id = ${orgId} AND t.type = 'disbursement'
      AND t.transaction_date >= ${from}::date AND t.transaction_date <= ${to}::date
      ${branchId ? sql`AND f.branch_id = ${branchId}` : sql``}
    GROUP BY t.category, f.currency`));
}

/** Cash-in-lieu claims decided (approved or later) in the period. */
async function queryClaimsPaid(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  return rowsOf<{ currency: string; total: string }>(await tdb.execute(sql`
    SELECT c.currency, COALESCE(SUM(c.cash_in_lieu_amount), 0)::text AS total
    FROM claims c LEFT JOIN policies p ON p.id = c.policy_id
    WHERE c.organization_id = ${orgId}
      AND c.status IN ('approved', 'payable', 'paid', 'settled', 'completed', 'closed')
      AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${end}
      AND COALESCE(c.cash_in_lieu_amount, 0) <> 0
      ${branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${branchId}` : sql``}
    GROUP BY c.currency`));
}

/** Falakhe (and anyone without a commission-payout screen) pays agents through a requisition
 *  categorised "Commission". That is the commission being paid, not a new cost: the income
 *  statement already counts commission as it is earned, and the cash-flow statement shows these
 *  as commission paid out. */
export function isCommissionPayoutCategory(category: string | null | undefined): boolean {
  return /commission/i.test(category ?? "");
}

/** Category of each requisition / expenditure behind a set of disbursement rows. */
async function disbursementCategories(tdb: any, disbRows: { entityType: string; entityId: string }[]) {
  const reqIds = disbRows.filter((d) => d.entityType === "requisition").map((d) => d.entityId);
  const expIds = disbRows.filter((d) => d.entityType === "expenditure").map((d) => d.entityId);
  const out: Record<string, string> = {};
  if (reqIds.length) {
    for (const r of await tdb.select({ id: requisitions.id, category: requisitions.category }).from(requisitions).where(inArray(requisitions.id, reqIds))) {
      out[r.id] = r.category || "Uncategorised";
    }
  }
  if (expIds.length) {
    for (const r of await tdb.select({ id: expenditures.id, category: expenditures.category }).from(expenditures).where(inArray(expenditures.id, expIds))) {
      out[r.id] = r.category || "Uncategorised";
    }
  }
  return out;
}

/** Requisitions raised but not yet paid in full — spending that has probably happened but isn't
 *  in the books yet. Shown as a warning on both statements. */
async function queryUnpaidRequisitions(tdb: any, orgId: string, branchId?: string) {
  const rows = rowsOf<{ currency: string; n: string; owing: string }>(await tdb.execute(sql`
    SELECT currency, COUNT(*)::text AS n, COALESCE(SUM(amount - COALESCE(amount_paid, 0)), 0)::text AS owing
    FROM requisitions
    WHERE organization_id = ${orgId} AND status IN ('submitted', 'approved', 'partial')
      ${branchId ? sql`AND branch_id = ${branchId}` : sql``}
    GROUP BY currency`));
  const amounts: AmountMap = {};
  let count = 0;
  for (const r of rows) { count += Number(r.n); add(amounts, r.currency, parseFloat(r.owing)); }
  return { count, amounts: round2(amounts) };
}

/** Petty cash actually spent, per currency (cash-flow view: no category split). */
async function queryPettyCashOut(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const rows = await queryPettyCash(tdb, orgId, from, to, branchId);
  const out: AmountMap = {};
  for (const r of rows) add(out, r.currency, parseFloat(r.total));
  return out;
}

/** Payroll marked paid, by pay-period end (payroll has no separate payment date). */
async function queryPayrollPaid(tdb: any, orgId: string, from: string, to: string) {
  return rowsOf<{ total: string }>(await tdb.execute(sql`
    SELECT COALESCE(SUM(total_net), 0)::text AS total FROM payroll_runs
    WHERE organization_id = ${orgId} AND status = 'paid'
      AND period_end >= ${from}::date AND period_end <= ${to}::date`));
}

/** Cash-in-lieu claims marked paid, by decision date (claims have no separate payment date). */
async function queryClaimsCashPaid(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  const { start, end } = await periodBounds(orgId, from, to);
  return rowsOf<{ currency: string; total: string }>(await tdb.execute(sql`
    SELECT c.currency, COALESCE(SUM(c.cash_in_lieu_amount), 0)::text AS total
    FROM claims c LEFT JOIN policies p ON p.id = c.policy_id
    WHERE c.organization_id = ${orgId} AND c.status IN ('paid', 'closed')
      AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${end}
      AND COALESCE(c.cash_in_lieu_amount, 0) <> 0
      ${branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${branchId}` : sql``}
    GROUP BY c.currency`));
}

/** POL263 bills the tenant paid in the period (control plane). Not kept per branch. */
async function queryPol263BillsPaid(orgId: string, from: string, to: string): Promise<AmountMap> {
  const { start, end } = await periodBounds(orgId, from, to);
  const out: AmountMap = {};
  try {
    const [{ cpDb }, { tenantInvoices }] = await Promise.all([import("./control-plane-db"), import("@shared/control-plane-schema")]);
    const rows = await cpDb.select({ currency: tenantInvoices.currency, total: sql<string>`COALESCE(SUM(${tenantInvoices.amount}), 0)::text` })
      .from(tenantInvoices)
      .where(and(eq(tenantInvoices.tenantId, orgId), eq(tenantInvoices.status, "paid"), gte(tenantInvoices.paidAt, start), lt(tenantInvoices.paidAt, end)))
      .groupBy(tenantInvoices.currency);
    for (const r of rows) add(out, r.currency || "USD", parseFloat(r.total));
  } catch {
    // Control plane unreachable: leave the line out rather than fail the whole statement.
  }
  return out;
}

// ─── Legacy group receipts (no policy — cash subscriptions) ───────────────

/** Society lump sums. Groups aren't kept per branch, so a single-branch statement leaves them out
 *  (and says so) rather than counting every branch's society money against one branch. */
async function queryLegacyGroupReceipts(tdb: any, orgId: string, from: string, to: string, branchId?: string) {
  if (branchId) return [];
  return rowsOf<{ currency: string; total: string }>(await tdb.execute(
    sql`SELECT currency, SUM(amount)::text AS total
        FROM legacy_group_receipts
        WHERE organization_id = ${orgId}
          AND payment_date >= ${from}::date
          AND payment_date <= ${to}::date
        GROUP BY currency`,
  ));
}

// ─── Income Statement ──────────────────────────────────────────────────────

export type ExpenseSource = "requisition" | "expenditure" | "commission" | "platform_fee" | "payroll" | "petty_cash" | "claims";

export async function buildIncomeStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const [fx, fxRates] = await Promise.all([fxMapFor(orgId), storage.getFxRates(orgId)]);

  const [{ premiumRows, serviceRows }, legacyRows, disbRows, commRows, feeRows, payrollRows, pettyRows, claimRows] = await Promise.all([
    queryReceipts(tdb, orgId, from, to, branchId),
    queryLegacyGroupReceipts(tdb, orgId, from, to, branchId),
    queryDisbursements(tdb, orgId, from, to, branchId),
    queryCommissionsEarned(tdb, orgId, from, to, branchId),
    queryPlatformFees(tdb, orgId, from, to, branchId),
    branchId ? Promise.resolve([] as { total: string }[]) : queryPayroll(tdb, orgId, from, to),
    queryPettyCash(tdb, orgId, from, to, branchId),
    queryClaimsPaid(tdb, orgId, from, to, branchId),
  ]);

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

  // ── Expenses ──
  const categories = await disbursementCategories(tdb, disbRows);
  const expenseLines: { label: string; source: ExpenseSource; amounts: AmountMap }[] = [];
  const expenseByKey: Record<string, { label: string; source: ExpenseSource; amounts: AmountMap }> = {};
  const pushExpense = (label: string, source: ExpenseSource, currency: string, amount: number) => {
    if (!amount) return;
    const key = `${source}:${label}`;
    if (!expenseByKey[key]) {
      expenseByKey[key] = { label, source, amounts: {} };
      expenseLines.push(expenseByKey[key]);
    }
    add(expenseByKey[key].amounts, currency, amount);
  };

  for (const d of disbRows) {
    const type = d.entityType as "requisition" | "expenditure";
    const cat = categories[d.entityId] || "Uncategorised";
    // Paying an agent through a requisition settles commission already counted as earned below.
    if (isCommissionPayoutCategory(cat)) continue;
    pushExpense(cat, type, d.currency, parseFloat(d.total));
  }
  for (const r of pettyRows) pushExpense(`Petty cash — ${r.category || "Uncategorised"}`, "petty_cash", r.currency, parseFloat(r.total));
  for (const r of commRows) pushExpense("Agent commissions (earned)", "commission", r.currency, parseFloat(r.total));
  for (const r of feeRows) pushExpense("POL263 fees", "platform_fee", r.currency, parseFloat(r.total));
  for (const r of payrollRows) pushExpense("Salaries and wages (approved payroll)", "payroll", "USD", parseFloat(r.total));
  for (const r of claimRows) pushExpense("Claims paid (cash in lieu)", "claims", r.currency, parseFloat(r.total));

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
    /** When each rate was last set, so a stale rate is visible on the statement. */
    fxRatesSetOn: Object.fromEntries(fxRates.map((r: any) => [String(r.currency).toUpperCase(), r.updatedAt ? new Date(r.updatedAt).toISOString().slice(0, 10) : null])),
    /** A single-branch statement can't include what isn't kept per branch. */
    excludedForBranch: branchId ? ["Society lump sums", "Payroll"] : [],
    /** Raised but not yet paid — spending that is probably real but not in these figures yet. */
    unpaidRequisitions: await queryUnpaidRequisitions(tdb, orgId, branchId),
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
      net: subMoney(cIncome.usd, cExpense.usd),
      unconvertible: Array.from(new Set([...cIncome.unconvertible, ...cExpense.unconvertible])),
    },
  };
}

export interface IncomeTimeSeriesPoint {
  periodStart: string; // YYYY-MM-DD, bucket start
  periodLabel: string; // human label for chart axis
  income: AmountMap;
  expenses: AmountMap;
  net: AmountMap;
}

/**
 * Same income/expense definitions as buildIncomeStatement, bucketed over time (tenant-local
 * days) for trend charts — the executive report needs a series, not just one period total. One
 * grouped SQL query per source table, not N calls to buildIncomeStatement per bucket, to keep
 * this cheap over long ranges.
 */
export async function buildIncomeTimeSeries(
  orgId: string,
  params: StatementParams & { bucket?: "day" | "week" | "month" },
): Promise<IncomeTimeSeriesPoint[]> {
  const { from, to, branchId } = params;
  const bucket = params.bucket ?? (daysBetweenInclusive(from, to) > 45 ? "week" : "day");
  const tdb = await getDbForOrg(orgId);
  const { start, end } = await periodBounds(orgId, from, to);
  const tz = await getOrgTimezone(orgId);
  const local = (col: any) => sql`date_trunc(${bucket}, ${col} AT TIME ZONE ${tz})::date`;
  const onDate = (col: any) => sql`date_trunc(${bucket}, ${col}::timestamp)::date`;
  const br = (col: any) => (branchId ? sql`AND ${col} = ${branchId}` : sql``);

  const q = (s: any) => tdb.execute(s).then(rowsOf<{ bucket: string; currency: string; total: string }>);
  const [premium, service, lump, disb, comm, fees, payroll, petty, claimRows] = await Promise.all([
    q(sql`SELECT ${local(sql`issued_at`)} AS bucket, currency, COALESCE(SUM(amount), 0) AS total FROM payment_receipts
      WHERE organization_id = ${orgId} AND status = 'issued' AND (approval_status IS NULL OR approval_status = 'approved')
        AND issued_at >= ${start} AND issued_at < ${end} ${br(sql`branch_id`)} GROUP BY 1, 2`),
    q(sql`SELECT ${local(sql`issued_at`)} AS bucket, currency, COALESCE(SUM(amount), 0) AS total FROM service_receipts
      WHERE organization_id = ${orgId} AND status = 'issued' AND issued_at >= ${start} AND issued_at < ${end} ${br(sql`branch_id`)} GROUP BY 1, 2`),
    branchId ? Promise.resolve([]) : q(sql`SELECT ${onDate(sql`payment_date`)} AS bucket, currency, COALESCE(SUM(amount), 0) AS total FROM legacy_group_receipts
      WHERE organization_id = ${orgId} AND payment_date >= ${from}::date AND payment_date <= ${to}::date GROUP BY 1, 2`),
    q(sql`SELECT ${onDate(sql`paid_date`)} AS bucket, currency, COALESCE(SUM(amount), 0) AS total FROM payment_disbursements
      WHERE organization_id = ${orgId} AND paid_date >= ${from} AND paid_date <= ${to} ${br(sql`branch_id`)} GROUP BY 1, 2`),
    q(sql`SELECT ${local(sql`e.created_at`)} AS bucket, e.currency, COALESCE(SUM(e.amount), 0) AS total
      FROM commission_ledger_entries e LEFT JOIN policies p ON p.id = e.policy_id
      WHERE e.organization_id = ${orgId} AND e.agent_id IS NOT NULL AND e.created_at >= ${start} AND e.created_at < ${end} ${br(sql`p.branch_id`)} GROUP BY 1, 2`),
    q(sql`SELECT ${local(sql`f.created_at`)} AS bucket, f.currency, COALESCE(SUM(f.amount), 0) AS total
      FROM platform_receivables f LEFT JOIN payment_transactions t ON t.id = f.source_transaction_id
        LEFT JOIN policies p ON p.id = t.policy_id LEFT JOIN service_receipts s ON s.id = f.source_service_receipt_id
      WHERE f.organization_id = ${orgId} AND f.created_at >= ${start} AND f.created_at < ${end} ${br(sql`COALESCE(p.branch_id, s.branch_id)`)} GROUP BY 1, 2`),
    branchId ? Promise.resolve([]) : q(sql`SELECT ${onDate(sql`period_end`)} AS bucket, 'USD' AS currency, COALESCE(SUM(total_gross), 0) AS total FROM payroll_runs
      WHERE organization_id = ${orgId} AND status IN ('approved', 'processed', 'paid') AND period_end >= ${from}::date AND period_end <= ${to}::date GROUP BY 1, 2`),
    q(sql`SELECT ${onDate(sql`t.transaction_date`)} AS bucket, f.currency, COALESCE(SUM(t.amount), 0) AS total
      FROM petty_cash_transactions t JOIN petty_cash_floats f ON f.id = t.float_id
      WHERE t.organization_id = ${orgId} AND t.type = 'disbursement' AND t.transaction_date >= ${from}::date AND t.transaction_date <= ${to}::date ${br(sql`f.branch_id`)} GROUP BY 1, 2`),
    q(sql`SELECT ${local(sql`COALESCE(c.decided_at, c.created_at)`)} AS bucket, c.currency, COALESCE(SUM(c.cash_in_lieu_amount), 0) AS total
      FROM claims c LEFT JOIN policies p ON p.id = c.policy_id
      WHERE c.organization_id = ${orgId} AND c.status IN ('approved', 'payable', 'paid', 'settled', 'completed', 'closed')
        AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${end}
        ${br(sql`COALESCE(c.branch_id, p.branch_id)`)} GROUP BY 1, 2`),
  ]);

  const byBucket = new Map<string, { income: AmountMap; expenses: AmountMap }>();
  const ensure = (b: any) => {
    const key = typeof b === "string" ? b.slice(0, 10) : new Date(b).toISOString().slice(0, 10);
    if (!byBucket.has(key)) byBucket.set(key, { income: {}, expenses: {} });
    return byBucket.get(key)!;
  };
  for (const r of [...premium, ...service, ...lump]) add(ensure(r.bucket).income, r.currency, parseFloat(r.total));
  for (const r of [...disb, ...comm, ...fees, ...payroll, ...petty, ...claimRows]) add(ensure(r.bucket).expenses, r.currency, parseFloat(r.total));

  const points: IncomeTimeSeriesPoint[] = Array.from(byBucket.entries())
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([periodStart, v]) => {
      const net: AmountMap = {};
      for (const [c, val] of Object.entries(v.income)) add(net, c, val);
      for (const [c, val] of Object.entries(v.expenses)) add(net, c, -val);
      return {
        periodStart,
        periodLabel: bucketLabel(periodStart, bucket),
        income: round2(v.income),
        expenses: round2(v.expenses),
        net: round2(net),
      };
    });
  return points;
}

function daysBetweenInclusive(from: string, to: string): number {
  return Math.round((toTs(to).getTime() - fromTs(from).getTime()) / (24 * 60 * 60 * 1000)) + 1;
}

function bucketLabel(periodStart: string, bucket: "day" | "week" | "month"): string {
  const d = new Date(periodStart + "T00:00:00.000Z");
  if (bucket === "month") return d.toLocaleDateString("en-ZA", { month: "short", year: "numeric" });
  if (bucket === "week") return `Wk of ${d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })}`;
  return d.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" });
}

// ─── Cash Flow Statement ───────────────────────────────────────────────────

export async function buildCashFlowStatement(orgId: string, params: StatementParams) {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const fx = await fxMapFor(orgId);

  const [{ premiumRows, serviceRows }, legacyRows, disbRows, commRows, pettyOut, payrollRows, claimRows, pol263Bills, unpaidRequisitions] = await Promise.all([
    queryReceipts(tdb, orgId, from, to, branchId),
    queryLegacyGroupReceipts(tdb, orgId, from, to, branchId),
    queryDisbursements(tdb, orgId, from, to, branchId),
    queryCommissions(tdb, orgId, from, to),
    queryPettyCashOut(tdb, orgId, from, to, branchId),
    branchId ? Promise.resolve([] as { total: string }[]) : queryPayrollPaid(tdb, orgId, from, to),
    queryClaimsCashPaid(tdb, orgId, from, to, branchId),
    branchId ? Promise.resolve({} as AmountMap) : queryPol263BillsPaid(orgId, from, to),
    queryUnpaidRequisitions(tdb, orgId, branchId),
  ]);

  // ── Cash IN by channel ──
  const inByChannel: Record<string, AmountMap> = {};
  const addIn = (channel: string, currency: string, amt: number) => {
    const ch = channel || "other";
    inByChannel[ch] = inByChannel[ch] || {};
    add(inByChannel[ch], currency, amt);
  };
  for (const r of premiumRows) addIn(r.channel, r.currency, parseFloat(r.total));
  for (const r of serviceRows) addIn(r.channel, r.currency, parseFloat(r.total));
  // Society lump sums don't record how they were paid — never assume cash.
  for (const r of legacyRows) addIn("society_lump_sums", r.currency, parseFloat(r.total));

  // ── Cash OUT ──
  const categories = await disbursementCategories(tdb, disbRows);
  const requisitionsOut: AmountMap = {};
  const expendituresOut: AmountMap = {};
  const commissionsOut: AmountMap = {};
  for (const d of disbRows) {
    const amt = parseFloat(d.total);
    // A "Commission" requisition is agents being paid their commission.
    if (isCommissionPayoutCategory(categories[d.entityId])) add(commissionsOut, d.currency, amt);
    else if (d.entityType === "requisition") add(requisitionsOut, d.currency, amt);
    else add(expendituresOut, d.currency, amt);
  }
  for (const r of commRows) add(commissionsOut, r.currency, parseFloat(r.total));
  const payrollOut: AmountMap = {};
  for (const r of payrollRows) if (parseFloat(r.total)) add(payrollOut, "USD", parseFloat(r.total));
  const claimsOut: AmountMap = {};
  for (const r of claimRows) add(claimsOut, r.currency, parseFloat(r.total));

  const cashIn: AmountMap = {};
  for (const ch of Object.values(inByChannel)) for (const [c, v] of Object.entries(ch)) add(cashIn, c, v);
  const cashOut: AmountMap = {};
  for (const m of [requisitionsOut, expendituresOut, pettyOut, commissionsOut, payrollOut, claimsOut, pol263Bills]) for (const [c, v] of Object.entries(m)) add(cashOut, c, v);
  const netCash: AmountMap = {};
  for (const [c, v] of Object.entries(cashIn)) add(netCash, c, v);
  for (const [c, v] of Object.entries(cashOut)) add(netCash, c, -v);

  const allCurrencies = Object.keys(cashIn).concat(Object.keys(cashOut));
  const currencies = allCurrencies.filter((c, i) => allCurrencies.indexOf(c) === i).sort();
  const cIn = consolidate(cashIn, fx);
  const cOut = consolidate(cashOut, fx);

  // Cash-up reconciliation for the period.
  const cashups = await storage.getCashups(orgId, 200, { fromDate: from, toDate: to, ...(branchId ? { branchId } : {}) } as any);

  // Bank deposits in the period (cash banked by admins).
  const deposits = await storage.getBankDeposits(orgId, { fromDate: from, toDate: to });
  const depositsByMethod: AmountMap = {};
  for (const d of deposits) add(depositsByMethod, d.currency, parseFloat(String(d.amount)));

  return {
    from, to, branchId: branchId ?? null, currencies, fxRates: fx,
    excludedForBranch: branchId ? ["Society lump sums", "Payroll", "POL263 bills"] : [],
    unpaidRequisitions,
    inflowsByChannel: Object.fromEntries(Object.entries(inByChannel).map(([k, v]) => [k, round2(v)])),
    cashIn: round2(cashIn),
    outflows: {
      requisitions: round2(requisitionsOut),
      expenditures: round2(expendituresOut),
      pettyCash: round2(pettyOut),
      commissions: round2(commissionsOut),
      payroll: round2(payrollOut),
      claims: round2(claimsOut),
      pol263Bills: round2(pol263Bills),
      total: round2(cashOut),
    },
    netCash: round2(netCash),
    consolidatedUsd: {
      cashIn: cIn.usd,
      cashOut: cOut.usd,
      netCash: subMoney(cIn.usd, cOut.usd),
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
// Row-level detail behind the income statement and cash-flow statement above: every money event
// in the period, under exactly the same rules as those statements, each tagged with the two
// accounts it posts to (server/general-ledger.ts POSTINGS) so the General Ledger can post it in
// double entry and its account totals equal the Trial Balance.

export type LedgerSource =
  | "premium" | "premium_group" | "cash_service" | "legacy_group"
  | "requisition" | "expenditure" | "petty_cash"
  | "commission_earned" | "commission_paid"
  | "platform_fee" | "pol263_bill"
  | "payroll" | "payroll_paid"
  | "claim" | "claim_paid";

export interface LedgerEntry {
  date: string;          // YYYY-MM-DD, tenant-local
  /** income = money earned; expense = a cost; payment = paying off something already owed. */
  type: "income" | "expense" | "payment";
  source: LedgerSource;
  description: string;
  reference: string | null;
  person: string | null;
  department: string | null;
  amount: number;
  currency: string;
  /** false when no cash moved (commission earned, POL263 fee charged, payroll or claim approved). */
  cash: boolean;
}

export interface LedgerParams extends StatementParams {
  limit?: number;
  offset?: number;
}

/** Most rows a ledger request returns; more than this and the caller is told to narrow dates. */
export const LEDGER_MAX_ROWS = 20000;

function fullName(first: string | null | undefined, last: string | null | undefined): string | null {
  const n = [first, last].filter(Boolean).join(" ").trim();
  return n || null;
}

export async function buildTransactionLedger(orgId: string, params: LedgerParams): Promise<{ from: string; to: string; branchId: string | null; total: number; truncated: boolean; entries: LedgerEntry[] }> {
  const tdb = await getDbForOrg(orgId);
  const { from, to, branchId } = params;
  const limit = Math.min(params.limit ?? LEDGER_MAX_ROWS, LEDGER_MAX_ROWS);
  const offset = params.offset ?? 0;
  const { start, end } = await periodBounds(orgId, from, to);
  const tz = await getOrgTimezone(orgId);
  const day = (d: Date | string) => dateInTimezone(d, tz);
  const plainDate = (d: unknown) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
  const num = (v: unknown) => parseFloat(String(v ?? 0)) || 0;

  const entries: LedgerEntry[] = [];
  const push = (e: Omit<LedgerEntry, "cash"> & { cash?: boolean }) => {
    if (!e.amount) return;
    entries.push({ cash: true, ...e });
  };

  // ── Premium receipts (issued, and approved where approval applies) ──
  const prConds: any[] = [
    eq(paymentReceipts.organizationId, orgId), eq(paymentReceipts.status, "issued"), validPaymentReceipt,
    gte(paymentReceipts.issuedAt, start), lt(paymentReceipts.issuedAt, end),
  ];
  if (branchId) prConds.push(eq(paymentReceipts.branchId, branchId));
  const premiumRows = await tdb
    .select({
      issuedAt: paymentReceipts.issuedAt, receiptNumber: paymentReceipts.receiptNumber,
      amount: paymentReceipts.amount, currency: paymentReceipts.currency,
      policyNumber: policies.policyNumber, isGroup: sql<boolean>`${policies.groupId} IS NOT NULL`,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
      branchName: branches.name, issuerName: users.displayName,
    })
    .from(paymentReceipts)
    .innerJoin(policies, eq(paymentReceipts.policyId, policies.id))
    .leftJoin(clients, eq(paymentReceipts.clientId, clients.id))
    .leftJoin(branches, eq(paymentReceipts.branchId, branches.id))
    .leftJoin(users, eq(paymentReceipts.issuedByUserId, users.id))
    .where(and(...prConds));
  for (const r of premiumRows) {
    push({
      date: day(r.issuedAt), type: "income", source: r.isGroup ? "premium_group" : "premium",
      description: `Premium${r.isGroup ? " (society member)" : ""} — ${r.policyNumber}${r.clientFirstName ? ` (${fullName(r.clientFirstName, r.clientLastName)})` : ""}`,
      reference: r.receiptNumber, person: r.issuerName ?? null, department: r.branchName ?? null,
      amount: num(r.amount), currency: r.currency,
    });
  }

  // ── Funeral service receipts ──
  const srConds: any[] = [
    eq(serviceReceipts.organizationId, orgId), eq(serviceReceipts.status, "issued"),
    gte(serviceReceipts.issuedAt, start), lt(serviceReceipts.issuedAt, end),
  ];
  if (branchId) srConds.push(eq(serviceReceipts.branchId, branchId));
  const serviceRows = await tdb
    .select({
      issuedAt: serviceReceipts.issuedAt, receiptNumber: serviceReceipts.receiptNumber,
      amount: serviceReceipts.amount, currency: serviceReceipts.currency,
      deceasedName: funeralCases.deceasedName, issuerName: users.displayName,
    })
    .from(serviceReceipts)
    .leftJoin(funeralCases, eq(serviceReceipts.funeralCaseId, funeralCases.id))
    .leftJoin(users, eq(serviceReceipts.issuedByUserId, users.id))
    .where(and(...srConds));
  for (const r of serviceRows) {
    push({
      date: day(r.issuedAt), type: "income", source: "cash_service",
      description: `Funeral service${r.deceasedName ? ` — ${r.deceasedName}` : ""}`,
      reference: r.receiptNumber, person: r.issuerName ?? null, department: "Funeral Services",
      amount: num(r.amount), currency: r.currency,
    });
  }

  // ── Society lump sums (not kept per branch) ──
  if (!branchId) {
    const rows = rowsOf<{ receipt_number: string; amount: string; currency: string; group_name: string; payment_date: string }>(await tdb.execute(sql`
      SELECT receipt_number, amount, currency, group_name, payment_date FROM legacy_group_receipts
      WHERE organization_id = ${orgId} AND payment_date >= ${from}::date AND payment_date <= ${to}::date`));
    for (const r of rows) {
      push({
        date: plainDate(r.payment_date), type: "income", source: "legacy_group",
        description: `Society lump sum — ${r.group_name}`, reference: r.receipt_number, person: null,
        department: r.group_name, amount: num(r.amount), currency: r.currency,
      });
    }
  }

  // ── Requisitions and expenditures paid out ──
  const disbConds: any[] = [
    eq(paymentDisbursements.organizationId, orgId),
    sql`${paymentDisbursements.paidDate} >= ${from}`, sql`${paymentDisbursements.paidDate} <= ${to}`,
  ];
  if (branchId) disbConds.push(eq(paymentDisbursements.branchId, branchId));
  const disbRows = await tdb
    .select({
      paidDate: paymentDisbursements.paidDate, voucherNumber: paymentDisbursements.voucherNumber,
      entityType: paymentDisbursements.entityType, entityId: paymentDisbursements.entityId,
      amount: paymentDisbursements.amount, currency: paymentDisbursements.currency,
      payerName: users.displayName,
    })
    .from(paymentDisbursements)
    .leftJoin(users, eq(paymentDisbursements.paidByUserId, users.id))
    .where(and(...disbConds));
  const reqIds = disbRows.filter((d: any) => d.entityType === "requisition").map((d: any) => d.entityId as string);
  const expIds = disbRows.filter((d: any) => d.entityType === "expenditure").map((d: any) => d.entityId as string);
  const info: Record<string, { description: string | null; category: string | null; department: string | null; number: string | null }> = {};
  if (reqIds.length) {
    for (const r of await tdb.select({ id: requisitions.id, description: requisitions.description, category: requisitions.category, department: requisitions.department, number: requisitions.requisitionNumber })
      .from(requisitions).where(inArray(requisitions.id, reqIds))) info[r.id] = r as any;
  }
  if (expIds.length) {
    for (const r of await tdb.select({ id: expenditures.id, description: expenditures.description, category: expenditures.category })
      .from(expenditures).where(inArray(expenditures.id, expIds))) info[r.id] = { ...r, department: null, number: null } as any;
  }
  for (const d of disbRows) {
    const isReq = d.entityType === "requisition";
    const i = info[d.entityId];
    const commissionPayout = isCommissionPayoutCategory(i?.category);
    push({
      date: plainDate(d.paidDate),
      type: commissionPayout ? "payment" : "expense",
      source: commissionPayout ? "commission_paid" : isReq ? "requisition" : "expenditure",
      description: `${commissionPayout ? "Commission paid to agent — " : ""}${i?.description || i?.category || (isReq ? "Requisition" : "Expenditure")}${i?.number ? ` (${i.number})` : ""}`,
      reference: d.voucherNumber ?? null, person: d.payerName ?? null,
      department: i?.department || i?.category || "Uncategorised",
      amount: num(d.amount), currency: d.currency,
    });
  }

  // ── Petty cash spent ──
  const pettyRows = rowsOf<{ transaction_date: string; amount: string; currency: string; category: string | null; description: string | null; receipt_ref: string | null; person: string | null }>(await tdb.execute(sql`
    SELECT t.transaction_date, t.amount, f.currency, t.category, t.description, t.receipt_ref, u.display_name AS person
    FROM petty_cash_transactions t JOIN petty_cash_floats f ON f.id = t.float_id
    LEFT JOIN users u ON u.id = t.performed_by_user_id
    WHERE t.organization_id = ${orgId} AND t.type = 'disbursement'
      AND t.transaction_date >= ${from}::date AND t.transaction_date <= ${to}::date
      ${branchId ? sql`AND f.branch_id = ${branchId}` : sql``}`));
  for (const r of pettyRows) {
    push({
      date: plainDate(r.transaction_date), type: "expense", source: "petty_cash",
      description: `Petty cash — ${r.description || r.category || "spending"}`, reference: r.receipt_ref,
      person: r.person, department: r.category || "Petty cash", amount: num(r.amount), currency: r.currency,
    });
  }

  // ── Commission earned by agents (no cash yet; walk-in commission is company money, not a cost) ──
  const earnedRows = rowsOf<{ created_at: string; amount: string; currency: string; description: string | null; agent: string | null; policy_number: string | null }>(await tdb.execute(sql`
    SELECT e.created_at, e.amount, e.currency, e.description, u.display_name AS agent, p.policy_number
    FROM commission_ledger_entries e
    LEFT JOIN users u ON u.id = e.agent_id LEFT JOIN policies p ON p.id = e.policy_id
    WHERE e.organization_id = ${orgId} AND e.agent_id IS NOT NULL
      AND e.created_at >= ${start} AND e.created_at < ${end}
      ${branchId ? sql`AND p.branch_id = ${branchId}` : sql``}`));
  for (const r of earnedRows) {
    push({
      date: day(r.created_at), type: "expense", source: "commission_earned", cash: false,
      description: `Commission earned${r.policy_number ? ` — ${r.policy_number}` : ""}${r.description ? ` (${r.description})` : ""}`,
      reference: null, person: r.agent, department: "Commissions", amount: num(r.amount), currency: r.currency,
    });
  }
  // Commission entries marked paid (cash) — nothing sets this today, but the cash-flow statement counts it.
  const paidComm = await tdb
    .select({ createdAt: commissionLedgerEntries.createdAt, amount: commissionLedgerEntries.amount, currency: commissionLedgerEntries.currency, description: commissionLedgerEntries.description, agentName: users.displayName })
    .from(commissionLedgerEntries).leftJoin(users, eq(commissionLedgerEntries.agentId, users.id))
    .where(and(eq(commissionLedgerEntries.organizationId, orgId), eq(commissionLedgerEntries.status, "paid"), gte(commissionLedgerEntries.createdAt, start), lt(commissionLedgerEntries.createdAt, end)));
  for (const r of paidComm) {
    push({
      date: day(r.createdAt as Date), type: "payment", source: "commission_paid",
      description: `Commission paid to agent${r.description ? ` — ${r.description}` : ""}`, reference: null,
      person: r.agentName ?? null, department: "Commissions", amount: num(r.amount), currency: r.currency,
    });
  }

  // ── POL263 fees charged (owed until the bill is paid) ──
  const feeRows = rowsOf<{ created_at: string; amount: string; currency: string; description: string | null }>(await tdb.execute(sql`
    SELECT f.created_at, f.amount, f.currency, f.description
    FROM platform_receivables f
    LEFT JOIN payment_transactions t ON t.id = f.source_transaction_id
    LEFT JOIN policies p ON p.id = t.policy_id
    LEFT JOIN service_receipts s ON s.id = f.source_service_receipt_id
    WHERE f.organization_id = ${orgId} AND f.created_at >= ${start} AND f.created_at < ${end}
      ${branchId ? sql`AND COALESCE(p.branch_id, s.branch_id) = ${branchId}` : sql``}`));
  for (const r of feeRows) {
    push({
      date: day(r.created_at), type: "expense", source: "platform_fee", cash: false,
      description: `POL263 fee${r.description ? ` — ${r.description}` : ""}`, reference: null, person: null,
      department: "POL263", amount: num(r.amount), currency: r.currency,
    });
  }

  // ── POL263 bills paid (control plane; not kept per branch) ──
  if (!branchId) {
    try {
      const [{ cpDb }, { tenantInvoices }] = await Promise.all([import("./control-plane-db"), import("@shared/control-plane-schema")]);
      const bills = await cpDb.select({ paidAt: tenantInvoices.paidAt, amount: tenantInvoices.amount, currency: tenantInvoices.currency, id: tenantInvoices.id, kind: tenantInvoices.kind })
        .from(tenantInvoices)
        .where(and(eq(tenantInvoices.tenantId, orgId), eq(tenantInvoices.status, "paid"), gte(tenantInvoices.paidAt, start), lt(tenantInvoices.paidAt, end)));
      for (const b of bills) {
        push({
          date: day(b.paidAt as Date), type: "payment", source: "pol263_bill",
          description: `POL263 bill paid${b.kind ? ` (${String(b.kind).replace(/_/g, " ")})` : ""}`, reference: b.id.slice(0, 8),
          person: null, department: "POL263", amount: num(b.amount), currency: b.currency || "USD",
        });
      }
    } catch { /* control plane unreachable — same as the cash-flow statement */ }
  }

  // ── Payroll (not kept per branch): gross when approved, net when paid ──
  if (!branchId) {
    const runs = rowsOf<{ period_start: string; period_end: string; status: string; total_gross: string; total_net: string }>(await tdb.execute(sql`
      SELECT period_start, period_end, status, total_gross, total_net FROM payroll_runs
      WHERE organization_id = ${orgId} AND status IN ('approved', 'processed', 'paid')
        AND period_end >= ${from}::date AND period_end <= ${to}::date`));
    for (const r of runs) {
      const period = `${plainDate(r.period_start)} – ${plainDate(r.period_end)}`;
      push({ date: plainDate(r.period_end), type: "expense", source: "payroll", cash: false, description: `Salaries and wages ${period}`, reference: null, person: null, department: "Payroll", amount: num(r.total_gross), currency: "USD" });
      if (r.status === "paid") push({ date: plainDate(r.period_end), type: "payment", source: "payroll_paid", description: `Salaries paid ${period}`, reference: null, person: null, department: "Payroll", amount: num(r.total_net), currency: "USD" });
    }
  }

  // ── Cash-in-lieu claims: cost when decided, cash when paid ──
  const claimRows = rowsOf<{ decided: string; status: string; amount: string; currency: string; claim_number: string; deceased_name: string | null; policy_number: string | null }>(await tdb.execute(sql`
    SELECT COALESCE(c.decided_at, c.created_at) AS decided, c.status, c.cash_in_lieu_amount AS amount, c.currency,
           c.claim_number, c.deceased_name, p.policy_number
    FROM claims c LEFT JOIN policies p ON p.id = c.policy_id
    WHERE c.organization_id = ${orgId}
      AND c.status IN ('approved', 'payable', 'paid', 'settled', 'completed', 'closed')
      AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${end}
      AND COALESCE(c.cash_in_lieu_amount, 0) <> 0
      ${branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${branchId}` : sql``}`));
  for (const r of claimRows) {
    const desc = `Claim ${r.claim_number}${r.deceased_name ? ` — ${r.deceased_name}` : ""}${r.policy_number ? ` (${r.policy_number})` : ""}`;
    push({ date: day(r.decided), type: "expense", source: "claim", cash: false, description: desc, reference: r.claim_number, person: null, department: "Claims", amount: num(r.amount), currency: r.currency || "USD" });
    if (r.status === "paid" || r.status === "closed") {
      push({ date: day(r.decided), type: "payment", source: "claim_paid", description: `${desc} — paid`, reference: r.claim_number, person: null, department: "Claims", amount: num(r.amount), currency: r.currency || "USD" });
    }
  }

  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = entries.length;
  return { from, to, branchId: branchId ?? null, total, truncated: total > offset + limit, entries: entries.slice(offset, offset + limit) };
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
      // Ledger-group claims are settled from the group's own ledger on approval — not a
      // payable out of the company's cash.
      sql`${claims.groupId} IS NULL`,
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

/** Default range for callers that don't have their own — month-to-date, in the org's own timezone. */
export async function defaultExecutiveSummaryRange(orgId: string): Promise<{ from: string; to: string }> {
  const to = await todayForOrg(orgId);
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
      totalOnHand: Object.fromEntries(Object.entries(totalOnHand).map(([c, v]) => [c, roundMoney(v)])),
      totalDeposited: Object.fromEntries(Object.entries(totalDeposited).map(([c, v]) => [c, roundMoney(v)])),
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
