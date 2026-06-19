/**
 * Compares DO Falakhe schema vs Supabase and prints differences.
 */
import "dotenv/config";
import pg from "pg";

const ssl = { rejectUnauthorized: false };

async function getColumns(url: string, table: string): Promise<string[]> {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await client.connect();
  const { rows } = await client.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table]
  );
  await client.end();
  return rows.map((r) => r.column_name as string);
}

async function getColumnDefs(url: string, table: string) {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await client.connect();
  const { rows } = await client.query(
    `SELECT column_name, data_type, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1
     ORDER BY ordinal_position`,
    [table]
  );
  await client.end();
  return rows;
}

async function tableExists(url: string, table: string): Promise<boolean> {
  const client = new pg.Client({ connectionString: url, ssl, connectionTimeoutMillis: 15000 });
  await client.connect();
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
    [table]
  );
  await client.end();
  return rows.length > 0;
}

const doUrl = process.env.FALAKHE_DIRECT_URL!;
const sbUrl = process.env.SUPABASE_BACKUP_DIRECT_URL || process.env.SUPABASE_BACKUP_URL!;

const TABLES = [
  "org_policy_sequences",
  "funeral_cases",
  "funeral_quotations",
  "funeral_quotation_items",
  "service_receipts",
  "requisitions",
  "fx_rates",
];

for (const table of TABLES) {
  const doExists = await tableExists(doUrl, table);
  const sbExists = await tableExists(sbUrl, table);

  if (!doExists) { console.log(`${table}: not in DO (skip)`); continue; }
  if (!sbExists) {
    const defs = await getColumnDefs(doUrl, table);
    console.log(`\n${table}: MISSING in Supabase — columns needed:`);
    defs.forEach((r) => console.log(`  ${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}  default=${r.column_default ?? "none"}`));
    continue;
  }

  const doCols = await getColumns(doUrl, table);
  const sbCols = await getColumns(sbUrl, table);
  const missing = doCols.filter((c) => !sbCols.includes(c));
  if (missing.length > 0) {
    console.log(`\n${table}: missing columns in Supabase: ${missing.join(", ")}`);
    const defs = await getColumnDefs(doUrl, table);
    defs.filter((r) => missing.includes(r.column_name)).forEach((r) => {
      console.log(`  ${r.column_name}  ${r.data_type}  nullable=${r.is_nullable}  default=${r.column_default ?? "none"}`);
    });
  } else {
    console.log(`${table}: OK — in sync`);
  }
}
