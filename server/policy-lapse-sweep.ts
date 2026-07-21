/**
 * Daily active→grace→lapsed policy status sweep.
 *
 * Every other place in this codebase that changes policy status does so REACTIVELY — a payment
 * clears and applyPolicyStatusForClearedPayment (server/policy-status-on-payment.ts) moves the
 * policy forward. Nothing has ever moved a policy the other way on its own: a policy that simply
 * stops being paid stays "active" indefinitely, with an expired grace period and mounting
 * arrears, until a staff member notices and manually clicks the transition. Every downstream
 * process that filters on status (clawback triggers, lapse-rate dashboards, portfolio health)
 * never sees it. This sweep is what was missing.
 *
 * Same self-rescheduling daily-at-fixed-UTC-hour shape as server/tenant-billing-sweep.ts, staggered
 * from it (06:00 UTC) and the backup scheduler (22:00 UTC).
 */
import { and, eq, isNotNull, lt } from "drizzle-orm";
import { getDbForOrg } from "./tenant-db";
import { storage } from "./storage";
import { policies, policyStatusHistory, productVersions } from "@shared/schema";
import { todayInHarare } from "./date-utils";
import { dispatchNotification, buildPolicyContext } from "./notifications";
import { recordClawback } from "./route-helpers";
import { withAdvisoryLock } from "./advisory-lock";
import { structuredLog } from "./logger";

let sweepTimer: NodeJS.Timeout | null = null;

// Stable pg advisory lock key for this scheduler — see PAYMENT_AUTO_LOCK_KEY (9_002_630_001),
// PARKED_VEHICLE_LOCK_KEY (9_002_630_002), and TENANT_BILLING_SWEEP_LOCK_KEY (9_002_630_003)
// for the numbering convention.
const POLICY_LAPSE_SWEEP_LOCK_KEY = 9_002_630_004;

const DEFAULT_GRACE_PERIOD_DAYS = 30; // matches advancePolicyCycle's fallback

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

export interface PolicyLapseSweepResult {
  orgsScanned: number;
  movedToGrace: number;
  movedToLapsed: number;
  errors: string[];
  skipped?: boolean;
}

/** orgId restricts the sweep to a single org — used by the per-org manual-trigger route so a
 *  staff member testing/running this doesn't touch other tenants' data. Omit for the real
 *  scheduled run, which always covers every org. */
export async function runPolicyLapseSweep(trigger: "scheduler" | "manual" = "scheduler", orgId?: string): Promise<PolicyLapseSweepResult> {
  let result: PolicyLapseSweepResult = { orgsScanned: 0, movedToGrace: 0, movedToLapsed: 0, errors: [] };
  let ran = false;
  await withAdvisoryLock(POLICY_LAPSE_SWEEP_LOCK_KEY, async () => {
    ran = true;
    result = await runSweepBody(trigger, orgId);
  });
  if (!ran) {
    structuredLog("warn", "Policy lapse sweep skipped — another run is already in progress", { trigger });
    return { ...result, skipped: true };
  }
  return result;
}

