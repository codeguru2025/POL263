/**
 * Daily birthday / policy-anniversary / premium-due / pre-lapse-warning / lapsed-today digest.
 *
 * Was previously only reachable via POST /api/admin/run-notifications, which nothing ever
 * called automatically — birthday, anniversary and pre-lapse-warning emails never went out in
 * production unless a staff member manually hit that endpoint. Same self-rescheduling
 * daily-at-fixed-UTC-hour shape as server/policy-lapse-sweep.ts and server/tenant-billing-sweep.ts,
 * staggered between them (05:00 UTC).
 */
import { storage } from "./storage";
import { dispatchNotification, buildPolicyContext } from "./notifications";
import { withAdvisoryLock } from "./advisory-lock";
import { structuredLog } from "./logger";
import { todayForOrg } from "./date-utils";

let sweepTimer: NodeJS.Timeout | null = null;

// Stable pg advisory lock key for this scheduler — see PAYMENT_AUTO_LOCK_KEY (9_002_630_001),
// PARKED_VEHICLE_LOCK_KEY (9_002_630_002), TENANT_BILLING_SWEEP_LOCK_KEY (9_002_630_003), and
// POLICY_LAPSE_SWEEP_LOCK_KEY (9_002_630_004) for the numbering convention.
const CLIENT_NOTIFICATION_SWEEP_LOCK_KEY = 9_002_630_005;

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// This sweep is date-based (birthday/anniversary/N-days-to-due), not state-based like the
// policy lapse sweep — a policy that already moved to "grace" naturally drops out of the next
// run's query, but a client whose birthday is today has no state to fall out of. Without this
// guard, the 05:00 UTC scheduled run plus a staff member clicking "Run notification digest now"
// later the same day (to test a template, or just out of curiosity) would double-send every
// matching birthday/anniversary/premium-due/pre-lapse email that day. In-memory and per-process
// (same convention as paymentAutomationTickRunning/parkedVehicleTickRunning in server/routes.ts)
// — resets on restart/deploy, which is an acceptable gap given deploys are infrequent and this
// covers the actual common case (curious re-clicks, manual test right after the scheduled run).
const lastRunDateByOrg = new Map<string, string>();

export interface ClientNotificationSweepResult {
  orgsScanned: number;
  birthdayCount: number;
  anniversaryCount: number;
  premiumDueCount: number;
  preLapseCount: number;
  lapseCount: number;
  errors: string[];
  skipped?: boolean;
  /** Orgs whose sweep for today already completed (scheduled or manual) — not re-run to avoid
   *  double-sending the same date-based emails a second time today. */
  orgsAlreadyRanToday?: number;
}

/** True if dateStr ("YYYY-MM-DD" or any ISO-prefixed value) falls on the same month+day as
 *  todayStr, ignoring year — for birthday/anniversary matching. */
function isSameMonthDay(dateStr: string, todayStr: string): boolean {
  const [, m1, d1] = String(dateStr).slice(0, 10).split("-");
  const [, m2, d2] = todayStr.split("-");
  return m1 === m2 && d1 === d2;
}

/** Whole-day difference between two "YYYY-MM-DD" strings (b - a), computed via UTC components
 *  so it's immune to the server-local-time pitfall date-utils.ts warns about (see the matching
 *  comment on addDays in server/policy-lapse-sweep.ts and server/policy-status-on-payment.ts). */
function daysBetween(aStr: string, bStr: string): number {
  const [ay, am, ad] = String(aStr).slice(0, 10).split("-").map(Number);
  const [by, bm, bd] = bStr.split("-").map(Number);
  const a = Date.UTC(ay, am - 1, ad);
  const b = Date.UTC(by, bm - 1, bd);
  return Math.round((b - a) / 86400000);
}

/** orgId restricts the sweep to a single org — used by the per-org manual-trigger route so a
 *  staff member testing/running this doesn't touch other tenants' data. Omit for the real
 *  scheduled run, which always covers every org. */
export async function runClientNotificationSweep(trigger: "scheduler" | "manual" = "scheduler", orgId?: string): Promise<ClientNotificationSweepResult> {
  let result: ClientNotificationSweepResult = {
    orgsScanned: 0, birthdayCount: 0, anniversaryCount: 0, premiumDueCount: 0, preLapseCount: 0, lapseCount: 0, errors: [],
  };
  let ran = false;
  await withAdvisoryLock(CLIENT_NOTIFICATION_SWEEP_LOCK_KEY, async () => {
    ran = true;
    result = await runSweepBody(trigger, orgId);
  });
  if (!ran) {
    structuredLog("warn", "Client notification sweep skipped — another run is already in progress", { trigger });
    return { ...result, skipped: true };
  }
  return result;
}

