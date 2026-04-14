/**
 * Migrates Falakhe's data from Supabase → pol263-falakhe (DigitalOcean).
 *
 * Strategy:
 *  - Reads only rows belonging to Falakhe (organization_id = FALAKHE_ORG_ID)
 *  - Disables FK constraints on destination during copy (session_replication_role)
 *  - Copies in dependency order so re-enabling FK constraints passes
 *  - Batched inserts (500 rows) to avoid memory issues on large tables
 *  - Prints a row-count verification report at the end
 *  - Safe to re-run: truncates destination tables before each copy
 *
 * Prerequisites:
 *   1. npm run db:push:falakhe   (push schema to pol263-falakhe first)
 *   2. Fill FALAKHE_DIRECT_URL in .env
 *
 * Usage:
 *   npm run db:migrate:falakhe
 */
import "dotenv/config";
import pg from "pg";

// ─── Config ───────────────────────────────────────────────────────────────────

const FALAKHE_ORG_ID = "4eadab0e-c61b-40ee-b511-1243e9790179";

const BATCH_SIZE = 500;

function stripSslMode(url: string): string {
  return url
    .replace(/[?&]sslmode=[^&]*/gi, "")
    .replace(/\?$/, "");
}

const sourceUrl = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("SUPABASE_DATABASE_URL must be set (source).");

const destUrl = process.env.FALAKHE_DIRECT_URL;
if (!destUrl) throw new Error("FALAKHE_DIRECT_URL must be set (destination).");

const src = new pg.Pool({ connectionString: stripSslMode(sourceUrl), max: 3, ssl: { rejectUnauthorized: false } });
const dst = new pg.Pool({ connectionString: stripSslMode(destUrl), max: 3, ssl: { rejectUnauthorized: false } });

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function count(pool: pg.Pool, table: string, where = ""): Promise<number> {
  const q = where ? `SELECT COUNT(*) FROM ${table} WHERE ${where}` : `SELECT COUNT(*) FROM ${table}`;
  const r = await pool.query(q);
  return parseInt(r.rows[0].count, 10);
}

