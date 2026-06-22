/**
 * Incremental Backup Sync — mirrors recent changes to a Supabase backup DB.
 *
 * Runs daily at midnight (00:00 UTC+2) via an in-process scheduler.
 * Syncs data from ALL THREE DigitalOcean databases into one Supabase DB:
 *   1. pol263 (shared registry) — organizations, shared users
 *   2. pol263-control-plane — tenants, domains, branding, integrations
 *   3. pol263-falakhe (+ any future tenant DBs) — clients, policies, payments, etc.
 *
 * Uses ON CONFLICT upserts so it is idempotent and safe to re-run.
 *
 * ENV: SUPABASE_BACKUP_URL — the Supabase pooler connection string (port 6543).
 *      If not set, the backup is silently skipped.
 */
import pg from "pg";
import { structuredLog } from "./logger";
import { getDbForOrg } from "./tenant-db";
import { sql } from "drizzle-orm";

const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface SyncTableDef { table: string; timestampCol: string; primaryKey: string }
interface FullSyncTableDef { table: string; primaryKey: string }

// ─── TENANT DB TABLES (per-org: Falakhe, future tenants) ───────────────────
const TENANT_SYNC_TABLES: SyncTableDef[] = [
  { table: "organizations", timestampCol: "created_at", primaryKey: "id" },
  { table: "branches", timestampCol: "created_at", primaryKey: "id" },
  { table: "users", timestampCol: "created_at", primaryKey: "id" },
  { table: "roles", timestampCol: "created_at", primaryKey: "id" },
  { table: "user_roles", timestampCol: "created_at", primaryKey: "id" },
  { table: "clients", timestampCol: "created_at", primaryKey: "id" },
  { table: "dependents", timestampCol: "created_at", primaryKey: "id" },
  { table: "products", timestampCol: "created_at", primaryKey: "id" },
  { table: "product_versions", timestampCol: "created_at", primaryKey: "id" },
  { table: "policies", timestampCol: "created_at", primaryKey: "id" },
  { table: "policy_members", timestampCol: "created_at", primaryKey: "id" },
  { table: "policy_status_history", timestampCol: "created_at", primaryKey: "id" },
  { table: "payment_transactions", timestampCol: "created_at", primaryKey: "id" },
  { table: "payment_intents", timestampCol: "created_at", primaryKey: "id" },
  { table: "payment_events", timestampCol: "created_at", primaryKey: "id" },
  { table: "payment_receipts", timestampCol: "created_at", primaryKey: "id" },
  { table: "claims", timestampCol: "created_at", primaryKey: "id" },
  { table: "claim_documents", timestampCol: "uploaded_at", primaryKey: "id" },
  { table: "claim_status_history", timestampCol: "created_at", primaryKey: "id" },
  { table: "funeral_cases", timestampCol: "created_at", primaryKey: "id" },
  { table: "funeral_tasks", timestampCol: "created_at", primaryKey: "id" },
  { table: "commission_ledger_entries", timestampCol: "created_at", primaryKey: "id" },
  { table: "commission_plans", timestampCol: "created_at", primaryKey: "id" },
  { table: "leads", timestampCol: "created_at", primaryKey: "id" },
  { table: "expenditures", timestampCol: "created_at", primaryKey: "id" },
  { table: "cashups", timestampCol: "created_at", primaryKey: "id" },
  { table: "notification_logs", timestampCol: "created_at", primaryKey: "id" },
  { table: "audit_logs", timestampCol: "timestamp", primaryKey: "id" },
  { table: "groups", timestampCol: "created_at", primaryKey: "id" },
  { table: "fleet_vehicles", timestampCol: "created_at", primaryKey: "id" },
  { table: "outbox_messages", timestampCol: "created_at", primaryKey: "id" },
  { table: "month_end_runs", timestampCol: "created_at", primaryKey: "id" },
  { table: "credit_notes", timestampCol: "created_at", primaryKey: "id" },
  { table: "receipts", timestampCol: "issued_at", primaryKey: "id" },
  { table: "reversal_entries", timestampCol: "created_at", primaryKey: "id" },
  { table: "platform_receivables", timestampCol: "created_at", primaryKey: "id" },
  { table: "settlements", timestampCol: "created_at", primaryKey: "id" },
  { table: "settlement_allocations", timestampCol: "created_at", primaryKey: "id" },
  { table: "payroll_employees", timestampCol: "created_at", primaryKey: "id" },
  { table: "payroll_runs", timestampCol: "created_at", primaryKey: "id" },
  { table: "payslips", timestampCol: "created_at", primaryKey: "id" },
  { table: "approval_requests", timestampCol: "created_at", primaryKey: "id" },
  { table: "requisitions", timestampCol: "created_at", primaryKey: "id" },
  { table: "funeral_quotations", timestampCol: "created_at", primaryKey: "id" },
  { table: "service_receipts", timestampCol: "created_at", primaryKey: "id" },
  { table: "client_feedback", timestampCol: "created_at", primaryKey: "id" },
  { table: "dependent_change_requests", timestampCol: "created_at", primaryKey: "id" },
  { table: "group_payment_intents", timestampCol: "created_at", primaryKey: "id" },
  { table: "group_payment_allocations", timestampCol: "created_at", primaryKey: "id" },
  { table: "payment_automation_runs", timestampCol: "created_at", primaryKey: "id" },
  { table: "directory_contacts", timestampCol: "created_at", primaryKey: "id" },
];

