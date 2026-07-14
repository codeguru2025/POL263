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
 * Table lists are discovered dynamically from each source database's own
 * information_schema (see discoverSyncTables) rather than hand-maintained
 * arrays — a hardcoded table list here, a hardcoded list in
 * script/full-sync-to-supabase.ts, and the migrations/*.sql file sequence
 * (used by script/run-migrations.ts) had all independently drifted out of
 * sync with `shared/schema.ts` and with each other by 2026-07-14, in three
 * different directions, none of it visible until someone went looking for it
 * — see docs/BUGFIX-LOG.md. Discovering tables/columns/primary-keys live from
 * whichever database is actually being read, every run, means this can't
 * happen again the same way: whatever the source database's real schema is,
 * that's what gets synced, and reconcileSchemaForSource (below) brings the
 * backup's structure up to match before every sync rather than assuming it
 * already does.
 *
 * ENV: SUPABASE_BACKUP_URL — the Supabase pooler connection string (port 6543).
 *      If not set, the backup is silently skipped.
 */
import pg from "pg";
import { structuredLog } from "./logger";
import { getDbForOrg } from "./tenant-db";
import { sql } from "drizzle-orm";

interface FullSyncTableDef { table: string; primaryKey: string }

/** Tables that are app-internal bookkeeping, not data worth mirroring. */
const SYNC_EXCLUDE_TABLES = new Set(["schema_migrations"]);

let backupTimer: ReturnType<typeof setTimeout> | null = null;

function getSupabaseUrl(): string | null {
  return process.env.SUPABASE_BACKUP_URL || null;
}

async function getBackupPool(): Promise<pg.Pool | null> {
  const url = getSupabaseUrl();
  if (!url) return null;
  const pool = new pg.Pool({
    connectionString: url,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: { rejectUnauthorized: false },
  });
  // pg.Pool emits 'error' when an already-idle client hits a backend/network error (e.g. the
  // connection is dropped while sitting idle in the pool). With no listener, Node treats that
  // as an uncaught exception and kills the entire process instantly — bypassing every
  // try/catch/finally in this file, including the advisory-lock release, which is exactly the
  // failure mode that left a stuck lock blocking every subsequent sync attempt (2026-07-14).
  pool.on("error", (err) => {
    structuredLog("error", "Backup pool: idle client error (connection dropped, not fatal to the run)", { error: err.message });
  });
  return pool;
}

/**
 * True only for "relation does not exist" (Postgres code 42P01) — the one error this sync
 * intentionally tolerates (a table that legitimately doesn't exist yet on the destination,
 * e.g. a brand-new tenant DB before its first schema push). Deliberately NOT matched by a
 * generic message.includes("does not exist") string check, which used to also swallow
 * "column ... does not exist" (42703) — i.e. a table that exists but is missing a column,
 * which caused an entire table's rows to silently fail to sync, run after run, with no
 * visible error anywhere. That gap (groups, payment_receipts, and others) went unnoticed for
 * an extended period — see docs/BUGFIX-LOG.md, 2026-07-14.
 */
function isMissingRelationError(err: unknown): boolean {
  return (err as any)?.code === "42P01";
}

/** Helper: extract rows from a Drizzle execute result */
function extractRows(result: any): Record<string, any>[] {
  if (Array.isArray(result)) return result;
  if (result?.rows && Array.isArray(result.rows)) return result.rows;
  return [];
}

/**
 * Returns the best available ON CONFLICT target for a table: its formal PRIMARY KEY if it has
 * one, otherwise the columns of any unique index on it (Postgres accepts ON CONFLICT against
 * any unique index, not just a formally-declared PRIMARY KEY/UNIQUE constraint — some tables
 * in this codebase, e.g. role_permissions, tenant_feature_flags, only have a plain `CREATE
 * UNIQUE INDEX`, which information_schema.table_constraints doesn't surface at all). Returns
 * "" if the table genuinely has neither.
 */
async function getConflictKeyCols(db: any, table: string): Promise<string> {
  const pkRows = extractRows(await db.execute(sql.raw(`
    SELECT kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = 'public' AND tc.table_name = '${table}' AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY kcu.ordinal_position
  `)));
  if (pkRows.length) return pkRows.map((r: any) => r.column_name).join(",");

  const uniqueIndexRows = extractRows(await db.execute(sql.raw(`
    SELECT i.indexrelid::regclass::text AS index_name
    FROM pg_index i
    WHERE i.indrelid = '${table}'::regclass AND i.indisunique AND i.indisvalid
    ORDER BY i.indisprimary DESC
    LIMIT 1
  `)));
  if (!uniqueIndexRows.length) return "";

  const colRows = extractRows(await db.execute(sql.raw(`
    SELECT a.attname AS column_name
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indexrelid = '${uniqueIndexRows[0].index_name}'::regclass
    ORDER BY array_position(i.indkey, a.attnum)
  `)));
  return colRows.map((r: any) => r.column_name).join(",");
}

