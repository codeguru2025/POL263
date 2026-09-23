import { describe, it, expect, vi } from "vitest";

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { normalizeInboundMessage, SmsalaInboundAdapter } from "../../server/customer-service-inbound";

describe("normalizeInboundMessage (SMSALA adapter — STUB pending real payload)", () => {
  it("produces the normalized internal shape from a plausible payload", () => {
    const raw = {
      phone_number_id: "PN_123",
      to: "263000000000",
      messages: [{ id: "wamid.abc", from: "263771789932", text: { body: "Hi" }, timestamp: "1735680000" }],
    };
    const n = normalizeInboundMessage(raw);
    expect(n).toEqual({
      channelId: "PN_123",
      channelType: "whatsapp",
      from: "263771789932",
      to: "263000000000",
      messageId: "wamid.abc",
      text: "Hi",
      timestamp: 1735680000 * 1000,
    });
  });

  it("returns null for a payload with no sender", () => {
    expect(normalizeInboundMessage({ messages: [{ text: { body: "x" } }] })).toBeNull();
  });

  it("returns null for unrecognized garbage", () => {
    expect(normalizeInboundMessage("not json")).toBeNull();
    expect(normalizeInboundMessage(null)).toBeNull();
    expect(normalizeInboundMessage({ unrelated: true })).toBeNull();
  });

  it("defaults timestamp to now() when absent", () => {
    const before = Date.now();
    const n = normalizeInboundMessage({ from: "263771789932", text: "hey" });
    expect(n).not.toBeNull();
    expect(n!.timestamp).toBeGreaterThanOrEqual(before);
  });

  it("adapter name is 'smsala'", () => {
    expect(SmsalaInboundAdapter.name).toBe("smsala");
  });
});
