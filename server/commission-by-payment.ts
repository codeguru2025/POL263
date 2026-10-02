/**
 * Reports → Agents → Commission by payment: every commission line in the period, so an agent's
 * lines add up exactly to the Commissions statement's earned − clawed back (Augustus, 2 Oct 2026).
 *   Receipt lines — each counting receipt and the commission its payment earned (blank when none),
 *                   months paid (periods on the receipt, else amount ÷ premium) and commission % of
 *                   the payment, so a wrong rate stands out.
 *   Other lines   — commission ledger rows with no receipt: clawbacks, clawback reversals, society
 *                   commission, historical imports.
 * Subtotals per agent and currency. Tenant-local days.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg } from "./date-utils";
import { storage } from "./storage";
import { toCents, fromCents } from "@shared/money";
import { WALK_IN_COMPANY } from "./commission-statement";

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];

export interface CommissionLine {
  id: string;          // receipt id, or commission ledger entry id
  kind: "receipt" | "other";
  date: string;
  agentId: string | null;
  agent: string;
  policyNumber: string;
  client: string;
  receiptNumber: string;
  description: string;
  paymentCurrency: string;
  payment: string | null;
  monthsPaid: number | null;
  commissionCurrency: string;
  commission: string | null;
  commissionPct: number | null;
  entryType: string;
}

export interface AgentSubtotal {
  agentId: string | null;
  agent: string;
  currency: string;
  receipts: number;
  earned: string;
  clawedBack: string;
  net: string;
}

/** Pure — commission as % of the payment, only when both are in the same currency. */
export function commissionPct(commission: string | null, commissionCurrency: string, payment: string | null, paymentCurrency: string): number | null {
  if (commission == null || payment == null || commissionCurrency !== paymentCurrency) return null;
  const p = toCents(payment);
  return p > 0 ? Number(((toCents(commission) / p) * 100).toFixed(1)) : null;
}

/** Pure — per agent and currency: receipts, earned (everything but clawbacks), clawed back, net. */
export function subtotalByAgent(lines: CommissionLine[]): AgentSubtotal[] {
  const m = new Map<string, { agentId: string | null; agent: string; currency: string; receipts: number; earned: number; claw: number }>();
  for (const l of lines) {
    if (l.commission == null && l.kind === "receipt") continue;
    const k = `${l.agentId ?? ""}|${l.commissionCurrency}`;
    const s = m.get(k) ?? { agentId: l.agentId, agent: l.agent, currency: l.commissionCurrency, receipts: 0, earned: 0, claw: 0 };
    if (l.kind === "receipt") s.receipts++;
    if (/^clawback/i.test(l.entryType)) s.claw += toCents(l.commission ?? 0);
    else s.earned += toCents(l.commission ?? 0);
    m.set(k, s);
  }
  return Array.from(m.values())
    .map((s) => ({ agentId: s.agentId, agent: s.agent, currency: s.currency, receipts: s.receipts, earned: fromCents(s.earned), clawedBack: fromCents(s.claw), net: fromCents(s.earned + s.claw) }))
    .sort((a, b) => Number(a.agentId == null) - Number(b.agentId == null) || toCents(b.net) - toCents(a.net) || a.agent.localeCompare(b.agent));
}

export async function buildCommissionByPayment(orgId: string, f: { fromDate: string; toDate: string; agentId?: string; branchId?: string; productId?: string }, maxRows = 20000): Promise<{ lines: CommissionLine[]; subtotals: AgentSubtotal[]; receiptsWithoutCommission: number }> {
  const tdb = await getDbForOrg(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const receipts: any[] = await storage.getCommissionPaymentReportByOrg(orgId, maxRows, 0, f as any);
  const lines: CommissionLine[] = receipts.map((r) => {
    const commissionCurrency = String(r.commissionCurrency || r.currency || "USD").toUpperCase();
    const paymentCurrency = String(r.currency || "USD").toUpperCase();
    const hasComm = r.commissionPayable != null;
    return {
      id: String(r.receiptId),
      kind: "receipt",
      date: r.issuedAt ? new Date(r.issuedAt).toISOString().slice(0, 10) : "",
      agentId: r.agentId ?? null,
      agent: r.agentName || (hasComm ? WALK_IN_COMPANY : "No agent"),
      policyNumber: r.policyNumber ?? "",
      client: [r.clientFirstName, r.clientLastName].filter(Boolean).join(" "),
      receiptNumber: r.receiptNumber ?? "",
      description: r.commissionType ? String(r.commissionType).replace(/_/g, " ") : "No commission on this payment",
      paymentCurrency,
      payment: r.amountPaid != null ? fromCents(toCents(r.amountPaid)) : null,
      monthsPaid: r.monthsPaidFor ?? null,
      commissionCurrency,
      commission: hasComm ? fromCents(toCents(r.commissionPayable)) : null,
      commissionPct: commissionPct(hasComm ? r.commissionPayable : null, commissionCurrency, r.amountPaid, paymentCurrency),
      entryType: r.commissionType ?? "",
    };
  });

  // Ledger rows not tied to a receipt: clawbacks, reversals, society commission, imports.
  const other = rowsOf<any>(await tdb.execute(sql`
    SELECT e.id, e.created_at, e.agent_id, u.display_name AS agent, p.policy_number, e.entry_type, e.description, e.currency, e.amount
    FROM commission_ledger_entries e
    LEFT JOIN users u ON u.id = e.agent_id
    LEFT JOIN policies p ON p.id = e.policy_id
    WHERE e.organization_id = ${orgId} AND e.transaction_id IS NULL
      AND e.created_at >= ${start} AND e.created_at < ${endExclusive}
      ${f.agentId ? sql`AND e.agent_id = ${f.agentId}` : sql``}
      ${f.branchId ? sql`AND (e.policy_id IS NULL OR p.branch_id = ${f.branchId})` : sql``}
    ORDER BY e.created_at DESC`));
  for (const o of other) {
    const cur = String(o.currency || "USD").toUpperCase();
    lines.push({
      id: String(o.id),
      kind: "other",
      date: new Date(o.created_at).toISOString().slice(0, 10),
      agentId: o.agent_id ?? null,
      agent: o.agent_id ? (o.agent || "Agent") : WALK_IN_COMPANY,
      policyNumber: o.policy_number ?? "",
      client: "",
      receiptNumber: "",
      description: o.description || String(o.entry_type).replace(/_/g, " "),
      paymentCurrency: cur,
      payment: null,
      monthsPaid: null,
      commissionCurrency: cur,
      commission: fromCents(toCents(o.amount)),
      commissionPct: null,
      entryType: o.entry_type,
    });
  }
  lines.sort((a, b) => a.agent.localeCompare(b.agent) || b.date.localeCompare(a.date));
  return { lines, subtotals: subtotalByAgent(lines), receiptsWithoutCommission: lines.filter((l) => l.kind === "receipt" && l.commission == null).length };
}
