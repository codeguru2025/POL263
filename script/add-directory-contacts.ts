/**
 * One-time migration: creates the directory_contacts table.
 * Run: npx tsx script/add-directory-contacts.ts
 */
import "dotenv/config";
import pg from "pg";

const url = process.env.DATABASE_DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");

const client = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
  query_timeout: 30000,
});

await client.connect();
console.log("Connected to database.");

await client.query(`
  CREATE TABLE IF NOT EXISTS "directory_contacts" (
    "id"              uuid        PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "organization_id" uuid        NOT NULL REFERENCES "organizations"("id"),
    "type"            text        NOT NULL,
    "name"            text        NOT NULL,
    "contact_person"  text,
    "phone"           text,
    "alt_phone"       text,
    "email"           text,
    "address"         text,
    "city"            text,
    "notes"           text,
    "is_active"       boolean     NOT NULL DEFAULT true,
    "created_at"      timestamp   NOT NULL DEFAULT now()
  );
`);
console.log("Table created (or already exists).");

await client.query(`
  CREATE INDEX IF NOT EXISTS "directory_contacts_org_type_idx"
    ON "directory_contacts" ("organization_id", "type");
  CREATE INDEX IF NOT EXISTS "directory_contacts_org_idx"
    ON "directory_contacts" ("organization_id");
`);
console.log("Indexes created.");

await client.end();
console.log("Done.");
