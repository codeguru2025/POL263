import { describe, it, expect, vi, beforeEach } from "vitest";

// dispatchNotification pulls in storage (DB), email-service (SMTP), push, and module-gate —
// mock all of it, same pattern as tests/unit/middleware.test.ts. vi.mock factories are hoisted
// above top-level const declarations, so the mock fns must be created via vi.hoisted().
const { mockStorage, mockSendEmail, mockPushToClient, mockHasModule, mockSendSms } = vi.hoisted(() => ({
  mockStorage: {
    getOrganization: vi.fn(),
    getActiveTemplatesByEvent: vi.fn(),
    getClient: vi.fn(),
    createNotificationLog: vi.fn(),
    updateNotificationLogStatus: vi.fn(),
    updateNotificationLogDelivery: vi.fn(),
    getCountryFlagSettings: vi.fn(),
    getPolicy: vi.fn(),
  },
  mockSendEmail: vi.fn(),
  mockPushToClient: vi.fn(),
  mockHasModule: vi.fn(),
  mockSendSms: vi.fn(),
}));

vi.mock("../../server/storage", () => ({ storage: mockStorage }));
vi.mock("../../server/email-service", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  escapeHtml: (v: unknown) => String(v ?? ""),
}));
vi.mock("../../server/tenant-email-sending", () => ({
  resolveTenantEmailOverrides: async (_orgId: string, org: any) => (org?.emailFromAddress ? { from: org.emailFromAddress } : {}),
}));
vi.mock("../../server/push", () => ({ pushToClient: (...args: any[]) => mockPushToClient(...args) }));
vi.mock("../../server/module-gate", () => ({ hasModule: (...args: any[]) => mockHasModule(...args) }));
// sms-service now resolves per-org credentials via sms-config.ts -> control-plane-db.ts, which
// throws at import time if DATABASE_URL isn't set (not the case in this unit test process) —
// mock it out same as email/push above, rather than pulling in a real DB connection.
vi.mock("../../server/sms-service", () => ({
  sendSms: (...args: any[]) => mockSendSms(...args),
  normalizePhoneForSms: (v: string) => v,
}));

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { dispatchNotification, unfilledMergeTags, nextSmsRetryAt } from "../../server/notifications";

/**
 * Previously only "activation", "claim_status_change", and "kyc_status_change" emailed by
 * default when a tenant had no per-org template configured for the event — every other event
 * type (payments, lapses, pre-lapse warnings, etc.) was silently in-app-only. Fixed 2026-08-13
 * per Augustus's explicit request ("make sure mails are sent by default") — now any event type
 * with a DEFAULT_MESSAGES entry emails by default whenever the email_notifications module is on
 * and the client has an address on file, same as the 3 event types already did.
 */
describe("dispatchNotification — default-channel email", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getOrganization.mockResolvedValue({ id: "org1", name: "Test Org" });
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue([]); // no admin-configured template
    mockStorage.createNotificationLog.mockResolvedValue({ id: "log1" });
    mockStorage.updateNotificationLogStatus.mockResolvedValue(undefined);
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: false, flagLabel: "South Africa", homeLabel: "Zimbabwe", homeCountryCode: "263", flagCountryCode: "27",
    });
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: false });
    mockSendSms.mockResolvedValue({ ok: true, message: "sent" });
  });

  it("emails by default for an event type that previously was in-app-only (e.g. pre_lapse_warning)", async () => {
    mockHasModule.mockResolvedValue(true);
    mockStorage.getClient.mockResolvedValue({ id: "c1", email: "client@example.com", firstName: "Jane", lastName: "Doe" });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyNumber: "FLK00011", graceEnd: "2026-09-01" });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({ to: "client@example.com" });
  });

  it("also emails by default for policy_lapsed (another previously in-app-only event)", async () => {
    mockHasModule.mockResolvedValue(true);
    mockStorage.getClient.mockResolvedValue({ id: "c1", email: "client@example.com", firstName: "Jane", lastName: "Doe" });

    await dispatchNotification("org1", "policy_lapsed", "c1", { policyNumber: "FLK00011" });

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it("does not email when the email_notifications module is disabled for the tenant", async () => {
    mockHasModule.mockResolvedValue(false);
    mockStorage.getClient.mockResolvedValue({ id: "c1", email: "client@example.com" });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyNumber: "FLK00011" });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not email when the client has no address on file", async () => {
    mockHasModule.mockResolvedValue(true);
    mockStorage.getClient.mockResolvedValue({ id: "c1", email: null });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyNumber: "FLK00011" });

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not override an admin-configured template's own channel choice", async () => {
    mockHasModule.mockResolvedValue(true);
    // Admin explicitly configured an in-app-only template for this event.
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue([
      { id: "t1", channel: "in_app", subject: "Custom subject", bodyTemplate: "Custom body {client_name}" },
    ]);

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyNumber: "FLK00011" });

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(mockStorage.getClient).not.toHaveBeenCalled();
  });
});

