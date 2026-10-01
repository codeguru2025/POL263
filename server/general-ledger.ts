/**
 * Chart of accounts, trial balance and general-ledger views.
 *
 * POL263 does not run a primary double-entry ledger — premiums, disbursements, commission and
 * claims each live in their own subsidiary ledger. Rather than bolt a full journal/posting
 * engine (and a new accounting model) onto the app, this module *derives* a trial balance and a
 * general ledger from those subsidiary ledgers, mapped onto a standard funeral/life-insurer
 * chart of accounts. Every number here is the same number the income statement and balance
 * sheet already produce — this is a re-presentation in debit/credit form with account codes and
 * an arithmetic balance check, not a second source of truth.
 *
 *  - Trial balance (period): the income-statement movements in Dr/Cr form, closed to equity via
 *    a single "surplus for the period" line and balanced by the net cash movement. Balances by
 *    construction (total Dr = total Cr).
 *  - Statement of financial position (as-of): the balance sheet in Dr/Cr form. Assets are debits,
 *    liabilities and equity are credits; any gap between the two is flagged, not hidden.
 *  - General ledger (account detail): every subsidiary-ledger transaction for one account code,
 *    for a period.
 */
import { buildIncomeStatement, buildCashFlowStatement, buildBalanceSheet, buildTransactionLedger, LEDGER_MAX_ROWS, type LedgerEntry, type LedgerSource } from "./financial-statements";
import { toCents, centsToNumber } from "@shared/money";
import { getDbForOrg } from "./tenant-db";
import { claims, policies } from "@shared/schema";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";

export type AccountClass = "asset" | "liability" | "equity" | "income" | "expense";
export interface Account { code: string; name: string; class: AccountClass; normal: "debit" | "credit"; }

/** Standard chart of accounts for a funeral / life assurer, trimmed to what this system's data
 *  can populate. Codes follow the conventional 1=asset / 2=liability / 3=equity / 4=income /
 *  5=expense block layout. */
export const CHART_OF_ACCOUNTS: Account[] = [
  { code: "1100", name: "Cash and bank", class: "asset", normal: "debit" },
  { code: "1200", name: "Premium receivables", class: "asset", normal: "debit" },
  { code: "1300", name: "Investments and prescribed assets", class: "asset", normal: "debit" },
  { code: "1400", name: "Property, plant and equipment", class: "asset", normal: "debit" },
  { code: "2100", name: "Policyholder liabilities (claims payable)", class: "liability", normal: "credit" },
  { code: "2200", name: "Reinsurer / underwriter payable", class: "liability", normal: "credit" },
  { code: "2300", name: "Commission payable", class: "liability", normal: "credit" },
  { code: "2400", name: "Trade and other payables", class: "liability", normal: "credit" },
  { code: "2900", name: "Platform fees payable", class: "liability", normal: "credit" },
  { code: "3100", name: "Share capital and contributions", class: "equity", normal: "credit" },
  { code: "3200", name: "Retained earnings (prior periods)", class: "equity", normal: "credit" },
  { code: "3900", name: "Surplus / (deficit) for the period", class: "equity", normal: "credit" },
  { code: "4100", name: "Gross premium income — individual", class: "income", normal: "credit" },
  { code: "4200", name: "Gross premium income — group", class: "income", normal: "credit" },
  { code: "4300", name: "Cash service income", class: "income", normal: "credit" },
  { code: "4400", name: "Legacy group income", class: "income", normal: "credit" },
  { code: "4900", name: "Other and investment income", class: "income", normal: "credit" },
  { code: "5100", name: "Claims and benefits", class: "expense", normal: "debit" },
  { code: "5200", name: "Commission expense", class: "expense", normal: "debit" },
  { code: "5300", name: "Reinsurance / underwriter premium", class: "expense", normal: "debit" },
  { code: "5400", name: "Operating and administrative expenses", class: "expense", normal: "debit" },
];

const ACC = (code: string) => CHART_OF_ACCOUNTS.find((a) => a.code === code)!;

/** The double entry each transaction-ledger event makes: [debit account, credit account]. The
 *  same rules as assembleTrialBalance, so the General Ledger's account totals equal it. */
export const POSTINGS: Record<LedgerSource, [string, string]> = {
  premium: ["1100", "4100"],
  premium_group: ["1100", "4200"],
  cash_service: ["1100", "4300"],
  legacy_group: ["1100", "4400"],
  requisition: ["5400", "1100"],
  expenditure: ["5400", "1100"],
  petty_cash: ["5400", "1100"],
  commission_earned: ["5200", "2300"],
  commission_paid: ["2300", "1100"],
  platform_fee: ["5400", "2900"],
  pol263_bill: ["2900", "1100"],
  payroll: ["5400", "2400"],
  payroll_paid: ["2400", "1100"],
  claim: ["5100", "2100"],
  claim_paid: ["2100", "1100"],
};

