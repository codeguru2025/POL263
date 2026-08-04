/**
 * Reusable tenant data-migration logic: copies one tenant's rows from the shared platform
 * database to a dedicated destination database, verifies row counts match, and cuts over
 * control-plane routing. Extracted from script/commission-tenant-db.ts (the original,
 * still-working manual admin workflow, which now calls these same functions instead of
 * duplicating this logic) so server/tenant-db-commissioning.ts's automatic trigger can reuse
 * the identical, already-proven copy/verify/cutover logic rather than reimplementing it.
 *
 * IMPORTANT: buildTenantCopyPlan's table list must stay in sync with shared/schema.ts, exactly
 * as commission-tenant-db.ts always required — if a new org-scoped table is added to the schema,
 * add it here too (in FK-dependency order) or a future tenant's data for that table will
 * silently not migrate.
 */
import pg from "pg";
import { eq } from "drizzle-orm";
import { tenantDatabases } from "@shared/control-plane-schema";
import { applyPendingMigrations } from "./migrate-tenant-db";
import { cpDb as defaultCpDb } from "./control-plane-db";

type CpDb = typeof defaultCpDb;

const BATCH_SIZE = 500;

async function rowCount(pool: pg.Pool, table: string, where = ""): Promise<number> {
  const q = where ? `SELECT COUNT(*) FROM ${table} WHERE ${where}` : `SELECT COUNT(*) FROM ${table}`;
  const r = await pool.query(q);
  return parseInt(r.rows[0].count, 10);
}

/** Parameterized version of commission-tenant-db.ts's copyTable — same logic, pools passed in. */
export async function copyTenantTable(
  src: pg.Pool,
  dst: pg.Pool,
  table: string,
  where: string | null,
  opts: { dryRun: boolean; batchSize?: number },
): Promise<{ table: string; copied: number; total: number }> {
  const batchSize = opts.batchSize ?? BATCH_SIZE;
  const whereClause = where ? `WHERE ${where}` : "";
  const total = await rowCount(src, table, where ?? "");

  if (total === 0 || opts.dryRun) {
    return { table, copied: 0, total };
  }

  const colRes = await src.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table],
  );
  const cols = colRes.rows.map((r: any) => r.column_name);
  // node-postgres auto-parses json/jsonb columns into JS objects/arrays on SELECT, but does NOT
  // auto-serialize them back on the way out as bind parameters for the INSERT below — a plain
  // object gets coerced to its string representation ("[object Object]"), which Postgres then
  // rejects with "invalid input syntax for type json". Only a real risk for tables that actually
  // have non-null json/jsonb data (most newly-provisioned tenants have none yet, which is exactly
  // why this was never hit before 2026-08-04's first real dedicated-database commissioning).
  const jsonColumns = new Set(colRes.rows.filter((r: any) => r.data_type === "json" || r.data_type === "jsonb").map((r: any) => r.column_name));
  const colList = cols.map((c: string) => `"${c}"`).join(", ");
  const placeholders = (start: number, len: number) => cols.map((_, i) => `$${start + i}`).join(", ");

  let offset = 0;
  let copied = 0;
  while (offset < total) {
    const rows = await src.query(`SELECT ${colList} FROM ${table} ${whereClause} LIMIT $1 OFFSET $2`, [batchSize, offset]);
    if (rows.rows.length === 0) break;

    const values: any[] = [];
    const rowPlaceholders: string[] = [];
    rows.rows.forEach((row: any, i: number) => {
      cols.forEach((col: string) => {
        const v = row[col];
        values.push(jsonColumns.has(col) && v !== null && typeof v === "object" ? JSON.stringify(v) : v);
      });
      rowPlaceholders.push(`(${placeholders(i * cols.length + 1, cols.length)})`);
    });

    await dst.query(`INSERT INTO ${table} (${colList}) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT DO NOTHING`, values);
    copied += rows.rows.length;
    offset += batchSize;
  }
  return { table, copied, total };
}

/**
 * The ~70-table, FK-dependency-layer-ordered copy plan for one tenant — lifted verbatim from
 * commission-tenant-db.ts's main(), same layers, same filters, same order. Keep in sync with
 * shared/schema.ts by hand (see file header).
 */
