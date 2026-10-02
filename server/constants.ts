/**
 * Platform owner — the highest authority in the system. This account owns the
 * POL263 platform itself (above tenant superusers). It always receives every
 * permission plus platform-level powers: create:tenant, delete:tenant,
 * manage:whitelabel. Tenant superusers only have full access *within* their
 * own tenant. The platform owner can access and manage all tenants.
 *
 * In production, SUPERUSER_EMAIL must be set (e.g. in DigitalOcean app env).
 * In development, falls back to a default if not set.
 */
function getPlatformOwnerEmail(): string {
  const env = process.env.SUPERUSER_EMAIL?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!env) {
      throw new Error("SUPERUSER_EMAIL must be set in production. Set it in your platform environment (e.g. DigitalOcean app env).");
    }
    return env;
  }
  return env || "ausiziba@gmail.com";
}

export const PLATFORM_OWNER_EMAIL = getPlatformOwnerEmail();

/** @deprecated alias kept for backward compat — use PLATFORM_OWNER_EMAIL */
export const PLATFORM_SUPERUSER_EMAIL = PLATFORM_OWNER_EMAIL;

export const SYSTEM_PERMISSIONS = [
  { name: "read:organization", description: "No effect — everyone signed in can see the company's name and branding. Kept so older roles still load.", category: "organization" },
  { name: "write:organization", description: "Edit organization settings", category: "organization" },
  { name: "read:branch", description: "View branches", category: "organization" },
  { name: "write:branch", description: "Create/edit branches", category: "organization" },
  { name: "read:user", description: "View users", category: "identity" },
  { name: "write:user", description: "Create/edit users", category: "identity" },
  { name: "delete:user", description: "Deactivate users", category: "identity" },
  { name: "read:role", description: "View roles", category: "rbac" },
  { name: "write:role", description: "Create/edit roles", category: "rbac" },
  { name: "manage:permissions", description: "Manage role-permission mappings", category: "rbac" },
  { name: "read:audit_log", description: "View audit logs", category: "audit" },
  { name: "read:policy", description: "View policies", category: "policy" },
  { name: "write:policy", description: "Create/edit policies", category: "policy" },
  { name: "edit:premium", description: "Manually override the auto-calculated premium", category: "policy" },
  { name: "delete:policy", description: "Permanently delete policies", category: "policy" },
  { name: "read:claim", description: "View claims", category: "claims" },
  { name: "write:claim", description: "Create/adjudicate claims", category: "claims" },
  { name: "approve:claim", description: "Approve/reject claims (maker-checker)", category: "claims" },
  { name: "read:client", description: "View clients", category: "clients" },
  { name: "write:client", description: "Create/edit clients", category: "clients" },
  { name: "view:own_clients", description: "No effect on its own — someone with the Agent role already sees only their own clients. Kept so older roles still load.", category: "clients" },
  { name: "view:all_clients", description: "See every client and policy. Without it, someone with the Agent role sees only the clients and policies they sold.", category: "clients" },
  { name: "read:product", description: "View products", category: "product" },
  { name: "write:product", description: "Create/edit products", category: "product" },
  { name: "manage:settings", description: "Manage tenant settings", category: "settings" },
  { name: "read:funeral_ops", description: "View funeral operations", category: "operations" },
  { name: "write:funeral_ops", description: "Manage funeral cases", category: "operations" },
  { name: "read:finance", description: "View financial records", category: "finance" },
  { name: "write:finance", description: "Create financial entries", category: "finance" },
  { name: "approve:finance", description: "Approve financial actions (maker-checker)", category: "finance" },
  { name: "delete:payment", description: "Delete payment transactions", category: "finance" },
  { name: "delete:receipt", description: "Delete payment receipts", category: "finance" },
  { name: "create:requisition", description: "Raise requisitions (ask for money to be spent) and submit them; approving and paying stay with finance", category: "finance" },
  { name: "delete:requisition", description: "Permanently delete requisitions (and any linked disbursement)", category: "finance" },
  { name: "delete:expenditure", description: "Permanently delete expenditures (and any linked disbursement)", category: "finance" },
  { name: "edit:payment", description: "Edit payment transactions", category: "finance" },
  { name: "edit:receipt", description: "Edit payment receipts", category: "finance" },
  { name: "backdate:payment", description: "Backdate payment value dates", category: "finance" },
  { name: "receipt:cash", description: "Create cash payment receipts", category: "finance" },
  { name: "receipt:mobile", description: "Create mobile money receipts", category: "finance" },
  { name: "receipt:transfer", description: "Create bank transfer receipts", category: "finance" },
  { name: "receipt:group", description: "Create group receipts", category: "finance" },
  { name: "read:fleet", description: "View fleet", category: "fleet" },
  { name: "write:fleet", description: "Manage fleet", category: "fleet" },
  { name: "use:fleet", description: "Check out/return a company vehicle and report GPS location while driving it", category: "fleet" },
  { name: "read:commission", description: "View commissions", category: "commission" },
  { name: "write:commission", description: "Manage commissions", category: "commission" },
  { name: "read:payroll", description: "View payroll", category: "payroll" },
  { name: "write:payroll", description: "Run payroll", category: "payroll" },
  { name: "read:report", description: "View reports", category: "reports" },
  { name: "write:report", description: "Generate/export reports", category: "reports" },
  { name: "read:lead", description: "View leads/pipeline", category: "leads" },
  { name: "write:lead", description: "Manage leads", category: "leads" },
  { name: "read:notification", description: "View notifications", category: "notifications" },
  { name: "write:notification", description: "Manage notification templates", category: "notifications" },
  // manage:approvals is retained (not deleted) so existing role_permissions rows referencing
  // it don't dangle, but no route checks it anymore — split into the three below so approval
  // rights can be granted per-domain instead of all-or-nothing.
  { name: "manage:approvals", description: "(Legacy — superseded by approve:waivers/approve:settlements/approve:requests)", category: "approvals" },
  { name: "approve:waivers", description: "Resolve waiting-period waiver requests", category: "approvals" },
  { name: "approve:settlements", description: "Approve platform-fee settlements", category: "approvals" },
  { name: "approve:requests", description: "Resolve generic maker-checker requests — policy/receipt/quote deletion, claim review, quotation authorization", category: "approvals" },
  { name: "create:tenant", description: "Add new tenants (organizations)", category: "platform" },
  { name: "delete:tenant", description: "Remove tenants (organizations)", category: "platform" },
  { name: "write:group", description: "Set up and manage groups / burial societies (members, agent, payout rules, add-ons)", category: "policy" },
  { name: "use:ai", description: "Use AI-powered insights and note assistance", category: "ai" },
  { name: "manage:attendance", description: "Create/manage QR attendance kiosks", category: "attendance" },
];

