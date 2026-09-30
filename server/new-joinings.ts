/**
 * Reports → Policies → New joinings. Pure — no DB.
 *
 * "New joining" means new business: a policy captured in the period that is NOT a migrated
 * (is_legacy) policy. Existing paper clients typed in as legacy policies are data capture, not
 * sales — in Sep 2026 they were 136 of Falakhe's 172 captured policies — so they are counted
 * separately and never in the new-business totals.
 */
import { toCents, fromCents } from "@shared/money";

export type JoiningPaid = "paid" | "group" | "unpaid";

export interface NewJoiningRow {
  policyId: string;
  isLegacy: boolean;
  agentId: string | null;
  agentName: string;
  premium: string;
  currency: string;
  paid: JoiningPaid;
}

/** One policy on the report, as storage.getNewJoiningsReportByOrg returns it. */
export interface NewJoiningReportRow extends NewJoiningRow {
  policyNumber: string;
  memberNumber: string;
  clientName: string;
  nationalId: string;
  dateOfBirth: string;
  phone: string;
  address: string;
  productName: string;
  paymentSchedule: string;
  groupName: string;
  branchName: string;
  /** Tenant-local calendar day the policy was entered. */
  capturedOn: string;
  startDate: string;
  status: string;
  /** Own first receipt's date; for "group", the group's latest lump-sum receipt date. */
  firstPaymentDate: string;
  firstPaymentAmount: string;
  firstPaymentCurrency: string;
}

export interface AgentJoinings {
  agentId: string | null;
  agentName: string;
  count: number;
  paid: number;
  unpaid: number;
  /** Premium of the new policies, per currency ("123.45"). */
  premium: Record<string, string>;
}

export interface NewJoiningsSummary {
  newBusiness: number;
  paid: number;
  paidThroughGroup: number;
  unpaid: number;
  /** Premium the new policies bring in, per currency. */
  premium: Record<string, string>;
  legacyCaptured: number;
  byAgent: AgentJoinings[];
}

/** Label for policies with no agent — same wording as the rest of the reports. */
export const WALK_IN_AGENT = "Walk-in";

export function summarizeNewJoinings(rows: NewJoiningRow[]): NewJoiningsSummary {
  const premiumCents: Record<string, number> = {};
  const agents = new Map<string, { a: AgentJoinings; cents: Record<string, number> }>();
  let newBusiness = 0, paid = 0, paidThroughGroup = 0, unpaid = 0, legacyCaptured = 0;

  for (const r of rows) {
    if (r.isLegacy) { legacyCaptured++; continue; }
    newBusiness++;
    if (r.paid === "paid") paid++;
    else if (r.paid === "group") paidThroughGroup++;
    else unpaid++;
    const cur = r.currency || "USD";
    const cents = toCents(r.premium);
    premiumCents[cur] = (premiumCents[cur] ?? 0) + cents;

    const key = r.agentId ?? "";
    let entry = agents.get(key);
    if (!entry) {
      entry = { a: { agentId: r.agentId, agentName: r.agentId ? r.agentName : WALK_IN_AGENT, count: 0, paid: 0, unpaid: 0, premium: {} }, cents: {} };
      agents.set(key, entry);
    }
    entry.a.count++;
    if (r.paid === "unpaid") entry.a.unpaid++;
    else entry.a.paid++;
    entry.cents[cur] = (entry.cents[cur] ?? 0) + cents;
  }

  const toStrings = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fromCents(v)]));
  const byAgent = Array.from(agents.values())
    .map(({ a, cents }) => ({ ...a, premium: toStrings(cents) }))
    .sort((x, y) => y.count - x.count || x.agentName.localeCompare(y.agentName));

  return { newBusiness, paid, paidThroughGroup, unpaid, premium: toStrings(premiumCents), legacyCaptured, byAgent };
}
