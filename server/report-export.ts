/**
 * Shared helpers for GET /api/reports/export/:type — the per-report-type permission map and the
 * CSV cell encoder. Extracted from routes.ts so both can be unit-tested (the route handler is a
 * 700-line closure).
 */

/**
 * The permission each export type requires — the same one its JSON sibling endpoint is gated on.
 * Without this, the single `requireAnyPermission(...)` on the route would let a read:policy
 * holder pull payroll, commission net-pay, the audit trail (incl. IPs) and the balance sheet.
 * A type absent from this map is rejected (400), never defaulted.
 */
export const REPORT_EXPORT_PERMISSIONS: Record<string, string> = {
  // ── Policies (read:policy) ──
  "policies": "read:policy", "policy-details": "read:policy", "reinstatements": "read:policy",
  "conversions": "read:policy", "activations": "read:policy", "active-policies": "read:policy",
  "awaiting-payments": "read:policy", "overdue": "read:policy", "pre-lapse": "read:policy",
  "lapsed": "read:policy", "new-joinings": "read:policy", "issued-policies": "read:policy",
  "agent-productivity": "read:policy", "agent-portfolio": "read:policy",
  "policies-per-agent": "read:policy", "new-joinings-summary": "read:policy",
  "captured-per-employee": "read:policy", "broker-policies": "read:policy",
  "branch-report": "read:policy", "select-count": "read:policy",
  // ── Finance (read:finance) ──
  "finance": "read:finance", "underwriter-payable": "read:finance", "payments": "read:finance",
  "expenditures": "read:finance", "platform": "read:finance", "cashups": "read:finance",
  "receipts": "read:finance", "cashiers-summary": "read:finance",
  "deleted-receipts": "read:finance", "edited-receipts": "read:finance",
  "moved-receipts": "read:finance", "backdated-receipts": "read:finance",
  "receipt-amendments": "read:finance", "arrears-breakdown": "read:finance",
  "outstanding-payments": "read:finance",
  "actuarial-exposure": "read:finance", "actuarial-balance-sheet": "read:finance",
  "insurance-contract-summary": "read:finance",
  // ── Claims / funerals / fleet ──
  "claims": "read:claim", "funerals": "read:funeral_ops", "fleet": "read:fleet",
  // ── Commission (read:commission) ──
  "commissions": "read:commission", "commission-payments": "read:commission",
  "agent-commission": "read:commission", "agent-commission-summary": "read:commission",
  "agent-commission-by-count": "read:commission", "agent-total-commission": "read:commission",
  "manager-commission": "read:commission", "joining-commission": "read:commission",
  "joining-comms-detail": "read:commission", "joining-comms-summary": "read:commission",
  "joining-comm-inception": "read:commission", "commission-group-override": "read:commission",
  "commission-group-benefits": "read:commission", "dynamic-comm-summary": "read:commission",
  "agent-commission-mm-ext": "read:commission",
  "broker-commission-mm": "read:commission", "broker-commission-2": "read:commission",
  "broker-commission-ext": "read:commission", "tier-commission": "read:commission",
  "tier-commission-breakdown": "read:commission",
  // ── Payroll / HR / audit / feedback ──
  "payroll": "read:payroll", "irp5-reconciliation": "read:payroll",
  "employee-summary": "read:user", "audit-trail": "read:audit_log",
  "complaint-report": "read:report",
};

/**
 * Encode one CSV cell. RFC 4180 quoting for delimiter/quote/newline, plus a spreadsheet
 * formula-injection guard: a value beginning =,+,-,@ or a control char (from a client-entered
 * Notes / description field) would execute as a formula when the file is opened in Excel or
 * Google Sheets — prefix it with an apostrophe and quote it.
 */
export function csvEscape(val: unknown): string {
  let str = String(val ?? "");
  const risky = /^[=+\-@\t\r]/.test(str);
  if (risky) str = "'" + str;
  if (risky || /[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}
