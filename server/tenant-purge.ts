/**
 * Phase 6: permanent, irreversible deletion of a tenant once its post-suspension view-only window
 * has elapsed. Tears down, in order:
 *   1. object storage under the tenant's prefix
 *   2. the tenant's database — a dedicated logical DB is dropped outright from the DO cluster;
 *      a shared-DB tenant has every organization_id-scoped row deleted (repeated-pass, FK-order
 *      agnostic) plus its organizations row
 *   3. every control-plane row (cascades from deleting the tenants row) — the tenants row is
 *      renamed "... (purged)" and left as a tombstone rather than deleted, so audit history and
 *      any external reference still resolves to a name
 *
 * Never called automatically unless billingSettings.hardDeleteEnabled is on — otherwise the
 * deletion sweep parks the tenant at licenseStatus='pending_deletion' and a platform owner runs
 * this by hand (POST /api/platform/tenants/:id/purge with a typed confirmation).
 */
import { eq, sql } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import {
  tenants as cpTenants,
  tenantDatabases,
  tenantStorage,
  tenantSubscriptions,
  tenantInvoices,
  pendingTenantSignups,
  tenantBillingEvents,
} from "@shared/control-plane-schema";
import { getDbForOrg, closeOrgPool } from "./tenant-db";
import { deletePrefix } from "./object-storage";
import { decommissionLogicalTenantDatabase } from "./do-database-provisioning";
import { structuredLog } from "./logger";

export interface PurgeResult {
  ok: boolean;
  storageObjectsDeleted: number;
  databaseMode: "dedicated_dropped" | "shared_rows_deleted" | "skipped";
  rowsDeleted: number;
  leftoverTables: string[];
  notes: string[];
}

/** Deletes every organization_id-scoped row in the SHARED database for this tenant. */
async function purgeSharedDbRows(tenantId: string, notes: string[]): Promise<{ rowsDeleted: number; leftoverTables: string[] }> {
  const db = await getDbForOrg(tenantId); // shared pool for a shared tenant
  const tableRows: any = await db.execute(sql.raw(
    `SELECT c.table_name FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_name = c.table_name AND t.table_schema = c.table_schema
     WHERE c.table_schema = 'public' AND c.column_name = 'organization_id' AND t.table_type = 'BASE TABLE'`,
  ));
  const rows = (tableRows.rows ?? tableRows) as Array<{ table_name: string }>;
  let pending = rows.map((r) => r.table_name).filter((t) => t !== "organizations");

  let rowsDeleted = 0;
  // Repeated passes: a DELETE blocked by a child-table FK just retries next pass once that child
  // has itself been emptied. Converges for an acyclic FK graph; bail after N stalled passes.
  for (let pass = 0; pass < 12 && pending.length > 0; pass++) {
    const stillPending: string[] = [];
    let progressed = false;
    for (const table of pending) {
      try {
        const res: any = await db.execute(sql.raw(`DELETE FROM "${table}" WHERE organization_id = '${tenantId}'`));
        rowsDeleted += res.rowCount ?? res.rowsAffected ?? 0;
        progressed = true;
      } catch (err: any) {
        stillPending.push(table);
        if (pass === 11) notes.push(`could not clear ${table}: ${(err?.message || "").slice(0, 120)}`);
      }
    }
    pending = stillPending;
    if (!progressed) break;
  }

  try {
    const res: any = await db.execute(sql.raw(`DELETE FROM "organizations" WHERE id = '${tenantId}'`));
    rowsDeleted += res.rowCount ?? res.rowsAffected ?? 0;
  } catch (err: any) {
    notes.push(`could not delete organizations row: ${(err?.message || "").slice(0, 120)}`);
  }
  return { rowsDeleted, leftoverTables: pending };
}

export async function purgeTenant(tenantId: string, opts: { actorEmail?: string } = {}): Promise<PurgeResult> {
  const result: PurgeResult = {
    ok: false, storageObjectsDeleted: 0, databaseMode: "skipped", rowsDeleted: 0, leftoverTables: [], notes: [],
  };

  const [tenant] = await cpDb.select().from(cpTenants).where(eq(cpTenants.id, tenantId)).limit(1);
  if (!tenant) { result.notes.push("tenant not found"); return result; }

  structuredLog("warn", "TENANT PURGE starting", { tenantId, name: tenant.name, actor: opts.actorEmail });

  // 1. Storage
  const [storageRow] = await cpDb.select().from(tenantStorage).where(eq(tenantStorage.tenantId, tenantId)).limit(1);
  const prefix = storageRow?.prefix || `tenants/${tenantId}/`;
  try {
    result.storageObjectsDeleted = await deletePrefix(prefix);
  } catch (err: any) {
    result.notes.push(`storage: ${(err?.message || "").slice(0, 120)}`);
  }

  // 2. Database
  const [dbRow] = await cpDb.select().from(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId)).limit(1);
  const isDedicated = !!dbRow?.databaseUrl;
  if (isDedicated) {
    await closeOrgPool(tenantId).catch(() => {});
    const dec = await decommissionLogicalTenantDatabase(tenantId);
    result.databaseMode = "dedicated_dropped";
    if (!dec.ok) result.notes.push(`DO database: ${dec.reason ?? "failed"} — may need a manual drop`);
  } else {
    const { rowsDeleted, leftoverTables } = await purgeSharedDbRows(tenantId, result.notes);
    result.databaseMode = "shared_rows_deleted";
    result.rowsDeleted = rowsDeleted;
    result.leftoverTables = leftoverTables;
  }

  // 3. Control-plane teardown. Null the signup back-reference first (its FK isn't ON DELETE
  // CASCADE), then drop the rows that cascade, then tombstone the tenant row itself.
  await cpDb.update(pendingTenantSignups).set({ provisionedTenantId: null }).where(eq(pendingTenantSignups.provisionedTenantId, tenantId)).catch(() => {});
  await cpDb.delete(tenantInvoices).where(eq(tenantInvoices.tenantId, tenantId)).catch((e) => result.notes.push(`cp invoices: ${e.message}`));
  await cpDb.delete(tenantSubscriptions).where(eq(tenantSubscriptions.tenantId, tenantId)).catch((e) => result.notes.push(`cp subscription: ${e.message}`));
  await cpDb.delete(tenantDatabases).where(eq(tenantDatabases.tenantId, tenantId)).catch(() => {});
  await cpDb.delete(tenantStorage).where(eq(tenantStorage.tenantId, tenantId)).catch(() => {});
  await cpDb.insert(tenantBillingEvents).values({
    tenantId, type: "tenant_purged",
    detail: { actor: opts.actorEmail ?? "system", storageObjectsDeleted: result.storageObjectsDeleted, databaseMode: result.databaseMode, rowsDeleted: result.rowsDeleted },
  }).catch(() => {});

  await cpDb.update(cpTenants).set({
    name: tenant.name.endsWith("(purged)") ? tenant.name : `${tenant.name} (purged)`,
    isActive: false,
    licenseStatus: "purged",
    provisioningState: "suspended",
    viewOnlyGraceUntil: null,
    suspendReason: `Permanently deleted ${new Date().toISOString().slice(0, 10)}`,
  }).where(eq(cpTenants.id, tenantId));

  result.ok = result.leftoverTables.length === 0 && result.notes.length === 0;
  structuredLog("warn", "TENANT PURGE complete", { tenantId, ...result });
  return result;
}
