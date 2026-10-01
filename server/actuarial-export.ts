/**
 * Reports → Finance → Actuarial export: the data files an outside actuary asks for.
 *   In-force lives — one row per covered person on an active / grace policy, ages at the period end,
 *                    plus a 5-year-band × gender summary and the data gaps (no date of birth / gender).
 *   Claims history — one row per claim reported in the period, with the deceased's age at death.
 * Premium history is the Receipts export; the balance sheet and IFRS 17 figures come from their own
 * builders, all as at the period end. Policy status is today's (status history isn't kept).
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg, getOrgTimezone, dateInTimezone } from "./date-utils";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const iso = (d: unknown): string | null => {
  if (d == null || d === "") return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
};

/** Pure — whole years between dob and asOf (both YYYY-MM-DD). Null when either is missing or dob is after asOf. */
export function ageAt(dob: string | null, asOf: string | null): number | null {
  if (!dob || !asOf || dob > asOf) return null;
  const [y1, m1, d1] = dob.split("-").map(Number);
  const [y2, m2, d2] = asOf.split("-").map(Number);
  let age = y2 - y1;
  if (m2 < m1 || (m2 === m1 && d2 < d1)) age--;
  return age;
}

/** Pure — 5-year band ("0-4", "5-9", … "85+"); "Unknown" with no age. */
export function ageBand(age: number | null): string {
  if (age == null) return "Unknown";
  if (age >= 85) return "85+";
  const lo = Math.floor(age / 5) * 5;
  return `${lo}-${lo + 4}`;
}

export function normaliseGender(g: string | null | undefined): "Male" | "Female" | "Unknown" {
  const s = String(g ?? "").trim().toLowerCase();
  if (s === "m" || s === "male") return "Male";
  if (s === "f" || s === "female") return "Female";
  return "Unknown";
}

export interface InForceLife {
  policyNumber: string;
  product: string;
  status: string;
  inceptionDate: string | null;
  currency: string;
  premium: string;
  frequency: string;
  isLegacy: boolean;
  memberNumber: string;
  role: "Policyholder" | "Dependant";
  relationship: string;
  dateOfBirth: string | null;
  age: number | null;
  gender: "Male" | "Female" | "Unknown";
}

export interface LivesSummaryRow { product: string; band: string; male: number; female: number; unknown: number; total: number }

export interface LivesGaps { lives: number; policies: number; noDateOfBirth: number; noGender: number }

const BAND_ORDER = (b: string) => (b === "Unknown" ? 999 : b === "85+" ? 85 : Number(b.split("-")[0]));

/** Pure — counts by product × 5-year band × gender, and the data gaps. */
export function summarizeLives(lives: InForceLife[]): { rows: LivesSummaryRow[]; gaps: LivesGaps } {
  const m = new Map<string, LivesSummaryRow>();
  for (const l of lives) {
    const band = ageBand(l.age);
    const k = `${l.product}|${band}`;
    const r = m.get(k) ?? { product: l.product, band, male: 0, female: 0, unknown: 0, total: 0 };
    if (l.gender === "Male") r.male++; else if (l.gender === "Female") r.female++; else r.unknown++;
    r.total++;
    m.set(k, r);
  }
  const rows = Array.from(m.values()).sort((a, b) => a.product.localeCompare(b.product) || BAND_ORDER(a.band) - BAND_ORDER(b.band));
  return {
    rows,
    gaps: {
      lives: lives.length,
      policies: new Set(lives.map((l) => l.policyNumber)).size,
      noDateOfBirth: lives.filter((l) => !l.dateOfBirth).length,
      noGender: lives.filter((l) => l.gender === "Unknown").length,
    },
  };
}

const FREQ: Record<string, string> = { monthly: "Monthly", weekly: "Weekly", biweekly: "Every 2 weeks", yearly: "Yearly", annually: "Yearly", quarterly: "Quarterly" };

