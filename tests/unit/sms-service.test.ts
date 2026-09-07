import { describe, it, expect, vi } from "vitest";

// isGsm7 is a pure function, but importing sms-service pulls in sms-config -> control-plane-db,
// which throws at import time without a DATABASE_URL — mock it out, same pattern as
// tests/unit/email-domain-provisioning.test.ts.
vi.mock("../../server/control-plane-db", () => ({ cpDb: {} }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));
vi.mock("@shared/control-plane-schema", () => ({ tenantIntegrations: {} }));

import { isGsm7 } from "../../server/sms-service";

/**
 * Africala's messageEncoding: "0" = plain GSM-7 (~160 chars/segment), "1" = Unicode
 * (~70 chars/segment, higher cost). The code hardcoded "1", doubling the cost of every
 * plain-English notification; Africala's own sample payload uses "0". isGsm7 drives the choice.
 */
describe("isGsm7", () => {
  it("accepts plain English notification text", () => {
    expect(isGsm7("Welcome, Adnan. Your policy 192121 with Hamdani is now active.")).toBe(true);
  });

  it("accepts GSM-7 punctuation and the currency/extension characters", () => {
    expect(isGsm7("Pay $5 / R80 (~5%) now: ref #A-1. Thanks!")).toBe(true);
    expect(isGsm7("Cost: €10 or £8")).toBe(true);
  });

  it("rejects emoji", () => {
    expect(isGsm7("Policy active ✅")).toBe(false);
  });

  it("rejects curly/smart quotes and en/em dashes", () => {
    expect(isGsm7("Your “policy” – now active")).toBe(false);
  });

  it("handles empty string", () => {
    expect(isGsm7("")).toBe(true);
  });
});
