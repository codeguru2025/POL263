/**
 * Provisions (or reuses, if already present) a "Sandbox / QA" organization on the shared
 * platform DB, seeded with a small set of obviously-fake test data — for staff to safely
 * test features/pages without touching real trial-tenant data. Invisible to platform-level
 * reporting (see createSandboxOrg() in server/seed.ts for why).
 *
 * Usage: npm run db:sandbox
 * Requires: DATABASE_URL set, schema already pushed/migrated.
 * To use it: log in as the platform owner and switch into the sandbox org from the
 * platform dashboard (client-side/staff auth is Google-OAuth-only, keyed by email — no
 * separate sandbox login is created).
 */
import "dotenv/config";
import { createSandboxOrg } from "../server/seed";

createSandboxOrg()
  .then(() => {
    console.log("Sandbox org ready.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("Sandbox provisioning failed:", err);
    process.exit(1);
  });
