import { db } from "./db";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { securityQuestions } from "@shared/schema";
import { eq } from "drizzle-orm";
import { SYSTEM_PERMISSIONS, ROLE_PERMISSION_MAP } from "./constants";


const DEFAULT_SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "In what city were you born?",
  "What was the name of your primary school?",
  "What is your mother's maiden name?",
  "What was the make of your first car?",
];

export async function seedDatabase() {
  structuredLog("info", "Starting database seed...");

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
    });
    structuredLog("info", `Created default branch: ${defaultBranch.name}`);
  }

  for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
    let role = await storage.getRoleByName(roleName, defaultOrg.id);
    if (!role) {
      role = await storage.createRole({
        name: roleName,
        organizationId: defaultOrg.id,
        description: `System ${roleName} role`,
        isSystem: true,
      });
      structuredLog("info", `Created role: ${roleName}`);
    }

    if (roleName !== "superuser") {
      for (const permName of permNames) {
        const permId = permMap.get(permName);
        if (permId) {
          await storage.addRolePermission(role.id, permId, defaultOrg.id);
        }
      }
    }
  }

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
