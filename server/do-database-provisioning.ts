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
  return err?.status === 409 || (err?.status === 400 && text.includes("already exists"));
}

/** Swaps the trailing database-name path segment of a Postgres connection URI. */
function withDatabaseName(uri: string, dbName: string): string {
  const url = new URL(uri);
  url.pathname = `/${dbName}`;
  return url.toString();
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
    const logicalDbAdminUri = withDatabaseName(adminUri, logicalDbName);

    const roleName = `pol263_tenant_${tenantId.replace(/-/g, "").slice(0, 12)}`;
    const rolePassword = crypto.randomBytes(24).toString("base64url");

    const adminPool = new pg.Pool({ connectionString: logicalDbAdminUri, max: 1, ssl: { rejectUnauthorized: false } });
    try {
      try {
        await adminPool.query(`CREATE ROLE ${roleName} LOGIN PASSWORD '${rolePassword}'`);
      } catch (err: any) {
        if (err?.code !== "42710") throw err; // 42710 = role already exists — idempotent retry
      }
      await adminPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${roleName}`);
      await adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO ${roleName}`);
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
