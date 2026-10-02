/**
 * One definition of "a claim" for the Claims reports (register, aging, loss ratio & repudiation),
 * the same as the IPEC return and actuarial export use (Augustus, 2 Oct 2026):
 *   - a claim record, or a funeral done under a policy where no claim was raised (still a death the
 *     business paid for);
 *   - its cost = cash in lieu + what the funeral actually cost (paid requisitions linked to the
 *     funeral case — commission and POL263 payments excepted). The society ledger deduction is the
 *     society paying at the agreed rate from what it already paid in (counted as premium), so it is
 *     shown as "charged to society" and never added to the cost;
 *   - settled = paid / completed / closed, or the funeral is completed; rejected = repudiated;
 *     open otherwise. Overdue uses the claims SLA (CLAIM_SLA_DAYS).
 * Tenant-local days.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg, getOrgTimezone, dateInTimezone, todayForOrg } from "./date-utils";
import { CLAIM_SLA_DAYS } from "./claims-sla";
import { toCents, fromCents } from "@shared/money";
import { isCommissionPayoutCategory, isPol263Payment } from "./financial-statements";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
type Money = Record<string, string>;

export type ClaimState = "open" | "settled" | "repudiated";

export interface ClaimRecord {
  kind: "claim" | "funeral";
  reference: string;            // claim number, or the funeral case number when no claim was raised
  funeralCase: string;
  policyNumber: string;
  client: string;
  clientPhone: string;
  branch: string;
  deceased: string;
  relationship: string;
  dateOfDeath: string | null;
  reported: string;             // tenant-local date
  decided: string | null;       // claim decision, or the funeral's completion
  daysToDecide: number | null;
  status: string;               // claim status, or the funeral case status
  state: ClaimState;
  decisionReason: string;
  claimType: string;
  currency: string;
  cashInLieu: string | null;
  funeralCost: Money;           // per currency, from the linked requisitions
  chargedToSociety: string | null;
  daysOpen: number | null;      // open only
  overdue: boolean;
}

const SETTLED_CLAIM = new Set(["paid", "completed", "closed", "settled"]);

/** Pure — where a claim stands. A completed funeral settles an in-kind claim. */
export function claimState(status: string, funeralCompleted: boolean): ClaimState {
  if (status === "rejected") return "repudiated";
  if (SETTLED_CLAIM.has(status) || funeralCompleted) return "settled";
  return "open";
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export async function buildClaimRecords(orgId: string, f: { fromDate?: string; toDate?: string; branchId?: string } = {}): Promise<ClaimRecord[]> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const today = await todayForOrg(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const local = (d: unknown) => (d ? dateInTimezone(new Date(d as any), tz) : null);
  const plain = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);
  const range = (col: any) => sql`${start ? sql`AND ${col} >= ${start}` : sql``} ${endExclusive ? sql`AND ${col} < ${endExclusive}` : sql``}`;

  const claimRows = rowsOf<any>(await tdb.execute(sql`
    SELECT c.id, c.claim_number, c.claim_type, c.status, c.currency, c.deceased_name, c.deceased_relationship, c.date_of_death,
      c.created_at, c.decided_at, c.decision_reason, c.cash_in_lieu_amount, c.ledger_amount,
      p.policy_number, cl.first_name, cl.last_name, cl.phone, b.name AS branch,
      fc.id AS case_id, fc.case_number, fc.status AS case_status, fc.completed_at
    FROM claims c
    LEFT JOIN policies p ON p.id = c.policy_id
    LEFT JOIN clients cl ON cl.id = COALESCE(c.client_id, p.client_id)
    LEFT JOIN branches b ON b.id = COALESCE(c.branch_id, p.branch_id)
    LEFT JOIN LATERAL (SELECT id, case_number, status, completed_at FROM funeral_cases WHERE claim_id = c.id AND status <> 'cancelled' ORDER BY created_at LIMIT 1) fc ON true
    WHERE c.organization_id = ${orgId} ${range(sql`c.created_at`)}
      ${f.branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${f.branchId}` : sql``}`));
  const funeralRows = rowsOf<any>(await tdb.execute(sql`
    SELECT fc.id AS case_id, fc.case_number, fc.status AS case_status, fc.completed_at, fc.created_at, fc.date_of_death,
      fc.deceased_name, fc.deceased_relationship, p.policy_number, p.currency, cl.first_name, cl.last_name, cl.phone, b.name AS branch
    FROM funeral_cases fc
    LEFT JOIN policies p ON p.id = fc.policy_id
    LEFT JOIN clients cl ON cl.id = p.client_id
    LEFT JOIN branches b ON b.id = COALESCE(fc.branch_id, p.branch_id)
    WHERE fc.organization_id = ${orgId} AND fc.service_type = 'claim' AND fc.claim_id IS NULL AND fc.status <> 'cancelled'
      ${range(sql`fc.created_at`)} ${f.branchId ? sql`AND COALESCE(fc.branch_id, p.branch_id) = ${f.branchId}` : sql``}`));

  // What each funeral cost: paid requisitions linked to the case.
  const caseIds = [...claimRows.map((r) => r.case_id), ...funeralRows.map((r) => r.case_id)].filter(Boolean);
  const cost = new Map<string, Record<string, number>>();
  if (caseIds.length) {
    for (const r of rowsOf<any>(await tdb.execute(sql`
      SELECT rq.funeral_case_id, rq.category, rq.description, rq.agent_id, d.currency, SUM(d.amount)::text AS total
      FROM payment_disbursements d JOIN requisitions rq ON d.entity_type = 'requisition' AND rq.id = d.entity_id
      WHERE d.organization_id = ${orgId} AND rq.funeral_case_id IN (${sql.join(caseIds.map((id) => sql`${id}::uuid`), sql`, `)})
      GROUP BY 1, 2, 3, 4, 5`))) {
      if (isCommissionPayoutCategory(r.category, r.agent_id) || isPol263Payment(r.category, r.description)) continue;
      const m = cost.get(r.funeral_case_id) ?? {};
      const cur = String(r.currency || "USD").toUpperCase();
      m[cur] = (m[cur] ?? 0) + toCents(r.total);
      cost.set(r.funeral_case_id, m);
    }
  }
  const costOf = (caseId: string | null): Money => Object.fromEntries(Object.entries(caseId ? cost.get(caseId) ?? {} : {}).map(([c, v]) => [c, fromCents(v)]));

  const out: ClaimRecord[] = [];
  const finish = (rec: Omit<ClaimRecord, "daysToDecide" | "daysOpen" | "overdue">): ClaimRecord => {
    const open = rec.state === "open";
    const daysOpen = open ? Math.max(0, dayDiff(rec.reported, today)) : null;
    return { ...rec, daysToDecide: rec.decided ? Math.max(0, dayDiff(rec.reported, rec.decided)) : null, daysOpen, overdue: open && (daysOpen ?? 0) > CLAIM_SLA_DAYS };
  };
  for (const c of claimRows) {
    const funeralDone = c.case_status === "completed";
    const decided = local(c.decided_at) ?? (funeralDone ? local(c.completed_at) : null);
    out.push(finish({
      kind: "claim", reference: c.claim_number, funeralCase: c.case_number ?? "", policyNumber: c.policy_number ?? "",
      client: [c.first_name, c.last_name].filter(Boolean).join(" "), clientPhone: c.phone ?? "", branch: c.branch ?? "",
      deceased: c.deceased_name ?? "", relationship: c.deceased_relationship ?? "", dateOfDeath: plain(c.date_of_death),
      reported: local(c.created_at)!, decided, status: c.status, state: claimState(c.status, funeralDone),
      decisionReason: c.decision_reason ?? "", claimType: c.claim_type ?? "", currency: String(c.currency || "USD").toUpperCase(),
      cashInLieu: c.cash_in_lieu_amount != null ? fromCents(toCents(c.cash_in_lieu_amount)) : null,
      funeralCost: costOf(c.case_id), chargedToSociety: c.ledger_amount != null ? fromCents(toCents(c.ledger_amount)) : null,
    }));
  }
  for (const r of funeralRows) {
    const done = r.case_status === "completed";
    out.push(finish({
      kind: "funeral", reference: r.case_number, funeralCase: r.case_number, policyNumber: r.policy_number ?? "",
      client: [r.first_name, r.last_name].filter(Boolean).join(" "), clientPhone: r.phone ?? "", branch: r.branch ?? "",
      deceased: r.deceased_name ?? "", relationship: r.deceased_relationship ?? "", dateOfDeath: plain(r.date_of_death),
      reported: local(r.created_at)!, decided: done ? local(r.completed_at) : null, status: r.case_status,
      state: claimState(r.case_status, done), decisionReason: "", claimType: "funeral (no claim raised)",
      currency: String(r.currency || "USD").toUpperCase(), cashInLieu: null, funeralCost: costOf(r.case_id), chargedToSociety: null,
    }));
  }
  return out.sort((a, b) => b.reported.localeCompare(a.reported) || a.reference.localeCompare(b.reference));
}

/** Pure — repudiation by claim type: reported, settled, repudiated, still open, repudiation %. */
export function repudiationByType(records: ClaimRecord[]) {
  const m = new Map<string, { claimType: string; reported: number; settled: number; repudiated: number; open: number }>();
  for (const r of records) {
    const k = r.claimType || "other";
    const x = m.get(k) ?? { claimType: k, reported: 0, settled: 0, repudiated: 0, open: 0 };
    x.reported++;
    if (r.state === "settled") x.settled++; else if (r.state === "repudiated") x.repudiated++; else x.open++;
    m.set(k, x);
  }
  return Array.from(m.values()).map((x) => ({ ...x, repudiationRate: x.settled + x.repudiated > 0 ? Number(((x.repudiated / (x.settled + x.repudiated)) * 100).toFixed(1)) : 0 }));
}

/** Loss ratio per currency for [from, to], cash basis like the IPEC return: claims incurred = cash
 *  in lieu decided in the period + what was spent on funerals done under a policy in the period;
 *  premium = premiums + society lump sums, exactly as the income statement counts them. */
export async function buildLossRatio(orgId: string, from: string, to: string, branchId?: string) {
  const tdb = await getDbForOrg(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, from, to);
  const { buildIncomeStatement } = await import("./financial-statements");
  const { splitFuneralCosts } = await import("./ipec-return");
  const is: any = await buildIncomeStatement(orgId, { from, to, branchId } as any);
  const premium: Record<string, number> = {};
  for (const m of [is.income.premiumIndividual, is.income.premiumGroup, is.income.legacyGroupIncome]) for (const [c, v] of Object.entries(m ?? {})) premium[c] = (premium[c] ?? 0) + toCents(v as any);

  const claims: Record<string, number> = {};
  for (const r of rowsOf<any>(await tdb.execute(sql`
    SELECT c.currency, SUM(c.cash_in_lieu_amount)::text AS total FROM claims c LEFT JOIN policies p ON p.id = c.policy_id
    WHERE c.organization_id = ${orgId} AND c.cash_in_lieu_amount IS NOT NULL AND c.status NOT IN ('rejected', 'submitted', 'verified', 'under_investigation')
      AND COALESCE(c.decided_at, c.created_at) >= ${start} AND COALESCE(c.decided_at, c.created_at) < ${endExclusive}
      ${branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${branchId}` : sql``}
    GROUP BY 1`))) { const cur = String(r.currency || "USD").toUpperCase(); claims[cur] = (claims[cur] ?? 0) + toCents(r.total); }
  const spend = rowsOf<any>(await tdb.execute(sql`
    SELECT f.service_type, rq.category, rq.description, rq.agent_id, d.currency, SUM(d.amount)::text AS total
    FROM payment_disbursements d
    JOIN requisitions rq ON d.entity_type = 'requisition' AND rq.id = d.entity_id
    JOIN funeral_cases f ON f.id = rq.funeral_case_id
    WHERE d.organization_id = ${orgId} AND d.paid_date >= ${from}::date AND d.paid_date <= ${to}::date
      ${branchId ? sql`AND d.branch_id = ${branchId}` : sql``}
    GROUP BY 1, 2, 3, 4, 5`));
  const { policy } = splitFuneralCosts(spend.map((r) => ({ serviceType: r.service_type, category: r.category, description: r.description, agentId: r.agent_id, currency: r.currency, amount: Number(r.total) })));
  for (const [c, v] of Object.entries(policy)) claims[c] = (claims[c] ?? 0) + Math.round(v * 100);

  const curs = Array.from(new Set([...Object.keys(premium), ...Object.keys(claims)])).sort();
  return curs.map((currency) => {
    const inc = claims[currency] ?? 0, prem = premium[currency] ?? 0;
    return { currency, claimsIncurred: Number(fromCents(inc)), premiumCollected: Number(fromCents(prem)), ratio: prem > 0 ? Number(((inc / prem) * 100).toFixed(1)) : 0 };
  });
}
