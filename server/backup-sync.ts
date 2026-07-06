/**
 * Backup Sync — full daily mirror of every tenant/registry/control-plane table
 * into a Supabase backup DB.
 *
 * Runs daily at midnight (00:00 UTC+2) via an in-process scheduler.
 * Syncs data from ALL THREE DigitalOcean databases into one Supabase DB:
 *   1. pol263 (shared registry) — organizations, shared users
 *   2. pol263-control-plane — tenants, domains, branding, integrations
 *   3. pol263-falakhe (+ any future tenant DBs) — clients, policies, payments, etc.
 *
 * Uses ON CONFLICT upserts so it is idempotent and safe to re-run.
 *
 * Every table below is a FULL re-select each run (not filtered by created_at).
 * This used to be an incremental sync keyed on created_at, which had two silent
 * failure modes at our current data scale (a few thousand rows per table, so a
 * full daily sync costs nothing): (1) any row whose fields changed AFTER
 * creation — e.g. a requisition moving submitted → approved → paid, a mortuary
 * intake being dispatched, a receipt being voided — was never re-synced, since
 * only created_at was checked; the backup would silently drift from reality.
 * (2) the window was "now minus 24h" rather than "since the last successful
 * run", so a missed/failed run created a permanent gap for anything older than
 * 24h by the time the next run fired. A full re-sync has neither problem: it
 * always reflects current state. Revisit if any table grows large enough that
 * a full daily SELECT * becomes expensive.
 *
 * Known limitation: this is an upsert-only mirror — rows deleted from the
 * source are never deleted from the backup. That's intentional (a transient
 * query hiccup should never be able to delete backup data), but it means the
 * backup can accumulate rows the source has since removed.
 *
 * ENV: SUPABASE_BACKUP_URL — the Supabase pooler connection string (port 6543).
 *      If not set, the backup is silently skipped.
 */
import pg from "pg";
import { structuredLog } from "./logger";
import { getDbForOrg } from "./tenant-db";
import { sql } from "drizzle-orm";

interface FullSyncTableDef { table: string; primaryKey: string }