/**
 * Built-in role templates. The startup role sync (server/index.ts → seedOrgRoles) resets every
 * system role in every tenant to this map on each boot, so a change here is applied everywhere
 * on the next deploy (hand edits to system roles are overwritten).
 *
 * Principles (reviewed with Augustus, 2026-09-30):
 *  - Least privilege: each role gets what its job needs and nothing else.
 *  - Segregation of duties: whoever takes money in can't change it afterwards (finance_manager);
 *    whoever captures a claim can't approve it (claims_officer vs approve:claim holders).
 *  - Company-wide finance (reports, statements, bank, budgets) is read:finance; front-line roles
 *    that only receipt use receipt:* and see their own receipts, not the company's books.
 *  - Agents only reach their own clients/policies/claims/leads (server/agent-scope-guard.ts).
 *  - No tenant role can edit role definitions or permissions (write:role, manage:permissions) —
 *    only the platform owner — so nobody can promote themselves.
 */
export const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  // Owner account: bypasses permission checks entirely.
  superuser: [],

  // Board / directors: see everything, change nothing.
  executive: [
    "read:organization", "read:branch", "read:user", "read:role", "read:audit_log",
    "read:policy", "read:claim", "read:client", "read:product", "read:funeral_ops",
    "read:finance", "read:fleet", "read:commission", "read:payroll", "read:report",
    "read:lead", "read:notification", "use:ai",
  ],

  // Runs the office day to day, including policy members, products and premiums. No changing
  // money after the fact, no finance posting or approvals, no payroll, no commission edits —
  // those are finance_manager's.
  administrator: [
    "read:organization", "write:organization", "read:branch", "write:branch",
    "read:user", "write:user", "delete:user", "read:role",
    "read:audit_log", "read:policy", "write:policy",
    "read:claim", "write:claim", "approve:claim", "read:client", "write:client",
    "read:product", "write:product", "manage:settings", "read:funeral_ops",
    "write:funeral_ops", "read:finance",
    "read:fleet", "write:fleet", "use:fleet", "read:commission",
    "read:report", "write:report",
    "read:lead", "write:lead", "read:notification", "write:notification",
    "approve:requests", "write:group",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "view:own_clients", "view:all_clients",
    "delete:policy", "use:ai", "manage:attendance",
    // Edits members, products and premiums on policies (Augustus, 2026-09-30). An off-premium
    // receipt still waits for a finance_manager (approve:finance) before it counts.
    "edit:premium",
    // Raises and submits their own requisitions (Augustus, 2026-10-02); approving and paying
    // them stays with finance (approve:finance / write:finance).
    "create:requisition",
  ],

  // The money powers: corrections, backdating, premium overrides, posting, approvals, payroll,
  // commissions. Usually held alongside administrator by the owner or accountant.
  finance_manager: [
    "read:organization", "read:branch", "read:user", "read:audit_log",
    "read:policy", "read:client", "read:claim", "read:product", "read:report", "write:report",
    "read:finance", "write:finance", "approve:finance", "approve:settlements", "approve:waivers",
    "approve:requests", "edit:premium", "backdate:payment",
    "edit:payment", "delete:payment", "edit:receipt", "delete:receipt",
    "delete:requisition", "delete:expenditure",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "read:commission", "write:commission", "read:payroll", "write:payroll",
    "read:notification", "view:all_clients", "use:ai",
  ],

  // Branch manager: supervises a branch's sales, claims and funerals. No org settings, pricing,
  // money corrections, finance approvals or payroll.
  manager: [
    "read:organization", "read:branch", "read:user", "write:user", "read:role", "read:audit_log",
    "read:policy", "write:policy", "read:claim", "write:claim", "approve:claim",
    "read:client", "write:client", "view:all_clients", "read:product",
    "read:funeral_ops", "write:funeral_ops", "read:fleet", "write:fleet", "use:fleet",
    "read:finance", "read:commission", "read:report", "write:report",
    "read:lead", "write:lead", "read:notification", "approve:requests", "write:group",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "use:ai", "manage:attendance",
  ],

  // Accounts clerk: captures expenses, requisitions, bank deposits, petty cash. Can't approve,
  // correct or delete money records, and can't see payroll — finance_manager checks their work.
  finance_clerk: [
    "read:organization", "read:branch", "read:policy", "read:client", "read:report",
    "read:finance", "write:finance", "read:commission", "read:notification",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
  ],

  // Takes payments at the counter and cashes up. Sees their own receipts, not the company books.
  cashier: [
    "read:policy", "read:client", "read:report",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
  ],

  // Staff records, attendance and payroll preparation. No policies, clients or other finance.
  // No write:user: creating users means choosing roles, which is an administrator decision.
  hr_officer: [
    "read:organization", "read:branch", "read:user", "read:report",
    "read:payroll", "write:payroll", "manage:attendance",
  ],

  // Front desk / call centre: looks things up, updates contact details, logs complaints and
  // leads, captures claims. No money, no approvals.
  customer_service: [
    "read:organization", "read:branch", "read:policy", "read:client", "write:client",
    "view:all_clients", "read:claim", "write:claim", "read:product",
    "read:lead", "write:lead", "read:funeral_ops", "read:notification",
  ],

  // Sells and services their own book only (agent-scope-guard). Receipts mobile/transfer
  // payments; sees their own commissions. No company finance.
  agent: [
    "read:policy", "write:policy",
    "read:client", "write:client", "view:own_clients",
    "read:product",
    "read:lead", "write:lead",
    "read:commission",
    "read:report",
    "receipt:mobile", "receipt:transfer",
  ],

  // Leads a team of agents: sees every agent's leads, clients, policies and commissions.
  // No finance beyond receipting.
  sales_team_leader: [
    "read:user", "read:policy", "write:policy", "read:client", "write:client", "view:all_clients",
    "read:product", "read:lead", "write:lead", "read:commission", "read:report",
    "read:notification", "receipt:mobile", "receipt:transfer", "use:ai",
  ],

  // Captures and assesses claims. Approval needs someone else with approve:claim.
  claims_officer: [
    "read:policy", "read:claim", "write:claim", "read:client",
    "read:funeral_ops", "write:funeral_ops", "read:report", "use:ai",
  ],

  // Runs funerals, mortuary, fleet and cash-service quotes, and takes service payments.
  funeral_manager: [
    "read:policy", "read:client", "read:claim", "read:product",
    "read:funeral_ops", "write:funeral_ops", "read:fleet", "write:fleet", "use:fleet",
    "receipt:cash", "read:report",
  ],

  fleet_ops: [
    "read:fleet", "write:fleet", "use:fleet", "read:funeral_ops", "write:funeral_ops", "read:report",
  ],
  driver: [
    // Drivers are assigned to funeral removals/burials. They need to see the cases
    // and the fleet they are dispatched with, but not edit them. use:fleet lets them
    // self-service check out/return a vehicle and report GPS while driving it.
    "read:funeral_ops", "read:fleet", "use:fleet",
  ],
  mortuary_attendant: [
    // Mortuary attendants handle the physical care of the deceased: intake,
    // body washing, belongings, and dispatch. They do not access finance or policy.
    "read:funeral_ops", "write:funeral_ops", "read:client", "read:fleet", "use:fleet",
  ],
  staff: [
    "read:organization", "read:branch", "read:policy", "read:claim",
    "read:client", "read:product", "read:funeral_ops", "read:report",
  ],
};
