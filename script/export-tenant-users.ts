/**
 * Export all users (and their roles/branches) for a tenant so they can be re-seeded later.
 * Passwords are NOT exported; re-seed script will set a default password.
 *
 * Usage: npx tsx script/export-tenant-users.ts [tenant-name]
 * Example: npx tsx script/export-tenant-users.ts "Falakhe Funeral Parlour"
 * Output: script/seed-data/<slug>-users.json
 */
import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { storage } from "../server/storage";

const DEFAULT_TENANT_NAME = "Falakhe Funeral Parlour";

async function run() {
  const tenantName = process.argv[2] || DEFAULT_TENANT_NAME;

  const allOrgs = await storage.getOrganizations();
  const activeOrgs = allOrgs.filter((o) => !o.name?.endsWith(" (deleted)"));
  const org = activeOrgs.find(
    (o) => o.name.toLowerCase().includes(tenantName.toLowerCase())
  );

  if (!org) {
    console.error(
      `No tenant found matching "${tenantName}". Available: ${activeOrgs.map((o) => o.name).join(", ") || "none"}`
    );
    process.exit(1);
  }

  const branches = await storage.getBranchesByOrg(org.id);
  const branchIdToName = new Map(branches.map((b) => [b.id, b.name]));

  const usersList = await storage.getUsersByOrg(org.id, 500, 0);
  const usersExport: {
    email: string;
    displayName: string | null;
    phone: string | null;
    referralCode: string | null;
    roles: { roleName: string; branchName: string | null }[];
  }[] = [];

  for (const u of usersList) {
    const rolesList = await storage.getUserRoles(u.id, org.id);
    usersExport.push({
      email: u.email,
      displayName: u.displayName ?? null,
      phone: u.phone ?? null,
      referralCode: u.referralCode ?? null,
      roles: rolesList.map((r) => ({
        roleName: r.name,
        branchName: r.branchId ? branchIdToName.get(r.branchId) ?? null : null,
      })),
    });
  }

  const exportData = {
    tenantName: org.name,
    organizationId: org.id,
    exportedAt: new Date().toISOString(),
    branches: branches.map((b) => ({ id: b.id, name: b.name })),
    users: usersExport,
  };

  const slug = tenantName
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const dir = path.resolve(process.cwd(), "script", "seed-data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${slug}-users.json`);
  fs.writeFileSync(outPath, JSON.stringify(exportData, null, 2), "utf-8");

  console.log(`Exported ${usersExport.length} users for "${org.name}" to ${outPath}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
