/**
 * Phase 6 deletion lifecycle — runs as a step of the daily tenant-billing sweep (06:00 UTC).
 *
 * For every tenant the billing sweep has suspended (viewOnlyGraceUntil set):
 *   • ~7 days and ~1 day before the window closes → email the tenant admins a final warning
 *   • window elapsed:
 *       – billingSettings.hardDeleteEnabled ON  → purgeTenant() (irreversible)
 *       – OFF (default)                         → licenseStatus='pending_deletion' + notify the
 *                                                 platform owner to run the purge by hand
 *
 * Every step is guarded by a tenant_billing_events marker so it fires exactly once.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { cpDb } from "./control-plane-db";
import { tenants as cpTenants, billingSettings, tenantBillingEvents } from "@shared/control-plane-schema";
import { resolveTenantBillingRecipients } from "./tenant-billing-email";
import { sendEmail, isEmailConfigured } from "./email-service";
import { structuredLog } from "./logger";

const DAY = 24 * 60 * 60 * 1000;

async function alreadyDid(tenantId: string, type: string): Promise<boolean> {
  const [row] = await cpDb.select({ id: tenantBillingEvents.id }).from(tenantBillingEvents)
    .where(and(eq(tenantBillingEvents.tenantId, tenantId), eq(tenantBillingEvents.type, type))).limit(1);
  return !!row;
}
async function markDone(tenantId: string, type: string, detail: Record<string, unknown>): Promise<void> {
  await cpDb.insert(tenantBillingEvents).values({ tenantId, type, detail });
}

async function sendDeletionWarning(tenantId: string, tenantName: string, deleteOn: Date, daysLeft: number): Promise<void> {
  if (!isEmailConfigured()) return;
  const recipients = await resolveTenantBillingRecipients(tenantId);
  if (recipients.length === 0) return;
  const on = deleteOn.toLocaleDateString();
  await sendEmail({
    to: recipients.join(","),
    fromName: "POL263 Billing",
    subject: `${tenantName}: account data will be permanently deleted on ${on}`,
    text: `Your POL263 account has been suspended for non-payment. Unless the outstanding balance is settled, all of your data will be permanently deleted on ${on} (about ${daysLeft} day(s) from now) and cannot be recovered.\n\nSettle the balance from the link in your most recent invoice email to keep your account.`,
    html: `<p>Your POL263 account has been suspended for non-payment. Unless the outstanding balance is settled, <strong>all of your data will be permanently deleted on ${on}</strong> (about ${daysLeft} day(s) from now) and cannot be recovered.</p>
           <p>Settle the balance using the link in your most recent invoice email to keep your account.</p>`,
  });
}

async function notifyPlatformOwnerPendingDeletion(tenantName: string, tenantId: string): Promise<void> {
  const to = process.env.PLATFORM_OWNER_EMAIL;
  if (!to || !isEmailConfigured()) {
    structuredLog("warn", "Tenant past deletion grace — manual purge required (no PLATFORM_OWNER_EMAIL set)", { tenantId, tenantName });
    return;
  }
  await sendEmail({
    to, fromName: "POL263",
    subject: `Action required: ${tenantName} is ready for permanent deletion`,
    text: `${tenantName} (${tenantId}) has passed its 30-day view-only window. Review and run the purge from the platform tenant console (Danger zone → Delete permanently), or enable automatic deletion in Billing settings.`,
    html: `<p><strong>${tenantName}</strong> (<code>${tenantId}</code>) has passed its view-only window and is ready for permanent deletion.</p>
           <p>Run the purge from the platform tenant console (<em>Danger zone → Delete permanently</em>), or turn on automatic deletion in Billing settings.</p>`,
  });
}

export async function processTenantDeletionLifecycle(): Promise<{ warningsSent: number; pendingDeletion: number; purged: number }> {
  const out = { warningsSent: 0, pendingDeletion: 0, purged: 0 };
  const now = Date.now();

  const [settings] = await cpDb.select().from(billingSettings).where(eq(billingSettings.id, "global")).limit(1);
  const hardDeleteEnabled = !!settings?.hardDeleteEnabled;

  const candidates = await cpDb.select().from(cpTenants)
    .where(and(eq(cpTenants.isActive, false), isNotNull(cpTenants.viewOnlyGraceUntil)));

  for (const t of candidates) {
    try {
      if (t.licenseStatus === "purged") continue;
      const deleteOn = t.viewOnlyGraceUntil!;
      const msLeft = deleteOn.getTime() - now;

      // ── Warnings ──
      if (msLeft > 0) {
        if (msLeft <= 7 * DAY && !(await alreadyDid(t.id, "deletion_warning_7d"))) {
          await sendDeletionWarning(t.id, t.name, deleteOn, Math.ceil(msLeft / DAY));
          await markDone(t.id, "deletion_warning_7d", { deleteOn });
          out.warningsSent++;
        }
        if (msLeft <= 1 * DAY && !(await alreadyDid(t.id, "deletion_warning_1d"))) {
          await sendDeletionWarning(t.id, t.name, deleteOn, 1);
          await markDone(t.id, "deletion_warning_1d", { deleteOn });
          out.warningsSent++;
        }
        continue;
      }

      // ── Window elapsed ──
      if (hardDeleteEnabled) {
        const { purgeTenant } = await import("./tenant-purge");
        const res = await purgeTenant(t.id, { actorEmail: "system (auto-delete)" });
        out.purged++;
        structuredLog("warn", "Tenant auto-purged after view-only window", { tenantId: t.id, name: t.name, ...res });
      } else if (t.licenseStatus !== "pending_deletion") {
        await cpDb.update(cpTenants).set({ licenseStatus: "pending_deletion" }).where(eq(cpTenants.id, t.id));
        await markDone(t.id, "pending_deletion", { since: new Date().toISOString() });
        await notifyPlatformOwnerPendingDeletion(t.name, t.id);
        out.pendingDeletion++;
      }
    } catch (err) {
      structuredLog("error", "Tenant deletion lifecycle: per-tenant step failed", { tenantId: t.id, error: (err as Error).message });
    }
  }

  return out;
}
