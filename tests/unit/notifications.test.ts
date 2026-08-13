import { describe, it, expect, vi, beforeEach } from "vitest";

// dispatchNotification pulls in storage (DB), email-service (SMTP), push, and module-gate —
// mock all of it, same pattern as tests/unit/middleware.test.ts. vi.mock factories are hoisted
// above top-level const declarations, so the mock fns must be created via vi.hoisted().
const { mockStorage, mockSendEmail, mockPushToClient, mockHasModule } = vi.hoisted(() => ({
  mockStorage: {
    getOrganization: vi.fn(),
    getActiveTemplatesByEvent: vi.fn(),
    getClient: vi.fn(),
    createNotificationLog: vi.fn(),
  },
  mockSendEmail: vi.fn(),
  mockPushToClient: vi.fn(),
  mockHasModule: vi.fn(),
}));

vi.mock("../../server/storage", () => ({ storage: mockStorage }));
vi.mock("../../server/email-service", () => ({
  sendEmail: (...args: any[]) => mockSendEmail(...args),
  escapeHtml: (v: unknown) => String(v ?? ""),
}));
vi.mock("../../server/push", () => ({ pushToClient: (...args: any[]) => mockPushToClient(...args) }));
vi.mock("../../server/module-gate", () => ({ hasModule: (...args: any[]) => mockHasModule(...args) }));

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
    mockStorage.createNotificationLog.mockResolvedValue(undefined);
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
