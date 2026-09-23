import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGetOrgSmsConfig, mockNotify } = vi.hoisted(() => ({
  mockGetOrgSmsConfig: vi.fn(),
  mockNotify: vi.fn(),
}));

// sms-service -> sms-config -> control-plane-db needs a live DB at import time; user-notifications
// pulls in storage. Mock both, same pattern as sms-message-type.test.ts / notifications.test.ts.
vi.mock("../../server/sms-config", () => ({ getOrgSmsConfig: mockGetOrgSmsConfig, platformConfig: vi.fn() }));
vi.mock("../../server/user-notifications", () => ({ notifyUsersWithPermission: (...a: any[]) => mockNotify(...a) }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { sendSms, resetSmsHealthState } from "../../server/sms-service";

const mockFetch = vi.fn();
const reply = (code: number, status: string, remarks = "") => ({
  ok: true, status: 200,
  json: async () => [{ MessageId: code === 0 ? 1 : null, OperationCode: code, Status: status, Remarks: remarks }],
});
const OK = () => reply(0, "Success", "Message Submitted");
const NO_IP = () => reply(-3, "Failed", "Ip Address Not Allowed");
const NO_CREDIT = () => reply(-2, "Failed", "Insufficient Credit Balance");
const BAD_NUMBER = () => reply(-10, "Failed", "Invalid destination");
const send = () => sendSms("org1", { to: "0771234567", message: "hi", kind: "transactional" });

describe("SMS circuit breaker + account-issue alert", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", mockFetch);
    mockFetch.mockReset();
    mockNotify.mockReset();
    mockGetOrgSmsConfig.mockResolvedValue({ provider: "africala", apiToken: "tok", senderId: "POL263", enabled: true });
    resetSmsHealthState();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens after 3 consecutive account-level failures and stops calling the provider", async () => {
    mockFetch.mockImplementation(async () => NO_IP());
    for (let i = 0; i < 3; i++) expect((await send()).accountIssue).toBe("ip");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const paused = await send();
    expect(paused.ok).toBe(false);
    expect(paused.message).toMatch(/paused/i);
    expect(mockFetch).toHaveBeenCalledTimes(3); // no 4th request
  });

  it("lets one probe through after the cooldown", async () => {
    mockFetch.mockImplementation(async () => NO_IP());
    for (let i = 0; i < 4; i++) await send();
    expect(mockFetch).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(61_000);
    mockFetch.mockImplementation(async () => OK());
    expect((await send()).ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("a success resets the failure count", async () => {
    mockFetch.mockImplementationOnce(async () => NO_IP()).mockImplementationOnce(async () => NO_IP()).mockImplementationOnce(async () => OK());
    await send(); await send(); await send();
    mockFetch.mockImplementation(async () => NO_IP());
    await send(); await send(); // only 2 since the reset — must not be open yet
    await send();
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });

  it("does not trip on per-recipient rejections (bad number)", async () => {
    mockFetch.mockImplementation(async () => BAD_NUMBER());
    for (let i = 0; i < 6; i++) {
      const r = await send();
      expect(r.ok).toBe(false);
      expect(r.accountIssue).toBeUndefined();
    }
    expect(mockFetch).toHaveBeenCalledTimes(6);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it("counts network errors toward the breaker", async () => {
    mockFetch.mockImplementation(async () => { throw new Error("timeout"); });
    for (let i = 0; i < 4; i++) await send();
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("alerts staff with manage:settings once per interval for an out-of-credit account", async () => {
    mockFetch.mockImplementation(async () => NO_CREDIT());
    await send();
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0]).toBe("org1");
    expect(mockNotify.mock.calls[0][1]).toBe("manage:settings");
    expect(mockNotify.mock.calls[0][2].title).toMatch(/out of credit/i);

    await send(); // same issue again inside the window — no second alert
    expect(mockNotify).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1000); // past the interval (and the breaker cooldown)
    await send();
    expect(mockNotify).toHaveBeenCalledTimes(2);
  });

  it("does not alert on success", async () => {
    mockFetch.mockImplementation(async () => OK());
    await send();
    expect(mockNotify).not.toHaveBeenCalled();
  });
});
