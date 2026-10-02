/**
 * Reports → Finance → Budget: each month's target next to what actually happened, so the people
 * who set the budget see how they're doing in the same place (Augustus, 2 Oct 2026).
 *   Income / expenses — the income statement's figures (buildIncomeTimeSeries, monthly), in USD.
 *   New policies      — new business only, as the New joinings report counts it (no legacy captures).
 * The month in progress is compared with the share of its target for the days gone by, so the
 * 2nd of the month doesn't read as a 95% shortfall. Targets entered in another currency are
 * converted with the org's exchange rates.
 */
import { buildIncomeTimeSeries, fxMapFor, consolidateToUsd } from "./financial-statements";
import { storage } from "./storage";
import { todayForOrg } from "./date-utils";

export const BUDGET_CATEGORIES = ["total_income", "total_expenses", "new_policies"] as const;
export type BudgetCategory = typeof BUDGET_CATEGORIES[number];

const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};

/** Pure — share of a month (YYYY-MM-01) inside [from, to] (inclusive YYYY-MM-DD dates), 0…1. */
export function monthShareInRange(month: string, from: string, to: string): number {
  const ym = month.slice(0, 7);
  const first = `${ym}-01`;
  const last = `${ym}-${String(daysInMonth(first)).padStart(2, "0")}`;
  const a = from > first ? from : first;
  const b = to < last ? to : last;
  if (a > b) return 0;
  const days = Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000) + 1;
  return days / daysInMonth(first);
}

/** Pure — target (USD, or a count) for [from, to], pro-rating part-covered months. */
export function budgetForRange(rows: Array<{ periodMonth: string; category: string; amount: string | number; currency?: string | null }>, category: string, from: string, to: string, fx: Record<string, number>): number {
  let total = 0;
  for (const r of rows) {
    if (r.category !== category) continue;
    const share = monthShareInRange(String(r.periodMonth).slice(0, 10), from, to);
    if (!share) continue;
    const amount = Number(r.amount);
    const value = category === "new_policies" ? amount : amount * (fx[(r.currency || "USD").toUpperCase()] ?? 0);
    total += value * share;
  }
  return total;
}

export interface VarianceCell { target: number | null; actual: number | null; variance: number | null; variancePct: number | null }

/** Pure — actual against target; null target = nothing budgeted, null actual = month not started. */
export function compareToBudget(actual: number | null, target: number | null, decimals = 2): VarianceCell {
  const r = (n: number) => Number(n.toFixed(decimals));
  if (target == null || actual == null) return { target: target == null ? null : r(target), actual: actual == null ? null : r(actual), variance: null, variancePct: null };
  return { target: r(target), actual: r(actual), variance: r(actual - target), variancePct: target === 0 ? null : Number((((actual - target) / Math.abs(target)) * 100).toFixed(1)) };
}

export interface BudgetMonthRow {
  month: string;              // YYYY-MM-01
  share: number;              // share of the month gone by (1 = complete, 0 = not started)
  income: VarianceCell;
  expenses: VarianceCell;
  newPolicies: VarianceCell;
}

export async function buildBudgetVsActual(orgId: string, year: string): Promise<{ year: string; today: string; months: BudgetMonthRow[]; yearToDate: Omit<BudgetMonthRow, "month" | "share">; unconvertible: string[] }> {
  const today = await todayForOrg(orgId);
  const from = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  const to = today < yearEnd ? today : yearEnd;
  const fx = await fxMapFor(orgId);
  const budgetRows = await storage.getBudgets(orgId, { from, to: yearEnd });
  const started = from <= to;

  const [series, joinings] = started
    ? await Promise.all([
        buildIncomeTimeSeries(orgId, { from, to, bucket: "month" } as any),
        storage.getNewJoiningsReportByOrg(orgId, 100000, 0, { fromDate: from, toDate: to } as any),
      ])
    : [[], []];
  const unconvertible = new Set<string>();
  const usd = (m: Record<string, number>) => { const c = consolidateToUsd(m, fx); c.unconvertible.forEach((x) => unconvertible.add(x)); return c.usd; };
  const newByMonth: Record<string, number> = {};
  for (const j of joinings) if (!j.isLegacy && j.capturedOn) newByMonth[`${j.capturedOn.slice(0, 7)}-01`] = (newByMonth[`${j.capturedOn.slice(0, 7)}-01`] ?? 0) + 1;
  const hasTarget = (cat: string, month: string) => budgetRows.some((r) => r.category === cat && String(r.periodMonth).slice(0, 7) === month.slice(0, 7));

  const months: BudgetMonthRow[] = [];
  // Year to date: compared over the months that have a target; actual over every month when none do.
  const ytd = { income: { t: 0, a: 0, am: 0, any: false }, expenses: { t: 0, a: 0, am: 0, any: false }, newPolicies: { t: 0, a: 0, am: 0, any: false } };
  for (let i = 1; i <= 12; i++) {
    const month = `${year}-${String(i).padStart(2, "0")}-01`;
    const share = started ? monthShareInRange(month, from, to) : 0;
    const point = series.find((p) => p.periodStart === month);
    const actualIncome = share > 0 ? usd(point?.income ?? {}) : null;
    const actualExpenses = share > 0 ? usd(point?.expenses ?? {}) : null;
    const actualNew = share > 0 ? newByMonth[month] ?? 0 : null;
    // Compare with the share of the target for the days gone by (whole month once it's over).
    const monthEnd = `${month.slice(0, 7)}-${String(daysInMonth(month)).padStart(2, "0")}`;
    const toDate = share > 0 ? (to < monthEnd ? to : monthEnd) : monthEnd;
    const target = (cat: string) => (hasTarget(cat, month) ? budgetForRange(budgetRows, cat, month, share > 0 ? toDate : monthEnd, fx) : null);
    const row: BudgetMonthRow = {
      month, share: Number(share.toFixed(4)),
      income: compareToBudget(actualIncome, target("total_income")),
      expenses: compareToBudget(actualExpenses, target("total_expenses")),
      newPolicies: compareToBudget(actualNew, target("new_policies"), 0),
    };
    months.push(row);
    for (const [k, cell] of [["income", row.income], ["expenses", row.expenses], ["newPolicies", row.newPolicies]] as const) {
      if (cell.actual != null) ytd[k].a += cell.actual;
      if (cell.actual != null && cell.target != null) { ytd[k].t += cell.target; ytd[k].am += cell.actual; ytd[k].any = true; }
    }
  }
  const total = (k: keyof typeof ytd, d = 2) => (ytd[k].any ? compareToBudget(ytd[k].am, ytd[k].t, d) : compareToBudget(ytd[k].a, null, d));
  return { year, today, months, yearToDate: { income: total("income"), expenses: total("expenses"), newPolicies: total("newPolicies", 0) }, unconvertible: Array.from(unconvertible) };
}
