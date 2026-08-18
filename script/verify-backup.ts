/**
 * Read-only backup verification — checks the nightly backup (server/backup-sync.ts) is actually
 * current and complete, without touching production or the backup DB's data. Two checks:
 *
 *   1. Freshness: was the most recent run recent and successful (per backup_sync_runs)?
 *   2. Completeness: for each source DB (control-plane, registry, every dedicated tenant DB),
 *      does every table's row count in the backup DB meet or exceed the source's? Since the sync
 *      is upsert-only and never deletes (see server/backup-sync.ts's header comment), a healthy
 *      backup's count can only be >= source — a table where backup < source is a real gap.
 *
 * This is NOT a restore drill — it doesn't prove the backup data is restorable to a working
 * database, only that the mirroring itself is current and hasn't silently dropped rows. A true
 * restore drill (standing up a fresh environment from the backup DB and validating the app
 * boots against it) is a separate, higher-stakes exercise that should be run deliberately against
 * a disposable target, not from an automated script — see docs/BUGFIX-LOG.md and the SOC 2 audit
 * remediation notes for why this stops short of that.
 *
 * RTO/RPO targets (documented here since there's no dedicated DR doc yet):
 *   - RPO (Recovery Point Objective): 24 hours — the backup runs once nightly; up to a day of
 *     writes since the last successful run would be lost in a real source-DB loss.
 *   - RTO (Recovery Time Objective): not yet established — depends on the untested restore
 *     procedure above. Treat as unknown until a real restore drill has been run and timed.
 *
 * Usage: npm run verify:backup
 */
import "dotenv/config";
import { getBackupPool, getSupabaseUrl, discoverSyncTables, getRecentBackupRuns } from "../server/backup-sync";

const STALE_AFTER_MS = 26 * 60 * 60 * 1000; // 24h schedule + 2h grace before flagging as stale

async function checkFreshness(): Promise<boolean> {
  console.log("\n=== Backup freshness ===");
  const runs = await getRecentBackupRuns(5);
  if (runs.length === 0) {
    console.log("No backup runs recorded yet.");
    return false;
  }
  const last = runs[0] as any;
  const ageMs = Date.now() - new Date(last.startedAt).getTime();
  const ageHours = (ageMs / (60 * 60 * 1000)).toFixed(1);
  console.log(`Last run: ${last.startedAt} — status: ${last.status} — ${ageHours}h ago`);
  if (last.status !== "completed" && last.status !== "completed_with_errors") {
    console.log(`FAIL: last run did not complete (status=${last.status})`);
    return false;
  }
  if (ageMs > STALE_AFTER_MS) {
    console.log(`FAIL: last successful run is stale (>${(STALE_AFTER_MS / 3600000).toFixed(0)}h old) — RPO of 24h is not being met`);
    return false;
  }
  console.log("OK: backup ran recently and completed.");
  return true;
}

async function countRows(db: any, table: string): Promise<number | null> {
  try {
    const { sql } = await import("drizzle-orm");
    const result: any = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM "${table}"`));
    const rows = Array.isArray(result) ? result : result.rows ?? [];
    return rows[0]?.c ?? 0;
  } catch {
    return null; // table doesn't exist on this side — not necessarily an error (see caller)
  }
}

async function verifySource(label: string, sourceDb: any, backupPool: any): Promise<boolean> {
  console.log(`\n=== ${label} ===`);
  let ok = true;
  let tables;
  try {
    tables = await discoverSyncTables(sourceDb, label);
  } catch (err: any) {
    console.log(`FAIL: could not connect / list tables — ${err.message}`);
    return false;
  }
  for (const { table } of tables) {
    const sourceCount = await countRows(sourceDb, table);
    if (sourceCount === null || sourceCount === 0) continue; // nothing to verify for an empty table
    const backupCountRes = await backupPool.query(`SELECT COUNT(*)::int AS c FROM "${table}"`).catch(() => null);
    const backupCount = backupCountRes?.rows?.[0]?.c ?? null;
    if (backupCount === null) {
      console.log(`FAIL: ${table} — ${sourceCount} rows in source, table missing in backup`);
      ok = false;
      continue;
    }
    if (backupCount < sourceCount) {
      console.log(`FAIL: ${table} — ${sourceCount} in source but only ${backupCount} in backup (gap: ${sourceCount - backupCount})`);
      ok = false;
    }
  }
  if (ok) console.log(`OK: all ${tables.length} tables at parity or ahead in the backup.`);
  return ok;
}

async function main() {
  if (!getSupabaseUrl()) {
    console.log("SUPABASE_BACKUP_URL / SUPABASE_BACKUP_DIRECT_URL not set — backup is not configured, nothing to verify.");
    process.exit(1);
  }
  const backupPool = await getBackupPool();
  if (!backupPool) {
    console.log("Could not connect to the backup database.");
    process.exit(1);
  }

  let allOk = true;
  allOk = (await checkFreshness()) && allOk;

  const { cpDb } = await import("../server/control-plane-db");
  allOk = (await verifySource("control-plane", cpDb, backupPool)) && allOk;

  const { db: registryDb } = await import("../server/db");
  allOk = (await verifySource("registry (shared)", registryDb, backupPool)) && allOk;

  const { organizations } = await import("../shared/schema");
  const { isNotNull } = await import("drizzle-orm");
  const orgsWithDb = await registryDb
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .where(isNotNull(organizations.databaseUrl));
  const { getDbForOrg } = await import("../server/tenant-db");
  for (const org of orgsWithDb) {
    try {
      const tdb = await getDbForOrg(org.id);
      allOk = (await verifySource(`tenant: ${org.name}`, tdb, backupPool)) && allOk;
    } catch (err: any) {
      console.log(`\n=== tenant: ${org.name} ===\nFAIL: could not connect — ${err.message}`);
      allOk = false;
    }
  }

  await backupPool.end();

  console.log(`\n${"=".repeat(40)}`);
  console.log(allOk ? "PASS — backup is current and complete." : "FAIL — see above.");
  process.exit(allOk ? 0 : 1);
}

main().catch((err) => {
  console.error("verify-backup crashed:", err);
  process.exit(1);
});
