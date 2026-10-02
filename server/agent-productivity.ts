/**
 * Reports → Agents → Agent productivity: a scorecard per agent for the period (Augustus, 2 Oct 2026).
 *   Sales     — new business sold in the period (New joinings' definition: existing policies typed
 *               in are not sales, shown separately), how many paid (own receipt or through the
 *               society), conversion %, new monthly premium sold, average premium and lives covered.
 *   Book      — money collected on the agent's policies in the period (premium receipts, plus the
 *               lump sums of societies they look after), lapses in the period, persistency.
 *   Quality   — of what they sold in the 6 months to the period end, how many never paid or lapsed.
 *   Cost      — commission earned and clawed back in the period, and commission as % of collected.
 *   Rank      — by new monthly premium sold (USD equivalent).
 * Tenant-local days; amounts kept per currency, USD equivalents only for ranking and ratios.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg } from "./date-utils";
import { storage } from "./storage";
import { fxMapFor, consolidateToUsd } from "./financial-statements";
import { toCents, fromCents } from "@shared/money";

export const NO_AGENT = "No agent (walk-in)";
const MONTHLY_FACTOR: Record<string, number> = { monthly: 1, weekly: 52 / 12, biweekly: 26 / 12, fortnightly: 26 / 12, yearly: 1 / 12, annually: 1 / 12, quarterly: 1 / 3 };
const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
type Money = Record<string, string>;

export interface ScorecardRow {
  rank: number | null;
  agentId: string | null;
  agent: string;
  newSold: number;
  paid: number;
  notPaid: number;
  conversionPct: number | null;
  newMonthlyPremium: Money;
  avgPremiumUsd: number | null;
  avgLives: number | null;
  typedIn: number;
  collected: Money;
  lapses: number;
  persistencyPct: number | null;     // of everything they ever got paying, % still active / grace
  recentSold: number;                 // sold in the 6 months to the period end
  recentNotStuck: number;             // …of which never paid (30+ days on) or lapsed / cancelled
  commissionEarned: Money;
  clawedBack: Money;
  commissionPctOfCollected: number | null;
}

export interface NewSaleRow {
  agent: string;
  policyNumber: string;
  client: string;
  product: string;
  capturedOn: string;
  status: string;
  currency: string;
  premium: string;
  paid: "paid" | "group" | "unpaid";
  firstPaymentDate: string;
  firstPaymentAmount: string;
  firstPaymentCurrency: string;
}

const addM = (m: Record<string, number>, c: string, cents: number) => { const k = (c || "USD").toUpperCase(); m[k] = (m[k] ?? 0) + cents; };
const outM = (m: Record<string, number> = {}): Money => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 0).map(([k, v]) => [k, fromCents(v)]));
const pct = (a: number, b: number) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);

/** Pure — rank agents who sold something by new monthly premium sold (USD equivalent), ties by
 *  policies sold; the rest (and "no agent") are listed unranked. */
export function rankScorecard(rows: ScorecardRow[], fx: Record<string, number>): ScorecardRow[] {
  const usd = (m: Money) => consolidateToUsd(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, Number(v)])), fx).usd;
  const sorted = [...rows].sort((a, b) =>
    Number(a.agentId == null) - Number(b.agentId == null) || Number(a.newSold === 0) - Number(b.newSold === 0) || usd(b.newMonthlyPremium) - usd(a.newMonthlyPremium) || b.newSold - a.newSold || a.agent.localeCompare(b.agent));
  let r = 0;
  return sorted.map((x) => ({ ...x, rank: x.agentId == null || x.newSold === 0 ? null : ++r }));
}

