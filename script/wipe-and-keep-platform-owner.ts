/**
 * Wipe all tenants and all users except the platform owner (ausiziba@gmail.com).
 * After running:
 * - Only the platform owner can log in.
 * - They have no tenant selected and are taken to the "create tenant" flow.
 *
 * Usage: npx tsx script/wipe-and-keep-platform-owner.ts
 * Optional: SUPERUSER_EMAIL=other@example.com npx tsx script/wipe-and-keep-platform-owner.ts
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "../server/db";
import { getDbForOrg } from "../server/tenant-db";
import { storage } from "../server/storage";
import { PLATFORM_OWNER_EMAIL } from "../server/constants";
import { users, userRoles, userPermissionOverrides, organizations } from "@shared/schema";

async function run() {
  const keeperEmail = PLATFORM_OWNER_EMAIL.toLowerCase();

  const allUsers = await db.select().from(users);
  const platformOwner = allUsers.find((u) => u.email?.toLowerCase() === keeperEmail);

  if (!platformOwner) {
    console.error(
      `Platform owner "${PLATFORM_OWNER_EMAIL}" not found in database. Create the user first (e.g. run seed or sign in once).`
    );
    process.exit(1);
  }

  const allOrgs = await db.select({ id: organizations.id, name: organizations.name }).from(organizations);
  const toSoftDelete = allOrgs.filter((o) => !o.name?.endsWith(" (deleted)"));

  console.log(`Keeping user: ${platformOwner.email} (${platformOwner.id})`);
  console.log(`Removing ${allUsers.length - 1} other user(s) and soft-deleting ${toSoftDelete.length} org(s).`);

  for (const u of allUsers) {
    if (u.id === platformOwner.id) continue;

    // Clear user_roles from every tenant db (and default)
    for (const org of allOrgs) {
      try {
        const tdb = await getDbForOrg(org.id);
        await tdb.delete(userRoles).where(eq(userRoles.userId, u.id));
      } catch (_) {
        // Ignore missing table or connection errors per org
      }
    }
    await db.delete(userRoles).where(eq(userRoles.userId, u.id));
    await db.delete(userPermissionOverrides).where(eq(userPermissionOverrides.userId, u.id));
    await db.delete(users).where(eq(users.id, u.id));
    console.log(`  Removed user: ${u.email}`);
  }

  await storage.updateUser(platformOwner.id, { organizationId: null });
  console.log(`  Cleared tenant for platform owner.`);

  for (const org of toSoftDelete) {
    await storage.updateOrganization(org.id, { name: org.name + " (deleted)" });
    console.log(`  Soft-deleted org: ${org.name}`);
  }

  console.log("Done. Only the platform owner can log in; they will see the create-tenant flow.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