export async function buildInForceLives(orgId: string, f: { asOf: string; branchId?: string }): Promise<{ asOf: string; lives: InForceLife[] }> {
  const tdb = await getDbForOrg(orgId);
  const rows = rowsOf<any>(await tdb.execute(sql`
    SELECT p.policy_number, prod.name AS product, p.status, p.inception_date, p.currency, p.premium_amount, p.payment_schedule, p.is_legacy,
      pm.member_number, pm.role, d.relationship,
      COALESCE(c.date_of_birth, d.date_of_birth) AS dob, COALESCE(c.gender, d.gender) AS gender
    FROM policy_members pm
    JOIN policies p ON p.id = pm.policy_id
    JOIN product_versions pv ON pv.id = p.product_version_id
    JOIN products prod ON prod.id = pv.product_id
    LEFT JOIN clients c ON c.id = pm.client_id
    LEFT JOIN dependents d ON d.id = pm.dependent_id
    WHERE p.organization_id = ${orgId} AND pm.is_active = true AND pm.date_of_death IS NULL
      AND p.status IN ('active', 'grace') AND p.deleted_at IS NULL
      AND (p.inception_date IS NULL OR p.inception_date <= ${f.asOf}::date)
      ${f.branchId ? sql`AND p.branch_id = ${f.branchId}` : sql``}
    ORDER BY p.policy_number, (pm.role = 'policy_holder') DESC, pm.member_number`));
  const lives: InForceLife[] = rows.map((r) => {
    const dob = iso(r.dob);
    const holder = r.role === "policy_holder";
    return {
      policyNumber: r.policy_number, product: r.product, status: r.status, inceptionDate: iso(r.inception_date),
      currency: (r.currency || "USD").toUpperCase(), premium: r.premium_amount ?? "", frequency: FREQ[r.payment_schedule] ?? (r.payment_schedule || ""),
      isLegacy: !!r.is_legacy, memberNumber: r.member_number ?? "",
      role: holder ? "Policyholder" : "Dependant", relationship: holder ? "Self" : (r.relationship || ""),
      dateOfBirth: dob, age: ageAt(dob, f.asOf), gender: normaliseGender(r.gender),
    };
  });
  return { asOf: f.asOf, lives };
}

export interface ClaimHistoryRow {
  claimNumber: string;
  policyNumber: string;
  product: string;
  claimType: string;
  deceasedName: string;
  relationship: string;
  dateOfBirth: string | null;
  dateOfDeath: string | null;
  ageAtDeath: number | null;
  gender: "Male" | "Female" | "Unknown";
  causeOfDeath: string;
  inceptionDate: string | null;
  monthsInForce: number | null;   // inception → death; early claims are what an actuary looks for
  reported: string;
  decided: string | null;
  status: string;
  decisionReason: string;
  currency: string;
  cashInLieu: string;
  ledgerAmount: string;
  exGratia: boolean;
}

/** Pure — whole months from a to b (YYYY-MM-DD). */
export function monthsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b || b < a) return null;
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

export async function buildClaimsHistory(orgId: string, f: { fromDate?: string; toDate?: string; branchId?: string }): Promise<ClaimHistoryRow[]> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const rows = rowsOf<any>(await tdb.execute(sql`
    SELECT c.claim_number, p.policy_number, prod.name AS product, c.claim_type, c.deceased_name, c.deceased_relationship,
      c.date_of_death, c.cause_of_death, c.created_at, c.decided_at, c.status, c.decision_reason, c.currency,
      c.cash_in_lieu_amount, c.ledger_amount, c.is_ex_gratia, p.inception_date,
      COALESCE(mc.date_of_birth, md.date_of_birth) AS dob, COALESCE(mc.gender, md.gender) AS gender, pm.role
    FROM claims c
    LEFT JOIN policies p ON p.id = c.policy_id
    LEFT JOIN product_versions pv ON pv.id = p.product_version_id
    LEFT JOIN products prod ON prod.id = pv.product_id
    LEFT JOIN policy_members pm ON pm.id = c.policy_member_id
    LEFT JOIN clients mc ON mc.id = pm.client_id
    LEFT JOIN dependents md ON md.id = pm.dependent_id
    WHERE c.organization_id = ${orgId}
      ${start ? sql`AND c.created_at >= ${start}` : sql``} ${endExclusive ? sql`AND c.created_at < ${endExclusive}` : sql``}
      ${f.branchId ? sql`AND COALESCE(c.branch_id, p.branch_id) = ${f.branchId}` : sql``}
    ORDER BY c.created_at DESC`));
  return rows.map((r) => {
    const dob = iso(r.dob), dod = iso(r.date_of_death), inc = iso(r.inception_date);
    return {
      claimNumber: r.claim_number, policyNumber: r.policy_number ?? "", product: r.product ?? "",
      claimType: r.claim_type ?? "", deceasedName: r.deceased_name ?? "",
      relationship: r.deceased_relationship || (r.role === "policy_holder" ? "Self" : ""),
      dateOfBirth: dob, dateOfDeath: dod, ageAtDeath: ageAt(dob, dod), gender: normaliseGender(r.gender),
      causeOfDeath: r.cause_of_death ?? "", inceptionDate: inc, monthsInForce: monthsBetween(inc, dod),
      reported: dateInTimezone(r.created_at, tz), decided: r.decided_at ? dateInTimezone(r.decided_at, tz) : null,
      status: r.status, decisionReason: r.decision_reason ?? "", currency: (r.currency || "USD").toUpperCase(),
      cashInLieu: r.cash_in_lieu_amount ?? "", ledgerAmount: r.ledger_amount ?? "", exGratia: !!r.is_ex_gratia,
    };
  });
}
