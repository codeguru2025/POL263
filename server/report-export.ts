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
  "persistency": "read:policy", "lapse-analysis": "read:policy", "member-movement": "read:policy",
  // ── Finance (read:finance) ──
  "finance": "read:finance", "underwriter-payable": "read:finance", "payments": "read:finance",
  "expenditures": "read:finance", "platform": "read:finance", "cashups": "read:finance",
  "receipts": "read:finance", "cashiers-summary": "read:finance",
  "deleted-receipts": "read:finance", "edited-receipts": "read:finance",
  "moved-receipts": "read:finance", "backdated-receipts": "read:finance",
  "receipt-amendments": "read:finance", "arrears-breakdown": "read:finance",
  "outstanding-payments": "read:finance",
  "actuarial-exposure": "read:finance", "actuarial-balance-sheet": "read:finance",
  "insurance-contract-summary": "read:finance", "collection-efficiency": "read:finance",
  "data-integrity": "read:report",
  // ── Claims / funerals / fleet ──
  "claims": "read:claim", "claims-aging": "read:claim", "claims-analytics": "read:claim",
  "funerals": "read:funeral_ops", "fleet": "read:fleet",
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

/** Human-readable report title for the PDF header / filename. Falls back to a title-cased slug. */
export function reportExportLabel(type: string): string {
  const LABELS: Record<string, string> = {
    "policy-details": "Policy Report — Full Details",
    "active-policies": "Active Policies",
    "awaiting-payments": "Policies Awaiting Payment",
    "overdue": "Overdue Policies (In Grace)",
    "pre-lapse": "Pre-Lapse Policies",
    "lapsed": "Lapsed Policies",
    "new-joinings": "New Joinings",
    "finance": "Finance Report",
    "underwriter-payable": "Underwriter Payable",
    "receipts": "Policy Receipts Report",
    "payments": "Payment Transactions",
    "expenditures": "Expenditure Report",
    "cashups": "Daily Cash-Ups",
    "claims": "Claims Report",
    "commission-payments": "Commission by Payment",
    "commissions": "Monthly Commission Summary",
    "agent-portfolio": "Agent Portfolio",
    "agent-productivity": "Agent Productivity",
    "arrears-breakdown": "Arrears Breakdown (with Aging)",
    "outstanding-payments": "Clients with Outstanding Payments",
    "audit-trail": "Audit Trail",
    "receipt-amendments": "Receipt Amendments & Deletions",
    "irp5-reconciliation": "Payroll Tax Reconciliation (ITF16)",
    "complaint-report": "Complaints Report",
    "branch-report": "Branch Report",
    "reinstatements": "Reinstated Policies",
    "conversions": "Policy Conversions",
    "activations": "Policy Activations",
    "data-integrity": "Data Integrity — Exceptions",
    "collection-efficiency": "Premium Collection Efficiency",
    "persistency": "Persistency by Inception Cohort",
    "lapse-analysis": "Lapse & Reinstatement Analysis",
    "member-movement": "Member / Dependant Movement",
    "claims-aging": "Claims Aging",
    "claims-analytics": "Claims Loss Ratio & Repudiation",
  };
  return LABELS[type] || type.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

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
