import "dotenv/config";
import pg from "pg";

const CP = (process.env.CONTROL_PLANE_DIRECT_URL || process.env.CONTROL_PLANE_DATABASE_URL)!;
const pool = new pg.Pool({ connectionString: CP.replace(/\?sslmode=[^&]*&?/gi, "?").replace(/&sslmode=[^&]*/gi, "").replace(/\?$/, ""), ssl: { rejectUnauthorized: false } });

const FALAKHE = "4eadab0e-c61b-40ee-b511-1243e9790179";
const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(`=== FALAKHE RESTORE  (${APPLY ? "APPLY" : "DRY RUN — pass --apply to execute"}) ===\n`);

  const before = await pool.query(
    `SELECT t.is_active, t.license_status, t.suspended_at, t.suspend_reason,
            ts.status AS sub_status, ts.billing_cycle, ts.platform_fee_rate_override,
            ts.current_period_start, ts.current_period_end
       FROM tenants t JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
      WHERE t.id = $1`, [FALAKHE]);
  console.log("BEFORE:", JSON.stringify(before.rows[0], null, 2));

  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  console.log("\nWILL WRITE:");
  console.log("  tenant_subscriptions: platform_fee_rate_override='2.50', status='active',");
  console.log(`                        current_period_start=${now.toISOString()}, current_period_end=${periodEnd.toISOString()}`);
  console.log("  tenants:              is_active=true, license_status='active', suspended_at=NULL, suspend_reason=NULL");
  console.log("  tenant_billing_events: + one 'manual_restore' row");

  if (!APPLY) { await pool.end(); return; }

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE tenant_subscriptions
          SET platform_fee_rate_override = '2.50', status = 'active',
              current_period_start = $2, current_period_end = $3, updated_at = now()
        WHERE tenant_id = $1`, [FALAKHE, now, periodEnd]);
    await pool.query(
      `UPDATE tenants
          SET is_active = true, license_status = 'active', suspended_at = NULL, suspend_reason = NULL
        WHERE id = $1`, [FALAKHE]);
    await pool.query(
      `INSERT INTO tenant_billing_events (tenant_id, type, detail)
       VALUES ($1, 'manual_restore', $2::jsonb)`,
      [FALAKHE, JSON.stringify({
        reason: "Commercial model is 2.5% revenue-share, not the flat 'complete' plan. Auto-suspended in error 2026-08-29 for a $999.99 flat invoice that was never the deal. Restored by platform owner pending the P1/P4 billing-model migration.",
        platform_fee_rate_override_set: "2.50",
        period_extended_to: periodEnd.toISOString(),
        restoredAt: now.toISOString(),
      })]);
    await pool.query("COMMIT");
    console.log("\nCOMMITTED.");
  } catch (e: any) {
    await pool.query("ROLLBACK");
    console.error("ROLLED BACK:", e.message);
    process.exit(1);
  }

  const after = await pool.query(
    `SELECT t.is_active, t.license_status, t.suspended_at,
            ts.status AS sub_status, ts.platform_fee_rate_override, ts.current_period_end
       FROM tenants t JOIN tenant_subscriptions ts ON ts.tenant_id = t.id
      WHERE t.id = $1`, [FALAKHE]);
  console.log("\nAFTER:", JSON.stringify(after.rows[0], null, 2));

  const sub = after.rows[0];
  const sweepWouldReSuspend = new Date(sub.current_period_end).getTime() <= now.getTime();
  console.log("\nSweep re-suspend risk (currentPeriodEnd <= now)?", sweepWouldReSuspend ? "YES — problem" : "NO — safe for ~30 days");

  await pool.end();
}
main().catch((e) => { console.error("FATAL", e.message); process.exit(1); });
