/**
 * Create tables that exist in schema.ts but are missing from Falakhe DB:
 * - reminders
 * - user_notifications
 * - user_device_tokens
 * - directory_contacts
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const parsed = parse(process.env.FALAKHE_DATABASE_URL);
const client = new Client({
  host: parsed.host,
  port: parseInt(parsed.port || "5432"),
  database: parsed.database,
  user: parsed.user,
  password: parsed.password,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
console.log("Connected to Falakhe DB");

const stmts = [
  ["reminders", `
    CREATE TABLE IF NOT EXISTS reminders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      priority TEXT DEFAULT 'medium',
      is_completed BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS reminders_org_idx ON reminders(organization_id);
    CREATE INDEX IF NOT EXISTS reminders_user_idx ON reminders(user_id);
  `],

  ["user_notifications", `
    CREATE TABLE IF NOT EXISTS user_notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      recipient_id UUID NOT NULL REFERENCES users(id),
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      metadata JSONB,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      read_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS un_org_idx ON user_notifications(organization_id);
    CREATE INDEX IF NOT EXISTS un_recipient_idx ON user_notifications(recipient_id);
    CREATE INDEX IF NOT EXISTS un_read_idx ON user_notifications(recipient_id, is_read);
    CREATE INDEX IF NOT EXISTS un_created_idx ON user_notifications(created_at);
  `],

  ["user_device_tokens", `
    CREATE TABLE IF NOT EXISTS user_device_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      user_id UUID NOT NULL REFERENCES users(id),
      token TEXT NOT NULL,
      platform TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS udt_org_idx ON user_device_tokens(organization_id);
    CREATE INDEX IF NOT EXISTS udt_user_idx ON user_device_tokens(user_id);
    CREATE UNIQUE INDEX IF NOT EXISTS udt_token_unique ON user_device_tokens(token);
  `],

  ["directory_contacts", `
    CREATE TABLE IF NOT EXISTS directory_contacts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      contact_person TEXT,
      phone TEXT,
      alt_phone TEXT,
      email TEXT,
      address TEXT,
      city TEXT,
      notes TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS directory_contacts_org_type_idx ON directory_contacts(organization_id, type);
    CREATE INDEX IF NOT EXISTS directory_contacts_org_idx ON directory_contacts(organization_id);
  `],
];

for (const [label, sql] of stmts) {
  try {
    await client.query(sql.trim());
    console.log(`  ✓ ${label}`);
  } catch (e) {
    console.error(`  ✗ ${label}: ${e.message}`);
  }
}

// Verify
const tables = await client.query(
  `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1)`,
  [["reminders","user_notifications","user_device_tokens","directory_contacts"]]
);
console.log("\nVerified tables:", tables.rows.map(r => r.table_name).join(", "));

await client.end();
console.log("Done.");
