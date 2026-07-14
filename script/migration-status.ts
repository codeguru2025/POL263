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
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import * as cpSchema from "@shared/control-plane-schema";

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

async function loadTenantUrls(mainConnStr: string): Promise<{ name: string; url: string }[]> {
  // Registry `organizations.database_url` is a best-effort fallback only — the
  // authoritative source is the control plane `tenant_databases` table (same
  // resolution order as getPoolForOrg in server/tenant-db.ts). Relying on the
  // registry column alone silently skips tenants whose URL only lives in the
  // control plane (e.g. Falakhe), reporting them as "not configured" instead
  // of actually checking migration status.
  const byName = new Map<string, string>();

  const registryPool = new pg.Pool(poolConfig(mainConnStr));
  try {
    const { rows } = await registryPool.query<{ name: string; database_url: string }>(`
      SELECT name, database_url FROM organizations
      WHERE database_url IS NOT NULL AND database_url <> ''
      ORDER BY name
    `);
    for (const r of rows) byName.set(r.name, r.database_url.trim());
  } catch {
    // ignore — control plane lookup below is authoritative anyway
  } finally {
    await registryPool.end().catch(() => {});
  }

  const cpUrl = (process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL || mainConnStr)?.trim();
  if (cpUrl) {
    const cpPool = new pg.Pool(poolConfig(cpUrl));
    try {
      const cpDb = drizzle(cpPool, { schema: cpSchema });
      const rows = await cpDb
        .select({
          name: cpSchema.tenants.name,
          databaseUrl: cpSchema.tenantDatabases.databaseUrl,
          databaseDirectUrl: cpSchema.tenantDatabases.databaseDirectUrl,
        })
        .from(cpSchema.tenantDatabases)
        .innerJoin(cpSchema.tenants, eq(cpSchema.tenants.id, cpSchema.tenantDatabases.tenantId));
      for (const r of rows) {
        // Prefer the direct URL for migration/status checks (pooler URLs can require
        // an explicitly configured pool name that migration scripts don't have).
        const url = (r.databaseDirectUrl || r.databaseUrl)?.trim();
        if (url) byName.set(r.name, url);
      }
    } catch (e: any) {
      console.log(`\ncontrol plane tenant lookup failed: ${e?.message || e} (falling back to registry-only tenant list)`);
    } finally {
      await cpPool.end().catch(() => {});
    }
  }

  return Array.from(byName.entries())
    .map(([name, url]) => ({ name, url }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function main() {
  const mainUrl = process.env.DATABASE_URL;
  await status("DATABASE_URL - main / shared registry", mainUrl);

  // Show status for every tenant with a dedicated DB — no env vars needed.
  if (mainUrl?.trim()) {
    const tenants = await loadTenantUrls(mainUrl.trim());
    for (const { name, url } of tenants) {
      await status(`tenant: ${name}`, url);
    }
  }

  // Backward-compat: DATABASE_URL_TENANT if not already covered above.
  const tenantEnv = process.env.DATABASE_URL_TENANT?.trim();
  if (tenantEnv) await status("DATABASE_URL_TENANT - optional second DB", tenantEnv);

  console.log("\nTip: do not paste this report back into the terminal; only run: npm run db:migrate:status");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
