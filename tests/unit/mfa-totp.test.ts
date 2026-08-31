import { describe, it, expect } from "vitest";
import { generateSecret, generateSync } from "otplib";
import { verifyTotpCode, TOTP_EPOCH_TOLERANCE_SEC } from "../../server/totp";

/**
 * Regression test for the MFA-login failure: otplib v13's verify() defaults to
 * epochTolerance:0 (rejects any code not in the server's exact 30s window). verifyTotpCode()
 * must allow ±1 step so a code read/typed a few seconds late — or from a slightly drifted
 * phone clock — still passes. See docs/BUGFIX-LOG.md.
 */
describe("verifyTotpCode — clock-skew tolerance", () => {
  const secret = generateSecret();
  const realNow = Date.now();

  /** Generate the code that a device would show at (now + offsetMs). */
  function tokenAt(offsetMs: number): string {
    const D = Date.now;
    Date.now = () => realNow + offsetMs;
    try {
      return generateSync({ secret });
    } finally {
      Date.now = D;
    }
  }

  it("tolerance is exactly one 30s step", () => {
    expect(TOTP_EPOCH_TOLERANCE_SEC).toBe(30);
  });

  it("accepts the current-window code", async () => {
    expect(await verifyTotpCode(secret, tokenAt(0))).toBe(true);
  });

  it("accepts a code from the PREVIOUS window (slow phone / slow typing across a boundary)", async () => {
    expect(await verifyTotpCode(secret, tokenAt(-35_000))).toBe(true);
  });

  it("accepts a code from the NEXT window (fast phone)", async () => {
    expect(await verifyTotpCode(secret, tokenAt(+35_000))).toBe(true);
  });

  it("rejects a code two windows in the past", async () => {
    expect(await verifyTotpCode(secret, tokenAt(-95_000))).toBe(false);
  });

  it("rejects a code two windows in the future", async () => {
    expect(await verifyTotpCode(secret, tokenAt(+95_000))).toBe(false);
  });

  it("rejects a wrong code", async () => {
    const wrong = tokenAt(0) === "000000" ? "111111" : "000000";
    expect(await verifyTotpCode(secret, wrong)).toBe(false);
  });

  it("rejects empty / malformed input without throwing", async () => {
    expect(await verifyTotpCode(secret, "")).toBe(false);
    expect(await verifyTotpCode(secret, "   ")).toBe(false);
    expect(await verifyTotpCode(secret, "abc")).toBe(false);
    expect(await verifyTotpCode("", "123456")).toBe(false);
    expect(await verifyTotpCode(null, null)).toBe(false);
    expect(await verifyTotpCode(undefined as any, undefined as any)).toBe(false);
  });

  it("trims surrounding whitespace on the submitted code", async () => {
    expect(await verifyTotpCode(secret, `  ${tokenAt(0)}  `)).toBe(true);
  });
});
