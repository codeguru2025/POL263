/**
 * Per-tenant database support. When an organization has database_url set,
 * getPoolForOrg(orgId) / getDbForOrg(orgId) return a pool/db for that tenant's database.
 * Otherwise the default pool/db is used.
 *
 * Use getDbForOrg(orgId) in storage for tenant-scoped tables when you want
 * that tenant's data to live in their own database. Registry data (organizations,
 * users) stays on the default connection. Per-org sequences that must commit with
 * tenant rows (e.g. payment receipt numbers) live in `org_policy_sequences` on the
 * same database as the org's data — use `storage.allocatePaymentReceiptNumberInTx`
 * inside `withOrgTransaction` so they roll back with the payment.
 *
 * ACID (payments / ledger): `withOrgTransaction` runs exactly one BEGIN … COMMIT (or ROLLBACK)
 * on the org’s data database. All payment_transaction, receipt, and policy rows written in that
 * callback commit or roll back together. User mirroring for FK-safe `recorded_by` uses the
 * registry DB read plus a separate write on the tenant pool before that transaction (or via
 * `ensureRegistryUserMirroredToOrgDataDbInTx` inside the callback when used).
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { db, pool as defaultPool } from "./db";
import { eq } from "drizzle-orm";
import { organizations, users } from "@shared/schema";
import { structuredLog } from "./logger";
import { PLATFORM_OWNER_EMAIL } from "./constants";
import { cpDb } from "./control-plane-db";
import { tenantDatabases } from "@shared/control-plane-schema";

/** Drizzle DB bound to shared schema (pool or transaction client). */
export type OrgDataDb = NodePgDatabase<typeof schema>;

const MAX_TENANT_POOLS = parseInt(process.env.MAX_TENANT_POOLS || "50", 10);

const poolCache = new Map<string, pg.Pool>();
const dbCache = new Map<string, OrgDataDb>();
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

function buildPoolConfig(connectionString: string, { forTenant = false } = {}): pg.PoolConfig {
  const acceptSelfSigned =
    forTenant ||                                         // tenant isolated DBs: always tolerate self-signed certs
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    connectionString.includes("supabase") ||
    connectionString.includes("neon.tech");
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

  // Read routing config from the control plane (authoritative source).
  // Falls back to the shared DB organizations table during the migration window.
  let url: string | undefined;
  try {
    const [row] = await cpDb
      .select({ databaseUrl: tenantDatabases.databaseUrl })
      .from(tenantDatabases)
      .where(eq(tenantDatabases.tenantId, orgId));
    url = row?.databaseUrl?.trim() || undefined;
  } catch {
    // Control plane unreachable — fall back to shared DB lookup so the app
    // keeps working during a control plane outage or before migration runs.
    structuredLog("warn", "Control plane lookup failed, falling back to shared DB", { orgId });
    const { db } = await import("./db");
    const [org] = await db
      .select({ databaseUrl: organizations.databaseUrl })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    url = org?.databaseUrl?.trim() || undefined;
  }
  if (!url) {
    poolCache.set(orgId, defaultPool);
    poolLastAccess.set(orgId, Date.now());
    return defaultPool;
  }

  await evictLeastRecentPool();
  // Mask credentials in logs: keep host only
  const urlHost = (() => { try { return new URL(url).host; } catch { return "<invalid-url>"; } })();
  structuredLog("info", "Creating dedicated tenant pool", { orgId, host: urlHost });
  const tenantPool = new pg.Pool(buildPoolConfig(url, { forTenant: true }));
  tenantPool.on("error", (err) => {
    structuredLog("warn", "Tenant pool error", { orgId, host: urlHost, error: err.message });
  });
  poolCache.set(orgId, tenantPool);
  poolLastAccess.set(orgId, Date.now());
  return tenantPool;
}

/** True when this org’s app data lives on a dedicated pool (not the shared registry DATABASE_URL). */
export async function orgUsesDedicatedDatabase(orgId: string): Promise<boolean> {
  return (await getPoolForOrg(orgId)) !== defaultPool;
}

function isPlatformOwnerForMirror(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.toLowerCase() === PLATFORM_OWNER_EMAIL.toLowerCase();
}

function mayMirrorUserToOrg(
  registryUser: { organizationId: string | null; email: string },
  orgId: string,
): boolean {
  if (registryUser.organizationId === orgId) return true;
  return isPlatformOwnerForMirror(registryUser.email);
}

