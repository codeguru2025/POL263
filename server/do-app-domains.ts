/**
 * Automates commissioning a new tenant's subdomain: creates the DNS CNAME record directly via
 * DigitalOcean's Domain Records API, then adds the subdomain to this app's DigitalOcean App
 * Platform Domains list (needed for DO to route traffic and issue a TLS cert for it).
 *
 * Both steps are required for a subdomain to actually work. Earlier this only did the second
 * step and relied on DO App Platform to auto-create the matching DNS record once a domain was
 * added to the app spec — that assumption silently failed for a real tenant signup
 * (ifalakhe-funeral-services.pol263.com, 2026-08-04): the domain got added to the app fine, but
 * no working DNS record was ever created, `domainCommissioned` had already flipped true (it only
 * meant "we told DO App Platform," not "it resolves"), and there was no error anywhere — a human
 * had to notice the site wasn't live and fix DNS by hand, which is exactly how a *second* bug got
 * introduced (the record was created with the full FQDN as its name instead of the zone-relative
 * label, producing a nonsense double-suffixed hostname that never matched real traffic — see
 * docs/BUGFIX-LOG.md for the full incident). Now the DNS step is done here directly, so it's
 * verified rather than assumed, and relativeRecordName() is the one place that computation
 * happens instead of a human re-deriving it by hand in DO's dashboard.
 *
 * Per-tenant transactional semantics: `commissionTenantDomainOnDO` resolves per-subdomain, not
 * per-batch. A subdomain is only reported successful if BOTH the DNS record and the app's domain
 * list were confirmed — any failure in either step fails that subdomain completely and returns
 * a specific error string, never a silent partial state. Falls back to the existing manual
 * "Pending domain commissioning" dashboard queue (server/platform-routes.ts's commission-domain
 * endpoint, which now retries this same logic) if this fails for any reason — DIGITALOCEAN_API_
 * TOKEN unset, DO API down, rate limited, etc. Never throws: a failure here must never block
 * tenant provisioning itself, which is why every public function here returns a result object
 * rather than rejecting.
 *
 * DO App Platform has no dedicated "add a domain" endpoint — the only way to change an app's
 * domain list is to PUT the app's *entire* spec back with the domains array modified
 * (https://docs.digitalocean.com/reference/api/digitalocean/#tag/Apps/operation/apps_update),
 * and doing so redeploys the app (observed in practice: a full build+deploy cycle, several
 * minutes). That step is debounced and batched into one spec PUT (and therefore one deploy)
 * instead of one per signup, so a burst of signups doesn't redeploy production once per tenant —
 * the DNS-record step is NOT batched (each is an independent, cheap, idempotent call) and runs
 * per subdomain before its batch turn comes up. Protected by a Postgres advisory lock (same
 * pattern as backup-sync.ts's getBackupPool lock) so two app instances flushing at nearly the
 * same moment can't race a read-modify-write of the shared spec.
 */
import { structuredLog } from "./logger";

const DO_API_BASE = "https://api.digitalocean.com/v2";
const LOCK_KEY = 987654322;
/** How long to wait for more signups to land before PUT-ing the batch. */
const FLUSH_DELAY_MS = 5_000;

export interface CommissionResult {
  ok: boolean;
  /** Present only when ok is false — a specific, human-readable reason, not a generic failure. */
  error?: string;
}

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
 * Computes the zone-relative record name DigitalOcean's DNS Records API expects (e.g. "acme"
 * for the record backing "acme.pol263.com" in zone "pol263.com") — the exact value a human got
 * wrong by hand on 2026-08-04, passing the full FQDN instead and creating a record for
 * "acme.pol263.com.pol263.com". Throws rather than silently creating a wrong record if
 * `subdomain` isn't actually inside `zone`, which would indicate a config/caller bug, not
 * something to guess past.
 */
