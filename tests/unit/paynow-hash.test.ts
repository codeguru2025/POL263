import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { verifyPaynowHash, generatePaynowHash } from "../../server/paynow-hash";

describe("Paynow hash", () => {
  const originalKey = process.env.PAYNOW_INTEGRATION_KEY;

  beforeEach(() => {
    process.env.PAYNOW_INTEGRATION_KEY = "test-integration-key";
  });

  afterEach(() => {
    process.env.PAYNOW_INTEGRATION_KEY = originalKey;
  });

  it("generates a non-empty hash when key is set", () => {
    const hash = generatePaynowHash({ id: "1", reference: "REF-001", amount: "10.00" });
    expect(hash).toBeTruthy();
    expect(hash).toMatch(/^[0-9A-F]+$/);
  });

  it("verifyPaynowHash accepts a payload with the correct hash", () => {
    const params = { reference: "REF-001", status: "paid", amount: "10.00" };
    const hash = generatePaynowHash(params);
    const payload = { ...params, hash };
    expect(verifyPaynowHash(payload)).toBe(true);
  });

  it("verifyPaynowHash rejects a payload with wrong hash", () => {
    const payload = { reference: "REF-001", status: "paid", amount: "10.00", hash: "WRONGHASH" };
    expect(verifyPaynowHash(payload)).toBe(false);
  });

  it("verifyPaynowHash returns false when hash key is missing", () => {
    expect(verifyPaynowHash({ reference: "REF-001", status: "paid" })).toBe(false);
  });

  it("verifyPaynowHash excludes 'hash' from concatenation (case-insensitive)", () => {
    const params = { reference: "R", status: "paid", hash: "ignored" };
    const correctHash = generatePaynowHash({ reference: "R", status: "paid" });
    expect(verifyPaynowHash({ ...params, hash: correctHash })).toBe(true);
  });

  it("verifyPaynowHash accepts hash generated with order-of-appearance (non-alphabetical)", () => {
    const key = process.env.PAYNOW_INTEGRATION_KEY!;
    // Simulate Paynow sending fields in non-alphabetical order: status, reference, amount
    const fields = { status: "Paid", reference: "REF-002", amount: "25.00" };
    const concat = "Paid" + "REF-002" + "25.00" + key;
    const hash = require("crypto").createHash("sha512").update(concat).digest("hex").toUpperCase();
    expect(verifyPaynowHash({ ...fields, hash })).toBe(true);
  });
});
