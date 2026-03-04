/**
 * Initial setup: seed permissions + platform owner, then add Falakhe tenant with all its users
 * and a default product so the tenant is ready to use.
 *
 * Run after db:reset (fresh schema). Uses existing rules: server/seed.ts and seed-tenant-from-backup.ts.
 *
 * Usage: npx tsx script/setup-fresh-with-falakhe.ts
 * Or:    npm run db:setup:falakhe
 */
import "dotenv/config";
import { execSync } from "child_process";
import path from "path";
import { seedDatabase } from "../server/seed";
import { storage } from "../server/storage";

const FALAKHE_BACKUP = "script/seed-data/falakhe-funeral-parlour-users.json";
const FALAKHE_ORG_NAME = "Falakhe Funeral Parlour";

async function run() {
  const cwd = path.resolve(process.cwd());

  console.log("Step 1/3: Seeding permissions, default org, and platform owner...");
  await seedDatabase();
  console.log("  Done.\n");

  console.log("Step 2/3: Seeding Falakhe tenant and users...");
  const backupPath = path.isAbsolute(FALAKHE_BACKUP) ? FALAKHE_BACKUP : path.resolve(cwd, FALAKHE_BACKUP);
  execSync(`npx tsx script/seed-tenant-from-backup.ts "${backupPath}"`, {
    cwd,
    stdio: "inherit",
  });
  console.log("  Done.\n");

  console.log("Step 3/3: Adding default product for Falakhe...");
  const allOrgs = await storage.getOrganizations();
  const falakhe = allOrgs.find((o) => !o.name?.endsWith(" (deleted)") && o.name.toLowerCase() === FALAKHE_ORG_NAME.toLowerCase());
  if (!falakhe) {
    console.warn("  Falakhe org not found; skipping default product.");
    return;
  }

  const existingProducts = await storage.getProductsByOrg(falakhe.id);
  if (existingProducts.length > 0) {
    console.log("  Falakhe already has products; skipping default product.");
    return;
  }

  const product = await storage.createProduct({
    organizationId: falakhe.id,
    name: "Standard Funeral Plan",
    code: "SFP-001",
    description: "Standard funeral cover for adults and dependants.",
    maxAdults: 2,
    maxChildren: 4,
    maxExtendedMembers: 0,
    coverAmount: "5000",
    coverCurrency: "USD",
    isActive: true,
  });

  const today = new Date().toISOString().split("T")[0];
  await storage.createProductVersion({
    productId: product.id,
    organizationId: falakhe.id,
    version: 1,
    effectiveFrom: today,
    premiumMonthlyUsd: "12",
    eligibilityMinAge: 18,
    eligibilityMaxAge: 70,
    dependentMaxAge: 21,
    waitingPeriodDays: 90,
    gracePeriodDays: 30,
    isActive: true,
  });
  console.log("  Created product: Standard Funeral Plan (SFP-001) with one version.\n");

  console.log("Setup complete.");
  console.log("  - Platform owner: ausiziba@gmail.com (or SUPERUSER_EMAIL). Log in and use 'Add tenant' or switch to Falakhe.");
  console.log("  - Falakhe users: default password ChangeMe123! (or set SEED_DEFAULT_PASSWORD).");
  console.log("  - Falakhe has one product ready for issuing policies.");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
