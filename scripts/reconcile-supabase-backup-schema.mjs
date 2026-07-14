/**
 * Reconciles the Supabase backup DB's schema against the main DB (source of truth) —
 * creates any entirely-missing tables and adds any missing columns, using real column
 * metadata introspected from the main DB rather than guessing types. Skips foreign keys
 * (the backup-sync jobs already disable FK checking via session_replication_role=replica,
 * so referential integrity isn't load-bearing here) but preserves the primary key, since
 * ON CONFLICT upserts in backup-sync.ts / full-sync-to-supabase.ts depend on it.
 *
 * Written because `npm run db:push:backup` (drizzle-kit push) cannot run headless here —
 * it hits an interactive rename-detection prompt requiring a real TTY.
 *
 * Usage: node scripts/reconcile-supabase-backup-schema.mjs [--dry-run]
 */
import "dotenv/config";
import pg from "pg";

const DRY_RUN = process.argv.includes("--dry-run");

const mainUrl = process.env.DATABASE_URL.replace(/[?&]sslmode=[^&]*/gi, "");
// Session pooler (5432) for DDL — transaction pooler (6543) blocks it (see drizzle.backup.config.ts).
const sbUrl = (process.env.SUPABASE_BACKUP_URL || process.env.SUPABASE_BACKUP_DIRECT_URL)
  .replace(/[?&]sslmode=[^&]*/gi, "")
  .replace(/:6543\//, ":5432/");

const mainPool = new pg.Pool({ connectionString: mainUrl, ssl: { rejectUnauthorized: false } });
const sbPool = new pg.Pool({ connectionString: sbUrl, ssl: { rejectUnauthorized: false } });

function colDefSql(col) {
  let type = col.data_type;
  if (type === "character varying") type = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : "VARCHAR";
  else if (type === "numeric") type = col.numeric_precision ? `NUMERIC(${col.numeric_precision}${col.numeric_scale != null ? `,${col.numeric_scale}` : ""})` : "NUMERIC";
  else if (type === "timestamp without time zone") type = "TIMESTAMP";
  else if (type === "timestamp with time zone") type = "TIMESTAMPTZ";
  else if (type === "ARRAY") type = "TEXT[]"; // no array columns expected, but don't crash if one shows up
  else type = type.toUpperCase();

  let def = "";
  if (col.column_default != null) {
    // Only carry over safe, self-contained defaults — sequence-based defaults (nextval) would
    // reference an object that doesn't exist on the backup DB.
    if (/^nextval\(/i.test(col.column_default)) def = "";
    else def = ` DEFAULT ${col.column_default}`;
  }
  // Always request NOT NULL when the source column is NOT NULL — safe for CREATE TABLE (no
  // existing rows to violate it) and for ALTER TABLE ADD COLUMN with a DEFAULT (Postgres
  // backfills existing rows). The caller's retry-on-23502 fallback drops it only if adding to
  // an existing table with rows and no default actually fails.
  const notNull = col.is_nullable === "NO" ? " NOT NULL" : "";
  return `"${col.column_name}" ${type}${def}${notNull}`;
}

async function getColumns(pool, table) {
  const { rows } = await pool.query(
    `SELECT column_name, data_type, character_maximum_length, numeric_precision, numeric_scale, is_nullable, column_default
     FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

async function getPrimaryKeyCols(pool, table) {
  const { rows } = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema='public' AND tc.table_name=$1 AND tc.constraint_type='PRIMARY KEY'
     ORDER BY kcu.ordinal_position`,
    [table]
  );
  return rows.map(r => r.column_name);
}

async function tableExists(pool, table) {
  const { rows } = await pool.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [table]
  );
  return rows.length > 0;
}

const mainTables = (await mainPool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
)).rows.map(r => r.table_name);

let created = 0, columnsAdded = 0, errors = 0;

for (const table of mainTables) {
  const existsOnBackup = await tableExists(sbPool, table);

  if (!existsOnBackup) {
    const cols = await getColumns(mainPool, table);
    const pkCols = await getPrimaryKeyCols(mainPool, table);
    const colDefs = cols.map(colDefSql);
    const pkClause = pkCols.length ? `,\n  PRIMARY KEY (${pkCols.map(c => `"${c}"`).join(", ")})` : "";
    const ddl = `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${colDefs.join(",\n  ")}${pkClause}\n)`;
    console.log(`\n-- CREATE ${table} (${cols.length} columns, pk: ${pkCols.join(",") || "none"})`);
    if (DRY_RUN) {
      console.log(ddl);
    } else {
      try {
        await sbPool.query(ddl);
        created++;
        console.log(`  OK`);
      } catch (e) {
        console.error(`  ERROR: ${e.message}`);
        errors++;
      }
    }
    continue;
  }

  // Table exists on both — check for missing columns.
  const mainCols = await getColumns(mainPool, table);
  const sbColSet = new Set((await getColumns(sbPool, table)).map(c => c.column_name));
  const missing = mainCols.filter(c => !sbColSet.has(c.column_name));
  if (missing.length === 0) continue;

  console.log(`\n-- ALTER ${table}: add ${missing.map(c => c.column_name).join(", ")}`);
  for (const col of missing) {
    const ddl = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${colDefSql(col)}`;
    if (DRY_RUN) {
      console.log(`  ${ddl}`);
      continue;
    }
    try {
      await sbPool.query(ddl);
      columnsAdded++;
      console.log(`  OK ${col.column_name}`);
    } catch (e) {
      // NOT NULL without a usable default fails against existing rows — retry nullable.
      if (e.code === "23502" || /null value|not-null/i.test(e.message)) {
        try {
          const nullableDdl = ddl.replace(/ NOT NULL$/, "");
          await sbPool.query(nullableDdl);
          columnsAdded++;
          console.log(`  OK ${col.column_name} (added nullable — existing rows have no value)`);
        } catch (e2) {
          console.error(`  ERROR ${col.column_name}: ${e2.message}`);
          errors++;
        }
      } else {
        console.error(`  ERROR ${col.column_name}: ${e.message}`);
        errors++;
      }
    }
  }
}

console.log(`\n${DRY_RUN ? "[DRY RUN] " : ""}Tables created: ${created}, columns added: ${columnsAdded}, errors: ${errors}`);

await mainPool.end();
await sbPool.end();
