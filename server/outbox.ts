/**
 * Transactional outbox: rows are written in the same DB transaction as domain changes,
 * then processed asynchronously via `requestOutboxDrain` + periodic `drainOutboxForOrg`.
 */

import { eq, and, asc } from "drizzle-orm";
import { outboxMessages, organizations } from "@shared/schema";
import type { OrgDrizzleDb } from "./storage";
import { getDbForOrg, withOrgTransaction } from "./tenant-db";
import { db } from "./db";
import { handleOutboxMessage } from "./outbox-handlers";
import { structuredLog } from "./logger";
import { enqueueJob } from "./job-queue";

export {
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP,
  OUTBOX_TYPE_SERVICE_RECEIPT_FOLLOWUP,
} from "./outbox-constants";

const MAX_ATTEMPTS = 8;

export async function insertOutboxMessageInTx(
  tx: OrgDrizzleDb,
  args: {
    organizationId: string;
    type: string;
    payload: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<void> {
  await tx
    .insert(outboxMessages)
    .values({
      organizationId: args.organizationId,
      type: args.type,
      payloadJson: args.payload,
      dedupeKey: args.dedupeKey,
      status: "pending",
    })
    .onConflictDoNothing({ target: [outboxMessages.organizationId, outboxMessages.dedupeKey] });
}

/** Schedule a drain on the in-process job queue (runs soon after the HTTP handler returns). */
export function requestOutboxDrain(orgId: string): void {
  enqueueJob("outbox:drain", { orgId }, async () => {
    await drainOutboxForOrg(orgId);
  });
}

export async function drainOutboxForOrg(orgId: string, limit = 25): Promise<void> {
  const tdb = await getDbForOrg(orgId);
  // Snapshot pending IDs outside a transaction (fast, no locks held).
  const pendingIds = await tdb
    .select({ id: outboxMessages.id })
    .from(outboxMessages)
    .where(and(eq(outboxMessages.organizationId, orgId), eq(outboxMessages.status, "pending")))
    .orderBy(asc(outboxMessages.createdAt))
    .limit(limit);

  for (const { id } of pendingIds) {
    try {
      // Fix 1: Process each message inside its own transaction.
      // SELECT FOR UPDATE SKIP LOCKED is now inside BEGIN...COMMIT so the row lock
      // is held until the status UPDATE commits — preventing concurrent re-delivery.
      await withOrgTransaction(orgId, async (txDb) => {
        const [row] = await txDb
          .select()
          .from(outboxMessages)
          .where(and(eq(outboxMessages.id, id), eq(outboxMessages.status, "pending")))
          .limit(1)
          .for("update", { skipLocked: true });
        if (!row) return; // Already claimed by a concurrent worker — skip

        try {
          await handleOutboxMessage(orgId, row);
          await txDb
            .update(outboxMessages)
            .set({ status: "done", processedAt: new Date(), lastError: null })
            .where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.status, "pending")));
        } catch (err: any) {
          const msg = err?.message || String(err);
          const nextAttempts = (row.attempts ?? 0) + 1;
          const failed = nextAttempts >= MAX_ATTEMPTS;
          await txDb
            .update(outboxMessages)
            .set({
              attempts: nextAttempts,
              lastError: msg,
              status: failed ? "failed" : "pending",
              ...(failed ? { processedAt: new Date() } : {}),
            })
            .where(eq(outboxMessages.id, row.id));
          structuredLog("error", "Outbox handler failed", {
            orgId,
            outboxId: row.id,
            type: row.type,
            attempts: nextAttempts,
            error: msg,
          });
        }
      });
    } catch (txErr: any) {
      structuredLog("error", "Outbox TX wrapper failed", { orgId, outboxId: id, error: txErr?.message });
    }
  }
}

// Fix 6: prevent overlapping sweeps if one tick takes longer than the interval.
let backgroundDrainRunning = false;
const OUTBOX_SWEEP_BATCH = 5;

/** Periodic sweep so stuck rows are retried after deploy or missed `requestOutboxDrain`. */
export function startOutboxBackgroundDrain(): NodeJS.Timeout {
  const intervalMs = parseInt(process.env.OUTBOX_DRAIN_INTERVAL_MS || "60000", 10);
  return setInterval(() => {
    if (backgroundDrainRunning) return; // Fix 6: skip tick if previous sweep still running
    backgroundDrainRunning = true;
    void (async () => {
      try {
        const orgs = await db.select({ id: organizations.id }).from(organizations);
        // Fix 6: process orgs in batches of 5 to cap concurrent DB connections
        for (let i = 0; i < orgs.length; i += OUTBOX_SWEEP_BATCH) {
          await Promise.all(
            orgs.slice(i, i + OUTBOX_SWEEP_BATCH).map(({ id }) =>
              drainOutboxForOrg(id, 15).catch((err: any) => {
                structuredLog("error", "Outbox sweep failed for org", { orgId: id, error: err?.message });
              })
            )
          );
        }
      } catch (err: any) {
        structuredLog("error", "Outbox background drain tick failed", { error: err?.message || String(err) });
      } finally {
        backgroundDrainRunning = false;
      }
    })();
  }, intervalMs);
}
