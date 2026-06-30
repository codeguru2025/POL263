import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS requisition_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requisition_id UUID NOT NULL REFERENCES requisitions(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES organizations(id),
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    qty NUMERIC(10,2) NOT NULL DEFAULT 1,
    unit_price NUMERIC(12,2) NOT NULL,
    total NUMERIC(12,2) NOT NULL
  );
  CREATE INDEX IF NOT EXISTS req_item_req_idx ON requisition_items(requisition_id);
`);
console.log("✓ requisition_items");

await client.query(`
  CREATE TABLE IF NOT EXISTS payment_disbursements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id),
    branch_id UUID REFERENCES branches(id),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    amount NUMERIC(12,2) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    paid_by_user_id UUID REFERENCES users(id),
    received_by TEXT,
    received_by_user_id UUID REFERENCES users(id),
    paid_date DATE NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'cash',
    reference TEXT,
    notes TEXT,
    voucher_number TEXT,
    created_by_user_id UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS disb_org_idx ON payment_disbursements(organization_id);
  CREATE INDEX IF NOT EXISTS disb_entity_idx ON payment_disbursements(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS disb_date_idx ON payment_disbursements(paid_date);
`);
console.log("✓ payment_disbursements");

await client.end();
console.log("Done.");
