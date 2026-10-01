/**
 * Reports → Finance → Receipts: every receipt in the period, one line each, across the three ways
 * money comes in — policy premiums, funeral-service receipts and society lump sums — so "All"
 * matches what was actually received (and the Income Statement).
 *
 *  - Premium receipts waiting for approval are listed (flagged) but never counted in the totals;
 *    rejected ones aren't listed.
 *  - Months paid = the months the receipt actually covers (server/payment-position.ts), the same
 *    rule as the Finance report.
 *  - Tenant-local dates; money stays in the currency it was paid in.
 *  - Society lump sums aren't kept per branch or agent and don't record a payment method, so a
 *    branch/agent filter leaves them out (and says so).
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg, getOrgTimezone, dateInTimezone } from "./date-utils";
import { periodsPaidByReceipt } from "./payment-position";
import { toCents, fromCents } from "@shared/money";

export type ReceiptKind = "premium" | "service" | "society" | "online";

export interface ReceiptRow {
  kind: ReceiptKind;
  id: string;
  receiptNumber: string;
  datePaid: string;          // tenant-local YYYY-MM-DD
  issuedAt: string;          // ISO timestamp
  policyNumber: string;
  memberNumber: string;
  payer: string;
  description: string;       // product / funeral service / society name
  currency: string;
  amount: string;
  premiumDue: string;        // premium receipts only
  monthsPaid: number | null; // premium receipts only
  method: string;            // "" when not recorded (society lump sums)
  agent: string;
  capturedBy: string;
  groupName: string;
  branch: string;
  pending: boolean;          // waiting for approval, or an online payment not completed — not counted in totals
  notes: string;
}

export interface ReceiptsSummary {
  count: number;
  byCurrency: Record<string, string>;
  byKind: Record<Exclude<ReceiptKind, "online">, Record<string, string>>;
  byMethod: Record<string, Record<string, string>>;
  pending: { count: number; byCurrency: Record<string, string> };
  excludedForFilter: string[];
}

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const name = (...p: (string | null | undefined)[]) => p.filter(Boolean).join(" ").trim();

export interface ReceiptsFilters { fromDate?: string; toDate?: string; branchId?: string; agentId?: string; type?: ReceiptKind | "all" }

export async function buildReceiptsReport(orgId: string, f: ReceiptsFilters, maxRows = 20000): Promise<{ rows: ReceiptRow[]; summary: ReceiptsSummary; truncated: boolean }> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const type = f.type ?? "all";
  // Online payment attempts that never completed are a separate view, not part of "All".
  const want = (k: ReceiptKind) => (k === "online" ? type === "online" : type === "all" || type === k);
  const excludedForFilter: string[] = [];
  const rows: ReceiptRow[] = [];
  const range = (col: any) => sql`${start ? sql`AND ${col} >= ${start}` : sql``} ${endExclusive ? sql`AND ${col} < ${endExclusive}` : sql``}`;

  if (want("premium")) {
    const prem = rowsOf<any>(await tdb.execute(sql`
      SELECT r.id, r.receipt_number, r.issued_at, r.amount, r.currency, r.payment_channel, r.approval_status,
             r.period_from, r.period_to, p.policy_number, p.premium_amount, p.payment_schedule, p.currency AS policy_currency,
             cl.title, cl.first_name, cl.last_name, prod.name AS product, g.name AS group_name, b.name AS branch,
             ag.display_name AS agent_name, ag.email AS agent_email,
             COALESCE(rec.display_name, iss.display_name) AS captured_by, t.notes,
             (SELECT pm.member_number FROM policy_members pm WHERE pm.policy_id = p.id AND pm.role IN ('policy_holder', 'principal') AND pm.member_number IS NOT NULL LIMIT 1) AS member_number
      FROM payment_receipts r
      JOIN policies p ON p.id = r.policy_id
      LEFT JOIN clients cl ON cl.id = r.client_id
      LEFT JOIN product_versions pv ON pv.id = p.product_version_id
      LEFT JOIN products prod ON prod.id = pv.product_id
      LEFT JOIN groups g ON g.id = p.group_id
      LEFT JOIN branches b ON b.id = COALESCE(r.branch_id, p.branch_id)
      LEFT JOIN users ag ON ag.id = p.agent_id
      LEFT JOIN users iss ON iss.id = r.issued_by_user_id
      LEFT JOIN payment_transactions t ON t.id::text = COALESCE(r.metadata_json->>'transactionId', r.metadata_json->>'approvedTransactionId')
      LEFT JOIN users rec ON rec.id = t.recorded_by
      WHERE r.organization_id = ${orgId} AND r.status = 'issued'
        AND (r.approval_status IS NULL OR r.approval_status IN ('approved', 'pending'))
        ${range(sql`r.issued_at`)}
        ${f.branchId ? sql`AND COALESCE(r.branch_id, p.branch_id) = ${f.branchId}` : sql``}
        ${f.agentId ? sql`AND p.agent_id = ${f.agentId}` : sql``}
      ORDER BY r.issued_at DESC
      LIMIT ${maxRows + 1}`));
    for (const r of prem) {
      rows.push({
        kind: "premium", id: r.id, receiptNumber: String(r.receipt_number ?? ""),
        datePaid: dateInTimezone(r.issued_at, tz), issuedAt: new Date(r.issued_at).toISOString(),
        policyNumber: r.policy_number ?? "", memberNumber: r.member_number ?? "",
        payer: name(r.title, r.first_name, r.last_name), description: r.product ?? "",
        currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)),
        premiumDue: r.premium_amount != null ? `${r.policy_currency || r.currency} ${fromCents(toCents(r.premium_amount))}` : "",
        monthsPaid: periodsPaidByReceipt({
          periodFrom: r.period_from ? String(r.period_from).slice(0, 10) : null, periodTo: r.period_to ? String(r.period_to).slice(0, 10) : null,
          amount: r.amount, premium: r.premium_amount, schedule: r.payment_schedule,
        }),
        method: r.payment_channel ?? "", agent: r.agent_name || r.agent_email || "Walk-in",
        capturedBy: r.captured_by ?? "", groupName: r.group_name ?? "", branch: r.branch ?? "",
        pending: r.approval_status === "pending", notes: r.notes ?? "",
      });
    }
  }

  if (want("service")) {
    if (f.agentId) excludedForFilter.push("Funeral-service receipts");
    else {
      const svc = rowsOf<any>(await tdb.execute(sql`
        SELECT s.id, s.receipt_number, s.issued_at, s.amount, s.currency, s.payment_channel, s.notes,
               fc.deceased_name, fc.case_number, q.quotation_number, b.name AS branch, u.display_name AS captured_by
        FROM service_receipts s
        LEFT JOIN funeral_cases fc ON fc.id = s.funeral_case_id
        LEFT JOIN funeral_quotations q ON q.id = s.quotation_id
        LEFT JOIN branches b ON b.id = s.branch_id
        LEFT JOIN users u ON u.id = s.issued_by_user_id
        WHERE s.organization_id = ${orgId} AND s.status = 'issued'
          ${range(sql`s.issued_at`)}
          ${f.branchId ? sql`AND s.branch_id = ${f.branchId}` : sql``}
        ORDER BY s.issued_at DESC
        LIMIT ${maxRows + 1}`));
      for (const r of svc) {
        rows.push({
          kind: "service", id: r.id, receiptNumber: String(r.receipt_number ?? ""),
          datePaid: dateInTimezone(r.issued_at, tz), issuedAt: new Date(r.issued_at).toISOString(),
          policyNumber: "", memberNumber: "", payer: "",
          description: `Funeral service${r.deceased_name ? ` — ${r.deceased_name}` : ""}${r.quotation_number ? ` (${r.quotation_number})` : r.case_number ? ` (${r.case_number})` : ""}`,
          currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)), premiumDue: "", monthsPaid: null,
          method: r.payment_channel ?? "", agent: "", capturedBy: r.captured_by ?? "", groupName: "", branch: r.branch ?? "",
          pending: false, notes: r.notes ?? "",
        });
      }
    }
  }

  if (want("society")) {
    if (f.branchId || f.agentId) excludedForFilter.push("Society lump sums");
    else {
      const soc = rowsOf<any>(await tdb.execute(sql`
        SELECT id, receipt_number, payment_date, recorded_at, amount, currency, group_name, notes
        FROM legacy_group_receipts
        WHERE organization_id = ${orgId}
          ${f.fromDate ? sql`AND payment_date >= ${f.fromDate}::date` : sql``}
          ${f.toDate ? sql`AND payment_date <= ${f.toDate}::date` : sql``}
        ORDER BY payment_date DESC, recorded_at DESC
        LIMIT ${maxRows + 1}`));
      for (const r of soc) {
        const day = String(r.payment_date instanceof Date ? r.payment_date.toISOString() : r.payment_date).slice(0, 10);
        rows.push({
          kind: "society", id: r.id, receiptNumber: String(r.receipt_number ?? ""),
          datePaid: day, issuedAt: r.recorded_at ? new Date(r.recorded_at).toISOString() : day,
          policyNumber: "", memberNumber: "", payer: r.group_name ?? "", description: `Society lump sum — ${r.group_name ?? ""}`,
          currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)), premiumDue: "", monthsPaid: null,
          method: "", agent: "", capturedBy: "", groupName: r.group_name ?? "", branch: "",
          pending: false, notes: r.notes ?? "",
        });
      }
    }
  }

  if (want("online")) {
    // PayNow / mobile-money attempts that never turned into money: started, failed, cancelled or
    // expired. Shown so staff can follow up; never counted.
    const onl = rowsOf<any>(await tdb.execute(sql`
      SELECT i.id, i.merchant_reference, i.created_at, i.amount, i.currency, i.status, i.method_selected,
             p.policy_number, cl.first_name, cl.last_name, b.name AS branch, ag.display_name AS agent
      FROM payment_intents i
      LEFT JOIN policies p ON p.id = i.policy_id
      LEFT JOIN clients cl ON cl.id = i.client_id
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN users ag ON ag.id = p.agent_id
      WHERE i.organization_id = ${orgId} AND i.status NOT IN ('paid', 'completed')
        ${range(sql`i.created_at`)}
        ${f.branchId ? sql`AND p.branch_id = ${f.branchId}` : sql``}
        ${f.agentId ? sql`AND p.agent_id = ${f.agentId}` : sql``}
      ORDER BY i.created_at DESC
      LIMIT ${maxRows + 1}`));
    for (const r of onl) {
      rows.push({
        kind: "online", id: r.id, receiptNumber: r.merchant_reference ?? "",
        datePaid: dateInTimezone(r.created_at, tz), issuedAt: new Date(r.created_at).toISOString(),
        policyNumber: r.policy_number ?? "", memberNumber: "", payer: name(r.first_name, r.last_name),
        description: `Online payment ${String(r.status).replace(/_/g, " ")}`,
        currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)), premiumDue: "", monthsPaid: null,
        method: r.method_selected && r.method_selected !== "unknown" ? r.method_selected : "online", agent: r.agent ?? "",
        capturedBy: "", groupName: "", branch: r.branch ?? "", pending: true, notes: "",
      });
    }
  }

  rows.sort((a, b) => (a.datePaid < b.datePaid ? 1 : a.datePaid > b.datePaid ? -1 : a.issuedAt < b.issuedAt ? 1 : -1));
  const truncated = rows.length > maxRows;
  const out = rows.slice(0, maxRows);
  return { rows: out, summary: summarizeReceipts(out, excludedForFilter), truncated };
}

/** Totals over counted (non-pending) receipts, per currency — never adding currencies together. Pure. */
export function summarizeReceipts(rows: ReceiptRow[], excludedForFilter: string[] = []): ReceiptsSummary {
  const cents: Record<string, number> = {};
  const kind: Record<Exclude<ReceiptKind, "online">, Record<string, number>> = { premium: {}, service: {}, society: {} };
  const method: Record<string, Record<string, number>> = {};
  const pend: Record<string, number> = {};
  let count = 0, pendingCount = 0;
  for (const r of rows) {
    const c = toCents(r.amount);
    if (r.pending) { pendingCount++; pend[r.currency] = (pend[r.currency] ?? 0) + c; continue; }
    count++;
    cents[r.currency] = (cents[r.currency] ?? 0) + c;
    if (r.kind !== "online") kind[r.kind][r.currency] = (kind[r.kind][r.currency] ?? 0) + c;
    const m = r.method || "not recorded";
    method[m] ??= {};
    method[m][r.currency] = (method[m][r.currency] ?? 0) + c;
  }
  const s = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fromCents(v)]));
  return {
    count,
    byCurrency: s(cents),
    byKind: { premium: s(kind.premium), service: s(kind.service), society: s(kind.society) },
    byMethod: Object.fromEntries(Object.entries(method).map(([k, v]) => [k, s(v)])),
    pending: { count: pendingCount, byCurrency: s(pend) },
    excludedForFilter,
  };
}
