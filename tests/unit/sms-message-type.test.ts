import { describe, it, expect, vi, afterEach } from "vitest";

// sms-service imports sms-config -> control-plane-db, which needs a live DB at import time.
vi.mock("../../server/sms-config", () => ({ getOrgSmsConfig: vi.fn(), platformConfig: vi.fn() }));
vi.mock("../../server/user-notifications", () => ({ notifyUsersWithPermission: vi.fn() }));
// sendSms now meters against the platform SMS allowance and logs every send — stubbed here.
vi.mock("../../server/sms-allocation", () => ({
  countSmsSegments: () => 1,
  reserveSmsCredits: async () => ({ ok: true, metered: false, charged: 0 }),
  refundSmsCredits: async () => undefined,
}));
vi.mock("../../server/storage", () => ({ storage: { createSmsMessage: async () => undefined } }));

import { isOtpOnlySender } from "../../server/sms-service";

describe("isOtpOnlySender", () => {
  afterEach(() => { delete process.env.SMS_OTP_ONLY_SENDERS; });

  it("treats FALAKHE as OTP-only regardless of case/whitespace", () => {
    expect(isOtpOnlySender("FALAKHE")).toBe(true);
    expect(isOtpOnlySender(" Falakhe ")).toBe(true);
  });

  it("leaves other senders on their normal message type", () => {
    expect(isOtpOnlySender("POL263")).toBe(false);
  });

  it("honours SMS_OTP_ONLY_SENDERS for additional senders", () => {
    process.env.SMS_OTP_ONLY_SENDERS = "acme, other";
    expect(isOtpOnlySender("ACME")).toBe(true);
    expect(isOtpOnlySender("other")).toBe(true);
    expect(isOtpOnlySender("POL263")).toBe(false);
  });
});
