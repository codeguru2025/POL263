/**
 * Platform-granted SMS allowance per tenant (control_plane.tenant_sms_allocations).
 *
 * The platform owner grants a tenant a number of SMS credits; every SMS the tenant sends deducts
 * from it. One credit = one SMS *part* — the provider bills per part (160 characters of plain
 * text, or 70 once the message contains characters outside the GSM-7 alphabet such as emoji or
 * curly quotes; longer messages are split into 153/67-character parts), so the allowance tracks
 * what the platform is actually charged.
 *
 * A tenant with no allocation row is NOT metered (unlimited) — e.g. one sending on its own
 * provider account. Deduction is a single conditional UPDATE, so concurrent sends from several
 * instances can never spend the same last credit twice; a failed send is refunded.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenantSmsAllocations, tenantSmsAllocationEvents } from "@shared/control-plane-schema";
import { isGsm7 } from "./phone";
import { structuredLog } from "./logger";
import { notifyUsersWithPermission } from "./user-notifications";

// GSM-7 "extension table" characters take two septets each.
const GSM7_EXTENDED = /[\^{}\\[\]~|€\f]/g;

/** How many billable SMS parts `text` will be sent as. */
export function countSmsSegments(text: string): number {
  const body = String(text ?? "");
  if (isGsm7(body)) {
    const septets = body.length + (body.match(GSM7_EXTENDED)?.length ?? 0);
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  // UCS-2: count UTF-16 code units (an emoji is two).
  return body.length <= 70 ? 1 : Math.ceil(body.length / 67);
}

export interface SmsAllowance {
  /** false = no allowance configured for this tenant: sends are not counted against anything. */
  metered: boolean;
  enforced: boolean;
  allocated: number;
  used: number;
  remaining: number;
  lowBalanceThreshold: number;
}

const UNMETERED: SmsAllowance = { metered: false, enforced: false, allocated: 0, used: 0, remaining: 0, lowBalanceThreshold: 0 };

function toAllowance(row: typeof tenantSmsAllocations.$inferSelect | undefined): SmsAllowance {
  if (!row) return { ...UNMETERED };
  return {
    metered: true,
    enforced: row.enforced,
    allocated: row.creditsAllocated,
    used: row.creditsUsed,
    remaining: row.creditsAllocated - row.creditsUsed,
    lowBalanceThreshold: row.lowBalanceThreshold,
  };
}

export async function getSmsAllowance(orgId: string): Promise<SmsAllowance> {
  const [row] = await cpDb.select().from(tenantSmsAllocations).where(eq(tenantSmsAllocations.tenantId, orgId)).limit(1);
  return toAllowance(row);
}

export interface SmsReservation {
  ok: boolean;
  metered: boolean;
  /** Credits actually deducted — refund exactly this if the send then fails. */
  charged: number;
  reason?: string;
}

/**
 * Deducts `credits` from the tenant's allowance before a send. Refuses (ok:false) when an
 * enforced allowance doesn't have enough left — unless `allowOverdraft` (one-time login codes:
 * locking a user out of their account is worse than a small overdraft; the balance just goes
 * below zero and the admins are told).
 */
export async function reserveSmsCredits(orgId: string, credits: number, opts: { allowOverdraft?: boolean } = {}): Promise<SmsReservation> {
  const [row] = await cpDb.select().from(tenantSmsAllocations).where(eq(tenantSmsAllocations.tenantId, orgId)).limit(1);
  if (!row) return { ok: true, metered: false, charged: 0 };

  const mustFit = row.enforced && !opts.allowOverdraft;
  const [updated] = await cpDb
    .update(tenantSmsAllocations)
    .set({ creditsUsed: sql`${tenantSmsAllocations.creditsUsed} + ${credits}`, updatedAt: new Date() })
    .where(and(
      eq(tenantSmsAllocations.tenantId, orgId),
      ...(mustFit ? [sql`${tenantSmsAllocations.creditsAllocated} - ${tenantSmsAllocations.creditsUsed} >= ${credits}`] : []),
    ))
    .returning();

  if (!updated) {
    alertAllowance(orgId, "exhausted", toAllowance(row));
    const left = Math.max(0, row.creditsAllocated - row.creditsUsed);
    return {
      ok: false,
      metered: true,
      charged: 0,
      reason: left > 0
        ? `Not sent — this message needs ${credits} SMS credits but only ${left} are left in your allowance. It will be sent automatically once more credits are added.`
        : "Not sent — your SMS allowance is used up. It will be sent automatically once more credits are added.",
    };
  }

  const after = toAllowance(updated);
  const before = after.remaining + credits;
  if (after.remaining <= 0 && before > 0) alertAllowance(orgId, "exhausted", after);
  else if (after.remaining <= after.lowBalanceThreshold && before > after.lowBalanceThreshold) alertAllowance(orgId, "low", after);
  return { ok: true, metered: true, charged: credits };
}

/** Gives back credits reserved for a send the provider then rejected. Never goes below zero used. */
export async function refundSmsCredits(orgId: string, credits: number): Promise<void> {
  if (credits <= 0) return;
  await cpDb
    .update(tenantSmsAllocations)
    .set({ creditsUsed: sql`GREATEST(${tenantSmsAllocations.creditsUsed} - ${credits}, 0)`, updatedAt: new Date() })
    .where(eq(tenantSmsAllocations.tenantId, orgId));
}

/**
 * Platform owner adds (positive) or removes (negative — a correction) credits. Creates the
 * tenant's allowance on first grant, which is what switches metering on for them.
 */
export async function grantSmsCredits(orgId: string, credits: number, opts: { note?: string | null; actorEmail?: string | null }): Promise<SmsAllowance> {
  const now = new Date();
  const [row] = await cpDb
    .insert(tenantSmsAllocations)
    .values({ tenantId: orgId, creditsAllocated: Math.max(0, credits), creditsUsed: 0 })
    .onConflictDoUpdate({
      target: tenantSmsAllocations.tenantId,
      set: { creditsAllocated: sql`GREATEST(${tenantSmsAllocations.creditsAllocated} + ${credits}, 0)`, updatedAt: now },
    })
    .returning();
  const allowance = toAllowance(row);
  await cpDb.insert(tenantSmsAllocationEvents).values({
    tenantId: orgId,
    type: credits >= 0 ? "grant" : "correction",
    credits,
    balanceAfter: allowance.remaining,
    note: opts.note?.trim() || null,
    actorEmail: opts.actorEmail ?? null,
  });
  return allowance;
}

export async function updateSmsAllowanceSettings(
  orgId: string,
  patch: { lowBalanceThreshold?: number; enforced?: boolean },
  actorEmail?: string | null,
): Promise<SmsAllowance | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.lowBalanceThreshold !== undefined) set.lowBalanceThreshold = patch.lowBalanceThreshold;
  if (patch.enforced !== undefined) set.enforced = patch.enforced;
  const [row] = await cpDb.update(tenantSmsAllocations).set(set).where(eq(tenantSmsAllocations.tenantId, orgId)).returning();
  if (!row) return null;
  const allowance = toAllowance(row);
  const parts: string[] = [];
  if (patch.enforced !== undefined) parts.push(patch.enforced ? "Sending now stops when the allowance runs out" : "Sending no longer stops when the allowance runs out");
  if (patch.lowBalanceThreshold !== undefined) parts.push(`Low-balance warning at ${patch.lowBalanceThreshold} credits`);
  await cpDb.insert(tenantSmsAllocationEvents).values({
    tenantId: orgId, type: "settings", credits: 0, balanceAfter: allowance.remaining,
    note: parts.join("; ") || null, actorEmail: actorEmail ?? null,
  });
  return allowance;
}

