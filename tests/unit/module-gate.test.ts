import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/control-plane-db", () => ({ cpDb: { select: vi.fn() } }));
vi.mock("../../server/logger", () => ({ structuredLog: vi.fn() }));

import { cpDb } from "../../server/control-plane-db";
import { hasModule, requireModule, invalidateTenantModuleCache, invalidateEnforcementCache } from "../../server/module-gate";

/**
 * hasModule() issues up to 3 sequential cpDb.select(...) calls in order:
 *   1. billingSettings (enforcement kill switch)
 *   2. tenantFeatureFlags (per-tenant override)
 *   3. tenantSubscriptions/billingPlans join (the plan's module list)
 * queueResults() lets each test declare exactly what each call in that
 * sequence resolves to, in order.
 */
function queueResults(...resultSets: any[][]) {
  const queue = [...resultSets];
  vi.mocked(cpDb.select).mockImplementation(() => {
    const rows = queue.shift() ?? [];
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(rows),
    };
    return chain;
  });
}

let orgCounter = 0;
function freshOrgId(): string {
  orgCounter++;
  return `org-module-gate-test-${orgCounter}`;
}

describe("hasModule", () => {
  beforeEach(() => {
    invalidateEnforcementCache();
    vi.mocked(cpDb.select).mockReset();
  });

  it("returns true with no tenant scope (no orgId)", async () => {
    expect(await hasModule(undefined, "claims")).toBe(true);
    expect(cpDb.select).not.toHaveBeenCalled();
  });

  it("returns true (global bypass) when the enforcement kill switch is off", async () => {
    queueResults([{ moduleEnforcementEnabled: false }]);
    expect(await hasModule(freshOrgId(), "claims")).toBe(true);
  });

  it("returns true when no billingSettings row exists yet (enforcement defaults off)", async () => {
    queueResults([]);
    expect(await hasModule(freshOrgId(), "claims")).toBe(true);
  });

  it("an explicit tenantFeatureFlags override wins over the plan, in both directions", async () => {
    const orgId = freshOrgId();
    queueResults([{ moduleEnforcementEnabled: true }], [{ enabled: true }]);
    expect(await hasModule(orgId, "claims")).toBe(true);

    invalidateEnforcementCache();
    const orgId2 = freshOrgId();
    queueResults([{ moduleEnforcementEnabled: true }], [{ enabled: false }]);
    expect(await hasModule(orgId2, "claims")).toBe(false);
  });

  it("a trialing subscription gets every module regardless of the assigned plan", async () => {
    const orgId = freshOrgId();
    queueResults(
      [{ moduleEnforcementEnabled: true }], // enforcement on
      [], // no override
      [{ status: "trialing", modules: ["expenditures"] }], // plan doesn't include "claims", but trialing bypasses
    );
    expect(await hasModule(orgId, "claims")).toBe(true);
  });

  it("an active subscription is gated by the plan's module list", async () => {
    const orgId = freshOrgId();
    queueResults(
      [{ moduleEnforcementEnabled: true }],
      [],
      [{ status: "active", modules: ["claims", "funeral_ops"] }],
    );
    expect(await hasModule(orgId, "claims")).toBe(true);

    invalidateEnforcementCache();
    const orgId2 = freshOrgId();
    queueResults(
      [{ moduleEnforcementEnabled: true }],
      [],
      [{ status: "active", modules: ["claims", "funeral_ops"] }],
    );
    expect(await hasModule(orgId2, "payroll")).toBe(false);
  });

  it("fails open when no subscription row exists at all (pre-migration tenant)", async () => {
    const orgId = freshOrgId();
    queueResults([{ moduleEnforcementEnabled: true }], [], []);
    expect(await hasModule(orgId, "claims")).toBe(true);
  });

  it("fails open when the control-plane lookup throws", async () => {
    const orgId = freshOrgId();
    vi.mocked(cpDb.select).mockImplementation(() => {
      throw new Error("connection refused");
    });
    expect(await hasModule(orgId, "claims")).toBe(true);
  });
});

describe("requireModule middleware", () => {
  beforeEach(() => {
    invalidateEnforcementCache();
    vi.mocked(cpDb.select).mockReset();
  });

  function mockReqRes(user: any) {
    const req: any = { user };
    const json = vi.fn();
    const status = vi.fn(() => ({ json }));
    const res: any = { status };
    const next = vi.fn();
    return { req, res, next, status, json };
  }

  it("bypasses entirely when there is no authenticated user", async () => {
    const { req, res, next } = mockReqRes(undefined);
    await requireModule("claims")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(cpDb.select).not.toHaveBeenCalled();
  });

  it("bypasses entirely for the platform owner", async () => {
    const { req, res, next } = mockReqRes({ isPlatformOwner: true, organizationId: freshOrgId() });
    await requireModule("claims")(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(cpDb.select).not.toHaveBeenCalled();
  });

  it("calls next() when the module is included", async () => {
    queueResults([{ moduleEnforcementEnabled: false }]);
    const { req, res, next } = mockReqRes({ organizationId: freshOrgId() });
    await requireModule("claims")(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("responds 403 MODULE_NOT_INCLUDED when the module is excluded", async () => {
    queueResults([{ moduleEnforcementEnabled: true }], [], [{ status: "active", modules: [] }]);
    const { req, res, next, status, json } = mockReqRes({ organizationId: freshOrgId() });
    await requireModule("payroll")(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: "MODULE_NOT_INCLUDED", module: "payroll" }));
  });
});

describe("invalidateTenantModuleCache", () => {
  it("forces a fresh lookup instead of serving a stale cached result", async () => {
    const orgId = freshOrgId();
    invalidateEnforcementCache();
    queueResults([{ moduleEnforcementEnabled: true }], [], [{ status: "active", modules: [] }]);
    expect(await hasModule(orgId, "claims")).toBe(false);

    // Without invalidation, the 5-minute cache would serve the stale "false" result even
    // though the plan below now includes "claims" — invalidateTenantModuleCache() must
    // force the next call to re-query.
    invalidateEnforcementCache();
    invalidateTenantModuleCache(orgId);
    queueResults([{ moduleEnforcementEnabled: true }], [], [{ status: "active", modules: ["claims"] }]);
    expect(await hasModule(orgId, "claims")).toBe(true);
  });
});
