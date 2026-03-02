/**
 * Run SQL migration files in order against DATABASE_URL (default DB).
 * Tracks applied migrations in schema_migrations so each file runs only once.
 *
 * Usage: npx tsx script/run-migrations.ts
 */
import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";

const migrationsDir = path.resolve(process.cwd(), "migrations");

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }
  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    process.env.DATABASE_URL.includes("supabase");
  const poolConfig: pg.PoolConfig = {
    connectionString: process.env.DATABASE_URL,
    ...(acceptSelfSigned && { ssl: { rejectUnauthorized: false } }),
  };
  const pool = new pg.Pool(poolConfig);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  const { rows: applied } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename"
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("No .sql files in migrations/");
    await pool.end();
    return;
  }

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) {
      console.log(`  (already applied: ${file})`);
      continue;
    }
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    try {
      await pool.query(sql);
    } catch (e: any) {
      if (e.code === "42701" || e.code === "42P07" || e.code === "42710" || e.message?.includes("already exists")) {
        console.log(`  (skipped - object may already exist: ${file})`);
      } else {
        await pool.end();
        throw e;
      }
    }
    await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    console.log(`Applied ${file}`);
    ran++;
  }
  console.log(ran > 0 ? `Migrations complete (${ran} applied).` : "Database is up to date.");
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
