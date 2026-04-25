/**
 * Control plane database connection (pol263-control-plane on DigitalOcean).
 *
 * USE THIS FOR:  tenant registry, DB routing, integrations, branding, feature flags.
 * NEVER USE FOR: policies, clients, payments, claims — those live in tenant databases.
 */
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as cpSchema from "@shared/control-plane-schema";
import { structuredLog } from "./logger";

let connectionString = (
  process.env.CONTROL_PLANE_DATABASE_URL ||
  process.env.CONTROL_PLANE_DIRECT_URL ||
  process.env.DATABASE_URL
)?.trim();

if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. " +
    "Set CONTROL_PLANE_DATABASE_URL for a dedicated control plane database."
  );
}

if (!process.env.CONTROL_PLANE_DATABASE_URL && !process.env.CONTROL_PLANE_DIRECT_URL) {
  // No dedicated control plane DB — using shared DB. tenant_databases table may not exist;
  // getPoolForOrg already falls back to organizations.database_url on query failure.
  structuredLog("warn", "CONTROL_PLANE_DATABASE_URL not set — falling back to DATABASE_URL for control plane");
}

// If we provide explicit ssl config, strip sslmode from URL so pg doesn't force
// strict cert verification from connection-string parsing.
connectionString = connectionString
  .replace(/\?sslmode=[^&]*&?/gi, "?")
  .replace(/&sslmode=[^&]*/gi, "")
  .replace(/\?$/, "");

export const cpPool = new pg.Pool({
  connectionString,
  // Control plane handles only tenant-resolution lookups — low volume, small pool.
  max: 5,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  // DigitalOcean managed databases use self-signed certs.
  ssl: { rejectUnauthorized: false },
});

cpPool.on("error", (err) => {
  structuredLog("error", "Control plane pool error", { error: err.message });
});

export const cpDb = drizzle(cpPool, { schema: cpSchema });