async function runSweepForOrg(orgId: string, result: ClientNotificationSweepResult): Promise<void> {
  // This org's own local "today", not the server's raw UTC clock — see date-utils.ts: a plain
  // `new Date()` mis-attributes anything in the window after local midnight (still "yesterday" in
  // UTC) to the wrong calendar day, which would skip or misfire birthday / anniversary / due-date
  // matching for a manual run that happens to land in that window (the scheduled 05:00 UTC run is
  // safely outside it for Harare-timezone orgs either way, but not guaranteed for every timezone).
  const todayStr = await todayForOrg(orgId);
  const todayYear = Number(todayStr.slice(0, 4));
  const org = await storage.getOrganization(orgId);

  const allClients = await storage.getClientsByOrg(orgId, 100000, 0);
  for (const c of allClients) {
    if (!c.dateOfBirth) continue;
    if (isSameMonthDay(c.dateOfBirth, todayStr)) {
      const [, mo, da] = String(c.dateOfBirth).slice(0, 10).split("-").map(Number);
      await dispatchNotification(orgId, "birthday", c.id, {
        clientName: `${c.firstName} ${c.lastName}`,
        firstName: c.firstName,
        lastName: c.lastName,
        birthdayName: `${c.firstName} ${c.lastName}`,
        birthdayDate: `${MONTH_NAMES[mo - 1]} ${da}`,
        orgName: org?.name,
      });
      result.birthdayCount++;
    }
  }

  const allPolicies = await storage.getPoliciesByOrg(orgId, 100000, 0);
  for (const p of allPolicies) {
    if (!p.clientId) continue;
    const ctx = await buildPolicyContext(p, orgId);

    if (p.inceptionDate) {
      const inceptionYear = Number(String(p.inceptionDate).slice(0, 4));
      if (isSameMonthDay(p.inceptionDate, todayStr) && inceptionYear < todayYear) {
        const years = todayYear - inceptionYear;
        await dispatchNotification(orgId, "anniversary", p.clientId, { ...ctx, anniversaryYears: String(years) });
        result.anniversaryCount++;
      }
    }

    if (p.status === "active" && p.currentCycleEnd) {
      const daysToEnd = daysBetween(todayStr, String(p.currentCycleEnd));
      if (daysToEnd === 3) {
        await dispatchNotification(orgId, "premium_due", p.clientId, ctx);
        result.premiumDueCount++;
      }
    }

    if ((p.status === "active" || p.status === "grace") && p.graceEndDate) {
      const daysToGrace = daysBetween(todayStr, String(p.graceEndDate));
      if (daysToGrace === 7 || daysToGrace === 3 || daysToGrace === 1) {
        await dispatchNotification(orgId, "pre_lapse_warning", p.clientId, ctx);
        result.preLapseCount++;
      } else if (daysToGrace <= 0 && p.status === "grace") {
        await dispatchNotification(orgId, "policy_lapsed", p.clientId, ctx);
        result.lapseCount++;
      }
    }

    const members = await storage.getPolicyMembers(p.id, orgId);
    for (const m of members as any[]) {
      if (!m.dependentId) continue;
      const dep = await storage.getDependent(m.dependentId, orgId);
      if (!dep?.dateOfBirth) continue;
      if (isSameMonthDay(dep.dateOfBirth, todayStr)) {
        const [, mo, da] = String(dep.dateOfBirth).slice(0, 10).split("-").map(Number);
        await dispatchNotification(orgId, "birthday", p.clientId, {
          ...ctx,
          birthdayName: `${dep.firstName} ${dep.lastName}`,
          birthdayDate: `${MONTH_NAMES[mo - 1]} ${da}`,
          memberName: `${dep.firstName} ${dep.lastName}`,
        });
        result.birthdayCount++;
      }
    }
  }
}

async function runSweepBody(trigger: "scheduler" | "manual", orgIdFilter?: string): Promise<ClientNotificationSweepResult> {
  const result: ClientNotificationSweepResult = {
    orgsScanned: 0, birthdayCount: 0, anniversaryCount: 0, premiumDueCount: 0, preLapseCount: 0, lapseCount: 0, errors: [],
  };
  const startedAt = Date.now();
  structuredLog("info", "Client notification sweep starting", { trigger, orgIdFilter });

  const orgs = orgIdFilter
    ? (await storage.getOrganization(orgIdFilter) ? [{ id: orgIdFilter }] : [])
    : await storage.getOrganizations();

  for (const org of orgs) {
    result.orgsScanned++;
    // Each org's own "today" (organizations.timezone) — computed per-org since tenants can be in
    // different timezones, not once for the whole sweep run.
    const todayStr = await todayForOrg(org.id);
    if (lastRunDateByOrg.get(org.id) === todayStr) {
      // Already sent today's date-based batch for this org (scheduled run, or an earlier
      // manual click) — re-running would double-send every matching birthday/anniversary/
      // premium-due/pre-lapse email, not just the ones that would've changed.
      result.orgsAlreadyRanToday = (result.orgsAlreadyRanToday ?? 0) + 1;
      continue;
    }
    try {
      await runSweepForOrg(org.id, result);
      lastRunDateByOrg.set(org.id, todayStr);
    } catch (err: any) {
      result.errors.push(`org ${org.id}: ${err?.message}`);
      structuredLog("error", "Client notification sweep: org processing failed", { orgId: org.id, error: err?.message });
    }
  }

  structuredLog("info", "Client notification sweep complete", { trigger, durationMs: Date.now() - startedAt, ...result });
  return result;
}

/** Daily at 05:00 UTC — staggered from the policy lapse sweep (04:00) and tenant billing sweep (06:00). */
export function startClientNotificationSweepScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const targetHour = 5;
    const next = new Date(now);
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntilRun = next.getTime() - now.getTime();

    structuredLog("info", "Client notification sweep scheduled", { nextRun: next.toISOString(), msUntilRun });

    sweepTimer = setTimeout(async () => {
      try {
        await runClientNotificationSweep("scheduler");
      } catch (err) {
        structuredLog("error", "Client notification sweep run threw", { error: (err as Error).message });
      }
      scheduleNext();
    }, msUntilRun);
  };
  scheduleNext();
}

export function stopClientNotificationSweepScheduler(): void {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
}
