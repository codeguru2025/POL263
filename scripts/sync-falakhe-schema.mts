/**
 * Sync Falakhe DB schema to match shared/schema.ts without drizzle-kit's interactive TTY.
 * - Adds all missing columns
 * - Drops extra columns that block drizzle-kit's rename detector
 * Run: npx tsx scripts/sync-falakhe-schema.mts
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import dotenv from "dotenv";
import { getTableConfig } from "drizzle-orm/pg-core";

dotenv.config();

// Import every table from schema.ts
import * as schema from "../shared/schema.ts";

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL!);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log("Connected to Falakhe DB\n");

// Collect all drizzle table objects (skip non-table exports like constants/types/zod schemas)
const tables: ReturnType<typeof getTableConfig>[] = [];
const tableNameToConfig: Map<string, ReturnType<typeof getTableConfig>> = new Map();

for (const [exportName, exportVal] of Object.entries(schema)) {
  if (exportVal && typeof exportVal === "object" && "getSQL" in (exportVal as any)) {
    try {
      const cfg = getTableConfig(exportVal as any);
      if (cfg && cfg.name && cfg.columns) {
        tables.push(cfg);
        tableNameToConfig.set(cfg.name, cfg);
      }
    } catch { /* not a table */ }
  }
}

console.log(`Found ${tables.length} tables in schema.ts\n`);

// Drizzle column type → approximate PostgreSQL type
function drizzleTypeToSql(col: any): string {
  const dt = col.dataType ?? col.getSQLType?.() ?? "text";
  if (dt === "uuid") return "UUID";
  if (dt === "integer" || dt === "int") return "INTEGER";
  if (dt === "boolean" || dt === "bool") return "BOOLEAN";
  if (dt === "timestamp") return "TIMESTAMP";
  if (dt === "date") return "DATE";
  if (dt === "numeric" || dt === "decimal") return "NUMERIC";
  if (dt === "jsonb") return "JSONB";
  if (dt === "varchar") return `VARCHAR(${col.length ?? 255})`;
  return "TEXT";
}

function defaultClause(col: any): string {
  const d = col.default;
  if (d === null || d === undefined) return "";
  if (typeof d === "boolean") return ` DEFAULT ${d}`;
  if (typeof d === "number") return ` DEFAULT ${d}`;
  if (typeof d === "string") {
    if (d === "now()") return " DEFAULT NOW()";
    if (d === "gen_random_uuid()") return " DEFAULT gen_random_uuid()";
    return ` DEFAULT '${d}'`;
  }
  // Drizzle SQL object
  if (typeof d === "object" && d.sql) return ` DEFAULT ${d.sql}`;
  return "";
}

let totalAdded = 0, totalDropped = 0, totalErrors = 0;

for (const cfg of tables) {
  const tableName = cfg.name;

  // Check table exists
  const tableExists = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  if (!tableExists.rows.length) {
    // Table doesn't exist — skip (drizzle-kit will CREATE it, or we created it separately)
    continue;
  }

  // Get existing columns
  const existingCols = await client.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [tableName]
  );
  const dbColSet = new Set(existingCols.rows.map((r: any) => r.column_name as string));

  // Get expected columns from schema
  const schemaColSet = new Set(cfg.columns.map((c: any) => c.name));

  // Extra columns in DB not in schema (potential rename conflict source — drop them)
  const extraCols = [...dbColSet].filter(c => !schemaColSet.has(c));

  // Missing columns in DB (need to add)
  const missingCols = cfg.columns.filter((c: any) => !dbColSet.has(c.name));

  if (extraCols.length === 0 && missingCols.length === 0) continue;

  console.log(`\n── ${tableName} ──`);

  // Drop extra columns (these block drizzle-kit rename detection)
  for (const col of extraCols) {
    try {
      await client.query(`ALTER TABLE "${tableName}" DROP COLUMN IF EXISTS "${col}"`);
      console.log(`  ✓ DROP ${col}`);
      totalDropped++;
    } catch (e: any) {
      console.error(`  ✗ DROP ${col}: ${e.message}`);
      totalErrors++;
    }
  }

  // Add missing columns
  for (const col of missingCols) {
    const sqlType = drizzleTypeToSql(col);
    const notNull = col.notNull ? " NOT NULL" : "";
    const def = defaultClause(col);
    const ddl = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${sqlType}${def}${notNull}`;
    try {
      await client.query(ddl);
      console.log(`  ✓ ADD ${col.name} ${sqlType}`);
      totalAdded++;
    } catch (e: any) {
      // If NOT NULL without default fails on existing rows, retry without NOT NULL
      if (e.code === "23502" || e.message.includes("null value") || e.message.includes("NOT NULL")) {
        try {
          const ddl2 = `ALTER TABLE "${tableName}" ADD COLUMN IF NOT EXISTS "${col.name}" ${sqlType}${def}`;
          await client.query(ddl2);
          console.log(`  ✓ ADD ${col.name} ${sqlType} (dropped NOT NULL constraint for existing rows)`);
          totalAdded++;
        } catch (e2: any) {
          console.error(`  ✗ ADD ${col.name}: ${e2.message}`);
          totalErrors++;
        }
      } else {
        console.error(`  ✗ ADD ${col.name}: ${e.message}`);
        totalErrors++;
      }
    }
  }
}

console.log(`\n═══════════════════════════════════`);
console.log(`Added: ${totalAdded}, Dropped: ${totalDropped}, Errors: ${totalErrors}`);
await client.end();
