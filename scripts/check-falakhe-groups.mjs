import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host, port: parseInt(parsed.port || "5432"),
  database: parsed.database, user: parsed.user, password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const groups = await client.query(`
  SELECT g.id, g.name, g.type, g.is_legacy, g.is_active, g.capacity,
    COUNT(DISTINCT p.id) as policy_count
  FROM groups g
  LEFT JOIN policies p ON p.group_id = g.id AND p.deleted_at IS NULL
    AND p.status NOT IN ('cancelled')
  WHERE g.organization_id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  GROUP BY g.id, g.name, g.type, g.is_legacy, g.is_active, g.capacity
  ORDER BY g.name
`);

console.log(`Total groups: ${groups.rows.length}\n`);
for (const g of groups.rows) {
  console.log(`${g.name.padEnd(40)} legacy=${g.is_legacy} policies=${g.policy_count} type=${g.type}`);
}

await client.end();