/** The income or expense account an event lands in — for a payment of something already owed,
 *  the liability it reduces. */
export function accountForLedgerEntry(e: LedgerEntry): Account {
  const [dr, cr] = POSTINGS[e.source];
  return ACC(e.type === "income" ? cr : dr);
}

type AmountMap = Record<string, number>;
const add = (m: AmountMap, c: string, v: number) => { const k = (c || "USD").toUpperCase(); m[k] = (m[k] || 0) + v; };
const round2 = (m: AmountMap): AmountMap => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v.toFixed(2))]));

export interface TrialBalanceRow {
  code: string;
  name: string;
  class: AccountClass;
  debit: AmountMap;
  credit: AmountMap;
}
export interface TrialBalanceResult {
  from: string;
  to: string;
  currencies: string[];
  rows: TrialBalanceRow[];
  totals: { debit: AmountMap; credit: AmountMap };
  /** per currency: debits equal credits to the cent */
  balanced: Record<string, boolean>;
  /** Income less expenses for the period — shown under the table, not as a line (the income and
   *  expense accounts are already in it). */
  surplus: AmountMap;
  note: string;
}

/** The parts of the income and cash-flow statements a trial balance is built from. */
export interface TrialBalanceInputs {
  income: { premiumIndividual: AmountMap; premiumGroup: AmountMap; cashServices: AmountMap; legacyGroupIncome: AmountMap; total: AmountMap };
  expenses: { lines: { source: string; amounts: AmountMap }[]; total: AmountMap };
  cashFlow: {
    netCash: AmountMap;
    outflows: { commissions?: AmountMap; payroll?: AmountMap; claims?: AmountMap; pol263Bills?: AmountMap };
  };
}

/**
 * Movements trial balance for a period, built the standard way:
 *  - income and expense accounts straight from the income statement;
 *  - cash and bank = net cash movement from the cash-flow statement;
 *  - anything recognised as a cost but not yet paid (or paid beyond what was recognised) is the
 *    movement on its liability: commission payable (earned − paid), platform fees payable (fees −
 *    POL263 bills paid), other payables (approved payroll − payroll paid), claims payable
 *    (claims recognised − cash claims paid).
 * Because the income statement's cash-basis lines are exactly the cash-flow statement's, those
 * payables are the only gap between profit and cash, so debits equal credits by construction.
 * Pure — exported for tests.
 */
