/**
 * Reconnect the DigitalOcean managed-database connection pools after a cluster upgrade.
 *
 *   npx tsx script/fix-do-pools.ts            # inspect — shows which pools have lost their user
 *   npx tsx script/fix-do-pools.ts --apply    # re-bind each pool to the doadmin user
 *
 * A PostgreSQL major-version upgrade on DO can leave a cluster's connection pool with an empty
 * user (connection.uri = postgresql://:@host…), which makes every pooled connection (port 25061)
 * hang until timeout while direct connections (25060) still work. This re-PUTs each pool with
 * user=doadmin. Also compares the doadmin password DO currently reports against the one in .env
 * so a rotated password is caught too. Pools only route connections — this touches no data.
 */
import "dotenv/config";

const TOKEN = process.env.DIGITALOCEAN_API_TOKEN;
if (!TOKEN) { console.error("DIGITALOCEAN_API_TOKEN not set"); process.exit(1); }
const APPLY = process.argv.includes("--apply");
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

const CLUSTERS = [
  { id: "eedff498-8a29-4255-bb4d-6a7f77e36fba", name: "pol263",               pool: "pol263-pool",               envKeys: ["DATABASE_URL"] },
  { id: "f68ddc56-c7d7-4899-b3b6-f74c5a0cfb91", name: "pol263-control-plane", pool: "pol263-control-plane-pool", envKeys: ["CONTROL_PLANE_DATABASE_URL"] },
  { id: "e5f0b069-e4d8-4e80-90f1-963f249b575d", name: "pol263-falakhe",       pool: "pol263-falakhe-pool",       envKeys: [] },
];

const passwordOf = (u?: string) => { try { return u ? decodeURIComponent(new URL(u).password) : ""; } catch { return ""; } };

async function api(path: string, init?: RequestInit) {
  const r = await fetch(`https://api.digitalocean.com/v2${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  const text = await r.text();
  let json: any; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, json };
}

async function main() {
  for (const c of CLUSTERS) {
    console.log(`\n=== ${c.name} ===`);
    const cluster = (await api(`/databases/${c.id}`)).json?.database;
    console.log(`  status: ${cluster?.status} | engine: ${cluster?.engine} ${cluster?.version}`);
    const apiPassword: string = cluster?.connection?.password || "";

    for (const k of c.envKeys) {
      const envPw = passwordOf(process.env[k]);
      const match = envPw && apiPassword ? (envPw === apiPassword ? "MATCHES" : "DIFFERS — update .env!") : "(cannot compare)";
      console.log(`  ${k} doadmin password vs DO: ${match}`);
    }

    const { json } = await api(`/databases/${c.id}/pools/${c.pool}`);
    const pool = json?.pool;
    if (!pool) { console.log(`  pool "${c.pool}" NOT FOUND: ${JSON.stringify(json).slice(0, 200)}`); continue; }
    const brokenUser = !pool.connection?.user;
    console.log(`  pool: db=${pool.db} mode=${pool.mode} size=${pool.size} user="${pool.connection?.user ?? ""}" ${brokenUser ? "  <-- BROKEN (no user)" : "  OK"}`);

    if (APPLY) {
      const body = JSON.stringify({ mode: pool.mode || "transaction", size: pool.size || 22, db: pool.db || "defaultdb", user: "doadmin" });
      const res = await api(`/databases/${c.id}/pools/${c.pool}`, { method: "PUT", body });
      console.log(`  PUT -> ${res.status}${res.status >= 300 ? " " + JSON.stringify(res.json).slice(0, 300) : ""}`);
      if (res.status < 300) {
        const after = (await api(`/databases/${c.id}/pools/${c.pool}`)).json?.pool;
        console.log(`  now: user="${after?.connection?.user ?? ""}"`);
      }
    }
  }
  if (!APPLY) console.log(`\nInspection only. Re-run with --apply to fix any BROKEN pool.\n`);
  else console.log(`\nDone. Restart the app / re-run your script — pooled connections (25061) should work now.\n`);
}

main().catch((e) => { console.error("\n✗", e.message, "\n"); process.exit(1); });