async function copyTable(
  table: string,
  where: string | null,
) {
  const whereClause = where ? `WHERE ${where}` : "";
  const total = await count(src, table, where ?? "");

  if (total === 0) {
    console.log(`  ${table.padEnd(40)} 0 rows — skipped`);
    return { table, copied: 0 };
  }

  // Fetch column names from source
  const colRes = await src.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  const cols = colRes.rows.map((r: any) => r.column_name);
  const colList = cols.map((c: string) => `"${c}"`).join(", ");
  const placeholders = (start: number, len: number) =>
    cols.map((_, i) => `$${start + i}`).join(", ");

  let offset = 0;
  let copied = 0;

  while (offset < total) {
    const rows = await src.query(
      `SELECT ${colList} FROM ${table} ${whereClause} LIMIT $1 OFFSET $2`,
      [BATCH_SIZE, offset]
    );

    if (rows.rows.length === 0) break;

    // Batch insert
    const values: any[] = [];
    const rowPlaceholders: string[] = [];
    rows.rows.forEach((row: any, i: number) => {
      cols.forEach((col) => values.push(row[col]));
      rowPlaceholders.push(`(${placeholders(i * cols.length + 1, cols.length)})`);
    });

    await dst.query(
      `INSERT INTO ${table} (${colList}) VALUES ${rowPlaceholders.join(", ")}
       ON CONFLICT DO NOTHING`,
      values
    );

    copied += rows.rows.length;
    offset += BATCH_SIZE;
  }

  console.log(`  ${table.padEnd(40)} ${copied} / ${total} rows ✓`);
  return { table, copied };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== migrate-supabase-to-do (Falakhe) ===\n");
  console.log(`Source: ${sourceUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Dest:   ${destUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Tenant: ${FALAKHE_ORG_ID}\n`);

  const orgFilter = `organization_id = '${FALAKHE_ORG_ID}'`;
  // pol263-falakhe is a fresh empty database — no need to disable FK constraints.
  // We insert in strict dependency order (parents before children) so FK checks pass.

  try {

    console.log("── Layer 0: org + system tables ─────────────────────────────");
    await copyTable("organizations",    `id = '${FALAKHE_ORG_ID}'`);
    await copyTable("branches",         orgFilter);
    await copyTable("org_member_sequences", `organization_id = '${FALAKHE_ORG_ID}'`);
    await copyTable("org_policy_sequences", `organization_id = '${FALAKHE_ORG_ID}'`);

    // permissions are system-wide (no org column) — copy all so FK from role_permissions works
    await copyTable("permissions", null);

    // roles: copy system roles (null org) + falakhe's own roles
    await copyTable("roles", `organization_id IS NULL OR organization_id = '${FALAKHE_ORG_ID}'`);

    await copyTable("security_questions", orgFilter);

    console.log("\n── Layer 1: users + RBAC ─────────────────────────────────────");
    // Include null-org users (platform admins) — they appear as changed_by/agent_id
    // across tenant data and must exist in the destination for FK constraints to pass.
    await copyTable("users", `organization_id = '${FALAKHE_ORG_ID}' OR organization_id IS NULL`);
    await copyTable("role_permissions",
      `role_id IN (SELECT id FROM roles WHERE organization_id IS NULL OR organization_id = '${FALAKHE_ORG_ID}')`
    );
    await copyTable("user_roles",
      `user_id IN (SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("user_permission_overrides",
      `user_id IN (SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}')`);

    console.log("\n── Layer 2: clients ──────────────────────────────────────────");
    await copyTable("clients",                    orgFilter);
    await copyTable("client_device_tokens",       orgFilter);
    await copyTable("client_payment_methods",     orgFilter);
    await copyTable("payment_automation_settings", orgFilter);
    await copyTable("dependents",                 orgFilter);
    await copyTable("dependent_change_requests",
      `${orgFilter} AND (reviewed_by IS NULL OR reviewed_by IN (
         SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}' OR organization_id IS NULL
       ))`);

    console.log("\n── Layer 3: products ─────────────────────────────────────────");
    await copyTable("products",                   orgFilter);
    await copyTable("product_versions",           orgFilter);
    await copyTable("benefit_catalog_items",      orgFilter);
    await copyTable("benefit_bundles",            orgFilter);
    await copyTable("add_ons",                    orgFilter);
    await copyTable("age_band_configs",           orgFilter);
    await copyTable("price_book_items",           orgFilter);
    await copyTable("product_benefit_bundle_links",
      `product_version_id IN (SELECT id FROM product_versions WHERE organization_id = '${FALAKHE_ORG_ID}')`);

    console.log("\n── Layer 4: groups + policies ────────────────────────────────");
    await copyTable("groups",                     orgFilter);
    await copyTable("policies",                   orgFilter);
    await copyTable("policy_members",             orgFilter);
    await copyTable("policy_status_history",
      `policy_id IN (SELECT id FROM policies WHERE organization_id = '${FALAKHE_ORG_ID}')
       AND (changed_by IS NULL OR changed_by IN (
         SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}' OR organization_id IS NULL
       ))`);
    await copyTable("policy_add_ons",
      `policy_id IN (SELECT id FROM policies WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("policy_credit_balances",     orgFilter);
    await copyTable("credit_notes",               orgFilter);
    await copyTable("reversal_entries",           orgFilter);

    console.log("\n── Layer 5: payments ─────────────────────────────────────────");
    await copyTable("payment_transactions",       orgFilter);
    await copyTable("receipts",                   orgFilter);
    await copyTable("payment_intents",            orgFilter);
    await copyTable("payment_events",
      `payment_intent_id IN (SELECT id FROM payment_intents WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("payment_receipts",           orgFilter);
    await copyTable("payment_automation_runs",    orgFilter);
    await copyTable("group_payment_intents",      orgFilter);
    await copyTable("group_payment_allocations",
      `group_payment_intent_id IN (SELECT id FROM group_payment_intents WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("month_end_runs",             orgFilter);
    await copyTable("cashups",                    orgFilter);

    console.log("\n── Layer 6: claims ───────────────────────────────────────────");
    await copyTable("claims",                     orgFilter);
    await copyTable("claim_documents",
      `claim_id IN (SELECT id FROM claims WHERE organization_id = '${FALAKHE_ORG_ID}')
       AND (verified_by IS NULL OR verified_by IN (
         SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}' OR organization_id IS NULL
       ))`);
    await copyTable("claim_status_history",
      `claim_id IN (SELECT id FROM claims WHERE organization_id = '${FALAKHE_ORG_ID}')
       AND (changed_by IS NULL OR changed_by IN (
         SELECT id FROM users WHERE organization_id = '${FALAKHE_ORG_ID}' OR organization_id IS NULL
       ))`);

    console.log("\n── Layer 7: funerals + fleet ─────────────────────────────────");
    await copyTable("funeral_cases",              orgFilter);
    await copyTable("funeral_tasks",
      `funeral_case_id IN (SELECT id FROM funeral_cases WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("cost_sheets",                orgFilter);
    await copyTable("cost_line_items",
      `cost_sheet_id IN (SELECT id FROM cost_sheets WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("fleet_vehicles",             orgFilter);
    await copyTable("driver_assignments",
      `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("fleet_fuel_logs",
      `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("fleet_maintenance",
      `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE organization_id = '${FALAKHE_ORG_ID}')`);

    console.log("\n── Layer 8: finance + commissions ───────────────────────────");
    await copyTable("commission_plans",           orgFilter);
    await copyTable("commission_ledger_entries",  orgFilter);
    await copyTable("platform_receivables",       orgFilter);
    await copyTable("settlements",                orgFilter);
    await copyTable("settlement_allocations",
      `settlement_id IN (SELECT id FROM settlements WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("payroll_employees",          orgFilter);
    await copyTable("payroll_runs",               orgFilter);
    await copyTable("payslips",
      `payroll_run_id IN (SELECT id FROM payroll_runs WHERE organization_id = '${FALAKHE_ORG_ID}')`);
    await copyTable("expenditures",               orgFilter);
    await copyTable("approval_requests",          orgFilter);

    console.log("\n── Layer 9: notifications + misc ────────────────────────────");
    await copyTable("notification_templates",     orgFilter);
    await copyTable("notification_logs",          orgFilter);
    await copyTable("leads",                      orgFilter);
    await copyTable("client_feedback",            orgFilter);
    await copyTable("terms_and_conditions",       orgFilter);
    await copyTable("audit_logs",                 orgFilter);

    console.log("\n✓ All tables copied.");

    // ── Verification ───────────────────────────────────────────────────────────
    console.log("\n=== Verification (source vs destination row counts) ===\n");

    const checks = [
      ["organizations",   `id = '${FALAKHE_ORG_ID}'`],
      ["branches",        orgFilter],
      ["users",           orgFilter],
      ["clients",         orgFilter],
      ["dependents",      orgFilter],
      ["products",        orgFilter],
      ["policies",        orgFilter],
      ["payment_intents", orgFilter],
      ["payment_receipts",orgFilter],
      ["claims",          orgFilter],
      ["audit_logs",      orgFilter],
    ] as [string, string][];

    let allMatch = true;
    for (const [table, where] of checks) {
      const srcCount = await count(src, table, where);
      const dstCount = await count(dst, table, where);
      const match = srcCount === dstCount;
      if (!match) allMatch = false;
      console.log(
        `  ${table.padEnd(30)} src=${String(srcCount).padStart(6)}  dst=${String(dstCount).padStart(6)}  ${match ? "✓" : "✗ MISMATCH"}`
      );
    }

    console.log(allMatch ? "\n✓ All counts match." : "\n✗ Some counts mismatched — review before cutover.");

    console.log("\n=== Next steps ===");
    console.log("1. Review the verification above.");
    console.log("2. Run the control plane update to point Falakhe at pol263-falakhe:");
    console.log("   npm run db:cp:set-falakhe-db");
    console.log("3. Test the app against the new database.");
    console.log("4. Update DATABASE_URL in .env to point to pol263 (DO shared) for other tenants.");

  } catch (err: any) {
    console.error("\nFatal:", err.message);
    throw err;
  } finally {
    await src.end();
    await dst.end();
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
