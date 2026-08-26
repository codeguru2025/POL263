import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all modules that touch the database or have side effects
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

import { storage } from "../../server/storage";
import { requireAuth, requirePermission, requireAnyPermission, applyPlatformOwnerTenantOverride } from "../../server/auth";

function mockReq(overrides: Record<string, any> = {}) {
  const user = overrides.user;
  return {
    user,
    session: { activeTenantId: undefined, ...overrides.session },
    headers: {},
    isAuthenticated: () => !!user,
    ...overrides,
  };
}

function mockRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("requireAuth middleware", () => {
  it("returns 401 when no user in session", () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    (requireAuth as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when isAuthenticated returns false", () => {
    const req = mockReq();
    (req as any).isAuthenticated = () => false;
    (req as any).user = { id: "u1" };
    const res = mockRes();
    const next = vi.fn();
    (requireAuth as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next when user is authenticated", () => {
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isActive: true } });
    const res = mockRes();
    const next = vi.fn();
    (requireAuth as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("requirePermission middleware", () => {
  beforeEach(() => {
    vi.mocked(storage.getUserEffectivePermissions).mockReset();
  });

  it("returns 401 when not authenticated", async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("read:policy") as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when user lacks the required permission", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:policy"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isActive: true } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("delete:policy") as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next when user has the required permission", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:policy", "delete:policy"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isActive: true } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("delete:policy") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("platform owner bypasses the permission check entirely, but still needs MFA", async () => {
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isPlatformOwner: true, mfaEnabled: true } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("delete:tenant") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(storage.getUserEffectivePermissions).not.toHaveBeenCalled();
  });

  it("blocks a platform owner without MFA enrolled, even though they'd otherwise bypass RBAC", async () => {
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isPlatformOwner: true, mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("delete:tenant") as any)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MFA_REQUIRED" }));
  });

  it("blocks manage:settings without MFA enrolled, even with the permission granted", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["manage:settings"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("manage:settings") as any)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MFA_REQUIRED" }));
  });

  it("allows manage:settings once MFA is enrolled", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["manage:settings"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", mfaEnabled: true } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("manage:settings") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("does not require MFA for a permission outside the privileged set", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:policy"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("read:policy") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("requires ALL permissions when multiple are specified", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:policy"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1" } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("read:policy", "write:policy") as any)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("calls next when user has all of multiple required permissions", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:policy", "write:policy"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1" } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("read:policy", "write:policy") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});

describe("requireAnyPermission middleware", () => {
  beforeEach(() => {
    vi.mocked(storage.getUserEffectivePermissions).mockReset();
  });

  it("calls next when the user holds one of the listed permissions", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:reports"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1" } });
    const res = mockRes();
    const next = vi.fn();
    await (requireAnyPermission("manage:settings", "read:reports") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks with MFA_REQUIRED only when the permission that actually granted access is privileged", async () => {
    // Only read:reports is held — manage:settings never granted this request, so MFA shouldn't
    // gate it even though manage:settings is in the requested set.
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["read:reports"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requireAnyPermission("manage:settings", "read:reports") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks manage:users without MFA when that's the permission that actually granted access", async () => {
    vi.mocked(storage.getUserEffectivePermissions).mockResolvedValue(["manage:users"]);
    const req = mockReq({ user: { id: "u1", organizationId: "org1", mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requireAnyPermission("manage:users", "read:reports") as any)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: "MFA_REQUIRED" }));
  });

  it("platform owner bypass still requires MFA", async () => {
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isPlatformOwner: true, mfaEnabled: false } });
    const res = mockRes();
    const next = vi.fn();
    await (requireAnyPermission("read:reports") as any)(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

const PLATFORM_OWNER_EMAIL = "ausiziba@gmail.com";

describe("applyPlatformOwnerTenantOverride", () => {
  it("scopes the owner to the tenant resolved from the request's subdomain, overriding a stale session.activeTenantId", () => {
    const req = mockReq({
      user: { id: "owner", email: PLATFORM_OWNER_EMAIL, organizationId: "org-stale" },
      session: { activeTenantId: "org-ifalakhe" },
      tenantId: "org-kings-and-queens",
    });
    applyPlatformOwnerTenantOverride(req as any);
    expect((req.user as any).organizationId).toBe("org-kings-and-queens");
    expect((req.session as any).activeTenantId).toBe("org-kings-and-queens");
    expect((req.user as any).isPlatformOwner).toBe(true);
  });

  it("falls back to session.activeTenantId when there is no subdomain-resolved tenant (bare base domain / controlpanel host)", () => {
    const req = mockReq({
      user: { id: "owner", email: PLATFORM_OWNER_EMAIL, organizationId: "org-stale" },
      session: { activeTenantId: "org-ifalakhe" },
    });
    applyPlatformOwnerTenantOverride(req as any);
    expect((req.user as any).organizationId).toBe("org-ifalakhe");
  });

  it("does not touch organizationId for a non-owner user, regardless of the request's subdomain", () => {
    const req = mockReq({
      user: { id: "staff1", email: "staff@falakhe.example", organizationId: "org-falakhe" },
      tenantId: "org-kings-and-queens",
    });
    applyPlatformOwnerTenantOverride(req as any);
    expect((req.user as any).organizationId).toBe("org-falakhe");
    expect((req.user as any).isPlatformOwner).toBeUndefined();
  });
});
