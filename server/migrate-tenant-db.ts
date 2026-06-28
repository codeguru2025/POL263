/**
 * Applies any pending SQL migrations to an already-open pg.Pool.
 * Called automatically when a dedicated tenant pool is first created so that
 * a DB restored from a backup (where schema_migrations may be ahead of the
 * actual schema) is brought up to date without manual intervention.
 */
import fs from "fs";
import path from "path";
import type pg from "pg";
import { structuredLog } from "./logger";

const migrationsDir = path.resolve(process.cwd(), "migrations");

export async function applyPendingMigrations(pool: pg.Pool, label: string): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename   TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
    )
  `);

  const { rows: applied } = await pool.query<{ filename: string }>(
    "SELECT filename FROM schema_migrations ORDER BY filename",
  );
  const appliedSet = new Set(applied.map((r) => r.filename));

  let files: string[];
  try {
    files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return; // migrations dir missing at runtime (e.g. test env) — skip silently
  }

  for (const file of files) {
    if (appliedSet.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    try {
      await pool.query(sql);
    } catch (e: any) {
      // "already exists" errors are safe to ignore — idempotent migrations handle this
      const alreadyExists =
        e.code === "42701" || e.code === "42P07" || e.code === "42710" ||
        e.message?.includes("already exists");
      if (!alreadyExists) throw e;
    }
    await pool.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [file],
    );
    structuredLog("info", "Tenant DB migration applied", { label, file });
  }
}
