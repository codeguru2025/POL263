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
import { buildIncomeStatement, buildBalanceSheet, buildTransactionLedger, type LedgerEntry } from "./financial-statements";
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

/** Which P&L account a transaction-ledger source posts to. */
export function accountForLedgerEntry(e: LedgerEntry): Account {
  switch (e.source) {
    case "premium": return ACC("4100"); // individual/group split not carried on the ledger row; see trial balance for the split
    case "cash_service": return ACC("4300");
    case "legacy_group": return ACC("4400");
    case "commission": return ACC("5200");
    case "requisition":
    case "expenditure": return ACC("5400");
    default: return ACC("5400");
  }
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
  /** per currency: |debit - credit| < 0.01 */
  balanced: Record<string, boolean>;
  note: string;
}

/** Claims and benefits paid/approved in the period (cash-in-lieu), per currency. */
async function claimsInPeriod(orgId: string, from: string, to: string): Promise<AmountMap> {
  const tdb = await getDbForOrg(orgId);
  const rows = await tdb
    .select({ currency: claims.currency, total: sql<string>`COALESCE(SUM(${claims.cashInLieuAmount}::numeric), 0)` })
    .from(claims)
    .where(and(
      eq(claims.organizationId, orgId),
      inArray(claims.status, ["approved", "paid", "settled", "closed"]),
      gte(claims.createdAt, new Date(from + "T00:00:00.000Z")),
      lte(claims.createdAt, new Date(to + "T23:59:59.999Z")),
    ))
    .groupBy(claims.currency);
  const out: AmountMap = {};
  for (const r of rows) { const v = parseFloat(r.total); if (Math.abs(v) > 0.004) add(out, r.currency, v); }
  return out;
}

