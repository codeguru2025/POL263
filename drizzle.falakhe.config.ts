import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.FALAKHE_DIRECT_URL;

if (!url) {
  throw new Error("FALAKHE_DIRECT_URL must be set in .env");
}

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: { rejectUnauthorized: false },
  },
  // schema_migrations is our internal migration tracker, not a Drizzle-managed table
  tablesFilter: ["!schema_migrations"],
});
