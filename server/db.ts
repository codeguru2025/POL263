import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { structuredLog } from "./logger";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Ensure the database is provisioned.");
}

// Catch placeholder or wrong host (e.g. DigitalOcean binding resolving to "base")
const raw = process.env.DATABASE_URL.trim();
const hostMatch = raw.match(/@([^:/]+)(?::|\/)/);
const host = hostMatch ? hostMatch[1] : "";
if (host === "base") {
  throw new Error(
    `DATABASE_URL has invalid host "base". Use your full database URL (e.g. Supabase pooler host like aws-1-eu-central-1.pooler.supabase.com). ` +
    "If using DigitalOcean, set DATABASE_URL manually to the full connection string; do not use a database component binding that might inject a placeholder."
  );
}

const max =
  (process.env.DB_POOL_MAX && parseInt(process.env.DB_POOL_MAX, 10)) || 25;
const idleTimeoutMillis =
  (process.env.DB_IDLE_TIMEOUT_MS && parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)) ||
  30_000;
const connectionTimeoutMillis =
  (process.env.DB_CONNECTION_TIMEOUT_MS &&
    parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)) ||
  5_000;

// Supabase and DigitalOcean managed databases (and some other poolers) use certs Node
// doesn't trust by default. Allow bypass for dev/local — mirrors the host detection
// already used in script/run-migrations.ts and server/control-plane-db.ts.
const acceptSelfSigned =
  process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
  (typeof process.env.DATABASE_URL === "string" && /supabase|digitalocean|\.ondigitalocean\.com/i.test(process.env.DATABASE_URL));
const sslConfig = acceptSelfSigned ? { rejectUnauthorized: false } : undefined;

// When we set our own SSL config, strip sslmode from URL so pg doesn't override with strict verification
let connectionString = process.env.DATABASE_URL;
if (sslConfig && connectionString) {
  connectionString = connectionString
    .replace(/\?sslmode=[^&]*&?/gi, "?")
    .replace(/&sslmode=[^&]*/gi, "")
    .replace(/\?$/, "");
}

export const pool = new pg.Pool({
  connectionString,
  max,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  ...(sslConfig && { ssl: sslConfig }),
});

// pg.Pool emits 'error' when an already-idle client hits a backend/network error (connection
// dropped while sitting idle, DB-side recycling, etc.). With no listener, Node treats that as
// an uncaught exception and kills the *entire process* instantly — for this pool specifically,
// that means the whole running app server, not just one request. This pool was missing the
// handler every other pool in this codebase already has (control-plane-db.ts, tenant-db.ts,
// backup-sync.ts) — see docs/BUGFIX-LOG.md, 2026-07-14.
pool.on("error", (err) => {
  structuredLog("error", "Main pool: idle client error (connection dropped, not fatal)", { error: err.message });
});

export const db = drizzle(pool, { schema });
