/**
 * Reports → Book Health → Collection efficiency (Augustus, 2 Oct 2026), policy by policy:
 *   Expected — for each policy in force during the period (status rebuilt from the status
 *              history), the premiums falling due in the window by its schedule, in its currency.
 *   Collected — receipts that count, issued in the window, against that policy, converted to the
 *              policy's currency at the org's rates when paid in another (flagged).
 * Society members (ledger / legacy groups) are paid through the society's lump sums, so societies
 * are their own section: expected = members' premiums due, collected = the society's lump sums.
 * Totals per currency; by branch and by agent; the policies furthest behind. Tenant-local days.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { getOrgTimezone, dateInTimezone } from "./date-utils";
import { fxMapFor } from "./financial-statements";
import { statusAt, type StatusEvent } from "./lapse-analysis";
import { toCents, fromCents } from "@shared/money";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const IN_FORCE = new Set(["active", "grace"]);

/** Pure — due dates of a schedule anchored on `anchor` that fall in [from, to] (YYYY-MM-DD). */
export function dueDatesInWindow(anchor: string, schedule: string | null | undefined, from: string, to: string): string[] {
  const s = (schedule || "monthly").toLowerCase();
  const out: string[] = [];
  const a = new Date(anchor + "T00:00:00Z");
  const step = (k: number) => {
    const d = new Date(a);
    if (s === "weekly") d.setUTCDate(d.getUTCDate() + 7 * k);
    else if (s === "biweekly" || s === "fortnightly") d.setUTCDate(d.getUTCDate() + 14 * k);
    else if (s === "quarterly") d.setUTCMonth(d.getUTCMonth() + 3 * k);
    else if (s === "yearly" || s === "annually") d.setUTCFullYear(d.getUTCFullYear() + k);
    else {
      // monthly: same day of month, clamped to the month's last day
      const day = a.getUTCDate();
      d.setUTCDate(1);
      d.setUTCMonth(a.getUTCMonth() + k);
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      d.setUTCDate(Math.min(day, last));
    }
    return d.toISOString().slice(0, 10);
  };
  for (let k = 0; k < 2000; k++) {
    const d = step(k);
    if (d > to) break;
    if (d >= from) out.push(d);
  }
  return out;
}

export interface PolicyCollection {
  policyId: string; policyNumber: string; client: string; phone: string; branch: string; agent: string; currency: string;
  premium: string; due: number; expected: string; collected: string; shortfall: string; otherCurrency: boolean;
}
export interface CollectionLine { key: string; currency: string; policies: number; expected: string; collected: string; ratePct: number | null }

const rate = (c: number, e: number) => (e > 0 ? Number(((c / e) * 100).toFixed(1)) : null);

