import { db } from "./db";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { securityQuestions } from "@shared/schema";
import { SYSTEM_PERMISSIONS, ROLE_PERMISSION_MAP, PLATFORM_OWNER_EMAIL } from "./constants";

/** Fixed name marker for the sandbox org — createSandboxOrg() looks for this exact name to
 *  stay idempotent (reruns reuse the existing org instead of creating duplicates), and it
 *  doubles as an unmistakable label anywhere the org name renders (nav, PDFs, receipts). */
export const SANDBOX_ORG_NAME = "🧪 Sandbox / QA (Test Data — Not Real)";

const DEFAULT_SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "In what city were you born?",
  "What was the name of your primary school?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
];

/** Upserts all system permissions into the shared DB. Returns a name→id map. */
export async function seedPermissions(): Promise<Map<string, string>> {
  const existingPerms = await storage.getPermissions();
  const permMap = new Map<string, string>();

  for (const perm of SYSTEM_PERMISSIONS) {
    const existing = existingPerms.find((p) => p.name === perm.name);
    if (existing) {
      permMap.set(perm.name, existing.id);
    } else {
      const created = await storage.createPermission(perm);
      permMap.set(perm.name, created.id);
      structuredLog("info", `Created permission: ${perm.name}`);
    }
  }
  return permMap;
}

/**
 * Resets all system roles for the given org to match the current ROLE_PERMISSION_MAP.
 * Creates missing roles, then clears and re-applies permissions for each role.
 * Pass a pre-built permMap to avoid redundant DB calls when calling after seedPermissions().
 */
export async function seedOrgRoles(orgId: string, permMap?: Map<string, string>): Promise<void> {
  const map = permMap ?? await seedPermissions();

  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
    let role = await storage.getRoleByName(roleName, orgId);
    if (!role) {
      role = await storage.createRole({
        name: roleName,
        organizationId: orgId,
        description: `System ${roleName} role`,
        isSystem: true,
      });
      structuredLog("info", `Created role: ${roleName} for org ${orgId}`);
    }

    if (roleName === "superuser") continue;

    // Reset to system defaults: clear existing permissions then apply the current map.
    await storage.clearRolePermissions(role.id, orgId);
    for (const permName of permNames) {
      const permId = map.get(permName);
      if (permId) await storage.addRolePermission(role.id, permId, orgId);
    }
  }

  structuredLog("info", `Roles seeded for org ${orgId}`);
}

export async function seedDatabase() {
  structuredLog("info", "Starting database seed...");

  const permMap = await seedPermissions();

  let defaultOrg = (await storage.getOrganizations())[0];
  if (!defaultOrg) {
    defaultOrg = await storage.createOrganization({
      name: "POL263",
      logoUrl: "/assets/logo.png",
      primaryColor: "#0d9488",
      footerText: "For a service beyond Ubuntu",
    });
    structuredLog("info", `Created default organization: ${defaultOrg.name}`);
  }

  const existingBranches = await storage.getBranchesByOrg(defaultOrg.id);
  let defaultBranch = existingBranches[0];
  if (!defaultBranch) {
    defaultBranch = await storage.createBranch({
      organizationId: defaultOrg.id,
      name: "Head Office",
      isHeadOffice: true,
    });
    structuredLog("info", `Created default branch: ${defaultBranch.name}`);
  }

  await seedOrgRoles(defaultOrg.id, permMap);

  for (const question of DEFAULT_SECURITY_QUESTIONS) {
    await db
      .insert(securityQuestions)
      .values({ organizationId: defaultOrg.id, question })
      .onConflictDoNothing();
  }

  const superuserEmail = process.env.SUPERUSER_EMAIL || "ausiziba@gmail.com";
  let superuser = await storage.getUserByEmail(superuserEmail);

  if (!superuser) {
    superuser = await storage.createUser({
      email: superuserEmail,
      displayName: "Platform Owner",
      isActive: true,
    });
    structuredLog("info", `Created platform owner: ${superuserEmail}`, {
      userId: superuser.id,
    });
  } else if (superuser.organizationId) {
    superuser = await storage.updateUser(superuser.id, {
      organizationId: null,
    });
    structuredLog("info", `Unlinked platform owner from tenant: ${superuserEmail}`);
  }

  await storage.createAuditLog({
    organizationId: defaultOrg.id,
    actorId: superuser!.id,
    actorEmail: superuserEmail,
    action: "SEED_COMPLETE",
    entityType: "System",
    entityId: "seed",
    before: null,
    after: { superuserEmail, orgName: defaultOrg.name, branchName: defaultBranch.name },
    requestId: "system-seed",
  });

  structuredLog("info", "Database seed completed successfully.");
}

