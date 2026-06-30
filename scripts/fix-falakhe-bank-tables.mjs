import pg from "pg";
import * as dotenv from "dotenv";
dotenv.config();

const { Client } = pg;
const client = new Client({ connectionString: process.env.FALAKHE_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log("Connected to Falakhe DB");

const stmts = [
  ["bank_accounts", `
    CREATE TABLE IF NOT EXISTS bank_accounts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      branch_id UUID REFERENCES branches(id),
      account_name TEXT NOT NULL,
      bank_name TEXT NOT NULL,
      account_number TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ba_org_idx ON bank_accounts(organization_id);
  `],
  ["bank_deposits", `
    CREATE TABLE IF NOT EXISTS bank_deposits (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      branch_id UUID REFERENCES branches(id),
      bank_account_id UUID REFERENCES bank_accounts(id),
      deposited_by_user_id UUID NOT NULL REFERENCES users(id),
      verified_by_user_id UUID REFERENCES users(id),
      amount NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      deposit_date DATE NOT NULL,
      reference TEXT,
      notes TEXT,
      verified_at TIMESTAMP,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS bd_org_idx ON bank_deposits(organization_id);
    CREATE INDEX IF NOT EXISTS bd_user_idx ON bank_deposits(deposited_by_user_id);
    CREATE INDEX IF NOT EXISTS bd_date_idx ON bank_deposits(deposit_date);
  `],
  ["bank_statement_balances", `
    CREATE TABLE IF NOT EXISTS bank_statement_balances (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      bank_account_id UUID NOT NULL REFERENCES bank_accounts(id),
      statement_date DATE NOT NULL,
      closing_balance NUMERIC(12,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      entered_by_user_id UUID REFERENCES users(id),
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS bsb_org_idx ON bank_statement_balances(organization_id);
    CREATE INDEX IF NOT EXISTS bsb_account_idx ON bank_statement_balances(bank_account_id);
  `],
  ["balance_sheet_entries", `
    CREATE TABLE IF NOT EXISTS balance_sheet_entries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id),
      branch_id UUID REFERENCES branches(id),
      section TEXT NOT NULL,
      subsection TEXT,
      label TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      as_of_date DATE NOT NULL,
      notes TEXT,
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS bse_org_idx ON balance_sheet_entries(organization_id);
    CREATE INDEX IF NOT EXISTS bse_date_idx ON balance_sheet_entries(as_of_date);
  `],
];

for (const [label, sql] of stmts) {
  try {
    await client.query(sql.trim());
    console.log(`  ✓ ${label}`);
  } catch (e) {
    if (e.code === "42P07" || e.message?.includes("already exists")) {
      console.log(`  ~ ${label} (already exists)`);
    } else {
      console.error(`  ✗ ${label}: ${e.message}`);
    }
  }
}

console.log("\nDone.");
await client.end();