export function buildTenantCopyPlan(tenantId: string): Array<{ table: string; where: string | null }> {
  const orgFilter = `organization_id = '${tenantId}'`;
  const usersFilter = `organization_id = '${tenantId}' OR organization_id IS NULL`;
  const rolesFilter = `organization_id IS NULL OR organization_id = '${tenantId}'`;

  return [
    // Layer 0: org + system tables
    { table: "organizations", where: `id = '${tenantId}'` },
    { table: "branches", where: orgFilter },
    { table: "org_member_sequences", where: orgFilter },
    { table: "org_policy_sequences", where: orgFilter },
    { table: "permissions", where: null },
    { table: "roles", where: rolesFilter },
    { table: "security_questions", where: orgFilter },
    { table: "fx_rates", where: orgFilter },
    { table: "directory_contacts", where: orgFilter },
    { table: "receipt_adverts", where: orgFilter },
    { table: "outbox_messages", where: orgFilter },
    { table: "partner_parlours", where: orgFilter },
    { table: "parlour_personnel", where: `parlour_id IN (SELECT id FROM partner_parlours WHERE ${orgFilter})` },

    // Layer 1: users + RBAC
    { table: "users", where: usersFilter },
    { table: "role_permissions", where: `role_id IN (SELECT id FROM roles WHERE ${rolesFilter})` },
    { table: "user_roles", where: `user_id IN (SELECT id FROM users WHERE ${orgFilter})` },
    { table: "user_permission_overrides", where: `user_id IN (SELECT id FROM users WHERE ${orgFilter})` },

    // Layer 2: clients
    { table: "clients", where: orgFilter },
    { table: "client_device_tokens", where: orgFilter },
    { table: "client_payment_methods", where: orgFilter },
    { table: "client_documents", where: orgFilter },
    { table: "payment_automation_settings", where: orgFilter },
    { table: "dependents", where: orgFilter },
    { table: "dependent_change_requests", where: `${orgFilter} AND (reviewed_by IS NULL OR reviewed_by IN (SELECT id FROM users WHERE ${usersFilter}))` },

    // Layer 3: products
    { table: "products", where: orgFilter },
    { table: "product_versions", where: orgFilter },
    { table: "benefit_catalog_items", where: orgFilter },
    { table: "benefit_bundles", where: orgFilter },
    { table: "add_ons", where: orgFilter },
    { table: "age_band_configs", where: orgFilter },
    { table: "price_book_items", where: orgFilter },
    { table: "product_benefit_bundle_links", where: `product_version_id IN (SELECT id FROM product_versions WHERE ${orgFilter})` },

    // Layer 4: groups + policies
    { table: "groups", where: orgFilter },
    { table: "policies", where: orgFilter },
    { table: "policy_members", where: orgFilter },
    { table: "policy_status_history", where: `policy_id IN (SELECT id FROM policies WHERE ${orgFilter}) AND (changed_by IS NULL OR changed_by IN (SELECT id FROM users WHERE ${usersFilter}))` },
    { table: "policy_add_ons", where: `policy_id IN (SELECT id FROM policies WHERE ${orgFilter})` },
    { table: "policy_credit_balances", where: orgFilter },
    { table: "policy_documents", where: orgFilter },
    { table: "policy_premium_changes", where: orgFilter },
    { table: "waiting_period_waivers", where: orgFilter },
    { table: "credit_notes", where: orgFilter },
    { table: "reversal_entries", where: orgFilter },
    { table: "debit_orders", where: orgFilter },

    // Layer 5: payments
    { table: "payment_transactions", where: orgFilter },
    { table: "receipts", where: orgFilter },
    { table: "payment_intents", where: orgFilter },
    { table: "payment_events", where: `payment_intent_id IN (SELECT id FROM payment_intents WHERE ${orgFilter})` },
    { table: "payment_receipts", where: orgFilter },
    { table: "payment_automation_runs", where: orgFilter },
    { table: "payment_disbursements", where: orgFilter },
    { table: "group_payment_intents", where: orgFilter },
    { table: "group_payment_allocations", where: `group_payment_intent_id IN (SELECT id FROM group_payment_intents WHERE ${orgFilter})` },
    { table: "month_end_runs", where: orgFilter },
    { table: "cashups", where: orgFilter },
    { table: "bank_accounts", where: orgFilter },
    { table: "bank_deposits", where: orgFilter },
    { table: "bank_statement_balances", where: orgFilter },
    { table: "balance_sheet_entries", where: orgFilter },

    // Layer 6: claims
    { table: "claims", where: orgFilter },
    { table: "claim_documents", where: `claim_id IN (SELECT id FROM claims WHERE ${orgFilter}) AND (verified_by IS NULL OR verified_by IN (SELECT id FROM users WHERE ${usersFilter}))` },
    { table: "claim_status_history", where: `claim_id IN (SELECT id FROM claims WHERE ${orgFilter}) AND (changed_by IS NULL OR changed_by IN (SELECT id FROM users WHERE ${usersFilter}))` },

    // Layer 7: funerals, mortuary + fleet
    { table: "funeral_cases", where: orgFilter },
    { table: "funeral_tasks", where: `funeral_case_id IN (SELECT id FROM funeral_cases WHERE ${orgFilter})` },
    { table: "cost_sheets", where: orgFilter },
    { table: "cost_line_items", where: `cost_sheet_id IN (SELECT id FROM cost_sheets WHERE ${orgFilter})` },
    { table: "fleet_vehicles", where: orgFilter },
    { table: "driver_assignments", where: `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})` },
    { table: "fleet_fuel_logs", where: `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})` },
    { table: "fleet_maintenance", where: `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})` },
    { table: "vehicle_trip_logs", where: orgFilter },
    { table: "driver_checklists", where: orgFilter },
    { table: "partner_parlour_vehicle_usage", where: orgFilter },
    { table: "mortuary_intakes", where: orgFilter },
    { table: "mortuary_dispatches", where: orgFilter },
    { table: "deceased_belongings", where: orgFilter },
    { table: "body_wash_requirements", where: orgFilter },
    { table: "mortuary_post_mortem_movements", where: orgFilter },
    { table: "funeral_quotations", where: orgFilter },
    { table: "quotation_guarantors", where: `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})` },
    { table: "quotation_collateral", where: `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})` },
    { table: "funeral_quotation_items", where: `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})` },
    { table: "service_receipts", where: orgFilter },

    // Layer 8: finance + commissions
    { table: "commission_plans", where: orgFilter },
    { table: "commission_ledger_entries", where: orgFilter },
    { table: "platform_receivables", where: orgFilter },
    { table: "settlements", where: orgFilter },
    { table: "settlement_allocations", where: `settlement_id IN (SELECT id FROM settlements WHERE ${orgFilter})` },
    { table: "payroll_employees", where: orgFilter },
    { table: "payroll_runs", where: orgFilter },
    { table: "payslips", where: `payroll_run_id IN (SELECT id FROM payroll_runs WHERE ${orgFilter})` },
    { table: "attendance_logs", where: orgFilter },
    { table: "expenditures", where: orgFilter },
    { table: "requisitions", where: orgFilter },
    { table: "requisition_items", where: `requisition_id IN (SELECT id FROM requisitions WHERE ${orgFilter})` },
    { table: "approval_requests", where: orgFilter },

    // Layer 9: notifications + misc
    { table: "notification_templates", where: orgFilter },
    { table: "notification_logs", where: orgFilter },
    { table: "daily_report_notes", where: orgFilter },
    { table: "leads", where: orgFilter },
    { table: "client_feedback", where: orgFilter },
    { table: "terms_and_conditions", where: orgFilter },
    { table: "audit_logs", where: orgFilter },
  ];
}

