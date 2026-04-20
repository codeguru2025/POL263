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
  { name: "read:organization", description: "View organization settings", category: "organization" },
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
  { name: "delete:policy", description: "Permanently delete policies", category: "policy" },
  { name: "read:claim", description: "View claims", category: "claims" },
  { name: "write:claim", description: "Create/adjudicate claims", category: "claims" },
  { name: "approve:claim", description: "Approve/reject claims (maker-checker)", category: "claims" },
  { name: "read:client", description: "View clients", category: "clients" },
  { name: "write:client", description: "Create/edit clients", category: "clients" },
  { name: "view:own_clients", description: "View only own assigned clients", category: "clients" },
  { name: "view:all_clients", description: "View all clients in organization", category: "clients" },
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
  { name: "edit:payment", description: "Edit payment transactions", category: "finance" },
  { name: "edit:receipt", description: "Edit payment receipts", category: "finance" },
  { name: "backdate:payment", description: "Backdate payment value dates", category: "finance" },
  { name: "receipt:cash", description: "Create cash payment receipts", category: "finance" },
  { name: "receipt:mobile", description: "Create mobile money receipts", category: "finance" },
  { name: "receipt:transfer", description: "Create bank transfer receipts", category: "finance" },
  { name: "receipt:group", description: "Create group receipts", category: "finance" },
  { name: "read:fleet", description: "View fleet", category: "fleet" },
  { name: "write:fleet", description: "Manage fleet", category: "fleet" },
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
  { name: "manage:approvals", description: "Handle maker-checker approvals", category: "approvals" },
  { name: "create:tenant", description: "Add new tenants (organizations)", category: "platform" },
  { name: "delete:tenant", description: "Remove tenants (organizations)", category: "platform" },
];

export const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  superuser: [],
  executive: [
    "read:organization", "read:branch", "read:user", "read:role", "read:audit_log",
    "read:policy", "read:claim", "read:client", "read:product", "read:funeral_ops",
    "read:finance", "read:fleet", "read:commission", "read:payroll", "read:report",
    "read:lead", "read:notification",
  ],
  manager: [
    "read:organization", "read:branch", "write:branch", "read:user", "write:user",
    "read:role", "read:audit_log", "read:policy", "write:policy", "read:claim",
    "write:claim", "approve:claim", "read:client", "write:client", "read:product",
    "write:product", "manage:settings",
    "read:funeral_ops", "write:funeral_ops", "read:finance", "read:fleet", "write:fleet",
    "read:commission", "read:report", "write:report", "read:lead", "write:lead",
    "read:notification", "manage:approvals",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "view:all_clients",
  ],
  administrator: [
    "read:organization", "write:organization", "read:branch", "write:branch",
    "read:user", "write:user", "delete:user", "read:role", "write:role",
    "manage:permissions", "read:audit_log", "read:policy", "write:policy",
    "read:claim", "write:claim", "approve:claim", "read:client", "write:client",
    "read:product", "write:product", "manage:settings", "read:funeral_ops",
    "write:funeral_ops", "read:finance", "write:finance", "approve:finance",
    "read:fleet", "write:fleet", "read:commission", "write:commission",
    "read:payroll", "write:payroll", "read:report", "write:report",
    "read:lead", "write:lead", "read:notification", "write:notification",
    "manage:approvals", "backdate:payment",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "view:own_clients", "view:all_clients",
    "delete:policy", "delete:payment", "delete:receipt", "edit:payment", "edit:receipt",
  ],
  cashier: [
    "read:policy", "read:client", "read:finance", "write:finance", "read:report",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
  ],
  agent: [
    "read:policy", "write:policy", "read:client", "write:client", "read:product",
    "read:lead", "write:lead", "read:commission", "read:report",
    "read:finance", "receipt:cash",
  ],
  claims_officer: [
    "read:policy", "read:claim", "write:claim", "approve:claim", "read:client",
    "read:funeral_ops", "write:funeral_ops", "read:finance", "read:report",
  ],
  fleet_ops: [
    "read:fleet", "write:fleet", "read:funeral_ops", "write:funeral_ops", "read:report",
  ],
  staff: [
    "read:organization", "read:branch", "read:policy", "read:claim",
    "read:client", "read:product", "read:funeral_ops", "read:report",
  ],
};
