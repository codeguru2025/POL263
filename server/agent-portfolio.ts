/**
 * Reports → Agents → Agent portfolio: each agent's book at a glance, then every policy as a call
 * list (most behind first). Built on storage.getAllPoliciesReportByOrg so it sees the same
 * policies as the Policies reports; "months behind" uses the same paid-up-to rule as the Finance
 * report (paymentPosition). A society's agent owns the society's policies (c7f544d), so policy
 * agent is the owner. Policies with no agent are split into existing policies typed in (legacy)
 * and new walk-ins.
 */
import { storage } from "./storage";
import { todayForOrg } from "./date-utils";
import { paymentPosition } from "./payment-position";
import { toCents, fromCents } from "@shared/money";

export const NO_AGENT_TYPED_IN = "No agent — existing policies typed in";
export const NO_AGENT_WALK_IN = "No agent — new walk-ins";

export interface PortfolioPolicy {
  agent: string;
  policyNumber: string;
  status: string;
  firstName: string;
  lastName: string;
  nationalId: string;
  phone: string;
  product: string;
  branch: string;
  group: string;
  currency: string;
  premium: string;
  schedule: string;
  inceptionDate: string | null;
  paidUpTo: string | null;
  periodsBehind: number;
  amountBehind: string;
  lastPaymentDate: string | null;
  lastPaymentAmount: string | null;
  lastPaymentCurrency: string | null;
  isLegacy: boolean;
}

export interface AgentSummary {
  agent: string;
  policies: number;
  active: number;
  grace: number;
  lapsed: number;
  neverPaid: number;
  other: number;
  /** active + grace, as a monthly amount, per currency */
  monthlyPremiumInForce: Record<string, string>;
  /** active / grace / lapsed policies at least one premium behind */
  behind: number;
}

const MONTHLY_FACTOR: Record<string, number> = { monthly: 1, weekly: 52 / 12, biweekly: 26 / 12, fortnightly: 26 / 12, yearly: 1 / 12, annually: 1 / 12, quarterly: 1 / 3 };
const day = (d: unknown) => (d ? String(d instanceof Date ? d.toISOString() : d).slice(0, 10) : null);

/** Pure — one line per agent, busiest first; the two "no agent" lines last. */
export function summarizePortfolio(rows: PortfolioPolicy[]): AgentSummary[] {
  const m = new Map<string, AgentSummary & { cents: Record<string, number> }>();
  for (const r of rows) {
    let a = m.get(r.agent);
    if (!a) { a = { agent: r.agent, policies: 0, active: 0, grace: 0, lapsed: 0, neverPaid: 0, other: 0, monthlyPremiumInForce: {}, behind: 0, cents: {} }; m.set(r.agent, a); }
    a.policies++;
    if (r.status === "active") a.active++;
    else if (r.status === "grace") a.grace++;
    else if (r.status === "lapsed") a.lapsed++;
    else if (r.status === "inactive") a.neverPaid++;
    else a.other++;
    if (r.status === "active" || r.status === "grace") {
      const monthly = Math.round(toCents(r.premium) * (MONTHLY_FACTOR[r.schedule] ?? 1));
      a.cents[r.currency] = (a.cents[r.currency] ?? 0) + monthly;
    }
    if (["active", "grace", "lapsed"].includes(r.status) && r.periodsBehind > 0) a.behind++;
  }
  const noAgent = (n: string) => n === NO_AGENT_TYPED_IN || n === NO_AGENT_WALK_IN;
  return Array.from(m.values())
    .map(({ cents, ...a }) => ({ ...a, monthlyPremiumInForce: Object.fromEntries(Object.entries(cents).map(([c, v]) => [c, fromCents(v)])) }))
    .sort((x, y) => Number(noAgent(x.agent)) - Number(noAgent(y.agent)) || (y.active + y.grace) - (x.active + x.grace) || x.agent.localeCompare(y.agent));
}

export async function buildAgentPortfolio(orgId: string, filters: any, maxRows = 20000): Promise<{ agents: AgentSummary[]; policies: PortfolioPolicy[]; asOf: string }> {
  const asOf = await todayForOrg(orgId);
  const raw: any[] = await storage.getAllPoliciesReportByOrg(orgId, maxRows, 0, filters);
  const policies: PortfolioPolicy[] = raw.map((r) => {
    const status = String(r.status ?? r.currstatus ?? "");
    const paidUpTo = day(r.paidUpTo);
    const pos = ["active", "grace", "lapsed"].includes(status)
      ? paymentPosition(paidUpTo, asOf, r.premiumAmount, r.paymentSchedule)
      : { periodsOwed: 0, owed: "0.00" };
    const agent = r.agentDisplayName || r.agentEmail || (r.isLegacy ? NO_AGENT_TYPED_IN : NO_AGENT_WALK_IN);
    return {
      agent,
      policyNumber: r.policyNumber ?? r.Policy_Number ?? "",
      status,
      firstName: (r.clientFirstName ?? "").trim(),
      lastName: (r.clientLastName ?? "").trim(),
      nationalId: r.clientNationalId ?? "",
      phone: r.clientPhone ?? "",
      product: r.productName ?? "",
      branch: r.branchName ?? "",
      group: r.groupName ?? "",
      currency: (r.currency || "USD").toUpperCase(),
      premium: fromCents(toCents(r.premiumAmount ?? 0)),
      schedule: r.paymentSchedule || "monthly",
      inceptionDate: day(r.inceptionDate),
      paidUpTo,
      periodsBehind: pos.periodsOwed,
      amountBehind: pos.owed,
      lastPaymentDate: day(r.lastPaymentDate),
      lastPaymentAmount: r.lastPaymentAmount != null ? fromCents(toCents(r.lastPaymentAmount)) : null,
      lastPaymentCurrency: r.lastPaymentCurrency ?? null,
      isLegacy: !!r.isLegacy,
    };
  });
  // Call list order: agent, then most behind first, then policy number.
  policies.sort((a, b) => a.agent.localeCompare(b.agent) || b.periodsBehind - a.periodsBehind || a.policyNumber.localeCompare(b.policyNumber));
  return { agents: summarizePortfolio(policies), policies, asOf };
}
