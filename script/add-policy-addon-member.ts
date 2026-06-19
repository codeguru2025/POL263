/**
 * Adds policy_member_id to policy_add_ons so add-ons can be scoped to individual members.
 * Also replaces the broad unique index with two partial indexes that handle NULLs correctly.
 *
 * Safe to run multiple times (all statements are IF NOT EXISTS / IF EXISTS).
 * Run: npx tsx script/add-policy-addon-member.ts
 */
import "dotenv/config";
import pg from "pg";

const URLS = [
  { label: "pol263 (shared/registry)", url: process.env.DATABASE_DIRECT_URL! },
  { label: "pol263-falakhe (tenant)", url: process.env.FALAKHE_DIRECT_URL! },
  { label: "Supabase backup",          url: process.env.SUPABASE_BACKUP_DIRECT_URL || process.env.SUPABASE_BACKUP_URL! },
];

for (const { label, url } of URLS) {
  if (!url) { console.log(`SKIP ${label}: URL not set`); continue; }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    console.log(`\n── ${label} ──`);

    // 1. Add column (nullable so existing rows default to NULL = whole-policy add-on)
    await client.query(`
      ALTER TABLE "policy_add_ons"
        ADD COLUMN IF NOT EXISTS "policy_member_id" uuid
          REFERENCES "policy_members"("id") ON DELETE CASCADE;
    `);
    console.log("  policy_member_id column: OK");

    // 2. Drop old blanket unique index (not safe for multi-member add-ons)
    await client.query(`DROP INDEX IF EXISTS "policy_add_on_unique_idx";`);
    console.log("  old unique index dropped: OK");

    // 3. Partial unique index for policy-level add-ons (member_id IS NULL)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "pao_policy_level_uniq"
        ON "policy_add_ons" ("policy_id", "add_on_id")
        WHERE "policy_member_id" IS NULL;
    `);
    console.log("  policy-level partial unique index: OK");

    // 4. Partial unique index for member-level add-ons (member_id IS NOT NULL)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "pao_member_level_uniq"
        ON "policy_add_ons" ("policy_id", "add_on_id", "policy_member_id")
        WHERE "policy_member_id" IS NOT NULL;
    `);
    console.log("  member-level partial unique index: OK");

    // 5. Index for fast member-scoped lookups
    await client.query(`
      CREATE INDEX IF NOT EXISTS "pao_member_idx"
        ON "policy_add_ons" ("policy_member_id");
    `);
    console.log("  pao_member_idx: OK");
  } catch (e: any) {
    console.error(`  ERROR: ${e.message}`);
  } finally {
    await client.end();
  }
}

console.log("\nDone.");
