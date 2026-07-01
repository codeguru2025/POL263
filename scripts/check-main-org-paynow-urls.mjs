import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.DATABASE_URL);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const all = await client.query(`SELECT id, name, paynow_return_url, paynow_result_url FROM organizations ORDER BY name`);
console.log("All orgs return/result urls (central DB):");
for (const r of all.rows) {
  console.log(`  ${r.name} | id=${r.id} | return=${r.paynow_return_url || "(fallback to platform)"} | result=${r.paynow_result_url || "(fallback to platform)"}`);
}

await client.end();
