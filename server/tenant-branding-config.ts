/**
 * Platform-owner-only branding config — server-side.
 *
 * Branding (logo, colors, policy-number prefix, etc.) lives authoritatively in
 * control_plane.tenant_branding. The legacy organizations columns are a read-only
 * fallback consulted by storage.ts's getOrganization() overlay when no control-plane
 * row exists yet — writes always go here, never to the legacy columns, matching the
 * pattern established by server/paynow-config.ts for PayNow credentials.
 */
import { eq } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantBranding } from "@shared/control-plane-schema";

export interface TenantBrandingPatch {
  logoUrl?: string | null;
  signatureUrl?: string | null;
  primaryColor?: string | null;
  footerText?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  policyNumberPrefix?: string | null;
  policyNumberPadding?: number | null;
  isWhitelabeled?: boolean;
}

/** Platform-owner-only write path. Upserts control_plane.tenant_branding. */
export async function upsertTenantBranding(tenantId: string, patch: TenantBrandingPatch): Promise<void> {
  const [existing] = await cpDb
    .select({ tenantId: tenantBranding.tenantId })
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);
  if (existing) {
    await cpDb.update(tenantBranding).set({ ...patch, updatedAt: new Date() }).where(eq(tenantBranding.tenantId, tenantId));
  } else {
    await cpDb.insert(tenantBranding).values({ tenantId, ...patch });
  }
}

/**
 * Seeds a tenant_branding row at tenant-creation time so a new tenant is never left
 * without a control-plane branding row (previously only created lazily on first edit).
 * No-ops if a row already exists.
 */
export async function seedTenantBranding(tenantId: string, initial: TenantBrandingPatch = {}): Promise<void> {
  await cpDb.insert(tenantBranding).values({ tenantId, ...initial }).onConflictDoNothing();
}

export async function getTenantBranding(tenantId: string) {
  const [row] = await cpDb.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1);
  return row ?? null;
}
