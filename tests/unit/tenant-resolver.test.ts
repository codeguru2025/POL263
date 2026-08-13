import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory fake for the control-plane tables this middleware queries.
const tenantsBySlug: Record<string, string> = { falakhe: "org-falakhe" };
const domainsByHost: Record<string, string> = { "portal.acme.co.zw": "org-acme" };

vi.mock("../../server/control-plane-db", () => ({ cpDb: {} }));
vi.mock("@shared/control-plane-schema", () => ({ tenants: { slug: "slug" }, tenantDomains: { domain: "domain" } }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

// eq() just needs to be a stable marker object carrying enough info for our fake select to read.
vi.mock("drizzle-orm", () => ({ eq: (col: any, val: any) => ({ col, val }) }));

vi.mock("../../server/control-plane-db", () => ({
  cpDb: {
    select: () => ({
      from: (table: any) => ({
        where: (cond: any) => ({
          limit: async () => {
            if (table.slug) {
              const id = tenantsBySlug[cond.val];
              return id ? [{ id }] : [];
            }
            const tenantId = domainsByHost[cond.val];
            return tenantId ? [{ tenantId }] : [];
          },
        }),
      }),
    }),
  },
}));

import { tenantResolverMiddleware, clearTenantCache } from "../../server/tenant-resolver";

function mockReq(hostname: string, overrides: Record<string, any> = {}) {
  return { hostname, headers: {}, ...overrides } as any;
}

describe("tenantResolverMiddleware", () => {
  beforeEach(() => {
    clearTenantCache();
    process.env.APP_BASE_DOMAIN = "pol263.app";
    process.env.PLATFORM_ADMIN_SUBDOMAIN = "controlpanel";
  });

  it("resolves a subdomain that matches a real tenant slug", async () => {
    const req = mockReq("falakhe.pol263.app");
    const next = vi.fn();
    await tenantResolverMiddleware(req, {} as any, next);
    expect(req.tenantId).toBe("org-falakhe");
    expect(next).toHaveBeenCalled();
  });

  it("does NOT fall back to the session tenant for an unrecognized subdomain", async () => {
    const req = mockReq("kingsandqueens.pol263.app", { user: { organizationId: "org-falakhe" } });
    const next = vi.fn();
    await tenantResolverMiddleware(req, {} as any, next);
    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("does NOT fall back to the session tenant for an unrecognized custom domain", async () => {
    const req = mockReq("random-domain.example.com", { user: { organizationId: "org-falakhe" } });
    const next = vi.fn();
    await tenantResolverMiddleware(req, {} as any, next);
    expect(req.tenantId).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("still falls back to the session tenant on the bare base domain (OAuth callback path)", async () => {
    const req = mockReq("pol263.app", { user: { organizationId: "org-falakhe" } });
    const next = vi.fn();
    await tenantResolverMiddleware(req, {} as any, next);
    expect(req.tenantId).toBe("org-falakhe");
    expect(next).toHaveBeenCalled();
  });

  it("resolves a known custom domain", async () => {
    const req = mockReq("portal.acme.co.zw");
    const next = vi.fn();
    await tenantResolverMiddleware(req, {} as any, next);
    expect(req.tenantId).toBe("org-acme");
    expect(next).toHaveBeenCalled();
  });
});
