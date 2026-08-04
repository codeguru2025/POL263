/**
 * Orchestrates automatic dedicated-database provisioning for a tenant whose subscription just
 * converted from trial to paid (see server/tenant-billing-service.ts's fire-and-forget call),
 * or on-demand via the platform owner's manual "Provision now"/"Retry" dashboard action
 * (POST /api/platform/tenants/:id/commission-database in server/platform-routes.ts).
 *
 * Never throws — every branch resolves {ok: boolean}. A failure at any step (DO API token/
 * cluster not configured, provisioning failure, data-migration mismatch) must never affect the
 * tenant's subscription/payment flow; it leaves the tenant safely on the shared database and
 * marks tenantDatabases.migrationState so the platform dashboard's "Pending dedicated database
 * provisioning" section can surface it for manual attention/retry.
 */
import { eq } from "drizzle-orm";
import { pool as sharedPool } from "./db";
import { cpDb } from "./control-plane-db";
import { tenantDatabases } from "@shared/control-plane-schema";
import { withAdvisoryLock } from "./advisory-lock";
import { provisionLogicalTenantDatabase } from "./do-database-provisioning";
import { migrateTenantData } from "./tenant-data-migration";
import { sendInfrastructureReadyEmail } from "./tenant-billing-email";
import { structuredLog } from "./logger";
import pg from "pg";

// NOT part of the PAYMENT_AUTO_LOCK_KEY (9_002_630_001) / PARKED_VEHICLE_LOCK_KEY (9_002_630_002)
// / TENANT_BILLING_SWEEP_LOCK_KEY (9_002_630_003) / POLICY_LAPSE_SWEEP_LOCK_KEY (9_002_630_004)
// sequence despite the similar name — those are all called via withAdvisoryLock's single-argument
// form (routes to pg_try_advisory_lock(bigint), which tolerates a ~9 billion value fine). This
// one is called via the two-argument class+key form below, which routes to
// pg_try_advisory_lock(int, int) — both arguments must fit in a 32-bit int4 (max ~2.147 billion).
// A 9-billion "next in the sequence" value here throws "value out of range for type integer" on
// every call — never caught before this because no tenant had gone through real dedicated-database
// provisioning (auto or manual) until 2026-08-04. Sized instead to match BACKFILL_LOCK_CLASS
// (900263002 in server/routes.ts), the only other 2-arg advisory lock class in this codebase.
const TENANT_DB_PROVISIONING_LOCK_CLASS = 900263005;

/** Deterministic string→int32 hash for the per-tenant advisory-lock key. Collisions only cause
 *  harmless retried lock contention — correctness comes from the databaseUrl check below,
 *  not from this hash being collision-free. */
function tenantLockKey(tenantId: string): number {
  let hash = 0;
  for (let i = 0; i < tenantId.length; i++) {
    hash = (hash * 31 + tenantId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2147483647;
}

async function setMigrationState(tenantId: string, migrationState: string): Promise<void> {
  const [existing] = await cpDb.select({ tenantId: tenantDatabases.tenantId }).from(tenantDatabases)
    .where(eq(tenantDatabases.tenantId, tenantId)).limit(1);
  if (existing) {
    await cpDb.update(tenantDatabases).set({ migrationState }).where(eq(tenantDatabases.tenantId, tenantId));
  } else {
    await cpDb.insert(tenantDatabases).values({ tenantId, databaseUrl: null, migrationState });
  }
}

export async function commissionDedicatedTenantDatabase(tenantId: string): Promise<{ ok: boolean; reason?: string }> {
  let outcome: { ok: boolean; reason?: string } = { ok: false, reason: "lock not acquired" };

  try {
    await withAdvisoryLock(TENANT_DB_PROVISIONING_LOCK_CLASS, tenantLockKey(tenantId), async () => {
      const [existing] = await cpDb.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId)).limit(1);
      if (existing?.databaseUrl) {
        outcome = { ok: true, reason: "already commissioned" };
        return;
      }
      // Deliberately NOT short-circuiting on a stale migrationState === "running" here — if a
      // previous attempt's process died mid-commission (e.g. a deploy restarting the app), the
      // row would be stuck at "running" forever with nothing left holding the advisory lock,
      // and every future retry (automatic or the dashboard's "Retry" button) would silently
      // no-op against it. The advisory lock below is what actually prevents two concurrent
      // attempts; row state doesn't need to duplicate that.

      if (!process.env.DIGITALOCEAN_TENANT_DB_CLUSTER_ID || !process.env.DIGITALOCEAN_API_TOKEN) {
        await setMigrationState(tenantId, "pending");
        outcome = { ok: false, reason: "not configured" };
        return;
      }

      await setMigrationState(tenantId, "running");

      const provisioned = await provisionLogicalTenantDatabase(tenantId);
      if (!provisioned) {
        await setMigrationState(tenantId, "failed");
        outcome = { ok: false, reason: "DO provisioning failed" };
        return;
      }

      const destPool = new pg.Pool({ connectionString: provisioned.databaseDirectUrl, max: 3, ssl: { rejectUnauthorized: false } });
      try {
        const result = await migrateTenantData({
          tenantId,
          srcPool: sharedPool,
          destPool,
          cpDbInstance: cpDb,
          dryRun: false,
          cutover: { databaseUrl: provisioned.databaseUrl, databaseDirectUrl: provisioned.databaseDirectUrl },
          onProgress: (e) => structuredLog("info", "tenant db commissioning progress", { tenantId, ...e }),
        });

        if (!result.success) {
          await setMigrationState(tenantId, "failed");
          structuredLog("error", "tenant db commissioning: data migration mismatch", { tenantId, mismatches: result.mismatches });
          outcome = { ok: false, reason: "data migration mismatch" };
          return;
        }
      } finally {
        await destPool.end().catch(() => {});
      }

      sendInfrastructureReadyEmail(tenantId).catch((err) =>
        structuredLog("error", "sendInfrastructureReadyEmail failed", { tenantId, error: (err as Error).message }));

      outcome = { ok: true };
    });
    return outcome;
  } catch (err) {
    structuredLog("error", "commissionDedicatedTenantDatabase: unexpected error", { tenantId, error: (err as Error).message });
    await setMigrationState(tenantId, "failed").catch(() => {});
    return { ok: false, reason: "internal error" };
  }
}
