/**
 * Daily tenant billing sweep: generates upcoming renewal invoices, transitions
 * lapsed subscriptions to past_due, and auto-suspends anyone past their grace
 * deadline. Same self-rescheduling setTimeout shape as server/backup-sync.ts.
 *
 * This is the highest-blast-radius piece of the billing feature — it's the only
 * code path that can suspend a real tenant automatically. It only ever moves a
 * subscription TOWARD suspension; restoration is exclusively
 * applyTenantInvoicePayment's job (server/tenant-billing-service.ts), which runs
 * immediately at payment-clearance time rather than waiting for the next sweep.
 * This one-directional split avoids the sweep and the payment-clearance path
 * racing over subscription.status.
 */
import { eq, and, inArray } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, billingPlans, tenantSubscriptions, tenantInvoices, tenantBillingEvents } from "@shared/control-plane-schema";
import { generateInvoiceForSubscription, getEffectiveGraceDays, getBillingSettings } from "./tenant-billing-service";
import { sendInvoiceReminderEmail, sendGracePeriodEmail, sendSuspendedEmail } from "./tenant-billing-email";
import { invalidateTenantActiveCache } from "./auth";
import { invalidateTenantModuleCache } from "./module-gate";
import { structuredLog } from "./logger";

let sweepTimer: NodeJS.Timeout | null = null;

export interface SweepResult {
  invoicesGenerated: number;
  pastDueTransitions: number;
  autoSuspensions: number;
  errors: string[];
}

export async function runTenantBillingSweep(trigger: "scheduler" | "manual" = "scheduler"): Promise<SweepResult> {
  const result: SweepResult = { invoicesGenerated: 0, pastDueTransitions: 0, autoSuspensions: 0, errors: [] };
  const startedAt = new Date();
  structuredLog("info", "Tenant billing sweep starting", { trigger });

  const settings = await getBillingSettings();
  const now = new Date();
  const reminderCutoff = new Date(now.getTime() + settings.reminderLeadDays * 24 * 60 * 60 * 1000);

  const subscriptions = await cpDb.select().from(tenantSubscriptions).where(inArray(tenantSubscriptions.status, ["trialing", "active", "past_due"]));

  for (const sub of subscriptions) {
    try {
      // Step 1: reminder + invoice generation. currentPeriodEnd IS trialEndsAt while
      // trialing, so this is the exact same code path for trial expiry and renewals.
      if (sub.currentPeriodEnd.getTime() <= reminderCutoff.getTime()) {
        const [plan] = await cpDb.select().from(billingPlans).where(eq(billingPlans.id, sub.planId)).limit(1);
        if (plan) {
          const { invoice, created } = await generateInvoiceForSubscription(sub, plan);
          if (created) {
            result.invoicesGenerated++;
            await sendInvoiceReminderEmail(invoice);
          }
        } else {
          structuredLog("error", "Tenant billing sweep: subscription references missing plan", { subscriptionId: sub.id, planId: sub.planId });
        }
      }

      // Step 2: past-due transition. Runs after step 1 in the same pass so there's
      // always a payable open invoice by the time a subscription is flagged past-due.
      if (sub.currentPeriodEnd.getTime() <= now.getTime() && sub.status !== "past_due") {
        await cpDb.update(tenantSubscriptions).set({ status: "past_due", updatedAt: now }).where(eq(tenantSubscriptions.id, sub.id));
        await cpDb.insert(tenantBillingEvents).values({ tenantId: sub.tenantId, type: "past_due", detail: { currentPeriodEnd: sub.currentPeriodEnd } });
        result.pastDueTransitions++;

        const graceDays = getEffectiveGraceDays(sub, settings);
        const graceDeadline = new Date(sub.currentPeriodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
        const [openInvoice] = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.subscriptionId, sub.id), eq(tenantInvoices.status, "open"))).limit(1);
        if (openInvoice) await sendGracePeriodEmail(openInvoice, graceDeadline);

        sub.status = "past_due"; // keep the in-loop copy consistent for the auto-suspend check below
      }

      // Step 3: auto-suspend. Sweep only ever moves TOWARD suspension — see file header.
      if (sub.status === "past_due") {
        const graceDays = getEffectiveGraceDays(sub, settings);
        const graceDeadline = new Date(sub.currentPeriodEnd.getTime() + graceDays * 24 * 60 * 60 * 1000);
        if (graceDeadline.getTime() <= now.getTime()) {
          await cpDb.update(tenantSubscriptions).set({ status: "suspended", updatedAt: now }).where(eq(tenantSubscriptions.id, sub.id));
          await cpDb.update(cpTenants).set({
            isActive: false,
            licenseStatus: "suspended",
            suspendedAt: now,
            suspendReason: "Auto-suspended: payment not received within grace period",
          }).where(eq(cpTenants.id, sub.tenantId));
          invalidateTenantActiveCache(sub.tenantId);
          invalidateTenantModuleCache(sub.tenantId);
          await cpDb.insert(tenantBillingEvents).values({ tenantId: sub.tenantId, type: "auto_suspended", detail: { graceDeadline } });
          result.autoSuspensions++;

          const [openInvoice] = await cpDb.select().from(tenantInvoices).where(and(eq(tenantInvoices.subscriptionId, sub.id), eq(tenantInvoices.status, "open"))).limit(1);
          if (openInvoice) await sendSuspendedEmail(openInvoice);
        }
      }
    } catch (err) {
      const msg = `subscription ${sub.id}: ${(err as Error).message}`;
      result.errors.push(msg);
      structuredLog("error", "Tenant billing sweep: subscription processing failed", { subscriptionId: sub.id, tenantId: sub.tenantId, error: (err as Error).message });
    }
  }

  structuredLog("info", "Tenant billing sweep complete", { trigger, durationMs: Date.now() - startedAt.getTime(), ...result });
  return result;
}

/** Daily at 06:00 UTC — staggered from the 22:00 UTC backup scheduler. */
export function startTenantBillingSweepScheduler(): void {
  const scheduleNext = () => {
    const now = new Date();
    const targetHour = 6;
    const next = new Date(now);
    next.setUTCHours(targetHour, 0, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    const msUntilRun = next.getTime() - now.getTime();

    structuredLog("info", "Tenant billing sweep scheduled", { nextRun: next.toISOString(), msUntilRun });

    sweepTimer = setTimeout(async () => {
      try {
        await runTenantBillingSweep("scheduler");
      } catch (err) {
        structuredLog("error", "Tenant billing sweep run threw", { error: (err as Error).message });
      }
      scheduleNext();
    }, msUntilRun);
  };
  scheduleNext();
}

export function stopTenantBillingSweepScheduler(): void {
  if (sweepTimer) {
    clearTimeout(sweepTimer);
    sweepTimer = null;
  }
}
