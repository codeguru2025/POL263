/**
 * Run SQL migration files in order against one or more Postgres databases.
 * Tracks applied migrations in schema_migrations so each file runs only once per database.
 *
 * - Always runs against DATABASE_URL (required).
 * - After migrating the main DB, reads all organizations that have a dedicated
 *   databaseUrl and migrates each one automatically — no per-tenant env vars needed.
 * - DATABASE_URL_TENANT (optional) is still honoured for backward compatibility.
 * - SUPABASE_BACKUP_URL (optional) migrates a backup DB if set.
 *
 * Usage: npx tsx script/run-migrations.ts
 */
import "dotenv/config";
import pg from "pg";
import fs from "fs";
import path from "path";

const migrationsDir = path.resolve(process.cwd(), "migrations");

function normalizeConn(s: string): string {
  return s.trim();
}

async function connectPool(connectionString: string): Promise<pg.Pool> {
  let cs = normalizeConn(connectionString);
  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    cs.includes("supabase") ||
    /digitalocean|\.ondigitalocean\.com/i.test(cs);

  if (acceptSelfSigned && cs) {
    cs = cs.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");
  }

  const poolConfig: pg.PoolConfig = {
    connectionString: cs,
    connectionTimeoutMillis: 15_000,
    ...(acceptSelfSigned && { ssl: { rejectUnauthorized: false } }),
  };
  let pool = new pg.Pool(poolConfig);

  try {
    await pool.query("SELECT 1");
  } catch (firstErr: any) {
    const isSelfSigned =
      firstErr?.code === "SELF_SIGNED_CERT_IN_CHAIN" ||
      (firstErr?.message && String(firstErr.message).toLowerCase().includes("self-signed"));
    if (isSelfSigned && !acceptSelfSigned) {
      await pool.end().catch(() => {});
      console.warn("Database uses a self-signed certificate. Retrying with SSL verification disabled. Set DB_ACCEPT_SELF_SIGNED=true to avoid this.");
      const retryConfig: pg.PoolConfig = {
        connectionString: normalizeConn(connectionString)
          .replace(/\?sslmode=[^&]*&?/gi, "?")
          .replace(/&sslmode=[^&]*/gi, "")
          .replace(/\?$/, ""),
        ssl: { rejectUnauthorized: false },
      };
      pool = new pg.Pool(retryConfig);
      await pool.query("SELECT 1");
    } else {
      await pool.end().catch(() => {});
      throw firstErr;
    }
  }
  return pool;
}

async function migrateOneDatabase(label: string, pool: pg.Pool): Promise<number> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  const { rows: tableCheck } = await pool.query<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organizations'
    ) AS exists
  `);
  if (!tableCheck[0]?.exists) {
    const isDo = /ondigitalocean\.com/i.test(process.env.DATABASE_URL || "");
    const hint = isDo
      ? "Run npm run db:push:do (DigitalOcean) or npm run db:push, then run migrations again."
      : "Run npm run db:push (or npm run db:push:do if SSL fails), then run migrations again.";
    throw new Error(`[${label}] Base schema missing: public.organizations does not exist. ${hint}`);
  }

  const { rows: applied } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    console.log(`[${label}] No .sql files in migrations/`);
    return 0;
  }

  let ran = 0;
  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf-8");
    try {
      await pool.query(sql);
    } catch (e: any) {
      if (e.code === "42701" || e.code === "42P07" || e.code === "42710" || e.message?.includes("already exists")) {
        console.log(`  [${label}] (skipped - object may already exist: ${file})`);
      } else {
        throw e;
      }
    }
    await pool.query("INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING", [file]);
    console.log(`  [${label}] Applied ${file}`);
    ran++;
  }
  if (ran > 0) {
    console.log(`[${label}] Migrations complete, ${ran} new file(s) applied.`);
  } else {
    console.log(`[${label}] Up to date, ${files.length} file(s) on disk, none pending.`);
  }
  return ran;
}

/** Read all distinct dedicated databaseUrls stored in the organizations table. */
async function loadTenantUrls(mainPool: pg.Pool): Promise<{ name: string; url: string }[]> {
  try {
    const { rows } = await mainPool.query<{ name: string; database_url: string }>(`
      SELECT name, database_url
      FROM organizations
      WHERE database_url IS NOT NULL AND database_url <> ''
      ORDER BY name
    `);
    return rows.map((r) => ({ name: r.name, url: r.database_url.trim() }));
  } catch {
    // organizations table may not exist yet on a brand-new DB
    return [];
  }
}

async function migrateWithPool(label: string, url: string, mainUrl: string): Promise<void> {
  if (!url || normalizeConn(url) === mainUrl) return;
  console.log(`\nMigrating tenant DB: ${label}…`);
  let pool: pg.Pool | undefined;
  try {
    pool = await connectPool(url);
    await migrateOneDatabase(label, pool);
  } catch (err: any) {
    console.warn(`  [${label}] WARNING: skipped — ${err?.message || err}`);
    console.warn(`  [${label}] The auto-migration on first connection will retry at runtime.`);
  } finally {
    await pool?.end().catch(() => {});
  }
}

async function run() {
  if (!process.env.DATABASE_URL?.trim()) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const mainUrl = normalizeConn(process.env.DATABASE_URL);
  const mainPool = await connectPool(mainUrl);

  // 1. Migrate the main / shared registry database first.
  try {
    await migrateOneDatabase("DATABASE_URL", mainPool);
  } catch (err) {
    await mainPool.end().catch(() => {});
    throw err;
  }

  // 2. Discover every tenant that has a dedicated database by reading the
  //    organizations table — no per-tenant env vars needed.
  const tenants = await loadTenantUrls(mainPool);
  await mainPool.end();

  if (tenants.length > 0) {
    console.log(`\nFound ${tenants.length} tenant DB(s) to migrate…`);
    for (const { name, url } of tenants) {
      await migrateWithPool(name, url, mainUrl);
    }
  }

  // 3. DATABASE_URL_TENANT — backward-compat for CI / manual overrides.
  const tenantRaw = process.env.DATABASE_URL_TENANT?.trim();
  if (tenantRaw) {
    const alreadyCovered = tenants.some((t) => normalizeConn(t.url) === normalizeConn(tenantRaw));
    if (!alreadyCovered) {
      await migrateWithPool("DATABASE_URL_TENANT", tenantRaw, mainUrl);
    }
  }

  // 4. SUPABASE_BACKUP_URL — optional off-site backup DB.
  const backupRaw = process.env.SUPABASE_BACKUP_URL?.trim();
  if (backupRaw) {
    await migrateWithPool("SUPABASE_BACKUP_URL (backup)", backupRaw, mainUrl);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
