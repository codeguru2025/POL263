/**
 * Shared tenant-provisioning sequence: generate a slug and register in the control plane, seed
 * branding, create the default branch, seed every system role/permission, optionally create an
 * admin user, and start the auto-trial subscription.
 *
 * Used by both the platform-owner "New Tenant" admin flow (POST /api/organizations,
 * server/routes.ts) and the public self-serve signup flow (server/tenant-signup-service.ts) —
 * the sequence must stay identical between the two callers, since a partially-provisioned tenant
 * is exactly the failure mode both need to avoid. Callers are responsible for creating the
 * `organizations` row itself first (their admin-only vs. public-only field whitelisting differs)
 * and for rollback if provisioning throws — see POST /api/organizations' catch block for the
 * soft-delete-on-failure pattern this was extracted from.
 */
import { eq, asc } from "drizzle-orm";
import argon2 from "argon2";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, billingPlans, billingSettings, tenantSubscriptions } from "@shared/control-plane-schema";
import { seedTenantBranding } from "./tenant-branding-config";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { ROLE_PERMISSION_MAP } from "./constants";
import type { Organization } from "@shared/schema";

/** URL-safe slug for subdomain routing (tenant-resolver.ts), unique in the control plane. */
export async function generateUniqueTenantSlug(orgName: string): Promise<string> {
  const base = orgName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tenant";
  let candidate = base;
  let suffix = 1;
  while (true) {
    const [existing] = await cpDb.select({ id: cpTenants.id }).from(cpTenants).where(eq(cpTenants.slug, candidate)).limit(1);
    if (!existing) return candidate;
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
}

export interface ProvisionTenantOpts {
  adminEmail?: string;
  /** Plaintext — hashed here. Ignored if adminPasswordHash is also given. */
  adminPassword?: string;
  /** Already-hashed (e.g. the self-signup flow hashes at submit time, well before
   *  provisioning runs) — used as-is instead of hashing adminPassword. */
  adminPasswordHash?: string;
  adminDisplayName?: string;
  /** Explicit plan choice (self-signup). Omitted = fall back to the first active plan by sort
   *  order, same as the admin-created-tenant default this was extracted from. */
  planId?: string;
  /** monthly | annual, carried onto the auto-trial subscription. Admin-created tenants pass
   *  "monthly" — today's exact behavior, unchanged. */
  billingCycle?: string;
}

export interface ProvisionTenantResult {
  defaultBranchId: string;
  adminUser: { id: string; email: string; displayName: string | null } | null;
}

export async function provisionTenantCore(org: Organization, opts: ProvisionTenantOpts = {}): Promise<ProvisionTenantResult> {
  // Register in the control plane too — tenant_databases (needed to later commission a
  // dedicated database) and tenant_branding both have a foreign key to control_plane.tenants,
  // so a tenant that only exists in the shared registry DB can never get either. New orgs
  // start on the shared platform DB in "trial" status; commissioning a dedicated database
  // (see POST /api/platform/tenants/:id/commission-database) flips this to "active" once
  // a real database has been provisioned and their data migrated onto it.
  const slug = await generateUniqueTenantSlug(org.name);
  await cpDb.insert(cpTenants).values({
    id: org.id,
    name: org.name,
    slug,
    isActive: true,
    licenseStatus: "trial",
    provisioningState: "ready",
  });
  await seedTenantBranding(org.id, {
    logoUrl: org.logoUrl,
    signatureUrl: org.signatureUrl,
    primaryColor: org.primaryColor,
    footerText: org.footerText,
    address: org.address,
    phone: org.phone,
    email: org.email,
    website: org.website,
    policyNumberPrefix: org.policyNumberPrefix,
    policyNumberPadding: org.policyNumberPadding,
    isWhitelabeled: org.isWhitelabeled,
  });

  const defaultBranch = await storage.createBranch({
    organizationId: org.id,
    name: "Head Office",
    isActive: true,
    isHeadOffice: true,
  });

  const allPerms = await storage.getPermissions();
  const permMap = new Map<string, string>();
  for (const p of allPerms) permMap.set(p.name, p.id);

  const roleMap = new Map<string, string>();
  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
    const role = await storage.createRole({
      name: roleName,
      organizationId: org.id,
      description: `System ${roleName} role`,
      isSystem: true,
    });
    roleMap.set(roleName, role.id);

    if (roleName !== "superuser") {
      for (const permName of permNames) {
        const permId = permMap.get(permName);
        if (permId) await storage.addRolePermission(role.id, permId, org.id);
      }
    }
  }

  let adminUser: ProvisionTenantResult["adminUser"] = null;
  if (opts.adminEmail && (opts.adminPassword || opts.adminPasswordHash)) {
    const passwordHash = opts.adminPasswordHash ?? await argon2.hash(String(opts.adminPassword), { type: argon2.argon2id });
    const refCode = `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const created = await storage.createUser({
      email: opts.adminEmail,
      displayName: opts.adminDisplayName || opts.adminEmail.split("@")[0],
      organizationId: org.id,
      branchId: defaultBranch.id,
      referralCode: refCode,
      isActive: true,
      passwordHash,
    });
    adminUser = { id: created.id, email: created.email, displayName: created.displayName };

    const adminRoleId = roleMap.get("administrator");
    if (adminRoleId) await storage.addUserRole(created.id, adminRoleId, org.id);
  }

  // Auto-trial: every new tenant starts on a trial subscription so billing
  // enforcement (once turned on, see server/module-gate.ts) has something to
  // check from day one. Fails soft if no plan has been seeded yet — tenant
  // provisioning must never fail just because billing setup hasn't happened yet.
  try {
    const [plan] = opts.planId
      ? await cpDb.select().from(billingPlans).where(eq(billingPlans.id, opts.planId)).limit(1)
      : await cpDb.select().from(billingPlans).where(eq(billingPlans.isActive, true)).orderBy(asc(billingPlans.sortOrder)).limit(1);
    if (plan) {
      const [settings] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
      const trialDays = settings?.trialDays ?? 14;
      const now = new Date();
      const trialEndsAt = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000);
      await cpDb.insert(tenantSubscriptions).values({
        tenantId: org.id,
        planId: plan.id,
        status: "trialing",
        billingCycle: opts.billingCycle === "annual" ? "annual" : "monthly",
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
      });
    } else {
      structuredLog("warn", "No billing plan exists yet — skipping auto-trial subscription", { orgId: org.id });
    }
  } catch (err) {
    structuredLog("error", "Auto-trial subscription creation failed — tenant provisioned without one", { orgId: org.id, error: (err as Error).message });
  }

  return { defaultBranchId: defaultBranch.id, adminUser };
}

/** Best-effort rollback for a tenant whose provisioning threw partway through — mirrors the
 *  soft-delete pattern POST /api/organizations used inline before this was extracted. */
export async function rollbackFailedProvisioning(orgId: string, orgName: string): Promise<void> {
  try {
    await storage.updateOrganization(orgId, { name: orgName + " (deleted)" });
  } catch (rollbackErr) {
    structuredLog("error", "Failed to soft-delete orphaned org after provisioning failure", {
      orgId, error: (rollbackErr as Error).message,
    });
  }
  try {
    await cpDb.update(cpTenants).set({ isActive: false, name: orgName + " (deleted)" }).where(eq(cpTenants.id, orgId));
  } catch (rollbackErr) {
    structuredLog("error", "Failed to deactivate orphaned control-plane tenant after provisioning failure", {
      orgId, error: (rollbackErr as Error).message,
    });
  }
}
