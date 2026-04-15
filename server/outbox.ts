/**
 * Transactional outbox: rows are written in the same DB transaction as domain changes,
 * then processed asynchronously via `requestOutboxDrain` + periodic `drainOutboxForOrg`.
 */

import { eq, and, asc } from "drizzle-orm";
import { outboxMessages, organizations } from "@shared/schema";
import type { OrgDrizzleDb } from "./storage";
import { getDbForOrg } from "./tenant-db";
import { db } from "./db";
import { handleOutboxMessage } from "./outbox-handlers";
import { structuredLog } from "./logger";
import { enqueueJob } from "./job-queue";

export {
  OUTBOX_TYPE_PAYMENT_STAFF_FOLLOWUP,
  OUTBOX_TYPE_CASH_RECEIPT_FOLLOWUP,
  OUTBOX_TYPE_PAYNOW_APPLY_FOLLOWUP,
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
  const pending = await tdb
    .select()
    .from(outboxMessages)
    .where(and(eq(outboxMessages.organizationId, orgId), eq(outboxMessages.status, "pending")))
    .orderBy(asc(outboxMessages.createdAt))
    .limit(limit);

  for (const row of pending) {
    try {
      await handleOutboxMessage(orgId, row);
      await tdb
        .update(outboxMessages)
        .set({ status: "done", processedAt: new Date(), lastError: null })
        .where(and(eq(outboxMessages.id, row.id), eq(outboxMessages.status, "pending")));
    } catch (err: any) {
      const msg = err?.message || String(err);
      const nextAttempts = (row.attempts ?? 0) + 1;
      const failed = nextAttempts >= MAX_ATTEMPTS;
      await tdb
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
  }
}

/** Periodic sweep so stuck rows are retried after deploy or missed `requestOutboxDrain`. */
export function startOutboxBackgroundDrain(): NodeJS.Timeout {
  const intervalMs = parseInt(process.env.OUTBOX_DRAIN_INTERVAL_MS || "60000", 10);
  return setInterval(() => {
    void (async () => {
      try {
        const orgs = await db.select({ id: organizations.id }).from(organizations);
        for (const { id } of orgs) {
          await drainOutboxForOrg(id, 15);
        }
      } catch (err: any) {
        structuredLog("error", "Outbox background drain tick failed", { error: err?.message || String(err) });
      }
    })();
  }, intervalMs);
}