/**
 * A recipient number saved in local "0…" format needs a country dial code prepended before the
 * SMS provider can route it. That code must reflect the recipient's country, not a single global
 * default — a cross-border tenant (Falakhe: Zimbabwe + South Africa) otherwise misdelivers.
 * The SMS branch passes country_flag_settings' flag/home code based on the notified policy's
 * cross-border flag; server/phone.ts does the actual prepending.
 */
describe("dispatchNotification — SMS recipient country code", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getOrganization.mockResolvedValue({ id: "org1", name: "Test Org" });
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0821234567", firstName: "Jane", lastName: "Doe" });
    mockStorage.createNotificationLog.mockResolvedValue({ id: "log1" });
    mockStorage.updateNotificationLogStatus.mockResolvedValue(undefined);
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: false });
    mockSendSms.mockResolvedValue({ ok: true, message: "sent" });
    mockHasModule.mockResolvedValue(true);
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue([
      { id: "t-sms", channel: "sms", subject: "", bodyTemplate: "Hi {first_name}" },
    ]);
  });

  it("uses the home country code for a non-flagged policy", async () => {
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: true, homeCountryCode: "263", flagCountryCode: "27",
    });
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: false });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011", firstName: "Jane" });

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ to: "0821234567", countryCode: "263" });
  });

  it("uses the flagged country code for a cross-border policy", async () => {
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: true, homeCountryCode: "263", flagCountryCode: "27",
    });
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: true });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011", firstName: "Jane" });

    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ countryCode: "27" });
  });

  it("uses the home code (never looks at the policy) when country flagging is disabled", async () => {
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: false, homeCountryCode: "263", flagCountryCode: "27",
    });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011", firstName: "Jane" });

    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ countryCode: "263" });
    expect(mockStorage.getPolicy).not.toHaveBeenCalled();
  });
});

/**
 * SMS edge cases: a template whose tag has no value must never reach the client as a literal
 * "{tag}", and every early exit must correct the optimistic "sent" log row (nothing was sent).
 */
