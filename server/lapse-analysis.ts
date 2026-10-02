/**
 * Reports → Book Health → Lapse analysis (Augustus, 2 Oct 2026), from policy_status_history:
 *   Per month (tenant-local): in force at the start, went into grace, paid their way back, lapsed
 *   (policies, not events), reinstated, and lapse rate = lapsed ÷ in force at the start of the month.
 *   Lapses in the period by how long cover had run and by agent, new sales and typed-in apart.
 *   A call list of policies lapsed now (lapse date, paid up to, last payment, agent, phone).
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { getOrgTimezone, dateInTimezone, dayRangeForOrg } from "./date-utils";
import { storage } from "./storage";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const IN_FORCE = new Set(["active", "grace"]);

export interface StatusEvent { from: string | null; to: string; at: Date }

/** Pure — a policy's status just before `when`: the last change before it; before its first
 *  recorded change, the status that change came from (or "inactive" — new policies start there);
 *  with no history at all, its current status. Null when the policy didn't exist yet. */
export function statusAt(events: StatusEvent[], createdAt: Date, currentStatus: string, when: Date): string | null {
  if (createdAt >= when) return null;
  let last: StatusEvent | null = null;
  for (const e of events) if (e.at < when && (!last || e.at > last.at)) last = e;
  if (last) return last.to;
  if (events.length) return [...events].sort((a, b) => +a.at - +b.at)[0].from ?? "inactive";
  return currentStatus;
}

/** Pure — months of cover before the lapse, bucketed. */
export function durationBucket(inception: string | null, lapseDay: string): string {
  if (!inception) return "unknown";
  const [y1, m1] = inception.split("-").map(Number), [y2, m2] = lapseDay.split("-").map(Number);
  const m = (y2 - y1) * 12 + (m2 - m1);
  return m <= 3 ? "0–3 months" : m <= 6 ? "4–6 months" : m <= 12 ? "7–12 months" : "over 12 months";
}

export interface LapseMonth { month: string; inForceAtStart: number; intoGrace: number; recovered: number; lapsed: number; reinstated: number; lapseRatePct: number | null }

