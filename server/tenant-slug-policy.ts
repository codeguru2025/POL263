/**
 * Slugs that must never be assignable to a tenant, because they collide with
 * infra/platform hostnames or common admin paths. Enforced at both tenant-slug
 * write paths: auto-generation (tenant-provisioning.ts) and platform-owner edit
 * (PATCH /api/organizations/:id in routes.ts). Single source of truth — do not
 * duplicate this list.
 */
export const RESERVED_TENANT_SLUGS = new Set([
  "controlpanel",
  "www",
  "api",
  "admin",
  "app",
  "platform",
  "staff",
  "client",
  "agent",
  "mail",
  "ns1",
  "ns2",
  "assets",
  "static",
]);

/**
 * Also folds in the live PLATFORM_ADMIN_SUBDOMAIN env value, so the list stays
 * correct even if an operator renames the admin host without remembering to
 * update this file.
 */
export function isReservedTenantSlug(slug: string): boolean {
  const candidate = slug.trim().toLowerCase();
  if (RESERVED_TENANT_SLUGS.has(candidate)) return true;
  const adminSub = (process.env.PLATFORM_ADMIN_SUBDOMAIN || "").trim().toLowerCase();
  return !!adminSub && candidate === adminSub;
}
