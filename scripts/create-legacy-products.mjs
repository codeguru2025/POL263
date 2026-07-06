/**
 * One-off setup: creates the "LEGACY INDIVIDUAL" and "LEGACY GROUP" products for the Falakhe
 * tenant DB — open adult/child coverage (no cap), premium always entered as a manual override
 * when issuing a policy. Used to quickly capture historical clients (individual or group
 * members) with minimal details, before converting them to a real product later.
 *
 * Usage: node scripts/create-legacy-products.mjs
 */
import pg from "pg";
import { parse } from "pg-connection-string";
import * as dotenv from "dotenv";
dotenv.config();

const orgId = "4eadab0e-c61b-40ee-b511-1243e9790179"; // Falakhe

async function main() {
  const parsed = parse(process.env.FALAKHE_DATABASE_URL);
  const client = new pg.Client({
    host: parsed.host, port: parseInt(parsed.port || "5432"),
    database: parsed.database, user: parsed.user, password: parsed.password,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const today = new Date().toISOString().slice(0, 10);
  const defs = [
    {
      name: "LEGACY INDIVIDUAL",
      code: "LEGIND",
      description: "For capturing an individual legacy client (not part of a group) with minimal details and a custom premium. Convert to a standard product once fully set up.",
    },
    {
      name: "LEGACY GROUP",
      code: "LEGGRP",
      description: "For capturing a legacy group member with minimal details and a custom premium. Convert to a standard product once fully set up.",
    },
  ];

  await client.query("BEGIN");
  try {
    for (const def of defs) {
      const { rows: existing } = await client.query(
        `SELECT id FROM products WHERE organization_id = $1 AND code = $2`, [orgId, def.code]
      );
      if (existing.length) {
        console.log(`SKIP ${def.name}: product with code ${def.code} already exists (${existing[0].id})`);
        continue;
      }
      const { rows: [product] } = await client.query(
        `INSERT INTO products (organization_id, name, code, description, max_adults, max_children, max_extended_members, max_additional_members, cover_currency, is_active)
         VALUES ($1, $2, $3, $4, 99, 99, 99, 0, 'USD', true)
         RETURNING id`,
        [orgId, def.name, def.code, def.description]
      );
      const { rows: [pv] } = await client.query(
        `INSERT INTO product_versions
           (product_id, organization_id, version, effective_from, premium_monthly_usd, premium_monthly_zar,
            eligibility_min_age, eligibility_max_age, dependent_max_age, waiting_period_days, grace_period_days,
            reinstatement_requires_arrears, reinstatement_new_waiting_period)
         VALUES ($1, $2, 1, $3, 0, 0, 0, 120, 20, 0, 30, false, false)
         RETURNING id`,
        [product.id, orgId, today]
      );
      console.log(`CREATED ${def.name}: product=${product.id} version=${pv.id}`);
    }
    await client.query("COMMIT");
    console.log("Committed.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Rolled back:", err.message);
    throw err;
  }

  await client.end();
}

main().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
