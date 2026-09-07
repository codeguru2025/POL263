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

import { dispatchNotification } from "../../server/notifications";

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

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011" });

    expect(mockSendSms).toHaveBeenCalledTimes(1);
    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ to: "0821234567", countryCode: "263" });
  });

  it("uses the flagged country code for a cross-border policy", async () => {
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: true, homeCountryCode: "263", flagCountryCode: "27",
    });
    mockStorage.getPolicy.mockResolvedValue({ id: "p1", isSouthAfrica: true });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011" });

    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ countryCode: "27" });
  });

  it("uses the home code (never looks at the policy) when country flagging is disabled", async () => {
    mockStorage.getCountryFlagSettings.mockResolvedValue({
      isEnabled: false, homeCountryCode: "263", flagCountryCode: "27",
    });

    await dispatchNotification("org1", "pre_lapse_warning", "c1", { policyId: "p1", policyNumber: "FLK00011" });

    expect(mockSendSms.mock.calls[0][1]).toMatchObject({ countryCode: "263" });
    expect(mockStorage.getPolicy).not.toHaveBeenCalled();
  });
});
