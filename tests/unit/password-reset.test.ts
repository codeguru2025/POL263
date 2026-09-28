import { describe, it, expect } from "vitest";
import {
  createResetToken,
  verifyResetToken,
  isFingerprintCurrent,
  createResetCode,
  verifyResetCode,
  resetLinkOrigin,
  RESET_LINK_TTL_MS,
} from "../../server/password-reset";

const subject = { kind: "client" as const, id: "c-1", orgId: "o-1", passwordHash: "$argon2id$old" };

describe("password reset link tokens", () => {
  it("round-trips and binds to the current password hash", () => {
    const token = createResetToken(subject);
    const v = verifyResetToken(token, "client");
    expect(v).toMatchObject({ id: "c-1", orgId: "o-1" });
    expect(isFingerprintCurrent(v!.fp, "$argon2id$old")).toBe(true);
    // Once the password changes the same link is dead — single use.
    expect(isFingerprintCurrent(v!.fp, "$argon2id$new")).toBe(false);
  });

  it("works for accounts that have no password yet", () => {
    const v = verifyResetToken(createResetToken({ ...subject, passwordHash: null }), "client");
    expect(isFingerprintCurrent(v!.fp, null)).toBe(true);
    expect(isFingerprintCurrent(v!.fp, "$argon2id$set")).toBe(false);
  });

  it("rejects expired, tampered, wrong-kind and junk tokens", () => {
    const now = Date.now();
    const token = createResetToken(subject, now);
    expect(verifyResetToken(token, "client", now + RESET_LINK_TTL_MS + 1)).toBeNull();
    expect(verifyResetToken(token, "agent")).toBeNull();

    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), id: "c-2" })).toString("base64url");
    expect(verifyResetToken(`${forged}.${sig}`, "client")).toBeNull();
    expect(verifyResetToken(`${body}.${sig.slice(0, -2)}AA`, "client")).toBeNull();
    for (const junk of [undefined, null, "", "abc", ".", "a.b", 42]) expect(verifyResetToken(junk, "client")).toBeNull();
  });
});

describe("password reset SMS codes", () => {
  it("is a 6-digit code valid for the current and previous window only", () => {
    const t0 = 1_800_000_000_000;
    const code = createResetCode("client", "c-1", "h", t0);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyResetCode("client", "c-1", "h", code, t0)).toBe(true);
    expect(verifyResetCode("client", "c-1", "h", ` ${code} `, t0 + 10 * 60 * 1000)).toBe(true);
    expect(verifyResetCode("client", "c-1", "h", code, t0 + 25 * 60 * 1000)).toBe(false);
  });

  it("is bound to the account and dies when the password changes", () => {
    const t0 = 1_800_000_000_000;
    const code = createResetCode("client", "c-1", "h", t0);
    expect(verifyResetCode("client", "c-2", "h", code, t0)).toBe(false);
    expect(verifyResetCode("agent", "c-1", "h", code, t0)).toBe(false);
    expect(verifyResetCode("client", "c-1", "h2", code, t0)).toBe(false);
    expect(verifyResetCode("client", "c-1", "h", "12345", t0)).toBe(false);
    expect(verifyResetCode("client", "c-1", "h", undefined, t0)).toBe(false);
  });
});

describe("resetLinkOrigin", () => {
  const req = { protocol: "https", get: (h: string) => (h === "host" ? "evil.example" : undefined) };

  it("never trusts the Host header in production", () => {
    const prev = { base: process.env.APP_BASE_URL, env: process.env.NODE_ENV };
    try {
      delete process.env.APP_BASE_URL;
      process.env.NODE_ENV = "production";
      expect(resetLinkOrigin(req)).toBeNull();
      process.env.APP_BASE_URL = "https://app.pol263.com/";
      expect(resetLinkOrigin(req)).toBe("https://app.pol263.com");
    } finally {
      if (prev.base === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = prev.base;
      process.env.NODE_ENV = prev.env;
    }
  });
});
