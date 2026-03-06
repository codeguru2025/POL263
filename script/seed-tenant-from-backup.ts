/**
 * Re-create a tenant and its users from a backup JSON produced by export-tenant-users.ts.
 * New users get a default password (set SEED_DEFAULT_PASSWORD or use "ChangeMe123!").
 *
 * Usage: npx tsx script/seed-tenant-from-backup.ts [path-to-backup.json]
 * Example: npx tsx script/seed-tenant-from-backup.ts script/seed-data/falakhe-funeral-parlour-users.json
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import argon2 from "argon2";
import { storage } from "../server/storage";

const DEFAULT_PASSWORD = process.env.SEED_DEFAULT_PASSWORD || "ChangeMe123!";

const ROLE_PERMISSION_MAP: Record<string, string[]> = {
  superuser: [],
  executive: [
    "read:organization", "read:branch", "read:user", "read:role", "read:audit_log",
    "read:policy", "read:claim", "read:client", "read:product", "read:funeral_ops",
    "read:finance", "read:fleet", "read:commission", "read:payroll", "read:report",
    "read:lead", "read:notification",
  ],
  manager: [
    "read:organization", "read:branch", "write:branch", "read:user", "write:user",
    "read:role", "read:audit_log", "read:policy", "write:policy", "read:claim",
    "write:claim", "approve:claim", "read:client", "write:client", "read:product",
    "write:product", "manage:settings",
    "read:funeral_ops", "write:funeral_ops", "read:finance", "read:fleet", "write:fleet",
    "read:commission", "read:report", "write:report", "read:lead", "write:lead",
    "read:notification", "manage:approvals",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "view:all_clients",
  ],
  administrator: [
    "read:organization", "write:organization", "read:branch", "write:branch",
    "read:user", "write:user", "delete:user", "read:role", "write:role",
    "manage:permissions", "read:audit_log", "read:policy", "write:policy",
    "read:claim", "write:claim", "approve:claim", "read:client", "write:client",
    "read:product", "write:product", "manage:settings", "read:funeral_ops",
    "write:funeral_ops", "read:finance", "write:finance", "approve:finance",
    "read:fleet", "write:fleet", "read:commission", "write:commission",
    "read:payroll", "write:payroll", "read:report", "write:report",
    "read:lead", "write:lead", "read:notification", "write:notification",
    "manage:approvals", "backdate:payment",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
    "view:own_clients", "view:all_clients",
  ],
  cashier: [
    "read:policy", "read:client", "read:finance", "write:finance", "read:report",
    "receipt:cash", "receipt:mobile", "receipt:transfer", "receipt:group",
  ],
  agent: [
    "read:policy", "write:policy", "read:client", "write:client", "read:product",
    "read:lead", "write:lead", "read:commission", "read:report",
    "read:finance", "receipt:cash",
  ],
  claims_officer: [
    "read:policy", "read:claim", "write:claim", "approve:claim", "read:client",
    "read:funeral_ops", "write:funeral_ops", "read:finance", "read:report",
  ],
  fleet_ops: [
    "read:fleet", "write:fleet", "read:funeral_ops", "write:funeral_ops", "read:report",
  ],
  staff: [
    "read:organization", "read:branch", "read:policy", "read:claim",
    "read:client", "read:product", "read:funeral_ops", "read:report",
  ],
};

type BackupUser = {
  email: string;
  displayName: string | null;
  phone: string | null;
  referralCode: string | null;
  roles: { roleName: string; branchName: string | null }[];
};

type Backup = {
  tenantName: string;
  organizationId: string;
  exportedAt: string;
  branches: { id: string; name: string }[];
  users: BackupUser[];
};

async function run() {
  const relPath = process.argv[2] || "script/seed-data/falakhe-funeral-parlour-users.json";
  const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(process.cwd(), relPath);

  if (!fs.existsSync(absPath)) {
    console.error(`Backup file not found: ${absPath}`);
    console.error("Run: npx tsx script/export-tenant-users.ts \"Falakhe Funeral Parlour\" first.");
    process.exit(1);
  }

  const backup: Backup = JSON.parse(fs.readFileSync(absPath, "utf-8"));
  const { tenantName, users: usersBackup } = backup;

  const allOrgs = await storage.getOrganizations();
  const activeOrgs = allOrgs.filter((o) => !o.name?.endsWith(" (deleted)"));
  let org = activeOrgs.find((o) => o.name.toLowerCase() === tenantName.toLowerCase());

  let defaultBranch: { id: string; name: string };
  const roleMap = new Map<string, string>();

  if (org) {
    console.log(`Tenant "${tenantName}" already exists (${org.id}). Using it.`);
    const branches = await storage.getBranchesByOrg(org.id);
    defaultBranch = branches[0] || (await storage.createBranch({
      organizationId: org.id,
      name: "Head Office",
      isActive: true,
    }));
    const rolesList = await storage.getRolesByOrg(org.id);
    for (const r of rolesList) roleMap.set(r.name, r.id);
  } else {
    org = await storage.createOrganization({ name: tenantName });
    console.log(`Created tenant "${tenantName}" (${org.id}).`);
    defaultBranch = await storage.createBranch({
      organizationId: org.id,
      name: "Head Office",
      isActive: true,
    });

    const allPerms = await storage.getPermissions();
    const permMap = new Map<string, string>();
    for (const p of allPerms) permMap.set(p.name, p.id);

    for (const [roleName, permNames] of Object.entries(ROLE_PERMISSION_MAP)) {
      const role = await storage.createRole({
        name: roleName,
        organizationId: org!.id,
        description: `System ${roleName} role`,
        isSystem: true,
      });
      roleMap.set(roleName, role.id);
      if (roleName !== "superuser") {
        for (const permName of permNames) {
          const permId = permMap.get(permName);
          if (permId) await storage.addRolePermission(role.id, permId, org!.id);
        }
      }
    }
    console.log("Created roles and permissions.");
  }

  const passwordHash = await argon2.hash(DEFAULT_PASSWORD, { type: argon2.argon2id });
  let created = 0;
  let skipped = 0;

  for (const u of usersBackup) {
    const existing = await storage.getUserByEmail(u.email);
    if (existing) {
      if (existing.organizationId === org!.id) {
        console.log(`  Skip (already in tenant): ${u.email}`);
        skipped++;
        continue;
      }
      await storage.updateUser(existing.id, {
        organizationId: org!.id,
        branchId: defaultBranch.id,
        displayName: u.displayName ?? existing.displayName,
        phone: u.phone ?? existing.phone,
        referralCode: u.referralCode ?? existing.referralCode,
      });
      const existingRoles = await storage.getUserRoles(existing.id, org!.id);
      const existingRoleNames = new Set(existingRoles.map((r) => r.name));
      for (const { roleName } of u.roles) {
        if (existingRoleNames.has(roleName)) continue;
        const roleId = roleMap.get(roleName);
        if (roleId) await storage.addUserRole(existing.id, roleId, org!.id, defaultBranch.id);
      }
      console.log(`  Reassigned to tenant: ${u.email}`);
      created++;
      continue;
    }

    const refCode = u.referralCode || `AGT${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const newUser = await storage.createUser({
      email: u.email,
      displayName: u.displayName || u.email.split("@")[0],
      organizationId: org!.id,
      branchId: defaultBranch.id,
      phone: u.phone ?? undefined,
      referralCode: refCode,
      isActive: true,
      passwordHash,
    });

    for (const { roleName } of u.roles) {
      const roleId = roleMap.get(roleName);
      if (roleId) await storage.addUserRole(newUser.id, roleId, org!.id, defaultBranch.id);
    }
    console.log(`  Created: ${u.email}`);
    created++;
  }

  console.log(`\nDone. Created/reassigned: ${created}, skipped: ${skipped}.`);
  console.log(`Default password for new users: ${DEFAULT_PASSWORD}`);
  console.log(`Tell users to change password after first login.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
