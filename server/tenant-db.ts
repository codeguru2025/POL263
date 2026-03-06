/**
 * Per-tenant database support. When an organization has database_url set,
 * getPoolForOrg(orgId) / getDbForOrg(orgId) return a pool/db for that tenant's database.
 * Otherwise the default pool/db is used.
 *
 * Use getDbForOrg(orgId) in storage for tenant-scoped tables when you want
 * that tenant's data to live in their own database. Registry data (organizations,
 * users) stays on the default connection.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { pool as defaultPool } from "./db";
import { eq } from "drizzle-orm";
import { organizations } from "@shared/schema";
import { structuredLog } from "./logger";

const MAX_TENANT_POOLS = parseInt(process.env.MAX_TENANT_POOLS || "50", 10);

const poolCache = new Map<string, pg.Pool>();
const dbCache = new Map<string, ReturnType<typeof drizzle>>();
const poolLastAccess = new Map<string, number>();

const max = (process.env.DB_POOL_MAX && parseInt(process.env.DB_POOL_MAX, 10)) || 25;
const idleTimeoutMillis =
  (process.env.DB_IDLE_TIMEOUT_MS && parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)) || 30_000;
const connectionTimeoutMillis =
  (process.env.DB_CONNECTION_TIMEOUT_MS && parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)) || 5_000;

async function evictLeastRecentPool() {
  const tenantEntries = Array.from(poolLastAccess.entries())
    .filter(([id]) => poolCache.get(id) !== defaultPool);
  if (tenantEntries.length < MAX_TENANT_POOLS) return;
  tenantEntries.sort((a, b) => a[1] - b[1]);
  const [evictId] = tenantEntries[0];
  const pool = poolCache.get(evictId);
  poolCache.delete(evictId);
  dbCache.delete(evictId);
  poolLastAccess.delete(evictId);
  if (pool && pool !== defaultPool) {
    try { await pool.end(); } catch {}
    structuredLog("info", "Evicted tenant pool", { orgId: evictId, activePools: poolCache.size });
  }
}

function buildPoolConfig(connectionString: string): pg.PoolConfig {
  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    connectionString.includes("supabase");
  const sslConfig = acceptSelfSigned ? { rejectUnauthorized: false } : undefined;
  let url = connectionString;
  if (sslConfig) {
    url = url
      .replace(/\?sslmode=[^&]*&?/gi, "?")
      .replace(/&sslmode=[^&]*/gi, "")
      .replace(/\?$/, "");
  }
  return {
    connectionString: url,
    max,
    idleTimeoutMillis,
    connectionTimeoutMillis,
    ...(sslConfig && { ssl: sslConfig }),
  };
}

/** Get the pool for this tenant. Uses default pool if org has no database_url. */
export async function getPoolForOrg(orgId: string): Promise<pg.Pool> {
  const cached = poolCache.get(orgId);
  if (cached) {
    poolLastAccess.set(orgId, Date.now());
    return cached;
  }

  const { db } = await import("./db");
  const [org] = await db.select({ databaseUrl: organizations.databaseUrl }).from(organizations).where(eq(organizations.id, orgId));
  const url = org?.databaseUrl?.trim();
  if (!url) {
    poolCache.set(orgId, defaultPool);
    poolLastAccess.set(orgId, Date.now());
    return defaultPool;
  }

  await evictLeastRecentPool();
  const tenantPool = new pg.Pool(buildPoolConfig(url));
  tenantPool.on("error", (err) => {
    structuredLog("warn", "Tenant pool error", { orgId, error: err.message });
  });
  poolCache.set(orgId, tenantPool);
  poolLastAccess.set(orgId, Date.now());
  return tenantPool;
}

/** Get a Drizzle instance for this tenant's database. Use for tenant-scoped tables. */
export async function getDbForOrg(orgId: string): Promise<ReturnType<typeof drizzle>> {
  const cached = dbCache.get(orgId);
  if (cached) {
    poolLastAccess.set(orgId, Date.now());
    return cached;
  }

  const p = await getPoolForOrg(orgId);
  const tenantDb = drizzle(p, { schema });
  dbCache.set(orgId, tenantDb);
  return tenantDb;
}

export function getTenantPoolStats(): { activePools: number; maxPools: number; tenantIds: string[] } {
  const tenantIds = Array.from(poolCache.keys()).filter(id => poolCache.get(id) !== defaultPool);
  return { activePools: tenantIds.length, maxPools: MAX_TENANT_POOLS, tenantIds };
}

/**
 * Execute a callback inside a database transaction for the given tenant.
 * Rolls back on error; commits on success.
 */
export async function withOrgTransaction<T>(
  orgId: string,
  fn: (tx: ReturnType<typeof drizzle>) => Promise<T>,
): Promise<T> {
  const p = await getPoolForOrg(orgId);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client as any, { schema });
    const result = await fn(txDb);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Default pool (registry/organizations). Use for org and user lookups. */
export { defaultPool };
