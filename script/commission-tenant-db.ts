/**
 * Commissions a dedicated database for an organization currently on the shared
 * platform DB (trial-mode default — see server/tenant-db.ts: an org with no
 * control_plane.tenant_databases row, or a null databaseUrl there, uses the shared
 * DATABASE_URL automatically). This is the generalized, any-org version of the
 * one-off Falakhe migration (script/migrate-supabase-to-do.ts +
 * script/cp-set-tenant-db.ts) — same proven approach, parameterized.
 *
 * This is a deliberately manual, admin-run workflow (not automated provisioning):
 * an admin provisions the destination Postgres database by hand (e.g. a new
 * DigitalOcean managed DB), then runs this script to build its schema, copy the
 * org's data across, and flip control-plane routing.
 *
 * Steps:
 *   1. Verify the org exists and isn't already on a dedicated DB.
 *   2. Build the destination schema (reuses the app's own migration runner —
 *      the same one that runs automatically on first request in production —
 *      so a fresh empty destination DB ends up on exactly the current schema).
 *   3. Copy the org's rows, table by table, in FK-dependency order.
 *   4. Print a source-vs-destination row-count verification report.
 *   5. Upsert control_plane.tenant_databases to point at the new DB (this is the
 *      cutover — the very next request for this org routes to the new DB).
 *   6. Optionally (--activate) bump control_plane.tenants.licenseStatus to "active"
 *      and provisioningState to "ready".
 *
 * IMPORTANT: this table list must stay in sync with shared/schema.ts. If a new
 * org-scoped table is added to the schema, add it here too (in FK-dependency
 * order) or a future tenant's data for that table will silently not migrate.
 *
 * Usage:
 *   TENANT_ID=<uuid> TENANT_DB_URL=<pooler_url> [TENANT_DIRECT_URL=<direct_url>] \
 *     tsx script/commission-tenant-db.ts [--activate] [--dry-run]
 *
 *   --dry-run   only counts rows on both sides, copies nothing, writes nothing.
 *   --activate  after a successful copy + cutover, sets licenseStatus="active".
 */
import "dotenv/config";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as cpSchema from "@shared/control-plane-schema";
import { applyPendingMigrations } from "../server/migrate-tenant-db";

const DRY_RUN = process.argv.includes("--dry-run");
const ACTIVATE = process.argv.includes("--activate");

const tenantId = process.env.TENANT_ID;
if (!tenantId) throw new Error("TENANT_ID must be set — the org id to commission a dedicated database for.");

const destUrl = process.env.TENANT_DB_URL;
if (!destUrl) throw new Error("TENANT_DB_URL must be set — pooler URL for the destination database.");
const destDirectUrl = process.env.TENANT_DIRECT_URL;

const sourceUrl = process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("DATABASE_URL must be set (source — the shared platform DB).");

const cpUrl = process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL;
if (!cpUrl) throw new Error("CONTROL_PLANE_DIRECT_URL (or CONTROL_PLANE_DATABASE_URL) must be set.");

