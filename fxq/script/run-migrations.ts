/**
 * Run SQL migration files in order against DATABASE_URL (default DB).
 * Uses pg directly so shared/schema is not loaded (avoids init order issues).
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
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log("No .sql files in migrations/");
    await pool.end();
    return;
  }
  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    try {
      await pool.query(sql);
    } catch (e: any) {
      if (e.code === "42701" || e.message?.includes("already exists")) {
        console.log(`  (skipped - object may already exist: ${file})`);
      } else {
        await pool.end();
        throw e;
      }
    }
    console.log(`Ran ${file}`);
  }
  console.log("Migrations complete.");
  await pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
