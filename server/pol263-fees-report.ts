/**
 * Reports → Finance → POL263 fees: what POL263 costs the tenant, from the tenant's side.
 *   Bills       — POL263 bills issued in the period (control plane; void bills left out).
 *   Not billed  — 2.5% fees charged in the period that no bill picked up: still waiting for one,
 *                 or paid straight off by a settlement.
 *   Payments    — money paid to POL263: requisitions paying the 2.5% fees, and bills paid online.
 * Period cost = bills issued + fees not on a bill (the Income Statement's POL263 line); payments
 * are the Cash Flow's POL263 line. Falakhe owes what POL263 bills (Augustus, 1 Oct 2026). "Owed
 * now" and "building up" are positions today, whatever the period. Not kept per branch.
 */
import { sql, and, eq, ne } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { dayRangeForOrg, getOrgTimezone, dateInTimezone } from "./date-utils";
import { toCents, fromCents } from "@shared/money";
import { feeNotOnBill, isPol263Payment } from "./financial-statements";

export type BillState = "open" | "overdue" | "paid";

export interface Pol263Bill {
  id: string;
  reference: string;
  kind: string;
  periodFrom: string | null;
  periodTo: string | null;
  issued: string;
  due: string;
  paid: string | null;
  amount: string;
  currency: string;
  state: BillState;
  lines: Array<{ label: string; amount: string; currency?: string }>;
}

export interface Pol263Fee {
  id: string;
  date: string;
  source: string;        // what the fee was charged on, in words
  policyNumber: string | null;
  currency: string;
  fee: string;
  /** paid straight off by a settlement, never on a bill */
  paidWithoutBill: boolean;
}

export interface Pol263Payment {
  id: string;
  date: string;
  reference: string;     // voucher / requisition no., or the bill reference
  description: string;
  via: "requisition" | "online";
  currency: string;
  amount: string;
}

export interface Pol263FeesSummary {
  billed: Record<string, string>;
  feesNotBilled: Record<string, string>;
  /** billed + fees not yet billed — the Income Statement's POL263 line */
  cost: Record<string, string>;
  paid: Record<string, string>;
  /** open bills today, whatever the period */
  owedNow: Record<string, string>;
  overdueNow: Record<string, string>;
  /** every fee not yet on a bill, whatever the period */
  buildingUp: Record<string, string>;
}

const rowsOf = <T>(r: any): T[] => (r?.rows ?? r) as T[];
const KIND_LABEL: Record<string, string> = {
  revenue_share: "2.5% fees",
  subscription: "Subscription",
  per_policy: "Per-policy fee",
  setup: "Setup fee",
  adjustment: "Correction",
};

export function billState(status: string, due: Date, now: Date): BillState {
  if (status === "paid") return "paid";
  return due.getTime() < now.getTime() ? "overdue" : "open";
}

/** Pure — fee description in words; never an internal id. */
export function feeSource(r: { description: string | null; receipt_number: string | null; service_receipt_number: string | null; group_name: string | null }): string {
  if (r.receipt_number) return `Receipt #${r.receipt_number}`;
  if (r.service_receipt_number) return `Service receipt #${r.service_receipt_number}`;
  const d = (r.description ?? "").replace(/^Platform fee on /i, "");
  const lgr = d.match(/legacy group receipt (\S+)(?: \(group (.+)\))?/i);
  if (lgr) return `Society receipt ${lgr[1]}${lgr[2] ? ` — ${lgr[2]}` : ""}`;
  const rec = d.match(/receipt (\d+)/i);
  if (rec) return `Receipt #${rec[1]}`;
  if (/^payment [0-9a-f-]{36}$/i.test(d)) return "Payment (no receipt)";
  return d ? d.charAt(0).toUpperCase() + d.slice(1) : "Fee";
}

export function summarizePol263Fees(bills: Pol263Bill[], fees: Pol263Fee[], payments: Pol263Payment[], openNow: Pol263Bill[], buildingUp: Array<{ currency: string; fee: string }>): Pol263FeesSummary {
  const sum = (items: Array<{ currency: string; amount: string }>) => {
    const m: Record<string, number> = {};
    for (const i of items) m[i.currency] = (m[i.currency] ?? 0) + toCents(i.amount);
    return m;
  };
  const out = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).filter(([, v]) => v !== 0).map(([k, v]) => [k, fromCents(v)]));
  const billed = sum(bills);
  const notBilled = sum(fees.map((f) => ({ currency: f.currency, amount: f.fee })));
  const cost: Record<string, number> = { ...billed };
  for (const [c, v] of Object.entries(notBilled)) cost[c] = (cost[c] ?? 0) + v;
  return {
    billed: out(billed),
    feesNotBilled: out(notBilled),
    cost: out(cost),
    paid: out(sum(payments)),
    owedNow: out(sum(openNow)),
    overdueNow: out(sum(openNow.filter((b) => b.state === "overdue"))),
    buildingUp: out(sum(buildingUp.map((f) => ({ currency: f.currency, amount: f.fee })))),
  };
}