export function assembleTrialBalance(inp: TrialBalanceInputs): { rows: TrialBalanceRow[]; surplus: AmountMap } {
  // Signed movements in cents per account: + = debit, − = credit.
  const moves = new Map<string, Record<string, number>>();
  const post = (code: string, m: AmountMap | undefined, sign: 1 | -1) => {
    for (const [c, v] of Object.entries(m ?? {})) {
      const cents = toCents(v);
      if (!cents) continue;
      const k = (c || "USD").toUpperCase();
      const acc = moves.get(code) ?? {};
      acc[k] = (acc[k] ?? 0) + sign * cents;
      moves.set(code, acc);
    }
  };
  const sumSource = (sources: string[]) => {
    const out: AmountMap = {};
    for (const l of inp.expenses.lines) if (sources.includes(l.source)) for (const [c, v] of Object.entries(l.amounts)) add(out, c, v);
    return out;
  };

  // Income — credits.
  post("4100", inp.income.premiumIndividual, -1);
  post("4200", inp.income.premiumGroup, -1);
  post("4300", inp.income.cashServices, -1);
  post("4400", inp.income.legacyGroupIncome, -1);

  // Expenses — debits, by the source each income-statement line is tagged with.
  const claimsCost = sumSource(["claims"]);
  const commissionCost = sumSource(["commission"]);
  const feesCost = sumSource(["platform_fee"]);
  const payrollCost = sumSource(["payroll"]);
  post("5100", claimsCost, 1);
  post("5200", commissionCost, 1);
  post("5400", Object.fromEntries(
    Object.entries(inp.expenses.total).map(([c, v]) => [c, v - (claimsCost[c] ?? 0) - (commissionCost[c] ?? 0)]),
  ), 1);

  // Cash — the cash-flow statement's net movement.
  post("1100", inp.cashFlow.netCash, 1);

  // Liabilities — cost recognised (credit) less cash paid against it (debit).
  const out = inp.cashFlow.outflows;
  post("2300", commissionCost, -1); post("2300", out.commissions, 1);
  post("2900", feesCost, -1); post("2900", out.pol263Bills, 1);
  post("2400", payrollCost, -1); post("2400", out.payroll, 1);
  post("2100", claimsCost, -1); post("2100", out.claims, 1);

  const rows: TrialBalanceRow[] = [];
  for (const [code, byCur] of Array.from(moves.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const debit: AmountMap = {}, credit: AmountMap = {};
    for (const [c, cents] of Object.entries(byCur)) {
      if (cents > 0) debit[c] = centsToNumber(cents);
      else if (cents < 0) credit[c] = centsToNumber(-cents);
    }
    if (!Object.keys(debit).length && !Object.keys(credit).length) continue;
    const a = ACC(code);
    rows.push({ code, name: a.name, class: a.class, debit, credit });
  }

  const surplus: AmountMap = {};
  for (const [c, v] of Object.entries(inp.income.total)) add(surplus, c, v);
  for (const [c, v] of Object.entries(inp.expenses.total)) add(surplus, c, -v);
  return { rows, surplus: round2(surplus) };
}

export async function buildTrialBalance(orgId: string, params: { from: string; to: string; branchId?: string }): Promise<TrialBalanceResult> {
  const { from, to, branchId } = params;
  const [is, cf] = await Promise.all([
    buildIncomeStatement(orgId, { from, to, branchId }),
    buildCashFlowStatement(orgId, { from, to, branchId }),
  ]);
  const { rows, surplus } = assembleTrialBalance({ income: is.income, expenses: is.expenses, cashFlow: cf });

  const debitCents: Record<string, number> = {}, creditCents: Record<string, number> = {};
  for (const r of rows) {
    for (const [c, v] of Object.entries(r.debit)) debitCents[c] = (debitCents[c] ?? 0) + toCents(v);
    for (const [c, v] of Object.entries(r.credit)) creditCents[c] = (creditCents[c] ?? 0) + toCents(v);
  }
  const currencies = Array.from(new Set([...Object.keys(debitCents), ...Object.keys(creditCents)])).sort();
  const balanced: Record<string, boolean> = {};
  for (const c of currencies) balanced[c] = (debitCents[c] ?? 0) === (creditCents[c] ?? 0);
  const toMap = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([c, v]) => [c, centsToNumber(v)]));

  return {
    from, to, currencies,
    rows,
    totals: { debit: toMap(debitCents), credit: toMap(creditCents) },
    balanced,
    surplus,
    note: "Movements for the period. Income and expenses come from the income statement; cash and bank is the cash-flow statement's net cash movement; costs recognised but not yet paid (commission, POL263 fees, payroll, claims) sit in their payable accounts. The surplus for the period is shown underneath, not as a line.",
  };
}

export interface PositionRow { code: string; name: string; class: AccountClass; debit: AmountMap; credit: AmountMap; source: "derived" | "manual"; }
export interface PositionResult {
  asOf: string;
  currencies: string[];
  rows: PositionRow[];
  totals: { debit: AmountMap; credit: AmountMap };
  balanced: Record<string, boolean>;
}

/** Balance sheet in debit/credit form. Assets are debit balances; liabilities and equity are
 *  credit balances. Where assets ≠ liabilities + equity (sparse manual entries, no formal
 *  opening balances) the gap surfaces in `balanced` rather than being plugged. */
export async function buildLedgerPosition(orgId: string, params: { asOf: string; branchId?: string }): Promise<PositionResult> {
  const bs = await buildBalanceSheet(orgId, { asOf: params.asOf, branchId: params.branchId });
  const rows: PositionRow[] = [];
  const classifyAsset = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes("cash") || l.includes("bank")) return "1100";
    if (l.includes("receivable")) return "1200";
    if (l.includes("invest") || l.includes("prescribed")) return "1300";
    if (l.includes("property") || l.includes("equipment") || l.includes("vehicle")) return "1400";
    return "1400";
  };
  const classifyLiab = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes("claim") || l.includes("policyholder")) return "2100";
    if (l.includes("salar") || l.includes("payroll")) return "2400";
    if (l.includes("reinsur") || l.includes("underwriter")) return "2200";
    if (l.includes("commission")) return "2300";
    if (l.includes("platform") || l.includes("pol263")) return "2900";
    return "2400";
  };
  const classifyEquity = (label: string): string => {
    const l = label.toLowerCase();
    if (l.includes("retained")) return "3200";
    return "3100";
  };
  const acc = (code: string) => ACC(code);
  for (const line of [...bs.assets.current, ...bs.assets.nonCurrent]) {
    const code = classifyAsset(line.label);
    rows.push({ code, name: acc(code).name, class: "asset", debit: round2(line.amounts), credit: {}, source: line.source });
  }
  for (const line of [...bs.liabilities.current, ...bs.liabilities.nonCurrent]) {
    const code = classifyLiab(line.label);
    rows.push({ code, name: acc(code).name, class: "liability", debit: {}, credit: round2(line.amounts), source: line.source });
  }
  for (const line of bs.equity.lines) {
    const code = classifyEquity(line.label);
    rows.push({ code, name: acc(code).name, class: "equity", debit: {}, credit: round2(line.amounts), source: line.source });
  }

  // Merge rows on the same code.
  const merged = new Map<string, PositionRow>();
  for (const r of rows) {
    const key = `${r.code}|${r.source}`;
    const e = merged.get(key) ?? { code: r.code, name: r.name, class: r.class, debit: {}, credit: {}, source: r.source };
    for (const [c, v] of Object.entries(r.debit)) add(e.debit, c, v);
    for (const [c, v] of Object.entries(r.credit)) add(e.credit, c, v);
    merged.set(key, e);
  }
  const finalRows = Array.from(merged.values()).map((r) => ({ ...r, debit: round2(r.debit), credit: round2(r.credit) }));

  const totalDebit: AmountMap = {}, totalCredit: AmountMap = {};
  for (const r of finalRows) {
    for (const [c, v] of Object.entries(r.debit)) add(totalDebit, c, v);
    for (const [c, v] of Object.entries(r.credit)) add(totalCredit, c, v);
  }
  const currencies = Array.from(new Set([...Object.keys(totalDebit), ...Object.keys(totalCredit)])).sort();
  const balanced: Record<string, boolean> = {};
  for (const c of currencies) balanced[c] = Math.abs((totalDebit[c] || 0) - (totalCredit[c] || 0)) < 0.01;

  return {
    asOf: params.asOf, currencies,
    rows: finalRows.sort((a, b) => a.code.localeCompare(b.code)),
    totals: { debit: round2(totalDebit), credit: round2(totalCredit) },
    balanced,
  };
}

