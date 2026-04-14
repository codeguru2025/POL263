/**
 * Drizzle config for pushing the tenant schema to any isolated tenant database.
 * Used for pol263-falakhe, pol263-sunrest, etc.
 *
 * Usage:
 *   TENANT_DIRECT_URL=<direct_url> drizzle-kit push --config=drizzle.tenant.config.ts
 *
 * Or use the named npm scripts:
 *   npm run db:push:falakhe
 */
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.TENANT_DIRECT_URL;

if (!url) {
  throw new Error(
    "TENANT_DIRECT_URL must be set.\n" +
    "Example: cross-env TENANT_DIRECT_URL=$FALAKHE_DIRECT_URL npm run db:push:tenant"
  );
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: { rejectUnauthorized: false },
  },
});
