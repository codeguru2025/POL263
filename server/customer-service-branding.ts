/**
 * Phase 7 — tenant branding context for the WhatsApp customer-service bot.
 *
 * There is NO new branding storage here. Branding lives authoritatively in
 * control_plane.tenant_branding (see server/tenant-branding-config.ts) and is already merged
 * over the legacy organizations.* columns by storage.getOrganization(). This module just
 * projects that onto a small, message-layer-friendly shape the bot can inject into WhatsApp
 * text/media (one shared WhatsApp number has ONE profile picture — branding is per-MESSAGE,
 * never a dynamic profile-picture swap).
 */
import { storage } from "./storage";

export interface BrandingContext {
  name: string | null;
  displayName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  supportPhone: string | null;
  supportEmail: string | null;
  website: string | null;
  footerText: string | null;
}

/** A safe fallback when an org can't be loaded — keeps the bot generic rather than leaking. */
const GENERIC: BrandingContext = {
  name: null,
  displayName: null,
  logoUrl: null,
  primaryColor: null,
  supportPhone: null,
  supportEmail: null,
  website: null,
  footerText: null,
};

/**
 * Resolve branding for a tenant that has ALREADY been resolved server-side (unique match or
 * dedicated channel) or verified. Never call this to answer an unverified/ambiguous lookup —
 * that would leak a tenant name (Phase 3).
 */
export async function getBrandingContext(orgId: string): Promise<BrandingContext> {
  if (!orgId || typeof orgId !== "string") return { ...GENERIC };
  let org: any;
  try {
    org = await storage.getOrganization(orgId);
  } catch {
    return { ...GENERIC };
  }
  if (!org) return { ...GENERIC };
  const name: string | null = org.name ?? null;
  return {
    name,
    // displayName: a shorter form for message headers ("MY FALAKHE POLICY") — first word of
    // the legal name, uppercased. Falls back to the full name.
    displayName: name ? name.split(/\s+/)[0].toUpperCase() : null,
    logoUrl: org.logoUrl ?? null,
    primaryColor: org.primaryColor ?? null,
    supportPhone: org.phone ?? null,
    supportEmail: org.email ?? null,
    website: org.website ?? null,
    footerText: org.footerText ?? null,
  };
}

/** Wire shape for API responses — snake_case, same field set. */
export function toBrandingResponse(b: BrandingContext) {
  return {
    name: b.name,
    display_name: b.displayName,
    logo_url: b.logoUrl,
    primary_color: b.primaryColor,
    support_phone: b.supportPhone,
    support_email: b.supportEmail,
    website: b.website,
    footer_text: b.footerText,
  };
}