// ─── TENANT DB TABLES (per-org: Falakhe, future tenants) — full sync ───────
const TENANT_FULL_SYNC_TABLES: FullSyncTableDef[] = [
  { table: "organizations", primaryKey: "id" },
  { table: "branches", primaryKey: "id" },
  { table: "users", primaryKey: "id" },
  { table: "roles", primaryKey: "id" },
  { table: "user_roles", primaryKey: "id" },
  { table: "clients", primaryKey: "id" },
  { table: "client_documents", primaryKey: "id" },
  { table: "dependents", primaryKey: "id" },
  { table: "products", primaryKey: "id" },
  { table: "product_versions", primaryKey: "id" },
  { table: "policies", primaryKey: "id" },
  { table: "policy_members", primaryKey: "id" },
  { table: "policy_status_history", primaryKey: "id" },
  { table: "policy_documents", primaryKey: "id" },
  { table: "policy_premium_changes", primaryKey: "id" },
  { table: "policy_credit_balances", primaryKey: "id" },
  { table: "waiting_period_waivers", primaryKey: "id" },
  { table: "payment_transactions", primaryKey: "id" },
  { table: "payment_intents", primaryKey: "id" },
  { table: "payment_events", primaryKey: "id" },
  { table: "payment_receipts", primaryKey: "id" },
  { table: "payment_disbursements", primaryKey: "id" },
  { table: "claims", primaryKey: "id" },
  { table: "claim_documents", primaryKey: "id" },
  { table: "claim_status_history", primaryKey: "id" },
  { table: "funeral_cases", primaryKey: "id" },
  { table: "funeral_tasks", primaryKey: "id" },
  { table: "funeral_quotations", primaryKey: "id" },
  { table: "funeral_quotation_items", primaryKey: "id" },
  { table: "quotation_guarantors", primaryKey: "id" },
  { table: "quotation_collateral", primaryKey: "id" },
  { table: "commission_ledger_entries", primaryKey: "id" },
  { table: "commission_plans", primaryKey: "id" },
  { table: "leads", primaryKey: "id" },
  { table: "expenditures", primaryKey: "id" },
  { table: "requisitions", primaryKey: "id" },
  { table: "requisition_items", primaryKey: "id" },
  { table: "cashups", primaryKey: "id" },
  { table: "bank_accounts", primaryKey: "id" },
  { table: "bank_deposits", primaryKey: "id" },
  { table: "bank_statement_balances", primaryKey: "id" },
  { table: "balance_sheet_entries", primaryKey: "id" },
  { table: "debit_orders", primaryKey: "id" },
  { table: "notification_logs", primaryKey: "id" },
  { table: "notification_templates", primaryKey: "id" },
  { table: "user_notifications", primaryKey: "id" },
  { table: "user_device_tokens", primaryKey: "id" },
  { table: "audit_logs", primaryKey: "id" },
  { table: "groups", primaryKey: "id" },
  { table: "fleet_vehicles", primaryKey: "id" },
  { table: "fleet_maintenance", primaryKey: "id" },
  { table: "fleet_fuel_logs", primaryKey: "id" },
  { table: "driver_assignments", primaryKey: "id" },
  { table: "vehicle_trip_logs", primaryKey: "id" },
  { table: "outbox_messages", primaryKey: "id" },
  { table: "month_end_runs", primaryKey: "id" },
  { table: "credit_notes", primaryKey: "id" },
  { table: "receipts", primaryKey: "id" },
  { table: "receipt_adverts", primaryKey: "id" },
  { table: "reversal_entries", primaryKey: "id" },
  { table: "platform_receivables", primaryKey: "id" },
  { table: "settlements", primaryKey: "id" },
  { table: "settlement_allocations", primaryKey: "id" },
  { table: "payroll_employees", primaryKey: "id" },
  { table: "payroll_runs", primaryKey: "id" },
  { table: "payslips", primaryKey: "id" },
  { table: "attendance_logs", primaryKey: "id" },
  { table: "approval_requests", primaryKey: "id" },
  { table: "service_receipts", primaryKey: "id" },
  { table: "client_feedback", primaryKey: "id" },
  { table: "dependent_change_requests", primaryKey: "id" },
  { table: "group_payment_intents", primaryKey: "id" },
  { table: "group_payment_allocations", primaryKey: "id" },
  { table: "payment_automation_runs", primaryKey: "id" },
  { table: "directory_contacts", primaryKey: "id" },
  { table: "legacy_group_receipts", primaryKey: "id" },
  { table: "partner_parlours", primaryKey: "id" },
  { table: "parlour_personnel", primaryKey: "id" },
  { table: "mortuary_intakes", primaryKey: "id" },
  { table: "mortuary_dispatches", primaryKey: "id" },
  { table: "mortuary_post_mortem_movements", primaryKey: "id" },
  { table: "partner_parlour_vehicle_usage", primaryKey: "id" },
  { table: "deceased_belongings", primaryKey: "id" },
  { table: "body_wash_requirements", primaryKey: "id" },
  { table: "driver_checklists", primaryKey: "id" },
  { table: "reminders", primaryKey: "id" },
  { table: "org_member_sequences", primaryKey: "organization_id" },
  { table: "org_policy_sequences", primaryKey: "organization_id" },
  { table: "permissions", primaryKey: "id" },
  { table: "role_permissions", primaryKey: "role_id,permission_id" },
  { table: "security_questions", primaryKey: "id" },
  { table: "benefit_catalog_items", primaryKey: "id" },
  { table: "benefit_bundles", primaryKey: "id" },
  { table: "product_benefit_bundle_links", primaryKey: "id" },
  { table: "add_ons", primaryKey: "id" },
  { table: "age_band_configs", primaryKey: "id" },
  { table: "policy_add_ons", primaryKey: "id" },
  { table: "terms_and_conditions", primaryKey: "id" },
  { table: "price_book_items", primaryKey: "id" },
  { table: "fx_rates", primaryKey: "id" },
  { table: "cost_sheets", primaryKey: "id" },
  { table: "cost_line_items", primaryKey: "id" },
  { table: "user_permission_overrides", primaryKey: "id" },
  { table: "client_device_tokens", primaryKey: "id" },
  { table: "client_payment_methods", primaryKey: "id" },
  { table: "payment_automation_settings", primaryKey: "id" },
];

// ─── CONTROL PLANE TABLES (small, always full-synced) ──────────────────────
const CONTROL_PLANE_TABLES: FullSyncTableDef[] = [
  { table: "tenants", primaryKey: "id" },
  { table: "tenant_domains", primaryKey: "id" },
  { table: "tenant_databases", primaryKey: "tenant_id" },
  { table: "tenant_storage", primaryKey: "tenant_id" },
  { table: "tenant_integrations", primaryKey: "id" },
  { table: "tenant_branding", primaryKey: "tenant_id" },
  { table: "tenant_feature_flags", primaryKey: "tenant_id,flag" },
];

let backupTimer: ReturnType<typeof setTimeout> | null = null;

function getSupabaseUrl(): string | null {
  return process.env.SUPABASE_BACKUP_URL || null;
}

async function getBackupPool(): Promise<pg.Pool | null> {
  const url = getSupabaseUrl();
  if (!url) return null;
  return new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false },
  });
}

