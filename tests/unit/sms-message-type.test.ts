import { describe, it, expect, vi, afterEach } from "vitest";

// sms-service imports sms-config -> control-plane-db, which needs a live DB at import time.
vi.mock("../../server/sms-config", () => ({ getOrgSmsConfig: vi.fn(), platformConfig: vi.fn() }));
vi.mock("../../server/user-notifications", () => ({ notifyUsersWithPermission: vi.fn() }));

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
