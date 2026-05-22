/**
 * Migrate all data from the old single Supabase database to the new
 * DigitalOcean multi-tenant setup.
 *
 * Routing:
 *  - Shared registry (pol263 main DB) : organizations, users, branches,
 *    permissions, roles, user_roles, and tenant data for ALL non-Falakhe orgs.
 *  - pol263-falakhe dedicated DB      : mirror of Falakhe users + all Falakhe
 *    tenant data (clients, policies, payments, etc.)
 *  - pol263-control-plane             : tenant_databases row for Falakhe.
 */

import "dotenv/config";
import pg from "pg";

// ── connection helpers ────────────────────────────────────────────────────────

const ssl = { rejectUnauthorized: false };

const supabase = new pg.Pool({
  host: process.env.SUPABASE_HOST || "db.xbstgitpicryhkoyqzyf.supabase.co",
  port: 5432, database: "postgres", user: "postgres",
  password: process.env.SUPABASE_PASSWORD, ssl,
});

const mainUrl    = (process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL)!.trim();
const cpUrl      = (process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL)!.trim();
const falakheUrl = (process.env.FALAKHE_DIRECT_URL || process.env.FALAKHE_DATABASE_URL)!.trim();

const mainDb    = new pg.Pool({ connectionString: mainUrl,    ssl });
const cpDb      = new pg.Pool({ connectionString: cpUrl,      ssl });
const falakheDb = new pg.Pool({ connectionString: falakheUrl, ssl });

// ── known org IDs ─────────────────────────────────────────────────────────────

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

// ── helpers ───────────────────────────────────────────────────────────────────

function log(msg: string) { console.log(`[${new Date().toISOString()}] ${msg}`); }

