/**
 * Full data sync: copies ALL data from all three DigitalOcean databases to Supabase.
 * Run: npx tsx script/full-sync-to-supabase.ts
 *
 * Safe to re-run — uses ON CONFLICT upserts, so duplicate rows are overwritten not doubled.
 */
import "dotenv/config";
import pg from "pg";

const ssl = { rejectUnauthorized: false };
const timeout = { connectionTimeoutMillis: 30_000 };

function pool(url: string) {
  return new pg.Pool({ connectionString: url, ssl, max: 3, ...timeout });
}

const registryPool   = pool(process.env.DATABASE_DIRECT_URL!);
const cpPool         = pool(process.env.CONTROL_PLANE_DIRECT_URL!);
const falakhePool    = pool(process.env.FALAKHE_DIRECT_URL!);
const supabasePool   = pool(
  process.env.SUPABASE_BACKUP_DIRECT_URL || process.env.SUPABASE_BACKUP_URL!
);

// ─── TABLE DEFINITIONS ───────────────────────────────────────────────────────

const REGISTRY_TABLES = [
  { table: "organizations", pk: "id" },
  { table: "users",         pk: "id" },
  { table: "sessions",      pk: "sid" },
];

const CONTROL_PLANE_TABLES = [
  { table: "tenants",               pk: "id" },
  { table: "tenant_domains",        pk: "id" },
  { table: "tenant_databases",      pk: "tenant_id" },
  { table: "tenant_storage",        pk: "tenant_id" },
  { table: "tenant_integrations",   pk: "id" },
  { table: "tenant_branding",       pk: "tenant_id" },
  { table: "tenant_feature_flags",  pk: "tenant_id,flag" },
];