describe("dispatchNotification — SMS edge cases", () => {
  const smsTmpl = (body: string) => [{ id: "t1", channel: "sms", subject: "s", bodyTemplate: body }];
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasModule.mockResolvedValue(true);
    mockStorage.getOrganization.mockResolvedValue({ id: "org1", name: "Test Org" });
    mockStorage.createNotificationLog.mockResolvedValue({ id: "log1" });
    mockStorage.updateNotificationLogStatus.mockResolvedValue(undefined);
    mockStorage.getCountryFlagSettings.mockResolvedValue({ isEnabled: false, homeCountryCode: "263", flagCountryCode: "27" });
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: false });
    mockSendSms.mockResolvedValue({ ok: true, message: "sent" });
  });

  it("sends a fully-rendered SMS and leaves the log as sent", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Code {activation_code}"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0771234567" });
    await dispatchNotification("org1", "activation", "c1", { activationCode: "ACT-1" });
    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1].message).toBe("Code ACT-1");
    expect(mockStorage.updateNotificationLogStatus).not.toHaveBeenCalled();
  });

  it("does NOT send when a merge tag has no value, and marks the log skipped", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Code {activation_code}"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0771234567" });
    await dispatchNotification("org1", "activation", "c1", {}); // client has no activation code
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockStorage.updateNotificationLogStatus).toHaveBeenCalledWith("org1", "log1", "skipped", expect.stringContaining("{activation_code}"));
  });

  it("marks the log skipped (not sent) when the client has no phone number", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Hi {client_name}"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: null });
    await dispatchNotification("org1", "policy_capture", "c1", { clientName: "Jane" });
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockStorage.updateNotificationLogStatus).toHaveBeenCalledWith("org1", "log1", "skipped", expect.stringContaining("phone"));
  });

  it("marks the log skipped when the sms_notifications module is off", async () => {
    mockHasModule.mockImplementation(async (_o: string, m: string) => m !== "sms_notifications");
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Hi"));
    await dispatchNotification("org1", "policy_capture", "c1", {});
    expect(mockSendSms).not.toHaveBeenCalled();
    expect(mockStorage.updateNotificationLogStatus).toHaveBeenCalledWith("org1", "log1", "skipped", expect.any(String));
  });

  it("still marks the log failed when the provider rejects the send", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Hi"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0771234567" });
    mockSendSms.mockResolvedValue({ ok: false, message: "Africala SMS failed: Ip Address Not Allowed" });
    await dispatchNotification("org1", "policy_capture", "c1", {});
    // A per-recipient rejection is final — no retry scheduled.
    expect(mockStorage.updateNotificationLogDelivery).toHaveBeenCalledWith("org1", "log1", expect.objectContaining({
      status: "failed", failureReason: expect.stringContaining("Ip Address"), nextRetryAt: null,
    }));
  });

  it("queues a retry (instead of dropping the text) when the failure is temporary", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Hi"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0771234567" });
    mockSendSms.mockResolvedValue({ ok: false, message: "SMS is paused for about a minute", retryable: true });
    const before = Date.now();
    await dispatchNotification("org1", "policy_capture", "c1", {});
    const patch = mockStorage.updateNotificationLogDelivery.mock.calls.at(-1)[2];
    expect(patch).toMatchObject({ status: "failed", attempts: 1 });
    expect(patch.nextRetryAt.getTime()).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000);
  });

  it("tags the send so it shows up correctly in the SMS usage report", async () => {
    mockStorage.getActiveTemplatesByEvent.mockResolvedValue(smsTmpl("Hi"));
    mockStorage.getClient.mockResolvedValue({ id: "c1", phone: "0771234567" });
    mockSendSms.mockResolvedValue({ ok: true, message: "sent" });
    await dispatchNotification("org1", "policy_capture", "c1", {});
    expect(mockSendSms).toHaveBeenCalledWith("org1", expect.objectContaining({
      meta: { source: "notification", eventType: "policy_capture", clientId: "c1", notificationLogId: "log1" },
    }));
  });
});

describe("nextSmsRetryAt", () => {
  it("backs off 5m, 15m, 30m, 1h, 2h, 4h, then gives up", () => {
    const t0 = new Date("2026-09-24T10:00:00Z");
    const mins = [1, 2, 3, 4, 5, 6].map((n) => (nextSmsRetryAt(n, t0)!.getTime() - t0.getTime()) / 60_000);
    expect(mins).toEqual([5, 15, 30, 60, 120, 240]);
    expect(nextSmsRetryAt(7, t0)).toBeNull();
  });
});

describe("unfilledMergeTags", () => {
  it("finds leftover tags once each, ignores ordinary braces-free text", () => {
    expect(unfilledMergeTags("a {x_y} b {x_y} c {z}")).toEqual(["{x_y}", "{z}"]);
    expect(unfilledMergeTags("Dear Jane, policy FLK1 is active.")).toEqual([]);
  });
});
