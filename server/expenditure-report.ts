/**
 * Reports → Finance → Expenditure: all money spent in the period, one line per payout —
 * requisitions paid, expenditures paid and petty cash spent — the same money out as the
 * cash-flow statement. A requisition categorised "Commission" is agents being paid their
 * commission (isCommissionPayoutCategory), labelled as such. Dates are the payout's own
 * (calendar) date; money stays in the currency it was paid in.
 */
import { sql } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { isCommissionPayoutCategory, isPol263Payment, POL263_PAYMENT_CATEGORY } from "./financial-statements";
import { toCents, fromCents } from "@shared/money";

export type SpendKind = "requisition" | "expenditure" | "petty_cash";

export interface SpendRow {
  kind: SpendKind;
  id: string;
  date: string;
  voucher: string;       // voucher no. (payouts) / receipt ref (petty cash)
  reference: string;     // requisition no.
  category: string;
  description: string;
  payee: string;
  currency: string;
  amount: string;
  method: string;
  paidBy: string;
  branch: string;
  department: string;
  commissionPayout: boolean;
}

export interface SpendSummary {
  count: number;
  byCurrency: Record<string, string>;
  byKind: Record<SpendKind, Record<string, string>>;
  /** category → currency → amount, largest first when rendered */
  byCategory: Record<string, Record<string, string>>;
}

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const day = (d: unknown) => String(d instanceof Date ? d.toISOString() : d ?? "").slice(0, 10);

export interface SpendFilters { fromDate?: string; toDate?: string; branchId?: string; type?: SpendKind | "all" }

export async function buildExpenditureReport(orgId: string, f: SpendFilters, maxRows = 20000): Promise<{ rows: SpendRow[]; summary: SpendSummary; truncated: boolean }> {
  const tdb = await getDbForOrg(orgId);
  const type = f.type ?? "all";
  const want = (k: SpendKind) => type === "all" || type === k;
  const dateRange = (col: any) => sql`${f.fromDate ? sql`AND ${col} >= ${f.fromDate}::date` : sql``} ${f.toDate ? sql`AND ${col} <= ${f.toDate}::date` : sql``}`;
  const rows: SpendRow[] = [];

  if (want("requisition") || want("expenditure")) {
    const kinds = [want("requisition") ? "requisition" : null, want("expenditure") ? "expenditure" : null].filter(Boolean) as string[];
    const payouts = rowsOf<any>(await tdb.execute(sql`
      SELECT d.id, d.entity_type, d.paid_date, d.voucher_number, d.amount, d.currency, d.payment_method, d.reference AS d_ref, d.received_by,
             COALESCE(rq.category, ex.category) AS category, COALESCE(rq.description, ex.description) AS description,
             rq.requisition_number, rq.payee, rq.department, b.name AS branch, u.display_name AS paid_by
      FROM payment_disbursements d
      LEFT JOIN requisitions rq ON d.entity_type = 'requisition' AND rq.id = d.entity_id
      LEFT JOIN expenditures ex ON d.entity_type = 'expenditure' AND ex.id = d.entity_id
      LEFT JOIN branches b ON b.id = d.branch_id
      LEFT JOIN users u ON u.id = d.paid_by_user_id
      WHERE d.organization_id = ${orgId} AND d.entity_type IN (${sql.join(kinds.map((k) => sql`${k}`), sql`, `)})
        ${dateRange(sql`d.paid_date`)}
        ${f.branchId ? sql`AND d.branch_id = ${f.branchId}` : sql``}
      ORDER BY d.paid_date DESC
      LIMIT ${maxRows + 1}`));
    for (const r of payouts) {
      const commission = r.entity_type === "requisition" && isCommissionPayoutCategory(r.category);
      rows.push({
        kind: r.entity_type, id: r.id, date: day(r.paid_date), voucher: r.voucher_number ?? "", reference: r.requisition_number ?? r.d_ref ?? "",
        // Paying POL263 its fees, however the requisition was categorised ("PAYMENT", "FEES"…).
        category: r.entity_type === "requisition" && !commission && isPol263Payment(r.category, r.description) ? POL263_PAYMENT_CATEGORY : (r.category || "Uncategorised"),
        description: r.description ?? "", payee: r.payee || r.received_by || "",
        currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)), method: r.payment_method ?? "",
        paidBy: r.paid_by ?? "", branch: r.branch ?? "", department: r.department ?? "", commissionPayout: commission,
      });
    }
  }

  if (want("petty_cash")) {
    const petty = rowsOf<any>(await tdb.execute(sql`
      SELECT t.id, t.transaction_date, t.amount, f.currency, t.category, t.description, t.receipt_ref, u.display_name AS paid_by, b.name AS branch
      FROM petty_cash_transactions t
      JOIN petty_cash_floats f ON f.id = t.float_id
      LEFT JOIN users u ON u.id = t.performed_by_user_id
      LEFT JOIN branches b ON b.id = f.branch_id
      WHERE t.organization_id = ${orgId} AND t.type = 'disbursement'
        ${dateRange(sql`t.transaction_date`)}
        ${f.branchId ? sql`AND f.branch_id = ${f.branchId}` : sql``}
      ORDER BY t.transaction_date DESC
      LIMIT ${maxRows + 1}`));
    for (const r of petty) {
      rows.push({
        kind: "petty_cash", id: r.id, date: day(r.transaction_date), voucher: r.receipt_ref ?? "", reference: "",
        category: r.category || "Uncategorised", description: r.description ?? "", payee: "",
        currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)), method: "cash",
        paidBy: r.paid_by ?? "", branch: r.branch ?? "", department: "", commissionPayout: false,
      });
    }
  }

  rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const truncated = rows.length > maxRows;
  const out = rows.slice(0, maxRows);
  return { rows: out, summary: summarizeSpend(out), truncated };
}

/** Pure — totals per currency, per type and per category (never adding currencies together). */
export function summarizeSpend(rows: SpendRow[]): SpendSummary {
  const cur: Record<string, number> = {};
  const kind: Record<SpendKind, Record<string, number>> = { requisition: {}, expenditure: {}, petty_cash: {} };
  const cat: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const c = toCents(r.amount);
    cur[r.currency] = (cur[r.currency] ?? 0) + c;
    kind[r.kind][r.currency] = (kind[r.kind][r.currency] ?? 0) + c;
    const label = r.commissionPayout ? "Commission paid to agents" : r.category;
    cat[label] ??= {};
    cat[label][r.currency] = (cat[label][r.currency] ?? 0) + c;
  }
  const s = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, fromCents(v)]));
  return {
    count: rows.length,
    byCurrency: s(cur),
    byKind: { requisition: s(kind.requisition), expenditure: s(kind.expenditure), petty_cash: s(kind.petty_cash) },
    byCategory: Object.fromEntries(Object.entries(cat).map(([k, v]) => [k, s(v)])),
  };
}
