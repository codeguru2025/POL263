import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;

const cpUrl = process.env.CONTROL_PLANE_DATABASE_URL || process.env.DATABASE_URL;
console.log("Control plane URL:", cpUrl.replace(/:\/\/.*@/, "://***@"));
console.log("FALAKHE_DATABASE_URL:", (process.env.FALAKHE_DATABASE_URL || "NOT SET").replace(/:\/\/.*@/, "://***@"));
console.log("DATABASE_URL_TENANT:", (process.env.DATABASE_URL_TENANT || "NOT SET").replace(/:\/\/.*@/, "://***@"));

const client = new Client({ connectionString: cpUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// Check if tenant_databases table exists
const tableExists = await client.query(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenant_databases'
  ) AS exists
`);
console.log("\ntenant_databases table exists:", tableExists.rows[0].exists);

if (tableExists.rows[0].exists) {
  const rows = await client.query(`SELECT tenant_id, database_url, database_direct_url, migration_state FROM tenant_databases`);
  console.log("\nTenant database routing:");
  for (const r of rows.rows) {
    const masked = r.database_url ? r.database_url.replace(/:\/\/.*@/, "://***@") : "NULL (uses shared DB)";
    const maskedDirect = r.database_direct_url ? r.database_direct_url.replace(/:\/\/.*@/, "://***@") : "NULL";
    console.log(`  tenantId=${r.tenant_id}`);
    console.log(`    databaseUrl=${masked}`);
    console.log(`    directUrl=${maskedDirect}`);
    console.log(`    state=${r.migration_state}`);
  }
}

// Also check tenants table
const tenantsExist = await client.query(`
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'tenants'
  ) AS exists
`);
if (tenantsExist.rows[0].exists) {
  const tenants = await client.query(`SELECT id, name, slug FROM tenants`);
  console.log("\nTenants:");
  console.table(tenants.rows);
}

await client.end();
