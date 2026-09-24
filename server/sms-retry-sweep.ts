/**
 * Retries notification SMS that failed for a TEMPORARY reason — provider down, sending paused by
 * the circuit breaker, SMS allowance used up (see SmsSendResult.retryable). Previously those were
 * simply dropped: a pre-lapse warning that hit a provider outage never reached the client.
 *
 * Runs every 5 minutes under a pg advisory lock (one instance at a time). Each failed log row
 * carries next_retry_at; backoff is 5m → 15m → 30m → 1h → 2h → 4h (notifications.nextSmsRetryAt),
 * and nothing older than 24 hours is retried — a day-old "payment received" or "premium due"
 * text is more confusing than useful. A tenant whose allowance is used up is skipped entirely
 * (without spending attempts) until credits are added.
 */
import { storage } from "./storage";
import { structuredLog } from "./logger";
import { withAdvisoryLock } from "./advisory-lock";
import { sendSms } from "./sms-service";
import { getSmsAllowance } from "./sms-allocation";
import { nextSmsRetryAt, resolveSmsCountryCode, SMS_MAX_ATTEMPTS } from "./notifications";
import { hasModule } from "./module-gate";

const SMS_RETRY_SWEEP_LOCK_KEY = 9_002_630_006;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const PER_ORG_BATCH = 200;

export interface SmsRetrySweepResult { orgsScanned: number; retried: number; delivered: number; gaveUp: number }

export async function runSmsRetrySweep(now: Date = new Date()): Promise<SmsRetrySweepResult> {
  const result: SmsRetrySweepResult = { orgsScanned: 0, retried: 0, delivered: 0, gaveUp: 0 };
  await withAdvisoryLock(SMS_RETRY_SWEEP_LOCK_KEY, async () => {
    const orgs = await storage.getOrganizations();
    for (const org of orgs) {
      result.orgsScanned++;
      try {
        await retryForOrg(org.id, now, result);
      } catch (err: any) {
        structuredLog("error", "SMS retry sweep failed for org", { orgId: org.id, error: err?.message });
      }
    }
  });
  if (result.retried > 0) structuredLog("info", "SMS retry sweep complete", { ...result });
  return result;
}

async function retryForOrg(orgId: string, now: Date, result: SmsRetrySweepResult): Promise<void> {
  const notBefore = new Date(now.getTime() - RETRY_WINDOW_MS);
  result.gaveUp += await storage.expireStaleSmsNotificationRetries(orgId, notBefore);
  const due = await storage.getDueSmsNotificationRetries(orgId, now, notBefore, PER_ORG_BATCH);
  if (due.length === 0) return;

  // Allowance used up — leave every row queued (attempts untouched) until credits are added,
  // rather than burning through the backoff schedule on sends that can't happen.
  const allowance = await getSmsAllowance(orgId);
  if (allowance.metered && allowance.enforced && allowance.remaining <= 0) return;

  // SMS switched off for this tenant since the original attempt — stop retrying.
  const smsAllowed = await hasModule(orgId, "sms_notifications");

  for (const log of due) {
    const attempts = (log.attempts ?? 0) + 1;
    if (!smsAllowed || !log.recipientId || !log.body) {
      await storage.updateNotificationLogDelivery(orgId, log.id, {
        status: "failed", attempts: attempts - 1, nextRetryAt: null,
        failureReason: !smsAllowed ? "SMS notifications were switched off before this could be retried" : log.failureReason,
      });
      result.gaveUp++;
      continue;
    }
    const client = await storage.getClient(log.recipientId, orgId);
    if (!client?.phone) {
      await storage.updateNotificationLogDelivery(orgId, log.id, {
        status: "skipped", attempts: attempts - 1, nextRetryAt: null, failureReason: "Client has no phone number on file",
      });
      result.gaveUp++;
      continue;
    }

    result.retried++;
    const send = await sendSms(orgId, {
      to: client.phone,
      message: log.body,
      kind: "transactional",
      countryCode: await resolveSmsCountryCode(orgId, log.policyId),
      meta: { source: "notification", clientId: client.id, notificationLogId: log.id },
    });
    if (send.ok) {
      await storage.updateNotificationLogDelivery(orgId, log.id, {
        status: "sent", failureReason: null, attempts, nextRetryAt: null, sentAt: new Date(),
      });
      result.delivered++;
      continue;
    }
    const next = send.retryable && attempts < SMS_MAX_ATTEMPTS ? nextSmsRetryAt(attempts, now) : null;
    await storage.updateNotificationLogDelivery(orgId, log.id, {
      status: "failed",
      attempts,
      nextRetryAt: next,
      failureReason: next ? send.message : `${send.message} (gave up after ${attempts} attempts)`,
    });
    if (!next) result.gaveUp++;
    // Allowance ran out mid-batch — the rest would be refused the same way.
    if (send.blocked) return;
  }
}

let timer: NodeJS.Timeout | null = null;

export function startSmsRetryScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runSmsRetrySweep().catch((err) => structuredLog("error", "SMS retry sweep threw", { error: err?.message }));
  }, SWEEP_INTERVAL_MS);
  timer.unref();
}

export function stopSmsRetryScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