export interface GlLine {
  date: string;
  account: string;
  accountName: string;
  /** The account on the other side of this entry. */
  contraAccount: string;
  description: string;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  currency: string;
}

export interface GlAccountTotal { code: string; name: string; debit: Record<string, number>; credit: Record<string, number> }

/**
 * General ledger: every money event in the period (buildTransactionLedger) posted in double entry
 * (POSTINGS) — each event is a debit line on one account and a credit line on another, so debits
 * equal credits and each account's totals equal its Trial Balance line.
 */
export async function buildGeneralLedger(orgId: string, params: { from: string; to: string; account?: string; branchId?: string }): Promise<{ from: string; to: string; account: string | null; truncated: boolean; lines: GlLine[]; accounts: GlAccountTotal[] }> {
  const { from, to, account, branchId } = params;
  const led = await buildTransactionLedger(orgId, { from, to, branchId, limit: LEDGER_MAX_ROWS });
  const { lines, accounts } = postToGeneralLedger(led.entries, account);
  return { from, to, account: account ?? null, truncated: led.truncated, lines, accounts };
}

/** Pure — exported for tests. Posts ledger events in double entry, optionally for one account. */
export function postToGeneralLedger(entries: LedgerEntry[], account?: string): { lines: GlLine[]; accounts: GlAccountTotal[] } {
  const lines: GlLine[] = [];
  const cents = new Map<string, { debit: Record<string, number>; credit: Record<string, number> }>();
  const tally = (code: string, side: "debit" | "credit", currency: string, amount: number) => {
    const t = cents.get(code) ?? { debit: {}, credit: {} };
    t[side][currency] = (t[side][currency] ?? 0) + toCents(amount);
    cents.set(code, t);
  };
  for (const e of entries) {
    const [dr, cr] = POSTINGS[e.source];
    const cur = (e.currency || "USD").toUpperCase();
    // A negative amount (a commission clawback) reverses the entry's direction.
    const [debitAcc, creditAcc, amt] = e.amount >= 0 ? [dr, cr, e.amount] : [cr, dr, -e.amount];
    tally(debitAcc, "debit", cur, amt);
    tally(creditAcc, "credit", cur, amt);
    if (!account || account === debitAcc) {
      lines.push({ date: e.date, account: debitAcc, accountName: ACC(debitAcc).name, contraAccount: creditAcc, description: e.description, reference: e.reference, debit: amt, credit: null, currency: cur });
    }
    if (!account || account === creditAcc) {
      lines.push({ date: e.date, account: creditAcc, accountName: ACC(creditAcc).name, contraAccount: debitAcc, description: e.description, reference: e.reference, debit: null, credit: amt, currency: cur });
    }
  }
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.account.localeCompare(b.account)));
  const accounts: GlAccountTotal[] = Array.from(cents.entries())
    .filter(([code]) => !account || code === account)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, t]) => ({
      code, name: ACC(code).name,
      debit: Object.fromEntries(Object.entries(t.debit).map(([c, v]) => [c, centsToNumber(v)])),
      credit: Object.fromEntries(Object.entries(t.credit).map(([c, v]) => [c, centsToNumber(v)])),
    }));
  return { lines, accounts };
}
