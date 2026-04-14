import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const url = process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL;

if (!url) {
  throw new Error(
    "CONTROL_PLANE_DIRECT_URL (or CONTROL_PLANE_DATABASE_URL) must be set.\n" +
    "Use the DIRECT connection (port 25060) for schema push — poolers block DDL."
  );
}

export default defineConfig({
  out: "./migrations/control-plane",
  schema: "./shared/control-plane-schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url,
    ssl: { rejectUnauthorized: false },
  },
});
