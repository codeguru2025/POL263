/**
 * Resolves the raw foreign-key UUIDs inside audit_logs before/after JSON (removalDriverId,
 * clientId, policyId, ...) AND the row's own top-level entityType/entityId into human-readable
 * labels for display — "Removal driver: e7e7f9d3-…" reads as jargon to a non-technical reader;
 * "Removal driver: Tendai Moyo" doesn't. Likewise "Fleet Vehicle · e7e7f9d3" means nothing next
 * to "Fleet Vehicle · ABC 1234".
 *
 * Two layers:
 *  1. Field-name-rule-based resolution of embedded UUIDs (matches the "generic humanizer, no
 *     per-action lookup table" philosophy in client/src/lib/audit-format.ts) — a new mutation
 *     route's audit log gets ID resolution for free as long as its field names follow the same
 *     *Id/*By conventions the rest of the schema already uses.
 *  2. entityType -> table lookup for the row's own entityId, so the subtitle line shows a name
 *     instead of a truncated UUID. Also used to surface the policy number for any row whose
 *     entity IS a policy or whose payload carries a policyId — most mutations in this system
 *     happen against a policy and the reader wants to know which one at a glance.
 *
 * Returns a flat {uuid: label} map plus a per-row {auditLogId: policyNumber} map. Collisions
 * across different tables are exceedingly unlikely within one tenant's audit log and the UI only
 * ever does a value lookup, not a typed one, so a flat map keeps this simple.
 */
import { inArray } from "drizzle-orm";
import type { OrgDataDb } from "./tenant-db";
import { users, clients, policies, branches, groups, fleetVehicles, products, claims, paymentReceipts } from "@shared/schema";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type RefTable = "users" | "clients" | "policies" | "branches" | "groups" | "vehicles" | "products" | "claims" | "receipts";

/** Which table a before/after field name's UUID value refers to — order matters, first match wins. */
function tableForField(field: string): RefTable | null {
  if (field === "clientId") return "clients";
  if (field === "policyId") return "policies";
  if (field === "branchId") return "branches";
  if (field === "groupId") return "groups";
  if (field === "vehicleId" || field === "fleetVehicleId") return "vehicles";
  if (field === "productId") return "products";
  if (field === "claimId") return "claims";
  if (field === "receiptId") return "receipts";
  // Actor-shaped fields: anyone who did/received/approved/was-assigned something is a staff user.
  // Covers removalDriverId, receivedByUserId, dispatchedByUserId, approvedBy, verifiedBy,
  // submittedBy, changedBy, recordedBy, paidByUserId, completedByUserId, takenOutByUserId,
  // receivedBackByUserId, agentId, assignedTo, userId, driverId, defaultDriverId, etc.
  if (/(By|UserId|DriverId)$/.test(field) || field === "agentId" || field === "assignedTo" || field === "userId") {
    return "users";
  }
  return null;
}

/** Which table a row's own entityType names — the audit-log entityType strings are PascalCase
 *  singular (see auditLog() call sites in server/routes.ts). Only the types worth resolving to a
 *  name are listed; anything not here just keeps showing its short id, same as before. */
function tableForEntityType(entityType: string | null | undefined): RefTable | null {
  switch (entityType) {
    case "Policy": return "policies";
    case "Client": return "clients";
    case "User": return "users";
    case "Branch": return "branches";
    case "Group": return "groups";
    case "FleetVehicle": return "vehicles";
    case "Product": return "products";
    case "Claim": return "claims";
    case "PaymentReceipt": return "receipts";
    default: return null;
  }
}

interface AuditRow {
  id?: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

function collectRefIds(rows: AuditRow[]): Map<RefTable, Set<string>> {
  const byTable = new Map<RefTable, Set<string>>();
  const add = (table: RefTable, id: string) => {
    if (!byTable.has(table)) byTable.set(table, new Set());
    byTable.get(table)!.add(id);
  };
  for (const row of rows) {
    // The row's own entity.
    if (row.entityId && UUID_RE.test(row.entityId)) {
      const table = tableForEntityType(row.entityType);
      if (table) add(table, row.entityId);
    }
    // Embedded FK UUIDs inside before/after.
    for (const payload of [row.before, row.after]) {
      if (!payload || typeof payload !== "object") continue;
      for (const [field, value] of Object.entries(payload as Record<string, unknown>)) {
        if (typeof value !== "string" || !UUID_RE.test(value)) continue;
        const table = tableForField(field);
        if (table) add(table, value);
      }
    }
  }
  return byTable;
}

/** Pull a policyId out of a before/after payload, if present. */
function policyIdFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const v = (payload as Record<string, unknown>).policyId;
  return typeof v === "string" && UUID_RE.test(v) ? v : null;
}

