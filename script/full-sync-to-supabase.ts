/**
 * Bring the Supabase backup to PARITY with DigitalOcean — every table, every row, and no rows DO
 * no longer has.
 *
 *   npx tsx script/full-sync-to-supabase.ts            # sync + REPORT what would be pruned
 *   npx tsx script/full-sync-to-supabase.ts --prune    # sync + delete backup rows gone from DO
 *
 * Step 1 is exactly the nightly job (server/backup-sync.ts runBackupSync): tables discovered live
 * from each DO database (control plane, shared registry, every dedicated tenant DB), missing
 * tables/columns created on the backup first, full upsert. (This file used to have its own
 * hardcoded table list, which had drifted — it missed every table added since mid-2026.)
 *
 * Step 2 is what the nightly job deliberately never does: delete backup rows whose key no longer
 * exists in ANY DO source for that table (the backup merges all sources into one database, so a
 * table like `policies` is the union of the shared DB and each tenant DB). A table is only pruned
 * when every source that has it was read completely — a failed/partial read never deletes anything.
 * Tables that exist only on the backup are left alone.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { runBackupSync, discoverSyncTables, getBackupPool } from "../server/backup-sync";
import { getDbForOrg } from "../server/tenant-db";

const PRUNE = process.argv.includes("--prune");
const DELETE_BATCH = 500;

type Source = { label: string; db: any };

function rowsOf(r: any): any[] {
  return Array.isArray(r) ? r : r?.rows ?? [];
}

async function main() {
  console.log("Step 1 — full upsert sync (same code path as the nightly backup)…");
  await runBackupSync("manual");

  const { cpDb } = await import("../server/control-plane-db");
  const { db: registryDb } = await import("../server/db");
  const { organizations } = await import("@shared/schema");
  const { isNotNull } = await import("drizzle-orm");

  const sources: Source[] = [{ label: "cp", db: cpDb }, { label: "registry", db: registryDb }];
  const dedicated = await registryDb.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(isNotNull(organizations.databaseUrl));
  for (const o of dedicated) sources.push({ label: o.name, db: await getDbForOrg(o.id) });

  // table -> { pk columns, union of key tuples, whether every read succeeded }
  const union = new Map<string, { pk: string[]; keys: Set<string>; complete: boolean; from: string[] }>();
  for (const src of sources) {
    const tables = await discoverSyncTables(src.db, src.label);
    for (const { table, primaryKey } of tables) {
      const pk = primaryKey.split(",").map((c) => c.trim());
      const entry = union.get(table) ?? { pk, keys: new Set<string>(), complete: true, from: [] };
      entry.from.push(src.label);
      if (entry.pk.join(",") !== pk.join(",")) {
        entry.complete = false; // key definition differs between sources — don't guess
      } else {
        try {
          const cols = pk.map((c) => `"${c}"::text`).join(", ");
          const rows = rowsOf(await src.db.execute(sql.raw(`SELECT ${cols} FROM "${table}"`)));
          for (const r of rows) entry.keys.add(JSON.stringify(pk.map((c) => r[c])));
        } catch (err: any) {
          entry.complete = false;
          console.log(`  (cannot prune ${table}: read from ${src.label} failed — ${err?.message})`);
        }
      }
      union.set(table, entry);
    }
  }

  console.log(`\nStep 2 — ${PRUNE ? "PRUNING" : "dry run: would prune"} backup rows no longer on DO…`);
  const backup = await getBackupPool();
  if (!backup) throw new Error("SUPABASE_BACKUP_URL not set");
  let totalStale = 0;
  try {
    for (const [table, { pk, keys, complete, from }] of Array.from(union.entries()).sort()) {
      if (!complete) continue;
      const exists = await backup.query(`SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]);
      if (!exists.rows.length) continue;
      const { rows } = await backup.query(`SELECT ${pk.map((c) => `"${c}"::text AS "${c}"`).join(", ")} FROM "${table}"`);
      const stale = rows.filter((r: any) => !keys.has(JSON.stringify(pk.map((c) => r[c]))));
      if (!stale.length) continue;
      totalStale += stale.length;
      console.log(`  ${table}: ${stale.length} stale of ${rows.length} (sources: ${from.join(", ")})`);
      if (!PRUNE) continue;
      const client = await backup.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica"); // FK order doesn't matter in a backup
        for (let i = 0; i < stale.length; i += DELETE_BATCH) {
          const batch = stale.slice(i, i + DELETE_BATCH);
          const params: any[] = [];
          const tuples = batch.map((r: any) => `(${pk.map((c) => { params.push(r[c]); return `$${params.length}`; }).join(", ")})`);
          await client.query(`DELETE FROM "${table}" WHERE (${pk.map((c) => `"${c}"::text`).join(", ")}) IN (${tuples.join(", ")})`, params);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    }
  } finally {
    await backup.end();
  }
  console.log(`\n${PRUNE ? "Deleted" : "Would delete"} ${totalStale} stale backup row(s).${PRUNE ? "" : " Re-run with --prune to apply."}`);
}

main().then(() => process.exit(0)).catch((err) => { console.error("FAILED:", err?.message ?? err); process.exit(1); });
