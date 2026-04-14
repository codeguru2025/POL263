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
  process.env.CONTROL_PLANE_DIRECT_URL
)?.trim();

if (!connectionString) {
  throw new Error(
    "CONTROL_PLANE_DATABASE_URL (or CONTROL_PLANE_DIRECT_URL) must be set. " +
    "Get it from DigitalOcean → Databases → pol263-control-plane → Connection Details."
  );
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
