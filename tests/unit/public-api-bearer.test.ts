import { describe, it, expect } from "vitest";
import { isPublicApiBearerPath, hasValidPublicApiBearerToken } from "../../server/public-api-bearer";

describe("isPublicApiBearerPath", () => {
  it("matches the exact public quote and register-policy paths", () => {
    expect(isPublicApiBearerPath("/api/public/quote")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/register-policy")).toBe(true);
  });

  it("matches any agent-vcard sub-path (quote-lead, track, etc.)", () => {
    expect(isPublicApiBearerPath("/api/public/agent-vcard/AGT123/quote-lead")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/agent-vcard/AGT123/track")).toBe(true);
  });

  it("does not match unrelated public or private routes", () => {
    expect(isPublicApiBearerPath("/api/public/branding")).toBe(false);
    expect(isPublicApiBearerPath("/api/policies")).toBe(false);
    expect(isPublicApiBearerPath("/api/public/quote-extra")).toBe(false);
  });
});

describe("hasValidPublicApiBearerToken", () => {
  it("is false when no token is configured — inert by default", () => {
    expect(hasValidPublicApiBearerToken("Bearer anything", undefined)).toBe(false);
  });

  it("is false when the header is missing or malformed", () => {
    expect(hasValidPublicApiBearerToken(undefined, "secret123")).toBe(false);
    expect(hasValidPublicApiBearerToken("Basic secret123", "secret123")).toBe(false);
  });

  it("is false when the token doesn't match", () => {
    expect(hasValidPublicApiBearerToken("Bearer wrong", "secret123")).toBe(false);
  });

  it("is true when the token matches exactly", () => {
    expect(hasValidPublicApiBearerToken("Bearer secret123", "secret123")).toBe(true);
  });

  it("does not throw on a differently-sized token (timing-safe length guard)", () => {
    expect(hasValidPublicApiBearerToken("Bearer short", "a-much-longer-configured-secret")).toBe(false);
  });
});