const TENANT_FULL_SYNC_TABLES: FullSyncTableDef[] = [
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
  // fx_rates is a small reference table; funeral_quotation_items has no timestamp column,
  // so both are full-synced rather than incrementally synced by created_at.
  { table: "fx_rates", primaryKey: "id" },
  { table: "funeral_quotation_items", primaryKey: "id" },
  { table: "cost_sheets", primaryKey: "id" },
  { table: "cost_line_items", primaryKey: "id" },
  { table: "notification_templates", primaryKey: "id" },
  { table: "user_permission_overrides", primaryKey: "id" },
  { table: "client_device_tokens", primaryKey: "id" },
  { table: "client_payment_methods", primaryKey: "id" },
  { table: "payment_automation_settings", primaryKey: "id" },
  { table: "policy_credit_balances", primaryKey: "id" },
  { table: "fleet_maintenance", primaryKey: "id" },
  { table: "fleet_fuel_logs", primaryKey: "id" },
  { table: "driver_assignments", primaryKey: "id" },
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
 * Run incremental backup across all 3 DO databases → one Supabase DB.
 */
export async function runBackupSync(): Promise<void> {
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
  const cutoff = new Date(Date.now() - BACKUP_INTERVAL_MS).toISOString();

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
      // The shared DB has the same schema tables but only organizations + users matter
      const registryTables: SyncTableDef[] = [
        { table: "organizations", timestampCol: "created_at", primaryKey: "id" },
        { table: "users", timestampCol: "created_at", primaryKey: "id" },
        { table: "sessions", timestampCol: "expire", primaryKey: "sid" },
      ];
      for (const { table, timestampCol, primaryKey } of registryTables) {
        try {
          const rows = extractRows(await registryDb.execute(
            sql.raw(`SELECT * FROM "${table}" WHERE "${timestampCol}" >= '${cutoff}'`)
          ));
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

      // Incremental sync
      for (const { table, timestampCol, primaryKey } of TENANT_SYNC_TABLES) {
        try {
          const rows = extractRows(await tenantDb.execute(
            sql.raw(`SELECT * FROM "${table}" WHERE "${timestampCol}" >= '${cutoff}'`)
          ));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!msg.includes("does not exist")) errors.push(`${org.name}:${table}: ${msg}`);
        }
      }

      // Full sync for reference tables
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

      for (const { table, timestampCol, primaryKey } of TENANT_SYNC_TABLES) {
        try {
          const rows = extractRows(await tenantDb.execute(
            sql.raw(`SELECT * FROM "${table}" WHERE "${timestampCol}" >= '${cutoff}'`)
          ));
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
  } catch (err) {
    structuredLog("error", "Backup sync failed", { error: (err as Error).message });
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
