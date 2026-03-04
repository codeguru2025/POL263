import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

const acceptSelfSigned =
  process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
  /digitalocean|\.ondigitalocean\.com/i.test(process.env.DATABASE_URL || "");

// Use SSL (keep sslmode in URL so connection is encrypted) but accept DO's cert
const dbCredentials = acceptSelfSigned
  ? {
      url: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    }
  : { url: process.env.DATABASE_URL };

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: dbCredentials as { url: string },
});
