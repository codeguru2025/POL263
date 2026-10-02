import { describe, it, expect, vi } from "vitest";
import fs from "fs";
import path from "path";

vi.mock("../../server/storage", () => ({ storage: {} }));
vi.mock("../../server/tenant-db", () => ({ getDbForOrg: vi.fn() }));
vi.mock("../../server/db", () => ({ db: {} }));

import { SYSTEM_PERMISSIONS, ROLE_PERMISSION_MAP } from "../../server/constants";
import { isAgentScoped } from "../../shared/roles";
import { roleSyncChanges } from "../../server/seed";

/** Every permission string the code checks (server guards, permission lists, client checks). */
function permissionsCheckedInCode(): Map<string, string> {
  const root = path.resolve(__dirname, "../..");
  const out = new Map<string, string>();
  const walk = (dir: string) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) { if (!/node_modules|dist/.test(p)) walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f)) continue;
      const s = fs.readFileSync(p, "utf8");
      const add = (perm: string) => { if (!out.has(perm)) out.set(perm, path.relative(root, p)); };
      for (const m of s.matchAll(/require(?:Any)?Permission\(([^)]*)\)/g)) for (const x of m[1].matchAll(/"([a-z_]+:[a-z_]+)"/g)) add(x[1]);
      for (const m of s.matchAll(/\.(?:includes|has)\("([a-z_]+:[a-z_]+)"\)/g)) add(m[1]);
    }
  };
  for (const d of ["server", "client/src", "shared"]) walk(path.join(root, d));
  return out;
}

describe("permission catalogue — everything is grantable in the editors", () => {
  const catalogue = new Set(SYSTEM_PERMISSIONS.map((p) => p.name));

  it("every permission the code checks is in SYSTEM_PERMISSIONS", () => {
    const missing = [...permissionsCheckedInCode()].filter(([p]) => !catalogue.has(p)).map(([p, f]) => `${p} (${f})`);
    expect(missing).toEqual([]);
  });

  it("every role-template permission is in SYSTEM_PERMISSIONS", () => {
    const missing = Object.entries(ROLE_PERMISSION_MAP).flatMap(([role, perms]) => perms.filter((p) => !catalogue.has(p)).map((p) => `${role}: ${p}`));
    expect(missing).toEqual([]);
  });

  it("every catalogue permission has a description for the editor", () => {
    expect(SYSTEM_PERMISSIONS.filter((p) => !p.description?.trim()).map((p) => p.name)).toEqual([]);
  });
});

describe("isAgentScoped with permissions", () => {
  const agent = [{ name: "agent" }];
  it("an agent sees only their own unless given view:all_clients", () => {
    expect(isAgentScoped(agent, ["read:policy"])).toBe(true);
    expect(isAgentScoped(agent, ["read:policy", "view:all_clients"])).toBe(false);
  });
  it("an agent who is also an administrator is not scoped (admin template has view:all_clients)", () => {
    expect(isAgentScoped([...agent, { name: "administrator" }], ROLE_PERMISSION_MAP.administrator)).toBe(false);
    expect(isAgentScoped([...agent, { name: "administrator" }])).toBe(false);
  });
  it("non-agents are never scoped", () => {
    expect(isAgentScoped([{ name: "cashier" }], [])).toBe(false);
  });
  it("every role that lifts agent scoping by name also carries view:all_clients (so both rules agree)", () => {
    for (const r of ["administrator", "manager", "finance_manager", "sales_team_leader", "customer_service"]) {
      expect(ROLE_PERMISSION_MAP[r], r).toContain("view:all_clients");
    }
  });
});

describe("roleSyncChanges — role matrix edits survive a restart", () => {
  const template = ["read:policy", "write:policy", "create:requisition"];
  it("a new role gets the whole template", () => {
    expect(roleSyncChanges(template, new Set(), null, true)).toEqual({ add: template, remove: [] });
  });
  it("first sync with no snapshot only adds what is missing, takes nothing away", () => {
    expect(roleSyncChanges(template, new Set(["read:policy", "write:policy", "approve:claim"]), null, false))
      .toEqual({ add: ["create:requisition"], remove: [] });
  });
  it("afterwards only template changes apply — a permission removed by hand stays removed, one added by hand stays", () => {
    const snapshot = ["read:policy", "write:policy", "delete:policy"];
    const current = new Set(["read:policy", "approve:claim", "delete:policy"]); // write:policy removed by hand, approve:claim added by hand
    expect(roleSyncChanges(template, current, snapshot, false)).toEqual({ add: ["create:requisition"], remove: ["delete:policy"] });
  });
});
