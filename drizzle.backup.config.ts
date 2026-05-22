/**
 * Drizzle config for the Supabase backup database.
 * Pushes BOTH the tenant schema AND control-plane tables into one DB.
 *
 * Usage: npx drizzle-kit push --config drizzle.backup.config.ts
 */
import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const poolerUrl = process.env.SUPABASE_BACKUP_URL;

if (!poolerUrl) {
  throw new Error("SUPABASE_BACKUP_URL must be set.");
}

// Use session pooler (port 5432) for DDL — transaction pooler (6543) may block DDL.
const sessionPoolerUrl = poolerUrl.replace(/:6543\//, ":5432/");

export default defineConfig({
  out: "./migrations/backup",
  // Include BOTH schemas so all tables are created in one DB
  schema: ["./shared/schema.ts", "./shared/control-plane-schema.ts"],
  dialect: "postgresql",
  dbCredentials: { url: sessionPoolerUrl },
});
