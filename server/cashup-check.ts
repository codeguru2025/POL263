/**
 * Reports → Finance → Cashups: the daily cash-up check. One line per staff member, per day, per
 * currency on which they took cash (premium + funeral-service receipts paid in cash), set against
 * the cash-up they submitted for that day and currency:
 *   agrees · short / over by X · not cashed up
 * Society lump sums don't record who received them, so they're a separate "not assigned to a
 * staff member" line per day. Tenant-local days; currencies never added together.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg, getOrgTimezone, dateInTimezone } from "./date-utils";
import { toCents, fromCents } from "@shared/money";

export type CashupStatus = "agrees" | "short" | "over" | "not_cashed_up" | "unassigned";

export interface CashupCheckRow {
  date: string;
  userId: string | null;
  staff: string;
  currency: string;
  cashTaken: string;
  receipts: number;
  cashupId: string | null;
  cashupState: string | null;   // draft / submitted / confirmed / discrepancy
  counted: string | null;
  difference: string | null;    // counted − taken
  status: CashupStatus;
}

export interface CashupCheckSummary {
  cashTaken: Record<string, string>;
  cashedUp: Record<string, string>;
  notCashedUp: Record<string, string>;
  unassigned: Record<string, string>;
  counts: Record<CashupStatus, number>;
}

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const day = (d: unknown) => String(d instanceof Date ? d.toISOString() : d ?? "").slice(0, 10);

/** Cash counted on a cash-up: the counted cash if finance recorded one, else the cash the preparer
 *  declared. Null when nothing was counted. */
export function countedCash(c: { countedAmountsByMethod?: any; countedTotal?: any; amountsByMethod?: any }): string | null {
  const counted = c.countedAmountsByMethod?.cash;
  if (counted != null && counted !== "") return fromCents(toCents(counted));
  const declared = c.amountsByMethod?.cash;
  if (declared != null && declared !== "") return fromCents(toCents(declared));
  return null;
}

/** Pure: compare cash taken with what was cashed up. */
export function cashupStatus(taken: string, counted: string | null): { status: CashupStatus; difference: string | null } {
  if (counted == null) return { status: "not_cashed_up", difference: null };
  const diff = toCents(counted) - toCents(taken);
  return { status: diff === 0 ? "agrees" : diff < 0 ? "short" : "over", difference: fromCents(diff) };
}