export function relativeRecordName(subdomain: string, zone: string): string {
  const s = subdomain.toLowerCase().replace(/\.$/, "");
  const z = zone.toLowerCase().replace(/\.$/, "");
  if (s === z) return "@";
  const suffix = `.${z}`;
  if (!s.endsWith(suffix)) {
    throw new Error(`relativeRecordName: "${subdomain}" is not a subdomain of zone "${zone}"`);
  }
  return s.slice(0, s.length - suffix.length);
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

/** The hostname every tenant subdomain's CNAME must point at — read live from the app rather
 *  than hardcoded, so this self-corrects if the app is ever recreated (same reasoning as
 *  getDoAppId's cache-by-domain-match). */
async function getDefaultIngressHostname(appId: string): Promise<string | null> {
  try {
    const { app } = await doApiRequest(`/apps/${appId}`);
    const ingress: string | undefined = app.default_ingress;
    if (!ingress) return null;
    return ingress.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  } catch (err) {
    structuredLog("warn", "DO domain automation: failed to read default_ingress", { appId, error: (err as Error).message });
    return null;
  }
}

interface DoDnsRecord { id: number; type: string; name: string; data: string; }

/**
 * Creates (or self-heals, if one already exists pointing at the wrong target — e.g. a leftover
 * from a prior failed attempt) the CNAME record for `subdomain` in `zone`. Idempotent: a call
 * against an already-correct record is a no-op. This is the step that used to be left to DO App
 * Platform's own auto-DNS, which silently didn't happen for a real tenant on 2026-08-04.
 */
async function ensureDnsRecord(zone: string, subdomain: string, targetHostname: string): Promise<CommissionResult> {
  let name: string;
  try {
    name = relativeRecordName(subdomain, zone);
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
  try {
    const data = await doApiRequest(`/domains/${zone}/records?per_page=200`);
    const records: DoDnsRecord[] = data.domain_records || [];
    const existing = records.find((r) => r.type === "CNAME" && r.name.toLowerCase() === name.toLowerCase());
    const normalize = (h: string) => h.toLowerCase().replace(/\.$/, "");
    if (existing) {
      if (normalize(existing.data) === normalize(targetHostname)) {
        return { ok: true }; // already correct
      }
      await doApiRequest(`/domains/${zone}/records/${existing.id}`, {
        method: "PUT",
        body: JSON.stringify({ data: `${targetHostname}.` }),
      });
      structuredLog("info", "DO domain automation: corrected mismatched DNS record", { zone, name, targetHostname });
      return { ok: true };
    }
    await doApiRequest(`/domains/${zone}/records`, {
      method: "POST",
      body: JSON.stringify({ type: "CNAME", name, data: `${targetHostname}.`, ttl: 3600 }),
    });
    structuredLog("info", "DO domain automation: created DNS record", { zone, name, targetHostname });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `DNS record step failed: ${(err as Error).message}` };
  }
}

interface PendingWaiter {
  subdomain: string;
  resolve: (result: CommissionResult) => void;
}

let pendingSubdomains: string[] = [];
let pendingWaiters: PendingWaiter[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Queues `subdomain` to be fully commissioned (DNS record + DO App Platform domain-list entry),
 * batched with any other subdomains queued within the next FLUSH_DELAY_MS into a single app-spec
 * PUT. Resolves per-subdomain: `{ ok: true }` only once BOTH steps are confirmed for this exact
 * subdomain; `{ ok: false, error }` with a specific reason for anything short of that — callers
 * must treat a false result as "fell back to manual commissioning," not swallow it silently.
 */
export async function commissionTenantDomainOnDO(subdomain: string): Promise<CommissionResult> {
  if (!getToken()) return { ok: false, error: "DIGITALOCEAN_API_TOKEN not set" };
  return new Promise<CommissionResult>((resolve) => {
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

  const results = await commissionSubdomains(subdomains);
  for (const w of waiters) {
    w.resolve(results.get(w.subdomain) ?? { ok: false, error: "Internal error: no result recorded for this subdomain" });
  }
}

/**
 * Runs both commissioning steps for every subdomain in the batch and returns a per-subdomain
 * result map — never an all-or-nothing boolean for the whole batch, so one bad subdomain (or a
 * transient DNS-step failure) doesn't report false failure for its batch-mates, and a batch-wide
 * failure (e.g. the app spec PUT itself errors) is still attributed individually to every
 * subdomain that was relying on it.
 */
async function commissionSubdomains(subdomains: string[]): Promise<Map<string, CommissionResult>> {
  const results = new Map<string, CommissionResult>();
  const zone = (process.env.APP_BASE_DOMAIN || "").toLowerCase();

  if (!zone || zone === "localhost") {
    const err = { ok: false, error: "APP_BASE_DOMAIN not configured" } as const;
    for (const s of subdomains) results.set(s, err);
    return results;
  }

  const { pool: mainPool } = await import("./db");
  const lockClient = await mainPool.connect();
  try {
    const lockResult = await lockClient.query("SELECT pg_try_advisory_lock($1) as acquired", [LOCK_KEY]);
    if (!lockResult.rows[0]?.acquired) {
      const err = { ok: false, error: "Another instance is already commissioning domains — will be retried" } as const;
      for (const s of subdomains) results.set(s, err);
      return results;
    }

    const appId = await getDoAppId();
    if (!appId) {
      const err = { ok: false, error: "Could not resolve this app's DigitalOcean App ID" } as const;
      for (const s of subdomains) results.set(s, err);
      return results;
    }

    const ingressHostname = await getDefaultIngressHostname(appId);
    if (!ingressHostname) {
      const err = { ok: false, error: "Could not read this app's default_ingress hostname" } as const;
      for (const s of subdomains) results.set(s, err);
      return results;
    }

    // Step 1: DNS record per subdomain — independent, so one subdomain's failure doesn't block
    // its batch-mates from proceeding to step 2.
    const dnsOk: string[] = [];
    for (const subdomain of subdomains) {
      const dnsResult = await ensureDnsRecord(zone, subdomain, ingressHostname);
      if (dnsResult.ok) {
        dnsOk.push(subdomain);
      } else {
        results.set(subdomain, dnsResult);
      }
    }
    if (dnsOk.length === 0) return results;

    // Step 2: add every DNS-ready subdomain to the app's domain list in one batched PUT.
    try {
      const { app } = await doApiRequest(`/apps/${appId}`);
      const spec = app.spec;
      const existing: any[] = spec.domains || [];
      const existingLower = new Set(existing.map((d) => (d.domain || "").toLowerCase()));
      const toAdd = dnsOk.filter((s) => !existingLower.has(s.toLowerCase()));

      if (toAdd.length > 0) {
        spec.domains = [...existing, ...toAdd.map((domain) => ({ domain, type: "ALIAS" }))];
        await doApiRequest(`/apps/${appId}`, { method: "PUT", body: JSON.stringify({ spec }) });
        structuredLog("info", "DO domain automation: subdomains added to app Domains list", { subdomains: toAdd });
      }
      // Both steps confirmed (already-present domains count as already succeeded here too).
      for (const s of dnsOk) results.set(s, { ok: true });
    } catch (err) {
      const appSpecErr = { ok: false, error: `App domain-list step failed: ${(err as Error).message}` } as const;
      for (const s of dnsOk) results.set(s, appSpecErr);
    }

    return results;
  } finally {
    await lockClient.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    lockClient.release();
  }
}
