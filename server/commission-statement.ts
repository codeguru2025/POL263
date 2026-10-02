/**
 * Reports → Agents → Commissions: what each agent is owed (Augustus, 2 Oct 2026).
 *   owed at the start + earned (individual policies, societies) − clawed back − paid = still owed
 * per agent and currency. Earned and clawed back come from the commission ledger; paid is what left
 * the business on "Commission" requisitions that name the agent (requisitions.agent_id). A month
 * where clawbacks exceed earnings carries forward as a lower balance. The company "walk-in" account
 * (commission ledger rows with no agent) is shown on its own — it's earned by the company, paid to
 * no one. Tenant-local days.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg } from "./date-utils";
import { toCents, fromCents } from "@shared/money";

export const WALK_IN_COMPANY = "Company (walk-in sales) — not paid to anyone";
const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

export interface CommissionStatementRow {
  agentId: string | null;
  agent: string;
  currency: string;
  opening: string;
  earnedPolicies: string;
  earnedSocieties: string;
  clawedBack: string;
  paid: string;
  closing: string;
  policies: number;   // policies that earned in the period
}

type Bucket = { opening: number; earnedPolicies: number; earnedSocieties: number; clawedBack: number; paid: number; policies: Set<string> };

/** Pure — closing = opening + earned − clawed back (stored negative) − paid, in cents. */
export function closingCents(b: { opening: number; earnedPolicies: number; earnedSocieties: number; clawedBack: number; paid: number }): number {
  return b.opening + b.earnedPolicies + b.earnedSocieties + b.clawedBack - b.paid;
}

export async function buildCommissionStatement(orgId: string, f: { fromDate: string; toDate: string; agentId?: string; branchId?: string }): Promise<{ from: string; to: string; rows: CommissionStatementRow[]; totals: Record<string, { earned: string; clawedBack: string; paid: string; owed: string }> }> {
  const tdb = await getDbForOrg(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const agentCond = (col: any) => (f.agentId ? sql`AND ${col} = ${f.agentId}` : sql``);

  const buckets = new Map<string, Bucket & { agentId: string | null; agent: string; currency: string }>();
  const bucket = (agentId: string | null, name: string | null, currency: string) => {
    const cur = (currency || "USD").toUpperCase();
    const key = `${agentId ?? ""}|${cur}`;
    let b = buckets.get(key);
    if (!b) {
      b = { agentId, agent: agentId ? (name || "Agent") : WALK_IN_COMPANY, currency: cur, opening: 0, earnedPolicies: 0, earnedSocieties: 0, clawedBack: 0, paid: 0, policies: new Set() };
      buckets.set(key, b);
    }
    return b;
  };

  // Commission ledger: before the period (opening) and in it (earned / clawed back).
  const ledger = rowsOf<{ agent_id: string | null; name: string | null; currency: string; entry_type: string; has_policy: boolean; in_period: boolean; total: string; policies: string[] | null }>(await tdb.execute(sql`
    SELECT e.agent_id, u.display_name AS name, e.currency, e.entry_type, (e.policy_id IS NOT NULL) AS has_policy,
      (e.created_at >= ${start}) AS in_period, SUM(e.amount)::text AS total,
      array_agg(DISTINCT e.policy_id) FILTER (WHERE e.policy_id IS NOT NULL) AS policies
    FROM commission_ledger_entries e
    LEFT JOIN users u ON u.id = e.agent_id
    LEFT JOIN policies p ON p.id = e.policy_id
    WHERE e.organization_id = ${orgId} AND e.created_at < ${endExclusive} ${agentCond(sql`e.agent_id`)}
      ${f.branchId ? sql`AND (e.policy_id IS NULL OR p.branch_id = ${f.branchId})` : sql``}
    GROUP BY 1, 2, 3, 4, 5, 6`));
  for (const r of ledger) {
    const b = bucket(r.agent_id, r.name, r.currency);
    const cents = toCents(r.total);
    if (!r.in_period) { b.opening += cents; continue; }
    if (/^clawback/i.test(r.entry_type)) b.clawedBack += cents;
    else if (r.has_policy) b.earnedPolicies += cents;
    else b.earnedSocieties += cents;
    for (const p of r.policies ?? []) b.policies.add(p);
  }

  // Payouts: "Commission" requisitions that name the agent — before the period and in it.
  const paid = rowsOf<{ agent_id: string; name: string | null; currency: string; in_period: boolean; total: string }>(await tdb.execute(sql`
    SELECT rq.agent_id, u.display_name AS name, d.currency, (d.paid_date >= ${f.fromDate}::date) AS in_period, SUM(d.amount)::text AS total
    FROM payment_disbursements d
    JOIN requisitions rq ON d.entity_type = 'requisition' AND rq.id = d.entity_id
    LEFT JOIN users u ON u.id = rq.agent_id
    WHERE d.organization_id = ${orgId} AND rq.agent_id IS NOT NULL AND COALESCE(rq.category, '') ~* 'commission'
      AND d.paid_date <= ${f.toDate}::date ${agentCond(sql`rq.agent_id`)}
      ${f.branchId ? sql`AND d.branch_id = ${f.branchId}` : sql``}
    GROUP BY 1, 2, 3, 4`));
  for (const r of paid) {
    const b = bucket(r.agent_id, r.name, r.currency);
    if (r.in_period) b.paid += toCents(r.total);
    else b.opening -= toCents(r.total);
  }

  const rows: CommissionStatementRow[] = Array.from(buckets.values())
    .map((b) => ({
      agentId: b.agentId, agent: b.agent, currency: b.currency,
      opening: fromCents(b.opening), earnedPolicies: fromCents(b.earnedPolicies), earnedSocieties: fromCents(b.earnedSocieties),
      clawedBack: fromCents(b.clawedBack), paid: fromCents(b.paid), closing: fromCents(closingCents(b)), policies: b.policies.size,
    }))
    .filter((r) => [r.opening, r.earnedPolicies, r.earnedSocieties, r.clawedBack, r.paid].some((v) => toCents(v) !== 0))
    .sort((a, b) => Number(a.agentId == null) - Number(b.agentId == null) || toCents(b.closing) - toCents(a.closing) || a.agent.localeCompare(b.agent));

  const totals: Record<string, { earned: number; clawedBack: number; paid: number; owed: number }> = {};
  for (const r of rows) {
    if (r.agentId == null) continue; // the company's own walk-in commission isn't owed to anyone
    const t = (totals[r.currency] ??= { earned: 0, clawedBack: 0, paid: 0, owed: 0 });
    t.earned += toCents(r.earnedPolicies) + toCents(r.earnedSocieties);
    t.clawedBack += toCents(r.clawedBack);
    t.paid += toCents(r.paid);
    t.owed += toCents(r.closing);
  }
  return {
    from: f.fromDate, to: f.toDate, rows,
    totals: Object.fromEntries(Object.entries(totals).map(([c, t]) => [c, { earned: fromCents(t.earned), clawedBack: fromCents(t.clawedBack), paid: fromCents(t.paid), owed: fromCents(t.owed) }])),
  };
}
