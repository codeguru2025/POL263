/**
 * One-shot fix: set agent_id on clients that were created by the agent
 * but don't have the agent_id set (created before the column existed).
 * Also ensures leads have the correct agentId.
 * Run: node script/fix-agent-clients.cjs
 */
require("dotenv/config");
const pg = require("pg");

let url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

const ssl = { rejectUnauthorized: false };
url = url.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, "");

const pool = new pg.Pool({ connectionString: url, ssl, max: 2 });

(async () => {
  const client = await pool.connect();
  try {
    // Find leads that have an agentId and clientId, where the client doesn't have agent_id set
    const { rows: orphanedLeads } = await client.query(`
      SELECT l.agent_id, l.client_id
      FROM leads l
      JOIN clients c ON c.id = l.client_id
      WHERE l.agent_id IS NOT NULL
        AND l.client_id IS NOT NULL
        AND c.agent_id IS NULL
    `);
    console.log(`Found ${orphanedLeads.length} clients with leads but no agent_id on client record`);
    for (const row of orphanedLeads) {
      await client.query(`UPDATE clients SET agent_id = $1 WHERE id = $2 AND agent_id IS NULL`, [row.agent_id, row.client_id]);
      console.log(`  Set agent_id=${row.agent_id.slice(0,8)}... on client ${row.client_id.slice(0,8)}...`);
    }

    // Also find clients created via policies (agentId on policy but not on client)
    const { rows: policyOrphans } = await client.query(`
      SELECT DISTINCT p.agent_id, p.client_id
      FROM policies p
      JOIN clients c ON c.id = p.client_id
      WHERE p.agent_id IS NOT NULL
        AND c.agent_id IS NULL
    `);
    console.log(`Found ${policyOrphans.length} clients with policies but no agent_id on client record`);
    for (const row of policyOrphans) {
      await client.query(`UPDATE clients SET agent_id = $1 WHERE id = $2 AND agent_id IS NULL`, [row.agent_id, row.client_id]);
      console.log(`  Set agent_id=${row.agent_id.slice(0,8)}... on client ${row.client_id.slice(0,8)}...`);
    }

    const { rows: auditOrphans } = await client.query(`
      SELECT al.actor_id AS user_id, (al."after"::jsonb->>'id')::uuid AS client_id
      FROM audit_logs al
      JOIN user_roles ur ON ur.user_id = al.actor_id
      JOIN roles r ON r.id = ur.role_id AND r.name = 'agent'
      JOIN clients c ON c.id = (al."after"::jsonb->>'id')::uuid
      WHERE al.action = 'CREATE_CLIENT'
        AND c.agent_id IS NULL
        AND al."after" IS NOT NULL
    `);
    console.log(`Found ${auditOrphans.length} clients from audit logs by agents without agent_id`);
    for (const row of auditOrphans) {
      await client.query(`UPDATE clients SET agent_id = $1 WHERE id = $2 AND agent_id IS NULL`, [row.user_id, row.client_id]);
      console.log(`  Set agent_id=${row.user_id.slice(0,8)}... on client ${row.client_id.slice(0,8)}... (from audit log)`);
    }

    console.log("\nDone. Clients should now be visible to their agents.");
  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
})();