export interface ResolvedAuditRefs {
  /** uuid -> human label */
  refs: Record<string, string>;
  /** auditLogId -> policy number, for rows that concern a policy */
  policyNumbers: Record<string, string>;
}

export async function resolveAuditRefs(
  tdb: OrgDataDb,
  rows: AuditRow[]
): Promise<ResolvedAuditRefs> {
  const byTable = collectRefIds(rows);
  const refs: Record<string, string> = {};

  const usersIds = byTable.get("users");
  if (usersIds?.size) {
    const found = await tdb.select({ id: users.id, displayName: users.displayName, email: users.email })
      .from(users).where(inArray(users.id, Array.from(usersIds)));
    for (const u of found) refs[u.id] = u.displayName || u.email || u.id;
  }

  const clientIds = byTable.get("clients");
  if (clientIds?.size) {
    const found = await tdb.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients).where(inArray(clients.id, Array.from(clientIds)));
    for (const c of found) refs[c.id] = [c.firstName, c.lastName].filter(Boolean).join(" ") || c.id;
  }

  const policyIds = byTable.get("policies");
  if (policyIds?.size) {
    const found = await tdb.select({ id: policies.id, policyNumber: policies.policyNumber })
      .from(policies).where(inArray(policies.id, Array.from(policyIds)));
    for (const p of found) refs[p.id] = p.policyNumber || p.id;
  }

  const branchIds = byTable.get("branches");
  if (branchIds?.size) {
    const found = await tdb.select({ id: branches.id, name: branches.name })
      .from(branches).where(inArray(branches.id, Array.from(branchIds)));
    for (const b of found) refs[b.id] = b.name || b.id;
  }

  const groupIds = byTable.get("groups");
  if (groupIds?.size) {
    const found = await tdb.select({ id: groups.id, name: groups.name })
      .from(groups).where(inArray(groups.id, Array.from(groupIds)));
    for (const g of found) refs[g.id] = g.name || g.id;
  }

  const vehicleIds = byTable.get("vehicles");
  if (vehicleIds?.size) {
    const found = await tdb.select({ id: fleetVehicles.id, registration: fleetVehicles.registration, make: fleetVehicles.make, model: fleetVehicles.model })
      .from(fleetVehicles).where(inArray(fleetVehicles.id, Array.from(vehicleIds)));
    for (const v of found) {
      const desc = [v.make, v.model].filter(Boolean).join(" ");
      refs[v.id] = v.registration
        ? (desc ? `${v.registration} (${desc})` : v.registration)
        : desc || v.id;
    }
  }

  const productIds = byTable.get("products");
  if (productIds?.size) {
    const found = await tdb.select({ id: products.id, name: products.name })
      .from(products).where(inArray(products.id, Array.from(productIds)));
    for (const p of found) refs[p.id] = p.name || p.id;
  }

  const claimIds = byTable.get("claims");
  if (claimIds?.size) {
    const found = await tdb.select({ id: claims.id, claimNumber: claims.claimNumber })
      .from(claims).where(inArray(claims.id, Array.from(claimIds)));
    for (const c of found) refs[c.id] = c.claimNumber || c.id;
  }

  const receiptIds = byTable.get("receipts");
  if (receiptIds?.size) {
    const found = await tdb.select({ id: paymentReceipts.id, receiptNumber: paymentReceipts.receiptNumber })
      .from(paymentReceipts).where(inArray(paymentReceipts.id, Array.from(receiptIds)));
    for (const r of found) refs[r.id] = r.receiptNumber || r.id;
  }

  // Per-row policy number: the row's entity is a policy, or its payload carries a policyId.
  // Needs a second pass to resolve any policyId that only appears in a payload (not caught by
  // the field/entityType collectors above if the id wasn't also a resolvable *Id field — it is,
  // but the claims/receipts rows link to policies we may not have fetched yet).
  const extraPolicyIds = new Set<string>();
  for (const row of rows) {
    const pid = (row.entityType === "Policy" && row.entityId && UUID_RE.test(row.entityId))
      ? row.entityId
      : policyIdFromPayload(row.before) || policyIdFromPayload(row.after);
    if (pid && !refs[pid]) extraPolicyIds.add(pid);
  }
  if (extraPolicyIds.size) {
    const found = await tdb.select({ id: policies.id, policyNumber: policies.policyNumber })
      .from(policies).where(inArray(policies.id, Array.from(extraPolicyIds)));
    for (const p of found) refs[p.id] = p.policyNumber || p.id;
  }

  const policyNumbers: Record<string, string> = {};
  for (const row of rows) {
    if (!row.id) continue;
    const pid = (row.entityType === "Policy" && row.entityId && UUID_RE.test(row.entityId))
      ? row.entityId
      : policyIdFromPayload(row.before) || policyIdFromPayload(row.after);
    if (pid && refs[pid]) policyNumbers[row.id] = refs[pid];
  }

  return { refs, policyNumbers };
}