async function getColumns(pool: pg.Pool, table: string): Promise<Set<string>> {
  const c = await pool.connect();
  try {
    const { rows } = await c.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1`, [table]);
    return new Set(rows.map((r: any) => r.column_name));
  } finally { c.release(); }
}

async function copyTable(
  src: pg.Pool,
  dst: pg.Pool,
  table: string,
  filter?: string,
  params?: any[],
) {
  const srcClient = await src.connect();
  const dstClient = await dst.connect();
  try {
    // Only copy columns that exist in the destination schema
    const dstCols = await getColumns(dst, table);
    if (dstCols.size === 0) { log(`  ${table}: not in destination — skipped`); return 0; }

    const where = filter ? ` WHERE ${filter}` : "";
    const { rows } = await srcClient.query(`SELECT * FROM "${table}"${where}`, params);
    if (rows.length === 0) { log(`  ${table}: 0 rows — skipped`); return 0; }

    // Intersect: only columns present in both source and destination
    const srcCols = Object.keys(rows[0]);
    const cols = srcCols.filter(c => dstCols.has(c));

    const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
    const colList = cols.map(c => `"${c}"`).join(", ");
    const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`;

    let inserted = 0; let skipped = 0;
    for (const row of rows) {
      try {
        const result = await dstClient.query(sql, cols.map(c => row[c]));
        if (result.rowCount && result.rowCount > 0) inserted++; else skipped++;
      } catch (e: any) {
        skipped++;
      }
    }
    log(`  ${table}: ${inserted} rows inserted, ${skipped} skipped`);
    return inserted;
  } finally {
    srcClient.release();
    dstClient.release();
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function clearSeededRbac(pool: pg.Pool) {
  const c = await pool.connect();
  try {
    // Delete in FK-safe order: user_roles → role_permissions → roles → permissions
    await c.query(`DELETE FROM user_roles`);
    await c.query(`DELETE FROM user_permission_overrides`);
    await c.query(`DELETE FROM role_permissions`);
    await c.query(`DELETE FROM roles`);
    await c.query(`DELETE FROM permissions`);
    log("  Cleared seeded RBAC scaffold data");
  } finally { c.release(); }
}

async function main() {
  log("=== Starting Supabase → DigitalOcean migration ===\n");

  // ── 0. Clear seeded RBAC data so Supabase UUIDs can be inserted cleanly ─────
  log("── Phase 0: Clear seeded RBAC scaffold ──");
  await clearSeededRbac(mainDb);
  await clearSeededRbac(falakheDb);

  // ── 1. Shared registry: identity + RBAC tables ──────────────────────────────
  log("\n── Phase 1: Shared registry (main pol263 DB) ──");

  await copyTable(supabase, mainDb, "organizations");
  await copyTable(supabase, mainDb, "branches");
  await copyTable(supabase, mainDb, "users");
  await copyTable(supabase, mainDb, "permissions");
  await copyTable(supabase, mainDb, "roles");
  await copyTable(supabase, mainDb, "role_permissions");
  await copyTable(supabase, mainDb, "user_roles");
  await copyTable(supabase, mainDb, "user_permission_overrides");
  await copyTable(supabase, mainDb, "org_member_sequences");
  await copyTable(supabase, mainDb, "org_policy_sequences");

  // ── 2. Non-Falakhe tenant data → main DB ────────────────────────────────────
  log("\n── Phase 2: Non-Falakhe tenant data → main pol263 DB ──");

  const nonFalakheFilter = `organization_id != '${FALAKHE_ORG_ID}'`;

  // Order matters: insert parents before children
  const tenantTables = [
    // Independent / reference data first
    "security_questions", "notification_templates", "terms_and_conditions",
    "age_band_configs", "benefit_bundles", "benefit_catalog_items",
    "add_ons", "products", "product_versions",
    // Clients and direct dependents
    "clients", "client_payment_methods", "client_device_tokens",
    "dependents", "leads",
    // Policies and everything that hangs off them
    "policies", "policy_members", "policy_status_history",
    "policy_add_ons", "policy_credit_balances",
    // Payments (depend on clients + policies)
    "payment_intents", "payment_transactions", "payment_receipts",
    "payment_events", "platform_receivables", "commission_ledger_entries",
    // Groups
    "groups", "group_payment_intents", "group_payment_allocations",
    // Cashups / settlements
    "cashups", "settlements", "settlement_allocations",
    // Logs (depend on templates / clients)
    "notification_logs", "audit_logs",
    // Claims
    "claims", "claim_documents", "claim_status_history", "approval_requests",
    // Ops
    "expenditures", "fleet_vehicles", "fleet_fuel_logs", "fleet_maintenance",
    "funeral_cases", "funeral_tasks",
    "payroll_employees", "payroll_runs", "payslips",
    "outbox_messages", "payment_automation_runs",
    "payment_automation_settings", "month_end_runs",
  ];

  for (const t of tenantTables) {
    try {
      await copyTable(supabase, mainDb, t, nonFalakheFilter);
    } catch (e: any) {
      log(`  WARNING: ${t} → ${e.message}`);
    }
  }

  // ── 3. Falakhe tenant data → pol263-falakhe DB ───────────────────────────────
  log("\n── Phase 3: Falakhe data → pol263-falakhe DB ──");

  // Mirror identity tables needed for FK integrity
  await copyTable(supabase, falakheDb, "organizations");
  await copyTable(supabase, falakheDb, "branches");
  await copyTable(supabase, falakheDb, "users");
  await copyTable(supabase, falakheDb, "permissions");
  await copyTable(supabase, falakheDb, "roles");
  await copyTable(supabase, falakheDb, "role_permissions");
  await copyTable(supabase, falakheDb, "user_roles");
  await copyTable(supabase, falakheDb, "org_member_sequences");
  await copyTable(supabase, falakheDb, "org_policy_sequences");

  const falakheFilter = `organization_id = '${FALAKHE_ORG_ID}'`;

  for (const t of tenantTables) {
    try {
      await copyTable(supabase, falakheDb, t, falakheFilter);
    } catch (e: any) {
      log(`  WARNING: ${t} → ${e.message}`);
    }
  }

  // ── 4. Control plane: register Falakhe ──────────────────────────────────────
  log("\n── Phase 4: Register Falakhe in control plane ──");

  const cpClient = await cpDb.connect();
  try {
    // Upsert a tenant row for Falakhe
    await cpClient.query(`
      INSERT INTO tenants (id, name, slug, is_active)
      VALUES ($1, 'FALAKHE FUNERAL PARLOUR', 'falakhe', true)
      ON CONFLICT (id) DO NOTHING
    `, [FALAKHE_ORG_ID]);

    // Point it at the dedicated DB
    await cpClient.query(`
      INSERT INTO tenant_databases (tenant_id, database_url, database_direct_url, migration_state)
      VALUES ($1, $2, $3, 'current')
      ON CONFLICT (tenant_id) DO UPDATE
        SET database_url = EXCLUDED.database_url,
            database_direct_url = EXCLUDED.database_direct_url
    `, [
      FALAKHE_ORG_ID,
      process.env.FALAKHE_DATABASE_URL,
      process.env.FALAKHE_DIRECT_URL,
    ]);

    log("  Falakhe registered in control plane");
  } finally {
    cpClient.release();
  }

  // ── 5. Set databaseUrl on organizations row for Falakhe ─────────────────────
  log("\n── Phase 5: Set databaseUrl on Falakhe org row ──");

  const mainClient = await mainDb.connect();
  try {
    await mainClient.query(`
      UPDATE organizations
      SET database_url = $1
      WHERE id = $2
    `, [process.env.FALAKHE_DATABASE_URL, FALAKHE_ORG_ID]);
    log("  organizations.database_url set for Falakhe");
  } finally {
    mainClient.release();
  }

  log("\n=== Migration complete ===");
  log("Next: re-add IP restrictions to your DO databases for security.");
}

main()
  .catch(e => { console.error("FATAL:", e.message); process.exit(1); })
  .finally(() => Promise.all([supabase.end(), mainDb.end(), cpDb.end(), falakheDb.end()]));
