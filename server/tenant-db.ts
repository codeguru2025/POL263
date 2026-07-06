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
import { applyPendingMigrations } from "./migrate-tenant-db";
import { tenantDatabases } from "@shared/control-plane-schema";

/** Drizzle DB bound to shared schema (pool or transaction client). */
export type OrgDataDb = NodePgDatabase<typeof schema>;

const MAX_TENANT_POOLS = parseInt(process.env.MAX_TENANT_POOLS || "50", 10);

const poolCache = new Map<string, pg.Pool>();
const dbCache = new Map<string, OrgDataDb>();
const poolLastAccess = new Map<string, number>();
// In-flight pool creations, keyed by orgId. Concurrent cache-misses for the same org
// share a single creation promise so we never construct (and orphan) duplicate pools.
const poolCreationInFlight = new Map<string, Promise<pg.Pool>>();

const max = (process.env.DB_POOL_MAX && parseInt(process.env.DB_POOL_MAX, 10)) || 25;
const idleTimeoutMillis =
  (process.env.DB_IDLE_TIMEOUT_MS && parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)) || 30_000;
const connectionTimeoutMillis =
  (process.env.DB_CONNECTION_TIMEOUT_MS && parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)) || 5_000;

async function evictLeastRecentPool() {
  // Evict least-recently-used tenant pools until there is room for one more
  // (i.e. count stays below MAX_TENANT_POOLS after the caller adds its pool).
  while (true) {
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

  // Coalesce concurrent cache-misses onto a single creation so we don't build
  // (and then orphan) more than one pool for the same org under load.
  const inFlight = poolCreationInFlight.get(orgId);
  if (inFlight) return inFlight;

  const creation = (async (): Promise<pg.Pool> => {
    // Read routing config from the control plane (authoritative source).
    // Falls back to the shared DB organizations table during the migration window.
    let url: string | undefined;
    let controlPlaneFailed = false;
    try {
      const [row] = await cpDb
        .select({ databaseUrl: tenantDatabases.databaseUrl })
        .from(tenantDatabases)
        .where(eq(tenantDatabases.tenantId, orgId));
      url = row?.databaseUrl?.trim() || undefined;
    } catch (err: any) {
      // Control plane unreachable — fall back to shared DB lookup so the app
      // keeps working during a control plane outage or before migration runs.
      // IMPORTANT: this fallback is NOT authoritative (organizations.database_url is
      // frequently empty even for orgs that do have a dedicated tenant DB registered
      // only in the control plane) — a false "no dedicated DB" here must not get cached,
      // or a single transient control-plane blip permanently misroutes this org onto the
      // shared DB (silently returning zero/empty results for all its real data) until
      // the process restarts or the pool cache evicts under LRU pressure.
      controlPlaneFailed = true;
      structuredLog("error", "Control plane lookup failed — using shared-DB fallback for this request only (not cached)", { orgId, error: err?.message });
      try {
        const { db } = await import("./db");
        const [org] = await db
          .select({ databaseUrl: organizations.databaseUrl })
          .from(organizations)
          .where(eq(organizations.id, orgId));
        url = org?.databaseUrl?.trim() || undefined;
      } catch (fallbackErr: any) {
        structuredLog("error", "Shared-DB fallback lookup also failed", { orgId, error: fallbackErr?.message });
      }
    }
    if (!url) {
      if (controlPlaneFailed) {
        // Don't poison the cache with an unconfirmed routing decision — retry the
        // control plane fresh on the next request instead of getting stuck on defaultPool.
        return defaultPool;
      }
      poolCache.set(orgId, defaultPool);
      poolLastAccess.set(orgId, Date.now());
      return defaultPool;
    }

    await evictLeastRecentPool();
    // Mask credentials in logs: keep host only
    const urlHost = (() => { try { return new URL(url!).host; } catch { return "<invalid-url>"; } })();
    structuredLog("info", "Creating dedicated tenant pool", { orgId, host: urlHost });
    const tenantPool = new pg.Pool(buildPoolConfig(url, { forTenant: true }));
    tenantPool.on("error", (err) => {
      structuredLog("warn", "Tenant pool error — evicting from cache", { orgId, host: urlHost, error: err.message });
      poolCache.delete(orgId);
      dbCache.delete(orgId);
    });

    // Auto-apply any pending migrations so a DB restored from a backup cannot
    // silently fall behind the schema even if schema_migrations claims it's current.
    try {
      await applyPendingMigrations(tenantPool, `tenant:${orgId.slice(0, 8)}`);
    } catch (err: any) {
      structuredLog("warn", "Tenant DB auto-migration failed — pool still usable", { orgId, host: urlHost, error: err.message });
    }

    poolCache.set(orgId, tenantPool);
    poolLastAccess.set(orgId, Date.now());
    return tenantPool;
  })();

  poolCreationInFlight.set(orgId, creation);
  try {
    return await creation;
  } finally {
    poolCreationInFlight.delete(orgId);
  }
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

async function upsertRegistryUserIntoTenantDb(tdb: OrgDataDb, orgId: string, registryUser: typeof users.$inferSelect, branchIdOverride?: string | null) {
  if (!mayMirrorUserToOrg(registryUser, orgId)) return;
  // branchIdOverride is supplied when the shared-DB record was stored with branchId=null to avoid
  // the shared-DB FK constraint (branches for dedicated-DB orgs only exist in the tenant DB).
  const branchForMirror = branchIdOverride !== undefined
    ? branchIdOverride
    : (registryUser.organizationId === orgId ? registryUser.branchId : null);
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
  const [existById] = await tdb.select({ id: users.id }).from(users).where(eq(users.id, registryUser.id)).limit(1);
  if (existById) {
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
    // If a user with this email already exists under a different ID (registry/tenant ID mismatch),
    // skip the insert to avoid a unique-email constraint error. The payment will record
    // recorded_by as null (nullable FK), which is safe.
    const [existByEmail] = await tdb.select({ id: users.id }).from(users).where(eq(users.email, registryUser.email)).limit(1);
    if (!existByEmail) {
      await tdb.insert(users).values(row);
    } else {
      structuredLog("warn", "Skipping user mirror: email already exists with different ID in tenant DB", {
        orgId,
        registryUserId: registryUser.id,
        tenantUserId: existByEmail.id,
        email: registryUser.email,
      });
    }
  }
}

/**
 * Ensures a registry `users` row exists in the org’s data DB so FKs (`recorded_by`, etc.) succeed.
 * Only runs for dedicated tenant databases. Allowed: same-org staff, or platform owner (mirrored
 * with `organization_id = orgId` for local FK satisfaction).
 */
export async function ensureRegistryUserMirroredToOrgDataDb(orgId: string, userId: string, branchIdOverride?: string | null): Promise<void> {
  if (!(await orgUsesDedicatedDatabase(orgId))) return;
  const [registryUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!registryUser) return;
  const tdb = await getDbForOrg(orgId);
  await upsertRegistryUserIntoTenantDb(tdb, orgId, registryUser, branchIdOverride);
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
 * For NOT NULL user-reference columns (e.g. `requisitions.requested_by`) where a null
 * fallback isn't possible — {@link resolveUserIdForOrgDatabase} degrades to null, which
 * only works for nullable FKs.
 *
 * Returns the id to actually use for this org: normally the registry user's own id, mirrored
 * as usual. But if that email already exists in the tenant DB under a *different* id (the
 * mirror-skip case in {@link upsertRegistryUserIntoTenantDb} — e.g. an old account created
 * under this email before the person's registry id existed, or before two of their Google
 * accounts diverged), that pre-existing row is already referenced by historical records
 * (audit logs, receipts, ...). Rather than fail, treat it as this person's tenant-local
 * identity going forward: keep its id stable, but sync its non-id fields from the registry
 * row so display name/avatar/etc. stay current.
 */
export async function resolveOrSyncTenantUserId(orgId: string, userId: string): Promise<string> {
  if (!(await orgUsesDedicatedDatabase(orgId))) return userId;
  const [registryUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!registryUser) return userId;
  const tdb = await getDbForOrg(orgId);
  const [existById] = await tdb.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (existById) {
    await upsertRegistryUserIntoTenantDb(tdb, orgId, registryUser);
    return userId;
  }
  const [existByEmail] = await tdb.select({ id: users.id }).from(users).where(eq(users.email, registryUser.email)).limit(1);
  if (existByEmail) {
    await tdb.update(users).set({
      googleId: registryUser.googleId,
      displayName: registryUser.displayName,
      avatarUrl: registryUser.avatarUrl,
      isActive: registryUser.isActive,
    }).where(eq(users.id, existByEmail.id));
    return existByEmail.id;
  }
  await upsertRegistryUserIntoTenantDb(tdb, orgId, registryUser);
  return userId;
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
    // Roll back, but never let a failed ROLLBACK mask the original error —
    // that original error is what callers and logs need to see.
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      structuredLog("error", "Transaction ROLLBACK failed", {
        orgId,
        rollbackError: (rollbackErr as Error)?.message,
        originalError: (err as Error)?.message,
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Default pool (registry/organizations). Use for org and user lookups. */
export { defaultPool };
