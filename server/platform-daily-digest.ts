/**
 * Platform daily digest — one email to the platform owner every morning covering EVERYTHING that
 * happened in every tenant the previous day: finance (income statement, cash flow, every
 * receipt), sales (new policies by agent, activations, leads, quotations), policy movements
 * (lapses, reinstatements, cancellations, change of policyholder), claims (new, every status
 * change, ledger deductions), group ledgers, funeral/mortuary operations, approvals, client
 * communications (SMS/email sent, skipped, failed and why), platform fees, and all staff activity
 * (every audit-log entry, attached in full as CSV).
 *
 * Runs once per day across both app instances (scheduler_run_claims). Recipients: the
 * DAILY_DIGEST_EMAILS env var (comma-separated) or, if unset, the platform owner's email.
 * A tenant section that fails to build is reported in the email instead of dropping the email.
 */
import { sql } from "drizzle-orm";
import { storage } from "./storage";
import { getDbForOrg } from "./tenant-db";
import { structuredLog } from "./logger";
import { localToUtcDate, getOrgTimezone } from "./date-utils";
import { claimSchedulerRun } from "./scheduler-claims";
import { sendEmail, escapeHtml } from "./email-service";
import { buildDailyReport } from "./daily-report";
import { PLATFORM_OWNER_EMAIL } from "./constants";

const DEFAULT_TZ = "Africa/Harare";
const SANDBOX_ORG_NAME = "🧪 Sandbox / QA (Test Data — Not Real)";

type Row = Record<string, any>;
type Money = Record<string, number>;

export interface TenantDigest {
  orgId: string;
  orgName: string;
  date: string;
  timezone: string;
  error?: string;
  finance?: { incomeStatement: any; cashFlow: any; ledger: any[] };
  receipts: Row[];
  receiptTotals: { byCurrency: Money; byChannel: Record<string, Money>; byStaff: Record<string, Money>; count: number; pendingApproval: number };
  newClients: number;
  newPolicies: Row[];
  newPoliciesByAgent: Record<string, { count: number; premium: Money }>;
  policiesActivated: Row[];
  policyMovements: Row[];
  holderChanges: Row[];
  leads: Row[];
  quotations: Row[];
  claimsNew: Row[];
  claimMovements: Row[];
  ledgerEntries: Row[];
  funeralCases: Row[];
  mortuaryIntakes: Row[];
  mortuaryDispatches: Row[];
  approvals: { created: number; resolved: number; pending: number; byType: Record<string, number> };
  notifications: { byChannelStatus: Record<string, number>; failures: Row[] };
  platformFees: Money;
  audit: { total: number; byActor: Record<string, number>; byAction: Record<string, number>; rows: Row[] };
  snapshot: { activePolicies: number; gracePolicies: number; lapsedPolicies: number; openClaims: number; overdueClaims: number };
}

function rowsOf(result: unknown): Row[] {
  return ((result as any)?.rows ?? result ?? []) as Row[];
}

function addMoney(m: Money, currency: string | null | undefined, amount: unknown) {
  const n = parseFloat(String(amount ?? "0"));
  if (!Number.isFinite(n)) return;
  const cur = currency || "USD";
  m[cur] = Number(((m[cur] ?? 0) + n).toFixed(2));
}

