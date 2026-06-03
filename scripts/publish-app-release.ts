/**
 * Publish a new agent-app release so the live site's download link
 * (/api/public/agent-app-latest) points at a new APK.
 *
 * Inserts a row into app_releases (the newest isActive row is what the
 * public endpoint and the in-app updater serve). Mirrors the logic of
 * POST /api/platform/app-release without needing a platform-owner session.
 *
 * Usage:
 *   tsx scripts/publish-app-release.ts <downloadUrl> <version> <buildNumber> [releaseNotes]
 */
import "dotenv/config";
import pg from "pg";

async function main() {
  const [, , downloadUrl, version, buildNumberArg, ...notesParts] = process.argv;
  if (!downloadUrl || !version || !buildNumberArg) {
    console.error("Usage: tsx scripts/publish-app-release.ts <downloadUrl> <version> <buildNumber> [releaseNotes]");
    process.exit(1);
  }
  const buildNumber = Number(buildNumberArg);
  if (!Number.isInteger(buildNumber) || buildNumber <= 0) {
    console.error(`Invalid buildNumber: ${buildNumberArg}`);
    process.exit(1);
  }
  const releaseNotes = notesParts.join(" ") || null;

  const cs = (process.env.DATABASE_URL || "").trim();
  if (!cs) { console.error("DATABASE_URL not set"); process.exit(1); }
  const acceptSelfSigned =
    process.env.DB_ACCEPT_SELF_SIGNED === "true" ||
    process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    /digitalocean|\.ondigitalocean\.com|supabase/i.test(cs);

  const pool = new pg.Pool({
    connectionString: cs,
    ssl: acceptSelfSigned ? { rejectUnauthorized: false } : undefined,
  });

  try {
    const current = await pool.query(
      `SELECT version, build_number, download_url, created_at
         FROM app_releases WHERE is_active = true
        ORDER BY created_at DESC LIMIT 1`
    );
    if (current.rows[0]) {
      console.log("Current active release:");
      console.log(`  v${current.rows[0].version} (build ${current.rows[0].build_number})`);
      console.log(`  ${current.rows[0].download_url}`);
    } else {
      console.log("No active release currently set.");
    }

    const inserted = await pool.query(
      `INSERT INTO app_releases (version, build_number, min_version, min_build_number, download_url, release_notes, is_active)
       VALUES ($1, $2, '1.0.0', 1, $3, $4, true)
       RETURNING id, version, build_number, download_url, created_at`,
      [String(version), buildNumber, String(downloadUrl), releaseNotes]
    );
    const r = inserted.rows[0];
    console.log("\n✅ Published new active release:");
    console.log(`  id:        ${r.id}`);
    console.log(`  version:   v${r.version} (build ${r.build_number})`);
    console.log(`  url:       ${r.download_url}`);
    console.log(`  createdAt: ${r.created_at}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