/** Helper: extract rows from a Drizzle execute result */
function extractRows(result: any): Record<string, any>[] {
  if (Array.isArray(result)) return result;
  if (result?.rows && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * Run full backup across all 3 DO databases → one Supabase DB.
 */
export async function runBackupSync(triggeredBy: "scheduler" | "manual" = "scheduler"): Promise<void> {
  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) {
    structuredLog("info", "Backup sync skipped: SUPABASE_BACKUP_URL not set");
    return;
  }

  // Advisory lock: only one instance runs the backup at a time under horizontal scaling
  const { pool: mainPool } = await import("./db");
  const lockResult = await mainPool.query("SELECT pg_try_advisory_lock(987654321) as acquired");
  if (!lockResult.rows[0]?.acquired) {
    structuredLog("info", "Backup sync skipped — another instance holds the advisory lock");
    return;
  }

  const startTime = Date.now();
  structuredLog("info", "Backup sync started");

  let backupPool: pg.Pool | null = null;
  let totalRows = 0;
  let tableCount = 0;
  const errors: string[] = [];

  const { cpDb: runLogDb } = await import("./control-plane-db");
  const { backupSyncRuns } = await import("@shared/control-plane-schema");
  const { eq: eqOp } = await import("drizzle-orm");
  let runId: string | null = null;
  try {
    const [created] = await runLogDb.insert(backupSyncRuns)
      .values({ startedAt: new Date(startTime), status: "running", triggeredBy })
      .returning({ id: backupSyncRuns.id });
    runId = created?.id ?? null;
  } catch (err) {
    structuredLog("warn", "Backup run-history insert failed (continuing without it)", { error: (err as Error).message });
  }

  try {
    backupPool = await getBackupPool();
    if (!backupPool) return;

    // ── 1. CONTROL PLANE DB (full sync — small tables) ──────────────
    try {
      const { cpDb } = await import("./control-plane-db");
      structuredLog("info", "Backup: syncing control-plane DB");
      for (const { table, primaryKey } of CONTROL_PLANE_TABLES) {
        try {
          const rows = extractRows(await cpDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("does not exist")) errors.push(`cp:${table}: ${msg}`);
        }
      }
    } catch (err) {
      errors.push(`control-plane connect: ${(err as Error).message}`);
    }

    // ── 2. REGISTRY / SHARED DB (organizations + users that live in shared DB) ──
    try {
      const { db: registryDb } = await import("./db");
      structuredLog("info", "Backup: syncing registry (shared) DB");
      // The shared DB has the same schema tables but only these are meaningful there.
      const registryTables: FullSyncTableDef[] = [
        { table: "organizations", primaryKey: "id" },
        { table: "users", primaryKey: "id" },
        { table: "sessions", primaryKey: "sid" },
        { table: "app_download_interests", primaryKey: "id" },
        { table: "app_releases", primaryKey: "id" },
      ];
      for (const { table, primaryKey } of registryTables) {
        try {
          const rows = extractRows(await registryDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("does not exist")) errors.push(`reg:${table}: ${msg}`);
        }
      }
    } catch (err) {
      errors.push(`registry connect: ${(err as Error).message}`);
    }

    // ── 3. TENANT DBS (Falakhe + any future isolated tenants) ───────
    const { db: registryDb2 } = await import("./db");
    const { organizations } = await import("@shared/schema");
    const { isNotNull } = await import("drizzle-orm");
    const orgsWithDb = await registryDb2
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(isNotNull(organizations.databaseUrl));

    // Also include orgs WITHOUT a dedicated DB (they use the shared DB)
    const orgsShared = await registryDb2
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations);

    // Deduplicate: sync isolated tenant DBs first, then shared-DB orgs
    const syncedOrgIds = new Set<string>();

    for (const org of orgsWithDb) {
      structuredLog("info", "Backup: syncing tenant DB", { orgId: org.id, orgName: org.name });
      syncedOrgIds.add(org.id);
      const tenantDb = await getDbForOrg(org.id);

      for (const { table, primaryKey } of TENANT_FULL_SYNC_TABLES) {
        try {
          const rows = extractRows(await tenantDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("does not exist")) errors.push(`${org.name}:${table}: ${msg}`);
        }
      }
    }

    // Shared-DB orgs (use the shared registry DB, which has the same tenant schema)
    for (const org of orgsShared) {
      if (syncedOrgIds.has(org.id)) continue; // already synced via dedicated DB
      structuredLog("info", "Backup: syncing shared-DB tenant", { orgId: org.id, orgName: org.name });
      const tenantDb = await getDbForOrg(org.id);

      for (const { table, primaryKey } of TENANT_FULL_SYNC_TABLES) {
        try {
          const rows = extractRows(await tenantDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("does not exist")) errors.push(`shared:${org.name}:${table}: ${msg}`);
        }
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    structuredLog("info", "Backup sync completed", {
      totalRows,
      tableCount,
      durationSec: duration,
      errors: errors.length > 0 ? errors.slice(0, 10) : undefined,
    });
    if (runId) {
      await runLogDb.update(backupSyncRuns).set({
        completedAt: new Date(),
        status: errors.length === 0 ? "success" : "partial",
        totalRows: String(totalRows),
        tableCount: String(tableCount),
        errorCount: String(errors.length),
        errors: errors.length > 0 ? errors.slice(0, 20) : null,
      }).where(eqOp(backupSyncRuns.id, runId)).catch((err) => {
        structuredLog("warn", "Backup run-history update failed", { error: (err as Error).message });
      });
    }
  } catch (err) {
    structuredLog("error", "Backup sync failed", { error: (err as Error).message });
    if (runId) {
      await runLogDb.update(backupSyncRuns).set({
        completedAt: new Date(),
        status: "failed",
        totalRows: String(totalRows),
        tableCount: String(tableCount),
        errorCount: String(errors.length + 1),
        errors: [...errors.slice(0, 19), `fatal: ${(err as Error).message}`],
      }).where(eqOp(backupSyncRuns.id, runId)).catch(() => {});
    }
  } finally {
    if (backupPool) await backupPool.end().catch(() => {});
    await mainPool.query("SELECT pg_advisory_unlock(987654321)").catch(() => {});
  }
}

/**
 * Upsert rows into the backup database using ON CONFLICT DO UPDATE.
 */
async function upsertRows(
  pool: pg.Pool,
  table: string,
  primaryKey: string,
  rows: Record<string, any>[]
): Promise<void> {
  if (rows.length === 0) return;

  const client = await pool.connect();
  try {
    const columns = Object.keys(rows[0]);
    const pkCols = primaryKey.split(",").map((c) => c.trim());
    const nonPkCols = columns.filter((c) => !pkCols.includes(c));

    // Disable FK checks during backup upsert (data arrives in non-dependency order)
    await client.query("SET session_replication_role = replica");

    // Build batch insert in chunks to avoid exceeding parameter limits
    const CHUNK_SIZE = 100;
    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      const values: any[] = [];
      const valuePlaceholders: string[] = [];

      for (const row of chunk) {
        const rowValues = columns.map((col) => {
          const val = row[col];
          // Serialize objects/arrays to JSON string for jsonb columns
          if (val !== null && typeof val === "object" && !(val instanceof Date)) {
            return JSON.stringify(val);
          }
          return val;
        });
        const offset = values.length;
        const placeholders = rowValues.map((_, idx) => `$${offset + idx + 1}`);
        valuePlaceholders.push(`(${placeholders.join(", ")})`);
        values.push(...rowValues);
      }

      const colList = columns.map((c) => `"${c}"`).join(", ");
      const conflictCols = pkCols.map((c) => `"${c}"`).join(", ");
      const updateSet =
        nonPkCols.length > 0
          ? nonPkCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ")
          : pkCols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(", "); // no-op update for insert-only tables

      const query = `
        INSERT INTO "${table}" (${colList})
        VALUES ${valuePlaceholders.join(", ")}
        ON CONFLICT (${conflictCols}) DO UPDATE SET ${updateSet}
      `;

      await client.query(query, values);
    }

    // Re-enable FK checks
    await client.query("SET session_replication_role = DEFAULT");
  } finally {
    client.release();
  }
}

/**
 * Schedule the backup to run daily. Calculates ms until next midnight (UTC+2).
 */
export function startBackupScheduler(): void {
  if (!getSupabaseUrl()) {
    structuredLog("info", "Backup scheduler not started: SUPABASE_BACKUP_URL not set");
    return;
  }

  const scheduleNext = () => {
    const now = new Date();
    // Calculate next midnight in UTC+2 (SAST/CAT)
    const targetHour = 22; // 00:00 UTC+2 = 22:00 UTC
    const next = new Date(now);
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next <= now) {
      next.setUTCDate(next.getUTCDate() + 1);
    }
    const msUntilMidnight = next.getTime() - now.getTime();

    structuredLog("info", "Backup scheduled", {
      nextRun: next.toISOString(),
      msUntilRun: msUntilMidnight,
    });

    backupTimer = setTimeout(async () => {
      await runBackupSync();
      scheduleNext(); // schedule the next one
    }, msUntilMidnight);
  };

  scheduleNext();
}

export function stopBackupScheduler(): void {
  if (backupTimer) {
    clearTimeout(backupTimer);
    backupTimer = null;
  }
}

/** Recent backup run history, most recent first — for a health-check UI/route. */
export async function getRecentBackupRuns(limit = 20) {
  const { cpDb } = await import("./control-plane-db");
  const { backupSyncRuns } = await import("@shared/control-plane-schema");
  const { desc } = await import("drizzle-orm");
  return cpDb.select().from(backupSyncRuns).orderBy(desc(backupSyncRuns.startedAt)).limit(limit);
}