const TENANT_TABLES = [
  { table: "branches",                      pk: "id" },
  { table: "roles",                         pk: "id" },
  { table: "user_roles",                    pk: "id" },
  { table: "permissions",                   pk: "id" },
  { table: "role_permissions",              pk: "role_id,permission_id" },
  { table: "security_questions",            pk: "id" },
  { table: "clients",                       pk: "id" },
  { table: "dependents",                    pk: "id" },
  { table: "products",                      pk: "id" },
  { table: "product_versions",              pk: "id" },
  { table: "benefit_catalog_items",         pk: "id" },
  { table: "benefit_bundles",               pk: "id" },
  { table: "product_benefit_bundle_links",  pk: "id" },
  { table: "add_ons",                       pk: "id" },
  { table: "age_band_configs",              pk: "id" },
  { table: "policy_add_ons",               pk: "id" },
  { table: "terms_and_conditions",          pk: "id" },
  { table: "price_book_items",              pk: "id" },
  { table: "policies",                      pk: "id" },
  { table: "policy_members",               pk: "id" },
  { table: "policy_status_history",         pk: "id" },
  { table: "org_member_sequences",          pk: "organization_id" },
  { table: "org_policy_sequences",          pk: "organization_id" },
  { table: "payment_transactions",          pk: "id" },
  { table: "payment_intents",              pk: "id" },
  { table: "payment_events",               pk: "id" },
  { table: "payment_receipts",             pk: "id" },
  { table: "claims",                        pk: "id" },
  { table: "claim_documents",              pk: "id" },
  { table: "claim_status_history",          pk: "id" },
  { table: "funeral_cases",                pk: "id" },
  { table: "funeral_tasks",                pk: "id" },
  { table: "funeral_quotations",           pk: "id" },
  { table: "funeral_quotation_items",      pk: "id" },
  { table: "cost_sheets",                  pk: "id" },
  { table: "cost_line_items",              pk: "id" },
  { table: "commission_ledger_entries",    pk: "id" },
  { table: "commission_plans",             pk: "id" },
  { table: "leads",                        pk: "id" },
  { table: "expenditures",                 pk: "id" },
  { table: "cashups",                      pk: "id" },
  { table: "notification_logs",            pk: "id" },
  { table: "notification_templates",       pk: "id" },
  { table: "audit_logs",                   pk: "id" },
  { table: "groups",                       pk: "id" },
  { table: "fleet_vehicles",               pk: "id" },
  { table: "fleet_maintenance",            pk: "id" },
  { table: "fleet_fuel_logs",              pk: "id" },
  { table: "driver_assignments",           pk: "id" },
  { table: "outbox_messages",              pk: "id" },
  { table: "month_end_runs",               pk: "id" },
  { table: "credit_notes",                 pk: "id" },
  { table: "receipts",                     pk: "id" },
  { table: "reversal_entries",             pk: "id" },
  { table: "platform_receivables",         pk: "id" },
  { table: "settlements",                  pk: "id" },
  { table: "settlement_allocations",       pk: "id" },
  { table: "payroll_employees",            pk: "id" },
  { table: "payroll_runs",                 pk: "id" },
  { table: "payslips",                     pk: "id" },
  { table: "approval_requests",            pk: "id" },
  { table: "requisitions",                 pk: "id" },
  { table: "service_receipts",             pk: "id" },
  { table: "client_feedback",              pk: "id" },
  { table: "dependent_change_requests",    pk: "id" },
  { table: "group_payment_intents",        pk: "id" },
  { table: "group_payment_allocations",    pk: "id" },
  { table: "payment_automation_runs",      pk: "id" },
  { table: "payment_automation_settings",  pk: "id" },
  { table: "user_permission_overrides",    pk: "id" },
  { table: "client_device_tokens",         pk: "id" },
  { table: "client_payment_methods",       pk: "id" },
  { table: "policy_credit_balances",       pk: "id" },
  { table: "fx_rates",                     pk: "id" },
  { table: "directory_contacts",           pk: "id" },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

async function tableExists(client: pg.PoolClient, table: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  return rows.length > 0;
}

async function syncTable(
  srcPool: pg.Pool,
  destPool: pg.Pool,
  table: string,
  pk: string,
  label: string
): Promise<number> {
  const src = await srcPool.connect();
  const dest = await destPool.connect();
  try {
    // Skip if table doesn't exist in source
    if (!(await tableExists(src, table))) return 0;
    // Skip if table doesn't exist in dest
    if (!(await tableExists(dest, table))) {
      console.log(`  SKIP  ${label}:${table} (not in Supabase yet)`);
      return 0;
    }

    const { rows } = await src.query(`SELECT * FROM "${table}"`);
    if (rows.length === 0) return 0;

    const columns = Object.keys(rows[0]);
    const pkCols = pk.split(",").map((c) => c.trim());
    const nonPkCols = columns.filter((c) => !pkCols.includes(c));

    await dest.query("SET session_replication_role = replica");

    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values: any[] = [];
      const placeholders: string[] = [];

      for (const row of chunk) {
        const rowVals = columns.map((col) => {
          const v = row[col];
          if (v !== null && typeof v === "object" && !(v instanceof Date)) return JSON.stringify(v);
          return v;
        });
        const offset = values.length;
        placeholders.push(`(${rowVals.map((_, idx) => `$${offset + idx + 1}`).join(", ")})`);
        values.push(...rowVals);
      }

      const colList = columns.map((c) => `"${c}"`).join(", ");
      const conflictCols = pkCols.map((c) => `"${c}"`).join(", ");
      const updateSet = nonPkCols.length > 0
        ? nonPkCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")
        : `"${pkCols[0]}" = EXCLUDED."${pkCols[0]}"`;

      await dest.query(
        `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(", ")} ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}`,
        values
      );
    }

    await dest.query("SET session_replication_role = DEFAULT");
    return rows.length;
  } finally {
    src.release();
    dest.release();
  }
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

console.log("Full sync: DigitalOcean → Supabase\n");

let totalRows = 0;

// 1. Registry (pol263 shared DB)
console.log("── Registry DB (organizations, users, sessions) ──");
for (const { table, pk } of REGISTRY_TABLES) {
  try {
    const n = await syncTable(registryPool, supabasePool, table, pk, "registry");
    if (n > 0) { console.log(`  OK    registry:${table} — ${n} rows`); totalRows += n; }
  } catch (e: any) { console.error(`  ERR   registry:${table} — ${e.message}`); }
}

// 2. Control plane DB
console.log("\n── Control Plane DB ──");
for (const { table, pk } of CONTROL_PLANE_TABLES) {
  try {
    const n = await syncTable(cpPool, supabasePool, table, pk, "cp");
    if (n > 0) { console.log(`  OK    cp:${table} — ${n} rows`); totalRows += n; }
  } catch (e: any) { console.error(`  ERR   cp:${table} — ${e.message}`); }
}

// 3. Falakhe tenant DB
console.log("\n── Falakhe Tenant DB ──");
for (const { table, pk } of TENANT_TABLES) {
  try {
    const n = await syncTable(falakhePool, supabasePool, table, pk, "falakhe");
    if (n > 0) { console.log(`  OK    falakhe:${table} — ${n} rows`); totalRows += n; }
  } catch (e: any) { console.error(`  ERR   falakhe:${table} — ${e.message}`); }
}

await registryPool.end();
await cpPool.end();
await falakhePool.end();
await supabasePool.end();

console.log(`\nDone. Total rows synced: ${totalRows}`);