/**
 * Verifies every table in the copy plan, not a hand-picked subset — this used to check only 11
 * of the ~90 copied tables, which was tolerable when a human was watching the CLI's per-table
 * output as it ran. Now that this same function gates an *unattended* automatic cutover (see
 * server/tenant-db-commissioning.ts), a copy bug in any of the unchecked tables would have
 * silently promoted an incomplete migration to "success" with nobody watching. Reuses
 * buildTenantCopyPlan as the single source of truth for which tables/filters matter, so a table
 * added there is automatically verified too — no second list to keep in sync.
 */
export async function verifyTenantRowCounts(
  src: pg.Pool,
  dst: pg.Pool,
  tenantId: string,
  opts: { dryRun: boolean },
): Promise<{ allMatch: boolean; results: Array<{ table: string; srcCount: number; dstCount: number; match: boolean }> }> {
  const checks = buildTenantCopyPlan(tenantId);
  let allMatch = true;
  const results: Array<{ table: string; srcCount: number; dstCount: number; match: boolean }> = [];
  for (const { table, where } of checks) {
    const srcCount = await rowCount(src, table, where ?? "");
    const dstCount = opts.dryRun ? srcCount : await rowCount(dst, table, where ?? "");
    const match = opts.dryRun || srcCount === dstCount;
    if (!match) allMatch = false;
    results.push({ table, srcCount, dstCount, match });
  }
  return { allMatch, results };
}

