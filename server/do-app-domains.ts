/**
 * Automates adding a new tenant's subdomain to this app's DigitalOcean App Platform Domains
 * list — previously a manual step that had to be done by hand before a new tenant's subdomain
 * would resolve or get a TLS cert (see docs/BUGFIX-LOG.md). Falls back silently to the existing
 * manual "Pending domain commissioning" dashboard queue (server/platform-routes.ts's
 * commission-domain endpoint) if this fails for any reason — DIGITALOCEAN_API_TOKEN unset, DO
 * API down, rate limited, etc. Never throws: a failure here must never block tenant provisioning
 * itself, which is why every public function here returns a boolean rather than rejecting.
 *
 * DO App Platform has no dedicated "add a domain" endpoint — the only way to change an app's
 * domain list is to PUT the app's *entire* spec back with the domains array modified
 * (https://docs.digitalocean.com/reference/api/digitalocean/#tag/Apps/operation/apps_update).
 * Protected by a Postgres advisory lock (same pattern as backup-sync.ts's getBackupPool lock)
 * so two tenants provisioning at nearly the same moment can't race a read-modify-write of the
 * shared spec and clobber each other's domain addition.
 */
import { structuredLog } from "./logger";

const DO_API_BASE = "https://api.digitalocean.com/v2";
const LOCK_KEY = 987654322;

let cachedAppId: string | null = null;

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
    throw new Error(`DO API ${init?.method || "GET"} ${path} failed: ${res.status} ${text.slice(0, 300)}`);
  }
  return res.json();
}

/**
 * Finds this app's ID by matching APP_BASE_DOMAIN against each app's domain list — avoids
 * needing a second env var, and self-corrects if the app is ever recreated. Cached in-process
 * for the life of the server (an app's ID never changes).
 */
async function getDoAppId(): Promise<string | null> {
  if (cachedAppId) return cachedAppId;
  const baseDomain = (process.env.APP_BASE_DOMAIN || "").toLowerCase();
  if (!baseDomain || baseDomain === "localhost") return null;
  try {
    const data = await doApiRequest("/apps?per_page=100");
    const apps = data.apps || [];
    for (const app of apps) {
      const domains = app.spec?.domains || [];
      if (domains.some((d: any) => (d.domain || "").toLowerCase() === baseDomain)) {
        cachedAppId = app.id;
        return app.id;
      }
    }
    structuredLog("warn", "DO domain automation: no app found with a domain matching APP_BASE_DOMAIN", { baseDomain });
    return null;
  } catch (err) {
    structuredLog("warn", "DO domain automation: failed to list apps", { error: (err as Error).message });
    return null;
  }
}

/**
 * Adds `subdomain` to the app's DO Domains list (type ALIAS). Returns true only once DO has
 * confirmed the updated spec; false for any failure (token missing, app not found, API error,
 * lock contention) — callers must treat false as "fell back to manual commissioning," not an
 * error to surface to the signing-up tenant.
 */
export async function commissionTenantDomainOnDO(subdomain: string): Promise<boolean> {
  if (!getToken()) return false;

  const { pool: mainPool } = await import("./db");
  const lockClient = await mainPool.connect();
  try {
    const lockResult = await lockClient.query("SELECT pg_try_advisory_lock($1) as acquired", [LOCK_KEY]);
    if (!lockResult.rows[0]?.acquired) {
      structuredLog("warn", "DO domain automation: another instance holds the lock, skipping", { subdomain });
      return false;
    }

    const appId = await getDoAppId();
    if (!appId) return false;

    const { app } = await doApiRequest(`/apps/${appId}`);
    const spec = app.spec;
    const domains: any[] = spec.domains || [];
    if (domains.some((d) => (d.domain || "").toLowerCase() === subdomain.toLowerCase())) {
      return true; // already there — idempotent
    }
    spec.domains = [...domains, { domain: subdomain, type: "ALIAS" }];

    await doApiRequest(`/apps/${appId}`, { method: "PUT", body: JSON.stringify({ spec }) });
    structuredLog("info", "DO domain automation: subdomain added to app Domains list", { subdomain });
    return true;
  } catch (err) {
    structuredLog("warn", "DO domain automation failed, falling back to manual commissioning", {
      subdomain, error: (err as Error).message,
    });
    return false;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}