/**
 * Creates (or reuses, if already present) a dedicated "Sandbox / QA" organization on the
 * shared platform DB, seeded with a small set of obviously-fake test data. Intended for
 * staff to safely test features/pages without touching real trial-tenant data.
 *
 * Deliberately created via storage.createOrganization() directly rather than
 * provisionTenantCore() (server/tenant-provisioning.ts) — that path inserts a row into the
 * control-plane `tenants` table, which is what platform dashboards/tenant-health/revenue
 * views actually read from. Skipping it keeps this org fully invisible to platform-level
 * reporting, same isolation guarantee as regular per-org data scoping gives it from other
 * tenants' data. Idempotent: reruns find the existing org by its fixed name and only fill in
 * whatever's still missing, rather than creating duplicates.
 */
export async function createSandboxOrg(): Promise<void> {
  structuredLog("info", "Provisioning sandbox org...");

  const permMap = await seedPermissions();

  let org = (await storage.getOrganizations()).find((o) => o.name === SANDBOX_ORG_NAME);
  if (!org) {
    org = await storage.createOrganization({
      name: SANDBOX_ORG_NAME,
      primaryColor: "#d97706",
      footerText: "SANDBOX ENVIRONMENT — test data only, not a real customer.",
      policyNumberPrefix: "SBX",
      orgType: "funeral_assurer",
      productTypes: ["funeral_cash_plan"],
      distributionChannels: ["agents", "digital_self_service"],
      bookStatus: "new",
      staffComplement: 3,
      onboardingProfileCompletedAt: new Date(),
    });
    structuredLog("info", `Created sandbox organization: ${org.id}`);
  } else {
    structuredLog("info", `Sandbox organization already exists: ${org.id}`);
  }

  const existingBranches = await storage.getBranchesByOrg(org.id);
  let branch = existingBranches[0];
  if (!branch) {
    branch = await storage.createBranch({
      organizationId: org.id,
      name: "Head Office",
      isHeadOffice: true,
    });
    structuredLog("info", `Created sandbox branch: ${branch.name}`);
  }

  await seedOrgRoles(org.id, permMap);

  const existingProducts = await storage.getProductsByOrg(org.id);
  let product = existingProducts.find((p) => p.code === "SBX-FAM");
  if (!product) {
    product = await storage.createProduct({
      organizationId: org.id,
      name: "Sandbox Family Plan",
      code: "SBX-FAM",
      description: "Seeded test product — safe to edit or delete.",
      maxAdults: 2,
      maxChildren: 4,
      casketType: "Standard",
      coverAmount: "3000",
      coverCurrency: "USD",
      isActive: true,
    });
    structuredLog("info", `Created sandbox product: ${product.name}`);

    await storage.createProductVersion({
      productId: product.id,
      organizationId: org.id,
      version: 1,
      effectiveFrom: new Date().toISOString().slice(0, 10),
      premiumMonthlyUsd: "15.00",
      eligibilityMinAge: 18,
      eligibilityMaxAge: 70,
      dependentMaxAge: 20,
      waitingPeriodDays: 90,
      gracePeriodDays: 30,
      commissionFirstMonthsCount: 3,
      commissionFirstMonthsRate: "40",
      commissionRecurringRate: "10",
    });
    structuredLog("info", "Created sandbox product version 1");
  }

  const SANDBOX_CLIENTS = [
    { firstName: "Tendai", lastName: "Sandbox-Moyo", phone: "0770000001", email: "tendai@sandbox.test", gender: "male" },
    { firstName: "Rutendo", lastName: "Sandbox-Chikwava", phone: "0770000002", email: "rutendo@sandbox.test", gender: "female" },
    { firstName: "Farai", lastName: "Sandbox-Ndlovu", phone: "0770000003", email: "farai@sandbox.test", gender: "male" },
    { firstName: "Chiedza", lastName: "Sandbox-Mutasa", phone: "0770000004", email: "chiedza@sandbox.test", gender: "female" },
  ];
  const existingClients = await storage.getClientsByOrg(org.id);
  for (const c of SANDBOX_CLIENTS) {
    if (existingClients.some((ec) => ec.email === c.email)) continue;
    const client = await storage.createClient({
      organizationId: org.id,
      branchId: branch.id,
      firstName: c.firstName,
      lastName: c.lastName,
      phone: c.phone,
      email: c.email,
      gender: c.gender,
      isActive: true,
    });
    structuredLog("info", `Created sandbox client: ${client.firstName} ${client.lastName}`);
  }

  const owner = await storage.getUserByEmail(PLATFORM_OWNER_EMAIL);
  if (owner) {
    await storage.createAuditLog({
      organizationId: org.id,
      actorId: owner.id,
      actorEmail: owner.email!,
      action: "SANDBOX_PROVISIONED",
      entityType: "System",
      entityId: "sandbox-seed",
      before: null,
      after: { orgId: org.id, orgName: org.name },
      requestId: "system-sandbox-seed",
    });
  }

  structuredLog("info", `Sandbox org ready: ${org.id}. Switch into it from the platform-owner dashboard to test.`);
}
