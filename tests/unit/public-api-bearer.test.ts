import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";

process.env.TENANT_CONFIG_ENCRYPTION_KEY =
  process.env.TENANT_CONFIG_ENCRYPTION_KEY || "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const h = vi.hoisted(() => ({ rows: [] as any[] }));

vi.mock("../../server/control-plane-db", () => {
  const chain = (): any => {
    const p: any = Promise.resolve(h.rows);
    p.from = () => chain();
    p.where = () => chain();
    p.limit = () => Promise.resolve(h.rows);
    return p;
  };
  return {
    cpDb: {
      select: () => chain(),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      insert: () => ({ values: () => Promise.resolve() }),
    },
    cpPool: { end: vi.fn() },
  };
});

vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { isPublicApiBearerPath, authenticatePublicApiBearerToken } from "../../server/public-api-bearer";

const ORG_A = "11111111-1111-1111-1111-111111111111";
const ORG_B = "22222222-2222-2222-2222-222222222222";
const SECRET_A = "secret-for-diaspora";
const SECRET_B = "secret-for-a-different-tenant";

beforeAll(() => {
  process.env.TENANT_CONFIG_ENCRYPTION_KEY = "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
});

beforeEach(() => {
  h.rows = [
    { id: "int-1", tenantId: ORG_A, provider: "public_api", isActive: true, config: { secret: SECRET_A } },
    { id: "int-2", tenantId: ORG_B, provider: "public_api", isActive: true, config: { secret: SECRET_B } },
  ];
});

describe("isPublicApiBearerPath", () => {
  it("matches the exact public quote, register-policy, and funeral-request paths", () => {
    expect(isPublicApiBearerPath("/api/public/quote")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/register-policy")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/funeral-request")).toBe(true);
  });

  it("matches any agent-vcard sub-path (quote-lead, track, etc.)", () => {
    expect(isPublicApiBearerPath("/api/public/agent-vcard/AGT123/quote-lead")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/agent-vcard/AGT123/track")).toBe(true);
  });

  it("matches the sibling estimate path and the fetch-by-id sub-path", () => {
    expect(isPublicApiBearerPath("/api/public/funeral-request-estimate")).toBe(true);
    expect(isPublicApiBearerPath("/api/public/funeral-request/some-quotation-id")).toBe(true);
  });

  it("does not match an unrelated path that merely shares a string prefix", () => {
    expect(isPublicApiBearerPath("/api/public/funeral-requestXYZ")).toBe(false);
  });

  it("does not match unrelated public or private routes", () => {
    expect(isPublicApiBearerPath("/api/public/branding")).toBe(false);
    expect(isPublicApiBearerPath("/api/policies")).toBe(false);
    expect(isPublicApiBearerPath("/api/public/quote-extra")).toBe(false);
  });
});

describe("authenticatePublicApiBearerToken", () => {
  it("resolves the correct tenant for that tenant's own secret", async () => {
    const result = await authenticatePublicApiBearerToken(`Bearer ${SECRET_A}`);
    expect(result).toEqual({ orgId: ORG_A });
  });

  it("a different tenant's secret resolves to that different tenant, not the first row", async () => {
    const result = await authenticatePublicApiBearerToken(`Bearer ${SECRET_B}`);
    expect(result).toEqual({ orgId: ORG_B });
  });

  it("is null when no header is present", async () => {
    expect(await authenticatePublicApiBearerToken(undefined)).toBeNull();
  });

  it("is null when the header is malformed", async () => {
    expect(await authenticatePublicApiBearerToken(`Basic ${SECRET_A}`)).toBeNull();
  });

  it("is null when the secret doesn't match any tenant", async () => {
    expect(await authenticatePublicApiBearerToken("Bearer not-a-real-secret")).toBeNull();
  });

  it("is null when no tenant has a credential row at all", async () => {
    h.rows = [];
    expect(await authenticatePublicApiBearerToken(`Bearer ${SECRET_A}`)).toBeNull();
  });
});