/** Pure — totals per (key, currency). */
export function rollUp(rows: PolicyCollection[], keyOf: (r: PolicyCollection) => string): CollectionLine[] {
  const m = new Map<string, { key: string; currency: string; policies: number; e: number; c: number }>();
  for (const r of rows) {
    const k = `${keyOf(r)}|${r.currency}`;
    const x = m.get(k) ?? { key: keyOf(r), currency: r.currency, policies: 0, e: 0, c: 0 };
    x.policies++; x.e += toCents(r.expected); x.c += toCents(r.collected);
    m.set(k, x);
  }
  return Array.from(m.values()).map((x) => ({ key: x.key, currency: x.currency, policies: x.policies, expected: fromCents(x.e), collected: fromCents(x.c), ratePct: rate(x.c, x.e) }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.currency.localeCompare(b.currency));
}

export async function buildCollectionEfficiency(orgId: string, f: { fromDate: string; toDate: string; branchId?: string; agentId?: string }) {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const fx = await fxMapFor(orgId);
  const pol = rowsOf<any>(await tdb.execute(sql`
    SELECT p.id, p.policy_number, p.status, p.created_at, p.inception_date, p.premium_amount, p.payment_schedule, p.currency, p.group_id,
      COALESCE(g.has_ledger, false) OR COALESCE(g.is_legacy, false) AS society, g.name AS group_name,
      b.name AS branch, u.display_name AS agent, c.first_name, c.last_name, c.phone
    FROM policies p
    LEFT JOIN groups g ON g.id = p.group_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN users u ON u.id = p.agent_id
    LEFT JOIN clients c ON c.id = p.client_id
    WHERE p.organization_id = ${orgId} AND p.deleted_at IS NULL AND p.inception_date IS NOT NULL AND p.inception_date <= ${f.toDate}::date
      ${f.branchId ? sql`AND p.branch_id = ${f.branchId}` : sql``} ${f.agentId ? sql`AND p.agent_id = ${f.agentId}` : sql``}`));
  const ids = pol.map((p) => p.id);
  if (!ids.length) return { individuals: [] as PolicyCollection[], totals: [] as CollectionLine[], byBranch: [] as CollectionLine[], byAgent: [] as CollectionLine[], societies: [] as any[], societiesNotMeasured: [] as any[], behind: [] as PolicyCollection[], otherCurrencyReceipts: 0 };
  const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const hist = rowsOf<any>(await tdb.execute(sql`SELECT policy_id, from_status, to_status, created_at FROM policy_status_history WHERE policy_id IN (${idList})`));
  const events = new Map<string, StatusEvent[]>();
  for (const h of hist) { const l = events.get(h.policy_id) ?? []; l.push({ from: h.from_status, to: h.to_status, at: new Date(h.created_at) }); events.set(h.policy_id, l); }

  // Receipts that count, issued in the window (local days).
  const receipts = rowsOf<any>(await tdb.execute(sql`
    SELECT policy_id, amount, currency, issued_at FROM payment_receipts
    WHERE organization_id = ${orgId} AND status = 'issued' AND (approval_status IS NULL OR approval_status = 'approved')
      AND policy_id IN (${idList})
      AND issued_at >= (${f.fromDate}::date - interval '1 day') AND issued_at < (${f.toDate}::date + interval '2 day')`))
    .filter((r) => { const d = dateInTimezone(new Date(r.issued_at), tz); return d >= f.fromDate && d <= f.toDate; });
  const paid = new Map<string, { cents: number; other: boolean }>();
  const polCur = new Map(pol.map((p) => [p.id, String(p.currency || "USD").toUpperCase()]));
  let otherCurrencyReceipts = 0;
  for (const r of receipts) {
    const pc = polCur.get(r.policy_id)!;
    const rc = String(r.currency || "USD").toUpperCase();
    let cents = toCents(r.amount);
    let other = false;
    if (rc !== pc) {
      other = true; otherCurrencyReceipts++;
      cents = fx[rc] && fx[pc] ? Math.round((cents * fx[rc]) / fx[pc]) : 0;
    }
    const x = paid.get(r.policy_id) ?? { cents: 0, other: false };
    x.cents += cents; x.other = x.other || other;
    paid.set(r.policy_id, x);
  }

  const individuals: PolicyCollection[] = [];
  const society = new Map<string, { group: string; currency: string; members: number; expected: number }>();
  for (const p of pol) {
    const anchor = String(p.inception_date instanceof Date ? p.inception_date.toISOString() : p.inception_date).slice(0, 10);
    const dues = dueDatesInWindow(anchor, p.payment_schedule, f.fromDate, f.toDate)
      .filter((d) => { const s = statusAt(events.get(p.id) ?? [], new Date(p.created_at), p.status, new Date(d + "T23:59:59Z")); return !!s && IN_FORCE.has(s); });
    if (!dues.length) continue;
    const cur = String(p.currency || "USD").toUpperCase();
    const expected = toCents(p.premium_amount) * dues.length;
    if (p.society) {
      const k = `${p.group_id}|${cur}`;
      const s = society.get(k) ?? { group: p.group_name || "Society", currency: cur, members: 0, expected: 0 };
      s.members++; s.expected += expected;
      society.set(k, s);
      continue;
    }
    const got = paid.get(p.id) ?? { cents: 0, other: false };
    individuals.push({
      policyId: p.id, policyNumber: p.policy_number, client: [p.first_name, p.last_name].filter(Boolean).join(" "), phone: p.phone ?? "",
      branch: p.branch || "(No branch)", agent: p.agent || "No agent", currency: cur, premium: fromCents(toCents(p.premium_amount)), due: dues.length,
      expected: fromCents(expected), collected: fromCents(got.cents), shortfall: fromCents(Math.max(0, expected - got.cents)), otherCurrency: got.other,
    });
  }

  // Societies: the lump sums received in the window, converted to the members' premium currency.
  // A society that paid but has no members captured as policies can't be measured — listed apart.
  const lumpRows = !f.branchId && !f.agentId ? rowsOf<any>(await tdb.execute(sql`
    SELECT l.group_id, g.name, l.currency, SUM(l.amount)::text AS total FROM legacy_group_receipts l LEFT JOIN groups g ON g.id = l.group_id
    WHERE l.organization_id = ${orgId} AND l.payment_date >= ${f.fromDate}::date AND l.payment_date <= ${f.toDate}::date GROUP BY 1, 2, 3`)) : [];
  const memberCur = new Map<string, string>();
  for (const k of Array.from(society.keys())) memberCur.set(k.split("|")[0], k.split("|")[1]);
  const lump = new Map<string, number>();
  const unmeasured = new Map<string, { group: string; received: Record<string, number> }>();
  for (const r of lumpRows) {
    const rc = String(r.currency || "USD").toUpperCase();
    const target = memberCur.get(r.group_id);
    if (!target) {
      const u = unmeasured.get(r.group_id) ?? { group: r.name || "Society", received: {} as Record<string, number> };
      u.received[rc] = (u.received[rc] ?? 0) + toCents(r.total);
      unmeasured.set(r.group_id, u);
      continue;
    }
    const cents = rc === target ? toCents(r.total) : (fx[rc] && fx[target] ? Math.round((toCents(r.total) * fx[rc]) / fx[target]) : 0);
    lump.set(`${r.group_id}|${target}`, (lump.get(`${r.group_id}|${target}`) ?? 0) + cents);
  }
  const societies = Array.from(society.entries()).map(([k, s]) => ({
    group: s.group, currency: s.currency, members: s.members, expected: fromCents(s.expected), collected: fromCents(lump.get(k) ?? 0), ratePct: rate(lump.get(k) ?? 0, s.expected),
  })).sort((a, b) => (a.ratePct ?? 0) - (b.ratePct ?? 0));
  const societiesNotMeasured = Array.from(unmeasured.values())
    .map((u) => ({ group: u.group, received: Object.fromEntries(Object.entries(u.received).map(([c, v]) => [c, fromCents(v)])) }))
    .sort((a, b) => a.group.localeCompare(b.group));

  const totals = [
    ...rollUp(individuals, () => "Individual policies"),
    ...(() => {
      const m = new Map<string, { e: number; c: number; n: number }>();
      for (const s of societies) { const x = m.get(s.currency) ?? { e: 0, c: 0, n: 0 }; x.e += toCents(s.expected); x.c += toCents(s.collected); x.n += s.members; m.set(s.currency, x); }
      return Array.from(m.entries()).map(([currency, x]) => ({ key: "Society members", currency, policies: x.n, expected: fromCents(x.e), collected: fromCents(x.c), ratePct: rate(x.c, x.e) }));
    })(),
  ];
  const behind = individuals.filter((r) => toCents(r.shortfall) > 0).sort((a, b) => toCents(b.shortfall) - toCents(a.shortfall)).slice(0, 500);
  return { individuals, totals, byBranch: rollUp(individuals, (r) => r.branch), byAgent: rollUp(individuals, (r) => r.agent), societies, societiesNotMeasured, behind, otherCurrencyReceipts };
}
