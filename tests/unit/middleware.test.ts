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
import { requireAuth, requirePermission } from "../../server/auth";

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

  it("platform owner bypasses permission check entirely", async () => {
    const req = mockReq({ user: { id: "u1", organizationId: "org1", isPlatformOwner: true } });
    const res = mockRes();
    const next = vi.fn();
    await (requirePermission("delete:tenant") as any)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(storage.getUserEffectivePermissions).not.toHaveBeenCalled();
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
