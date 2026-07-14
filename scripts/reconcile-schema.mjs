/**
 * Generic schema reconciler: brings a TARGET Postgres database's tables/columns up to match
 * a SOURCE database, using real information_schema introspection (not Drizzle's in-memory type
 * mapping, and not a hand-maintained migration file list — both have proven incomplete in this
 * repo). Only ever additive: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS. Never drops
 * or alters existing columns, so it's safe to run repeatedly and safe to run against a database
 * with real rows in it.
 *
 * Skips foreign keys on newly-created tables (this tool is also used for the Supabase backup,
 * whose sync jobs already disable FK checking) but preserves primary keys, since upsert-style
 * sync logic depends on ON CONFLICT (pk).
 *
 * Written because `drizzle-kit push` cannot run headless in this environment — it hits an
 * interactive rename-detection prompt requiring a real TTY, both for Falakhe (2026-07) and the
 * Supabase backup DB (2026-07-14).
 *
 * Usage:
 *   node scripts/reconcile-schema.mjs --source=<ENV_VAR_NAME> --target=<ENV_VAR_NAME> [--dry-run]
 *
 * Example:
 *   node scripts/reconcile-schema.mjs --source=FALAKHE_DIRECT_URL --target=DATABASE_URL --dry-run
 */
import "dotenv/config";
import pg from "pg";

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith("--")).map(a => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);
const DRY_RUN = !!args["dry-run"];

if (!args.source || !args.target) {
  console.error("Usage: node scripts/reconcile-schema.mjs --source=<ENV_VAR_NAME> --target=<ENV_VAR_NAME> [--dry-run]");
  process.exit(1);
}

function resolveUrl(envVarName) {
  const raw = process.env[envVarName];
  if (!raw) throw new Error(`Env var ${envVarName} is not set`);
  // Session pooler (5432), not transaction pooler (6543) — the latter blocks DDL on Supabase.
  return raw.replace(/[?&]sslmode=[^&]*/gi, "").replace(/:6543\//, ":5432/");
}

const sourceUrl = resolveUrl(args.source);
const targetUrl = resolveUrl(args.target);

const sourcePool = new pg.Pool({ connectionString: sourceUrl, ssl: { rejectUnauthorized: false } });
const targetPool = new pg.Pool({ connectionString: targetUrl, ssl: { rejectUnauthorized: false } });

function colDefSql(col) {
  let type = col.data_type;
  if (type === "character varying") type = col.character_maximum_length ? `VARCHAR(${col.character_maximum_length})` : "VARCHAR";
  else if (type === "numeric") type = col.numeric_precision ? `NUMERIC(${col.numeric_precision}${col.numeric_scale != null ? `,${col.numeric_scale}` : ""})` : "NUMERIC";
  else if (type === "timestamp without time zone") type = "TIMESTAMP";
  else if (type === "timestamp with time zone") type = "TIMESTAMPTZ";
  else if (type === "ARRAY") type = "TEXT[]";
  else type = type.toUpperCase();

  let def = "";
  if (col.column_default != null) {
    if (/^nextval\(/i.test(col.column_default)) def = "";
    else def = ` DEFAULT ${col.column_default}`;
  }
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

const sourceTables = (await sourcePool.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`
)).rows.map(r => r.table_name);

let created = 0, columnsAdded = 0, errors = 0;

for (const table of sourceTables) {
  const existsOnTarget = await tableExists(targetPool, table);

  if (!existsOnTarget) {
    const cols = await getColumns(sourcePool, table);
    const pkCols = await getPrimaryKeyCols(sourcePool, table);
    const colDefs = cols.map(colDefSql);
    const pkClause = pkCols.length ? `,\n  PRIMARY KEY (${pkCols.map(c => `"${c}"`).join(", ")})` : "";
    const ddl = `CREATE TABLE IF NOT EXISTS "${table}" (\n  ${colDefs.join(",\n  ")}${pkClause}\n)`;
    console.log(`\n-- CREATE ${table} (${cols.length} columns, pk: ${pkCols.join(",") || "none"})`);
    if (DRY_RUN) {
      console.log(ddl);
    } else {
      try {
        await targetPool.query(ddl);
        created++;
        console.log(`  OK`);
      } catch (e) {
        console.error(`  ERROR: ${e.message}`);
        errors++;
      }
    }
    continue;
  }

  const sourceCols = await getColumns(sourcePool, table);
  const targetColSet = new Set((await getColumns(targetPool, table)).map(c => c.column_name));
  const missing = sourceCols.filter(c => !targetColSet.has(c.column_name));
  if (missing.length === 0) continue;

  console.log(`\n-- ALTER ${table}: add ${missing.map(c => c.column_name).join(", ")}`);
  for (const col of missing) {
    const ddl = `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS ${colDefSql(col)}`;
    if (DRY_RUN) {
      console.log(`  ${ddl}`);
      continue;
    }
    try {
      await targetPool.query(ddl);
      columnsAdded++;
      console.log(`  OK ${col.column_name}`);
    } catch (e) {
      if (e.code === "23502" || /null value|not-null/i.test(e.message)) {
        try {
          const nullableDdl = ddl.replace(/ NOT NULL$/, "");
          await targetPool.query(nullableDdl);
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

await sourcePool.end();
await targetPool.end();
