/**
 * Platform owner — the highest authority in the system. This account owns the
 * POL263 platform itself (above tenant superusers). It always receives every
 * permission plus platform-level powers: create:tenant, delete:tenant,
 * manage:whitelabel. Tenant superusers only have full access *within* their
 * own tenant. The platform owner can access and manage all tenants.
 *
 * In production, SUPERUSER_EMAIL must be set (e.g. in DigitalOcean app env).
 * In development, falls back to a default if not set.
 */
function getPlatformOwnerEmail(): string {
  const env = process.env.SUPERUSER_EMAIL?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!env) {
      throw new Error("SUPERUSER_EMAIL must be set in production. Set it in your platform environment (e.g. DigitalOcean app env).");
    }
    return env;
  }
  return env || "ausiziba@gmail.com";
}

export const PLATFORM_OWNER_EMAIL = getPlatformOwnerEmail();

/** @deprecated alias kept for backward compat — use PLATFORM_OWNER_EMAIL */
export const PLATFORM_SUPERUSER_EMAIL = PLATFORM_OWNER_EMAIL;
