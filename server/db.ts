import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

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

// Supabase (and some poolers) use certs Node doesn't trust by default. Allow bypass for dev/local.
const acceptSelfSigned =
  process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
  process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
  (typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.includes("supabase"));
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

export const db = drizzle(pool, { schema });