export async function listSmsAllowanceEvents(orgId: string, limit = 50) {
  return cpDb
    .select()
    .from(tenantSmsAllocationEvents)
    .where(eq(tenantSmsAllocationEvents.tenantId, orgId))
    .orderBy(desc(tenantSmsAllocationEvents.createdAt))
    .limit(limit);
}

// ── Admin alerts ─────────────────────────────────────────────────────────────
// "low" fires once per crossing of the threshold (the UPDATE above sees the crossing exactly once
// across all instances). "exhausted" can also fire on every refused send, so it's throttled per
// instance.
const EXHAUSTED_ALERT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const lastExhaustedAlert = new Map<string, number>();

function alertAllowance(orgId: string, kind: "low" | "exhausted", a: SmsAllowance): void {
  if (kind === "exhausted") {
    const last = lastExhaustedAlert.get(orgId) ?? 0;
    if (Date.now() - last < EXHAUSTED_ALERT_INTERVAL_MS) return;
    lastExhaustedAlert.set(orgId, Date.now());
  }
  const payload = kind === "low"
    ? {
        title: `SMS allowance running low — ${a.remaining} left`,
        body: `You have ${a.remaining} SMS credits left out of ${a.allocated} given to you so far. Once they run out, text messages to clients will stop until more are added. Please contact the platform administrator to top up.`,
      }
    : {
        title: "SMS allowance used up — texts are not being sent",
        body: `All ${a.allocated} SMS credits given to you have been used, so text messages to clients are on hold. They will go out automatically (for up to 24 hours) once the platform administrator adds more credits.`,
      };
  structuredLog("warn", "SMS allowance alert", { orgId, kind, remaining: a.remaining, allocated: a.allocated });
  void notifyUsersWithPermission(orgId, "manage:settings", { type: "GENERAL", ...payload, metadata: { smsAllowance: kind } });
}

/** Test hook. */
export function resetSmsAllowanceAlertState(): void {
  lastExhaustedAlert.clear();
}