async function upsertRegistryUserIntoTenantDb(tdb: OrgDataDb, orgId: string, registryUser: typeof users.$inferSelect) {
  if (!mayMirrorUserToOrg(registryUser, orgId)) return;
  const branchForMirror = registryUser.organizationId === orgId ? registryUser.branchId : null;
  const row = {
    id: registryUser.id,
    email: registryUser.email,
    googleId: registryUser.googleId,
    passwordHash: registryUser.passwordHash,
    displayName: registryUser.displayName,
    avatarUrl: registryUser.avatarUrl,
    referralCode: registryUser.referralCode,
    organizationId: orgId,
    branchId: branchForMirror,
    isActive: registryUser.isActive,
    phone: registryUser.phone,
    address: registryUser.address,
    nationalId: registryUser.nationalId,
    dateOfBirth: registryUser.dateOfBirth,
    gender: registryUser.gender,
    maritalStatus: registryUser.maritalStatus,
    nextOfKinName: registryUser.nextOfKinName,
    nextOfKinPhone: registryUser.nextOfKinPhone,
    createdAt: registryUser.createdAt,
  };
  const [exist] = await tdb.select({ id: users.id }).from(users).where(eq(users.id, registryUser.id)).limit(1);
  if (exist) {
    await tdb
      .update(users)
      .set({
        email: row.email,
        googleId: row.googleId,
        passwordHash: row.passwordHash,
        displayName: row.displayName,
        avatarUrl: row.avatarUrl,
        referralCode: row.referralCode,
        organizationId: row.organizationId,
        branchId: row.branchId,
        isActive: row.isActive,
        phone: row.phone,
        address: row.address,
        nationalId: row.nationalId,
        dateOfBirth: row.dateOfBirth,
        gender: row.gender,
        maritalStatus: row.maritalStatus,
        nextOfKinName: row.nextOfKinName,
        nextOfKinPhone: row.nextOfKinPhone,
      })
      .where(eq(users.id, registryUser.id));
  } else {
    await tdb.insert(users).values(row);
  }
}

/**
 * Ensures a registry `users` row exists in the org’s data DB so FKs (`recorded_by`, etc.) succeed.
 * Only runs for dedicated tenant databases. Allowed: same-org staff, or platform owner (mirrored
 * with `organization_id = orgId` for local FK satisfaction).
 */
export async function ensureRegistryUserMirroredToOrgDataDb(orgId: string, userId: string): Promise<void> {
  if (!(await orgUsesDedicatedDatabase(orgId))) return;
  const [registryUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!registryUser) return;
  const tdb = await getDbForOrg(orgId);
  await upsertRegistryUserIntoTenantDb(tdb, orgId, registryUser);
}

/**
 * Same as {@link ensureRegistryUserMirroredToOrgDataDb} but uses an existing transaction client so
 * the mirror participates in the same ACID unit as ledger writes (optional stricter mode).
 */
export async function ensureRegistryUserMirroredToOrgDataDbInTx(
  txDb: OrgDataDb,
  orgId: string,
  userId: string,
): Promise<void> {
  if (!(await orgUsesDedicatedDatabase(orgId))) return;
  const [registryUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!registryUser) return;
  await upsertRegistryUserIntoTenantDb(txDb, orgId, registryUser);
}

/**
 * Returns userId only if a row with that id exists in the org's data database (the same DB as
 * policies, payment_transactions, etc.). Otherwise null — avoids FK violations when the session user
 * lives only on the default/registry database (e.g. platform owner on a switched tenant, or staff
 * not replicated into an isolated tenant DB).
 */
export async function resolveUserIdForOrgDatabase(
  userId: string | null | undefined,
  orgId: string | null | undefined,
): Promise<string | null> {
  if (!userId || !orgId) return null;
  try {
    await ensureRegistryUserMirroredToOrgDataDb(orgId, userId);
  } catch (err: any) {
    structuredLog("warn", "ensureRegistryUserMirroredToOrgDataDb failed", {
      orgId,
      userId,
      error: err?.message || String(err),
    });
  }
  const tdb = await getDbForOrg(orgId);
  const [row] = await tdb.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  return row?.id ?? null;
}

/** Get a Drizzle instance for this tenant's database. Use for tenant-scoped tables. */
export async function getDbForOrg(orgId: string): Promise<OrgDataDb> {
  const cached = dbCache.get(orgId);
  if (cached) {
    poolLastAccess.set(orgId, Date.now());
    return cached as OrgDataDb;
  }

  const p = await getPoolForOrg(orgId);
  const tenantDb = drizzle(p, { schema }) as OrgDataDb;
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
  fn: (tx: OrgDataDb) => Promise<T>,
): Promise<T> {
  const p = await getPoolForOrg(orgId);
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const txDb = drizzle(client, { schema }) as OrgDataDb;
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