/**
 * Discovers every base table (and its ON CONFLICT key) directly from a source database's
 * information_schema — replaces the hand-maintained table arrays this file used to have.
 * Tables with neither a primary key nor a unique index are skipped (upsertRows needs one) and
 * logged — this should be rare; every table synced today has one or the other.
 */
async function discoverSyncTables(db: any, label: string): Promise<FullSyncTableDef[]> {
  const tableRows = extractRows(await db.execute(sql.raw(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
  )));
  const tables = tableRows.map((r: any) => r.table_name as string).filter((t: string) => !SYNC_EXCLUDE_TABLES.has(t));

  const result: FullSyncTableDef[] = [];
  for (const table of tables) {
    const primaryKey = await getConflictKeyCols(db, table);
    if (!primaryKey) {
      structuredLog("warn", "Backup sync: table has no primary key or unique index, skipping", { label, table });
      continue;
    }
    result.push({ table, primaryKey });
  }
  return result;
}

function backupColumnDefSql(col: any): string {
  let type = col.data_type as string;
  if (type === "character varying") type = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : "VARCHAR";
  else if (type === "numeric") type = col.numeric_precision ? `NUMERIC(${col.numeric_precision}${col.numeric_scale != null ? `,${col.numeric_scale}` : ""})` : "NUMERIC";
  else if (type === "timestamp without time zone") type = "TIMESTAMP";
  else if (type === "timestamp with time zone") type = "TIMESTAMPTZ";
  else if (type === "ARRAY") type = "TEXT[]";
  else type = type.toUpperCase();

  let def = "";
  if (col.column_default != null) {
    // Sequence-based defaults (nextval) would reference an object that doesn't exist on the
    // backup DB — only carry over safe, self-contained defaults.
    if (!/^nextval\(/i.test(col.column_default)) def = ` DEFAULT ${col.column_default}`;
  }
  const notNull = col.is_nullable === "NO" ? " NOT NULL" : "";
  return `"${col.column_name}" ${type}${def}${notNull}`;
}

/**
 * Brings the backup DB's structure up to match a source database — creates any table that
 * doesn't exist yet on the backup and adds any column that's missing, using real
 * information_schema metadata from the source (not a hand-maintained list, not Drizzle's
 * in-memory type mapping). Always additive: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT
 * EXISTS, never drops or alters existing columns — safe to run before every sync.
 *
 * This exists because a table/column present on the source but missing on the backup doesn't
 * just skip that table — it makes upsertRows's single multi-row INSERT fail atomically for the
 * *whole* table, silently, forever, until someone happens to compare row counts. See
 * docs/BUGFIX-LOG.md, 2026-07-14, for the incident this was written in response to.
 */
async function reconcileSchemaForSource(
  sourceDb: any,
  backupPool: pg.Pool,
  tables: FullSyncTableDef[],
  label: string
): Promise<void> {
  for (const { table } of tables) {
    try {
      const existsRows = await backupPool.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]
      );
      const sourceCols = extractRows(await sourceDb.execute(sql.raw(`
        SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}' ORDER BY ordinal_position
      `)));

      if (existsRows.rows.length === 0) {
        const conflictKey = await getConflictKeyCols(sourceDb, table);
        const pkCols = conflictKey ? conflictKey.split(",") : [];
        const colDefs = sourceCols.map(backupColumnDefSql);
        const pkClause = pkCols.length ? `,\n  PRIMARY KEY (${pkCols.map(c => `"${c}"`).join(", ")})` : "";
        const ddl = `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${colDefs.join(",\n  ")}${pkClause}\n)`;
        await backupPool.query(ddl);
        structuredLog("info", "Backup schema: created missing table", { label, table });
        continue;
      }

      const targetColRows = await backupPool.query(
        `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`, [table]
      );
      const targetCols = new Set(targetColRows.rows.map((r: any) => r.column_name));
      const missing = sourceCols.filter((c: any) => !targetCols.has(c.column_name));
      for (const col of missing) {
        const ddl = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${backupColumnDefSql(col)}`;
        try {
          await backupPool.query(ddl);
          structuredLog("info", "Backup schema: added missing column", { label, table, column: col.column_name });
        } catch (err: any) {
          // NOT NULL without a usable default fails against a table that already has rows —
          // retry nullable rather than losing the whole column.
          if (err.code === "23502" || /null value|not-null/i.test(err.message)) {
            await backupPool.query(ddl.replace(/ NOT NULL$/, ""));
            structuredLog("warn", "Backup schema: added missing column as nullable (existing rows)", { label, table, column: col.column_name });
          } else {
            throw err;
          }
        }
      }
    } catch (err) {
      structuredLog("error", "Backup schema reconciliation failed for table", { label, table, error: (err as Error).message });
    }
  }
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

  // Advisory lock: only one instance runs the backup at a time under horizontal scaling.
  // Postgres advisory locks are session-scoped — acquiring and releasing via pool.query()
  // (two independent checkouts) doesn't guarantee the same underlying connection, so the
  // unlock can silently no-op on a different session while the original connection keeps
  // holding the lock, permanently, until that pooled connection happens to close. Checking
  // out a single dedicated client and holding it for the lock's entire lifetime (release in
  // `finally`) is the only way to guarantee acquire and release happen on the same session.
  const { pool: mainPool } = await import("./db");
  const lockClient = await mainPool.connect();
  const lockResult = await lockClient.query("SELECT pg_try_advisory_lock(987654321) as acquired");
  if (!lockResult.rows[0]?.acquired) {
    lockClient.release();
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

    // ── 1. CONTROL PLANE DB ──────────────────────────────────────────
    try {
      const { cpDb } = await import("./control-plane-db");
      structuredLog("info", "Backup: syncing control-plane DB");
      const cpTables = await discoverSyncTables(cpDb, "cp");
      await reconcileSchemaForSource(cpDb, backupPool, cpTables, "cp");
      for (const { table, primaryKey } of cpTables) {
        try {
          const rows = extractRows(await cpDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!isMissingRelationError(err)) errors.push(`cp:${table}: ${msg}`);
        }
      }
    } catch (err) {
      errors.push(`control-plane connect: ${(err as Error).message}`);
    }

    // ── 2. REGISTRY / SHARED DB — covers organizations/users/sessions AND every
    //    tenant-scoped table (policies, clients, ...) for orgs without a dedicated DB,
    //    since those live in this same physical database. ─────────────────────
    let registryTables: FullSyncTableDef[] = [];
    try {
      const { db: registryDb } = await import("./db");
      structuredLog("info", "Backup: syncing registry (shared) DB");
      registryTables = await discoverSyncTables(registryDb, "reg");
      await reconcileSchemaForSource(registryDb, backupPool, registryTables, "reg");
      for (const { table, primaryKey } of registryTables) {
        try {
          const rows = extractRows(await registryDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!isMissingRelationError(err)) errors.push(`reg:${table}: ${msg}`);
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

    // Also include orgs WITHOUT a dedicated DB (they use the shared DB, already fully
    // synced above via registryTables — nothing further to do for them here).
    const orgsShared = await registryDb2
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations);

    const syncedOrgIds = new Set<string>(orgsWithDb.map((o) => o.id));

    for (const org of orgsWithDb) {
      structuredLog("info", "Backup: syncing tenant DB", { orgId: org.id, orgName: org.name });
      const tenantDb = await getDbForOrg(org.id);
      const tenantTables = await discoverSyncTables(tenantDb, org.name);
      await reconcileSchemaForSource(tenantDb, backupPool, tenantTables, org.name);

      for (const { table, primaryKey } of tenantTables) {
        try {
          const rows = extractRows(await tenantDb.execute(sql.raw(`SELECT * FROM "${table}"`)));
          if (rows.length === 0) continue;
          await upsertRows(backupPool, table, primaryKey, rows);
          totalRows += rows.length;
          tableCount++;
        } catch (err) {
          const msg = (err as Error).message;
          if (!isMissingRelationError(err)) errors.push(`${org.name}:${table}: ${msg}`);
        }
      }
    }

    const skippedSharedOrgs = orgsShared.filter((o) => !syncedOrgIds.has(o.id)).map((o) => o.name);
    if (skippedSharedOrgs.length) {
      structuredLog("info", "Backup: shared-DB tenants covered by registry sync above", { orgs: skippedSharedOrgs });
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
    await lockClient.query("SELECT pg_advisory_unlock(987654321)").catch(() => {});
    lockClient.release();
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