export async function buildCashupCheck(orgId: string, f: { fromDate?: string; toDate?: string; branchId?: string; userId?: string }): Promise<{ rows: CashupCheckRow[]; summary: CashupCheckSummary }> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const range = (col: any) => sql`${start ? sql`AND ${col} >= ${start}` : sql``} ${endExclusive ? sql`AND ${col} < ${endExclusive}` : sql``}`;

  // Cash receipts by who issued them.
  const cash = rowsOf<{ issued_at: Date; user_id: string | null; amount: string; currency: string }>(await tdb.execute(sql`
    SELECT r.issued_at, r.issued_by_user_id AS user_id, r.amount, r.currency FROM payment_receipts r
    WHERE r.organization_id = ${orgId} AND r.status = 'issued' AND r.payment_channel = 'cash'
      AND (r.approval_status IS NULL OR r.approval_status = 'approved')
      ${range(sql`r.issued_at`)} ${f.branchId ? sql`AND r.branch_id = ${f.branchId}` : sql``} ${f.userId ? sql`AND r.issued_by_user_id = ${f.userId}` : sql``}
    UNION ALL
    SELECT s.issued_at, s.issued_by_user_id, s.amount, s.currency FROM service_receipts s
    WHERE s.organization_id = ${orgId} AND s.status = 'issued' AND s.payment_channel = 'cash'
      ${range(sql`s.issued_at`)} ${f.branchId ? sql`AND s.branch_id = ${f.branchId}` : sql``} ${f.userId ? sql`AND s.issued_by_user_id = ${f.userId}` : sql``}`));

  type Agg = { userId: string | null; date: string; currency: string; cents: number; n: number };
  const groups = new Map<string, Agg>();
  for (const r of cash) {
    const d = dateInTimezone(r.issued_at, tz);
    const cur = (r.currency || "USD").toUpperCase();
    const key = `${r.user_id ?? ""}|${d}|${cur}`;
    const g = groups.get(key) ?? { userId: r.user_id, date: d, currency: cur, cents: 0, n: 0 };
    g.cents += toCents(r.amount);
    g.n++;
    groups.set(key, g);
  }

  // Cash-ups in the period, latest per (preparer, day, currency).
  const cashupRows = rowsOf<any>(await tdb.execute(sql`
    SELECT id, prepared_by, cashup_date, currency, status, amounts_by_method, counted_amounts_by_method, counted_total, created_at
    FROM cashups WHERE organization_id = ${orgId}
      ${f.fromDate ? sql`AND cashup_date >= ${f.fromDate}::date` : sql``} ${f.toDate ? sql`AND cashup_date <= ${f.toDate}::date` : sql``}
      ${f.userId ? sql`AND prepared_by = ${f.userId}` : sql``}
    ORDER BY created_at`));
  const cashupBy = new Map<string, any>();
  for (const c of cashupRows) cashupBy.set(`${c.prepared_by}|${day(c.cashup_date)}|${(c.currency || "USD").toUpperCase()}`, c);

  const userIds = Array.from(new Set([...Array.from(groups.values()).map((g) => g.userId), ...cashupRows.map((c) => c.prepared_by)].filter(Boolean))) as string[];
  const names = new Map<string, string>();
  if (userIds.length) {
    for (const u of rowsOf<{ id: string; display_name: string | null; email: string | null }>(await tdb.execute(sql`
      SELECT id, display_name, email FROM users WHERE id IN (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})`))) {
      names.set(u.id, (u.display_name || u.email || "Staff member").trim());
    }
  }

  const rows: CashupCheckRow[] = [];
  const seen = new Set<string>();
  for (const [key, g] of Array.from(groups.entries())) {
    seen.add(key);
    const c = g.userId ? cashupBy.get(key) : undefined;
    const taken = fromCents(g.cents);
    const counted = c ? countedCash({ countedAmountsByMethod: c.counted_amounts_by_method, countedTotal: c.counted_total, amountsByMethod: c.amounts_by_method }) : null;
    const st = cashupStatus(taken, counted);
    rows.push({
      date: g.date, userId: g.userId, staff: g.userId ? names.get(g.userId) ?? "Staff member" : "Not recorded",
      currency: g.currency, cashTaken: taken, receipts: g.n, cashupId: c?.id ?? null, cashupState: c?.status ?? null,
      counted, difference: st.difference, status: st.status,
    });
  }
  // A cash-up with cash declared on a day the system shows no cash taken by that person.
  for (const [key, c] of Array.from(cashupBy.entries())) {
    if (seen.has(key)) continue;
    const counted = countedCash({ countedAmountsByMethod: c.counted_amounts_by_method, countedTotal: c.counted_total, amountsByMethod: c.amounts_by_method });
    if (counted == null || toCents(counted) === 0) continue;
    const st = cashupStatus("0.00", counted);
    rows.push({
      date: day(c.cashup_date), userId: c.prepared_by, staff: names.get(c.prepared_by) ?? "Staff member", currency: (c.currency || "USD").toUpperCase(),
      cashTaken: "0.00", receipts: 0, cashupId: c.id, cashupState: c.status, counted, difference: st.difference, status: st.status,
    });
  }

  // Society lump sums: no recorded receiver or method — shown per day, unassigned.
  if (!f.branchId && !f.userId) {
    const soc = rowsOf<{ payment_date: unknown; currency: string; total: string; n: string }>(await tdb.execute(sql`
      SELECT payment_date, currency, SUM(amount)::text AS total, COUNT(*)::text AS n FROM legacy_group_receipts
      WHERE organization_id = ${orgId}
        ${f.fromDate ? sql`AND payment_date >= ${f.fromDate}::date` : sql``} ${f.toDate ? sql`AND payment_date <= ${f.toDate}::date` : sql``}
      GROUP BY payment_date, currency`));
    for (const s of soc) {
      rows.push({
        date: day(s.payment_date), userId: null, staff: "Society lump sums — not assigned to a staff member", currency: (s.currency || "USD").toUpperCase(),
        cashTaken: fromCents(toCents(s.total)), receipts: Number(s.n), cashupId: null, cashupState: null, counted: null, difference: null, status: "unassigned",
      });
    }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.staff.localeCompare(b.staff)));
  return { rows, summary: summarizeCashupCheck(rows) };
}

/** Pure — per-currency totals and status counts. */
export function summarizeCashupCheck(rows: CashupCheckRow[]): CashupCheckSummary {
  const add = (m: Record<string, number>, c: string, v: number) => { m[c] = (m[c] ?? 0) + v; };
  const taken: Record<string, number> = {}, up: Record<string, number> = {}, notUp: Record<string, number> = {}, un: Record<string, number> = {};
  const counts: Record<CashupStatus, number> = { agrees: 0, short: 0, over: 0, not_cashed_up: 0, unassigned: 0 };
  for (const r of rows) {
    counts[r.status]++;
    const t = toCents(r.cashTaken);
    if (r.status === "unassigned") { add(un, r.currency, t); continue; }
    add(taken, r.currency, t);
    if (r.status === "not_cashed_up") add(notUp, r.currency, t);
    else if (r.counted != null) add(up, r.currency, toCents(r.counted));
  }
  const s = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fromCents(v)]));
  return { cashTaken: s(taken), cashedUp: s(up), notCashedUp: s(notUp), unassigned: s(un), counts };
}
