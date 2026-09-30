import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/email-service", () => ({ sendEmail: vi.fn(), escapeHtml: (s: string) => s }));
vi.mock("../../server/push", () => ({ pushToClient: vi.fn() }));
vi.mock("../../server/tenant-email-sending", () => ({ resolveTenantEmailOverrides: vi.fn() }));
vi.mock("../../server/sms-service", () => ({ sendSms: vi.fn() }));
vi.mock("../../server/module-gate", () => ({ hasModule: vi.fn() }));

import { toGsm7, isGsm7, countSmsSegments, smsTemplateWorstCase } from "../../shared/sms-text";
import { DEFAULT_SMS_MESSAGES, EVENT_TYPES } from "../../server/notifications";

describe("toGsm7 — keeps look-alike characters from doubling what a text costs", () => {
  it("swaps curly quotes, dashes, ellipses and odd spaces for plain ones", () => {
    const out = toGsm7("Claim CLM-1 is now: Approved — payment “being” processed… O’Brien");
    expect(out).toBe('Claim CLM-1 is now: Approved - payment "being" processed... O\'Brien');
    expect(isGsm7(out)).toBe(true);
  });

  it("strips accents that GSM-7 lacks but keeps the ones it has", () => {
    expect(toGsm7("Renée Côté Ünal")).toBe("Renée Coté Ünal"); // é, Ü are GSM-7; ô → o
  });

  it("leaves emoji alone (no plain equivalent) and plain text untouched", () => {
    expect(toGsm7("Paid ✅")).toBe("Paid ✅");
    expect(toGsm7("Hello there")).toBe("Hello there");
  });

  it("one em dash turns a 1-credit text into 2 without it, 1 with it", () => {
    const text = "Tendai, claim CLM-000123 is now: Approved — payment being processed. We are with you.";
    expect(countSmsSegments(text)).toBe(2);
    expect(countSmsSegments(toGsm7(text))).toBe(1);
  });
});

describe("built-in SMS wording", () => {
  it("every event has short SMS wording", () => {
    for (const e of EVENT_TYPES) expect(DEFAULT_SMS_MESSAGES[e.value], e.value).toBeTruthy();
  });

  it("every message costs 1 credit even with the longest realistic names", () => {
    for (const [event, body] of Object.entries(DEFAULT_SMS_MESSAGES)) {
      const w = smsTemplateWorstCase(body);
      expect(w.unicode, event).toBe(false);
      expect(w.segments, `${event} worst case ${w.length} chars`).toBe(1);
    }
  });

  it("flags a wordy template as more than 1 credit", () => {
    const wordy = "Dear {client_name}, your payment of {payment_amount} for policy {policy_number} has been received and receipted. Thank you for staying current. {org_name}";
    expect(smsTemplateWorstCase(wordy).segments).toBe(2);
  });
});