/**
 * The single shared implementation of the tenantDatabases upsert — previously duplicated
 * between commission-tenant-db.ts's inline cutover and server/platform-routes.ts's
 * PUT /api/platform/tenants/:id/database handler. Both now call this instead.
 */
export async function upsertTenantDatabaseRouting(
  cpDbInstance: CpDb,
  tenantId: string,
  patch: { databaseUrl: string | null; databaseDirectUrl?: string | null; migrationState?: string },
): Promise<void> {
  const [existing] = await cpDbInstance
    .select({ tenantId: tenantDatabases.tenantId })
    .from(tenantDatabases)
    .where(eq(tenantDatabases.tenantId, tenantId));

  const values = {
    databaseUrl: patch.databaseUrl,
    databaseDirectUrl: patch.databaseDirectUrl ?? null,
    migrationState: patch.migrationState ?? "current",
    lastMigratedAt: new Date(),
  };

  if (existing) {
    await cpDbInstance.update(tenantDatabases).set(values).where(eq(tenantDatabases.tenantId, tenantId));
  } else {
    await cpDbInstance.insert(tenantDatabases).values({ tenantId, ...values });
  }
}

export interface MigrateTenantDataInput {
  tenantId: string;
  srcPool: pg.Pool;
  destPool: pg.Pool;
  cpDbInstance: CpDb;
  dryRun?: boolean;
  cutover: { databaseUrl: string; databaseDirectUrl: string | null };
  onProgress?: (event: {
    phase: "schema" | "copy" | "verify" | "cutover";
    table?: string;
    copied?: number;
    total?: number;
    message?: string;
  }) => void;
}

/**
 * Orchestrates the full migration: build schema on the (empty) destination via the app's own
 * migration runner (applyPendingMigrations — never drizzle-kit push), copy every table, verify
 * row counts, and — only if everything matches — cut over control-plane routing.
 */
export async function migrateTenantData(input: MigrateTenantDataInput): Promise<{ success: boolean; mismatches?: string[] }> {
  const { tenantId, srcPool, destPool, cpDbInstance, dryRun = false, cutover, onProgress } = input;

  if (!dryRun) {
    onProgress?.({ phase: "schema", message: "Building destination schema" });
    await applyPendingMigrations(destPool, `commission:${tenantId.slice(0, 8)}`);
  }

  onProgress?.({ phase: "copy", message: dryRun ? "Counting rows (dry run)" : "Copying data" });
  for (const { table, where } of buildTenantCopyPlan(tenantId)) {
    const result = await copyTenantTable(srcPool, destPool, table, where, { dryRun });
    onProgress?.({ phase: "copy", table: result.table, copied: result.copied, total: result.total });
  }

  onProgress?.({ phase: "verify", message: "Verifying row counts" });
  const { allMatch, results } = await verifyTenantRowCounts(srcPool, destPool, tenantId, { dryRun });

  if (dryRun) {
    return { success: true };
  }
  if (!allMatch) {
    const mismatches = results.filter((r) => !r.match).map((r) => `${r.table}: src=${r.srcCount} dst=${r.dstCount}`);
    return { success: false, mismatches };
  }

  onProgress?.({ phase: "cutover", message: "Updating control-plane routing" });
  await upsertTenantDatabaseRouting(cpDbInstance, tenantId, {
    databaseUrl: cutover.databaseUrl,
    databaseDirectUrl: cutover.databaseDirectUrl,
    migrationState: "current",
  });

  return { success: true };
}
