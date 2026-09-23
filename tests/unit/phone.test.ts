import { describe, it, expect, afterEach } from "vitest";
import { normalizeMsisdn, isGsm7 } from "../../server/phone";

describe("normalizeMsisdn", () => {
  const orig = process.env.SMS_DEFAULT_COUNTRY_CODE;
  afterEach(() => {
    if (orig === undefined) delete process.env.SMS_DEFAULT_COUNTRY_CODE;
    else process.env.SMS_DEFAULT_COUNTRY_CODE = orig;
  });

  it("keeps an already-international +CC number, stripping punctuation", () => {
    expect(normalizeMsisdn("+27 82 123 4567")).toBe("27821234567");
    expect(normalizeMsisdn("+263 77 123 4567", "27")).toBe("263771234567");
  });

  it("treats a 00 prefix as an international access code", () => {
    expect(normalizeMsisdn("0027821234567")).toBe("27821234567");
  });

  it("prepends the caller-supplied country code to a local 0… number", () => {
    expect(normalizeMsisdn("0821234567", "27")).toBe("27821234567");
    expect(normalizeMsisdn("077 123 4567", "263")).toBe("263771234567");
  });

  it("is the whole bug fix: a South African local number no longer gets 263", () => {
    // Before: normalizeMsisdn("0821234567") -> "263821234567" (misdelivered)
    expect(normalizeMsisdn("0821234567", "27")).toBe("27821234567");
    expect(normalizeMsisdn("0821234567", "27")).not.toContain("263");
  });

  it("falls back to SMS_DEFAULT_COUNTRY_CODE, then 263, when no code is passed", () => {
    delete process.env.SMS_DEFAULT_COUNTRY_CODE;
    expect(normalizeMsisdn("0771234567")).toBe("263771234567");
    process.env.SMS_DEFAULT_COUNTRY_CODE = "44";
    expect(normalizeMsisdn("07712345678")).toBe("447712345678");
  });

  it("leaves a number that already carries a country code (no 0, no +) untouched", () => {
    expect(normalizeMsisdn("263771234567", "27")).toBe("263771234567");
  });

  it("does not mangle an over-length 0-prefixed string", () => {
    expect(normalizeMsisdn("0263771234567", "27")).toBe("0263771234567".replace(/\D/g, ""));
  });

  it("handles empty / junk input without throwing", () => {
    expect(normalizeMsisdn("")).toBe("");
    expect(normalizeMsisdn(undefined as any)).toBe("");
  });
});

/**
 * Africala messageEncoding: "0" = GSM-7 (~160 chars/segment), "1" = Unicode (~70, costlier).
 * The provider call hardcoded "1", doubling the cost of every plain-English notification;
 * Africala's own sample payload uses "0". isGsm7 drives the choice.
 */
describe("isGsm7", () => {
  it("accepts plain English notification text", () => {
    expect(isGsm7("Welcome, Adnan. Your policy 192121 with Hamdani is now active.")).toBe(true);
  });

  it("accepts GSM-7 punctuation and the currency/extension characters", () => {
    expect(isGsm7("Pay $5 (~5%) now: ref #A-1. Thanks!")).toBe(true);
    expect(isGsm7("Cost: €10 or £8")).toBe(true); // € £
  });

  it("rejects emoji", () => {
    expect(isGsm7("Policy active ✅")).toBe(false);
  });

  it("rejects curly quotes and en/em dashes", () => {
    expect(isGsm7("Your “policy” – now active")).toBe(false);
  });

  it("treats an empty message as GSM-7", () => {
    expect(isGsm7("")).toBe(true);
  });
});