export async function buildAgentProductivity(orgId: string, f: { fromDate: string; toDate: string; branchId?: string; agentId?: string; productId?: string }): Promise<{ from: string; to: string; scorecard: ScorecardRow[]; newSales: NewSaleRow[] }> {
  const tdb = await getDbForOrg(orgId);
  const fx = await fxMapFor(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const sixMonthsBefore = (() => { const d = new Date(f.toDate + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() - 6); return d.toISOString().slice(0, 10); })();
  const { start: recentStart } = await dayRangeForOrg(orgId, sixMonthsBefore, f.toDate);
  const br = (col: any) => (f.branchId ? sql`AND ${col} = ${f.branchId}` : sql``);
  const ag = (col: any) => (f.agentId ? sql`AND ${col} = ${f.agentId}` : sql``);

  const cards = new Map<string, ScorecardRow & { _prem: Record<string, number>; _coll: Record<string, number>; _comm: Record<string, number>; _claw: Record<string, number>; _premUsd: number; _lives: number }>();
  const card = (agentId: string | null, name?: string | null) => {
    const k = agentId ?? "";
    let c = cards.get(k);
    if (!c) {
      c = { rank: null, agentId, agent: agentId ? (name || "Agent") : NO_AGENT, newSold: 0, paid: 0, notPaid: 0, conversionPct: null, newMonthlyPremium: {}, avgPremiumUsd: null, avgLives: null, typedIn: 0,
        collected: {}, lapses: 0, persistencyPct: null, recentSold: 0, recentNotStuck: 0, commissionEarned: {}, clawedBack: {}, commissionPctOfCollected: null,
        _prem: {}, _coll: {}, _comm: {}, _claw: {}, _premUsd: 0, _lives: 0 };
      cards.set(k, c);
    } else if (name && c.agent === "Agent") c.agent = name;
    return c;
  };

  // ── Sales: New joinings rows for the period ──
  const joinings = await storage.getNewJoiningsReportByOrg(orgId, 100000, 0, { fromDate: f.fromDate, toDate: f.toDate, branchId: f.branchId, agentId: f.agentId, productId: f.productId } as any);
  const newIds = joinings.filter((j) => !j.isLegacy).map((j) => j.policyId);
  const lives = new Map<string, number>();
  if (newIds.length) {
    for (const r of rowsOf<{ policy_id: string; n: string }>(await tdb.execute(sql`
      SELECT policy_id, COUNT(*)::text AS n FROM policy_members WHERE is_active = true AND policy_id IN (${sql.join(newIds.map((id) => sql`${id}::uuid`), sql`, `)}) GROUP BY 1`))) lives.set(r.policy_id, Number(r.n));
  }
  const newSales: NewSaleRow[] = [];
  for (const j of joinings) {
    const c = card(j.agentId, j.agentName);
    if (j.isLegacy) { c.typedIn++; continue; }
    c.newSold++;
    if (j.paid === "unpaid") { c.notPaid++; } else {
      c.paid++;
      const monthly = Math.round(toCents(j.premium) * (MONTHLY_FACTOR[j.paymentSchedule] ?? 1));
      addM(c._prem, j.currency, monthly);
      c._premUsd += consolidateToUsd({ [(j.currency || "USD").toUpperCase()]: monthly / 100 }, fx).usd;
    }
    c._lives += lives.get(j.policyId) ?? 1;
    newSales.push({
      agent: c.agent, policyNumber: j.policyNumber, client: j.clientName, product: j.productName, capturedOn: j.capturedOn, status: j.status,
      currency: j.currency, premium: j.premium, paid: j.paid, firstPaymentDate: j.firstPaymentDate, firstPaymentAmount: j.firstPaymentAmount, firstPaymentCurrency: j.firstPaymentCurrency,
    });
  }

  // ── Collected on their book: premium receipts on their policies + their societies' lump sums ──
  for (const r of rowsOf<{ agent_id: string | null; name: string | null; currency: string; total: string }>(await tdb.execute(sql`
    SELECT p.agent_id, u.display_name AS name, r.currency, SUM(r.amount)::text AS total
    FROM payment_receipts r JOIN policies p ON p.id = r.policy_id LEFT JOIN users u ON u.id = p.agent_id
    WHERE r.organization_id = ${orgId} AND r.status = 'issued' AND (r.approval_status IS NULL OR r.approval_status = 'approved')
      AND r.issued_at >= ${start} AND r.issued_at < ${endExclusive} ${br(sql`p.branch_id`)} ${ag(sql`p.agent_id`)}
    GROUP BY 1, 2, 3`))) addM(card(r.agent_id, r.name)._coll, r.currency, toCents(r.total));
  if (!f.branchId) {
    for (const r of rowsOf<{ agent_id: string | null; name: string | null; currency: string; total: string }>(await tdb.execute(sql`
      SELECT g.agent_id, u.display_name AS name, l.currency, SUM(l.amount)::text AS total
      FROM legacy_group_receipts l JOIN groups g ON g.id = l.group_id LEFT JOIN users u ON u.id = g.agent_id
      WHERE l.organization_id = ${orgId} AND l.payment_date >= ${f.fromDate}::date AND l.payment_date <= ${f.toDate}::date ${ag(sql`g.agent_id`)}
      GROUP BY 1, 2, 3`))) addM(card(r.agent_id, r.name)._coll, r.currency, toCents(r.total));
  }

  // ── Lapses in the period, persistency, and recent sales that didn't stick ──
  for (const r of rowsOf<{ agent_id: string | null; name: string | null; n: string }>(await tdb.execute(sql`
    SELECT p.agent_id, u.display_name AS name, COUNT(DISTINCT p.id)::text AS n
    FROM policy_status_history h JOIN policies p ON p.id = h.policy_id LEFT JOIN users u ON u.id = p.agent_id
    WHERE p.organization_id = ${orgId} AND h.to_status = 'lapsed' AND h.created_at >= ${start} AND h.created_at < ${endExclusive}
      ${br(sql`p.branch_id`)} ${ag(sql`p.agent_id`)}
    GROUP BY 1, 2`))) card(r.agent_id, r.name).lapses = Number(r.n);
  for (const r of rowsOf<{ agent_id: string | null; name: string | null; ever_paid: string; in_force: string; recent: string; recent_bad: string }>(await tdb.execute(sql`
    SELECT p.agent_id, u.display_name AS name,
      COUNT(*) FILTER (WHERE p.status <> 'inactive')::text AS ever_paid,
      COUNT(*) FILTER (WHERE p.status IN ('active', 'grace'))::text AS in_force,
      COUNT(*) FILTER (WHERE p.created_at >= ${recentStart} AND p.created_at < ${endExclusive})::text AS recent,
      COUNT(*) FILTER (WHERE p.created_at >= ${recentStart} AND p.created_at < ${endExclusive}
        AND (p.status IN ('lapsed', 'cancelled') OR (p.status = 'inactive' AND p.created_at < ${endExclusive}::timestamp - interval '30 days')))::text AS recent_bad
    FROM policies p LEFT JOIN users u ON u.id = p.agent_id
    WHERE p.organization_id = ${orgId} AND p.deleted_at IS NULL AND COALESCE(p.is_legacy, false) = false AND p.created_at < ${endExclusive}
      ${br(sql`p.branch_id`)} ${ag(sql`p.agent_id`)}
    GROUP BY 1, 2`))) {
    const c = card(r.agent_id, r.name);
    c.persistencyPct = pct(Number(r.in_force), Number(r.ever_paid));
    c.recentSold = Number(r.recent);
    c.recentNotStuck = Number(r.recent_bad);
  }

  // ── Commission earned and clawed back in the period ──
  for (const r of rowsOf<{ agent_id: string; name: string | null; currency: string; earned: string; clawed: string }>(await tdb.execute(sql`
    SELECT e.agent_id, u.display_name AS name, e.currency,
      COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type NOT ILIKE 'clawback%'), 0)::text AS earned,
      COALESCE(SUM(e.amount) FILTER (WHERE e.entry_type ILIKE 'clawback%'), 0)::text AS clawed
    FROM commission_ledger_entries e LEFT JOIN users u ON u.id = e.agent_id LEFT JOIN policies p ON p.id = e.policy_id
    WHERE e.organization_id = ${orgId} AND e.agent_id IS NOT NULL AND e.created_at >= ${start} AND e.created_at < ${endExclusive}
      ${br(sql`p.branch_id`)} ${ag(sql`e.agent_id`)}
    GROUP BY 1, 2, 3`))) {
    const c = card(r.agent_id, r.name);
    addM(c._comm, r.currency, toCents(r.earned));
    addM(c._claw, r.currency, toCents(r.clawed));
  }

  const usd = (m: Record<string, number>) => consolidateToUsd(Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v / 100])), fx).usd;
  const scorecard: ScorecardRow[] = Array.from(cards.values())
    .filter((c) => c.newSold || c.typedIn || Object.keys(c._coll).length || c.lapses || Object.keys(c._comm).length || c.recentSold)
    .map(({ _prem, _coll, _comm, _claw, _premUsd, _lives, ...c }) => ({
      ...c,
      conversionPct: pct(c.paid, c.newSold),
      newMonthlyPremium: outM(_prem),
      avgPremiumUsd: c.paid ? Number((_premUsd / c.paid).toFixed(2)) : null,
      avgLives: c.newSold ? Number((_lives / c.newSold).toFixed(1)) : null,
      collected: outM(_coll),
      commissionEarned: outM(_comm),
      clawedBack: outM(_claw),
      commissionPctOfCollected: pct(usd(_comm), usd(_coll)), // earned only; clawbacks are their own column
    }));
  newSales.sort((a, b) => a.agent.localeCompare(b.agent) || (a.paid === "unpaid" ? 0 : 1) - (b.paid === "unpaid" ? 0 : 1) || b.capturedOn.localeCompare(a.capturedOn));
  return { from: f.fromDate, to: f.toDate, scorecard: rankScorecard(scorecard, fx), newSales };
}
