import { describe, it, expect, vi } from "vitest";
import { enforceTenantViewOnly } from "../../server/tenant-view-only";

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  return res;
}

describe("enforceTenantViewOnly", () => {
  it("passes through a non-view-only session unchanged", () => {
    const next = vi.fn();
    enforceTenantViewOnly({ user: { id: "u1" }, method: "POST", path: "/api/policies" } as any, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("allows GET for a view-only tenant", () => {
    const next = vi.fn();
    enforceTenantViewOnly({ user: { tenantViewOnly: true }, method: "GET", path: "/api/policies" } as any, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it("blocks POST for a view-only tenant with TENANT_VIEW_ONLY", () => {
    const next = vi.fn();
    const res = mockRes();
    enforceTenantViewOnly({ user: { tenantViewOnly: true }, method: "POST", path: "/api/policies" } as any, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe("TENANT_VIEW_ONLY");
  });

  it("blocks PATCH/PUT/DELETE too", () => {
    for (const method of ["PATCH", "PUT", "DELETE"]) {
      const next = vi.fn();
      const res = mockRes();
      enforceTenantViewOnly({ user: { tenantViewOnly: true }, method, path: "/api/x" } as any, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    }
  });

  it("always allows logout so a view-only user can sign out", () => {
    const next = vi.fn();
    enforceTenantViewOnly({ user: { tenantViewOnly: true }, method: "POST", path: "/api/auth/logout" } as any, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });
});
