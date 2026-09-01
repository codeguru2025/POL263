import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { verifyTurnstileToken, isTurnstileConfigured } from "../../server/turnstile";

describe("Turnstile verification", () => {
  const originalSecret = process.env.TURNSTILE_SECRET_KEY;
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env.TURNSTILE_SECRET_KEY = originalSecret;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("is not configured and no-ops when TURNSTILE_SECRET_KEY is unset", async () => {
    delete process.env.TURNSTILE_SECRET_KEY;
    expect(isTurnstileConfigured()).toBe(false);
    const result = await verifyTurnstileToken(undefined, "1.2.3.4");
    expect(result.ok).toBe(true);
  });

  it("is configured and rejects a missing token when a secret key is set", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    expect(isTurnstileConfigured()).toBe(true);
    const result = await verifyTurnstileToken(undefined, "1.2.3.4");
    expect(result.ok).toBe(false);
  });

  it("fails closed when Cloudflare reports the token invalid", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: false, "error-codes": ["invalid-input-response"] }),
    }) as any;
    const result = await verifyTurnstileToken("bad-token", "1.2.3.4");
    expect(result.ok).toBe(false);
  });

  it("accepts a valid token", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({ success: true }),
    }) as any;
    const result = await verifyTurnstileToken("good-token", "1.2.3.4");
    expect(result.ok).toBe(true);
  });

  it("fails open when the siteverify request itself errors", async () => {
    process.env.TURNSTILE_SECRET_KEY = "test-secret";
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as any;
    const result = await verifyTurnstileToken("some-token", "1.2.3.4");
    expect(result.ok).toBe(true);
  });
});