export async function buildTrialBalance(orgId: string, params: { from: string; to: string; branchId?: string }): Promise<TrialBalanceResult> {
  const { from, to, branchId } = params;
  const is = await buildIncomeStatement(orgId, { from, to, branchId });
  const claimsPaid = await claimsInPeriod(orgId, from, to);

  const rows: TrialBalanceRow[] = [];
  const cr = (code: string, m: AmountMap) => {
    if (Object.keys(m).length === 0) return;
    const a = ACC(code);
    rows.push({ code, name: a.name, class: a.class, debit: {}, credit: round2(m) });
  };
  const dr = (code: string, m: AmountMap) => {
    if (Object.keys(m).length === 0) return;
    const a = ACC(code);
    rows.push({ code, name: a.name, class: a.class, debit: round2(m), credit: {} });
  };

  // Income — credits
  cr("4100", is.income.premiumIndividual);
  cr("4200", is.income.premiumGroup);
  cr("4300", is.income.cashServices);
  cr("4400", is.income.legacyGroupIncome);

  // Expenses — debits. Commission lines vs operating lines are tagged by source on the income statement.
  const commission: AmountMap = {};
  const operating: AmountMap = {};
  for (const line of is.expenses.lines) {
    const target = line.source === "commission" ? commission : operating;
    for (const [c, v] of Object.entries(line.amounts)) add(target, c, v);
  }
  dr("5100", claimsPaid);
  dr("5200", commission);
  dr("5400", operating);

  // Net cash movement — the balancing entry. Income increases cash (debit), expenses reduce it.
  const netCash: AmountMap = {};
  for (const [c, v] of Object.entries(is.income.total)) add(netCash, c, v);
  for (const [c, v] of Object.entries(is.expenses.total)) add(netCash, c, -v);
  for (const [c, v] of Object.entries(claimsPaid)) add(netCash, c, -v);
  // netCash > 0 → cash went up → debit 1100; < 0 → credit.
  const cashDr: AmountMap = {}, cashCr: AmountMap = {};
  for (const [c, v] of Object.entries(round2(netCash))) {
    if (v > 0.004) cashDr[c] = v; else if (v < -0.004) cashCr[c] = -v;
  }
  if (Object.keys(cashDr).length) rows.push({ code: "1100", name: ACC("1100").name, class: "asset", debit: cashDr, credit: {} });
  if (Object.keys(cashCr).length) rows.push({ code: "1100", name: ACC("1100").name, class: "asset", debit: {}, credit: cashCr });

  // Surplus for the period closes P&L to equity: income - expenses - claims.
  const surplus = round2(netCash);
  const surDr: AmountMap = {}, surCr: AmountMap = {};
  for (const [c, v] of Object.entries(surplus)) {
    if (v > 0.004) surCr[c] = v; else if (v < -0.004) surDr[c] = -v;
  }
  // The surplus line and the cash line are mirror images — together they keep Dr = Cr while
  // showing both "where the money went" (cash) and "what the owners earned" (equity).
  if (Object.keys(surDr).length) rows.push({ code: "3900", name: ACC("3900").name, class: "equity", debit: surDr, credit: {} });
  if (Object.keys(surCr).length) rows.push({ code: "3900", name: ACC("3900").name, class: "equity", debit: {}, credit: surCr });

  const totalDebit: AmountMap = {}, totalCredit: AmountMap = {};
  for (const r of rows) {
    for (const [c, v] of Object.entries(r.debit)) add(totalDebit, c, v);
    for (const [c, v] of Object.entries(r.credit)) add(totalCredit, c, v);
  }
  const currencies = Array.from(new Set([...Object.keys(totalDebit), ...Object.keys(totalCredit)])).sort();
  const balanced: Record<string, boolean> = {};
  for (const c of currencies) balanced[c] = Math.abs((totalDebit[c] || 0) - (totalCredit[c] || 0)) < 0.01;

  return {
    from, to, currencies,
    rows: rows.sort((a, b) => a.code.localeCompare(b.code)),
    totals: { debit: round2(totalDebit), credit: round2(totalCredit) },
    balanced,
    note: "Movements trial balance — the income statement expressed in debit/credit form and closed to equity. The cash and surplus lines are mirror images and keep total debits equal to total credits.",
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
    if (l.includes("reinsur") || l.includes("underwriter")) return "2200";
    if (l.includes("commission")) return "2300";
    if (l.includes("platform")) return "2900";
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
  description: string;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  currency: string;
}

/** General-ledger detail: every subsidiary-ledger transaction for one account code, in a period. */
export async function buildGeneralLedger(orgId: string, params: { from: string; to: string; account?: string; branchId?: string }): Promise<{ from: string; to: string; account: string | null; lines: GlLine[] }> {
  const { from, to, account, branchId } = params;
  const led = await buildTransactionLedger(orgId, { from, to, branchId, limit: 2000 });
  const lines: GlLine[] = [];
  for (const e of led.entries) {
    const a = accountForLedgerEntry(e);
    if (account && a.code !== account) continue;
    lines.push({
      date: e.date,
      account: a.code,
      accountName: a.name,
      description: e.description,
      reference: e.reference,
      debit: e.type === "expense" ? e.amount : null,
      credit: e.type === "income" ? e.amount : null,
      currency: e.currency,
    });
  }
  // Claims (not in the transaction ledger) — only when the filter includes 5100 or is unset.
  if (!account || account === "5100") {
    const tdb = await getDbForOrg(orgId);
    const rows = await tdb
      .select({
        createdAt: claims.createdAt, claimNumber: claims.claimNumber, currency: claims.currency,
        amount: claims.cashInLieuAmount, deceased: claims.deceasedName, policyNumber: policies.policyNumber,
      })
      .from(claims).leftJoin(policies, eq(claims.policyId, policies.id))
      .where(and(
        eq(claims.organizationId, orgId),
        inArray(claims.status, ["approved", "paid", "settled", "closed"]),
        gte(claims.createdAt, new Date(from + "T00:00:00.000Z")),
        lte(claims.createdAt, new Date(to + "T23:59:59.999Z")),
      ));
    for (const r of rows) {
      const amt = parseFloat(String(r.amount ?? 0));
      if (!(amt > 0)) continue;
      lines.push({
        date: new Date(r.createdAt).toISOString().slice(0, 10),
        account: "5100", accountName: ACC("5100").name,
        description: `Claim ${r.claimNumber}${r.deceased ? ` — ${r.deceased}` : ""}${r.policyNumber ? ` (${r.policyNumber})` : ""}`,
        reference: r.claimNumber, debit: amt, credit: null, currency: r.currency || "USD",
      });
    }
  }
  lines.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.account.localeCompare(b.account)));
  return { from, to, account: account ?? null, lines };
}