export async function buildPol263FeesReport(orgId: string, f: { fromDate: string; toDate: string }): Promise<{ bills: Pol263Bill[]; payments: Pol263Payment[]; openBills: Pol263Bill[]; fees: Pol263Fee[]; summary: Pol263FeesSummary; billsUnavailable: boolean }> {
  const tdb = await getDbForOrg(orgId);
  const tz = await getOrgTimezone(orgId);
  const { start, endExclusive } = await dayRangeForOrg(orgId, f.fromDate, f.toDate);
  const now = new Date();
  const day = (d: Date | null | undefined) => (d ? dateInTimezone(d, tz) : null);

  let all: any[] = [];
  let billsUnavailable = false;
  try {
    const [{ cpDb }, { tenantInvoices }] = await Promise.all([import("./control-plane-db"), import("@shared/control-plane-schema")]);
    all = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.tenantId, orgId), ne(tenantInvoices.status, "void")));
  } catch {
    billsUnavailable = true; // control plane unreachable — show the fees, say the bills couldn't load
  }
  const toBill = (i: any): Pol263Bill => ({
    id: i.id,
    reference: i.merchantReference || `BILL-${String(i.id).slice(0, 8)}`,
    kind: KIND_LABEL[i.kind] ?? i.kind,
    periodFrom: day(i.periodStart), periodTo: day(i.periodEnd),
    issued: day(i.issuedAt)!, due: day(i.dueDate)!, paid: day(i.paidAt),
    amount: fromCents(toCents(i.amount)), currency: (i.currency || "USD").toUpperCase(),
    state: billState(i.status, new Date(i.dueDate), now),
    lines: (i.lineItems ?? []).map((l: any) => ({ label: l.label, amount: l.amount, currency: l.currency })),
  });
  const inRange = (d: Date | null) => !!d && d >= start! && d < endExclusive!;
  const byIssued = (a: Pol263Bill, b: Pol263Bill) => (a.issued < b.issued ? 1 : -1);
  const bills = all.filter((i) => inRange(new Date(i.issuedAt))).map(toBill).sort(byIssued);
  // A bill marked paid by hand is money the tenant recorded leaving as a requisition (listed
  // below); only a bill paid online is a payment in its own right.
  const paidOnline = all.filter((i) => i.status === "paid" && !i.markedPaidBy && inRange(i.paidAt ? new Date(i.paidAt) : null)).map(toBill);
  const openBills = all.filter((i) => i.status === "open").map(toBill).sort(byIssued);

  const feeRows = rowsOf<any>(await tdb.execute(sql`
    SELECT f.id, f.created_at, f.amount, f.currency, f.description, f.is_settled,
      COALESCE(p.policy_number, rp.policy_number) AS policy_number,
      r.receipt_number, s.receipt_number AS service_receipt_number, NULL::text AS group_name
    FROM platform_receivables f
    LEFT JOIN payment_transactions t ON t.id = f.source_transaction_id
    LEFT JOIN policies p ON p.id = t.policy_id
    LEFT JOIN LATERAL (
      SELECT pr.receipt_number, pr.policy_id FROM payment_receipts pr
      WHERE f.source_transaction_id IS NOT NULL AND pr.organization_id = f.organization_id
        AND COALESCE(pr.metadata_json->>'transactionId', pr.metadata_json->>'approvedTransactionId') = f.source_transaction_id::text
      LIMIT 1) r ON true
    LEFT JOIN policies rp ON rp.id = r.policy_id
    LEFT JOIN service_receipts s ON s.id = f.source_service_receipt_id
    WHERE f.organization_id = ${orgId} AND ${feeNotOnBill(sql`f`)}
      AND f.created_at >= ${start} AND f.created_at < ${endExclusive}
    ORDER BY f.created_at DESC`));
  const fees: Pol263Fee[] = feeRows.map((r) => {
    const m = String(r.description ?? "").match(/\(policy (\S+)\)/i);
    return {
      id: r.id, date: dateInTimezone(r.created_at, tz), source: feeSource(r),
      policyNumber: r.policy_number ?? m?.[1] ?? null,
      currency: (r.currency || "USD").toUpperCase(), fee: fromCents(toCents(r.amount)), paidWithoutBill: !!r.is_settled,
    };
  });

  const reqPayRows = rowsOf<any>(await tdb.execute(sql`
    SELECT d.id, d.paid_date, d.amount, d.currency, d.voucher_number, rq.requisition_number, rq.category, rq.description
    FROM payment_disbursements d JOIN requisitions rq ON rq.id = d.entity_id
    WHERE d.organization_id = ${orgId} AND d.entity_type = 'requisition'
      AND d.paid_date >= ${f.fromDate}::date AND d.paid_date <= ${f.toDate}::date
    ORDER BY d.paid_date DESC`));
  const payments: Pol263Payment[] = [
    ...reqPayRows.filter((r) => isPol263Payment(r.category, r.description)).map((r) => ({
      id: r.id, date: String(r.paid_date instanceof Date ? r.paid_date.toISOString() : r.paid_date).slice(0, 10),
      reference: [r.voucher_number, r.requisition_number].filter(Boolean).join(" · "), description: r.description || r.category || "Paid to POL263",
      via: "requisition" as const, currency: (r.currency || "USD").toUpperCase(), amount: fromCents(toCents(r.amount)),
    })),
    ...paidOnline.map((b) => ({ id: b.id, date: b.paid!, reference: b.reference, description: `POL263 bill paid online (${b.kind})`, via: "online" as const, currency: b.currency, amount: b.amount })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1));

  const building = rowsOf<{ currency: string; fee: string }>(await tdb.execute(sql`
    SELECT UPPER(COALESCE(currency, 'USD')) AS currency, SUM(amount)::text AS fee FROM platform_receivables
    WHERE organization_id = ${orgId} AND is_settled = false GROUP BY 1`));

  return { bills, payments, openBills, fees, summary: summarizePol263Fees(bills, fees, payments, openBills, building), billsUnavailable };
}
