/**
 * Tenant resolver middleware.
 *
 * Resolves which tenant owns an incoming request and sets req.tenantId.
 * Resolution order (first match wins):
 *   1. X-Tenant-ID header   — internal/mobile calls that already know the tenant
 *   2. Subdomain            — acme.pol263.app → slug "acme"
 *   3. Custom domain        — portal.acme.co.zw → looked up in tenant_domains
 *   4. Authenticated session — req.user.organizationId (fallback for existing sessions)
 *
 * This middleware NEVER blocks a request — routes that require a tenant call
 * requireTenant() themselves.
 */
import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants, tenantDomains } from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

// Simple in-process cache: lookup key → { tenantId, cachedAt }
// TTL: 5 minutes. Safe because tenant domain changes are rare and
// a process restart always clears the cache.
const cache = new Map<string, { tenantId: string; cachedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function fromCache(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.cachedAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.tenantId;
}

function toCache(key: string, tenantId: string) {
  cache.set(key, { tenantId, cachedAt: Date.now() });
}

async function resolveBySlug(slug: string): Promise<string | null> {
  const key = `slug:${slug}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const [row] = await cpDb
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, slug))
    .limit(1);

  if (!row) return null;
  toCache(key, row.id);
  return row.id;
}

async function resolveByDomain(domain: string): Promise<string | null> {
  const key = `domain:${domain}`;
  const cached = fromCache(key);
  if (cached) return cached;

  const [row] = await cpDb
    .select({ tenantId: tenantDomains.tenantId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, domain))
    .limit(1);

  if (!row) return null;
  toCache(key, row.tenantId);
  return row.tenantId;
}

export async function tenantResolverMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
) {
  try {
    // 1. Explicit header (mobile app / internal service calls)
    const headerTenantId = req.headers["x-tenant-id"] as string | undefined;
    if (headerTenantId) {
      (req as any).tenantId = headerTenantId;
      return next();
    }

    const host = req.hostname?.toLowerCase();
    const BASE_DOMAIN = (process.env.APP_BASE_DOMAIN || "localhost").toLowerCase();

    // 2. Subdomain resolution
    if (host && host !== BASE_DOMAIN && host.endsWith(`.${BASE_DOMAIN}`)) {
      const slug = host.slice(0, -(BASE_DOMAIN.length + 1));
      if (slug) {
        const tenantId = await resolveBySlug(slug);
        if (tenantId) {
          (req as any).tenantId = tenantId;
          return next();
        }
      }
    }

    // 3. Custom domain lookup (not the base domain itself)
    if (host && host !== BASE_DOMAIN && host !== `www.${BASE_DOMAIN}`) {
      const tenantId = await resolveByDomain(host);
      if (tenantId) {
        (req as any).tenantId = tenantId;
        return next();
      }
    }

    // 4. Authenticated session fallback (existing sessions before domain routing)
    const user = (req as any).user;
    if (user?.organizationId) {
      (req as any).tenantId = user.organizationId;
      return next();
    }
  } catch (err) {
    // Never block a request due to resolver failure — routes enforce tenant
    // presence themselves via requireTenant().
    structuredLog("warn", "Tenant resolution error", {
      host: req.hostname,
      error: String(err),
    });
  }

  next();
}

/**
 * Route-level guard. Call after tenantResolverMiddleware.
 * Returns 400 if no tenant could be resolved for this request.
 */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!(req as any).tenantId) {
    return res.status(400).json({
      message: "Tenant could not be resolved for this request.",
    });
  }
  next();
}

/** Clears the in-process tenant resolution cache. Useful in tests. */
export function clearTenantCache() {
  cache.clear();
}
