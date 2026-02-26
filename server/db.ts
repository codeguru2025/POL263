import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Ensure the database is provisioned.");
}

const max =
  (process.env.DB_POOL_MAX && parseInt(process.env.DB_POOL_MAX, 10)) || 10;
const idleTimeoutMillis =
  (process.env.DB_IDLE_TIMEOUT_MS && parseInt(process.env.DB_IDLE_TIMEOUT_MS, 10)) ||
  30_000;
const connectionTimeoutMillis =
  (process.env.DB_CONNECTION_TIMEOUT_MS &&
    parseInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10)) ||
  5_000;

const isSupabase = process.env.DATABASE_URL?.includes("supabase");
const sslConfig = isSupabase ? { rejectUnauthorized: false } : undefined;

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max,
  idleTimeoutMillis,
  connectionTimeoutMillis,
  ...(sslConfig && { ssl: sslConfig }),
});

export const db = drizzle(pool, { schema });
