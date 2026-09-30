import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockStorage } = vi.hoisted(() => ({
  mockStorage: {
    getPolicy: vi.fn(), getClient: vi.fn(), isClientAccessibleByAgent: vi.fn(), getClaim: vi.fn(),
    getLead: vi.fn(), getPaymentReceiptById: vi.fn(), getGroup: vi.fn(),
    getPermissions: vi.fn(), getRolePermissions: vi.fn(), getUserEffectivePermissions: vi.fn(),
  },
}));
vi.mock("../../server/storage", () => ({ storage: mockStorage }));
vi.mock("../../server/tenant-db", () => ({ resolveOrSyncTenantUserId: async (_o: string, id: string) => id }));

import { agentOwns } from "../../server/agent-scope-guard";
import { roleAssignmentError, manageUserError } from "../../server/role-assignment-guard";

describe("agentOwns — agents only reach their own records", () => {
  beforeEach(() => vi.clearAllMocks());
  it("policy: own vs someone else's vs missing", async () => {
    mockStorage.getPolicy.mockResolvedValueOnce({ agentId: "a1" });
    expect(await agentOwns("policy", "p1", "a1", "o")).toBe(true);
    mockStorage.getPolicy.mockResolvedValueOnce({ agentId: "a2" });
    expect(await agentOwns("policy", "p1", "a1", "o")).toBe(false);
    mockStorage.getPolicy.mockResolvedValueOnce(undefined);
    expect(await agentOwns("policy", "p1", "a1", "o")).toBe(null);
  });
  it("claim and receipt follow their policy's agent", async () => {
    mockStorage.getClaim.mockResolvedValue({ policyId: "p1" });
    mockStorage.getPolicy.mockResolvedValue({ agentId: "a2" });
    expect(await agentOwns("claim", "c1", "a1", "o")).toBe(false);
    mockStorage.getPaymentReceiptById.mockResolvedValue({ policyId: "p1" });
    mockStorage.getPolicy.mockResolvedValue({ agentId: "a1" });
    expect(await agentOwns("receipt", "r1", "a1", "o")).toBe(true);
  });
  it("group: only its responsible agent", async () => {
    mockStorage.getGroup.mockResolvedValue({ agentId: null });
    expect(await agentOwns("group", "g1", "a1", "o")).toBe(false);
  });
  it("client uses the existing client-access rule", async () => {
    mockStorage.getClient.mockResolvedValue({ id: "c1" });
    mockStorage.isClientAccessibleByAgent.mockResolvedValue(false);
    expect(await agentOwns("client", "c1", "a1", "o")).toBe(false);
  });
});

describe("role assignment guard — no privilege escalation", () => {
  const admin = { id: "u-admin", organizationId: "o" };
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.getUserEffectivePermissions.mockImplementation(async (id: string) =>
      id === "u-admin" ? ["read:policy", "write:user"] : id === "u-fm" ? ["read:policy", "delete:receipt"] : ["read:policy"]);
    mockStorage.getPermissions.mockResolvedValue([{ name: "read:policy" }, { name: "write:user" }, { name: "delete:receipt" }]);
    mockStorage.getRolePermissions.mockImplementation(async (roleId: string) =>
      roleId === "r-agent" ? [{ name: "read:policy" }] : [{ name: "read:policy" }, { name: "delete:receipt" }]);
  });
  it("can't change your own roles", async () => {
    expect(await roleAssignmentError(admin, [{ id: "r-agent", name: "agent" }], "u-admin")).toMatch(/own roles/);
  });
  it("can't give a role with powers you don't hold (finance manager, superuser)", async () => {
    expect(await roleAssignmentError(admin, [{ id: "r-fm", name: "finance_manager" }], "u-x")).toMatch(/finance manager/);
    expect(await roleAssignmentError(admin, [{ id: "r-su", name: "superuser" }], "u-x")).toMatch(/superuser/);
  });
  it("can give a role within your own powers", async () => {
    expect(await roleAssignmentError(admin, [{ id: "r-agent", name: "agent" }], "u-x")).toBeNull();
  });
  it("can't take over a more powerful account", async () => {
    expect(await manageUserError(admin, "u-fm")).toMatch(/powers you don't have/);
    expect(await manageUserError(admin, "u-agent")).toBeNull();
  });
  it("the platform owner can do anything", async () => {
    expect(await roleAssignmentError({ ...admin, isPlatformOwner: true }, [{ id: "r-su", name: "superuser" }], "u-admin")).toBeNull();
  });
});
