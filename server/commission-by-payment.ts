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
import { periodsPaidByReceipt } from "./payment-position";
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

  // Built from the commission ledger itself (the same rows the Commissions statement totals), so
  // the two reports always agree. Each payment's entries become one line, with its receipt when
  // there is one; entries with no payment (clawbacks, reversals, society commission) are lines of
  // their own.
  const entries = rowsOf<any>(await tdb.execute(sql`
    SELECT e.id, e.created_at, e.agent_id, u.display_name AS agent, e.transaction_id, e.entry_type, e.description, e.currency, e.amount,
      t.amount AS tx_amount, t.currency AS tx_currency,
      p.policy_number, p.premium_amount, p.payment_schedule,
      c.first_name, c.last_name,
      r.receipt_number, r.amount AS r_amount, r.currency AS r_currency, r.period_from, r.period_to, r.issued_at AS r_issued
    FROM commission_ledger_entries e
    LEFT JOIN users u ON u.id = e.agent_id
    LEFT JOIN payment_transactions t ON t.id = e.transaction_id
    LEFT JOIN policies p ON p.id = COALESCE(e.policy_id, t.policy_id)
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN LATERAL (
      SELECT pr.receipt_number, pr.amount, pr.currency, pr.period_from, pr.period_to, pr.issued_at FROM payment_receipts pr
      WHERE e.transaction_id IS NOT NULL AND pr.organization_id = e.organization_id AND pr.status = 'issued'
        AND (pr.approval_status IS NULL OR pr.approval_status = 'approved')
        AND COALESCE(pr.metadata_json->>'transactionId', pr.metadata_json->>'approvedTransactionId') = e.transaction_id::text
      LIMIT 1) r ON true
    WHERE e.organization_id = ${orgId} AND e.created_at >= ${start} AND e.created_at < ${endExclusive}
      ${f.agentId ? sql`AND e.agent_id = ${f.agentId}` : sql``}
      ${f.branchId ? sql`AND (p.id IS NULL OR p.branch_id = ${f.branchId})` : sql``}
      ${f.productId ? sql`AND (p.id IS NULL OR p.product_version_id IN (SELECT id FROM product_versions WHERE product_id = ${f.productId}))` : sql``}
    ORDER BY e.created_at DESC
    LIMIT ${maxRows}`));

  const groups = new Map<string, any[]>();
  for (const e of entries) {
    const k = e.transaction_id ? `tx:${e.transaction_id}|${e.agent_id ?? ""}|${e.currency}` : `e:${e.id}`;
    const g = groups.get(k) ?? [];
    g.push(e);
    groups.set(k, g);
  }
  const lines: CommissionLine[] = [];
  for (const [key, g] of Array.from(groups.entries())) {
    const e = g[0];
    const cur = String(e.currency || "USD").toUpperCase();
    const cents = g.reduce((s: number, x: any) => s + toCents(x.amount), 0);
    const types = Array.from(new Set(g.map((x: any) => x.entry_type))).join(", ");
    const hasReceipt = !!e.receipt_number;
    const paymentAmount = hasReceipt ? e.r_amount : e.tx_amount;
    const paymentCurrency = String((hasReceipt ? e.r_currency : e.tx_currency) || cur).toUpperCase();
    const commission = fromCents(cents);
    lines.push({
      id: key,
      kind: hasReceipt ? "receipt" : "other",
      date: new Date(hasReceipt && e.r_issued ? e.r_issued : e.created_at).toISOString().slice(0, 10),
      agentId: e.agent_id ?? null,
      agent: e.agent_id ? (e.agent || "Agent") : WALK_IN_COMPANY,
      policyNumber: e.policy_number ?? "",
      client: [e.first_name, e.last_name].filter(Boolean).join(" "),
      receiptNumber: e.receipt_number ?? "",
      description: e.transaction_id && !hasReceipt
        ? `${types.replace(/_/g, " ")} — payment with no receipt`
        : (hasReceipt ? types.replace(/_/g, " ") : (e.description || types.replace(/_/g, " "))),
      paymentCurrency,
      payment: paymentAmount != null ? fromCents(toCents(paymentAmount)) : null,
      monthsPaid: paymentAmount != null && e.transaction_id
        ? periodsPaidByReceipt({ periodFrom: e.period_from ? String(e.period_from).slice(0, 10) : null, periodTo: e.period_to ? String(e.period_to).slice(0, 10) : null, amount: paymentAmount, premium: e.premium_amount, schedule: e.payment_schedule })
        : null,
      commissionCurrency: cur,
      commission,
      commissionPct: e.transaction_id ? commissionPct(commission, cur, paymentAmount ?? null, paymentCurrency) : null,
      entryType: types,
    });
  }

  // Receipts in the period that earned nothing — listed so it's clear they weren't missed.
  const receipts: any[] = await storage.getCommissionPaymentReportByOrg(orgId, maxRows, 0, f as any);
  for (const r of receipts) {
    if (r.commissionPayable != null) continue;
    const paymentCurrency = String(r.currency || "USD").toUpperCase();
    lines.push({
      id: `r:${r.receiptId}`, kind: "receipt",
      date: r.issuedAt ? new Date(r.issuedAt).toISOString().slice(0, 10) : "",
      agentId: r.agentId ?? null, agent: r.agentName || "No agent",
      policyNumber: r.policyNumber ?? "", client: [r.clientFirstName, r.clientLastName].filter(Boolean).join(" "),
      receiptNumber: r.receiptNumber ?? "", description: "No commission on this payment",
      paymentCurrency, payment: r.amountPaid != null ? fromCents(toCents(r.amountPaid)) : null, monthsPaid: r.monthsPaidFor ?? null,
      commissionCurrency: paymentCurrency, commission: null, commissionPct: null, entryType: "",
    });
  }
  lines.sort((a, b) => a.agent.localeCompare(b.agent) || b.date.localeCompare(a.date));
  return { lines, subtotals: subtotalByAgent(lines), receiptsWithoutCommission: lines.filter((l) => l.kind === "receipt" && l.commission == null).length };
}
