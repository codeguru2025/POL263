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
 * (https://docs.digitalocean.com/reference/api/digitalocean/#tag/Apps/operation/apps_update),
 * and doing so redeploys the app (observed in practice: a full build+deploy cycle, several
 * minutes). Calls are debounced and batched into one spec PUT (and therefore one deploy) instead
 * of one per signup, so a burst of signups doesn't redeploy production once per tenant. Protected
 * by a Postgres advisory lock (same pattern as backup-sync.ts's getBackupPool lock) so two app
 * instances flushing at nearly the same moment can't race a read-modify-write of the shared spec.
 */
import { structuredLog } from "./logger";

const DO_API_BASE = "https://api.digitalocean.com/v2";
const LOCK_KEY = 987654322;
/** How long to wait for more signups to land before PUT-ing the batch. */
const FLUSH_DELAY_MS = 5_000;

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

interface PendingWaiter {
  subdomain: string;
  resolve: (ok: boolean) => void;
}

let pendingSubdomains: string[] = [];
let pendingWaiters: PendingWaiter[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queues `subdomain` to be added to the app's DO Domains list (type ALIAS), batched with any
 * other subdomains queued within the next FLUSH_DELAY_MS into a single spec PUT. Resolves true
 * once that batch's PUT is confirmed (or the domain was already present); false for any failure
 * (token missing, app not found, API error, lock contention) — callers must treat false as
 * "fell back to manual commissioning," not an error to surface to the signing-up tenant.
 *
 * Worst case on a missed flush (e.g. the process restarts mid-debounce-window) is identical to
 * any other failure path here: the tenant falls into the manual dashboard queue.
 */
export async function commissionTenantDomainOnDO(subdomain: string): Promise<boolean> {
  if (!getToken()) return false;
  return new Promise<boolean>((resolve) => {
    pendingSubdomains.push(subdomain);
    pendingWaiters.push({ subdomain, resolve });
    if (!flushTimer) {
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void flushPendingDomains();
      }, FLUSH_DELAY_MS);
      flushTimer.unref?.();
    }
  });
}

async function flushPendingDomains(): Promise<void> {
  const subdomains = Array.from(new Set(pendingSubdomains));
  const waiters = pendingWaiters;
  pendingSubdomains = [];
  pendingWaiters = [];
  if (subdomains.length === 0) return;

  const ok = await addSubdomainsToDO(subdomains);
  for (const w of waiters) w.resolve(ok);
}

async function addSubdomainsToDO(subdomains: string[]): Promise<boolean> {
  const { pool: mainPool } = await import("./db");
  const lockClient = await mainPool.connect();
  try {
    const lockResult = await lockClient.query("SELECT pg_try_advisory_lock($1) as acquired", [LOCK_KEY]);
    if (!lockResult.rows[0]?.acquired) {
      structuredLog("warn", "DO domain automation: another instance holds the lock, skipping", { subdomains });
      return false;
    }

    const appId = await getDoAppId();
    if (!appId) return false;

    const { app } = await doApiRequest(`/apps/${appId}`);
    const spec = app.spec;
    const existing: any[] = spec.domains || [];
    const existingLower = new Set(existing.map((d) => (d.domain || "").toLowerCase()));
    const toAdd = subdomains.filter((s) => !existingLower.has(s.toLowerCase()));
    if (toAdd.length === 0) return true; // all already there — idempotent

    spec.domains = [...existing, ...toAdd.map((domain) => ({ domain, type: "ALIAS" }))];

    await doApiRequest(`/apps/${appId}`, { method: "PUT", body: JSON.stringify({ spec }) });
    structuredLog("info", "DO domain automation: subdomains added to app Domains list", { subdomains: toAdd });
    return true;
  } catch (err) {
    structuredLog("warn", "DO domain automation failed, falling back to manual commissioning", {
      subdomains, error: (err as Error).message,
    });
    return false;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}
