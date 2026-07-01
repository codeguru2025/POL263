/**
 * 1. Mark all Falakhe groups as is_legacy = true
 * 2. Create legacy_group_receipts table for backdated receipts
 */
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
console.log("Connected\n");

// 1. Mark all groups as legacy
const updated = await client.query(`
  UPDATE groups
  SET is_legacy = true
  WHERE organization_id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  RETURNING name
`);
console.log(`Marked ${updated.rows.length} groups as legacy:`);
updated.rows.forEach(r => console.log("  • " + r.name));

// 2. Create the temporary receipts table
await client.query(`
  CREATE TABLE IF NOT EXISTS legacy_group_receipts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    group_id      UUID NOT NULL REFERENCES groups(id),
    group_name    TEXT NOT NULL,
    receipt_number TEXT,
    amount        NUMERIC(12,2) NOT NULL,
    currency      TEXT NOT NULL DEFAULT 'USD',
    payment_date  DATE NOT NULL,       -- backdated to when they actually paid
    notes         TEXT,
    recorded_at   TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS lgr_org_idx ON legacy_group_receipts(organization_id);
  CREATE INDEX IF NOT EXISTS lgr_group_idx ON legacy_group_receipts(group_id);
`);
console.log("\n✓ legacy_group_receipts table ready");

// Show groups in order
const groups = await client.query(`
  SELECT id, name FROM groups
  WHERE organization_id = '4eadab0e-c61b-40ee-b511-1243e9790179'
  ORDER BY name
`);
console.log("\nGroups to receipt (in order):");
groups.rows.forEach((g, i) => console.log(`  ${String(i+1).padStart(2)}. ${g.name}`));

await client.end();