async function runSweepBody(trigger: "scheduler" | "manual", orgIdFilter?: string): Promise<PolicyLapseSweepResult> {
  const result: PolicyLapseSweepResult = { orgsScanned: 0, movedToGrace: 0, movedToLapsed: 0, errors: [] };
  const startedAt = Date.now();
  const today = todayInHarare();
  structuredLog("info", "Policy lapse sweep starting", { trigger, today, orgIdFilter });

  const orgs = orgIdFilter
    ? (await storage.getOrganization(orgIdFilter) ? [{ id: orgIdFilter }] : [])
    : await storage.getOrganizations();
  for (const org of orgs) {
    result.orgsScanned++;
    try {
      const tdb = await getDbForOrg(org.id);

      // ── Active policies whose due date has passed with no payment ──────────
      const overdueActive = await tdb.select().from(policies).where(and(
        eq(policies.organizationId, org.id),
        eq(policies.status, "active"),
        isNotNull(policies.currentCycleEnd),
        lt(policies.currentCycleEnd, today),
      ));

      for (const policy of overdueActive) {
        try {
          const dueDate = addDays(String(policy.currentCycleEnd), 1);
          let gracePeriodDays = DEFAULT_GRACE_PERIOD_DAYS;
          if (policy.productVersionId) {
            const [pv] = await tdb.select({ gracePeriodDays: productVersions.gracePeriodDays }).from(productVersions).where(eq(productVersions.id, policy.productVersionId)).limit(1);
            if (pv?.gracePeriodDays != null) gracePeriodDays = Number(pv.gracePeriodDays);
          }
          const graceEndDate = addDays(dueDate, gracePeriodDays);

          await tdb.update(policies).set({ status: "grace", graceEndDate }).where(eq(policies.id, policy.id));
          await tdb.insert(policyStatusHistory).values({
            policyId: policy.id, fromStatus: "active", toStatus: "grace",
            reason: `Grace period started — no payment received by due date ${dueDate}`,
            changedBy: undefined,
          });
          result.movedToGrace++;
          dispatchNotification(org.id, "grace_start", policy.clientId, await buildPolicyContext({ ...policy, status: "grace" }, org.id)).catch(() => {});

          // Already past the grace deadline too (a long-neglected policy, e.g. after this sweep
          // was off for a while) — fall straight through to lapsed in the same pass. active→lapsed
          // isn't a valid direct transition (VALID_POLICY_TRANSITIONS), so this always goes
          // through grace first, immediately, rather than skipping it.
          if (today > graceEndDate) {
            await tdb.update(policies).set({ status: "lapsed" }).where(eq(policies.id, policy.id));
            await tdb.insert(policyStatusHistory).values({
              policyId: policy.id, fromStatus: "grace", toStatus: "lapsed",
              reason: `Policy lapsed — grace period expired ${graceEndDate} with no payment`,
              changedBy: undefined,
            });
            result.movedToLapsed++;
            dispatchNotification(org.id, "policy_lapsed", policy.clientId, await buildPolicyContext({ ...policy, status: "lapsed" }, org.id)).catch(() => {});
            recordClawback(org.id, policy, "Policy lapsed (automatic sweep)").catch((err: any) =>
              structuredLog("error", "Policy lapse sweep: clawback failed", { policyId: policy.id, error: err?.message }));
          }
        } catch (err: any) {
          result.errors.push(`policy ${policy.id}: ${err?.message}`);
          structuredLog("error", "Policy lapse sweep: active→grace failed", { policyId: policy.id, orgId: org.id, error: err?.message });
        }
      }

      // ── Grace policies whose grace deadline has passed with no payment ─────
      const overdueGrace = await tdb.select().from(policies).where(and(
        eq(policies.organizationId, org.id),
        eq(policies.status, "grace"),
        isNotNull(policies.graceEndDate),
        lt(policies.graceEndDate, today),
      ));

      for (const policy of overdueGrace) {
        try {
          await tdb.update(policies).set({ status: "lapsed" }).where(eq(policies.id, policy.id));
          await tdb.insert(policyStatusHistory).values({
            policyId: policy.id, fromStatus: "grace", toStatus: "lapsed",
            reason: `Policy lapsed — grace period expired ${policy.graceEndDate} with no payment`,
            changedBy: undefined,
          });
          result.movedToLapsed++;
          dispatchNotification(org.id, "policy_lapsed", policy.clientId, await buildPolicyContext({ ...policy, status: "lapsed" }, org.id)).catch(() => {});
          recordClawback(org.id, policy, "Policy lapsed (automatic sweep)").catch((err: any) =>
            structuredLog("error", "Policy lapse sweep: clawback failed", { policyId: policy.id, error: err?.message }));
        } catch (err: any) {
          result.errors.push(`policy ${policy.id}: ${err?.message}`);
          structuredLog("error", "Policy lapse sweep: grace→lapsed failed", { policyId: policy.id, orgId: org.id, error: err?.message });
        }
      }
    } catch (err: any) {
      result.errors.push(`org ${org.id}: ${err?.message}`);
      structuredLog("error", "Policy lapse sweep: org processing failed", { orgId: org.id, error: err?.message });
    }
  }

  structuredLog("info", "Policy lapse sweep complete", { trigger, durationMs: Date.now() - startedAt, ...result });
  return result;
}

/** Daily at 04:00 UTC — staggered from the tenant billing sweep (06:00) and backup (22:00). */
export function startPolicyLapseSweepScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const targetHour = 4;
    const next = new Date(now);
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntilRun = next.getTime() - now.getTime();

    structuredLog("info", "Policy lapse sweep scheduled", { nextRun: next.toISOString(), msUntilRun });

    sweepTimer = setTimeout(async () => {
      try {
        await runPolicyLapseSweep("scheduler");
      } catch (err) {
        structuredLog("error", "Policy lapse sweep run threw", { error: (err as Error).message });
      }
      scheduleNext();
    }, msUntilRun);
  };
  scheduleNext();
}

export function stopPolicyLapseSweepScheduler(): void {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
}
