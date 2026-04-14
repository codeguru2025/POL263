import "dotenv/config";
import { defineConfig } from "drizzle-kit";

// Prefer the direct connection for schema operations — poolers (port 25061) block DDL.
// Falls back to DATABASE_URL if DIRECT is not set (e.g. Supabase, local dev).
const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;

if (!url) {
  throw new Error("DATABASE_URL must be set. Ensure the database is provisioned.");
}

const isDigitalOcean =
  process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
  /\.ondigitalocean\.com/i.test(url);

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: isDigitalOcean
    ? { url, ssl: { rejectUnauthorized: false } }
    : { url },
});