function stripSslMode(url: string): string {
  return url.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

const BATCH_SIZE = 500;

const src = new pg.Pool({ connectionString: stripSslMode(sourceUrl), max: 3, ssl: { rejectUnauthorized: false } });
const dst = new pg.Pool({ connectionString: stripSslMode(destUrl), max: 3, ssl: { rejectUnauthorized: false } });
const cpPool = new pg.Pool({ connectionString: stripSslMode(cpUrl), max: 2, ssl: { rejectUnauthorized: false } });
const cpDb = drizzle(cpPool, { schema: cpSchema });

async function rowCount(pool: pg.Pool, table: string, where = ""): Promise<number> {
  const q = where ? `SELECT COUNT(*) FROM ${table} WHERE ${where}` : `SELECT COUNT(*) FROM ${table}`;
  const r = await pool.query(q);
  return parseInt(r.rows[0].count, 10);
}

async function copyTable(table: string, where: string | null) {
  const whereClause = where ? `WHERE ${where}` : "";
  const total = await rowCount(src, table, where ?? "");

  if (total === 0) {
    console.log(`  ${table.padEnd(40)} 0 rows — skipped`);
    return;
  }
  if (DRY_RUN) {
    console.log(`  ${table.padEnd(40)} ${total} rows (dry run — would copy)`);
    return;
  }

  const colRes = await src.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  const cols = colRes.rows.map((r: any) => r.column_name);
  const colList = cols.map((c: string) => `"${c}"`).join(", ");
  const placeholders = (start: number, len: number) => cols.map((_, i) => `$${start + i}`).join(", ");

  let offset = 0;
  let copied = 0;
  while (offset < total) {
    const rows = await src.query(`SELECT ${colList} FROM ${table} ${whereClause} LIMIT $1 OFFSET $2`, [BATCH_SIZE, offset]);
    if (rows.rows.length === 0) break;

    const values: any[] = [];
    const rowPlaceholders: string[] = [];
    rows.rows.forEach((row: any, i: number) => {
      cols.forEach((col) => values.push(row[col]));
      rowPlaceholders.push(`(${placeholders(i * cols.length + 1, cols.length)})`);
    });

    await dst.query(`INSERT INTO ${table} (${colList}) VALUES ${rowPlaceholders.join(", ")} ON CONFLICT DO NOTHING`, values);
    copied += rows.rows.length;
    offset += BATCH_SIZE;
  }
  console.log(`  ${table.padEnd(40)} ${copied} / ${total} rows ✓`);
}

async function main() {
  console.log("=== commission-tenant-db ===\n");
  console.log(`Tenant: ${tenantId}`);
  console.log(`Source: ${sourceUrl!.replace(/:([^:@]+)@/, ":***@")}`);
  console.log(`Dest:   ${destUrl!.replace(/:([^:@]+)@/, ":***@")}${DRY_RUN ? "  (DRY RUN)" : ""}\n`);

  const [org] = await src.query(`SELECT id, name FROM organizations WHERE id = $1`, [tenantId]).then((r) => r.rows);
  if (!org) throw new Error(`No organization found with id ${tenantId} on the source (shared) database.`);
  console.log(`Organization: ${org.name}\n`);

  const [existingRouting] = await cpDb
    .select({ databaseUrl: cpSchema.tenantDatabases.databaseUrl })
    .from(cpSchema.tenantDatabases)
    .where(eq(cpSchema.tenantDatabases.tenantId, tenantId));
  if (existingRouting?.databaseUrl) {
    throw new Error(
      `Tenant ${tenantId} already has a dedicated database registered in the control plane ` +
      `(${existingRouting.databaseUrl.replace(/:([^:@]+)@/, ":***@")}). Refusing to overwrite — ` +
      `if this is intentional (e.g. moving to a new host), clear tenant_databases.database_url first.`
    );
  }

  if (!DRY_RUN) {
    console.log("── Building destination schema (applying migrations) ──────────");
    await applyPendingMigrations(dst, `commission:${tenantId.slice(0, 8)}`);
    console.log("✓ Schema up to date.\n");
  }

  const orgFilter = `organization_id = '${tenantId}'`;
  const usersFilter = `organization_id = '${tenantId}' OR organization_id IS NULL`;
  const rolesFilter = `organization_id IS NULL OR organization_id = '${tenantId}'`;

  try {
    console.log(`${DRY_RUN ? "── Row counts (dry run) " : "── Copying data "}────────────────────────────────`);

    console.log("\n-- Layer 0: org + system tables --");
    await copyTable("organizations", `id = '${tenantId}'`);
    await copyTable("branches", orgFilter);
    await copyTable("org_member_sequences", orgFilter);
    await copyTable("org_policy_sequences", orgFilter);
    await copyTable("permissions", null);
    await copyTable("roles", rolesFilter);
    await copyTable("security_questions", orgFilter);
    await copyTable("fx_rates", orgFilter);
    await copyTable("directory_contacts", orgFilter);
    await copyTable("receipt_adverts", orgFilter);
    await copyTable("outbox_messages", orgFilter);
    await copyTable("partner_parlours", orgFilter);
    await copyTable("parlour_personnel", `parlour_id IN (SELECT id FROM partner_parlours WHERE ${orgFilter})`);

    console.log("\n-- Layer 1: users + RBAC --");
    await copyTable("users", usersFilter);
    await copyTable("role_permissions", `role_id IN (SELECT id FROM roles WHERE ${rolesFilter})`);
    await copyTable("user_roles", `user_id IN (SELECT id FROM users WHERE ${orgFilter})`);
    await copyTable("user_permission_overrides", `user_id IN (SELECT id FROM users WHERE ${orgFilter})`);

    console.log("\n-- Layer 2: clients --");
    await copyTable("clients", orgFilter);
    await copyTable("client_device_tokens", orgFilter);
    await copyTable("client_payment_methods", orgFilter);
    await copyTable("client_documents", orgFilter);
    await copyTable("payment_automation_settings", orgFilter);
    await copyTable("dependents", orgFilter);
    await copyTable("dependent_change_requests", `${orgFilter} AND (reviewed_by IS NULL OR reviewed_by IN (SELECT id FROM users WHERE ${usersFilter}))`);

    console.log("\n-- Layer 3: products --");
    await copyTable("products", orgFilter);
    await copyTable("product_versions", orgFilter);
    await copyTable("benefit_catalog_items", orgFilter);
    await copyTable("benefit_bundles", orgFilter);
    await copyTable("add_ons", orgFilter);
    await copyTable("age_band_configs", orgFilter);
    await copyTable("price_book_items", orgFilter);
    await copyTable("product_benefit_bundle_links", `product_version_id IN (SELECT id FROM product_versions WHERE ${orgFilter})`);

    console.log("\n-- Layer 4: groups + policies --");
    await copyTable("groups", orgFilter);
    await copyTable("policies", orgFilter);
    await copyTable("policy_members", orgFilter);
    await copyTable("policy_status_history", `policy_id IN (SELECT id FROM policies WHERE ${orgFilter}) AND (changed_by IS NULL OR changed_by IN (SELECT id FROM users WHERE ${usersFilter}))`);
    await copyTable("policy_add_ons", `policy_id IN (SELECT id FROM policies WHERE ${orgFilter})`);
    await copyTable("policy_credit_balances", orgFilter);
    await copyTable("policy_documents", orgFilter);
    await copyTable("policy_premium_changes", orgFilter);
    await copyTable("waiting_period_waivers", orgFilter);
    await copyTable("credit_notes", orgFilter);
    await copyTable("reversal_entries", orgFilter);
    await copyTable("debit_orders", orgFilter);

    console.log("\n-- Layer 5: payments --");
    await copyTable("payment_transactions", orgFilter);
    await copyTable("receipts", orgFilter);
    await copyTable("payment_intents", orgFilter);
    await copyTable("payment_events", `payment_intent_id IN (SELECT id FROM payment_intents WHERE ${orgFilter})`);
    await copyTable("payment_receipts", orgFilter);
    await copyTable("payment_automation_runs", orgFilter);
    await copyTable("payment_disbursements", orgFilter);
    await copyTable("group_payment_intents", orgFilter);
    await copyTable("group_payment_allocations", `group_payment_intent_id IN (SELECT id FROM group_payment_intents WHERE ${orgFilter})`);
    await copyTable("month_end_runs", orgFilter);
    await copyTable("cashups", orgFilter);
    await copyTable("bank_accounts", orgFilter);
    await copyTable("bank_deposits", orgFilter);
    await copyTable("bank_statement_balances", orgFilter);
    await copyTable("balance_sheet_entries", orgFilter);

    console.log("\n-- Layer 6: claims --");
    await copyTable("claims", orgFilter);
    await copyTable("claim_documents", `claim_id IN (SELECT id FROM claims WHERE ${orgFilter}) AND (verified_by IS NULL OR verified_by IN (SELECT id FROM users WHERE ${usersFilter}))`);
    await copyTable("claim_status_history", `claim_id IN (SELECT id FROM claims WHERE ${orgFilter}) AND (changed_by IS NULL OR changed_by IN (SELECT id FROM users WHERE ${usersFilter}))`);

    console.log("\n-- Layer 7: funerals, mortuary + fleet --");
    await copyTable("funeral_cases", orgFilter);
    await copyTable("funeral_tasks", `funeral_case_id IN (SELECT id FROM funeral_cases WHERE ${orgFilter})`);
    await copyTable("cost_sheets", orgFilter);
    await copyTable("cost_line_items", `cost_sheet_id IN (SELECT id FROM cost_sheets WHERE ${orgFilter})`);
    await copyTable("fleet_vehicles", orgFilter);
    await copyTable("driver_assignments", `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})`);
    await copyTable("fleet_fuel_logs", `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})`);
    await copyTable("fleet_maintenance", `vehicle_id IN (SELECT id FROM fleet_vehicles WHERE ${orgFilter})`);
    await copyTable("vehicle_trip_logs", orgFilter);
    await copyTable("driver_checklists", orgFilter);
    await copyTable("partner_parlour_vehicle_usage", orgFilter);
    await copyTable("mortuary_intakes", orgFilter);
    await copyTable("mortuary_dispatches", orgFilter);
    await copyTable("deceased_belongings", orgFilter);
    await copyTable("body_wash_requirements", orgFilter);
    await copyTable("mortuary_post_mortem_movements", orgFilter);
    await copyTable("funeral_quotations", orgFilter);
    await copyTable("quotation_guarantors", `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})`);
    await copyTable("quotation_collateral", `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})`);
    await copyTable("funeral_quotation_items", `quotation_id IN (SELECT id FROM funeral_quotations WHERE ${orgFilter})`);
    await copyTable("service_receipts", orgFilter);

    console.log("\n-- Layer 8: finance + commissions --");
    await copyTable("commission_plans", orgFilter);
    await copyTable("commission_ledger_entries", orgFilter);
    await copyTable("platform_receivables", orgFilter);
    await copyTable("settlements", orgFilter);
    await copyTable("settlement_allocations", `settlement_id IN (SELECT id FROM settlements WHERE ${orgFilter})`);
    await copyTable("payroll_employees", orgFilter);
    await copyTable("payroll_runs", orgFilter);
    await copyTable("payslips", `payroll_run_id IN (SELECT id FROM payroll_runs WHERE ${orgFilter})`);
    await copyTable("attendance_logs", orgFilter);
    await copyTable("expenditures", orgFilter);
    await copyTable("requisitions", orgFilter);
    await copyTable("requisition_items", `requisition_id IN (SELECT id FROM requisitions WHERE ${orgFilter})`);
    await copyTable("approval_requests", orgFilter);

    console.log("\n-- Layer 9: notifications + misc --");
    await copyTable("notification_templates", orgFilter);
    await copyTable("notification_logs", orgFilter);
    await copyTable("daily_report_notes", orgFilter);
    await copyTable("leads", orgFilter);
    await copyTable("client_feedback", orgFilter);
    await copyTable("terms_and_conditions", orgFilter);
    await copyTable("audit_logs", orgFilter);

    console.log(`\n✓ ${DRY_RUN ? "Dry run complete." : "All tables copied."}`);

    console.log("\n=== Verification (source vs destination row counts) ===\n");
    const checks: [string, string][] = [
      ["organizations", `id = '${tenantId}'`],
      ["branches", orgFilter],
      ["users", orgFilter],
      ["clients", orgFilter],
      ["products", orgFilter],
      ["policies", orgFilter],
      ["payment_intents", orgFilter],
      ["payment_receipts", orgFilter],
      ["claims", orgFilter],
      ["funeral_cases", orgFilter],
      ["audit_logs", orgFilter],
    ];
    let allMatch = true;
    for (const [table, where] of checks) {
      const srcCount = await rowCount(src, table, where);
      const dstCount = DRY_RUN ? srcCount : await rowCount(dst, table, where);
      const match = DRY_RUN || srcCount === dstCount;
      if (!match) allMatch = false;
      console.log(`  ${table.padEnd(30)} src=${String(srcCount).padStart(6)}  dst=${String(dstCount).padStart(6)}  ${DRY_RUN ? "(dry run)" : match ? "✓" : "✗ MISMATCH"}`);
    }

    if (DRY_RUN) {
      console.log("\nDry run only — nothing was copied and control-plane routing was not changed.");
      return;
    }

    if (!allMatch) {
      console.log("\n✗ Some counts mismatched — NOT flipping control-plane routing. Investigate before retrying.");
      process.exitCode = 1;
      return;
    }
    console.log("\n✓ All counts match.");

    console.log("\n── Cutover: updating control-plane routing ─────────────────────");
    const [existing] = await cpDb.select({ tenantId: cpSchema.tenantDatabases.tenantId }).from(cpSchema.tenantDatabases).where(eq(cpSchema.tenantDatabases.tenantId, tenantId));
    if (existing) {
      await cpDb.update(cpSchema.tenantDatabases).set({
        databaseUrl: destUrl!, databaseDirectUrl: destDirectUrl ?? null,
        migrationState: "current", lastMigratedAt: new Date(),
      }).where(eq(cpSchema.tenantDatabases.tenantId, tenantId));
    } else {
      await cpDb.insert(cpSchema.tenantDatabases).values({
        tenantId, databaseUrl: destUrl!, databaseDirectUrl: destDirectUrl ?? null,
        migrationState: "current", lastMigratedAt: new Date(),
      });
    }
    console.log("✓ Control plane routing updated — new requests for this tenant now use the dedicated database.");

    if (ACTIVATE) {
      await cpDb.update(cpSchema.tenants).set({ licenseStatus: "active", provisioningState: "ready" }).where(eq(cpSchema.tenants.id, tenantId));
      console.log("✓ licenseStatus set to \"active\".");
    }

    console.log("\nNote: any existing tenant pool for this org in a running app process is cached —");
    console.log("restart the app server (or wait for LRU eviction) to pick up the new routing immediately.");
  } finally {
    await src.end();
    await dst.end();
    await cpPool.end();
  }
}

main().catch((err) => {
  console.error("\nFatal:", err.message);
  process.exit(1);
});
