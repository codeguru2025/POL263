import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/db", () => ({ pool: {}, db: {} }));
vi.mock("../../server/control-plane-db", () => ({ cpDb: {} }));
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/logger", () => ({
  structuredLog: vi.fn(),
  requestIdMiddleware: vi.fn(),
}));
vi.mock("connect-pg-simple", () => ({ default: () => class PgStore {} }));
vi.mock("../../server/storage", () => ({
  storage: {
    getUserEffectivePermissions: vi.fn(),
    getUserRoles: vi.fn(),
    getUser: vi.fn(),
    getUserByGoogleId: vi.fn(),
    getUserByEmail: vi.fn(),
    getOrganization: vi.fn(),
    updateUser: vi.fn(),
    createUser: vi.fn(),
  },
}));
vi.mock("@shared/control-plane-schema", () => ({ tenants: {} }));

import { requireTenantScope } from "../../server/auth";

function makeReq(opts: {
  userId?: string;
  userOrgId?: string | null;
  isPlatformOwner?: boolean;
  activeTenantId?: string;
  xTenantId?: string;
  tenantId?: string;
}) {
  const user: any = {
    id: opts.userId ?? "u1",
    organizationId: opts.userOrgId ?? null,
    isPlatformOwner: opts.isPlatformOwner ?? false,
    isActive: true,
  };
  return {
    user,
    session: { activeTenantId: opts.activeTenantId },
    headers: opts.xTenantId ? { "x-tenant-id": opts.xTenantId } : {},
    tenantId: opts.tenantId,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireTenantScope — org access control", () => {
  it("allows access when user has an organizationId", () => {
    const req = makeReq({ userOrgId: "org1" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 403 when non-owner has no org assigned", () => {
    const req = makeReq({ userOrgId: null, isPlatformOwner: false });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 with SELECT_TENANT code when platform owner has no activeTenantId", () => {
    const req = makeReq({ isPlatformOwner: true, userOrgId: null, activeTenantId: undefined });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "NO_TENANT_SELECTED" }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it("allows platform owner access when activeTenantId is set in session", () => {
    const req = makeReq({ isPlatformOwner: true, userOrgId: null, activeTenantId: "org2" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("platform owner with activeTenantId has organizationId overridden to that tenant", () => {
    const req = makeReq({ isPlatformOwner: true, userOrgId: "org1", activeTenantId: "org2" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect((req as any).user.organizationId).toBe("org2");
  });
});

describe("requireTenantScope — X-Tenant-ID header validation", () => {
  it("allows request with no X-Tenant-ID header", () => {
    const req = makeReq({ userOrgId: "org1" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("allows request when X-Tenant-ID matches session org", () => {
    const req = makeReq({ userOrgId: "org1", xTenantId: "org1" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks non-owner when X-Tenant-ID points to a different org (cross-tenant attack)", () => {
    const req = makeReq({ userOrgId: "org1", xTenantId: "org2", isPlatformOwner: false });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("platform owner can send any X-Tenant-ID (tenant switching use case)", () => {
    const req = makeReq({ isPlatformOwner: true, activeTenantId: "org1", xTenantId: "org99" });
    const res = mockRes();
    const next = vi.fn();
    (requireTenantScope as any)(req, res, next);
    // Platform owner bypasses the header mismatch guard
    expect(next).toHaveBeenCalled();
  });
});
