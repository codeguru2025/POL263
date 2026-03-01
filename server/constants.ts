/**
 * Platform owner — the highest authority in the system. This account owns the
 * POL263 platform itself (above tenant superusers). It always receives every
 * permission plus platform-level powers: create:tenant, delete:tenant,
 * manage:whitelabel. Tenant superusers only have full access *within* their
 * own tenant. The platform owner can access and manage all tenants.
 */
export const PLATFORM_OWNER_EMAIL = process.env.SUPERUSER_EMAIL || "ausiziba@gmail.com";

/** @deprecated alias kept for backward compat — use PLATFORM_OWNER_EMAIL */
export const PLATFORM_SUPERUSER_EMAIL = PLATFORM_OWNER_EMAIL;
