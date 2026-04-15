/**
 * Compare migrations/*.sql on disk with schema_migrations in Postgres.
 *
 * Usage:
 *   npm run db:migrate:status
 *
 * Checks DATABASE_URL and, if set, DATABASE_URL_TENANT (e.g. isolated tenant DB).
 * To apply pending files: npm run db:migrate (runs both URLs when tenant is configured).
 */
import "dotenv/config";
import fs from "fs";
import path from "path";
import pg from "pg";

const migrationsDir = path.resolve(process.cwd(), "migrations");

function poolConfig(connectionString: string): pg.PoolConfig {
  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    connectionString.includes("supabase") ||
    /digitalocean|\.ondigitalocean\.com/i.test(connectionString);
  let url = connectionString.trim();
  if (acceptSelfSigned) {
    url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");
  }
  return {
    connectionString: url,
    ...(acceptSelfSigned && { ssl: { rejectUnauthorized: false } }),
  };
}

async function status(label: string, connectionString: string | undefined) {
  if (!connectionString?.trim()) {
    console.log(`\n${label}: not configured, skipped`);
    return;
  }
  const pool = new pg.Pool(poolConfig(connectionString.trim()));
  try {
    await pool.query("SELECT 1");
  } catch (e: any) {
    console.log(`\n${label}: connection failed: ${e?.message || e}`);
    await pool.end().catch(() => {});
    return;
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const { rows: existRows } = await pool.query<{ e: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'schema_migrations') AS e`,
  );
  const hasMigTable = existRows[0]?.e === true;
  const applied: string[] = hasMigTable
    ? (await pool.query<{ filename: string }>("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map((r) => r.filename)
    : [];

  const appliedSet = new Set(applied);
  const pending = files.filter((f) => !appliedSet.has(f));
  const orphan = applied.filter((f) => !files.includes(f));

  const { rows: ob } = await pool.query(`SELECT to_regclass('public.outbox_messages') AS r`);
  const { rows: org } = await pool.query(
    `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'organizations') AS e`,
  );

  // Avoid (), [], === in output so lines are not mistaken for PowerShell if pasted into the shell.
  console.log(`\n-- ${label} --`);
  console.log(`  organizations table: ${(org[0] as any)?.e ? "yes" : "no"}`);
  console.log(`  SQL files on disk:   ${files.length}`);
  console.log(`  Applied in DB:       ${applied.length}`);
  if (pending.length) console.log(`  PENDING:             ${pending.join(", ")}`);
  else console.log(`  PENDING:             none`);
  if (orphan.length) console.log(`  WARN DB-only rows:   ${orphan.join(", ")}`);
  console.log(`  outbox_messages:     ${(ob[0] as any)?.r ? "present" : "missing"}`);

  await pool.end();
}

async function main() {
  await status("DATABASE_URL - main / shared registry", process.env.DATABASE_URL);
  await status("DATABASE_URL_TENANT - optional second DB", process.env.DATABASE_URL_TENANT);
  console.log("\nTip: do not paste this report back into the terminal; only run: npm run db:migrate:status");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
