/**
 * Reports → Book Health → Persistency: how each month's new sales are holding up (Augustus,
 * 2 Oct 2026). Cohort = the tenant-local month a policy was sold (captured), new business only —
 * existing policies typed in are a separate line, not sales. For each month: sold, never paid (not
 * taken up), started paying, still in force (active / grace), lapsed, cancelled, and persistency =
 * in force ÷ started paying. Status is today's (no point-in-time history), so it's "still in force
 * today"; the 13- and 25-month figures are the cohorts that age.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { getOrgTimezone, todayForOrg } from "./date-utils";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

export interface PersistencyCohort {
  cohort: string;          // YYYY-MM sold; "typed-in" for existing policies captured
  monthsSinceSale: number | null;
  sold: number;
  neverPaid: number;
  notTakenUpPct: number | null;
  startedPaying: number;
  inForce: number;
  lapsed: number;
  cancelled: number;
  persistencyPct: number | null;
}

const pct = (a: number, b: number) => (b > 0 ? Number(((a / b) * 100).toFixed(1)) : null);

/** Pure — one cohort's figures from status counts. "inactive" = never paid. */
export function cohortFigures(cohort: string, monthsSinceSale: number | null, counts: Record<string, number>): PersistencyCohort {
  const sold = Object.values(counts).reduce((a, b) => a + b, 0);
  const neverPaid = counts.inactive ?? 0;
  const inForce = (counts.active ?? 0) + (counts.grace ?? 0);
  const lapsed = counts.lapsed ?? 0;
  const cancelled = counts.cancelled ?? 0;
  const startedPaying = sold - neverPaid;
  return { cohort, monthsSinceSale, sold, neverPaid, notTakenUpPct: pct(neverPaid, sold), startedPaying, inForce, lapsed, cancelled, persistencyPct: pct(inForce, startedPaying) };
}

export async function buildPersistency(orgId: string, f: { branchId?: string; agentId?: string } = {}): Promise<{ cohorts: PersistencyCohort[]; typedIn: PersistencyCohort }> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const today = await todayForOrg(orgId);
  const rows = rowsOf<{ cohort: string; legacy: boolean; status: string; n: string }>(await tdb.execute(sql`
    SELECT to_char(created_at AT TIME ZONE ${tz}, 'YYYY-MM') AS cohort, COALESCE(is_legacy, false) AS legacy, status, COUNT(*)::text AS n
    FROM policies
    WHERE organization_id = ${orgId} AND deleted_at IS NULL
      ${f.branchId ? sql`AND branch_id = ${f.branchId}` : sql``} ${f.agentId ? sql`AND agent_id = ${f.agentId}` : sql``}
    GROUP BY 1, 2, 3`));
  const [ty, tm] = today.split("-").map(Number);
  const months = (c: string) => { const [y, m] = c.split("-").map(Number); return (ty - y) * 12 + (tm - m); };
  const byCohort = new Map<string, Record<string, number>>();
  const typed: Record<string, number> = {};
  for (const r of rows) {
    if (r.legacy) { typed[r.status] = (typed[r.status] ?? 0) + Number(r.n); continue; }
    const c = byCohort.get(r.cohort) ?? {};
    c[r.status] = (c[r.status] ?? 0) + Number(r.n);
    byCohort.set(r.cohort, c);
  }
  const cohorts = Array.from(byCohort.entries()).sort((a, b) => b[0].localeCompare(a[0])).map(([c, counts]) => cohortFigures(c, months(c), counts));
  return { cohorts, typedIn: cohortFigures("typed-in", null, typed) };
}
