/**
 * Creates a dedicated logical Postgres database for a tenant inside one shared, pre-existing
 * DigitalOcean database cluster — used when a tenant's subscription converts from trial to paid
 * (see server/tenant-db-commissioning.ts). Deliberately does NOT create a new cluster per
 * tenant: DigitalOcean caps accounts at 10 database clusters by default (a manual support-ticket
 * process to raise), so a cluster per tenant would hit that wall within single digits of paying
 * tenants. A logical database inside one cluster (POST /v2/databases/{cluster_uuid}/dbs) has no
 * comparable cap, provisions near-instantly, and still gives the tenant genuine data isolation —
 * own tables, own connection string, own least-privilege role — just not separate compute.
 *
 * Mirrors server/do-app-domains.ts's shape: same bearer-token pattern, same "never throws"
 * contract (every public function resolves null/false on any failure rather than rejecting) —
 * a failure here must never block a tenant's subscription from becoming active.
 */
import crypto from "crypto";
import pg from "pg";
import { structuredLog } from "./logger";

const DO_API_BASE = "https://api.digitalocean.com/v2";

export interface ProvisionedTenantDatabase {
  databaseUrl: string;
  databaseDirectUrl: string;
  logicalDbName: string;
}

function getToken(): string | null {
  return process.env.DIGITALOCEAN_API_TOKEN || null;
}

async function doApiRequest(path: string, init?: RequestInit): Promise<any> {
  const token = getToken();
  if (!token) throw new Error("DIGITALOCEAN_API_TOKEN not set");
  const res = await fetch(`${DO_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err: any = new Error(`DO API ${init?.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return res.json();
}

function isDuplicateDbNameError(err: any): boolean {
  const text = `${err?.body || ""} ${err?.message || ""}`.toLowerCase();
  // The DO Managed Databases API's actual observed shape for "this name is taken" is
  // 422 unprocessable_entity / "database name is not available" — not the 409 or 400-plus-
  // "already exists" this originally guessed at. Confirmed against a real retry (2026-08-04):
  // a partially-completed provisioning attempt (logical DB created, then a later step failed)
  // hard-failed on retry instead of treating the already-created DB as idempotent success,
  // because neither of the guessed shapes matched. Keeping the 409/400 checks too in case DO's
  // API is inconsistent across error paths — never observed either of those directly.
  return err?.status === 409
    || (err?.status === 400 && text.includes("already exists"))
    || (err?.status === 422 && text.includes("not available"));
}

/** Swaps the trailing database-name path segment of a Postgres connection URI. */
function withDatabaseName(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/** Strips a `sslmode=` query param from a connection string. DO's cluster connection URI
 *  includes `?sslmode=require`, which fights with an explicit `ssl: { rejectUnauthorized: false }`
 *  pool option passed alongside it — pg ends up still attempting full certificate-chain
 *  verification and failing with "self-signed certificate in certificate chain" against DO's
 *  managed-Postgres certs, even though the pool option says not to. Same fix already applied to
 *  every other pool built against a DO/self-signed-tolerant host — see buildPoolConfig in
 *  server/tenant-db.ts, which this provisioning flow's own connections had been missing. */
function stripSslMode(connectionString: string): string {
  return connectionString
    .replace(/\?sslmode=[^&]*&?/gi, "?")
    .replace(/&sslmode=[^&]*/gi, "")
    .replace(/\?$/, "");
}

/**
 * Creates the logical database, then a least-privilege app role scoped to it (mirrors the
 * GRANT pattern already documented in .env.example:8-13 for every other database this app
 * connects to — never hands the doadmin/superuser connection to the running app itself).
 * Returns null on any failure (no token, no cluster configured, DO API error, role-creation
 * error) — callers must treat null as "fell back to manual commissioning," not an error to
 * surface to the tenant.
 */
export async function provisionLogicalTenantDatabase(tenantId: string): Promise<ProvisionedTenantDatabase | null> {
  const clusterId = process.env.DIGITALOCEAN_TENANT_DB_CLUSTER_ID;
  if (!clusterId) {
    structuredLog("info", "DO database provisioning: DIGITALOCEAN_TENANT_DB_CLUSTER_ID not set, skipping", { tenantId });
    return null;
  }
  if (!getToken()) return null;

  const logicalDbName = `tenant_${tenantId.replace(/-/g, "")}`;

  try {
    try {
      await doApiRequest(`/databases/${clusterId}/dbs`, {
        method: "POST",
        body: JSON.stringify({ name: logicalDbName }),
      });
    } catch (err: any) {
      if (!isDuplicateDbNameError(err)) throw err;
      // Already exists — treat as idempotent success (a retried/partially-completed attempt).
    }

    const { database } = await doApiRequest(`/databases/${clusterId}`);
    const adminUri: string | undefined = database?.connection?.uri;
    if (!adminUri) throw new Error("DO cluster response missing connection.uri");
    const logicalDbAdminUri = stripSslMode(withDatabaseName(adminUri, logicalDbName));

    const roleName = `pol263_tenant_${tenantId.replace(/-/g, "").slice(0, 12)}`;
    const rolePassword = crypto.randomBytes(24).toString("base64url");

    const adminPool = new pg.Pool({ connectionString: logicalDbAdminUri, max: 1, ssl: { rejectUnauthorized: false } });
    try {
      try {
        await adminPool.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
      } catch (err: any) {
        if (err?.code !== "42710") throw err; // 42710 = role already exists — idempotent retry
        // Role survived from an earlier partial attempt, but its password is unknown to us
        // now (never persisted anywhere) — rotate it to the one we just generated so the
        // connection string we're about to return is actually valid.
        await adminPool.query(`ALTER ROLE ${roleName} WITH PASSWORD '${rolePassword}'`);
      }
      await adminPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${roleName}`);
      await adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${roleName}`);
      // Without this, the app's own lazy safety-net auto-migration (applyPendingMigrations,
      // triggered on first pool creation for this org — see server/tenant-db.ts, meant to bring
      // a DB restored from a stale backup back up to date automatically) fails with "permission
      // denied for schema public" the moment it needs to CREATE TABLE anything, even a table
      // that already exists (Postgres still checks CREATE privilege before evaluating
      // IF NOT EXISTS). Postgres 15+ revokes CREATE on the public schema from the PUBLIC
      // pseudo-role by default, so a least-privilege role like this one doesn't get it for free
      // the way it would have on older Postgres. The failure is already caught and logged
      // ("pool still usable") rather than fatal, but degrades the safety net to a no-op for this
      // tenant. Discovered 2026-08-04 provisioning IFALAKHE FUNERAL SERVICES.
      await adminPool.query(`GRANT USAGE, CREATE ON SCHEMA public TO ${roleName}`);
    } finally {
      await adminPool.end().catch(() => {});
    }

    const appUrl = new URL(logicalDbAdminUri);
    appUrl.username = roleName;
    appUrl.password = rolePassword;

    structuredLog("info", "DO database provisioning: logical tenant database ready", { tenantId, logicalDbName });
    return {
      databaseUrl: appUrl.toString(),
      databaseDirectUrl: logicalDbAdminUri,
      logicalDbName,
    };
  } catch (err) {
    structuredLog("warn", "DO database provisioning failed, falling back to manual commissioning", {
      tenantId, error: (err as Error).message,
    });
    return null;
  }
}