/** Yesterday's date (YYYY-MM-DD) in the given timezone. */
export function yesterdayIn(tz: string, now: Date = new Date()): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Spreadsheet-safe CSV cell (neutralises formula injection) — same rule as sms-report.ts. */
export function csvCell(value: unknown): string {
  let str = value == null ? "" : value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (/[",\r\n]/.test(str)) str = `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function toCsv(rows: Row[], columns: string[]): string {
  return [columns.join(","), ...rows.map((r) => columns.map((c) => csvCell(r[c])).join(","))].join("\r\n");
}

export async function buildTenantDigest(orgId: string, orgName: string, date: string): Promise<TenantDigest> {
  const timezone = (await getOrgTimezone(orgId).catch(() => DEFAULT_TZ)) || DEFAULT_TZ;
  // The tenant's own calendar day, as UTC instants (timestamps are stored in UTC).
  const start = localToUtcDate(date, "00:00", timezone).toISOString();
  const nextDay = new Date(`${date}T12:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const end = localToUtcDate(nextDay.toISOString().slice(0, 10), "00:00", timezone).toISOString();
  const tdb = await getDbForOrg(orgId);
  const q = async (query: ReturnType<typeof sql>): Promise<Row[]> => rowsOf(await tdb.execute(query));
  const inDay = (col: string) => sql.raw(`${col} >= '${start}' AND ${col} < '${end}'`);

  const digest: TenantDigest = {
    orgId, orgName, date, timezone,
    receipts: [], receiptTotals: { byCurrency: {}, byChannel: {}, byStaff: {}, count: 0, pendingApproval: 0 },
    newClients: 0, newPolicies: [], newPoliciesByAgent: {}, policiesActivated: [], policyMovements: [], holderChanges: [],
    leads: [], quotations: [], claimsNew: [], claimMovements: [], ledgerEntries: [],
    funeralCases: [], mortuaryIntakes: [], mortuaryDispatches: [],
    approvals: { created: 0, resolved: 0, pending: 0, byType: {} },
    notifications: { byChannelStatus: {}, failures: [] },
    platformFees: {},
    audit: { total: 0, byActor: {}, byAction: {}, rows: [] },
    snapshot: { activePolicies: 0, gracePolicies: 0, lapsedPolicies: 0, openClaims: 0, overdueClaims: 0 },
  };

  // Finance + operations (same numbers as the in-app Daily Report page).
  try {
    const daily = await buildDailyReport(orgId, date);
    digest.finance = { incomeStatement: daily.financials.incomeStatement, cashFlow: daily.financials.cashFlow, ledger: daily.financials.ledger?.entries ?? [] };
    digest.policiesActivated = daily.operations.policiesActivated as Row[];
    digest.quotations = daily.operations.quotationsCreated as Row[];
    digest.funeralCases = daily.operations.funeralCasesOpened as Row[];
    digest.mortuaryIntakes = daily.operations.mortuaryIntakes as Row[];
    digest.mortuaryDispatches = daily.operations.mortuaryDispatches as Row[];
  } catch (err: any) {
    digest.error = `Financial statements could not be built: ${err?.message}`;
  }

  digest.receipts = await q(sql`
    SELECT r.receipt_number, r.amount, r.currency, r.payment_channel, r.status, r.approval_status,
           r.created_at, p.policy_number, c.first_name || ' ' || c.last_name AS client,
           coalesce(u.display_name, u.email) AS issued_by, b.name AS branch
    FROM payment_receipts r
    LEFT JOIN policies p ON p.id = r.policy_id
    LEFT JOIN clients c ON c.id = r.client_id
    LEFT JOIN users u ON u.id = r.issued_by_user_id
    LEFT JOIN branches b ON b.id = r.branch_id
    WHERE r.organization_id = ${orgId} AND r.deleted_at IS NULL AND ${inDay("r.created_at")}
    ORDER BY r.created_at`);
  for (const r of digest.receipts) {
    digest.receiptTotals.count++;
    if (r.approval_status === "pending") digest.receiptTotals.pendingApproval++;
    addMoney(digest.receiptTotals.byCurrency, r.currency, r.amount);
    addMoney((digest.receiptTotals.byChannel[r.payment_channel || "unknown"] ??= {}), r.currency, r.amount);
    addMoney((digest.receiptTotals.byStaff[r.issued_by || "System / online"] ??= {}), r.currency, r.amount);
  }

  digest.newClients = Number((await q(sql`SELECT count(*)::int AS n FROM clients WHERE organization_id = ${orgId} AND ${inDay("created_at")}`))[0]?.n ?? 0);

  digest.newPolicies = await q(sql`
    SELECT p.policy_number, p.status, p.currency, coalesce(p.premium_override, p.premium_amount) AS premium,
           p.payment_schedule, p.is_legacy, c.first_name || ' ' || c.last_name AS client,
           pr.name AS product, coalesce(u.display_name, u.email, 'Unassigned') AS agent, b.name AS branch, g.name AS group_name
    FROM policies p
    LEFT JOIN clients c ON c.id = p.client_id
    LEFT JOIN product_versions pv ON pv.id = p.product_version_id
    LEFT JOIN products pr ON pr.id = pv.product_id
    LEFT JOIN users u ON u.id = p.agent_id
    LEFT JOIN branches b ON b.id = p.branch_id
    LEFT JOIN groups g ON g.id = p.group_id
    WHERE p.organization_id = ${orgId} AND ${inDay("p.created_at")}
    ORDER BY p.created_at`);
  for (const p of digest.newPolicies) {
    const a = (digest.newPoliciesByAgent[p.agent] ??= { count: 0, premium: {} });
    a.count++;
    addMoney(a.premium, p.currency, p.premium);
  }

  digest.policyMovements = await q(sql`
    SELECT p.policy_number, h.from_status, h.to_status, h.reason, h.created_at, coalesce(u.display_name, u.email, 'System') AS changed_by
    FROM policy_status_history h
    JOIN policies p ON p.id = h.policy_id
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE p.organization_id = ${orgId} AND ${inDay("h.created_at")}
    ORDER BY h.created_at`);

  digest.holderChanges = await q(sql`
    SELECT p.policy_number, fc.first_name || ' ' || fc.last_name AS from_holder, tc.first_name || ' ' || tc.last_name AS to_holder,
           h.reason, h.created_at, coalesce(u.display_name, u.email) AS changed_by
    FROM policy_holder_changes h
    JOIN policies p ON p.id = h.policy_id
    LEFT JOIN clients fc ON fc.id = h.from_client_id
    LEFT JOIN clients tc ON tc.id = h.to_client_id
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.organization_id = ${orgId} AND ${inDay("h.created_at")}
    ORDER BY h.created_at`).catch(() => []);

  digest.leads = await q(sql`
    SELECT l.first_name || ' ' || l.last_name AS name, l.stage, l.source, l.product_interest, l.created_at,
           coalesce(u.display_name, u.email, 'Unassigned') AS agent
    FROM leads l LEFT JOIN users u ON u.id = l.agent_id
    WHERE l.organization_id = ${orgId} AND ${inDay("l.created_at")}
    ORDER BY l.created_at`);

  digest.claimsNew = await q(sql`
    SELECT cl.claim_number, cl.claim_type, cl.status, cl.deceased_name, cl.deceased_relationship, cl.cash_in_lieu_amount, cl.currency,
           p.policy_number, g.name AS group_name
    FROM claims cl JOIN policies p ON p.id = cl.policy_id LEFT JOIN groups g ON g.id = cl.group_id
    WHERE cl.organization_id = ${orgId} AND ${inDay("cl.created_at")}
    ORDER BY cl.created_at`);

  digest.claimMovements = await q(sql`
    SELECT cl.claim_number, cl.deceased_name, h.from_status, h.to_status, h.reason, h.created_at,
           coalesce(u.display_name, u.email, 'Client / system') AS changed_by
    FROM claim_status_history h
    JOIN claims cl ON cl.id = h.claim_id
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE cl.organization_id = ${orgId} AND ${inDay("h.created_at")} AND h.from_status IS NOT NULL
    ORDER BY h.created_at`);

  digest.ledgerEntries = await q(sql`
    SELECT g.name AS group_name, e.entry_type, e.amount, e.currency, e.description, e.created_at
    FROM group_ledger_entries e JOIN groups g ON g.id = e.group_id
    WHERE e.organization_id = ${orgId} AND ${inDay("e.created_at")}
    ORDER BY e.created_at`);

  const approvalRows = await q(sql`
    SELECT request_type, status,
           (${inDay("created_at")}) AS created_today,
           (resolved_at IS NOT NULL AND ${inDay("resolved_at")}) AS resolved_today
    FROM approval_requests WHERE organization_id = ${orgId}
      AND (status = 'pending' OR ${inDay("created_at")} OR (resolved_at IS NOT NULL AND ${inDay("resolved_at")}))`);
  for (const a of approvalRows) {
    if (a.created_today) { digest.approvals.created++; digest.approvals.byType[a.request_type] = (digest.approvals.byType[a.request_type] ?? 0) + 1; }
    if (a.resolved_today) digest.approvals.resolved++;
    if (a.status === "pending") digest.approvals.pending++;
  }

  for (const n of await q(sql`
    SELECT channel, status, count(*)::int AS n FROM notification_logs
    WHERE organization_id = ${orgId} AND ${inDay("created_at")} GROUP BY channel, status`)) {
    digest.notifications.byChannelStatus[`${n.channel} · ${n.status}`] = n.n;
  }
  digest.notifications.failures = await q(sql`
    SELECT channel, status, failure_reason, count(*)::int AS n FROM notification_logs
    WHERE organization_id = ${orgId} AND ${inDay("created_at")} AND status IN ('failed', 'skipped')
    GROUP BY channel, status, failure_reason ORDER BY n DESC LIMIT 20`);

  for (const f of await q(sql`
    SELECT currency, sum(amount) AS total FROM platform_receivables
    WHERE organization_id = ${orgId} AND ${inDay("created_at")} GROUP BY currency`)) {
    addMoney(digest.platformFees, f.currency, f.total);
  }

  digest.audit.rows = await q(sql`
    SELECT timestamp, coalesce(actor_email, 'system') AS actor, action, entity_type, entity_id, ip_address
    FROM audit_logs WHERE organization_id = ${orgId} AND ${inDay("timestamp")}
    ORDER BY timestamp`);
  digest.audit.total = digest.audit.rows.length;
  for (const a of digest.audit.rows) {
    digest.audit.byActor[a.actor] = (digest.audit.byActor[a.actor] ?? 0) + 1;
    digest.audit.byAction[a.action] = (digest.audit.byAction[a.action] ?? 0) + 1;
  }

  const snap = (await q(sql`
    SELECT
      (SELECT count(*)::int FROM policies WHERE organization_id = ${orgId} AND status = 'active') AS active,
      (SELECT count(*)::int FROM policies WHERE organization_id = ${orgId} AND status = 'grace') AS grace,
      (SELECT count(*)::int FROM policies WHERE organization_id = ${orgId} AND status = 'lapsed') AS lapsed,
      (SELECT count(*)::int FROM claims WHERE organization_id = ${orgId} AND status NOT IN ('rejected', 'closed', 'paid', 'completed')) AS open_claims,
      (SELECT count(*)::int FROM claims WHERE organization_id = ${orgId} AND status IN ('submitted', 'verified', 'under_investigation') AND created_at < now() - interval '5 days') AS overdue_claims
  `))[0] ?? {};
  digest.snapshot = {
    activePolicies: snap.active ?? 0, gracePolicies: snap.grace ?? 0, lapsedPolicies: snap.lapsed ?? 0,
    openClaims: snap.open_claims ?? 0, overdueClaims: snap.overdue_claims ?? 0,
  };
  return digest;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

const money = (m: Money | undefined) => {
  const entries = Object.entries(m ?? {}).filter(([, v]) => Math.abs(v) >= 0.005);
  return entries.length ? entries.map(([c, v]) => `${c} ${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(" · ") : "0.00";
};
const e = escapeHtml;
const fmtTime = (v: any, tz: string) => {
  if (!v) return "";
  const d = new Date(typeof v === "string" && !/[zZ]|[+-]\d\d:?\d\d$/.test(v) ? `${v}Z` : v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleTimeString("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
};

function table(headers: string[], rows: (string | number | null | undefined)[][], emptyText = "None"): string {
  if (!rows.length) return `<p style="color:#6b7280;margin:4px 0 12px">${e(emptyText)}</p>`;
  return `<table style="border-collapse:collapse;width:100%;font-size:12px;margin:4px 0 14px">
<thead><tr>${headers.map((h) => `<th style="text-align:left;border-bottom:2px solid #e5e7eb;padding:4px 6px;background:#f9fafb">${e(h)}</th>`).join("")}</tr></thead>
<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td style="border-bottom:1px solid #f1f5f9;padding:4px 6px;vertical-align:top">${e(c ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
const h3 = (t: string) => `<h3 style="font-size:14px;margin:18px 0 4px;color:#111827">${e(t)}</h3>`;
const kv = (pairs: [string, string | number][]) =>
  `<table style="font-size:12px;margin:4px 0 12px">${pairs.map(([k, v]) => `<tr><td style="color:#6b7280;padding:2px 12px 2px 0">${e(k)}</td><td style="font-weight:600">${e(v)}</td></tr>`).join("")}</table>`;

function renderTenant(d: TenantDigest): string {
  const tz = d.timezone;
  const is = d.finance?.incomeStatement;
  const cf = d.finance?.cashFlow;
  const parts: string[] = [];
  parts.push(`<h2 style="font-size:18px;margin:28px 0 6px;padding-top:12px;border-top:3px solid #111827">${e(d.orgName)}</h2>`);
  if (d.error) parts.push(`<p style="color:#b91c1c">${e(d.error)}</p>`);

  parts.push(h3("At a glance"));
  parts.push(kv([
    ["Money received (receipts)", `${money(d.receiptTotals.byCurrency)} — ${d.receiptTotals.count} receipt(s)${d.receiptTotals.pendingApproval ? `, ${d.receiptTotals.pendingApproval} waiting for approval` : ""}`],
    ["New policies", `${d.newPolicies.length} (${d.policiesActivated.length} started cover today)`],
    ["New clients", d.newClients],
    ["New leads", d.leads.length],
    ["Claims logged / decisions", `${d.claimsNew.length} new · ${d.claimMovements.length} status change(s)`],
    ["Approvals", `${d.approvals.created} new · ${d.approvals.resolved} dealt with · ${d.approvals.pending} still waiting`],
    ["Messages to clients", Object.entries(d.notifications.byChannelStatus).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"],
    ["Platform fees owed to POL263", money(d.platformFees)],
    ["Staff actions recorded", d.audit.total],
    ["Book today", `${d.snapshot.activePolicies} active · ${d.snapshot.gracePolicies} in grace · ${d.snapshot.lapsedPolicies} lapsed · ${d.snapshot.openClaims} open claims (${d.snapshot.overdueClaims} open more than 5 days)`],
  ]));

  if (is) {
    parts.push(h3("Income statement"));
    parts.push(kv([
      ["Premiums — individual", money(is.income?.premiumIndividual)],
      ["Premiums — group", money(is.income?.premiumGroup)],
      ["Cash services (funerals etc.)", money(is.income?.cashServices)],
      ["Legacy group income", money(is.income?.legacyGroupIncome)],
      ["Total income", money(is.income?.total)],
      ...((is.expenses?.lines ?? []) as any[]).map((l: any) => [`Expense — ${l.label ?? l.category ?? l.name ?? "other"}`, money(l.amounts)] as [string, string]),
      ["Total expenses", money(is.expenses?.total)],
      ["Net", money(is.net)],
      ["Net (all currencies in USD)", is.consolidatedUsd ? `USD ${Number(is.consolidatedUsd.net).toFixed(2)}${is.consolidatedUsd.unconvertible?.length ? ` (no rate for ${is.consolidatedUsd.unconvertible.join(", ")})` : ""}` : "—"],
    ]));
  }
  if (cf) {
    parts.push(h3("Cash flow"));
    parts.push(kv([
      ...Object.entries(cf.inflowsByChannel ?? {}).map(([ch, m]) => [`Cash in — ${ch}`, money(m as Money)] as [string, string]),
      ["Total cash in", money(cf.cashIn)],
      ["Paid out — requisitions", money(cf.outflows?.requisitions)],
      ["Paid out — expenditures", money(cf.outflows?.expenditures)],
      ["Paid out — commissions", money(cf.outflows?.commissions)],
      ["Total cash out", money(cf.outflows?.total)],
      ["Net cash", money(cf.netCash)],
      ["Bank deposits", `${money(cf.bankDeposits?.total)} (${cf.bankDeposits?.count ?? 0})`],
      ["Cash-ups", (cf.cashups ?? []).map((c: any) => `${c.currency} ${c.totalAmount} (${c.status}${c.discrepancyAmount && Number(c.discrepancyAmount) !== 0 ? `, discrepancy ${c.discrepancyAmount}` : ""})`).join("; ") || "none"],
    ]));
  }

  parts.push(h3("Receipts by staff member"));
  parts.push(table(["Staff", "Amount"], Object.entries(d.receiptTotals.byStaff).map(([k, v]) => [k, money(v)])));
  parts.push(h3("Receipts by payment method"));
  parts.push(table(["Method", "Amount"], Object.entries(d.receiptTotals.byChannel).map(([k, v]) => [k, money(v)])));
  parts.push(h3(`Every receipt (${d.receipts.length})`));
  parts.push(table(["Time", "Receipt", "Policy", "Client", "Amount", "Method", "By", "Approval"],
    d.receipts.map((r) => [fmtTime(r.created_at, tz), r.receipt_number, r.policy_number, r.client, `${r.currency} ${r.amount}`, r.payment_channel, r.issued_by ?? "online", r.approval_status ?? r.status])));

  parts.push(h3("Sales by agent"));
  parts.push(table(["Agent", "New policies", "Premium written"], Object.entries(d.newPoliciesByAgent).map(([k, v]) => [k, v.count, money(v.premium)])));
  parts.push(h3(`New policies (${d.newPolicies.length})`));
  parts.push(table(["Policy", "Client", "Product", "Premium", "Agent", "Branch", "Group", "Status"],
    d.newPolicies.map((p) => [p.policy_number, p.client, p.product, `${p.currency} ${p.premium} ${p.payment_schedule ?? ""}`, p.agent, p.branch, p.group_name, p.status])));
  parts.push(h3(`Policies whose cover started (${d.policiesActivated.length})`));
  parts.push(table(["Policy", "Client", "Premium"], d.policiesActivated.map((p) => [p.policyNumber, `${p.clientFirstName ?? ""} ${p.clientLastName ?? ""}`, `${p.currency} ${p.premiumAmount}`])));
  parts.push(h3(`Policy status changes (${d.policyMovements.length})`));
  parts.push(table(["Time", "Policy", "From", "To", "Why", "By"], d.policyMovements.map((m) => [fmtTime(m.created_at, tz), m.policy_number, m.from_status, m.to_status, m.reason, m.changed_by])));
  if (d.holderChanges.length) {
    parts.push(h3(`Change of policyholder (${d.holderChanges.length})`));
    parts.push(table(["Time", "Policy", "From", "To", "Why", "By"], d.holderChanges.map((m) => [fmtTime(m.created_at, tz), m.policy_number, m.from_holder, m.to_holder, m.reason, m.changed_by])));
  }
  parts.push(h3(`New leads (${d.leads.length})`));
  parts.push(table(["Name", "Stage", "Source", "Interested in", "Agent"], d.leads.map((l) => [l.name, l.stage, l.source, l.product_interest, l.agent])));
  parts.push(h3(`Quotations (${d.quotations.length})`));
  parts.push(table(["Quote", "Deceased", "Total", "Status"], d.quotations.map((q) => [q.quotationNumber, q.deceasedName, `${q.currency} ${q.grandTotal}`, q.status])));

  parts.push(h3(`Claims logged (${d.claimsNew.length})`));
  parts.push(table(["Claim", "Policy", "Deceased", "Type", "Amount", "Group", "Status"],
    d.claimsNew.map((c) => [c.claim_number, c.policy_number, `${c.deceased_name ?? ""}${c.deceased_relationship ? ` (${c.deceased_relationship})` : ""}`, c.claim_type, c.cash_in_lieu_amount ? `${c.currency} ${c.cash_in_lieu_amount}` : "", c.group_name, c.status])));
  parts.push(h3(`Claim decisions & status changes (${d.claimMovements.length})`));
  parts.push(table(["Time", "Claim", "Deceased", "From", "To", "Notes", "By"], d.claimMovements.map((m) => [fmtTime(m.created_at, tz), m.claim_number, m.deceased_name, m.from_status, m.to_status, m.reason, m.changed_by])));
  parts.push(h3(`Group ledger movements (${d.ledgerEntries.length})`));
  parts.push(table(["Time", "Group", "Type", "Amount", "Details"], d.ledgerEntries.map((l) => [fmtTime(l.created_at, tz), l.group_name, l.entry_type.replace(/_/g, " "), `${l.currency} ${l.amount}`, l.description])));

  if (d.funeralCases.length || d.mortuaryIntakes.length || d.mortuaryDispatches.length) {
    parts.push(h3("Funerals & mortuary"));
    parts.push(table(["Case", "Deceased", "Service", "Burial date", "Status"], d.funeralCases.map((f) => [f.caseNumber, f.deceasedName, f.serviceType, f.funeralDate, f.status]), "No new funeral cases"));
    parts.push(table(["Mortuary intake", "Deceased", "Scope", "Status"], d.mortuaryIntakes.map((m) => [m.intakeNumber, m.deceasedName, m.serviceScope, m.status]), "No mortuary intakes"));
    parts.push(table(["Dispatched to", "Collected by", "Time"], d.mortuaryDispatches.map((m) => [m.destination, m.collectedByName, fmtTime(m.dispatchedAt, tz)]), "No mortuary dispatches"));
  }

  parts.push(h3("Messages that did not go out"));
  parts.push(table(["Channel", "Result", "Reason", "Count"], d.notifications.failures.map((f) => [f.channel, f.status, f.failure_reason, f.n]), "Every message went out"));

  parts.push(h3(`Staff activity (${d.audit.total} recorded actions — full list attached)`));
  parts.push(table(["Staff member", "Actions"], Object.entries(d.audit.byActor).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v])));
  parts.push(table(["Action", "Count"], Object.entries(d.audit.byAction).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k.replace(/_/g, " ").toLowerCase(), v])));
  return parts.join("\n");
}

export function renderDigestHtml(date: string, digests: TenantDigest[], failures: { orgName: string; error: string }[]): string {
  const totalIn: Money = {};
  for (const d of digests) for (const [c, v] of Object.entries(d.receiptTotals.byCurrency)) addMoney(totalIn, c, v);
  const totals = kv([
    ["Tenants", digests.length],
    ["Money received, all tenants", money(totalIn)],
    ["New policies, all tenants", digests.reduce((s, d) => s + d.newPolicies.length, 0)],
    ["Claims logged, all tenants", digests.reduce((s, d) => s + d.claimsNew.length, 0)],
    ["Staff actions, all tenants", digests.reduce((s, d) => s + d.audit.total, 0)],
  ]);
  return `<!doctype html><html><body style="font-family:Segoe UI,Arial,sans-serif;color:#111827;max-width:1000px;margin:0 auto;padding:16px">
<h1 style="font-size:22px;margin:0 0 4px">POL263 daily report — ${e(date)}</h1>
<p style="color:#6b7280;margin:0 0 12px">Everything that happened on the platform yesterday, per company. The full list of every recorded staff action and every receipt is attached as spreadsheets.</p>
${totals}
${failures.length ? `<p style="color:#b91c1c">Could not build the report for: ${failures.map((f) => `${e(f.orgName)} (${e(f.error)})`).join("; ")}</p>` : ""}
${digests.map(renderTenant).join("\n")}
</body></html>`;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "tenant";
}

export function buildDigestAttachments(digests: TenantDigest[]): { filename: string; content: string; contentType: string }[] {
  const out: { filename: string; content: string; contentType: string }[] = [];
  for (const d of digests) {
    const s = slug(d.orgName);
    out.push({ filename: `${s}-${d.date}-staff-activity.csv`, contentType: "text/csv", content: "﻿" + toCsv(d.audit.rows, ["timestamp", "actor", "action", "entity_type", "entity_id", "ip_address"]) });
    out.push({ filename: `${s}-${d.date}-receipts.csv`, contentType: "text/csv", content: "﻿" + toCsv(d.receipts, ["created_at", "receipt_number", "policy_number", "client", "amount", "currency", "payment_channel", "issued_by", "branch", "status", "approval_status"]) });
    if (d.finance?.ledger?.length) {
      out.push({ filename: `${s}-${d.date}-transaction-ledger.csv`, contentType: "text/csv", content: "﻿" + toCsv(d.finance.ledger, ["date", "type", "source", "description", "reference", "person", "department", "amount", "currency"]) });
    }
    if (d.newPolicies.length) {
      out.push({ filename: `${s}-${d.date}-new-policies.csv`, contentType: "text/csv", content: "﻿" + toCsv(d.newPolicies, ["policy_number", "client", "product", "premium", "currency", "payment_schedule", "agent", "branch", "group_name", "status", "is_legacy"]) });
    }
  }
  return out;
}

export function digestRecipients(): string[] {
  const fromEnv = (process.env.DAILY_DIGEST_EMAILS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : [PLATFORM_OWNER_EMAIL];
}

export interface DigestRunResult {
  date: string;
  sent: boolean;
  skippedAlreadySent?: boolean;
  tenants: number;
  failures: { orgName: string; error: string }[];
  recipients: string[];
  message?: string;
}

/** Build the whole digest (no sending) — used by the preview endpoint and by runPlatformDailyDigest. */
export async function buildPlatformDigest(date: string) {
  const orgs = (await storage.getOrganizations()).filter((o: any) => o.name !== SANDBOX_ORG_NAME);
  const digests: TenantDigest[] = [];
  const failures: { orgName: string; error: string }[] = [];
  for (const org of orgs) {
    try {
      digests.push(await buildTenantDigest(org.id, org.name, date));
    } catch (err: any) {
      failures.push({ orgName: org.name, error: err?.message ?? "unknown error" });
      structuredLog("error", "Daily digest: tenant section failed", { orgId: org.id, error: err?.message });
    }
  }
  return { digests, failures, html: renderDigestHtml(date, digests, failures) };
}

export async function runPlatformDailyDigest(trigger: "scheduler" | "manual", date?: string): Promise<DigestRunResult> {
  const reportDate = date || yesterdayIn(process.env.DAILY_DIGEST_TIMEZONE || DEFAULT_TZ);
  const recipients = digestRecipients();
  // Once per date across both instances; a manual send always goes out (it's a deliberate click).
  if (trigger === "scheduler" && !(await claimSchedulerRun("platform-daily-digest", reportDate))) {
    return { date: reportDate, sent: false, skippedAlreadySent: true, tenants: 0, failures: [], recipients };
  }
  const { digests, failures, html } = await buildPlatformDigest(reportDate);
  const result = await sendEmail({
    to: recipients.join(", "),
    fromName: "POL263",
    subject: `POL263 daily report — ${reportDate}`,
    text: `POL263 daily report for ${reportDate}. Open this email in an HTML-capable mail app; full spreadsheets are attached.`,
    html,
    attachments: buildDigestAttachments(digests),
  } as any);
  structuredLog(result.ok ? "info" : "error", "Platform daily digest", { trigger, date: reportDate, tenants: digests.length, failures: failures.length, ok: result.ok, message: result.message });
  return { date: reportDate, sent: result.ok, tenants: digests.length, failures, recipients, message: result.message };
}

let digestTimer: ReturnType<typeof setTimeout> | null = null;

/** Daily at 04:30 UTC (06:30 in Harare) — after the lapse sweep (04:00) has moved yesterday's policies. */
export function startPlatformDailyDigestScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const next = new Date(now);
    next.setUTCHours(4, 30, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    digestTimer = setTimeout(async () => {
      try {
        await runPlatformDailyDigest("scheduler");
      } catch (err) {
        structuredLog("error", "Platform daily digest run threw", { error: (err as Error).message });
      }
      scheduleNext();
    }, next.getTime() - now.getTime());
  };
  scheduleNext();
}

export function stopPlatformDailyDigestScheduler(): void {
  if (digestTimer) clearTimeout(digestTimer);
  digestTimer = null;
}
