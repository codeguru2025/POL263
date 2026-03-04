/**
 * Destroy all tables in the database and recreate a fresh schema from shared/schema.ts.
 * Use when you want a clean slate (e.g. after wiping data, or to fix schema drift).
 *
 * Steps:
 * 1. Drop all tables in the public schema (and schema_migrations).
 * 2. Run drizzle-kit push to create the schema from shared/schema.ts.
 *
 * Usage: npx tsx script/db-reset.ts
 * Optional: DB_RESET_SKIP_PUSH=1 to only drop tables (then run npm run db:push manually).
 * Optional: DB_ACCEPT_SELF_SIGNED=true (or NODE_TLS_REJECT_UNAUTHORIZED=0) for self-signed DB certs.
 *
 * Requires: DATABASE_URL set. Destructive — all data is lost.
 */
import "dotenv/config";
import pg from "pg";
import { execSync } from "child_process";
import path from "path";

function getPoolConfig(allowSelfSigned: boolean): pg.PoolConfig {
  let connectionString = process.env.DATABASE_URL!;
  const sslConfig = allowSelfSigned ? { rejectUnauthorized: false } : undefined;
  if (sslConfig && connectionString) {
    connectionString = connectionString
      .replace(/\?sslmode=[^&]*&?/gi, "?")
      .replace(/&sslmode=[^&]*/gi, "")
      .replace(/\?$/, "");
  }
  return {
    connectionString,
    ...(sslConfig && { ssl: sslConfig }),
  };
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    (typeof process.env.DATABASE_URL === "string" &&
      (process.env.DATABASE_URL.includes("supabase") || /digitalocean|\.ondigitalocean\.com/i.test(process.env.DATABASE_URL)));

  let pool = new pg.Pool(getPoolConfig(acceptSelfSigned));
  let useInsecureSsl = acceptSelfSigned;

  try {
    await pool.query("SELECT 1");
  } catch (firstErr: any) {
    if (firstErr?.code === "SELF_SIGNED_CERT_IN_CHAIN" && !acceptSelfSigned) {
      await pool.end();
      console.warn("Database uses a self-signed certificate. Retrying with SSL verification disabled. Set DB_ACCEPT_SELF_SIGNED=true to avoid this.");
      pool = new pg.Pool(getPoolConfig(true));
      await pool.query("SELECT 1");
      useInsecureSsl = true;
    } else {
      await pool.end();
      throw firstErr;
    }
  }

  await runDropAndPush(pool, useInsecureSsl);
}

async function runDropAndPush(pool: pg.Pool, useInsecureSsl: boolean = false) {
  try {
    console.log("Dropping all tables in public schema...");
    const { rows } = await pool.query<{ tablename: string }>(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    if (rows.length === 0) {
      console.log("No tables to drop.");
    } else {
      for (const { tablename } of rows) {
        const quoted = `"${tablename.replace(/"/g, '""')}"`;
        await pool.query(`DROP TABLE IF EXISTS public.${quoted} CASCADE`);
        console.log(`  Dropped ${tablename}`);
      }
    }

    const skipPush = process.env.DB_RESET_SKIP_PUSH === "1" || process.env.DB_RESET_SKIP_PUSH === "true";
    if (skipPush) {
      console.log("Skipping drizzle-kit push (DB_RESET_SKIP_PUSH=1). Run: npm run db:push");
      await pool.end();
      return;
    }

    console.log("Running drizzle-kit push to create fresh schema...");
    const cwd = path.resolve(process.cwd());
    const pushEnv = { ...process.env };
    if (useInsecureSsl) {
      pushEnv.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    execSync("npx drizzle-kit push --force", {
      cwd,
      stdio: "inherit",
      env: pushEnv,
    });
    console.log("Done. Schema is fresh. Run npm run db:seed to load permissions and optional platform owner.");
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