export async function buildLapseAnalysis(orgId: string, f: { fromDate: string; toDate: string; branchId?: string; agentId?: string }) {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const pol = rowsOf<any>(await tdb.execute(sql`
    SELECT p.id, p.status, p.created_at, p.inception_date, COALESCE(p.is_legacy, false) AS legacy, p.agent_id, u.display_name AS agent
    FROM policies p LEFT JOIN users u ON u.id = p.agent_id
    WHERE p.organization_id = ${orgId} AND p.deleted_at IS NULL
      ${f.branchId ? sql`AND p.branch_id = ${f.branchId}` : sql``} ${f.agentId ? sql`AND p.agent_id = ${f.agentId}` : sql``}`));
  const ids = new Set(pol.map((p) => p.id));
  const hist = rowsOf<any>(await tdb.execute(sql`
    SELECT h.policy_id, h.from_status, h.to_status, h.created_at FROM policy_status_history h JOIN policies p ON p.id = h.policy_id
    WHERE p.organization_id = ${orgId}`)).filter((h) => ids.has(h.policy_id));
  const events = new Map<string, StatusEvent[]>();
  for (const h of hist) {
    const list = events.get(h.policy_id) ?? [];
    list.push({ from: h.from_status, to: h.to_status, at: new Date(h.created_at) });
    events.set(h.policy_id, list);
  }

  // Months in the period (tenant-local).
  const months: string[] = [];
  for (let d = new Date(f.fromDate.slice(0, 7) + "-01T00:00:00Z"); d.toISOString().slice(0, 7) <= f.toDate.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const out: LapseMonth[] = [];
  for (const m of months) {
    const { start } = await dayRangeForOrg(orgId, `${m}-01`, `${m}-01`);
    let inForce = 0;
    for (const p of pol) {
      const s = statusAt(events.get(p.id) ?? [], new Date(p.created_at), p.status, start!);
      if (s && IN_FORCE.has(s)) inForce++;
    }
    const inMonth = hist.filter((h) => dateInTimezone(new Date(h.created_at), tz).slice(0, 7) === m);
    const distinct = (pred: (h: any) => boolean) => new Set(inMonth.filter(pred).map((h) => h.policy_id)).size;
    const lapsed = distinct((h) => h.to_status === "lapsed");
    out.push({
      month: m, inForceAtStart: inForce,
      intoGrace: distinct((h) => h.to_status === "grace"),
      recovered: distinct((h) => h.from_status === "grace" && h.to_status === "active"),
      lapsed,
      reinstated: distinct((h) => h.from_status === "lapsed" && h.to_status === "active"),
      lapseRatePct: inForce > 0 ? Number(((lapsed / inForce) * 100).toFixed(1)) : null,
    });
  }

  // Lapses in the period, by duration and by agent (new sales vs typed-in).
  const inPeriod = hist.filter((h) => h.to_status === "lapsed" && (() => { const d = dateInTimezone(new Date(h.created_at), tz); return d >= f.fromDate && d <= f.toDate; })());
  const byPolicy = new Map<string, string>(); // policy → its last lapse day in the period
  for (const h of inPeriod) { const d = dateInTimezone(new Date(h.created_at), tz); if (!byPolicy.has(h.policy_id) || d > byPolicy.get(h.policy_id)!) byPolicy.set(h.policy_id, d); }
  const polById = new Map(pol.map((p) => [p.id, p]));
  const byDuration: Record<string, { newSales: number; typedIn: number }> = {};
  const byAgent = new Map<string, { agent: string; newSales: number; typedIn: number }>();
  for (const [pid, day] of Array.from(byPolicy.entries())) {
    const p = polById.get(pid);
    if (!p) continue;
    const k = p.legacy ? "typedIn" : "newSales";
    const bucket = durationBucket(p.inception_date ? String(p.inception_date instanceof Date ? p.inception_date.toISOString() : p.inception_date).slice(0, 10) : null, day);
    (byDuration[bucket] ??= { newSales: 0, typedIn: 0 })[k]++;
    const agent = p.agent || "No agent";
    const a = byAgent.get(agent) ?? { agent, newSales: 0, typedIn: 0 };
    a[k]++;
    byAgent.set(agent, a);
  }

  // Call list: policies lapsed now.
  const lapsedNow: any[] = await storage.getAllPoliciesReportByOrg(orgId, 5000, 0, { status: "lapsed", branchId: f.branchId, agentId: f.agentId } as any);
  const lastLapse = new Map<string, string>();
  for (const h of hist) if (h.to_status === "lapsed") { const d = dateInTimezone(new Date(h.created_at), tz); if (!lastLapse.has(h.policy_id) || d > lastLapse.get(h.policy_id)!) lastLapse.set(h.policy_id, d); }
  const callList = lapsedNow.map((r) => ({
    policyNumber: r.policyNumber, client: [r.clientFirstName, r.clientLastName].filter(Boolean).join(" "), phone: r.clientPhone ?? "",
    agent: r.agentDisplayName || "No agent", typedIn: !!r.isLegacy, product: r.productName ?? "", currency: r.currency, premium: r.premiumAmount,
    lapsedOn: lastLapse.get(r.policyId) ?? null, paidUpTo: r.paidUpTo ? String(r.paidUpTo).slice(0, 10) : null,
    lastPaymentDate: r.lastPaymentDate ? String(r.lastPaymentDate).slice(0, 10) : null, lastPaymentAmount: r.lastPaymentAmount ?? null,
  })).sort((a, b) => (b.lapsedOn ?? "").localeCompare(a.lapsedOn ?? ""));

  const totals = { lapsed: byPolicy.size, intoGrace: 0, recovered: 0, reinstated: 0 };
  for (const m of out) { totals.intoGrace += m.intoGrace; totals.recovered += m.recovered; totals.reinstated += m.reinstated; }
  return {
    months: out, totals,
    graceSavePct: totals.intoGrace > 0 ? Number(((totals.recovered / totals.intoGrace) * 100).toFixed(1)) : null,
    byDuration: ["0–3 months", "4–6 months", "7–12 months", "over 12 months", "unknown"].filter((b) => byDuration[b]).map((b) => ({ duration: b, ...byDuration[b] })),
    byAgent: Array.from(byAgent.values()).sort((a, b) => b.newSales + b.typedIn - (a.newSales + a.typedIn)),
    lapsedNow: callList,
  };
}
