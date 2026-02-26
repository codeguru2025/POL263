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

const poolCache = new Map<string, pg.Pool>();
const dbCache = new Map<string, ReturnType<typeof drizzle>>();

const max = (process.env.DB_POOL_MAX && parseInt(process.env.DB_POOL_MAX, 10)) || 10;
const idleTimeoutMillis =
  (process.env.DB_IDLE_TIMEOUT_MS && parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)) || 30_000;
const connectionTimeoutMillis =
  (process.env.DB_CONNECTION_TIMEOUT_MS && parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)) || 5_000;

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
  if (cached) return cached;

  const { db } = await import("./db");
  const [org] = await db.select({ databaseUrl: organizations.databaseUrl }).from(organizations).where(eq(organizations.id, orgId));
  const url = org?.databaseUrl?.trim();
  if (!url) {
    poolCache.set(orgId, defaultPool);
    return defaultPool;
  }

  const tenantPool = new pg.Pool(buildPoolConfig(url));
  poolCache.set(orgId, tenantPool);
  return tenantPool;
}

/** Get a Drizzle instance for this tenant's database. Use for tenant-scoped tables. */
export async function getDbForOrg(orgId: string): Promise<ReturnType<typeof drizzle>> {
  const cached = dbCache.get(orgId);
  if (cached) return cached;

  const p = await getPoolForOrg(orgId);
  const tenantDb = drizzle(p, { schema });
  dbCache.set(orgId, tenantDb);
  return tenantDb;
}

/** Default pool (registry/organizations). Use for org and user lookups. */
export { defaultPool };
