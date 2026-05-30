import { Client } from "pg";

async function check() {
  const client = new Client({
    connectionString: "postgresql://doadmin:REDACTED_ROTATED_SECRET@pol263-control-plane-do-user-37599157-0.l.db.ondigitalocean.com:25061/pol263-control-plane?sslmode=require",
    ssl: { rejectUnauthorized: false }
  });
  await client.connect();
  const res = await client.query(
    "SELECT tenant_id, database_url FROM tenant_databases WHERE tenant_id = '4eadab0e-c61b-40ee-b511-1243e9790179'"
  );
  console.log("Falakhe tenant DB config:", res.rows[0] || "Not found - using shared DB");
  await client.end();
}

check().catch(e => console.error(e));
