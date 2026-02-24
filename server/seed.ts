import { db } from "./db";
import { storage } from "./storage";
import { structuredLog } from "./logger";
import {
  organizations,
  branches,
  users,
  roles,
  permissions,
  rolePermissions,
  userRoles,
} from "@shared/schema";
import { eq } from "drizzle-orm";

const SYSTEM_PERMISSIONS = [
  { name: "read:organization", description: "View organization settings", category: "organization" },
  { name: "write:organization", description: "Edit organization settings", category: "organization" },
  { name: "read:branch", description: "View branches", category: "organization" },
  { name: "write:branch", description: "Create/edit branches", category: "organization" },
  { name: "read:user", description: "View users", category: "identity" },
  { name: "write:user", description: "Create/edit users", category: "identity" },
  { name: "delete:user", description: "Deactivate users", category: "identity" },
  { name: "read:role", description: "View roles", category: "rbac" },
  { name: "write:role", description: "Create/edit roles", category: "rbac" },
  { name: "manage:permissions", description: "Manage role-permission mappings", category: "rbac" },
  { name: "read:audit_log", description: "View audit logs", category: "audit" },
  { name: "read:policy", description: "View policies", category: "policy" },
  { name: "write:policy", description: "Create/edit policies", category: "policy" },
  { name: "delete:policy", description: "Cancel/void policies", category: "policy" },
  { name: "read:claim", description: "View claims", category: "claims" },
  { name: "write:claim", description: "Create/adjudicate claims", category: "claims" },
  { name: "read:client", description: "View clients", category: "clients" },
  { name: "write:client", description: "Create/edit clients", category: "clients" },
  { name: "read:product", description: "View products", category: "product" },
  { name: "write:product", description: "Create/edit products", category: "product" },
  { name: "manage:settings", description: "Manage tenant settings", category: "settings" },
  { name: "read:funeral_ops", description: "View funeral operations", category: "operations" },
  { name: "write:funeral_ops", description: "Manage funeral cases", category: "operations" },
  { name: "read:finance", description: "View financial records", category: "finance" },
  { name: "write:finance", description: "Create financial entries", category: "finance" },
];

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  superuser: [],
  executive: [
    "read:organization", "read:branch", "read:user", "read:role", "read:audit_log",
    "read:policy", "read:claim", "read:client", "read:product", "read:funeral_ops",
    "read:finance",
  ],
  manager: [
    "read:organization", "read:branch", "write:branch", "read:user", "write:user",
    "read:role", "read:audit_log", "read:policy", "write:policy", "read:claim",
    "write:claim", "read:client", "write:client", "read:product", "read:funeral_ops",
    "write:funeral_ops", "read:finance",
  ],
  administrator: [
    "read:organization", "write:organization", "read:branch", "write:branch",
    "read:user", "write:user", "delete:user", "read:role", "write:role",
    "manage:permissions", "read:audit_log", "read:policy", "write:policy",
    "read:claim", "write:claim", "read:client", "write:client", "read:product",
    "write:product", "manage:settings", "read:funeral_ops", "write:funeral_ops",
    "read:finance", "write:finance",
  ],
  cashier: [
    "read:policy", "read:client", "read:finance", "write:finance",
  ],
  agent: [
    "read:policy", "write:policy", "read:client", "write:client", "read:product",
  ],
  staff: [
    "read:organization", "read:branch", "read:policy", "read:claim",
    "read:client", "read:product", "read:funeral_ops",
  ],
};

export async function seedDatabase() {
  structuredLog("info", "Starting database seed...");

  // 1. Seed permissions
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

  // 2. Seed default organization
  let defaultOrg = (await storage.getOrganizations())[0];
  if (!defaultOrg) {
    defaultOrg = await storage.createOrganization({
      name: "Falakhe Funeral Parlour",
      logoUrl: "/assets/logo.png",
      primaryColor: "#2563EB",
      footerText: "For a service beyond Ubuntu",
    });
    structuredLog("info", `Created default organization: ${defaultOrg.name}`);
  }

  // 3. Seed default branch
  const existingBranches = await storage.getBranchesByOrg(defaultOrg.id);
  let defaultBranch = existingBranches[0];
  if (!defaultBranch) {
    defaultBranch = await storage.createBranch({
      organizationId: defaultOrg.id,
      name: "Head Office",
    });
    structuredLog("info", `Created default branch: ${defaultBranch.name}`);
  }

  // 4. Seed roles with permissions
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
          await storage.addRolePermission(role.id, permId);
        }
      }
    }
  }

  // 5. Superuser provisioning
  const superuserEmail = process.env.SUPERUSER_EMAIL || "ausiziba@gmail.com";
  let superuser = await storage.getUserByEmail(superuserEmail);

  if (!superuser) {
    superuser = await storage.createUser({
      email: superuserEmail,
      displayName: "System Administrator",
      organizationId: defaultOrg.id,
      isActive: true,
    });
    structuredLog("info", `Created superuser placeholder: ${superuserEmail}`, {
      userId: superuser.id,
    });
  } else if (!superuser.organizationId) {
    superuser = await storage.updateUser(superuser.id, {
      organizationId: defaultOrg.id,
    });
  }

  const superuserRoles = await storage.getUserRoles(superuser!.id);
  const hasSuperuserRole = superuserRoles.some((r) => r.name === "superuser");

  if (!hasSuperuserRole) {
    const superuserRole = await storage.getRoleByName("superuser", defaultOrg.id);
    if (superuserRole) {
      await storage.addUserRole(superuser!.id, superuserRole.id);
      structuredLog("info", `Auto-assigned superuser role to: ${superuserEmail}`, {
        userId: superuser!.id,
        roleId: superuserRole.id,
      });
    }
  }

  // Log the auto-assignment as an audit entry
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
